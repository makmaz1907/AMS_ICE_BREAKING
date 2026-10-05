export type WordRound = {
  id: string;
  letters: string[];
  jokerIndex: number;
  endsAt: number;
};

const vowels = ["A", "E", "I", "İ", "O", "Ö", "U", "Ü"];
const consonants = ["B", "C", "Ç", "D", "F", "G", "Ğ", "H", "J", "K", "L", "M", "N", "P", "R", "S", "Ş", "T", "V", "Y", "Z"];
const weightedVowels = ["A", "A", "A", "E", "E", "E", "E", "I", "I", "İ", "İ", "O", "Ö", "U", "Ü"];
const weightedConsonants = ["K", "L", "M", "N", "R", "S", "T", "Y", "D", "B", "Ç", "G", "H", "P", "Ş", "V", "Z", "C", "F", "Ğ", "J"];

function pick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export function normalizeTurkish(value: string) {
  return value.trim().toLocaleUpperCase("tr-TR");
}

function pickUnused(items: string[], used: Set<string>) {
  const choices = items.filter((letter) => !used.has(letter));
  return pick(choices);
}

export function createWordRound(durationSeconds = 60): WordRound {
  const letters: string[] = [];
  const used = new Set<string>();
  while (letters.length < 3) {
    const letter = pickUnused(weightedVowels, used);
    letters.push(letter);
    used.add(letter);
  }
  while (letters.length < 8) {
    const letter = pickUnused(weightedConsonants, used);
    letters.push(letter);
    used.add(letter);
  }
  for (let index = letters.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]];
  }
  return { id: crypto.randomUUID(), letters, jokerIndex: 8, endsAt: Date.now() + durationSeconds * 1000 };
}

function matchingLetterIndex(available: string[], letter: string) {
  const variants = letter === "I" || letter === "İ" ? ["I", "İ"] : letter === "O" || letter === "Ö" ? ["O", "Ö"] : letter === "U" || letter === "Ü" ? ["U", "Ü"] : letter === "G" || letter === "Ğ" ? ["G", "Ğ"] : letter === "C" || letter === "Ç" ? ["C", "Ç"] : [letter];
  return available.findIndex((candidate) => variants.includes(candidate));
}

// The joker is only used at the position the player explicitly marked; every other letter must come from the round.
export function canBuildWord(word: string, round: Pick<WordRound, "letters">, jokerIndex: number | null = null) {
  const letters = Array.from(normalizeTurkish(word));
  const jokerUsed = jokerIndex !== null;
  if (letters.length === 0 || letters.length > round.letters.length + 1 || !letters.every(isTurkishLetter)) {
    return { valid: false, jokerUsed };
  }
  if (jokerIndex !== null && (!Number.isInteger(jokerIndex) || jokerIndex < 0 || jokerIndex >= letters.length)) {
    return { valid: false, jokerUsed };
  }

  const available = [...round.letters];
  for (const [index, letter] of letters.entries()) {
    if (index === jokerIndex) continue;
    const match = matchingLetterIndex(available, letter);
    if (match < 0) return { valid: false, jokerUsed };
    available.splice(match, 1);
  }
  return { valid: true, jokerUsed };
}

export function scoreWord(word: string, dictionaryValid: boolean, jokerUsed: boolean) {
  const letters = Array.from(normalizeTurkish(word)).length;
  if (!dictionaryValid) return 0;
  return letters + (letters === 9 && !jokerUsed ? 5 : 0);
}

export function isTurkishLetter(value: string) {
  return [...vowels, ...consonants].includes(value);
}
