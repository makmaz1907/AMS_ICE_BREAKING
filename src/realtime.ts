// Change notifications carry only a version number; the page then refetches /api/state. Locally this is the dev server's SSE stream; step 3c adds Ably for Vercel.
export function subscribe(onVersion: (version: number) => void, onStatus: (online: boolean) => void) {
  const source = new EventSource("/api/events");
  source.onopen = () => onStatus(true);
  source.onerror = () => onStatus(false);
  source.onmessage = (event) => { const { version } = JSON.parse(event.data) as { version: number }; onVersion(version); };
  return () => source.close();
}
