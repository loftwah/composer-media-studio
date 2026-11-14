# Media Studio native connection probe

This is an early Rune desktop development slice, not an installable or complete Media Studio. It checks only the public OAuth discovery document of an owner-supplied HTTPS Studio origin. It sends no credentials, follows no redirects, caps metadata at 16 KiB and times out after eight seconds. It checks that authorization, token and registration endpoints stay on the chosen origin and advertise the Studio read scope and public-client S256 flow. Metadata matching is not proof of server trust or a successful sign-in.

```sh
cd native
cargo test --locked
cargo run --locked
cargo run --locked -- --check-origin https://your-studio.example
```

Rune is pinned to `ea6ddf8f2c3cd476a3797caad7d77cbe04641d9c`, the revision used by Liferaft, with its required consumer patches. Rust is pinned in `rust-toolchain.toml`. The lockfile records the exact dependency graph. Rune is MIT licensed; dependency notices must be gathered before any package release.

No authorization code, token storage, project browsing, media editing, native package, playback or platform acceptance is provided by this slice. Studio currently offers short-lived access tokens and no refresh flow; an eventual desktop client must not promise persistent sign-in without a shared server contract. Upstream Rune's current native media backend supports macOS and Windows; Linux has an unsupported backend, so its audio/video path needs a real implementation and platform verification. See [Studio #3](https://github.com/loftwah/composer-media-studio/issues/3) for the remaining scope.

The current UI is hand-built with Rune primitives; adopting the requested rune-kit and Studio theme is still outstanding. Headless rendering and local tests are not installed-app, accessibility, audio or operating-system acceptance.
