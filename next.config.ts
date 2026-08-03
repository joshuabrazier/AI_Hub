import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// The project directory (this file's folder). Pinned as the Turbopack root
// below so a stray lockfile elsewhere on the machine (e.g. a package-lock.json
// in the user's home folder) can't make Turbopack infer the wrong workspace
// root - which mis-resolves the app and 404s every route.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// -------------------------------------------------------------------
// Security response headers, applied to every route.
//
// These are the "safe" hardening headers - they don't depend on the page's
// markup, so they can't break rendering:
//   - HSTS: force HTTPS for two years (ignored by browsers over plain HTTP,
//     so it's a no-op in local dev).
//   - X-Frame-Options / CSP frame-ancestors: block click-jacking (the app is
//     never meant to be framed).
//   - X-Content-Type-Options: stop MIME sniffing.
//   - Referrer-Policy: don't leak full URLs cross-origin.
//   - Permissions-Policy: switch off device APIs the app doesn't use.
//   - CSP (partial): base-uri/object-src/form-action lock down tag-injection
//     and form hijacking WITHOUT constraining script/style, so nothing breaks.
//
// NOTE: a full script-src/style-src CSP needs per-request nonces (Next injects
// inline bootstrap scripts), which requires middleware and live testing - left
// as a follow-up so we don't ship a policy that white-screens the app.
// -------------------------------------------------------------------
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: ["base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'"].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Build a self-contained server (.next/standalone) so deploys ship a small,
  // ready-to-run artifact (node server.js) instead of building on the App
  // Service. Deploy copies .next/static and public into it (see deploy.yml).
  output: "standalone",
  // Pin the workspace root to this project so Turbopack doesn't infer it from a
  // stray lockfile elsewhere on the machine (which 404s the whole app in dev).
  turbopack: {
    root: projectRoot,
  },
  // Allow the dev server to accept requests proxied through a Cloudflare quick
  // tunnel (phone testing over HTTPS). Wildcard covers the random per-run
  // *.trycloudflare.com subdomain, plus common LAN ranges for direct access.
  allowedDevOrigins: ["*.trycloudflare.com", "192.168.*.*", "10.*.*.*"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
