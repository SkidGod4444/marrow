import { API_URL, apiHeaders } from "@/lib/api";
import { AUTH_ENABLED, getSession } from "@/lib/auth";

// Transparent proxy to the Marrow API for client components (chat stream, frame images, ingest).
// Attaches the owner API key server-side and streams the upstream body through untouched.

// Vercel: allow long-lived streaming responses (chat). 60 s is the Hobby ceiling; raise on Pro.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ALLOW =
  /^(items\/[^/]+\/(chat|events|archive|export\.md|export\.txt|audio|expressions|expressions\/\d+\/save|clips\/\d+)|frames\/[^/]+|ingest|capture|inbox|namespaces|namespaces\/[^/]+|namespaces\/[^/]+\/(graph|chat|poll|summary)|sources|sources\/[^/]+|sources\/[^/]+\/poll|jobs\/[^/]+|search|reviews|reviews\/summary|reviews\/[^/]+\/answer)$/;

async function proxy(req: Request, ctx: RouteContext<"/api/marrow/[...path]">): Promise<Response> {
  const { path } = await ctx.params;
  const target = path.join("/");
  if (!ALLOW.test(target)) return Response.json({ error: "not proxied" }, { status: 404 });
  // The key is injected only for the signed-in owner — otherwise anyone with the URL could drive the API.
  if (AUTH_ENABLED && !(await getSession())) return Response.json({ error: "sign in first" }, { status: 401 });
  const url = new URL(req.url);
  const upstream = await fetch(`${API_URL}/${target}${url.search}`, {
    method: req.method,
    headers: apiHeaders({
      ...(req.headers.get("content-type") ? { "content-type": req.headers.get("content-type")! } : {}),
      ...(req.headers.get("range") ? { range: req.headers.get("range")! } : {}), // audio seeking
      accept: req.headers.get("accept") ?? "*/*",
    }),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // @ts-expect-error — Node fetch needs duplex for streamed request bodies
    duplex: "half",
    cache: "no-store",
  });
  const headers = new Headers();
  for (const h of ["content-type", "cache-control", "x-frame-t", "x-vercel-ai-ui-message-stream", "accept-ranges", "content-range", "content-length"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
