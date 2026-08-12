// SPDX-License-Identifier: Apache-2.0
import type { NextConfig } from 'next';

// Milestone 7: the public explorer. Never deployed to the internet as
// part of this milestone -- local-only demo stack. No next/font/google
// (would fetch at build time); no external image domains; no analytics.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
