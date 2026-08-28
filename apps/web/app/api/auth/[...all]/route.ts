import { API_URL } from "@/lib/api";

// Better Auth lives on the API server; this route forwards /api/auth/* there and passes cookies both ways, so the
// browser only ever talks to the web app's origin. No API key is involved: these endpoints are public by design.
export const dynamic = "force-dynamic";

async function forward(req: Request, ctx: RouteContext<"/api/auth/[...all]">): Promise<Response> {
  const { all } = await ctx.params;
  const url = new URL(req.url);
  const headers = new Headers();
  for (const h of ["content-type", "cookie", "accept", "user-agent", "x-forwarded-for"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Better Auth checks Origin against its trusted origins: always the web app's own origin.
  headers.set("origin", url.origin);
  const upstream = await fetch(`${API_URL}/api/auth/${all.join("/")}${url.search}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    redirect: "manual",
    cache: "no-store",
  });
  const out = new Headers();
  for (const h of ["content-type", "location", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of upstream.headers.getSetCookie()) out.append("set-cookie", c);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = forward;
export const POST = forward;
