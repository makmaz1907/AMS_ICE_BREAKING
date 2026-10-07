import { subscriberTokenRequest } from "./ably.js";
import { isHostToken } from "./auth.js";
import type { Runtime } from "./runtime.js";

type Body = Record<string, unknown>;
type Route = (context: { request: Request; body: Body } & Runtime) => Promise<Response>;

const json = (data: unknown, status = 200, cacheControl = "no-store") => Response.json(data, { status, headers: { "Cache-Control": cacheControl } });
const bearer = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
const unauthorized = () => json({ ok: false, message: "Host oturumu geçersiz. PIN'i yeniden girin." }, 401);
const clientAddress = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";

const routes: Record<string, Route> = {
  "GET health": async () => json({ ok: true, region: process.env.VERCEL_REGION ?? "local" }),
  // Clients fetch ?v=<announced version> after a notification, so all phones asking for the same version share one CDN-cached response.
  // Without ?v (first load, polling) the response is fresh, and only those responses are used to correct the client's clock.
  "GET state": async ({ engine, request }) => json(await engine.state(), 200, new URL(request.url).searchParams.has("v") ? "public, max-age=0, s-maxage=30" : "no-store"),
  "GET realtime": async ({ transport, channel }) => json({ transport, channel }),
  "GET ably-token": async ({ transport, channel }) => transport === "ably" ? json(await subscriberTokenRequest(channel)) : json({ ok: false, message: "Ably yapılandırılmamış." }, 404),
  "POST tick": async ({ engine }) => { await engine.tick(); return json(await engine.state()); },
  "POST join": async ({ engine, body }) => json(await engine.join(body.name, body.token, body.rejoin === true)),
  "POST submit": async ({ engine, body }) => json(await engine.submit(body.token, body.answer, body.jokerIndex)),
  "POST host-login": async ({ engine, body, request }) => json(await engine.hostLogin(body.pin, clientAddress(request))),
  "POST host-command": async ({ engine, body, request }) => isHostToken(bearer(request)) ? json(await engine.command(body.action, body)) : unauthorized(),
  "GET host-state": async ({ engine, request }) => isHostToken(bearer(request)) ? json(await engine.hostState()) : unauthorized(),
  "GET results.json": async ({ engine }) => json(await engine.results()),
  "GET results.csv": async ({ engine }) => {
    const { teams } = await engine.results();
    const rows = ["Sıra,Ad,Puan", ...teams.map((team, index) => `${index + 1},"${team.name.replaceAll('"', '""')}",${team.score}`)];
    return new Response(`﻿${rows.join("\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="bir-kelime-bir-islem-sonuclari.csv"', "Cache-Control": "no-store" } });
  },
};

// Every /api request, on Vercel and in local dev, goes through here. Keep route names to one path segment: nested paths like /api/a/b never reach the api/[...path].ts function on Vercel.
export async function handleApi(request: Request, runtime: Runtime) {
  const path = new URL(request.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const route = routes[`${request.method} ${path}`];
  if (!route) return json({ ok: false, message: "Bulunamadı." }, 404);
  try {
    const parsed: unknown = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Body : {};
    return await route({ request, body, ...runtime });
  } catch (error) {
    console.error(error);
    return json({ ok: false, message: "Sunucu hatası. Lütfen tekrar deneyin." }, 500);
  }
}
