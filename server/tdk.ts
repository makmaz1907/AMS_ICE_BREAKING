import { normalizeTurkish } from "./wordGame.js";

type TdkEntry = { madde?: string; anlamlarListe?: Array<{ anlam?: string }> };
export type TdkLookup = { valid: boolean; meanings: string[] };

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

// Returns null when TDK can't be reached, so callers can tell "not a word" apart from "lookup failed".
export async function lookupTdk(word: string): Promise<TdkLookup | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    for (const variant of wordVariants(word)) {
      const response = await fetch(tdkUrl(variant), { signal: controller.signal });
      if (!response.ok) return null;
      const results = await response.json() as TdkEntry[] | { error?: string };
      if (!Array.isArray(results)) continue;
      const entry = results.find((result) => normalizeTurkish(result.madde ?? "") === variant);
      if (entry) return { valid: true, meanings: meaningsFor(entry) };
    }
    return { valid: false, meanings: [] };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
