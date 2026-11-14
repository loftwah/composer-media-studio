// MIT. Focused checks for the Composer handoff and per-action studio session.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  allowedActions,
  claimHandoff,
  createSession,
  readBridgeToken,
  readSession,
  requireSession,
  verifyComposerGrant,
} from "../src/lib/auth.mjs";
import { setup } from "./harness.mjs";
import worker from "../src/worker.mjs";

const env = {
  SESSION_SECRET: "test-session-secret-that-is-long-enough",
  BRIDGE_SECRET: "test-bridge-secret-that-is-also-long-enough",
  COMPOSER_ORIGIN: "https://composer.test",
};

function encode(value) {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function bridge(claim) {
  const payload = encode(claim);
  return `${payload}.${await sign(env.BRIDGE_SECRET, payload)}`;
}

function requestWith(token) {
  return new Request("https://studio.test/api/state", {
    headers: { cookie: `studio_session=${token}` },
  });
}

test("a bridge token carries the actor, workspace, project and actions", async () => {
  const token = await bridge({
    aud: "media-studio",
    sub: "acct-123",
    actorName: "A Person",
    workspace: "ws-personal",
    workspaceName: "Personal",
    project: "prj_abc123",
    actions: ["read", "generate"],
    revision: 4,
    exp: Date.now() + 60_000,
  });
  const claim = await readBridgeToken(env, token);
  assert.equal(claim.actor, "acct-123");
  assert.equal(claim.workspace, "ws-personal");
  assert.equal(claim.project, "prj_abc123");
  assert.deepEqual(claim.actions, ["read", "generate"]);
  assert.equal(claim.revision, 4);
});

test("handoff admits only explicit null or valid project scope", async () => {
  const fixture=await setup(); const runtime={...fixture.env,BRIDGE_SECRET:env.BRIDGE_SECRET,COMPOSER_ORIGIN:env.COMPOSER_ORIGIN};
  const base={aud:'media-studio',sub:'acct-123',workspace:'ws-personal',actions:['read'],exp:Date.now()+60_000};
  for (const project of [undefined,42,{},'', 'not/a/project']) {
    const claim={...base,jti:crypto.randomUUID()}; if(project !== undefined) claim.project=project;
    const token=await bridge(claim);
    assert.equal(await readBridgeToken(runtime,token),null);
    const response=await worker.fetch(new Request('https://studio.test/api/bridge',{method:'POST',headers:{'content-type':'application/json',origin:'https://studio.test'},body:JSON.stringify({token})}),runtime);
    assert.equal(response.status,401);
  }
  const token=await bridge({...base,project:null,jti:crypto.randomUUID()});
  const response=await worker.fetch(new Request('https://studio.test/api/bridge',{method:'POST',headers:{'content-type':'application/json',origin:'https://studio.test'},body:JSON.stringify({token})}),runtime);
  assert.equal(response.status,200);
  const session=await readSession(runtime,new Request('https://studio.test/api/state',{headers:{cookie:response.headers.get('set-cookie')}}));
  assert.equal(session.project,null); assert.equal(session.projectClaimExplicit,true);
});

test("a tampered or expired bridge token is refused", async () => {
  const token = await bridge({
    aud: "media-studio",
    sub: "acct-123",
    workspace: "ws-personal",
    actions: ["read"],
    exp: Date.now() + 60_000,
  });
  const changed = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
  assert.equal(await readBridgeToken(env, changed), null);
  const expired = await bridge({
    aud: "media-studio",
    sub: "acct-123",
    workspace: "ws-personal",
    actions: ["read"],
    exp: Date.now() - 1000,
  });
  assert.equal(await readBridgeToken(env, expired), null);
  const wrongAudience = await bridge({
    aud: "something-else",
    sub: "acct-123",
    workspace: "ws-personal",
    actions: ["read"],
    exp: Date.now() + 60_000,
  });
  assert.equal(await readBridgeToken(env, wrongAudience), null);
});

test("a session only exposes its granted actions", async () => {
  const token = await createSession(env, {
    mode: "bridge",
    actor: "acct-123",
    workspace: "ws-personal",
    project: "prj_abc123",
    actions: ["read", "generate"],
    revision: 2,
  });
  const session = await readSession(env, requestWith(token));
  assert.deepEqual(allowedActions(session), ["read", "generate"]);
  await assert.rejects(() => requireSession(env, requestWith(token), "publish"), /publish permission/);
  await assert.rejects(() => requireSession(env, requestWith(token), "edit"), /edit permission/);
});

test("an owner session keeps the full action set", async () => {
  const token = await createSession(env, { mode: "owner", actor: "owner" });
  const session = await readSession(env, requestWith(token));
  assert.equal(session.mode, "owner");
  assert.deepEqual(allowedActions(session), ["read", "edit", "generate", "publish", "admin"]);
});

test("a handoff can only be consumed once", async () => {
  const { env: base } = await setup();
  const runtime = {
    ...base,
    BRIDGE_SECRET: "test-bridge-secret-that-is-also-long-enough",
    COMPOSER_ORIGIN: "https://composer.test",
  };
  const token = await bridge({
    aud: "media-studio",
    sub: "acct-123",
    workspace: "ws-personal",
    actions: ["read"],
    jti: "handoff-one",
    project: null,
    exp: Date.now() + 60_000,
  });
  const claim = await readBridgeToken(runtime, token);
  assert.equal(await claimHandoff(runtime, claim), true);
  assert.equal(await claimHandoff(runtime, claim), false);
});

test("a current grant with no generate action stops the privileged check", async () => {
  const { env: base } = await setup();
  const runtime = {
    ...base,
    BRIDGE_SECRET: "test-bridge-secret-that-is-also-long-enough",
    COMPOSER_ORIGIN: "https://composer.test",
  };
  const session = {
    mode: "bridge",
    actor: "acct-123",
    workspace: "ws-personal",
    project: null,
    actions: ["read", "generate"],
    revision: 2,
  };
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          actor: "acct-123",
          workspace: "ws-personal",
          actions: ["read"],
          revision: 3,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    await assert.rejects(() => verifyComposerGrant(runtime, session, "generate"), /no longer includes generate/);

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          actor: "acct-123",
          workspace: "ws-personal",
          actions: ["read", "generate"],
          revision: 3,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    assert.equal(await verifyComposerGrant(runtime, session, "generate"), true);

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          actor: "a-different-account",
          workspace: "ws-personal",
          actions: ["read", "generate"],
          revision: 4,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    await assert.rejects(() => verifyComposerGrant(runtime, session, "generate"), /account or workspace changed/);

    globalThis.fetch = async () => {
      throw new Error("composer down");
    };
    await assert.rejects(() => verifyComposerGrant(runtime, session, "generate"), /could not confirm/);
  } finally {
    globalThis.fetch = original;
  }
});
