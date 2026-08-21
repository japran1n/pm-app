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
  experimental: {
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
