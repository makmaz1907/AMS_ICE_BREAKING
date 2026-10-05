import { useCallback, useEffect, useRef, useState } from "react";
import { subscribe } from "./realtime";
import type { ApiResult, GameState } from "./types";

export const emptyState: GameState = { gameId: "", version: -1, serverNow: 0, phase: "lobby", teams: [], round: null, submissions: [], matchRound: 0, totalRounds: 0, roundType: null, teamMode: "team", winner: null, numberSolution: null, themedWord: null, paused: false, remainingMs: null };

export async function post<T extends object = ApiResult>(path: string, body: object = {}, token?: string | null): Promise<T & ApiResult> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    return { ...(await response.json()), status: response.status };
  } catch {
    return { ok: false, message: "Sunucu yanıt vermedi." } as T & ApiResult;
  }
}

// Shared by both pages: keeps the latest /api/state, refetches when a newer version is announced, and closes the round at its deadline (there is no server timer on Vercel).
export function useGame() {
  const [state, setState] = useState<GameState>(emptyState);
  const [online, setOnline] = useState<boolean | null>(null);
  const latest = useRef(-1);
  const offset = useRef(0);
  const apply = useCallback((next: GameState) => {
    if (next.version < latest.current) return;
    latest.current = next.version;
    offset.current = next.serverNow - Date.now();
    setState(next);
  }, []);
  const refresh = useCallback(() => fetch("/api/state", { cache: "no-store" }).then((response) => response.json() as Promise<GameState>).then(apply).catch(() => setOnline(false)), [apply]);
  useEffect(() => {
    const unsubscribe = subscribe((version) => { if (version > latest.current) refresh(); }, (connected) => { setOnline(connected); if (connected) refresh(); });
    const poll = window.setInterval(refresh, 15_000);
    refresh();
    return () => { unsubscribe(); window.clearInterval(poll); };
  }, [refresh]);
  const active = state.phase === "word" || state.phase === "number";
  const endsAt = state.round?.endsAt;
  useEffect(() => {
    if (!active || state.paused || !endsAt) return;
    let cancelled = false;
    let timer = 0;
    // Retries every 2s in case this device's clock runs ahead of the server's.
    const fire = () => post<GameState>("/api/tick").then((next) => { if (cancelled) return; if ("phase" in next) apply(next); timer = window.setTimeout(fire, 2_000); });
    timer = window.setTimeout(fire, Math.max(0, endsAt - (Date.now() + offset.current) + 300));
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active, state.paused, endsAt, apply]);
  const serverNow = useCallback(() => Date.now() + offset.current, []);
  return { state, online, serverNow };
}

export function useRemainingSeconds(state: GameState, serverNow: () => number) {
  const [remaining, setRemaining] = useState(0);
  const endsAt = state.round?.endsAt;
  useEffect(() => {
    if (!endsAt) return;
    if (state.paused) { setRemaining(Math.ceil((state.remainingMs ?? 0) / 1000)); return; }
    const update = () => setRemaining(Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [endsAt, state.paused, state.remainingMs, serverNow]);
  return remaining;
}
