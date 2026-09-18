import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Disabled: auto-appends an agent-rules block to CLAUDE.md on every `next dev`,
  // which would corrupt this repo's mission-orchestrator house-rules file.
  agentRules: false,
  // F274 (AS-203, AS-205): Next's default Server Action body limit is 1MB
  // (node_modules/next/dist/server/app-render/action-handler.js), while
  // lib/validation/profile.ts's MAX_AVATAR_SIZE_BYTES is 2MB — every avatar
  // between 1MB and 2MB was 413ing before uploadAvatar ever ran, and files
  // over 2MB never reached uploadAvatarSchema's limit-naming message
  // either. Set comfortably above the 2MB app-level limit: multipart
  // encoding overhead (boundaries, headers, base64 in some clients) means
  // a 2MB file's raw request body can exceed 2MB, so the body limit itself
  // must have headroom above the byte-count limit it's meant to let
  // through.
  //
  // Bug fix: this was previously "3mb" while
  // lib/validation/attachments.ts's MAX_ATTACHMENT_SIZE_BYTES was 10MB —
  // any attachment upload between 3MB and 10MB passed client-side
  // validation only to 413 on the server. Both are now aligned: the
  // app-level attachment limit is 4MB and this body limit is 4.5MB
  // (headroom for multipart overhead). Vercel additionally hard-caps
  // request bodies at ~4.5MB regardless of this setting, so raising this
  // further would be a no-op in production.
  experimental: {
    serverActions: {
      bodySizeLimit: "4.5mb",
    },
  },
  // Audit NX-001: baseline security headers. A full CSP is deferred until the
  // inline theme script in app/layout.tsx carries a per-request nonce
  // (audit NX-002) — shipping CSP before that would require 'unsafe-inline'.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
