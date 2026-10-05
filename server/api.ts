import { isHostToken } from "./auth.js";
import type { Engine } from "./engine.js";
import { lookupTdk, tdkUrl } from "./tdk.js";
import { normalizeTurkish } from "./wordGame.js";

type Body = Record<string, unknown>;
type Route = (context: { request: Request; body: Body; engine: Engine }) => Promise<Response>;

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const bearer = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
const clientAddress = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";

const routes: Record<string, Route> = {
  "GET health": async () => json({ ok: true, region: process.env.VERCEL_REGION ?? "local" }),
  "GET state": async ({ engine }) => json(await engine.state()),
  "POST tick": async ({ engine }) => { await engine.tick(); return json(await engine.state()); },
  "POST join": async ({ engine, body }) => json(await engine.join(body.name, body.token)),
  "POST submit": async ({ engine, body }) => json(await engine.submit(body.token, body.answer, body.jokerIndex)),
  "POST host/login": async ({ engine, body, request }) => json(await engine.hostLogin(body.pin, clientAddress(request))),
  "POST host/command": async ({ engine, body, request }) => isHostToken(bearer(request)) ? json(await engine.command(body.action, body.seconds)) : json({ ok: false, message: "Host oturumu geçersiz. PIN'i yeniden girin." }, 401),
  "GET results.json": async ({ engine }) => json(await engine.results()),
  "GET results.csv": async ({ engine }) => {
    const { teams } = await engine.results();
    const rows = ["Sıra,Takım,Puan", ...teams.map((team, index) => `${index + 1},"${team.name.replaceAll('"', '""')}",${team.score}`)];
    return new Response(`﻿${rows.join("\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="bir-kelime-bir-islem-sonuclari.csv"', "Cache-Control": "no-store" } });
  },
  // Temporary (step 3a): checks whether TDK answers from this region. Remove before the real deployment.
  "GET tdk-check": async ({ request }) => {
    const word = normalizeTurkish(new URL(request.url).searchParams.get("word") ?? "KALEM").slice(0, 16);
    const started = Date.now();
    const raw = await fetch(tdkUrl(word), { signal: AbortSignal.timeout(5_000) })
      .then(async (response) => ({ status: response.status, contentType: response.headers.get("content-type"), body: (await response.text()).slice(0, 300) }))
      .catch((error: Error) => ({ error: `${error.name}: ${error.message}` }));
    const rawMs = Date.now() - started;
    const lookup = await lookupTdk(word);
    return json({ region: process.env.VERCEL_REGION ?? "local", word, rawMs, raw, lookup, totalMs: Date.now() - started });
  },
};

// Every /api request, on Vercel and in local dev, goes through here.
export async function handleApi(request: Request, engine: Engine) {
  const path = new URL(request.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const route = routes[`${request.method} ${path}`];
  if (!route) return json({ ok: false, message: "Bulunamadı." }, 404);
  try {
    const parsed: unknown = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Body : {};
    return await route({ request, body, engine });
  } catch (error) {
    console.error(error);
    return json({ ok: false, message: "Sunucu hatası. Lütfen tekrar deneyin." }, 500);
  }
}
