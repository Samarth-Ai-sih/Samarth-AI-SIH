import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Standalone output for Docker production builds
  output: "standalone",
  skipTrailingSlashRedirect: true,

  // The local API is deliberately bound to loopback. Allow the loopback host
  // used by the in-app browser as well as localhost so the dev client can
  // hydrate instead of leaving auth screens in their server-rendered state.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // Keep Turbopack's filesystem boundary at this app rather than inheriting
  // an unrelated lockfile from a parent directory.
  turbopack: {
    root: path.resolve(process.cwd()),
  },

  // Proxy API requests to the backend in development
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/:path*`,
      },
      {
        source: "/github-webhook",
        destination: "http://172.17.0.1:8080/github-webhook/",
      },
      {
        source: "/github-webhook/:path*",
        destination: "http://172.17.0.1:8080/github-webhook/:path*",
      },
    ];
  },
};

export default nextConfig;
