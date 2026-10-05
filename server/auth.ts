import crypto from "node:crypto";

// On Vercel both secrets must come from env vars; locally a per-process secret is fine because the in-memory game dies with the process anyway.
const production = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
const secret = process.env.APP_SECRET ?? (production ? "" : crypto.randomBytes(32).toString("hex"));
export const hostPin = process.env.HOST_PIN ?? (production ? null : "1234");

function sign(payload: string) { return crypto.createHmac("sha256", secret).update(payload).digest("base64url"); }
function sameText(left: string, right: string) { const a = crypto.createHash("sha256").update(left).digest(); const b = crypto.createHash("sha256").update(right).digest(); return crypto.timingSafeEqual(a, b); }
function issue(payload: string) { if (!secret) throw new Error("APP_SECRET tanımlı değil."); return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`; }
function verify(token: unknown) {
  if (!secret || typeof token !== "string") return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, "base64url").toString();
  return sameText(sign(payload), signature) ? payload.split("|") : null;
}

export function teamToken(gameId: string, teamId: string) { return issue(`team|${gameId}|${teamId}`); }
export function readTeamToken(token: unknown) { const parts = verify(token); return parts?.length === 3 && parts[0] === "team" ? { gameId: parts[1], teamId: parts[2] } : null; }
export function hostToken() { return issue(`host|${Date.now() + 12 * 60 * 60 * 1000}`); }
export function isHostToken(token: unknown) { const parts = verify(token); return parts?.length === 2 && parts[0] === "host" && Number(parts[1]) > Date.now(); }
export function pinMatches(pin: unknown) { return Boolean(hostPin) && typeof pin === "string" && sameText(pin, hostPin!); }
