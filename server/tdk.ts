import { normalizeTurkish } from "./wordGame.js";

type TdkEntry = { madde?: string; anlamlarListe?: Array<{ anlam?: string }> };
export type TdkLookup = { valid: boolean; meanings: string[] };
export type TdkCache = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };

const BATCH_SIZE = 5, HEDGE_MS = 3_000, MAX_ATTEMPTS = 3, SLOW_MS = 2_000;

export function wordVariants(word: string) {
  const alternatives: Record<string, string[]> = { I: ["I", "İ"], İ: ["I", "İ"], O: ["O", "Ö"], Ö: ["O", "Ö"], U: ["U", "Ü"], Ü: ["U", "Ü"], G: ["G", "Ğ"], Ğ: ["G", "Ğ"], C: ["C", "Ç"], Ç: ["C", "Ç"] };
  return Array.from(word).reduce<string[]>((variants, letter) => variants.flatMap((variant) => (alternatives[letter] ?? [letter]).map((replacement) => `${variant}${replacement}`)), [""]);
}

export function tdkUrl(word: string) {
  return `https://sozluk.gov.tr/gts?${new URLSearchParams({ ara: word.toLocaleLowerCase("tr-TR") })}`;
}

function meaningsFor(entry: TdkEntry) {
  return (entry.anlamlarListe ?? []).map((meaning) => meaning.anlam?.replace(/<[^>]*>/g, "").trim() ?? "").filter(Boolean);
}

const clip = (text: string) => text.slice(0, 80).replace(/\s+/g, " ");

// One request to TDK. Never throws: a failure comes back as a short reason for the log.
async function requestVariant(variant: string, signal: AbortSignal): Promise<{ lookup: TdkLookup } | { reason: string }> {
  try {
    const response = await fetch(tdkUrl(variant), { signal });
    const body = await response.text();
    if (!response.ok) return { reason: `HTTP ${response.status} ${clip(body)}` };
    let results: TdkEntry[] | { error?: string };
    try { results = JSON.parse(body); } catch { return { reason: `JSON değil: ${clip(body)}` }; }
    const entry = Array.isArray(results) ? results.find((result) => normalizeTurkish(result.madde ?? "") === variant) : undefined;
    return { lookup: entry ? { valid: true, meanings: meaningsFor(entry) } : { valid: false, meanings: [] } };
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${(error.cause as Error & { code?: string }).code ?? error.cause.message})` : "";
    return { reason: signal.aborted ? "zaman aşımı" : `ağ hatası: ${error instanceof Error ? error.message : String(error)}${cause}` };
  }
}

// TDK sometimes leaves a request unanswered for 10s while the same question asked again is answered at once.
// So when an attempt is silent for HEDGE_MS (or fails), the same request is sent again; the first answer wins and the others are cancelled.
// Logs one "[tdk]" line when the lookup fails, and one when it succeeds but slowly or only on a later attempt, so `vercel logs` shows how TDK behaves.
async function lookupVariant(variant: string, signal: AbortSignal): Promise<TdkLookup | null> {
  const started = Date.now(), attempts: AbortController[] = [], reasons: string[] = [];
  const log = (text: string) => console.warn(`[tdk] ${variant}: ${text} (${Date.now() - started} ms)`);
  return new Promise((resolve) => {
    let done = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: TdkLookup | null) => {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener("abort", onAbort); attempts.forEach((attempt) => attempt.abort());
      if (!result) log(`${signal.aborted ? "zaman aşımı" : "başarısız"}, ${attempts.length} deneme${reasons.length ? ` [${reasons.join("; ")}]` : ""}`);
      resolve(result);
    };
    const onAbort = () => finish(null);
    const start = () => {
      if (done) return;
      if (signal.aborted) return finish(null);
      const controller = new AbortController(), attempt = attempts.push(controller);
      clearTimeout(timer);
      if (attempt < MAX_ATTEMPTS) timer = setTimeout(start, HEDGE_MS);
      void requestVariant(variant, AbortSignal.any([signal, controller.signal])).then((outcome) => {
        if (done) return;
        if ("lookup" in outcome) {
          if (attempt > 1 || Date.now() - started > SLOW_MS) log(`${Date.now() - started > SLOW_MS ? "yavaş yanıt" : "yanıt"}, ${attempt}. denemeden, toplam ${attempts.length} deneme`);
          return finish(outcome.lookup);
        }
        reasons.push(`${attempt}. ${outcome.reason}`);
        if (reasons.length === MAX_ATTEMPTS) finish(null);
        else if (reasons.length === attempts.length) start();
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    start();
  });
}

// Returns null when TDK can't be reached, so callers can tell "not a word" apart from "lookup failed".
// The spelling the player typed is asked first, the other I/İ, O/Ö, U/Ü, G/Ğ, C/Ç spellings follow in parallel batches, all within 10s (TDK often takes over 5s to answer from Vercel).
// Every spelling TDK answered is kept in `cache` (one record per variant set), so a retry after a timeout resumes where the last one stopped.
export async function lookupTdk(word: string, cache?: TdkCache): Promise<TdkLookup | null> {
  const variants = wordVariants(word);
  const cacheKey = `tdk-variants:${variants[0]}`;
  const known: Record<string, TdkLookup> = await cache?.get(cacheKey).then((value) => value ? JSON.parse(value) : {}).catch(() => ({})) ?? {};
  const order = [word, ...variants.filter((variant) => variant !== word && !known[variant])];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let learned = false, failed = false;
  try {
    if (known[word]?.valid) return known[word];
    const found = variants.find((variant) => known[variant]?.valid);
    if (found) return known[found];
    for (const batch of [known[word] ? [] : [word], ...Array.from({ length: Math.ceil((order.length - 1) / BATCH_SIZE) }, (_, index) => order.slice(1 + index * BATCH_SIZE, 1 + (index + 1) * BATCH_SIZE))]) {
      if (controller.signal.aborted) { failed = true; break; }
      const results = await Promise.all(batch.map((variant) => lookupVariant(variant, controller.signal)));
      batch.forEach((variant, index) => { const result = results[index]; if (result) { known[variant] = result; learned = true; } else failed = true; });
      const hit = batch.find((variant) => known[variant]?.valid);
      if (hit) return known[hit];
    }
    return failed ? null : { valid: false, meanings: [] };
  } finally {
    clearTimeout(timeout);
    if (learned) await cache?.set(cacheKey, JSON.stringify(known)).catch(() => undefined);
  }
}
