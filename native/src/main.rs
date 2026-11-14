mod connection;
mod discovery;
mod local_media;
use rune::tok::{TextStyle, type_};
use rune::{
    AppSpec, Color, Cx, El, Player, PlayerState, SurfaceFit, TextEdit, Tx, Waker, col, el, row,
    text, text_input,
};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
#[derive(Default)]
struct State {
    address: TextEdit,
    result: String,
    waiting: bool,
    connection: Option<connection::Session>,
    connected_origin: String,
    connect_receive: Option<Receiver<connection::Event>>,
    connect_inflight: Arc<AtomicBool>,
    connect_cancel: Option<Arc<AtomicBool>>,
    receive: Option<Receiver<(String, Result<(), String>)>>,
    waker: Option<Waker>,
    review_mode: bool,
    media_inflight: Arc<AtomicBool>,
    media: Option<Player>,
    media_observed: String,
    media_name: String,
    media_status: String,
    media_seq: u64,
    media_receive: Option<Receiver<(u64, Result<local_media::LocalMedia, &'static str>)>>,
}
impl State {
    fn disconnect(&mut self) {
        if let Some(cancel) = self.connect_cancel.take() {
            cancel.store(true, Ordering::Release);
        }
        self.connect_receive = None;
        self.connection = None;
        self.connected_origin.clear();
        self.result =
            "Disconnected on this device. You can also revoke the connection in Studio.".into();
    }
    fn connect(&mut self) {
        if self.connect_receive.is_some() {
            return;
        }
        if self.connect_inflight.load(Ordering::Acquire) {
            self.result = "The previous connection is closing. Try again shortly.".into();
            return;
        }
        let address = self.address.text.trim().to_owned();
        if let Err(message) = discovery::origin(&address) {
            self.result = message.into();
            return;
        }
        let Some(waker) = self.waker.clone() else {
            self.result = "The connection is unavailable.".into();
            return;
        };
        self.connection = None;
        self.connected_origin = address.clone();
        let cancel = Arc::new(AtomicBool::new(false));
        let (send, receive) = mpsc::channel();
        self.connect_receive = Some(receive);
        self.connect_cancel = Some(cancel.clone());
        self.result = "Preparing a read-only connection…".into();
        self.connect_inflight.store(true, Ordering::Release);
        let inflight = self.connect_inflight.clone();
        std::thread::spawn(move || {
            let worker_waker = waker.clone();
            connection::connect(address, send, cancel, move || worker_waker());
            inflight.store(false, Ordering::Release);
            waker();
        });
    }
    fn choose_media(&mut self, files: &[PathBuf]) {
        self.media_seq = self.media_seq.wrapping_add(1);
        self.media_receive = None;
        if files.len() != 1 {
            self.media_status = "Drop exactly one local file.".into();
            return;
        }
        let Some(waker) = self.waker.clone() else {
            self.media_status = "The local reviewer is unavailable.".into();
            return;
        };
        if self.media_inflight.swap(true, Ordering::AcqRel) {
            self.media_status =
                "A previous file is still being checked. Try again when it finishes.".into();
            return;
        }
        let seq = self.media_seq;
        let path = files[0].clone();
        let (send, receive) = mpsc::channel();
        let in_flight = self.media_inflight.clone();
        self.media_receive = Some(receive);
        self.media_status = "Checking the local file…".into();
        std::thread::spawn(move || {
            let result = local_media::inspect(&path);
            in_flight.store(false, Ordering::Release);
            let _ = send.send((seq, result));
            waker();
        });
    }
    fn cancel_media_check(&mut self) {
        self.media_seq = self.media_seq.wrapping_add(1);
        self.media_receive = None;
        self.media_status = "File check cancelled. No file was opened.".into();
    }
    fn close_media(&mut self) {
        self.cancel_media_check();
        if let Some(media) = self.media.take() {
            media.pause();
        }
        self.media_name.clear();
        self.media_status = "Local review closed. The original file is unchanged.".into();
    }
    fn toggle_media(&mut self) {
        if let Some(media) = &self.media {
            if media.is_playing() {
                media.pause()
            } else {
                media.set_muted(false);
                media.play()
            }
        }
    }
    fn seek_media(&mut self, seconds: f64) {
        if let Some(media) = &self.media {
            media.seek((media.time() + seconds).max(0.0));
        }
    }
    fn check(&mut self) {
        if self.waiting {
            return;
        }
        let address = self.address.text.clone();
        if let Err(message) = discovery::origin(&address) {
            self.result = message.into();
            return;
        }
        let Some(waker) = self.waker.clone() else {
            self.result = "The connection checker is unavailable.".into();
            return;
        };
        let (send, receive) = mpsc::channel();
        self.receive = Some(receive);
        self.waiting = true;
        self.result = "Checking Studio authorization information…".into();
        std::thread::spawn(move || {
            let result = discovery::check(&address);
            let _ = send.send((address, result));
            waker();
        });
    }
}
fn colour(hex: &str) -> Color {
    rune::color::hex(hex).expect("valid colour")
}
fn label(value: impl Into<String>, size: f32, color: Color) -> El {
    text(value)
        .font(TextStyle::new(size, 400.0).lh(size * 1.4))
        .color(color)
        .wrap_anywhere()
}
fn view(s: &State, _: &mut Cx<State>) -> El {
    let paper = colour("#f4f0e8");
    let ink = colour("#17181b");
    let muted = colour("#4d5057");
    let line = colour("#cfc7b9");
    let accent = colour("#a73800");
    let button = row()
        .key("check")
        .h(44.0)
        .px(18.0)
        .center()
        .radius(8.0)
        .role("button")
        .label("Check Studio address")
        .focusable(true)
        .disabled(s.waiting)
        .fill(if s.waiting { muted } else { accent })
        .focus_ring(2.0, 2.0, ink)
        .child(label(
            if s.waiting {
                "Checking…"
            } else {
                "Check address"
            },
            15.0,
            Color::WHITE,
        ))
        .on_press(|s: &mut State| s.check());
    let action = |key: &'static str, title: &'static str, f: fn(&mut State)| {
        row()
            .key(key)
            .h(38.0)
            .px(12.0)
            .center()
            .radius(7.0)
            .border(1.0, line)
            .role("button")
            .label(title)
            .focusable(true)
            .focus_ring(2.0, 2.0, ink)
            .child(label(title, 14.0, ink))
            .on_press(f)
    };
    if s.review_mode {
        let media_view = if let Some(media) = &s.media {
            let state = match media.state() {
                PlayerState::Loading => "Loading",
                PlayerState::Playing => "Playing",
                PlayerState::Ready => "Paused",
                PlayerState::Ended => "Finished",
                PlayerState::Failed(_) => "This file could not be played",
                _ => "Preparing",
            };
            let frame = if media.is_audio() {
                row()
                    .h(80.0)
                    .w_full()
                    .center()
                    .child(label("Audio file", 18.0, ink))
            } else {
                row()
                    .h(120.0)
                    .w_full()
                    .center()
                    .child(el().w(220.0).h(120.0).video(media, SurfaceFit::Fit))
            };
            let action = |key: &'static str, title: &'static str, f: fn(&mut State)| {
                row()
                    .key(key)
                    .h(38.0)
                    .px(12.0)
                    .center()
                    .radius(7.0)
                    .border(1.0, line)
                    .role("button")
                    .label(title)
                    .focusable(true)
                    .focus_ring(2.0, 2.0, ink)
                    .child(label(title, 14.0, ink))
                    .on_press(f)
            };
            col()
                .gap(6.0)
                .child(label(
                    format!("{} · {} · {:.1}s", s.media_name, state, media.time()),
                    14.0,
                    ink,
                ))
                .child(frame)
                .child(
                    row()
                        .gap(8.0)
                        .child(action("media-back", "Back 5 seconds", |s| {
                            s.seek_media(-5.0)
                        }))
                        .child(action("media-toggle", "Play / pause", State::toggle_media))
                        .child(action("media-forward", "Forward 5 seconds", |s| {
                            s.seek_media(5.0)
                        }))
                        .child(action("media-close", "Close", State::close_media)),
                )
        } else {
            col().child(label(
                "Drop one local MP4, MOV, M4V, MP3, M4A or WAV file here (up to 256 MiB).",
                14.0,
                muted,
            ))
        };
        let cancel = if s.media_receive.is_some() {
            row().child(action(
                "media-cancel",
                "Cancel file check",
                State::cancel_media_check,
            ))
        } else {
            row()
        };
        return col()
            .key("local-review-screen")
            .w_full()
            .h_full()
            .fill(paper)
            .px(32.0)
            .py(24.0)
            .gap(12.0)
            .child(
                text("Review a local file")
                    .font(TextStyle::new(26.0, 700.0))
                    .color(ink)
                    .role("heading")
                    .level(1),
            )
            .child(label(
                "Local only: no upload or Studio connection. Select one file by dropping it below.",
                15.0,
                muted,
            ))
            .child(
                col()
                    .key("local-review")
                    .w_full()
                    .h(270.0)
                    .gap(8.0)
                    .padding(12.0)
                    .border(1.0, line)
                    .radius(8.0)
                    .on_drop_files(|s: &mut State, files, _| s.choose_media(files))
                    .child(media_view)
                    .child(label(&s.media_status, 13.0, muted).role("status"))
                    .child(cancel),
            )
            .child(
                row().child(action("review-back", "Back to connection check", |s| {
                    s.close_media();
                    s.review_mode = false;
                })),
            );
    }
    col().key("studio-native").w_full().h_full().fill(paper).px(40.0).py(30.0).gap(18.0)
      .child(text("Media Studio").font(TextStyle::new(26.0,700.0)).color(ink).role("heading").level(1))
      .child(el().h(1.0).w_full().fill(line))
      .child(text("Find your Studio").font(TextStyle::new(32.0,700.0)).color(ink).role("heading").level(2))
      .child(label("Enter the HTTPS address of your own Media Studio. This check reads public connection information only; it does not sign in or access projects.",16.0,muted))
      .child(label("Studio address",15.0,ink))
      .child(row().h(48.0).w_full().px(12.0).center_y().fill(Color::WHITE).border(1.0,line).radius(8.0).child(text_input(&s.address,type_::BODY).key("address").label("Studio address").single_line().grow(1.0).color(ink).placeholder("https://your-studio.example",muted).on_edit(|s: &mut State| &mut s.address)))
      .child(row().gap(8.0).child(button).child(if s.connect_receive.is_some() || s.connection.is_some() { action("disconnect", "Disconnect", State::disconnect) } else { action("connect", "Connect read-only", State::connect) })).child(label("Connect opens your browser. You choose one project; read access includes its records, prompts, assets and exports. No generation, spending or publishing.",14.0,muted)).child(label(&s.result,15.0,ink).role("status"))
      .child(row().child(action("review-open","Review a local file",|s|s.review_mode=true)))
      .child(el().grow(1.0))
      .child(label("Early desktop preview. The connection lasts only for this session; media editing and platform packages are not implemented.",14.0,muted))
}
fn setup(s: &mut State, waker: Waker) {
    s.waker = Some(waker);
}
fn poll(s: &mut State, _: f64, tx: &mut Tx) -> bool {
    let mut changed = false;
    if (s.connection.is_some() || s.connect_receive.is_some())
        && s.address.text.trim() != s.connected_origin
    {
        s.disconnect();
        s.result = "Address changed. Connect again to the new Studio.".into();
        changed = true;
    }
    if let Some(event) = s.connect_receive.as_ref().and_then(|r| r.try_recv().ok()) {
        match event {
            connection::Event::Open(url) => {
                if tx.open_url(&url).is_err() {
                    s.disconnect();
                    s.result = "Could not open the browser. Try again.".into();
                } else {
                    s.result =
                        "Choose a project and allow read-only access in your browser.".into();
                }
            }
            connection::Event::Connected(session, name) => {
                s.connect_receive = None;
                s.connect_cancel = None;
                s.connection = Some(session);
                s.result =
                    format!("Connected to {name}. Read-only access expires within 30 minutes.");
            }
            connection::Event::Failed(error) => {
                s.connect_receive = None;
                s.connect_cancel = None;
                s.connection = None;
                s.result = error.into();
            }
        }
        changed = true;
    }
    if let Some(session) = &s.connection {
        if std::time::Instant::now() >= session.expires {
            s.disconnect();
            s.result = "Connection expired. Connect again to continue.".into();
            changed = true;
        } else {
            tx.wake_after(Duration::from_secs(1));
        }
    }
    if let Some((address, result)) = s.receive.as_ref().and_then(|r| r.try_recv().ok()) {
        s.receive = None;
        s.waiting = false;
        s.result = if s.address.text != address {
            "Address changed. Check the new address.".into()
        } else {
            match result {
                Ok(()) => format!(
                    "{address} advertises the required read-only PKCE endpoints. You can start a connection."
                ),
                Err(error) => error,
            }
        };
        changed = true;
    }
    if let Some((seq, result)) = s.media_receive.as_ref().and_then(|r| r.try_recv().ok()) {
        s.media_receive = None;
        if seq == s.media_seq {
            match result {
                Ok(item) => {
                    if let Some(old) = s.media.take() {
                        old.pause();
                    }
                    let player = match item.kind {
                        local_media::Kind::Audio => Player::audio(item.path),
                        local_media::Kind::Video => Player::new(item.path.into()),
                    };
                    if let Some(waker) = s.waker.clone() {
                        player.set_waker(waker);
                    }
                    s.media_name = item.name;
                    s.media = Some(player);
                    s.media_status = "File selected. Press Play / pause to begin.".into();
                }
                Err(message) => s.media_status = message.into(),
            }
            changed = true;
        }
    }
    if s.media_receive.is_none()
        && !s.media_inflight.load(Ordering::Acquire)
        && s.media_status
            .starts_with("A previous file is still being checked")
    {
        s.media_status = "Previous file check finished. Drop a file again.".into();
        changed = true;
    }
    if let Some(player) = &s.media {
        let observed = format!("{:?}:{:.1}", player.state(), player.time());
        if observed != s.media_observed {
            s.media_observed = observed;
            changed = true;
        }
        if player.is_playing() {
            tx.wake_after(Duration::from_millis(200));
        }
    } else if !s.media_observed.is_empty() {
        s.media_observed.clear();
        changed = true;
    }
    changed
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "--check-origin") {
        let Some(origin) = args.get(2) else {
            eprintln!("Usage: media-studio-native --check-origin https://your-studio.example");
            std::process::exit(2);
        };
        if args.len() != 3 {
            eprintln!("Supply one Studio origin.");
            std::process::exit(2);
        }
        match discovery::check(origin) {
            Ok(()) => println!(
                "Studio advertises the expected read-only PKCE endpoints; no sign-in was performed."
            ),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    rune::App::new(AppSpec {
        setup: Some(setup),
        poll: Some(poll),
        min_size: Some((640.0, 500.0)),
        ..AppSpec::new("Media Studio", (780.0, 580.0), State::default, view)
    })
    .tab_visits_controls(true)
    .run();
}

#[cfg(test)]
mod ui_tests {
    use super::*;
    use rune::{Env, Runtime};
    #[test]
    fn invalid_drop_and_cancel_invalidate_pending_selection() {
        let (sender, receiver) = mpsc::channel();
        let mut state = State::default();
        state.waker = Some(Arc::new(|| {}));
        state.media_receive = Some(receiver);
        state.media_seq = 7;
        state.media_inflight.store(true, Ordering::Release);
        state.choose_media(&[PathBuf::from("one.mp4"), PathBuf::from("two.mp4")]);
        assert!(state.media_receive.is_none());
        assert_eq!(state.media_seq, 8);
        assert!(sender.send((7, Err("late"))).is_err());
        state.choose_media(&[PathBuf::from("new.mp4")]);
        assert!(state.media_receive.is_none());
        assert!(state.media_status.contains("still being checked"));
        let (_sender, receiver) = mpsc::channel();
        state.media_receive = Some(receiver);
        state.cancel_media_check();
        assert!(state.media_receive.is_none());
        assert!(state.media_status.contains("cancelled"));
    }
    #[test]
    fn review_screen_is_reachable_and_cancellable() {
        let mut rt = Runtime::new(
            State::default(),
            view,
            (780.0, 580.0),
            Env {
                system_dark: false,
                scale: 1.0,
            },
        );
        rt.frame(0.0);
        let (x, y) = rt.find("review-open").expect("review button");
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        rt.frame(1.0 / 60.0);
        assert!(rt.state.review_mode);
        assert!(rt.find("local-review").is_some());
        assert!(rt.find("review-back").is_some());
        let (_sender, receiver) = mpsc::channel();
        rt.state.media_receive = Some(receiver);
        rt.invalidate();
        rt.frame(2.0 / 60.0);
        assert!(rt.find("media-cancel").is_some());
    }
    #[test]
    fn player_state_changes_invalidate_the_native_view() {
        let mut state = State::default();
        state.media = Some(Player::new(
            PathBuf::from("/nonexistent/fictional.mp4").into(),
        ));
        let mut tx = Tx::default();
        assert!(poll(&mut state, 0.0, &mut tx));
        assert!(!state.media_observed.is_empty());
        state.media = None;
        assert!(poll(&mut state, 0.0, &mut tx));
        assert!(state.media_observed.is_empty());
    }
    #[test]
    fn disconnect_clears_session_and_blocks_overlapping_worker() {
        let mut state = State::default();
        state.address.text = "https://studio.example".into();
        state.waker = Some(Arc::new(|| {}));
        let flag = Arc::new(AtomicBool::new(false));
        state.connect_cancel = Some(flag.clone());
        state.connect_inflight.store(true, Ordering::Release);
        state.disconnect();
        assert!(flag.load(Ordering::Acquire));
        state.connect();
        assert!(state.connect_receive.is_none());
        assert!(state.result.contains("previous connection"));
    }
    #[test]
    fn invalid_address_fails_in_native_ui_without_network() {
        let mut rt = Runtime::new(
            State::default(),
            view,
            (780.0, 580.0),
            Env {
                system_dark: false,
                scale: 1.0,
            },
        );
        rt.frame(0.0);
        let (x, y) = rt.find("check").expect("check button");
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        rt.frame(1.0 / 60.0);
        assert_eq!(rt.state.result, "Enter a complete HTTPS Studio address.");
        assert!(!rt.state.waiting);
    }
}
