// Which build is serving. Vercel exposes the deployment's commit through its system environment variables
// (Project → Settings → Environment Variables → "Automatically expose System Environment Variables"); locally it is null.
// Public (proxy.ts) so a plain curl answers "is the latest commit live?" — a short SHA gives nothing away.
export const dynamic = "force-dynamic";

export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  return Response.json(
    { ok: true, commit: sha ? sha.slice(0, 7) : null, ref: process.env.VERCEL_GIT_COMMIT_REF ?? null, env: process.env.VERCEL_ENV ?? "local" },
    { headers: { "cache-control": "no-store" } },
  );
}
