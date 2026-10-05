import { handleApi } from "../server/api.js";
import { runtime } from "../server/runtime.js";

// Single catch-all function: Vercel Hobby allows at most 12 functions per deployment, so every /api route is dispatched by server/api.ts.
const handle = (request: Request) => handleApi(request, runtime);

export const GET = handle;
export const POST = handle;
