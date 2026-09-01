export const prerender = true;

import type { APIRoute } from 'astro';

const SITE_URL = 'https://familychurch.online';
const FEED_URL = `${SITE_URL}/devotion/feed.xml`;
const COVER    = `${SITE_URL}/images/logo-stone.png`;

interface DevotionFrontmatter {
  title?: string;
  date?: string;
  image?: string | null;
  reflection?: string | null;
  keyScripture?: { ref?: string; text?: string } | null;
}

const modules = import.meta.glob<{ frontmatter: DevotionFrontmatter }>(
  '../../content/devotion/*.mdx',
  { eager: true },
);

const devotions = Object.entries(modules)
  .map(([path, mod]) => ({
    date: path.replace('../../content/devotion/', '').replace('.mdx', ''),
    ...mod.frontmatter,
  }))
  .filter(d => d.date && d.title)
  .sort((a, b) => b.date.localeCompare(a.date));

function rssDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toUTCString();
}

function xmlEscape(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function description(d: typeof devotions[0]): string {
  const parts: string[] = [];
  if (d.keyScripture?.ref && d.keyScripture?.text) {
    parts.push(`${d.keyScripture.ref} — ${d.keyScripture.text}`);
  }
  if (d.reflection) {
    const snippet = d.reflection.replace(/\n+/g, ' ').trim().substring(0, 300);
    parts.push(snippet + (d.reflection.length > 300 ? '…' : ''));
  }
  return parts.join('\n\n') || d.title || '';
}

const items = devotions.map(d => {
  const url = `${SITE_URL}/devotion/${d.date}`;
  const img = d.image
    ? `\n      <enclosure url="${xmlEscape(d.image.startsWith('http') ? d.image : SITE_URL + d.image)}" length="0" type="image/jpeg"/>`
    : '';
  return `
    <item>
      <title>${xmlEscape(d.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${rssDate(d.date)}</pubDate>
      <description><![CDATA[${description(d)}]]></description>${img}
    </item>`;
}).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">

  <channel>
    <title>Family Church Daily Devotions</title>
    <link>${SITE_URL}</link>
    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml"/>
    <description>Daily devotions from Family Church, Fourways — Scripture, reflection, and prayer.</description>
    <language>en</language>
    <copyright>Family Church</copyright>
    <image>
      <url>${COVER}</url>
      <title>Family Church Daily Devotions</title>
      <link>${SITE_URL}</link>
    </image>
${items}
  </channel>
</rss>`;

export const GET: APIRoute = () =>
  new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
