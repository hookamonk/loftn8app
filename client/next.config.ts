import type { NextConfig } from "next";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:4000" : "https://loftn8-app.onrender.com");

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder so Turbopack resolves modules from
  // client/node_modules (tailwindcss, etc.) and watches only client/ — not the
  // whole repo/home dir, which broke module resolution and pegged the CPU.
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_BASE}/:path*`,
      },
    ];
  },
};

export default nextConfig;
