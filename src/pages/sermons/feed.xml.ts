export const prerender = true;

import type { APIRoute } from 'astro';

const SITE_URL    = 'https://familychurch.online';
const FEED_URL    = `${SITE_URL}/sermons/feed.xml`;
const PODCAST_IMG = `${SITE_URL}/images/podcast-cover.jpg`;

interface SermonFrontmatter {
  title?: string;
  date?: string;
  speaker?: string;
  shortDescription?: string | null;
  audioUrl?: string | null;
  audioSizeBytes?: number | null;
  durationMinutes?: number | null;
  image?: string | null;
  scripture?: string;
  guid?: string | null;
  series?: string | null;
  review?: boolean;
}

const modules = import.meta.glob<{ frontmatter: SermonFrontmatter }>(
  '../../content/sermons/*.mdx',
  { eager: true }
);

const sermons = Object.entries(modules)
  .map(([path, mod]) => ({
    slug: path.replace('../../content/sermons/', '').replace('.mdx', ''),
    ...mod.frontmatter,
  }))
  .filter(s => !s.review && s.audioUrl)
  .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

function fmtDuration(minutes: number | null | undefined): string {
  if (!minutes) return '00:00';
  const total = Math.round(minutes * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function rssDate(dateStr: string): string {
  const d = new Date(dateStr);
  const localNoon = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
  return localNoon.toUTCString();
}

function xmlEscape(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const items = sermons.map(s => {
  const pageUrl    = `${SITE_URL}/sermons/${s.slug}`;
  const encLength  = s.audioSizeBytes ? ` length="${s.audioSizeBytes}"` : '';
  const imgTag     = s.image?.startsWith('http') ? `\n      <itunes:image href="${xmlEscape(s.image)}"/>` : '';
  const guid       = s.guid ?? pageUrl;
  const isPermaLink = s.guid ? 'false' : 'true';
  return `
    <item>
      <title>${xmlEscape(s.title)}</title>
      <link>${pageUrl}</link>
      <guid isPermaLink="${isPermaLink}">${xmlEscape(guid)}</guid>
      <pubDate>${rssDate(s.date ?? '')}</pubDate>
      <description><![CDATA[${s.shortDescription ?? s.title ?? ''}]]></description>
      <enclosure url="${xmlEscape(s.audioUrl)}"${encLength} type="audio/mpeg"/>
      <itunes:title>${xmlEscape(s.title)}</itunes:title>
      <itunes:author>${xmlEscape(s.speaker ?? 'Family Church')}</itunes:author>
      <itunes:summary><![CDATA[${s.shortDescription ?? s.title ?? ''}]]></itunes:summary>
      <itunes:subtitle>${xmlEscape(s.scripture ?? '')}</itunes:subtitle>${imgTag}
      <itunes:duration>${fmtDuration(s.durationMinutes)}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
      <itunes:episodeType>full</itunes:episodeType>
    </item>`;
}).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">

  <channel>
    <title>Family Church Sermons</title>
    <link>${SITE_URL}</link>
    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml"/>
    <description>Sunday sermons from Family Church, Fourways.</description>
    <language>en</language>
    <copyright>Family Church</copyright>
    <itunes:author>Family Church</itunes:author>
    <itunes:owner>
      <itunes:name>Family Church</itunes:name>
      <itunes:email>fourwaysfamilychurch@gmail.com</itunes:email>
    </itunes:owner>
    <itunes:category text="Religion &amp; Spirituality">
      <itunes:category text="Christianity"/>
    </itunes:category>
    <itunes:image href="${PODCAST_IMG}"/>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
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
