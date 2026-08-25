# Sermon Import Specification

Defines the TinaCMS sermon collection schema and the exact rules for populating it from the three Google Drive source files.

---

## 1. Source Files (Google Drive)

All three files share the same base slug: `{date}-{slug}` (e.g. `2026-08-16-choosing-joy-in-weakness-habakkuk-3-17-19`).

| Folder | Extension | Contains |
|--------|-----------|----------|
| `comp-tax/` | `.json` | Taxonomy metadata — categories, tags, series, scripture ref |
| `enriched/` | `.md` | Frontmatter with media URLs + full transcript in Markdown body |
| `sermon-blocks/` | `.html` | Rendered sermon card — About panel, Notes panel, Transcript panel |

### 1.1 `comp-tax/{slug}.json`

```json
{
  "title": "Choosing Joy in Weakness: Habakkuk 3:17-19",
  "date": "2026-08-16",
  "url": "https://familychurch.online/sermons/{slug}",
  "edit_url": "...",
  "series": "Choosing Joy",
  "sermon_scripture": "Habakkuk 3:17-19 ESV",
  "category": ["Suffering & Hope", "Prayer & Worship"],
  "tags": [
    "Series: Choosing Joy",
    "Book: Habakkuk 3",
    "Ref: Philippians 4",
    "Ref: Luke 22",
    "God's Sovereignty",
    "Anxiety",
    "Choosing Joy"
  ],
  "review": false
}
```

**Notes:**
- `url` and `edit_url` are Squarespace-specific — discard, derive slug from filename.
- `tags` contains prefixed entries (`Series:`, `Book:`, `Ref:`) that duplicate dedicated fields. Strip those and keep only thematic tags (entries without a `Prefix:` pattern).

### 1.2 `enriched/{slug}.md`

```markdown
---
title: "Choosing Joy in Weakness: Habakkuk 3:17-19"
date: 2026-08-16
speaker: "Peter Stoffberg"
series: "Choosing Joy"
duration_minutes: 43.6
audio_url: "https://static1.squarespace.com/.../2026-08-16-choosing-joy....mp3"
image_url: "https://static1.squarespace.com/.../WhatsApp Image 2026-08-15....jpeg?format=1500w"
post_url: "https://familychurch.online/sermons/{slug}"
taxonomy: 2026-08-16-{slug}.json
vimeo_url: "https://player.vimeo.com/video/1218649455"
word_count: 5741
transcribed_by: "deepgram-nova-2"
---

# Choosing Joy in Weakness: Habakkuk 3:17-19

## Transcript

### When Everything Falls Apart

[00:00] Three seventeen to nineteen...

[00:25] God, the Lord is my strength...

### Survival Mode Takes Hold

[03:02] That's one way to deal with tragedy...
```

**Notes:**
- `post_url` and `taxonomy` are Squarespace/pipeline references — discard.
- `word_count` is auto-generated — carry through as read-only metadata.
- The body below the frontmatter is the **canonical transcript source**. Use it as-is for the MDX body.
- Strip the top-level `# Title` and `## Transcript` headings — these are redundant with frontmatter.
- Keep `### Section Headings` and all `[timestamp] paragraph` content.

### 1.3 `sermon-blocks/{slug}.html`

Structure (abbreviated):

```html
<!--
SERMON DESCRIPTION
==================

SHORT DESCRIPTION (40-60 words)
Habakkuk 3:17-19 ESV · Choosing Joy · 44 min
You've been running each day on autopilot, coping so long you've forgotten what
living feels like...

TAG LINE (10-18 words)
A snail frozen in its shell gets crushed anyway—so what makes you finally come out?
-->

<div class="sfc">

  <!-- Tab bar -->
  <div class="sfc-tabbar">
    <button data-tab="about">About</button>
    <button data-tab="notes">Sermon Notes</button>
    <button data-tab="transcript">Transcript</button>
  </div>

  <!-- ABOUT PANEL -->
  <div class="sfc-panel" data-panel="about">

    <div class="sfc-meta-strip">
      <span class="sfc-primary-ref">Habakkuk 3:17-19</span>
      <span class="sfc-primary-theme">Choosing joy when everything fails</span>
      <span class="sfc-duration">Choosing Joy · 16 August 2026 · 44 min · ESV</span>
    </div>

    <div class="sfc-subtitle">
      <p>Real joy is not the absence of hardship but the balance of your own
         weakness against God's sustaining strength.</p>
      <div class="sfc-pills">
        <span class="sfc-pill">Pastoral</span>
        <span class="sfc-pill">Intermediate</span>
      </div>
    </div>

    <div class="sfc-grid">
      <div class="sfc-col">
        <div class="sfc-col-label">What this is about</div>
        <p class="sfc-hook">What happens when the pressure never lifts...</p>
      </div>
      <div class="sfc-col">
        <div class="sfc-col-label">What you'll take away</div>
        <ul class="sfc-tags">
          <li>Spot the signs of survival mode...</li>
          <li>Balance your real frailty against God's power...</li>
        </ul>
      </div>
      <div class="sfc-col">
        <div class="sfc-col-label">This is for you if</div>
        <ul class="sfc-audience">
          <li>You've been coping so long...</li>
        </ul>
      </div>
    </div>

    <div class="sfc-scripture">
      <span class="sfc-label">Also</span>
      <div class="sfc-scripture-entry">
        <span class="sfc-ref">Philippians 4:4-9</span>
        <span class="sfc-theme">Rejoice, pray with thanksgiving</span>
      </div>
      <span class="sfc-sep">·</span>
      <div class="sfc-scripture-entry">
        <span class="sfc-ref">Hebrews 1:3</span>
        <span class="sfc-theme">Christ upholds all things</span>
      </div>
      <!-- more entries separated by sfc-sep -->
    </div>

  </div>

  <!-- NOTES PANEL -->
  <div class="sfc-panel" data-panel="notes">
    <div class="sfc-notes">

      <div class="sfc-notes-section">
        <div class="sfc-col-label">The Big Idea</div>
        <p>Hold your own weakness and God's sustaining strength together...</p>
      </div>

      <div class="sfc-notes-section sfc-notes-section--tinted">
        <div class="sfc-col-label">Key Scripture</div>
        <blockquote class="sfc-notes-quote">
          <p>Though the fig tree should not blossom...</p>
          <cite>Habakkuk 3:17-19 ESV</cite>
        </blockquote>
      </div>

      <div class="sfc-notes-section">
        <div class="sfc-col-label">Main Points</div>
        <ol class="sfc-notes-list">
          <li><strong>Face how weak you are.</strong> Escaping survival mode begins...</li>
          <li><strong>Balance weakness with God's strength.</strong> Once you've admitted...</li>
          <li><strong>Choose joy, then move.</strong> Joy is a deliberate decision...</li>
        </ol>
      </div>

      <div class="sfc-notes-section sfc-notes-section--tinted">
        <div class="sfc-col-label">Key Illustration</div>
        <p>A scuba diver who reaches neutral buoyancy neither sinks nor floats...</p>
      </div>

      <div class="sfc-notes-section">
        <div class="sfc-col-label">What This Means for Us</div>
        <ul class="sfc-notes-apply">
          <li>Name where you've slipped into survival mode...</li>
          <li>Trade worry for thanksgiving...</li>
          <li>Guard what fills your mind...</li>
        </ul>
      </div>

      <div class="sfc-notes-section sfc-notes-section--tinted">
        <div class="sfc-col-label">To Remember</div>
        <p class="sfc-notes-closing">You were never made to crawl through the valley
           on your belly—God gives feet like a deer to run on the heights.</p>
      </div>

      <div class="sfc-notes-section">
        <div class="sfc-col-label">Closing Prayer</div>
        <p>Father God, you're amazing. Thank you for your word...</p>
      </div>

    </div>
  </div>

  <!-- TRANSCRIPT PANEL -->
  <div class="sfc-panel" data-panel="transcript">
    <div class="sfc-notes">
      <div class="sfc-notes-section">
        <div class="sfc-col-label">When Everything Falls Apart</div>
        <p><span style="...">[00:00]</span> Three seventeen to nineteen...</p>
      </div>
      <!-- one sfc-notes-section per transcript section -->
    </div>
  </div>

</div>
```

**Notes:**
- The transcript panel mirrors the enriched MD body exactly. Use the MD body as source of truth; ignore the transcript panel in the HTML.
- `sfc-duration` format: `{series} · {day} {month} {year} · {duration} min · {translation}` — parse with regex if needed, but these values come from other fields anyway.
- `sfc-pill` entries: first pill = `style`, second pill = `level` (always in that order).
- Main points: `<strong>` content = point `title`, remaining text in the `<li>` = point `body`.
- Key Scripture: `<blockquote> > <p>` = `keyScriptureText`, `<blockquote> > <cite>` = `keyScriptureRef`.

---

## 2. Output File

**Path:** `src/content/sermons/{date}-{slug}.mdx`  
**Example:** `src/content/sermons/2026-08-16-choosing-joy-in-weakness-habakkuk-3-17-19.mdx`

The slug is taken directly from the Drive filename (strip the date prefix and extension).

---

## 3. MDX Frontmatter Schema

```yaml
---
# ── IDENTITY ──────────────────────────────────────────────────────────────────
title: "Choosing Joy in Weakness: Habakkuk 3:17-19"
date: 2026-08-16
speaker: "Peter Stoffberg"
series: "Choosing Joy"

# ── SCRIPTURE ─────────────────────────────────────────────────────────────────
scripture: "Habakkuk 3:17-19 ESV"       # ref + translation together
primaryTheme: "Choosing joy when everything fails"

additionalScriptures:
  - ref: "Philippians 4:4-9"
    theme: "Rejoice, pray with thanksgiving"
  - ref: "Hebrews 1:3"
    theme: "Christ upholds all things"

# ── MEDIA ─────────────────────────────────────────────────────────────────────
image: "https://static1.squarespace.com/..."   # kept as external URL for now
audioUrl: "https://static1.squarespace.com/...mp3"
vimeoUrl: "https://player.vimeo.com/video/1218649455"
durationMinutes: 43.6

# ── PRESENTATION COPY ─────────────────────────────────────────────────────────
tagLine: "A snail frozen in its shell gets crushed anyway—so what makes you finally come out?"
shortDescription: "You've been running each day on autopilot, coping so long you've forgotten what living feels like. That's survival mode, and staying there slowly kills you. Habakkuk names the same crushing loss—no crops, no income, no relief in sight—then makes a choice: he will rejoice. Admitting how weak you are and how strong God is lets you choose joy."
subtitle: "Real joy is not the absence of hardship but the balance of your own weakness against God's sustaining strength."
hook: "What happens when the pressure never lifts and you slowly realise you've stopped living and started merely surviving? Habakkuk stared at total ruin and still made a choice."

# ── STYLE ─────────────────────────────────────────────────────────────────────
style: "Pastoral"          # Expository | Pastoral | Topical | Evangelistic
level: "Intermediate"      # Introductory | Intermediate | Advanced

# ── ABOUT LISTS ───────────────────────────────────────────────────────────────
takeaways:
  - "Spot the signs of survival mode—social withdrawal, no plans, irritability, broken sleep"
  - "Balance your real frailty against God's power instead of pretending you're bulletproof"
  - "See how Jesus upholds both your body and your faith moment by moment"
  - "Turn anxiety into joy through thanksgiving, honest prayer, and one small risk"

audience:
  - "You've been coping so long you can't remember when you last felt truly alive"
  - "You wake up anxious about money, health, or a relationship that won't heal"
  - "You keep telling everyone you're fine while quietly running on empty"

# ── SERMON NOTES ──────────────────────────────────────────────────────────────
bigIdea: "Hold your own weakness and God's sustaining strength together, and you can stop merely surviving and choose joy—even before anything changes."

keyScriptureRef: "Habakkuk 3:17-19 ESV"
keyScriptureText: "Though the fig tree should not blossom, nor fruit be on the vines, the produce of the olive fail and the fields yield no food, the flock be cut off from the fold and there be no herd in the stalls, yet I will rejoice in the LORD; I will take joy in the God of my salvation. GOD, the Lord, is my strength; He makes my feet like the deer's; He makes me tread on my high places."

mainPoints:
  - title: "Face how weak you are."
    body: "Escaping survival mode begins with admitting your frailty and dropping the illusion that you're bulletproof and can just push through."
  - title: "Balance weakness with God's strength."
    body: "Once you've admitted your frailty, hold it against God's sustaining power—not one without the other."
  - title: "Choose joy, then move."
    body: "Joy is a deliberate decision worked out through gentleness, thanksgiving, and honest prayer—then one small step of risk at a time out of the shell."

keyIllustration: "A scuba diver who reaches neutral buoyancy neither sinks nor floats but hangs weightless, carried by the water and able to move with almost no effort. It pictures the peace of holding human weakness and God's strength in balance—no longer striving, simply held."

application:
  - "Name where you've slipped into survival mode, then take one small risk this week—call someone, try something new, get your head out of the shell."
  - "Trade worry for thanksgiving: in prayer, hand God the burdens you cannot carry and thank Him for what remains."
  - "Guard what fills your mind—step back from doom-scrolling and negativity, and go do something practical for someone else."

toRemember: "You were never made to crawl through the valley on your belly—God gives feet like a deer to run on the heights."

closingPrayer: "Father God, you're amazing. Thank you for your word..."

# ── TAXONOMY ──────────────────────────────────────────────────────────────────
categories:
  - "Suffering & Hope"
  - "Prayer & Worship"

tags:
  - "God's Sovereignty"
  - "Divine Providence"
  - "Human Frailty"
  - "Perseverance of the Saints"
  - "Survival Mode"
  - "Anxiety"
  - "Choosing Joy"
  - "Serving Others"
  - "Thanksgiving"

# ── METADATA ──────────────────────────────────────────────────────────────────
review: false
transcribedBy: "deepgram-nova-2"
wordCount: 5741
---

### When Everything Falls Apart

[00:00] Three seventeen to nineteen. Though the fig tree should not blossom...

### Survival Mode Takes Hold

[03:02] That's one way to deal with tragedy...
```

---

## 4. Field Mapping Table

| Output field | Source file | Source location | Transform |
|---|---|---|---|
| `title` | `comp-tax` JSON | `.title` | Use as-is |
| `date` | `comp-tax` JSON | `.date` | Use as-is |
| `speaker` | `enriched` MD | frontmatter `.speaker` | Use as-is |
| `series` | `comp-tax` JSON | `.series` | Use as-is |
| `scripture` | `comp-tax` JSON | `.sermon_scripture` | Use as-is (already includes translation) |
| `primaryTheme` | `sermon-blocks` HTML | `.sfc-primary-theme` text | Strip tags |
| `additionalScriptures[].ref` | `sermon-blocks` HTML | `.sfc-scripture-entry .sfc-ref` text | Strip tags |
| `additionalScriptures[].theme` | `sermon-blocks` HTML | `.sfc-scripture-entry .sfc-theme` text | Strip tags |
| `image` | `enriched` MD | frontmatter `.image_url` | Use as-is (external URL) |
| `audioUrl` | `enriched` MD | frontmatter `.audio_url` | Use as-is |
| `vimeoUrl` | `enriched` MD | frontmatter `.vimeo_url` | Use as-is |
| `durationMinutes` | `enriched` MD | frontmatter `.duration_minutes` | Use as-is |
| `tagLine` | `sermon-blocks` HTML | HTML comment, `TAG LINE` section | Strip label line, take text |
| `shortDescription` | `sermon-blocks` HTML | HTML comment, `SHORT DESCRIPTION` section | Strip first line (scripture · series · duration metadata), take remaining text |
| `subtitle` | `sermon-blocks` HTML | `sfc-subtitle > p` text (not inside `sfc-pills`) | Strip tags |
| `hook` | `sermon-blocks` HTML | `.sfc-hook` text | Strip tags |
| `style` | `sermon-blocks` HTML | `sfc-pills .sfc-pill:first-child` text | Strip tags |
| `level` | `sermon-blocks` HTML | `sfc-pills .sfc-pill:last-child` text | Strip tags |
| `takeaways[]` | `sermon-blocks` HTML | `.sfc-tags li` text | Strip tags, one entry per `<li>` |
| `audience[]` | `sermon-blocks` HTML | `.sfc-audience li` text | Strip tags, one entry per `<li>` |
| `bigIdea` | `sermon-blocks` HTML | Notes panel — `sfc-col-label "The Big Idea"` sibling `<p>` | Strip tags |
| `keyScriptureRef` | `sermon-blocks` HTML | Notes panel — `sfc-notes-quote > cite` | Strip tags |
| `keyScriptureText` | `sermon-blocks` HTML | Notes panel — `sfc-notes-quote > p` | Strip tags |
| `mainPoints[].title` | `sermon-blocks` HTML | Notes panel — `.sfc-notes-list li > strong` text | Strip tags |
| `mainPoints[].body` | `sermon-blocks` HTML | Notes panel — `.sfc-notes-list li` text minus `<strong>` | Strip tags, trim leading space |
| `keyIllustration` | `sermon-blocks` HTML | Notes panel — `sfc-col-label "Key Illustration"` sibling `<p>` | Strip tags |
| `application[]` | `sermon-blocks` HTML | Notes panel — `.sfc-notes-apply li` text | Strip tags, one entry per `<li>` |
| `toRemember` | `sermon-blocks` HTML | Notes panel — `.sfc-notes-closing` text | Strip tags |
| `closingPrayer` | `sermon-blocks` HTML | Notes panel — `sfc-col-label "Closing Prayer"` sibling `<p>` | Strip tags |
| `categories[]` | `comp-tax` JSON | `.category[]` | Use as-is |
| `tags[]` | `comp-tax` JSON | `.tags[]` filtered | Keep only entries that do NOT match `/^(Series|Book|Ref):\s/` |
| `review` | `comp-tax` JSON | `.review` | Use as-is |
| `transcribedBy` | `enriched` MD | frontmatter `.transcribed_by` | Use as-is |
| `wordCount` | `enriched` MD | frontmatter `.word_count` | Use as-is |
| **MDX body** | `enriched` MD | Body below frontmatter | Strip top-level `# Title` and `## Transcript` headings; keep `### Section` headings and all paragraphs |

---

## 5. HTML Parsing Rules

The HTML uses a consistent pattern for notes sections. To find any notes section by label:

```
section = find sfc-notes-section where sfc-col-label text === "{label}"
value   = section's next sibling element (p, blockquote, ol, or ul)
```

**Section labels and their expected element types:**

| Label | Element | Field |
|---|---|---|
| `The Big Idea` | `<p>` | `bigIdea` |
| `Key Scripture` | `<blockquote class="sfc-notes-quote">` | `keyScriptureText` + `keyScriptureRef` |
| `Main Points` | `<ol class="sfc-notes-list">` | `mainPoints[]` |
| `Key Illustration` | `<p>` | `keyIllustration` |
| `What This Means for Us` | `<ul class="sfc-notes-apply">` | `application[]` |
| `To Remember` | `<p class="sfc-notes-closing">` | `toRemember` |
| `Closing Prayer` | `<p>` | `closingPrayer` |

**Parsing the HTML comment block:**

```
comment = <!-- ... -->  (first HTML comment in the file)
sections = split comment on lines matching /^[A-Z ]+$/  (all-caps section headers)
SHORT DESCRIPTION → lines after "SHORT DESCRIPTION (40-60 words)"
  → skip first line (scripture · series · duration metadata)
  → join remaining lines as shortDescription
TAG LINE → single line after "TAG LINE (10-18 words)"
  → tagLine
```

---

## 6. MDX Body Transform

1. Parse the `enriched` MD file body (everything below the `---` frontmatter block).
2. Remove the first `# {title}` heading (H1).
3. Remove the `## Transcript` heading (H2).
4. Keep all `### {Section Name}` headings (H3) — these become the transcript section headings.
5. Keep all paragraphs. Timestamps (`[00:00]`) are plain text inline in paragraphs — leave them as-is.
6. Write the result as the MDX body (no wrapping component needed).

---

## 7. File Naming

```
Input files:  {date}-{slug}.json / .md / .html
Output file:  src/content/sermons/{date}-{slug}.mdx

slug = filename stem with date prefix removed
     = filename stem as-is (the date is part of the slug in this project)
```

Example: `2026-08-16-choosing-joy-in-weakness-habakkuk-3-17-19.*`  
→ `src/content/sermons/2026-08-16-choosing-joy-in-weakness-habakkuk-3-17-19.mdx`

---

## 8. Drive Folder IDs

| Folder | Drive ID |
|---|---|
| `sermon-blocks` | `1rmr23NQsNHYFstSSW2cyB2U2XMBOt39l` |
| `comp-tax` | `19f02nUtBL9xNQaTsECgKvEWkcyefgixy` |
| `enriched` | `1w2ADe6xQ-_0Hz2KvAHbmMTSK_7WNkALO` |

All three folders live under parent `1CO3qCLWKMV9ewHsp713VbmTf3uMA4xaK`.
