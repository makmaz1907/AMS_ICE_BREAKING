export type Team = { id: string; name: string; connected: boolean; score: number };
export type WordRound = { type: "word"; id: string; letters: string[]; jokerIndex: number; endsAt: number; durationSeconds: number; themedWord: string | null };
export type NumberRound = { type: "number"; id: string; numbers: number[]; target: number; description: string; endsAt: number; durationSeconds: number };
export type GameRound = WordRound | NumberRound;
export type Submission = { teamId: string; teamName: string; answer: string; value?: number; dictionaryValid?: boolean; meanings?: string[]; buildValid: boolean; jokerUsed?: boolean; status: "accepted" | "rejected"; score: number };
export type GameState = { phase: "lobby" | "word" | "number" | "round-results" | "game-results"; teams: Team[]; round: GameRound | null; submissions: Submission[]; matchRound: number; totalRounds: number; roundType: "word" | "number" | null; teamMode: "team" | "individual"; winner: Team | null; numberSolution: string | null; themedWord: string | null; paused: boolean };
