/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,

  // Same reason the engine disables Express's: announcing the framework tells
  // an attacker which advisory list to work through and tells a reader nothing.
  poweredByHeader: false,

  // Headers the console owes a browser.
  //
  // No Content-Security-Policy yet, and that is a decision rather than an
  // omission: antd renders inline styles and this app injects an inline theme
  // bootstrap before first paint, so a useful policy needs a nonce threaded
  // through both. A policy loose enough to permit `unsafe-inline` would say it
  // protects the page while protecting nothing. The framing, sniffing and
  // referrer rules below are worth having on their own and cost nothing.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // The console is a back office; there is no reason for anyone to
          // frame it, and every reason a clickjacker would want to.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Referrers carry ids in the path. Same-origin keeps them inside the
          // app rather than handing them to whatever a user clicks through to.
          { key: 'Referrer-Policy', value: 'same-origin' },
          // Nothing here needs a camera, a microphone or a location.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};
