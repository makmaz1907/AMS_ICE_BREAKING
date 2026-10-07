// Change notifications carry only a version number and a scope ("host" changes don't concern phones); the page then refetches /api/state. On Vercel they come over Ably, locally over the dev server's SSE stream.
type Transport = { transport: "ably" | "sse"; channel: string };
type Change = { version: number; scope?: "all" | "host" };
type OnChange = (version: number, scope: "all" | "host") => void;

async function subscribeAbly(channel: string, onVersion: OnChange, onStatus: (online: boolean) => void) {
  const Ably = await import("ably");
  const realtime = new Ably.Realtime({ authUrl: "/api/ably-token" });
  realtime.connection.on((change) => onStatus(change.current === "connected"));
  await realtime.channels.get(channel).subscribe("version", (message) => { const change = message.data as Change; onVersion(change.version, change.scope ?? "all"); });
  return () => realtime.close();
}

function subscribeSse(onVersion: OnChange, onStatus: (online: boolean) => void) {
  const source = new EventSource("/api/events");
  source.onopen = () => onStatus(true);
  source.onerror = () => onStatus(false);
  source.onmessage = (event) => { const change = JSON.parse(event.data) as Change; onVersion(change.version, change.scope ?? "all"); };
  return () => source.close();
}

export function subscribe(onVersion: OnChange, onStatus: (online: boolean) => void) {
  let closed = false;
  let close = () => {};
  fetch("/api/realtime").then((response) => response.json() as Promise<Transport>)
    .then(({ transport, channel }) => transport === "ably" ? subscribeAbly(channel, onVersion, onStatus) : subscribeSse(onVersion, onStatus))
    .then((unsubscribe) => { if (closed) unsubscribe(); else close = unsubscribe; })
    .catch(() => onStatus(false));
  return () => { closed = true; close(); };
}
