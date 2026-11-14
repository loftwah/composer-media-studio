//! Session-only, read-only Studio MCP connection. No secrets are persisted or logged.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
    },
    time::{Duration, Instant},
};
use url::Url;

pub enum Event {
    Open(String),
    Connected(Session, String),
    Failed(&'static str),
}
pub struct Session {
    _token: String,
    pub expires: Instant,
}
fn random() -> Result<String, &'static str> {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "Secure random numbers are unavailable.")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn read_json(response: reqwest::blocking::Response, limit: u64) -> Result<Value, &'static str> {
    if !response.status().is_success() {
        return Err("Studio rejected the connection request. Sign in and try again.");
    }
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read Studio's response.")?;
    if bytes.len() as u64 > limit {
        return Err("Studio's response was too large.");
    }
    serde_json::from_slice(&bytes).map_err(|_| "Studio returned an invalid response.")
}
fn callback(
    listener: TcpListener,
    state: &str,
    cancel: &AtomicBool,
) -> Result<String, &'static str> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "Could not start the local callback.")?;
    let port = listener
        .local_addr()
        .map_err(|_| "Could not start the local callback.")?
        .port();
    let deadline = Instant::now() + Duration::from_secs(120);
    let mut attempts = 0;
    while Instant::now() < deadline && !cancel.load(Ordering::Acquire) && attempts < 32 {
        let (mut stream, peer) = match listener.accept() {
            Ok(x) => x,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }
            Err(_) => return Err("Local callback failed."),
        };
        attempts += 1;
        if !peer.ip().is_loopback() {
            continue;
        }
        let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));
        let request_deadline = Instant::now() + Duration::from_secs(2);
        let mut buf = [0u8; 8192];
        let mut n = 0;
        while n < buf.len()
            && Instant::now() < request_deadline
            && Instant::now() < deadline
            && !cancel.load(Ordering::Acquire)
            && !buf[..n].windows(4).any(|w| w == b"\r\n\r\n")
        {
            match stream.read(&mut buf[n..]) {
                Ok(0) => break,
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    continue;
                }
                Err(_) => break,
                Ok(k) => n += k,
            }
        }
        if cancel.load(Ordering::Acquire) {
            return Err("Connection cancelled.");
        }
        let input = std::str::from_utf8(&buf[..n]).unwrap_or("");
        let mut lines = input.split("\r\n");
        let line = lines.next().unwrap_or("");
        let host = format!("127.0.0.1:{port}");
        let hosts: Vec<_> = lines
            .filter_map(|l| l.split_once(':'))
            .filter(|(k, _)| k.eq_ignore_ascii_case("host"))
            .map(|(_, v)| v.trim())
            .collect();
        let path = line
            .strip_prefix("GET ")
            .and_then(|s| s.strip_suffix(" HTTP/1.1"));
        let parsed = path.and_then(|p| Url::parse(&format!("http://{host}{p}")).ok());
        let mut code = None;
        let mut states = Vec::new();
        let mut errors = Vec::new();
        let mut codes = Vec::new();
        if let Some(u) = parsed.as_ref().filter(|u| {
            u.path() == "/callback"
                && u.host_str() == Some("127.0.0.1")
                && u.port() == Some(port)
                && u.fragment().is_none()
        }) {
            for (k, v) in u.query_pairs() {
                match k.as_ref() {
                    "state" => states.push(v.into_owned()),
                    "code" => codes.push(v.into_owned()),
                    "error" => errors.push(v.into_owned()),
                    _ => {}
                }
            }
        }
        if hosts == [host.as_str()]
            && states.len() == 1
            && states[0] == state
            && codes.len() == 1
            && errors.is_empty()
            && (1..=512).contains(&codes[0].len())
            && codes[0]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            code = codes.pop();
        }
        let denied = hosts == [host.as_str()]
            && states.len() == 1
            && states[0] == state
            && codes.is_empty()
            && errors.len() == 1;
        let ok = code.is_some() || denied;
        let body = if ok {
            "You can return to Media Studio."
        } else {
            "Invalid callback."
        };
        let _ = write!(
            stream,
            "HTTP/1.1 {}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
            if ok { "200 OK" } else { "400 Bad Request" },
            body.len(),
            body
        );
        if denied {
            return Err("Connection was cancelled in the browser.");
        }
        if let Some(code) = code {
            return Ok(code);
        }
    }
    Err(if cancel.load(Ordering::Acquire) {
        "Connection cancelled."
    } else {
        "Connection timed out. Try again."
    })
}
fn rpc(
    client: &reqwest::blocking::Client,
    resource: &str,
    token: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    let response = client
        .post(resource)
        .bearer_auth(token)
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2025-11-25")
        .json(&payload)
        .send()
        .map_err(|_| "Could not reach the Studio project.")?;
    if !response.status().is_success() {
        return Err("Studio denied the project connection or it expired.");
    }
    let kind = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let mut bytes = Vec::new();
    response
        .take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the project response.")?;
    if bytes.len() > 1_048_576 {
        return Err("The project response was too large.");
    }
    if kind.starts_with("application/json") {
        serde_json::from_slice(&bytes).map_err(|_| "Studio returned invalid project data.")
    } else if kind.starts_with("text/event-stream") {
        let text =
            std::str::from_utf8(&bytes).map_err(|_| "Studio returned invalid project data.")?;
        text.lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .find_map(|v| serde_json::from_str(v.trim()).ok())
            .ok_or("Studio returned invalid project data.")
    } else {
        Err("Studio returned an unsupported response.")
    }
}
pub fn connect(
    address: String,
    send: Sender<Event>,
    cancel: Arc<AtomicBool>,
    wake: impl Fn() + Send + 'static,
) {
    let result = (|| -> Result<(Session, String), &'static str> {
        #[cfg(not(test))]
        let base = {
            let base = crate::discovery::origin(&address)?;
            crate::discovery::check(&address)
                .map_err(|_| "Could not verify Studio authorization information.")?;
            base
        };
        #[cfg(test)]
        let base = if address.starts_with("http://127.0.0.1:") {
            Url::parse(&address).map_err(|_| "Invalid test address.")?
        } else {
            let base = crate::discovery::origin(&address)?;
            crate::discovery::check(&address)
                .map_err(|_| "Could not verify Studio authorization information.")?;
            base
        };
        if cancel.load(Ordering::Acquire) {
            return Err("Connection cancelled.");
        }
        let root = base.as_str().trim_end_matches('/');
        let resource = format!("{root}/mcp");
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "Could not start a secure connection.")?;
        let listener =
            TcpListener::bind("127.0.0.1:0").map_err(|_| "Could not open a local callback.")?;
        let redirect = format!(
            "http://127.0.0.1:{}/callback",
            listener
                .local_addr()
                .map_err(|_| "Could not open a local callback.")?
                .port()
        );
        let verifier = random()?;
        let state = random()?;
        let challenge =
            URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, verifier.as_bytes()).as_ref());
        let reg=read_json(client.post(format!("{root}/mcp/register")).json(&json!({"client_name":"Media Studio desktop","redirect_uris":[redirect],"token_endpoint_auth_method":"none"})).send().map_err(|_| "Could not register this desktop connection.")?,16_384)?;
        if cancel.load(Ordering::Acquire) {
            return Err("Connection cancelled.");
        }
        let client_id = reg
            .get("client_id")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty() && v.len() <= 256)
            .ok_or("Studio returned an invalid client registration.")?;
        let mut authorize =
            Url::parse(&format!("{root}/mcp/authorize")).map_err(|_| "Invalid Studio address.")?;
        authorize
            .query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", &redirect)
            .append_pair("resource", &resource)
            .append_pair("scope", "studio.read")
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");
        if cancel.load(Ordering::Acquire) {
            return Err("Connection cancelled.");
        }
        send.send(Event::Open(authorize.to_string()))
            .map_err(|_| "Connection cancelled.")?;
        wake();
        let code = callback(listener, &state, &cancel)?;
        if cancel.load(Ordering::Acquire) {
            return Err("Connection cancelled.");
        }
        let token_started = Instant::now();
        let token = read_json(
            client
                .post(format!("{root}/mcp/token"))
                .form(&[
                    ("grant_type", "authorization_code"),
                    ("code", &code),
                    ("client_id", client_id),
                    ("redirect_uri", &redirect),
                    ("resource", &resource),
                    ("code_verifier", &verifier),
                ])
                .send()
                .map_err(|_| "Could not complete Studio authorization.")?,
            16_384,
        )?;
        let access = token
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|s| {
                s.len() == 43
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            })
            .ok_or("Studio returned an invalid access token.")?
            .to_owned();
        let expiry = token
            .get("expires_in")
            .and_then(Value::as_u64)
            .filter(|n| *n > 0 && *n <= 1800)
            .ok_or("Studio returned an invalid expiry.")?;
        if token.get("scope").and_then(Value::as_str) != Some("studio.read")
            || token.get("token_type").and_then(Value::as_str) != Some("Bearer")
        {
            return Err("Studio returned unexpected permissions.");
        }
        if cancel.load(Ordering::Acquire) {
            return Err("Connection cancelled.");
        }
        let init = rpc(
            &client,
            &resource,
            &access,
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"media-studio-desktop","version":"0.0.1"}}}),
        )?;
        if init.get("id") != Some(&json!(1))
            || init
                .pointer("/result/protocolVersion")
                .and_then(Value::as_str)
                != Some("2025-11-25")
        {
            return Err("Studio did not accept this connection protocol.");
        }
        if cancel.load(Ordering::Acquire) {
            return Err("Connection cancelled.");
        }
        let projects = rpc(
            &client,
            &resource,
            &access,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"studio_list_projects","arguments":{}}}),
        )?;
        if projects.get("id") != Some(&json!(2))
            || projects.pointer("/result/isError").and_then(Value::as_bool) == Some(true)
        {
            return Err("Studio could not read the selected project.");
        }
        let list = projects
            .pointer("/result/structuredContent/projects")
            .and_then(Value::as_array)
            .filter(|p| p.len() == 1)
            .ok_or("Studio did not return exactly one selected project.")?;
        let name = list[0]
            .get("name")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 320)
            .ok_or("Studio returned an invalid project name.")?
            .to_owned();
        if cancel.load(Ordering::Acquire) {
            return Err("Connection cancelled.");
        }
        Ok((
            Session {
                _token: access,
                expires: token_started + Duration::from_secs(expiry.saturating_sub(10)),
            },
            name,
        ))
    })();
    let event = match result {
        Ok((session, name)) => Event::Connected(session, name),
        Err(e) => Event::Failed(e),
    };
    let _ = send.send(event);
    wake();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{net::TcpStream, sync::mpsc, thread};
    fn request(addr: std::net::SocketAddr, path: &str, host: &str) -> String {
        let mut s = TcpStream::connect(addr).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }
    #[test]
    fn callback_rejects_wrong_state_host_and_duplicate_then_accepts_one() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let t = thread::spawn(move || callback(listener, "real", &AtomicBool::new(false)));
        assert!(
            request(addr, "/callback?state=wrong&code=abc", &addr.to_string()).contains("400 Bad")
        );
        assert!(request(addr, "/callback?state=real&code=abc", "evil.example").contains("400 Bad"));
        assert!(
            request(
                addr,
                "/callback?state=real&state=real&code=abc",
                &addr.to_string()
            )
            .contains("400 Bad")
        );
        assert!(
            request(addr, "/callback?state=real&code=abc", &addr.to_string()).contains("200 OK")
        );
        assert_eq!(t.join().unwrap().unwrap(), "abc");
        assert!(TcpStream::connect(addr).is_err());
    }
    #[test]
    fn callback_cancel_interrupts_slow_trickle() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let worker = flag.clone();
        let t = thread::spawn(move || callback(listener, "real", &worker));
        let mut stream = TcpStream::connect(addr).unwrap();
        stream.write_all(b"GET /callback?").unwrap();
        thread::sleep(Duration::from_millis(200));
        let started = Instant::now();
        flag.store(true, Ordering::Release);
        assert_eq!(t.join().unwrap().unwrap_err(), "Connection cancelled.");
        assert!(started.elapsed() < Duration::from_secs(1));
    }
    fn fictional_flow(cancel_on_init: bool) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (proof_tx, proof_rx) = mpsc::channel();
        let cancel = Arc::new(AtomicBool::new(false));
        let server_cancel = cancel.clone();
        let server = thread::spawn(move || {
            for i in 0..if cancel_on_init { 3 } else { 4 } {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut data = Vec::new();
                let mut buf = [0u8; 4096];
                let body_start = loop {
                    let n = stream.read(&mut buf).unwrap();
                    assert!(n > 0);
                    data.extend_from_slice(&buf[..n]);
                    if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                        break pos + 4;
                    }
                };
                let head = String::from_utf8(data[..body_start].to_vec()).unwrap();
                let len: usize = head
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|s| s.trim().parse().ok())
                    })
                    .unwrap();
                while data.len() < body_start + len {
                    let n = stream.read(&mut buf).unwrap();
                    assert!(n > 0);
                    data.extend_from_slice(&buf[..n]);
                }
                let body = String::from_utf8(data[body_start..body_start + len].to_vec()).unwrap();
                let out = match i {
                    0 => {
                        let v: Value = serde_json::from_str(&body).unwrap();
                        assert_eq!(v["token_endpoint_auth_method"], "none");
                        json!({"client_id":"fictional"})
                    }
                    1 => {
                        proof_tx.send(body).unwrap();
                        json!({"access_token":"a".repeat(43),"token_type":"Bearer","expires_in":1800,"scope":"studio.read"})
                    }
                    2 => {
                        if cancel_on_init {
                            server_cancel.store(true, Ordering::Release);
                        }
                        assert!(
                            head.to_ascii_lowercase()
                                .contains(&format!("authorization: bearer {}", "a".repeat(43)))
                        );
                        json!({"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25"}})
                    }
                    _ => {
                        let v: Value = serde_json::from_str(&body).unwrap();
                        assert_eq!(v["params"]["name"], "studio_list_projects");
                        json!({"jsonrpc":"2.0","id":2,"result":{"structuredContent":{"projects":[{"name":"Fictional project"}]}}})
                    }
                };
                let body = out.to_string();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
            }
            if cancel_on_init {
                listener.set_nonblocking(true).unwrap();
                thread::sleep(Duration::from_millis(300));
                assert!(
                    listener.accept().is_err(),
                    "cancelled connection read project"
                );
            }
        });
        let (send, receive) = mpsc::channel();
        let worker = thread::spawn(move || connect(format!("http://{addr}"), send, cancel, || {}));
        let Event::Open(authorize) = receive.recv_timeout(Duration::from_secs(4)).unwrap() else {
            panic!("no browser URL")
        };
        let url = Url::parse(&authorize).unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(pairs["scope"], "studio.read");
        assert_eq!(pairs["code_challenge_method"], "S256");
        assert_eq!(pairs["resource"], format!("http://{addr}/mcp"));
        let redirect = Url::parse(&pairs["redirect_uri"]).unwrap();
        let callback_addr = std::net::SocketAddr::from(([127, 0, 0, 1], redirect.port().unwrap()));
        assert!(
            request(
                callback_addr,
                &format!("/callback?state={}&code=fictionalcode", pairs["state"]),
                &callback_addr.to_string()
            )
            .contains("200 OK")
        );
        let form = proof_rx.recv_timeout(Duration::from_secs(4)).unwrap();
        let token_pairs: std::collections::HashMap<_, _> =
            url::form_urlencoded::parse(form.as_bytes())
                .into_owned()
                .collect();
        assert_eq!(token_pairs["redirect_uri"], pairs["redirect_uri"]);
        assert_eq!(token_pairs["resource"], pairs["resource"]);
        assert_eq!(
            URL_SAFE_NO_PAD.encode(
                digest::digest(&digest::SHA256, token_pairs["code_verifier"].as_bytes()).as_ref()
            ),
            pairs["code_challenge"]
        );
        match receive.recv_timeout(Duration::from_secs(4)).unwrap() {
            Event::Connected(_, name) if !cancel_on_init => assert_eq!(name, "Fictional project"),
            Event::Failed("Connection cancelled.") if cancel_on_init => {}
            _ => panic!("unexpected connection result"),
        };
        worker.join().unwrap();
        server.join().unwrap();
    }
    #[test]
    fn fictional_oauth_and_mcp_flow_uses_pkce_and_read_scope() {
        fictional_flow(false);
    }
    #[test]
    fn cancellation_during_initialization_prevents_project_read() {
        fictional_flow(true);
    }
}
