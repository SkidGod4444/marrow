// Talking to the API without falling over. The server restarts for ~10–20 s on every deploy and connections can drop
// mid-reply; a page must not turn that into "This page couldn't load" or, worse, hand a half-received body to the UI.
// So: transient failures on GETs are retried briefly, and replies are parsed strictly — a 2xx that isn't JSON is an
// error, never `{}`. Used by both the server-side client (lib/api.ts) and the browser-side one (lib/queries.ts).

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Gateway statuses that mean "the server wasn't there for a moment", not "the request was wrong". */
export const TRANSIENT = new Set([502, 503, 504]);

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const isRetriable = (init: RequestInit) => (init.method ?? "GET").toUpperCase() === "GET" || (init.method ?? "").toUpperCase() === "HEAD";

/**
 * fetch that retries transient failures (502/503/504 and network errors) with a short backoff — GET/HEAD only, since a
 * write may have gone through. Three attempts over ~1.2 s covers a container restart without a visible failure.
 */
export async function fetchWithRetry(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<Response> {
  const attempts = isRetriable(init) ? (opts.attempts ?? 3) : 1;
  const base = opts.baseDelayMs ?? 400;
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await f(url, init);
      if (!TRANSIENT.has(res.status) || i === attempts - 1) return res;
      last = new ApiError(friendlyStatus(res.status), res.status);
    } catch (err) {
      last = err;
      if (i === attempts - 1) throw err;
    }
    await sleep(base * 2 ** i);
  }
  throw last;
}

/** What to tell a person for a status code, when the server gave no message of its own. */
export function friendlyStatus(status: number): string {
  if (status === 401) return "Sign in first.";
  if (status === 403) return "You don't have permission to do that here.";
  if (status === 404) return "That doesn't exist (any more).";
  if (TRANSIENT.has(status)) return "The server is busy or restarting — try again in a moment.";
  return `Something went wrong (${status}).`;
}

/** Strict JSON body of a 2xx response; anything else is an ApiError. */
export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("The server sent an incomplete reply — try again.", res.status);
  }
}

/** ApiError for a failed response: the server's own `{ error }` when it sent one, a plain sentence otherwise. */
export async function errorFor(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  let message: string | undefined;
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body?.error === "string" && body.error.trim()) message = body.error;
  } catch {
    /* not JSON */
  }
  return new ApiError(message ?? friendlyStatus(res.status), res.status);
}
