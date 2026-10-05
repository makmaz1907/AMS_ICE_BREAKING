import { Redis } from "@upstash/redis";
import { initialMeta, submissionKey, type Meta, type Store, type Submission, type SubmitResult, type TeamRecord } from "./store.js";

// Game data expires two days after its last write, so abandoned games and old rounds clean themselves up.
const dataTtl = 2 * 24 * 60 * 60;

// Writes the meta only if its stored rev still matches; this is what makes engine.mutate() safe across function instances.
const compareAndSetMeta = `
local current = redis.call('GET', KEYS[1])
local rev = -1
if current then rev = cjson.decode(current).rev end
if rev ~= tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
return 1`;

// Mirrors isRoundOpen() + MemoryStore.addSubmission: re-check the round, reject a repeat, record, score.
const addSubmission = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'closed' end
local meta = cjson.decode(raw)
local round = meta.round
if (meta.phase ~= 'word' and meta.phase ~= 'number') or type(round) ~= 'table' or round.id ~= ARGV[1] or meta.pausedRemainingMs ~= cjson.null or tonumber(ARGV[4]) >= round.endsAt then return 'closed' end
if redis.call('HSETNX', KEYS[2], ARGV[2], ARGV[3]) == 0 then return 'duplicate' end
redis.call('EXPIRE', KEYS[2], ARGV[8])
if ARGV[5] == 'accepted' then
  redis.call('HINCRBY', KEYS[3], ARGV[6], ARGV[7])
  redis.call('EXPIRE', KEYS[3], ARGV[8])
end
return 'ok'`;

const countHit = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count`;

export function redisConfigured() { return Boolean(redisUrl() && redisToken()); }
// The Vercel Marketplace integration may inject either naming scheme.
function redisUrl() { return process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL; }
function redisToken() { return process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN; }

// prefix keeps production, preview and test data apart in the same database.
export function createRedisStore(prefix: string): Store {
  const redis = new Redis({ url: redisUrl()!, token: redisToken()!, automaticDeserialization: false, enableAutoPipelining: true });
  const key = (...parts: Array<string | number>) => `${prefix}${parts.join(":")}`;
  const parse = <T>(values: string[]) => values.map((value) => JSON.parse(value) as T);
  return {
    async readMeta() {
      const stored = await redis.get<string>(key("meta"));
      if (stored) return JSON.parse(stored) as Meta;
      await redis.set(key("meta"), JSON.stringify(initialMeta()), { nx: true });
      return JSON.parse((await redis.get<string>(key("meta")))!) as Meta;
    },
    async writeMeta(next, expectedRev) { return await redis.eval<[string, string], number>(compareAndSetMeta, [key("meta")], [JSON.stringify(next), String(expectedRev)]) === 1; },
    async readVersion() { return Number(await redis.get<string>(key("version")) ?? 0); },
    async bumpVersion() { return redis.incr(key("version")); },
    async listTeams(gameId) { return parse<TeamRecord>(await redis.hvals(key("teams", gameId))); },
    async getTeam(gameId, teamId) { const team = await redis.hget<string>(key("teams", gameId), teamId); return team ? JSON.parse(team) as TeamRecord : null; },
    async saveTeam(gameId, team) { await redis.hset(key("teams", gameId), { [team.id]: JSON.stringify(team) }); await redis.expire(key("teams", gameId), dataTtl); },
    // With automaticDeserialization off, HGETALL comes back as the raw [field, value, field, value, …] list.
    async scores(gameId, series) { const flat = (await redis.hgetall(key("scores", gameId, series)) ?? []) as unknown as string[]; return Object.fromEntries(Array.from({ length: flat.length / 2 }, (_, index) => [flat[index * 2], Number(flat[index * 2 + 1])])); },
    async listSubmissions(roundId) { return parse<Submission>(await redis.hvals(key("subs", roundId))); },
    async addSubmission(meta, roundId, submission): Promise<SubmitResult> {
      return redis.eval<string[], SubmitResult>(addSubmission, [key("meta"), key("subs", roundId), key("scores", meta.gameId, meta.series)], [roundId, submissionKey(submission), JSON.stringify(submission), String(Date.now()), submission.status, submission.teamId, String(submission.score), String(dataTtl)]);
    },
    async getCache(cacheKey) { return redis.get<string>(key("cache", cacheKey)); },
    async setCache(cacheKey, value, ttlSeconds) { await redis.set(key("cache", cacheKey), value, { ex: ttlSeconds }); },
    async hit(hitKey, windowSeconds) { return redis.eval<[string], number>(countHit, [key("hit", hitKey)], [String(windowSeconds)]); },
  };
}
