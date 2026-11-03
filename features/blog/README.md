# Blog

`/blog` and `/blog/<slug>`: long-form posts on how bfstats.io and BattleView
were built, drawn like `/battleview`. Built 2026-11-02.

The owner writes a draft in plain text and runs `/blog-post <path>` (the skill
at [`.claude/skills/blog-post/SKILL.md`](../../.claude/skills/blog-post/SKILL.md)).
The skill turns it into a markdown file; the site does the rest. No post ever
needs Vue written for it.

## Where things live

| Path | What |
|---|---|
| `ui/src/content/blog/<slug>/post.md` | A post: frontmatter, then markdown |
| `ui/src/content/blog/<slug>/*.{jpg,png,webp,gif,mp4,webm}` | Its images and clips |
| `ui/src/content/blog/example-post/` | A draft that uses every piece of the format; the reference |
| `ui/src/content/blog/posts.ts` | Loads every post at build time and turns markdown into blocks |
| `ui/src/components/v4/article/` | The pieces BattleView and posts share |
| `ui/src/views/v4/BlogIndexV4.vue`, `BlogPostV4.vue` | The two pages |
| `ui/e2e/blog.spec.ts` | E2E, run against the example post |

Posts load with `import.meta.glob`, so adding a folder is the whole job: no
route, registry or import to edit. Drafts (`draft: true`) show under
`npm run dev`, and so in E2E. A production build hides them (not listed, and
their URL says "Post not found"), but their text and files still ship in the
bundle unlinked, so nothing secret goes in a draft.

## The format

Frontmatter: `title` and `date` (`YYYY-MM-DD`) are required; `lede`, `eyebrow`,
`draft`, `hero`, `heroAlt`, `heroLink`, `heroTitle`, `heroMeta`, `heroFocus` are optional.
A plain hero is a short 16:5 banner (5:2 on a phone) that fades into the page
and opens full screen on click; `heroFocus` (CSS `object-position`) picks the
crop. `heroLink` instead turns the hero into BattleView's 16:9 play-button link
to a recording.

The body is GitHub markdown, with these mapped to BattleView's pieces:

| Markdown | Drawn as |
|---|---|
| `## Heading`, `### Sub` | Display-font section headings with anchors |
| A paragraph holding only `![alt](file "Label \| caption")` | Figure(s) that open full screen; 2 or 3 sit side by side at 16:9 |
| `file.mp4` in a figure | A muted loop; `file-poster.jpg` beside it is its poster |
| ```` ``` ```` fenced code | Code block with a Copy button |
| `1. **Head** text` | Numbered steps with a heading line (`.mm-steps`) |
| `> [!card] Kicker` then `> ## Title` | Olive-topped card; consecutive cards pair up from 981px |
| `> plain quote` | Side note with an olive rule |
| Lists, tables, links, `---` | Plain prose styling (`.mm-prose`); external links open a new tab |

A figure whose file is not in the folder draws a red "Missing file" box in dev
and nothing in production.

Dates are calendar dates, not instants: they are formatted with
`Intl.DateTimeFormat('default', …, timeZone: 'UTC')` so a reader west of UTC
does not see the day before.

## Shared with BattleView

Moving BattleView onto shared parts was part of this work, so the two cannot
drift:

- `MmMediaFrame` (framed image or clip, opens full screen), `MmLightbox`,
  `MmCodeBlock`, `MmArticleHero` in `ui/src/components/v4/article/`.
- `.mm-prose`, `.mm-article-card`, `.mm-steps`, `.mm-figure`, `.mm-download`
  in `ui/src/styles/modern-minimal.css`.

## Open

- `/blog` is not in the sitemap or the header yet; the skill adds the sitemap
  entries when the first post is published. A header or footer link is the
  owner's call.
- Posts are not prerendered, so a crawler without JavaScript sees the empty
  shell. `ui/build/seoPrerender.js` could add them if search traffic matters.
