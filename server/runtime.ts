import { EventEmitter } from "node:events";
import { createEngine } from "./engine.js";
import { createMemoryStore } from "./store.js";

// Step 3b: in-memory store, with change notifications fanned out to the dev server's SSE clients. Step 3c adds Redis + Ably for Vercel.
export const changes = new EventEmitter();
changes.setMaxListeners(0);

export const engine = createEngine(createMemoryStore(), { publish: async (version) => { changes.emit("version", version); } });
