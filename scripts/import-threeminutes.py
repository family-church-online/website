#!/usr/bin/env python3
"""Import Three Minutes articles from Squarespace JSON export into MDX files."""

import json
import os
import re
from datetime import datetime, timezone

INPUT = os.path.expanduser('~/three-minutes.json')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '../src/content/threeminutes')


def ms_to_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%d')


def strip_html(html: str) -> str:
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
    html = re.sub(r'<[^>]+>', '', html)
    html = html.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<') \
               .replace('&gt;', '>').replace('&quot;', '"').replace('&#x27;', "'") \
               .replace('&apos;', "'").replace('&#39;', "'")
    return re.sub(r'\s+', ' ', html).strip()


def html_to_md(html: str) -> str:
    """Convert Squarespace body HTML to plain Markdown paragraphs."""
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)

    # Extract paragraphs and headings from the layout soup
    chunks = []
    for tag, pattern in [
        ('h1', re.compile(r'<h1[^>]*>(.*?)</h1>', re.DOTALL)),
        ('h2', re.compile(r'<h2[^>]*>(.*?)</h2>', re.DOTALL)),
        ('p',  re.compile(r'<p[^>]*>(.*?)</p>',  re.DOTALL)),
    ]:
        for m in pattern.finditer(html):
            content = m.group(1)
            # Inline formatting
            content = re.sub(r'<strong[^>]*>(.*?)</strong>', r'**\1**', content, flags=re.DOTALL)
            content = re.sub(r'<b[^>]*>(.*?)</b>',          r'**\1**', content, flags=re.DOTALL)
            content = re.sub(r'<em[^>]*>(.*?)</em>',         r'*\1*',  content, flags=re.DOTALL)
            content = re.sub(r'<i[^>]*>(.*?)</i>',           r'*\1*',  content, flags=re.DOTALL)
            content = re.sub(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', r'[\2](\1)', content, flags=re.DOTALL)
            content = re.sub(r'<[^>]+>', '', content)
            content = content.replace('&nbsp;', ' ').replace('&amp;', '&') \
                             .replace('&lt;', '<').replace('&gt;', '>') \
                             .replace('&quot;', '"').replace('&#x27;', "'") \
                             .replace('&apos;', "'").replace('&#39;', "'")
            content = re.sub(r'\s+', ' ', content).strip()
            if content:
                prefix = '## ' if tag == 'h2' else ('# ' if tag == 'h1' else '')
                chunks.append((m.start(), prefix + content))

    # Sort by position in original HTML so order is preserved
    chunks.sort(key=lambda x: x[0])
    result = '\n\n'.join(text for _, text in chunks)
    # Convert bare <https://...> autolinks to Markdown links (invalid in MDX)
    result = re.sub(r'<(https?://[^>]+)>', r'[\1](\1)', result)
    return result


def yaml_str(s: str) -> str:
    """Wrap a string value safely for YAML frontmatter."""
    s = s.replace('\\', '\\\\').replace('"', '\\"')
    return f'"{s}"'


os.makedirs(OUTPUT_DIR, exist_ok=True)

with open(INPUT) as f:
    data = json.load(f)

for item in data['items']:
    slug = item.get('urlId', '').strip().lstrip('-')
    if not slug:
        print(f'SKIP: no slug for {item.get("title")}')
        continue

    title = strip_html(item.get('title', '')).strip('. ​')
    date  = ms_to_iso(item['publishOn']) if item.get('publishOn') else ''
    image = item.get('assetUrl', '')
    desc  = strip_html(item.get('excerpt', ''))
    body  = html_to_md(item.get('body', ''))

    mdx = f"""\
---
title: {yaml_str(title)}
date: "{date}"
image: {yaml_str(image)}
description: {yaml_str(desc)}
---

{body}
"""

    path = os.path.join(OUTPUT_DIR, f'{slug}.mdx')
    with open(path, 'w') as f:
        f.write(mdx)
    print(f'  {slug}.mdx  —  {title}')

print(f'\nDone. {len(data["items"])} articles written to src/content/threeminutes/')
