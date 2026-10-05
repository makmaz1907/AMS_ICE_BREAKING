import { lookupTdk, tdkUrl } from "../server/tdk.js";
import { normalizeTurkish } from "../server/wordGame.js";

// Single catch-all function: Vercel Hobby allows at most 12 functions per deployment, so every /api route is dispatched here.
const routes: Record<string, (request: Request) => Promise<Response>> = {
  health: async () => Response.json({ ok: true, region: process.env.VERCEL_REGION ?? "local" }),
  // Temporary (step 3a): checks whether TDK answers from this region. Remove before the real deployment.
  "tdk-check": async (request) => {
    const word = normalizeTurkish(new URL(request.url).searchParams.get("word") ?? "KALEM").slice(0, 16);
    const started = Date.now();
    const raw = await fetch(tdkUrl(word), { signal: AbortSignal.timeout(5_000) })
      .then(async (response) => ({ status: response.status, contentType: response.headers.get("content-type"), body: (await response.text()).slice(0, 300) }))
      .catch((error: Error) => ({ error: `${error.name}: ${error.message}` }));
    const rawMs = Date.now() - started;
    const lookup = await lookupTdk(word);
    return Response.json({ region: process.env.VERCEL_REGION ?? "local", word, rawMs, raw, lookup, totalMs: Date.now() - started });
  },
};

async function handle(request: Request) {
  const route = new URL(request.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const handler = routes[route];
  return handler ? handler(request) : Response.json({ ok: false, message: "Bulunamadı." }, { status: 404 });
}

export const GET = handle;
export const POST = handle;
