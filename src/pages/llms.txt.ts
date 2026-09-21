export const prerender = true;

import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
	const base = (site?.toString() ?? 'https://familychurch.online').replace(/\/$/, '');

	const body = `# Family Church Fourways

> A church community in Dainfern, Johannesburg — walking together in Christ, in faith, in family, and in everyday life. From first steps to life well lived, there's a place here for every age and every season to belong, grow, and not do life alone. Sunday services at 09h30 CAT.

## About

- [About Us](${base}/about): Who we are, our vision and values
- [Plan a Visit](${base}/services): Service times, location and what to expect
- [What We Believe](${base}/statement-of-faith): Our statement of faith and doctrinal positions

## Live Service

- [Watch & Listen Live](${base}/video): Live Sunday video stream and low-data audio-only option (Vimeo + Icecast)

## Sermons

- [Sermon Archive](${base}/sermons): Full archive of Sunday sermons with audio, filterable by series, topic, book of the Bible and year
- [Sermon RSS Feed](${base}/sermons/feed.xml): RSS/podcast feed of all sermons

## Daily Content

- [Daily Devotion](${base}/today): Redirects to today's devotion (UTC+2)
- [Devotion Archive](${base}/devotion/2026-09-21): Individual devotions at /devotion/YYYY-MM-DD
- [Devotion RSS Feed](${base}/devotion/feed.xml): RSS feed of daily devotions
- [Three Minutes](${base}/threeminutes): Short weekly encouragement articles

## Grow

- [Courses](${base}/courses): Interactive doctrine and discipleship courses with quizzes and progress tracking (requires registration)
- [Guides](${base}/guides): Long-form reference articles on faith and Christian living

## Community

- [Events](${base}/events): Upcoming church events and activities
- [Groups](${base}/groups): Small groups — filterable by day, time and area
- [Ministries](${base}/ministries): Kids Church, Teen Church, Friday Youth, Retirement Ministry, Sport

## Kids & Youth

- [Kids Church](${base}/kids-church): Weekly lessons for Pre-School (3–5), Junior (6–9) and Senior (10–12)
- [Amplify](${base}/amplify): Teen ministry lessons

## Other

- [What's Next](${base}/whats-next): Upcoming service schedule and announcements
- [Memorial](${base}/memorial): Memorial tribute pages
`;

	return new Response(body, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
