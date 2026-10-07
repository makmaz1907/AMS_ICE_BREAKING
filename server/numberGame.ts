import crypto from "node:crypto";
import { evaluateNumberExpression } from "./numberExpression.js";

// The parser lives in its own file (no Node imports) so the phone can show live intermediate results with the same rules.
export { evaluateNumberExpression };

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


// Scores a number round from each team's closest answer, once the round has closed.
// If anyone hit the target exactly, they get 10 and everyone else 0. Otherwise teams are ranked by distance and get N, N-1, … 1,
// where N is the number of teams with a valid answer; equal distances share a place (N minus the number of teams strictly closer).
export function scoreNumberRound(best: Array<{ teamId: string; value: number }>, target: number) {
  const distances = best.map((entry) => ({ teamId: entry.teamId, distance: Math.abs(entry.value - target) }));
  if (distances.some((entry) => entry.distance === 0)) return new Map(distances.map((entry) => [entry.teamId, entry.distance === 0 ? 10 : 0]));
  return new Map(distances.map((entry) => [entry.teamId, distances.length - distances.filter((other) => other.distance < entry.distance).length]));
}
