export type Team = { id: string; name: string; score: number };
export type WordRound = { type: "word"; id: string; letters: string[]; jokerIndex: number; endsAt: number; durationSeconds: number; themedWord: string | null };
export type NumberRound = { type: "number"; id: string; numbers: number[]; target: number; description: string; endsAt: number; durationSeconds: number };
export type GameRound = WordRound | NumberRound;
export type Submission = { teamId: string; teamName: string; answer: string; value?: number; dictionaryValid?: boolean; meanings?: string[]; buildValid: boolean; jokerUsed?: boolean; status: "accepted" | "rejected"; score: number };
export type GameState = { gameId: string; version: number; serverNow: number; phase: "lobby" | "word" | "number" | "round-results" | "game-results"; teams: Team[]; round: GameRound | null; submissions: Submission[]; matchRound: number; totalRounds: number; roundType: "word" | "number" | null; teamMode: "team" | "individual"; winner: Team | null; numberSolution: string | null; themedWord: string | null; paused: boolean; remainingMs: number | null; approvalRequired: boolean; statuses: Record<string, TeamStatus>; pendingTeams?: PendingTeam[] };
// Status of teams that are not approved; approved teams are the ones in GameState.teams. pendingTeams is only sent to the host (/api/host-state).
export type TeamStatus = "pending" | "rejected" | "removed";
export type PendingTeam = { id: string; name: string };
export type ApiResult = { ok: boolean; message?: string; status?: number };
