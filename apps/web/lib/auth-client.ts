"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Talks to /api/auth on this origin, which the web app proxies to the API server (cookies stay first-party). */
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? "" : window.location.origin,
  basePath: "/api/auth",
  plugins: [organizationClient(), apiKeyClient()],
});
