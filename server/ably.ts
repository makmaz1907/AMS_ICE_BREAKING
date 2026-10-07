import * as Ably from "ably";

// The server publishes over Ably's REST API; browsers get subscribe-only tokens, so nobody else can publish fake versions.
let rest: Ably.Rest | null = null;
const client = () => rest ??= new Ably.Rest({ key: process.env.ABLY_API_KEY! });

export function ablyConfigured() { return Boolean(process.env.ABLY_API_KEY); }
export async function publishVersion(channel: string, version: number, scope: "all" | "host") { await client().channels.get(channel).publish("version", { version, scope }); }
export function subscriberTokenRequest(channel: string) { return client().auth.createTokenRequest({ capability: JSON.stringify({ [channel]: ["subscribe"] }) }); }
