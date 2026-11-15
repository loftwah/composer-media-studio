// MIT. Node has no `cloudflare:workers`. Darkroom's Durable Object class extends
// it, so give the tests the one class they need. Loaded with `node --import`.

import { registerHooks } from "node:module";

const source = "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }";
const url = `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return { url, shortCircuit: true };
    return next(specifier, context);
  },
});
