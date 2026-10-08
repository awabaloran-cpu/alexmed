import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse and the AWS SDK rely on Node.js APIs — keep these route handlers
  // on the Node runtime (the default) and out of the Edge bundle. @napi-rs/canvas
  // (pdf-parse's own canvas dependency, needed for its worker's CanvasFactory —
  // see the "pdf-parse/worker" import in app/api/books/extract/route.ts)
  // must also be external, or Vercel's serverless bundling can fail to carry
  // its native binary along, per pdf-parse's own Vercel troubleshooting docs.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  // Mirrors server-only UPLOAD_MAX_MB into a client-readable var, so the
  // upload panel's copy/validation stays in sync with the real configured
  // limit instead of a hardcoded duplicate number.
  env: {
    NEXT_PUBLIC_UPLOAD_MAX_MB: process.env.UPLOAD_MAX_MB ?? "250",
  },
  // Browser hardening on every response. The CSP here only locks framing,
  // plugins and <base> — it does not restrict scripts or network requests
  // (that needs per-request nonces for Next.js's inline scripts), so nothing
  // the app loads today is affected. No page embeds another in a frame, and
  // the Android shell loads the site directly, not in an iframe.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      // The Mini App's front door (app/tg) — the ONE page Telegram Web may
      // show in a frame (it displays Mini Apps that way; the phone and
      // desktop apps use their own web view and are not affected). The page
      // holds nothing: it only passes Telegram's launch data on and leaves.
      // Listed after the rule above so this policy replaces it for /tg;
      // browsers that honour frame-ancestors ignore X-Frame-Options.
      {
        source: "/tg",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://web.telegram.org; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
