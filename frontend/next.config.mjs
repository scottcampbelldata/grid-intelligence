/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static HTML export - no Node runtime at request time. All data is fetched
  // client-side from NEXT_PUBLIC_API_BASE. `next build` emits to ./out, which
  // is what we upload to Cloudflare Pages.
  output: "export",

  // Cloudflare Pages serves static files; clean directory-style URLs.
  trailingSlash: true,

  // next/image optimization needs a server - disable it for static export.
  images: { unoptimized: true },

  // Build artifacts directory. Defaults to .next (used by `dev`, `build`).
  // `build:check` overrides this via NEXT_DIST_DIR so a build verification never
  // clobbers the running dev server's .next (which causes stale-chunk 404s).
  distDir: process.env.NEXT_DIST_DIR || ".next",

  reactStrictMode: true,
};

export default nextConfig;
