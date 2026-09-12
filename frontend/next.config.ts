import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for the production Docker image (see Dockerfile) —
  // bundles a minimal server + only the deps actually used at runtime.
  output: "standalone",
};

export default nextConfig;
