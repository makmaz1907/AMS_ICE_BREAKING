import http from "node:http";
import os from "node:os";
import { handleApi } from "./api.js";
import { hostPin } from "./auth.js";
import { changes, runtime } from "./runtime.js";

// Local stand-in for Vercel: serves the same /api routes, plus two dev-only ones: /api/events (SSE in place of Ably) and /api/join-url (LAN address for the QR code).
const port = Number(process.env.PORT ?? 3000);

function lanAddress() {
  const addresses = Object.values(os.networkInterfaces()).flat().filter((address): address is os.NetworkInterfaceInfo => Boolean(address));
  return addresses.find((address) => address.family === "IPv4" && !address.internal)?.address ?? "localhost";
}

function events(response: http.ServerResponse) {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  response.write(": connected\n\n");
  const send = (version: number) => response.write(`data: ${JSON.stringify({ version })}\n\n`);
  const heartbeat = setInterval(() => response.write(": ping\n\n"), 25_000);
  changes.on("version", send);
  response.on("close", () => { clearInterval(heartbeat); changes.off("version", send); });
}

async function readBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 64 * 1024) throw new Error("İstek çok büyük."); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/api/events") return events(response);
    if (url.pathname === "/api/join-url") { const candidate = Number(url.searchParams.get("port")); const joinPort = Number.isInteger(candidate) && candidate > 0 && candidate <= 65_535 ? candidate : port; response.writeHead(200, { "Content-Type": "application/json" }); return response.end(JSON.stringify({ url: `http://${lanAddress()}:${joinPort}/join` })); }
    const headers = new Headers(Object.entries(request.headers).flatMap(([name, value]) => value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]]));
    if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", request.socket.remoteAddress ?? "local");
    const body = request.method === "POST" ? await readBody(request) : undefined;
    const result = await handleApi(new Request(url, { method: request.method, headers, body }), runtime);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, message: "Sunucu hatası." }));
  }
}).listen(port, "0.0.0.0", () => { console.log(`API sunucusu: http://localhost:${port} (bellek içi mod)`); console.log(`Host ekranı: http://localhost:5173/host`); console.log(`Katılım URL'si: http://${lanAddress()}:5173/join`); console.log(`Host PIN'i: ${hostPin}`); });
