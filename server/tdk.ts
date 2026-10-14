import { normalizeTurkish } from "./wordGame.js";

type TdkEntry = { madde?: string; anlamlarListe?: Array<{ anlam?: string }> };
export type TdkLookup = { valid: boolean; meanings: string[] };
export type TdkCache = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };

const BATCH_SIZE = 5;

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

// Every failed request writes one "[tdk]" line to the function log, so the cause (timeout, HTTP status, network error, non-JSON body) shows up in `vercel logs`.
async function lookupVariant(variant: string, signal: AbortSignal): Promise<TdkLookup | null> {
  const started = Date.now();
  const fail = (reason: string) => { console.warn(`[tdk] ${variant}: ${reason} (${Date.now() - started} ms)`); return null; };
  try {
    const response = await fetch(tdkUrl(variant), { signal });
    const body = await response.text();
    if (!response.ok) return fail(`HTTP ${response.status} ${body.slice(0, 80).replace(/\s+/g, " ")}`);
    let results: TdkEntry[] | { error?: string };
    try { results = JSON.parse(body); } catch { return fail(`JSON değil: ${body.slice(0, 80).replace(/\s+/g, " ")}`); }
    const entry = Array.isArray(results) ? results.find((result) => normalizeTurkish(result.madde ?? "") === variant) : undefined;
    return entry ? { valid: true, meanings: meaningsFor(entry) } : { valid: false, meanings: [] };
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${(error.cause as Error & { code?: string }).code ?? error.cause.message})` : "";
    return fail(signal.aborted ? "zaman aşımı" : `ağ hatası: ${error instanceof Error ? error.message : String(error)}${cause}`);
  }
}

// Returns null when TDK can't be reached, so callers can tell "not a word" apart from "lookup failed".
// The spelling the player typed is asked first, the other I/İ, O/Ö, U/Ü, G/Ğ, C/Ç spellings follow in parallel batches.
// Every spelling TDK answered is kept in `cache` (one record per variant set), so a retry after a timeout resumes where the last one stopped.
export async function lookupTdk(word: string, cache?: TdkCache): Promise<TdkLookup | null> {
  const variants = wordVariants(word);
  const cacheKey = `tdk-variants:${variants[0]}`;
  const known: Record<string, TdkLookup> = await cache?.get(cacheKey).then((value) => value ? JSON.parse(value) : {}).catch(() => ({})) ?? {};
  const order = [word, ...variants.filter((variant) => variant !== word && !known[variant])];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
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
