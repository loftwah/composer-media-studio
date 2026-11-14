# Media Studio native desktop preview

This is an early Rune desktop development slice, not an installable or complete Media Studio. Its connection check reads only the public OAuth discovery document of an owner-supplied HTTPS Studio origin. It sends no credentials, follows no redirects, caps metadata at 16 KiB and times out after eight seconds. It checks that authorization, token and registration endpoints stay on the chosen origin and advertise the Studio read scope and public-client S256 flow. Metadata matching is not proof of server trust or a successful sign-in.

```sh
cd native
cargo test --locked
cargo run --locked
cargo run --locked -- --check-origin https://your-studio.example
```

Rune is pinned to `ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c`, the revision used by Liferaft, with its required consumer patches. Rust is pinned in `rust-toolchain.toml`. The lockfile records the exact dependency graph. Rune is MIT licensed; dependency notices must be gathered before any package release.

An explicit read-only Connect action registers a public client, opens the system browser for project-scoped consent and uses PKCE S256 with a bounded loopback callback. It reads the selected project name through MCP. The bearer is held only in process memory until disconnect, expiry, origin change or exit; it is not written to disk. Disconnect clears this device’s session; revoke a server-side grant from Studio’s connection management if needed. Read scope can include project records, prompts, assets and exports. No generation, editing, publishing or spending is requested. The fictional local OAuth/MCP fixture is not proof of real browser consent, installed-app behavior, or platform acceptance. Studio-connected media playback, media editing and native packages are not provided by this slice. Studio offers short-lived access tokens and no refresh flow; this preview does not offer persistent sign-in. Upstream Rune's current native media backend supports macOS and Windows; Linux has an unsupported backend, so its audio/video path needs a real implementation and platform verification. See [Studio #3](https://github.com/loftwah/composer-media-studio/issues/3) for the remaining scope.

The current UI is hand-built with Rune primitives; adopting the requested rune-kit and Studio theme is still outstanding. Headless rendering and local tests are not installed-app, accessibility, audio or operating-system acceptance.

The development window can also review one explicitly dropped local MP4, MOV, M4V, MP3, M4A or WAV file (up to 256 MiB at selection), with playback, five-second seeks and close. The player shows elapsed time and, when Rune has loaded it, the source duration; an unknown duration is shown as `–:––`. Files are not uploaded or attached to a Studio project. Decode and audio support depend on the OS; unsupported or unreadable formats report a failure. This uses Rune's pinned native player on macOS/Windows; Linux explicitly reports that playback is not supported. No native package, audible playback, Finder drag/drop, Windows or Linux acceptance is implied by a headless test.

On the available locked macOS host, the headless unit runtime left an attempted missing-video playback in `Loading`; it did not demonstrate native failure reporting or elapsed-time updates. Those require a real application session. The local Rust toolchain also emitted a post-link `rust-objcopy`/`libLLVM.dylib` warning even though tests completed.
