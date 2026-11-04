import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  transpilePackages: ["@vortex/ui"],
};

export default nextConfig;
