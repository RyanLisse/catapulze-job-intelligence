import "@ji/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  typedRoutes: true,
};

export default nextConfig;
