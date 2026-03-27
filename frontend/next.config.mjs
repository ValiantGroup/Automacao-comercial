/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {},
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000',
  },
};

export default nextConfig;
