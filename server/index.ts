import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { Server } from "socket.io";
import { createNumberRound, evaluateNumberExpression, scoreNumber, type NumberRound } from "./numberGame.js";
import { canBuildWord, createWordRound, normalizeTurkish, scoreWord, type WordRound } from "./wordGame.js";

type RoundConfig = { type: "word" | "number"; durationSeconds: number };
type GameConfig = { rounds: RoundConfig[]; teamMode: "team" | "individual"; predefinedTeams: string[]; themedWord: string; targetNumber: number | null; targetDescription: string };
type Team = { id: string; name: string; connected: boolean; score: number };
type Submission = { teamId: string; answer: string; value?: number; dictionaryValid?: boolean; meanings?: string[]; buildValid: boolean; jokerUsed?: boolean; status: "accepted" | "rejected"; score: number };
type TdkEntry = { madde?: string; anlamlarListe?: Array<{ anlam?: string }> };
type TdkLookup = { valid: boolean; meanings: string[] };
type GamePhase = "lobby" | "word" | "number" | "round-results" | "game-results";

const port = Number(process.env.PORT ?? 3000);
const hostPin = process.env.HOST_PIN ?? "1234";
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const config = loadConfig();
const wordValidationCache = new Map<string, TdkLookup>();
const teams = new Map<string, Team>();
let phase: GamePhase = "lobby";
let activeRound: WordRound | NumberRound | null = null;
let submissions = new Map<string, Submission[]>();
let roundTimer: NodeJS.Timeout | undefined;
let matchRound = 0;
let pausedRemainingMs: number | null = null;

function loadConfig(): GameConfig {
  const defaults: GameConfig = { rounds: [{ type: "word", durationSeconds: 60 }, { type: "word", durationSeconds: 60 }, { type: "word", durationSeconds: 60 }, { type: "number", durationSeconds: 90 }, { type: "number", durationSeconds: 90 }], teamMode: "team", predefinedTeams: [], themedWord: "", targetNumber: null, targetDescription: "" };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve("config/game.json"), "utf8")) as Partial<GameConfig>;
    return { ...defaults, ...parsed, rounds: parsed.rounds?.length ? parsed.rounds : defaults.rounds };
  } catch { return defaults; }
}

function wordVariants(word: string) {
  const alternatives: Record<string, string[]> = { I: ["I", "İ"], İ: ["I", "İ"], O: ["O", "Ö"], Ö: ["O", "Ö"], U: ["U", "Ü"], Ü: ["U", "Ü"], G: ["G", "Ğ"], Ğ: ["G", "Ğ"], C: ["C", "Ç"], Ç: ["C", "Ç"] };
  return Array.from(word).reduce<string[]>((variants, letter) => variants.flatMap((variant) => (alternatives[letter] ?? [letter]).map((replacement) => `${variant}${replacement}`)), [""]);
}

function meaningsFor(entry: TdkEntry) {
  return (entry.anlamlarListe ?? []).map((meaning) => meaning.anlam?.replace(/<[^>]*>/g, "").trim() ?? "").filter(Boolean);
}

async function isTdkWord(word: string): Promise<TdkLookup | null> {
  const cached = wordValidationCache.get(word);
  if (cached) return cached;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    for (const variant of wordVariants(word)) {
      const query = new URLSearchParams({ ara: variant.toLocaleLowerCase("tr-TR") });
      const response = await fetch(`https://sozluk.gov.tr/gts?${query}`, { signal: controller.signal });
      if (!response.ok) return null;
      const results = await response.json() as TdkEntry[] | { error?: string };
      if (!Array.isArray(results)) continue;
      const entry = results.find((result) => normalizeTurkish(result.madde ?? "") === variant);
      if (!entry) continue;
      const lookup = { valid: true, meanings: meaningsFor(entry) };
      wordValidationCache.set(word, lookup);
      return lookup;
    }
    const lookup = { valid: false, meanings: [] };
    wordValidationCache.set(word, lookup);
    return lookup;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function localAddress() {
  const addresses = Object.values(os.networkInterfaces()).flat().filter((address): address is os.NetworkInterfaceInfo => Boolean(address));
  return addresses.find((address) => address.family === "IPv4" && !address.internal)?.address ?? "localhost";
}

function rankedTeams() { return [...teams.values()].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "tr-TR")); }
function roundConfig() { return config.rounds[matchRound - 1] ?? null; }
function roundType() { return roundConfig()?.type ?? null; }
function durationSeconds() { return roundConfig()?.durationSeconds ?? 0; }
function roundEndsAt() { return activeRound?.endsAt ?? null; }
function serializeRound() {
  if (!activeRound) return null;
  if (phase === "word" && "letters" in activeRound) return { type: "word" as const, ...activeRound, durationSeconds: durationSeconds(), themedWord: config.themedWord || null };
  if (phase === "number" && "numbers" in activeRound) return { type: "number" as const, id: activeRound.id, numbers: activeRound.numbers, target: activeRound.target, description: activeRound.description, endsAt: activeRound.endsAt, durationSeconds: durationSeconds() };
  return null;
}
function serializeSubmissions() {
  return [...submissions.values()].flatMap((teamSubmissions) => teamSubmissions.map((submission) => ({ ...submission, teamName: teams.get(submission.teamId)?.name ?? "Bilinmeyen takım" }))).sort((left, right) => right.score - left.score || left.teamName.localeCompare(right.teamName, "tr-TR"));
}
function gameState() {
  const currentType = roundType();
  const solution = phase === "round-results" && currentType === "number" && activeRound && "solution" in activeRound ? activeRound.solution : null;
  return { phase, teams: rankedTeams(), round: serializeRound(), submissions: phase === "word" || phase === "number" ? [] : serializeSubmissions(), matchRound, totalRounds: config.rounds.length, roundType: currentType, teamMode: config.teamMode, winner: phase === "game-results" ? rankedTeams()[0] ?? null : null, numberSolution: solution, themedWord: phase === "round-results" && currentType === "word" ? config.themedWord || null : null, paused: pausedRemainingMs !== null };
}
function broadcastState() { io.emit("game:state", gameState()); }
function finishRound() {
  if (phase !== "word" && phase !== "number") return;
  if (roundTimer) clearTimeout(roundTimer);
  roundTimer = undefined;
  pausedRemainingMs = null;
  phase = matchRound >= config.rounds.length ? "game-results" : "round-results";
  broadcastState();
}
function startRound() {
  if (roundTimer) clearTimeout(roundTimer);
  if (matchRound >= config.rounds.length) { matchRound = 0; teams.forEach((team) => { team.score = 0; }); }
  matchRound += 1;
  const current = roundConfig()!;
  submissions = new Map();
  pausedRemainingMs = null;
  if (current.type === "word") {
    activeRound = createWordRound(current.durationSeconds);
    phase = "word";
  } else {
    activeRound = createNumberRound(current.durationSeconds, config.targetNumber, config.targetDescription);
    phase = "number";
  }
  roundTimer = setTimeout(finishRound, current.durationSeconds * 1000);
  broadcastState();
}
function togglePause() {
  if (phase !== "word" && phase !== "number" || !activeRound) return;
  if (pausedRemainingMs === null) {
    pausedRemainingMs = Math.max(0, activeRound.endsAt - Date.now());
    if (roundTimer) clearTimeout(roundTimer);
    roundTimer = undefined;
  } else {
    activeRound.endsAt = Date.now() + pausedRemainingMs;
    roundTimer = setTimeout(finishRound, pausedRemainingMs);
    pausedRemainingMs = null;
  }
  broadcastState();
}
function addTime(seconds: number) {
  if ((phase !== "word" && phase !== "number") || !activeRound || seconds <= 0) return;
  if (pausedRemainingMs !== null) pausedRemainingMs += seconds * 1000;
  else {
    activeRound.endsAt += seconds * 1000;
    if (roundTimer) clearTimeout(roundTimer);
    roundTimer = setTimeout(finishRound, Math.max(0, activeRound.endsAt - Date.now()));
  }
  broadcastState();
}
async function validateWord(teamId: string, rawWord: string, jokerIndex: number | null): Promise<Submission | null> {
  const answer = normalizeTurkish(rawWord);
  const build = activeRound && "letters" in activeRound ? canBuildWord(answer, activeRound, jokerIndex) : { valid: false, jokerUsed: false };
  if (!build.valid) return { teamId, answer, buildValid: false, jokerUsed: build.jokerUsed, status: "rejected", score: 0 };
  const lookup = await isTdkWord(answer);
  if (lookup === null) return null;
  return { teamId, answer, dictionaryValid: lookup.valid, meanings: lookup.meanings, buildValid: true, jokerUsed: build.jokerUsed, status: lookup.valid ? "accepted" : "rejected", score: lookup.valid ? scoreWord(answer, true, build.jokerUsed) : 0 };
}
function validateNumber(teamId: string, expression: string): Submission {
  const result = activeRound && "numbers" in activeRound ? evaluateNumberExpression(expression, activeRound.numbers) : { valid: false, message: "Tur bulunamadı." };
  if (!result.valid || !activeRound || !("target" in activeRound)) return { teamId, answer: expression, buildValid: false, status: "rejected", score: 0 };
  const value = result.value!;
  return { teamId, answer: expression, value, buildValid: true, status: "accepted", score: scoreNumber(value, activeRound.target) };
}
function submit(teamId: string, submission: Submission) {
  const team = teams.get(teamId)!;
  const teamSubmissions = submissions.get(teamId) ?? [];
  if (teamSubmissions.some((previous) => previous.answer === submission.answer)) return false;
  if (submission.status === "accepted") team.score += submission.score;
  teamSubmissions.push(submission);
  submissions.set(teamId, teamSubmissions);
  return true;
}

app.use(express.json());
app.use(express.static(path.resolve("dist")));
app.get("/api/health", (_request, response) => response.json({ ok: true, wordValidation: "tdk" }));
app.get("/api/join-url", (request, response) => { const candidate = Number(request.query.port); const joinPort = Number.isInteger(candidate) && candidate > 0 && candidate <= 65_535 ? candidate : port; response.json({ url: `${request.protocol}://${localAddress()}:${joinPort}/join` }); });
app.get("/api/results.json", (_request, response) => response.json({ teams: rankedTeams(), rounds: config.rounds.length, matchRound, submissions: serializeSubmissions() }));
app.get("/api/results.csv", (_request, response) => { const rows = ["Sıra,Takım,Puan", ...rankedTeams().map((team, index) => `${index + 1},\"${team.name.replaceAll('"', '""')}\",${team.score}`)]; response.header("Content-Type", "text/csv; charset=utf-8").attachment("bir-kelime-bir-islem-sonuclari.csv").send(`\uFEFF${rows.join("\n")}`); });
app.get("*", (_request, response) => response.sendFile(path.resolve("dist/index.html")));

io.on("connection", (socket) => {
  socket.emit("game:state", gameState());
  socket.on("game:state:request", () => socket.emit("game:state", gameState()));
  socket.on("host:authenticate", (pin: string, callback: (result: { ok: boolean }) => void) => callback({ ok: pin === hostPin }));
  socket.on("host:round:start", startRound);
  socket.on("host:round:finish", finishRound);
  socket.on("host:round:pause", togglePause);
  socket.on("host:round:add-time", (seconds: number) => addTime(seconds));
  socket.on("host:teams:reset", () => { if (roundTimer) clearTimeout(roundTimer); teams.clear(); submissions = new Map(); activeRound = null; matchRound = 0; pausedRemainingMs = null; phase = "lobby"; broadcastState(); });
  socket.on("team:join", (payload: { sessionId: string; name: string }, callback: (result: { ok: boolean; message?: string }) => void) => { const name = payload.name.trim().slice(0, 32); if (!payload.sessionId || !name) return callback({ ok: false, message: "Geçerli bir takım adı girin." }); const existing = teams.get(payload.sessionId); teams.set(payload.sessionId, { id: payload.sessionId, name, connected: true, score: existing?.score ?? 0 }); socket.data.sessionId = payload.sessionId; callback({ ok: true }); broadcastState(); });
  socket.on("round:submit", async (payload: { answer: string; jokerIndex?: number | null }, callback: (result: { ok: boolean; message?: string }) => void) => { const teamId = socket.data.sessionId as string | undefined; if (!teamId || !teams.has(teamId)) return callback({ ok: false, message: "Önce lobiye katılın." }); if (typeof payload?.answer !== "string") return callback({ ok: false, message: "Geçerli bir cevap girin." }); if ((phase !== "word" && phase !== "number") || !activeRound || pausedRemainingMs !== null || Date.now() >= activeRound.endsAt) return callback({ ok: false, message: "Bu tur için cevap kabul edilmiyor." }); const submittedRoundId = activeRound.id; const jokerIndex = typeof payload.jokerIndex === "number" ? payload.jokerIndex : null; const item = phase === "word" ? await validateWord(teamId, payload.answer, jokerIndex) : validateNumber(teamId, payload.answer); if (!item) return callback({ ok: false, message: "TDK sözlüğüne ulaşılamadı. Lütfen tekrar deneyin." }); if (activeRound?.id !== submittedRoundId || (phase !== "word" && phase !== "number") || pausedRemainingMs !== null || Date.now() >= activeRound.endsAt) return callback({ ok: false, message: "Bu tur için cevap kabul edilmiyor." }); if (!item.buildValid) return callback({ ok: false, message: phase === "word" ? "Kelime verilen harfler ve jokerle oluşturulmalı." : "İfade kurallara uymuyor." }); if (phase === "word" && !item.dictionaryValid) return callback({ ok: false, message: "Kelime TDK sözlüğünde bulunamadı." }); if (!submit(teamId, item)) return callback({ ok: false, message: "Bu cevabı zaten gönderdiniz." }); callback({ ok: true, message: "Cevabınız alındı." }); broadcastState(); });
  socket.on("disconnect", () => { const sessionId = socket.data.sessionId as string | undefined; const team = sessionId ? teams.get(sessionId) : undefined; if (team) { team.connected = false; broadcastState(); } });
});

server.listen(port, "0.0.0.0", () => { const address = localAddress(); console.log(`Host ekranı: http://localhost:${port}/host`); console.log(`Katılım URL'si: http://${address}:${port}/join`); console.log(`Host PIN'i: ${hostPin}`); console.log("Kelime doğrulaması: TDK sözlüğü"); });
