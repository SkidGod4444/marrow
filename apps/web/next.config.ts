import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker image copies .next/standalone (see docker/web.Dockerfile).
  output: "standalone",
  // @marrow/core is imported for types only; keep it out of the bundle graph.
  serverExternalPackages: ["@marrow/core"],
};

export default nextConfig;
