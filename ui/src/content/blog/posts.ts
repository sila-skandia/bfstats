/**
 * Blog posts: each is a folder under src/content/blog/<slug>/ holding
 * post.md and the images and clips it shows. The markdown becomes blocks the
 * post page draws with the same components as /battleview.
 * The format is in features/blog/README.md; /blog-post writes posts in it.
 */
import { Marked, type Token, type Tokens } from 'marked'
import { mediaKind, type ArticleMedia } from '@/components/v4/article/media'

export interface Figure {
  media: ArticleMedia
  label?: string
  caption?: string
}

export interface StepItem {
  head?: string
  blocks: Block[]
}

export interface Card {
  kicker?: string
  title?: string
  id: string
  blocks: Block[]
}

export type Block =
  | { type: 'heading'; level: number; html: string; id: string }
  | { type: 'html'; html: string }
  | { type: 'code'; code: string }
  | { type: 'figures'; figures: Figure[] }
  | { type: 'steps'; items: StepItem[] }
  | { type: 'cards'; cards: Card[] }
  | { type: 'note'; blocks: Block[] }
  | { type: 'missing'; file: string }

export interface PostMeta {
  slug: string
  title: string
  eyebrow: string
  lede: string
  /** Calendar date, YYYY-MM-DD. */
  date: string
  draft: boolean
  hero?: ArticleMedia
  heroLink?: string
  heroTitle?: string
  heroMeta?: string
  /** CSS object-position for the banner crop, e.g. "center 70%" */
  heroFocus?: string
  minutes: number
}

export interface Post extends PostMeta {
  blocks: Block[]
}

const SOURCES = import.meta.glob<string>('./*/post.md', { query: '?raw', import: 'default', eager: true })
const ASSETS = import.meta.glob<string>('./*/*.{jpg,jpeg,png,webp,gif,mp4,webm}', {
  query: '?url',
  import: 'default',
  eager: true,
})

/** Drafts show in `npm run dev` (and so in E2E). Production hides them, though their files still ship. */
const SHOW_DRAFTS = import.meta.env.DEV

const slugOf = (key: string) => key.split('/')[1]

const asset = (slug: string, file: string): string | undefined => ASSETS[`./${slug}/${file.replace(/^\.\//, '')}`]

const toMedia = (slug: string, file: string, alt: string): ArticleMedia | undefined => {
  const src = asset(slug, file)
  if (!src) return undefined
  const kind = mediaKind(file)
  const base = file.replace(/\.[^.]+$/, '')
  const poster = kind === 'video'
    ? asset(slug, `${base}-poster.jpg`) ?? asset(slug, `${base}-poster.webp`) ?? asset(slug, `${base}-poster.png`)
    : undefined
  return { kind, src, alt, poster }
}

const headingId = (text: string) =>
  text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) return { fields: {}, body: raw }
  const fields: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line)
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return { fields, body: raw.slice(m[0].length) }
}

function makeMarked(slug: string): Marked {
  const md = new Marked({ gfm: true })
  md.use({
    renderer: {
      link({ href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens)
        const external = /^https?:\/\//.test(href)
        const t = title ? ` title="${title}"` : ''
        return `<a href="${href}"${t}${external ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`
      },
      // An image inside a sentence: rare, but it should still find its file.
      image({ href, text }: Tokens.Image) {
        const src = asset(slug, href) ?? href
        return `<img src="${src}" alt="${text}" loading="lazy" style="max-width:100%">`
      },
    },
  })
  return md
}

/** A paragraph that holds nothing but images and clips becomes a row of figures. */
function figuresOf(slug: string, p: Tokens.Paragraph): Block | null {
  const inline = p.tokens.filter(t => !(t.type === 'text' && !t.raw.trim()) && t.type !== 'br')
  if (inline.length === 0 || !inline.every(t => t.type === 'image')) return null
  const figures: Figure[] = []
  for (const t of inline as Tokens.Image[]) {
    const media = toMedia(slug, t.href, t.text)
    if (!media) return { type: 'missing', file: t.href }
    const [label, caption] = t.title?.includes('|')
      ? t.title.split('|', 2).map(s => s.trim())
      : [undefined, t.title ?? undefined]
    figures.push({ media, label, caption })
  }
  return { type: 'figures', figures }
}

function toBlocks(md: Marked, slug: string, tokens: Token[]): Block[] {
  const out: Block[] = []
  const html = (t: Token) => out.push({ type: 'html', html: md.parser([t]) })

  for (const t of tokens) {
    switch (t.type) {
      case 'space':
        break
      case 'heading': {
        const h = t as Tokens.Heading
        out.push({ type: 'heading', level: h.depth, html: md.parseInline(h.text) as string, id: headingId(h.text) })
        break
      }
      case 'code':
        out.push({ type: 'code', code: (t as Tokens.Code).text })
        break
      case 'paragraph': {
        const f = figuresOf(slug, t as Tokens.Paragraph)
        if (f) out.push(f)
        else html(t)
        break
      }
      case 'list': {
        const list = t as Tokens.List
        if (!list.ordered) { html(t); break }
        out.push({
          type: 'steps',
          items: list.items.map(item => {
            // "1. **Install** the rest" puts "Install" on its own line, like the BattleView steps.
            const first = item.tokens[0] as Tokens.Text | undefined
            const lead = first?.tokens?.[0]
            if (first && lead?.type === 'strong') {
              const rest = first.text.slice(lead.raw.length).replace(/^[\s:.—-]+/, '')
              const restTokens: Token[] = rest ? md.lexer(rest) : []
              return {
                head: md.parseInline((lead as Tokens.Strong).text) as string,
                blocks: toBlocks(md, slug, [...restTokens, ...item.tokens.slice(1)]),
              }
            }
            return { blocks: toBlocks(md, slug, item.tokens) }
          }),
        })
        break
      }
      case 'blockquote': {
        const q = t as Tokens.Blockquote
        const card = /^\[!card\][ \t]*(.*)\n?/.exec(q.text)
        if (!card) { out.push({ type: 'note', blocks: toBlocks(md, slug, q.tokens) }); break }
        const inner = toBlocks(md, slug, md.lexer(q.text.slice(card[0].length)))
        const titleAt = inner.findIndex(b => b.type === 'heading')
        const title = titleAt === 0 ? (inner[0] as { html: string }).html : undefined
        const entry: Card = {
          kicker: card[1] || undefined,
          title,
          id: `card-${headingId(title ?? card[1] ?? String(out.length))}`,
          blocks: title ? inner.slice(1) : inner,
        }
        const prev = out[out.length - 1]
        // Cards one after another sit side by side, like the two recorders on /battleview.
        if (prev?.type === 'cards') prev.cards.push(entry)
        else out.push({ type: 'cards', cards: [entry] })
        break
      }
      case 'text': {
        // A tight list item's body.
        const tx = t as Tokens.Text
        out.push({ type: 'html', html: md.parseInline(tx.text) as string })
        break
      }
      default:
        html(t)
    }
  }
  return out
}

function wordCount(body: string) {
  return body.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length
}

function load(key: string, raw: string): Post {
  const slug = slugOf(key)
  const { fields, body } = parseFrontmatter(raw)
  const md = makeMarked(slug)
  const hero = fields.hero ? toMedia(slug, fields.hero, fields.heroAlt ?? fields.heroTitle ?? '') : undefined
  return {
    slug,
    title: fields.title ?? slug,
    eyebrow: fields.eyebrow ?? 'Blog',
    lede: fields.lede ?? '',
    date: fields.date ?? '',
    draft: fields.draft === 'true',
    hero,
    heroLink: fields.heroLink || undefined,
    heroTitle: fields.heroTitle || undefined,
    heroMeta: fields.heroMeta || undefined,
    heroFocus: fields.heroFocus || undefined,
    minutes: Math.max(1, Math.round(wordCount(body) / 220)),
    blocks: toBlocks(md, slug, md.lexer(body)),
  }
}

const ALL: Post[] = Object.entries(SOURCES)
  .map(([key, raw]) => load(key, raw))
  .filter(p => SHOW_DRAFTS || !p.draft)
  .sort((a, b) => b.date.localeCompare(a.date))

export const listPosts = (): PostMeta[] => ALL

export const getPost = (slug: string): Post | undefined => ALL.find(p => p.slug === slug)

/** A post's date is a calendar date, not an instant: shown as written, in the reader's language. */
export function formatPostDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('default', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d)
}
