import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its bundled .afm font-metric files from disk at runtime via
  // __dirname-relative paths — Turbopack/webpack bundling for Route Handlers
  // rewrites those paths and breaks the lookup (confirmed: ENOENT under
  // `next dev` with Turbopack, resolving to a bogus "C:\ROOT\..." path).
  // This opts pdfkit out of bundling so it's require()'d natively instead.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
