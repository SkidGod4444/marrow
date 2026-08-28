import { type NextRequest, NextResponse } from "next/server";

// Gate (Next.js proxy, formerly middleware): without a session cookie, everything except the login page and the
// auth endpoints redirects to /login. The cookie is only checked for presence here — pages and the API proxy verify
// it against the server. MARROW_AUTH=off disables the gate for local work.
// `_vercel/` = Vercel Analytics/Speed Insights scripts (production only); redirecting those to HTML breaks the page.
const PUBLIC = [/^\/login$/, /^\/signup$/, /^\/welcome$/, /^\/landing\//, /^\/items\/[^/]+\/read$/, /^\/api\/marrow\/public\//, /^\/sitemap\.xml$/, /^\/robots\.txt$/, /^\/api\/auth\//, /^\/api\/version$/, /^\/_next\//, /^\/_vercel\//, /^\/favicon\.ico$/, /^\/icon/, /^\/apple-icon/, /^\/opengraph-image/, /^\/brand\//, /^\/robots\.txt$/, /^\/manifest/];

const API_URL = (process.env.MARROW_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const isSessionCookie = (name: string) => name.endsWith("session_token");

/** Is the session cookie still good? Asked only for "/", so a stale cookie shows the landing instead of a sign-in bounce. */
async function sessionAlive(req: NextRequest): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/me`, { headers: { cookie: req.headers.get("cookie") ?? "" }, signal: AbortSignal.timeout(2500), cache: "no-store" });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return true; // the API is unreachable: let the app page show its own error, not the landing
  }
}

const landing = (req: NextRequest, staleCookies: string[] = []) => {
  const res = NextResponse.rewrite(new URL("/welcome", req.url));
  for (const name of staleCookies) res.cookies.delete(name);
  return res;
};

export async function proxy(req: NextRequest) {
  if (process.env.MARROW_AUTH === "off") return NextResponse.next();
  const { pathname } = req.nextUrl;
  // The landing lives at "/" (rewritten below); its internal address is never shown.
  if (pathname === "/welcome") return NextResponse.redirect(new URL("/", req.url));
  if (PUBLIC.some((r) => r.test(pathname)) || /\/opengraph-image/.test(pathname)) return NextResponse.next();
  const sessionCookies = req.cookies.getAll().filter((c) => isSessionCookie(c.name)).map((c) => c.name);
  if (sessionCookies.length) {
    // A cookie that the server no longer recognises must not turn the front door into a sign-in page.
    if (pathname === "/" && !(await sessionAlive(req))) return landing(req, sessionCookies);
    return NextResponse.next();
  }
  // Visitors get the landing page at "/" (the address stays "/"); the signed-in get the inbox there.
  if (pathname === "/") return landing(req);
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
