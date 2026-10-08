import type { NextConfig } from "next";

// CORS is applied dynamically in proxy.ts so production, preview, and local
// frontend origins can all be handled without conflicting static headers.
const nextConfig: NextConfig = {};

export default nextConfig;
