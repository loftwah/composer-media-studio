// MIT. Fakes for the Darkroom bindings: a real MediaOperationDO over in-memory
// SQLite, an Images binding that decodes nothing, and the retained-bytes bucket.
// The caller still supplies env.AI, so no test makes a provider call.

import { DatabaseSync } from "node:sqlite";
import { MediaOperationDO } from "@fungi.computer/darkroom/cloudflare";
import { FakeBucket } from "../harness.mjs";

/** One MediaOperationDO per operation name. */
function operations(env) {
  const instances = new Map();
  return {
    getByName(name) {
      if (!instances.has(name)) {
        const db = new DatabaseSync(":memory:");
        const kv = new Map();
        let ready = Promise.resolve();
        const ctx = {
          id: { name },
          blockConcurrencyWhile: (body) => { ready = body(); return ready; },
          storage: {
            sql: {
              exec(query, ...bindings) {
                const reads = /^\s*(select|pragma|with)/i.test(query);
                if (!reads && bindings.length === 0) { db.exec(query); return { toArray: () => [] }; }
                const rows = db.prepare(query).all(...bindings);
                return { toArray: () => rows };
              },
            },
            transactionSync: (body) => body(),
            get: async (key) => kv.get(key),
            put: async (key, value) => { kv.set(key, value); },
            list: async () => new Map(kv),
            deleteAlarm: async () => {},
            deleteAll: async () => {
              kv.clear();
              for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) db.exec(`DROP TABLE ${name}`);
            },
            getAlarm: async () => null,
            setAlarm: async () => {},
          },
        };
        const object = new MediaOperationDO(ctx, env);
        // A Durable Object finishes its constructor's blockConcurrencyWhile before any call.
        instances.set(name, new Proxy(object, {
          get: (target, property) => typeof target[property] === "function"
            ? async (...input) => { await ready; return target[property](...input); }
            : target[property],
        }));
      }
      return instances.get(name);
    },
  };
}

/** Add APP_ARTIFACTS, IMAGES and MEDIA_OPERATION to a harness env. */
export function withDarkroom(env) {
  env.darkroom = { imageReads: 0 };
  env.APP_ARTIFACTS = new FakeBucket();
  env.IMAGES = {
    async info(stream) {
      await new Response(stream).arrayBuffer();
      env.darkroom.imageReads += 1;
      return { format: "image/png", width: 512, height: 512 };
    },
    input() { throw new Error("A 512 pixel reference needs no resize"); },
  };
  env.MEDIA_OPERATION = operations(env);
  return env;
}
