import type { NextConfig } from "next";

const pythonApiUrl = (
  process.env.PYTHON_AGENT_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["unpdf"],
  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: `${pythonApiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
