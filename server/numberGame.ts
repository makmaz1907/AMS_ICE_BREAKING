import crypto from "node:crypto";

export type NumberRound = {
  id: string;
  numbers: number[];
  target: number;
  description: string;
  endsAt: number;
  solution: string | null;
};

type Operation = "+" | "-" | "*" | "/";

type Node = { value: number; expression: string };

function pick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export function createNumberRound(durationSeconds = 90, targetOverride?: number | null, description = ""): NumberRound {
  const numbers = Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 9));
  numbers.push(pick([10, 25, 50, 75, 100]));
  const target = targetOverride && targetOverride >= 100 && targetOverride <= 999 ? targetOverride : 100 + Math.floor(Math.random() * 900);
  return { id: crypto.randomUUID(), numbers, target, description, endsAt: Date.now() + durationSeconds * 1000, solution: solveNumbers(numbers, target) };
}

function combine(left: Node, right: Node): Node[] {
  const results: Node[] = [
    { value: left.value + right.value, expression: `(${left.expression}+${right.expression})` },
    { value: left.value * right.value, expression: `(${left.expression}×${right.expression})` },
  ];
  if (left.value > right.value) results.push({ value: left.value - right.value, expression: `(${left.expression}-${right.expression})` });
  if (right.value > left.value) results.push({ value: right.value - left.value, expression: `(${right.expression}-${left.expression})` });
  if (right.value !== 0 && left.value % right.value === 0) results.push({ value: left.value / right.value, expression: `(${left.expression}÷${right.expression})` });
  if (left.value !== 0 && right.value % left.value === 0) results.push({ value: right.value / left.value, expression: `(${right.expression}÷${left.expression})` });
  return results;
}

export function solveNumbers(numbers: number[], target: number) {
  let best: Node | null = null;
  const search = (nodes: Node[]) => {
    for (const node of nodes) if (!best || Math.abs(node.value - target) < Math.abs(best.value - target)) best = node;
    if (best?.value === target || nodes.length < 2) return;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const rest = nodes.filter((_, index) => index !== leftIndex && index !== rightIndex);
        for (const next of combine(nodes[leftIndex], nodes[rightIndex])) search([...rest, next]);
        if (best?.value === target) return;
      }
    }
  };
  search(numbers.map((value) => ({ value, expression: String(value) })));
  return (best as Node | null)?.expression ?? null;
}

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

export function scoreNumber(value: number, target: number) {
  const difference = Math.abs(value - target);
  return difference === 0 ? 10 : difference <= 5 ? 7 : difference <= 10 ? 5 : 0;
}
