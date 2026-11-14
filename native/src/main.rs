mod discovery;
use rune::tok::{TextStyle, type_};
use rune::{AppSpec, Color, Cx, El, TextEdit, Tx, Waker, col, el, row, text, text_input};
use std::sync::mpsc::{self, Receiver};
#[derive(Default)]
struct State {
    address: TextEdit,
    result: String,
    waiting: bool,
    receive: Option<Receiver<(String, Result<(), String>)>>,
    waker: Option<Waker>,
}
impl State {
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
    col().key("studio-native").w_full().h_full().fill(paper).px(40.0).py(30.0).gap(18.0)
      .child(text("Media Studio").font(TextStyle::new(26.0,700.0)).color(ink).role("heading").level(1))
      .child(el().h(1.0).w_full().fill(line))
      .child(text("Find your Studio").font(TextStyle::new(32.0,700.0)).color(ink).role("heading").level(2))
      .child(label("Enter the HTTPS address of your own Media Studio. This check reads public connection information only; it does not sign in or access projects.",16.0,muted))
      .child(label("Studio address",15.0,ink))
      .child(row().h(48.0).w_full().px(12.0).center_y().fill(Color::WHITE).border(1.0,line).radius(8.0).child(text_input(&s.address,type_::BODY).key("address").label("Studio address").single_line().grow(1.0).color(ink).placeholder("https://your-studio.example",muted).on_edit(|s: &mut State| &mut s.address)))
      .child(row().child(button)).child(label(&s.result,15.0,ink).role("status")).child(el().grow(1.0))
      .child(label("Early native connection check. Sign-in, project access, media editing and platform packages are not implemented yet.",14.0,muted))
}
fn setup(s: &mut State, waker: Waker) {
    s.waker = Some(waker);
}
fn poll(s: &mut State, _: f64, _: &mut Tx) -> bool {
    let result = s.receive.as_ref().and_then(|r| r.try_recv().ok());
    if let Some((address, result)) = result {
        s.receive = None;
        s.waiting = false;
        s.result = if s.address.text != address {
            "Address changed. Check the new address.".into()
        } else {
            match result {
                Ok(()) => format!(
                    "{address} advertises the required read-only PKCE endpoints. Sign-in is not available in this preview."
                ),
                Err(error) => error,
            }
        };
        return true;
    }
    false
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
