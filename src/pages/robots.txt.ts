export const prerender = true;

import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const sitemapUrl = new URL('sitemap-index.xml', site ?? 'https://familychurch.online');
  const body = `User-agent: *
Allow: /

Disallow: /admin/
Disallow: /edit/
Disallow: /tina-island/
Disallow: /api/
Disallow: /auth/
Disallow: /login
Disallow: /course-admin
Disallow: /cf-status
Disallow: /stream-dashboard

Sitemap: ${sitemapUrl}
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
