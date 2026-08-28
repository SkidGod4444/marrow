import { type NextRequest, NextResponse } from "next/server";

// Gate (Next.js proxy, formerly middleware): without a session cookie, everything except the login page and the
// auth endpoints redirects to /login. The cookie is only checked for presence here — pages and the API proxy verify
// it against the server. MARROW_AUTH=off disables the gate for local work.
// `_vercel/` = Vercel Analytics/Speed Insights scripts (production only); redirecting those to HTML breaks the page.
const PUBLIC = [/^\/login$/, /^\/signup$/, /^\/welcome$/, /^\/landing\//, /^\/items\/[^/]+\/read$/, /^\/api\/marrow\/public\//, /^\/sitemap\.xml$/, /^\/robots\.txt$/, /^\/api\/auth\//, /^\/api\/version$/, /^\/_next\//, /^\/_vercel\//, /^\/favicon\.ico$/, /^\/icon/, /^\/apple-icon/, /^\/opengraph-image/, /^\/brand\//, /^\/robots\.txt$/, /^\/manifest/];

export function proxy(req: NextRequest) {
  if (process.env.MARROW_AUTH === "off") return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname)) || /\/opengraph-image/.test(pathname)) return NextResponse.next();
  const hasSession = req.cookies.getAll().some((c) => c.name.endsWith("better-auth.session_token") || c.name.endsWith("session_token"));
  if (hasSession) return NextResponse.next();
  // Visitors get the landing page at "/" (the address stays "/"); the signed-in get the inbox there.
  if (pathname === "/") return NextResponse.rewrite(new URL("/welcome", req.url));
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
