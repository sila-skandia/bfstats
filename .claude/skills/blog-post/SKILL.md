---
name: blog-post
description: >
  Turn the owner's draft (a text or markdown file, or text pasted in chat) into
  a post on the bfstats.io blog at /blog/<slug>, drawn like the /battleview
  page. Use it whenever the owner says "here's a blog post", "format this for
  the blog", "add this to the blog", "new post", runs /blog-post with a path,
  or asks to edit, add images to, publish or unpublish an existing post.
---

# Blog post

Posts are markdown files the site renders itself. You never write Vue for a
post: you write `ui/src/content/blog/<slug>/post.md` and put its images and
clips in the same folder. The look (hero, figures that open full screen, code
with Copy, olive-topped cards, numbered steps) comes from shared components, so
every post matches /battleview without asking.

Read first, every time:

- `ui/src/content/blog/example-post/post.md`, which uses every piece the format
  has. Copy its patterns; it is the reference.
- `features/blog/README.md` for the format rules and where the code lives.

## Steps

1. **Read the draft whole.** The owner's words are the post. Keep their voice,
   jokes and sentence order. Fix typos and obvious grammar slips only, and list
   each one you changed in your reply. Anything bigger (cutting a section,
   rewording a claim, reordering) is a suggestion in your reply, not an edit.

2. **Pick the slug and frontmatter.** The slug is short, lowercase and
   hyphenated, from the title (`how-i-built-the-recorder`). Frontmatter keys:

   | Key | Required | What it is |
   |---|---|---|
   | `title` | yes | The h1 |
   | `eyebrow` | no | Small label above the title; defaults to "Blog" |
   | `lede` | yes | One or two sentences under the title, also the summary on /blog |
   | `date` | yes | `YYYY-MM-DD`, the day it is published (today unless told) |
   | `draft` | no | `true` keeps it out of production builds |
   | `hero` | no | File in the post folder, drawn large under the lede |
   | `heroAlt` | with hero | Alt text for the hero |
   | `heroLink` | no | Makes the hero a link with a play button (a recording to watch) |
   | `heroTitle`, `heroMeta` | no | The hero's caption: a title, then a small uppercase line |

   New posts start with `draft: true`. Remove it only when the owner says to
   publish.

3. **Map the draft's structure onto the format.**
   - Sections become `##`, sub-sections `###`.
   - Procedures become a numbered list. Start an item with `**Head**` to give
     the step a heading line, as on /battleview.
   - Commands and config become fenced code blocks; they get a Copy button.
   - An aside, warning or "for X people" box becomes `> [!card] Kicker` with
     a `## Title` line inside. Two cards in a row sit side by side.
   - A plain `>` quote is a side note with an olive rule.
   - Media goes on its own line: `![alt text](file.jpg "Label | caption")`.
     Two or three on one line (space between) sit side by side and are cropped
     to 16:9; one alone keeps its own shape. `.mp4` and `.webm` loop silently;
     `<name>-poster.jpg` beside a clip is its poster.

4. **Collect the media.** For every image or clip the draft names or implies
   ("screenshot of Ghidra here"), get the file: a path the owner gave, a file
   in the repo (`ui/src/assets/battleview/` has stills and clips), or ask.
   Never invent a picture. Then, in the post folder:
   - Images: at most 1600 px wide, JPEG quality ~80 (`ffmpeg -i in.png -vf
     "scale='min(1600,iw)':-2" -q:v 4 out.jpg`). Keep PNG only for UI shots
     with small text.
   - Clips: H.264, no audio, at most 1280 px wide, under ~1.5 MB, with
     `-movflags +faststart`; make the poster from the first frame.
   - Write alt text that says what is in the picture, not "screenshot".
   A missing file draws a red "Missing file" box in dev, so you will see it.

5. **No emojis**, anywhere in the post (project rule). A country flag marking
   a server's location in a table is the only exception.

6. **Check it in the browser.** Start the `ui` preview, open
   `/blog/<slug>` and `/blog`, and look at the whole post at desktop width and
   at the mobile preset: no sideways scroll, every figure loads, a figure
   opens full screen and Escape closes it. Send the owner a screenshot.

7. **Run** `./scripts/verify.sh --skip-e2e` from the repo root, plus
   `./scripts/verify.sh e2e/blog.spec.ts --project=chromium`.

8. **Publishing** (only when asked): remove `draft: true`, and add
   `https://bfstats.io/blog/<slug>` to `ui/public/sitemap.xml` after the
   BattleView entry (add `https://bfstats.io/blog` too if it is not there yet;
   it stays out until the first post is live). If the post is about
   BattleView, offer a link to it from `ui/src/views/v4/BattleViewV4.vue`.
   Commit and push only when the owner says so.

## Reply

Lead with the link (`/blog/<slug>`) and whether it is a draft. Then the list
of typo fixes, any suggestions, and any media you still need from the owner.
