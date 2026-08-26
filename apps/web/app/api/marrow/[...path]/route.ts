import { API_URL, apiHeaders } from "@/lib/api";

// Transparent proxy to the Marrow API for client components (chat stream, frame images, ingest).
// Attaches the owner API key server-side and streams the upstream body through untouched.

const ALLOW = /^(items\/[^/]+\/(chat|events|archive|export\.md|export\.txt)|frames\/[^/]+|ingest|inbox|namespaces|namespaces\/[^/]+\/(graph|chat|poll|summary)|sources|sources\/[^/]+|sources\/[^/]+\/poll|jobs\/[^/]+|search)$/;

async function proxy(req: Request, ctx: RouteContext<"/api/marrow/[...path]">): Promise<Response> {
  const { path } = await ctx.params;
  const target = path.join("/");
  if (!ALLOW.test(target)) return Response.json({ error: "not proxied" }, { status: 404 });
  const url = new URL(req.url);
  const upstream = await fetch(`${API_URL}/${target}${url.search}`, {
    method: req.method,
    headers: apiHeaders({ ...(req.headers.get("content-type") ? { "content-type": req.headers.get("content-type")! } : {}), accept: req.headers.get("accept") ?? "*/*" }),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // @ts-expect-error — Node fetch needs duplex for streamed request bodies
    duplex: "half",
    cache: "no-store",
  });
  const headers = new Headers();
  for (const h of ["content-type", "cache-control", "x-frame-t", "x-vercel-ai-ui-message-stream"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
