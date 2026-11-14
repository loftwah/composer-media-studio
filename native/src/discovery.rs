use serde::Deserialize;
use std::io::Read;
use std::time::Duration;
use url::Url;

#[derive(Deserialize)]
struct Metadata {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    registration_endpoint: String,
    response_types_supported: Vec<String>,
    grant_types_supported: Vec<String>,
    code_challenge_methods_supported: Vec<String>,
    token_endpoint_auth_methods_supported: Vec<String>,
    scopes_supported: Vec<String>,
}

pub fn origin(input: &str) -> Result<Url, &'static str> {
    if input.len() > 2048 {
        return Err("Studio address is too long.");
    }
    let parsed = Url::parse(input.trim()).map_err(|_| "Enter a complete HTTPS Studio address.")?;
    if parsed.scheme() != "https"
        || parsed.host().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Use an HTTPS origin without credentials, a path, query or fragment.");
    }
    Ok(parsed)
}

fn validate(base: &Url, m: Metadata) -> Result<(), &'static str> {
    let root = base.as_str().trim_end_matches('/');
    if m.issuer != root
        || m.authorization_endpoint != format!("{root}/mcp/authorize")
        || m.token_endpoint != format!("{root}/mcp/token")
        || m.registration_endpoint != format!("{root}/mcp/register")
    {
        return Err("The server's authorization endpoints do not match this Studio origin.");
    }
    if !m.response_types_supported.iter().any(|x| x == "code")
        || !m
            .grant_types_supported
            .iter()
            .any(|x| x == "authorization_code")
        || !m
            .code_challenge_methods_supported
            .iter()
            .any(|x| x == "S256")
        || !m
            .token_endpoint_auth_methods_supported
            .iter()
            .any(|x| x == "none")
        || !m.scopes_supported.iter().any(|x| x == "studio.read")
    {
        return Err("This server does not advertise the required read-only PKCE connection.");
    }
    Ok(())
}

pub fn check(input: &str) -> Result<(), String> {
    let base = origin(input).map_err(str::to_owned)?;
    let endpoint = base
        .join("/.well-known/oauth-authorization-server")
        .map_err(|_| "Invalid Studio address.".to_owned())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not start a secure connection.".to_owned())?;
    let response = client.get(endpoint).send().map_err(|_| {
        "Could not reach this Studio over HTTPS. Check the address and connection.".to_owned()
    })?;
    if !response.status().is_success() {
        return Err("Studio did not return authorization information.".into());
    }
    let mut bytes = Vec::new();
    response
        .take(16_385)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read Studio authorization information.".to_owned())?;
    if bytes.len() > 16_384 {
        return Err("Studio authorization information is too large.".into());
    }
    let metadata: Metadata = serde_json::from_slice(&bytes)
        .map_err(|_| "Studio returned invalid authorization information.".to_owned())?;
    validate(&base, metadata).map_err(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn metadata() -> Metadata {
        serde_json::from_str(r#"{"issuer":"https://studio.example","authorization_endpoint":"https://studio.example/mcp/authorize","token_endpoint":"https://studio.example/mcp/token","registration_endpoint":"https://studio.example/mcp/register","response_types_supported":["code"],"grant_types_supported":["authorization_code"],"code_challenge_methods_supported":["S256"],"token_endpoint_auth_methods_supported":["none"],"scopes_supported":["studio.read"]}"#).unwrap()
    }
    #[test]
    fn validates_origin_and_capabilities() {
        let base = origin("https://studio.example").unwrap();
        assert!(validate(&base, metadata()).is_ok());
        let mut m = metadata();
        m.token_endpoint = "https://other.example/mcp/token".into();
        assert!(validate(&base, m).is_err());
    }
    #[test]
    fn refuses_bad_addresses_and_missing_pkce() {
        for url in [
            "http://studio.example",
            "https://u:p@studio.example",
            "https://studio.example/path",
            "https://studio.example/?token=x",
            "https://studio.example/#x",
        ] {
            assert!(origin(url).is_err(), "{url}");
        }
        let mut m = metadata();
        m.code_challenge_methods_supported.clear();
        assert!(validate(&origin("https://studio.example").unwrap(), m).is_err());
    }
}
