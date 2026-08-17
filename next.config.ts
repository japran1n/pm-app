import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Disabled: auto-appends an agent-rules block to CLAUDE.md on every `next dev`,
  // which would corrupt this repo's mission-orchestrator house-rules file.
  agentRules: false,
};

export default nextConfig;
