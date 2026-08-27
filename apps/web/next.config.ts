import type { NextConfig } from "next";

const onVercel = Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  // Docker image copies .next/standalone; Vercel builds its own output and doesn't want standalone mode.
  ...(onVercel ? {} : { output: "standalone" as const }),
  // @marrow/core is imported for types only; keep it out of the bundle graph.
  serverExternalPackages: ["@marrow/core"],
  // The OpenGraph routes read fonts and the brand mark from disk; make sure serverless bundles include them.
  outputFileTracingIncludes: {
    "/**": ["./assets/**/*"],
  },
};

export default nextConfig;
