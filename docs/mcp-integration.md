# Media Studio MCP connection

Media Studio offers Streamable HTTP MCP at `/mcp`. Add that URL on your Studio's HTTPS origin to a compatible client. On the browser authorization screen, sign in, check the requesting client name, choose one project and review the requested permissions. Client-supplied names are not verified identities. Read access includes project records, saved asset metadata, jobs, prompts, private promo scripts and exports. Editing, generation and publication are separate scopes; authorize only the actions you need. **Publication scope grants standing authority to publish and withdraw during the connection, without separate Studio approval.** Generation scope requires you to enter a maximum estimated spend for that connection, enforced server-side. Revoke at `/mcp/connections`; access tokens expire after 30 minutes and require a fresh connection thereafter.

For a supported Codex CLI, substitute your own installation origin and run:

```sh
codex mcp add media-studio --url https://your-studio.example/mcp
codex mcp login media-studio --scopes studio.read
```

The add command may immediately start an OAuth flow requesting every advertised scope; cancel that flow if you want read-only access, then run the explicit login command above. The login opens the browser consent flow. Do not put access tokens or passphrases in a prompt, repository or shell command. Other clients need Streamable HTTP, OAuth authorization-code/PKCE support and a loopback redirect; their actual compatibility must be checked separately.

For read-only access explicitly request `studio.read`. When you need more, request only the additional scopes you intend to grant, for example `codex mcp login media-studio --scopes studio.read,studio.edit,studio.generate`. The browser lists the requested actions before consent. `studio.publish` is separate.

OpenCode V2 is also supported. Its remote MCP client requests the scope the server names when an unauthenticated request is rejected; on this Studio that default is `studio.read`. To edit, set the scope on the server entry in `opencode.jsonc` before signing in:

```jsonc
"media-studio": {
  "type": "remote",
  "url": "https://your-studio.example/mcp",
  "oauth": { "scope": "studio.read studio.edit" }
}
```

Then run `opencode mcp logout media-studio` and `opencode mcp auth media-studio`; the browser consent page lists the requested actions. Omit `studio.edit` when the agent only needs to inspect. Tested with OpenCode `2.2.7` against the deployed Studio: the client completed OAuth/PKCE, listed and read a saved song plan, and a separate read-only agent run returned the same project revision and scene direction without changing anything. OpenCode exposes the server's tools through Code Mode; grant only the scopes you intend to use.

The OAuth 2.1 authorization-code flow requires PKCE S256, a registered loopback HTTP callback, and the exact MCP resource URL. Only public clients are supported. The token and authorization code are random, stored as hashes, and bound to a client, project, resource and issuer. Codes are single-use. Studio checks the current Composer grant on each bridged-token request, including reads; a standalone owner connection uses its own Studio authority. Responses use no-store; credentials do not appear in the connection list. Agent credentials are separate from browser cookies, owner passphrases and provider keys. Registration rate limiting stores a keyed IP digest, not the address; the existing scheduler prunes expired rate limits, codes and tokens, and removes client registrations after 90 days of inactivity once no live code or token remains.

A workspace-wide Composer session can choose one Studio project for a connection; the resulting token is still restricted to that project. A project-scoped session can choose only its own project. Older workspace-wide sessions need to reopen Studio from Composer before starting a connection so their project scope can be verified. Studio rechecks the current Composer grant when consent is given, when a code is exchanged and when the token is used.

Read access includes private song-plan directions and captions; project exports contain those records and subject-reference history. `studio_diagnose_shot` answers why selected shots have no usable saved take and what a rerun would cost from the saved scene settings, job receipts and source hashes, and reports provider jobs that are waiting or never answered; it never calls a model or provider. `studio_apply_scene_proposal` accepts an optional `acceptSceneIds` list so a reviewer can approve some reviewed changes and decline others; the review digest still covers the whole previewed proposal and declined scenes keep their saved values. `studio_list_subjects` reads the latest saved subject versions in the granted project; `studio_get_subject_versions` reads one subject’s history and whether its reference remains available. Subject history is private context, not proof of a likeness or owner approval. The tools use the existing Studio API and records, never a second job or budget engine. They can inspect a project and its media, read media bytes in bounded base64 chunks, import eligible Share originals, edit project details and references, list or save project-private promo briefs and scene ideas with revision checks, save or update a storyboard, rename assets, and publish or withdraw under the granted scope. Before generation, Studio atomically reserves the estimated cost against the owner-set connection limit for the exact client request; retries with the same request ID and identical inputs do not consume that limit twice. Internal job IDs are namespaced per connection so a request cannot dispatch an unrelated existing project job. Failed or ambiguous requests retain the reservation. The existing project allowance and job idempotency checks remain separate and authoritative. Provider charges can differ from estimates. The client also receives an MCP elicitation showing the estimate, but a client can fabricate that response; it is not independent evidence of human approval. Clients without elicitation support fail before dispatch. An agent job read returns saved state without polling or advancing the job: advancing a multi-stage social render could otherwise submit a paid next stage. Media bytes remain in R2 and the MCP metadata export does not include them. The portable project bundle and its restore are owner/admin CLI and API operations, not MCP tools; see [portable project bundles](portable-project.md).

## Large originals: signed PUT handoff

JSON-RPC tool inputs and results are bounded, so a song or video of more than a few megabytes cannot be sent through a tool call. The supported large-file path is `studio_begin_asset_upload` (requires `studio.edit`); the agent then uploads the original bytes with an ordinary HTTP PUT. The bytes use the same MIME sniffing, per-kind limits, R2 key scheme, asset row and project scope as a Studio form upload, and are read back through the existing `studio_get_asset` or `studio_download_asset_chunk` tools. There is no second storage or new service.

```sh
# 1. Through MCP: begin one handoff. bytes is the exact file size and sha256 is
#    the exact file's 64-hex-character digest (for example `shasum -a 256`).
# studio_begin_asset_upload
#   { "projectId": "prj_…", "filename": "fictional-song.wav",
#     "contentType": "audio/wav", "bytes": 11230208, "sha256": "…" }
# -> { "uploadUrl": "https://your-studio.example/upload/assets/upl_…?p=…&e=…&s=…",
#      "expiresAt": 1760000000000, "maxBytes": 33554432, "method": "PUT",
#      "headers": { "content-type": "application/octet-stream" } }

# 2. Upload the exact original bytes once. Do not add form fields.
curl --fail-with-body -X PUT "$UPLOAD_URL" \
  -H 'content-type: application/octet-stream' \
  --data-binary @fictional-song.wav

# 3. Read the saved asset back through MCP.
# studio_get_asset { "assetId": "asset_…" }
```

The URL expires after ten minutes, is single-use, and is bound to the one project, agent connection, declared byte count and declared SHA-256. The URL contains no session cookie. A reused link returns `upload_link_used`, an expired link `upload_link_expired`, a changed project `upload_project_mismatch`, a changed signature `upload_link_invalid`, a body larger than declared `too_large`, a short body `size_mismatch`, bytes that do not match the hash `hash_mismatch` and a revoked or read-only connection `connection_revoked` or `forbidden`; none of these writes an asset row. Uploading the same hash again in the same project returns the existing asset with `reused: true` and status 200 instead of duplicating it; a new original returns 201. Audio and images are limited to 32 MiB and video to 64 MiB.

Honest limits: treat the returned URL as a secret until it expires; it grants exactly one upload into one project. This handoff supports ordinary originals only, not the local-render or footage-export receipt bindings, which continue to use their existing form upload. It is not resumable and has no multipart or chunked retry: begin a new link after a failure. The agent must be able to reach the Studio origin directly over HTTPS (a local Studio may use localhost HTTP). The JSON-RPC tools remain bounded by design; they are not a way to pass multi-megabyte media.

The local tests use the official MCP TypeScript SDK v2 and real in-process Streamable HTTP client: they exercise 2026 discovery, 2025 handshake compatibility, consent, PKCE, wrong-project and revoked grants, additive migration, publication, bounded media reads, and fictional provider generation with explicit elicitation. A local browser harness also connects the official SDK client to the local wrangler server over HTTPS, including consent, a scoped read token, revocation and read-back of the same song-plan revision. These tests are **not** evidence of a deployed client, Codex or OpenCode login, a real paid request, or customer acceptance. Bounded JSON-RPC media-byte input (the signed PUT handoff above is the supported large-file path), composition rendering, current provider compatibility, actual Codex/OpenCode workflows, and full production proof remain open in [Studio #11](https://github.com/loftwah/composer-media-studio/issues/11).

References: [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [TypeScript SDK web-standard serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard), [SDK protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions).
