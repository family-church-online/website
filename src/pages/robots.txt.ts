export const prerender = true;

import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const sitemapUrl = new URL('sitemap-index.xml', site ?? 'https://familychurch.online');
  const body = `User-agent: *
Disallow: /

Sitemap: ${sitemapUrl}
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
