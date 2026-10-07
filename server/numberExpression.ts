// Safe parser for number-round answers, shared by the server (scoring) and the phone (live intermediate result). Never replace it with eval.
// Each supplied number may be used at most once, division must be exact, and every intermediate result must be a positive integer.
export function evaluateNumberExpression(expression: string, availableNumbers: number[]) {
  const tokens = expression.match(/\d+|[()+\-*/×÷]/g);
  if (!tokens || tokens.join("") !== expression.replace(/\s/g, "").replace(/×/g, "×").replace(/÷/g, "÷")) return { valid: false, message: "Geçersiz ifade." };
  let position = 0;
  const used: number[] = [];
  const consumeNumber = () => {
    const value = Number(tokens[position]);
    if (!Number.isInteger(value)) throw new Error("Sayı bekleniyor.");
    const index = availableNumbers.findIndex((number, numberIndex) => number === value && !used.includes(numberIndex));
    if (index < 0) throw new Error("Her sayı en fazla bir kez kullanılabilir.");
    used.push(index);
    position += 1;
    return value;
  };
  const factor = (): number => {
    if (tokens[position] === "(") {
      position += 1;
      const value = sum();
      if (tokens[position] !== ")") throw new Error("Parantez kapanmadı.");
      position += 1;
      return value;
    }
    return consumeNumber();
  };
  const product = (): number => {
    let value = factor();
    while (["*", "/", "×", "÷"].includes(tokens[position])) {
      const operation = tokens[position++];
      const right = factor();
      if (operation === "*" || operation === "×") value *= right;
      else {
        if (right === 0 || value % right !== 0) throw new Error("Bölme tam sayı olmalı.");
        value /= right;
      }
      if (!Number.isInteger(value) || value <= 0) throw new Error("Ara sonuçlar pozitif tam sayı olmalı.");
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (["+", "-"].includes(tokens[position])) {
      const operation = tokens[position++];
      const right = product();
      value = operation === "+" ? value + right : value - right;
      if (!Number.isInteger(value) || value <= 0) throw new Error("Ara sonuçlar pozitif tam sayı olmalı.");
    }
    return value;
  };
  try {
    const value = sum();
    if (position !== tokens.length) throw new Error("Geçersiz ifade.");
    return { valid: true, value, usedNumbers: used.length };
  } catch (error) {
    return { valid: false, message: error instanceof Error ? error.message : "Geçersiz ifade." };
  }
}
