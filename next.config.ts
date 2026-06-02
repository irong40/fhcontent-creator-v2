import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @resvg/resvg-js is a native (.node) addon that Turbopack/webpack cannot
  // bundle into an ESM chunk; keep it (and satori) as runtime requires so the
  // node serverless function loads the prebuilt binary directly.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
