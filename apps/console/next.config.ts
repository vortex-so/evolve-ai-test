import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vortex/ui", "@vortex/schema"],
};

export default nextConfig;
