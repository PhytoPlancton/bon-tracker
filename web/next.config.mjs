/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.leboncoin.fr' },
      { protocol: 'https', hostname: '**.lbcdn.fr' },
    ],
  },
};

export default nextConfig;
