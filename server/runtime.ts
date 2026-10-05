import { EventEmitter } from "node:events";
import { ablyConfigured, publishVersion } from "./ably.js";
import { createEngine } from "./engine.js";
import { createRedisStore, redisConfigured } from "./redisStore.js";
import { createMemoryStore } from "./store.js";

// Redis env vars present → shared Redis store (Vercel); otherwise the in-memory store (npm run dev). VERCEL_ENV keeps production and preview data and channels apart.
const environment = process.env.VERCEL_ENV ?? "dev";
const channel = `bkb-${environment}`;
if (process.env.VERCEL && !redisConfigured()) console.error("Redis ortam değişkenleri yok: bellek içi depo Vercel'de çalışmaz.");

// The dev server's SSE stream listens here; Ably carries the same version numbers on Vercel.
export const changes = new EventEmitter();
changes.setMaxListeners(0);

const store = redisConfigured() ? createRedisStore(process.env.BKB_KEY_PREFIX ?? `bkb:${environment}:`) : createMemoryStore();
const engine = createEngine(store, {
  publish: async (version) => {
    changes.emit("version", version);
    // A lost notification only delays clients until their next poll, so it must not fail the request.
    if (ablyConfigured()) await publishVersion(channel, version).catch((error) => console.error("Ably yayını başarısız:", error));
  },
});

export const runtime = { engine, channel, transport: ablyConfigured() ? "ably" as const : "sse" as const };
export type Runtime = typeof runtime;
