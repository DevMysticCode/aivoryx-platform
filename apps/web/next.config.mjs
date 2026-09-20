/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lint + typecheck run as their own workspace tasks (`pnpm lint` / `pnpm
  // typecheck`) so the Next build stays a build.
  eslint: { ignoreDuringBuilds: true },
  // Workspace packages are plain TS/TSX + CSS — let Next compile them directly.
  transpilePackages: ['@aivoryx/ui', '@aivoryx/contracts', '@aivoryx/shared', '@aivoryx/config'],
  // Same-origin API proxy (opt-in: NEXT_PUBLIC_API_PROXY=true). The browser calls `/api/v1/*` on the
  // web origin and Next forwards it to the API, so the HTTP-only session cookie is FIRST-party to
  // the web site. Without it, a web app and API on different sites (vercel.app vs onrender.com)
  // depend on third-party cookies, which iOS Safari and privacy-hardened browsers silently drop.
  async rewrites() {
    if (process.env.NEXT_PUBLIC_API_PROXY !== 'true') return [];
    const target = (
      process.env.API_PROXY_TARGET ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      ''
    ).replace(/\/+$/, '');
    if (!target) return [];
    return [{ source: '/api/v1/:path*', destination: `${target}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
