/**
 * Static HTML for the featured server pages (/bf1942-servers and each
 * community), written next to index.html after `vite build`.
 *
 * The app is client-rendered, so without this every URL answers with the same
 * index.html: one title, one description, an empty #app. A crawler that does not
 * run the bundle, or has not yet, sees nothing about SiMPLE or MoonGamers. Each
 * copy here carries its own title, description, canonical, Open Graph and JSON-LD,
 * plus the heading, intro, server names, addresses and links as plain HTML inside
 * #app. Vue replaces that markup on mount with the live page, which says the same.
 *
 * nginx serves dist/<path>/index.html for /<path> (ui/nginx.conf). The pages are
 * also added to dist/sitemap.xml at the <!-- featured-servers --> marker.
 * features/seo-featured-servers/README.md
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  FEATURED_COMMUNITIES,
  HUB,
  SITE,
  communityJsonLd,
  communityPath,
  hubJsonLd,
  modLabel,
  serverDetailPath,
  COUNTRY_LABELS,
} from '../src/seo/featuredServers.ts'

const esc = s =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = `<style>
  .mm-preload { min-height: 0; }
  .mm-prerender { max-width: 1100px; margin: 0 auto; padding: 32px; color: #c8c8c8; font-size: 15px; line-height: 1.6; }
  .mm-prerender h1 { color: #fff; font-weight: 400; font-size: 34px; margin: 0 0 12px; }
  .mm-prerender h2 { color: #fff; font-weight: 400; font-size: 20px; margin: 28px 0 8px; }
  .mm-prerender a { color: #9aa666; }
  .mm-prerender code { color: #fff; }
</style>`

function setMeta(html, attr, key, content) {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`)
  if (re.test(html)) return html.replace(re, `$1${esc(content)}$2`)
  return html.replace('</head>', `  <meta ${attr}="${key}" content="${esc(content)}">\n  </head>`)
}

/** index.html, re-headed and with `body` inside #app, for one page. Exported for the test. */
export function renderPage(baseHtml, { path, title, description, jsonLd, body }) {
  const url = `${SITE}${path}`
  let html = baseHtml.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
  html = setMeta(html, 'name', 'description', description)
  html = setMeta(html, 'property', 'og:title', title)
  html = setMeta(html, 'property', 'og:description', description)
  html = setMeta(html, 'property', 'og:url', url)
  html = setMeta(html, 'name', 'twitter:title', title)
  html = setMeta(html, 'name', 'twitter:description', description)
  html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
  // `<` escaped so a name can never close the script element.
  const ld = JSON.stringify(jsonLd).replace(/</g, '\\u003c')
  html = html.replace(
    '</head>',
    `  <script type="application/ld+json" id="seo-jsonld">${ld}</script>\n  ${STYLE}\n  </head>`,
  )
  // Into #app, after the pre-mount skeleton: the last </div> before </body>.
  const close = html.lastIndexOf('</div>', html.indexOf('</body>'))
  if (close < 0 || !html.includes('<div id="app">')) throw new Error('seoPrerender: no #app in index.html')
  return `${html.slice(0, close)}<main class="mm-prerender">${body}</main>\n    ${html.slice(close)}`
}

const country = code => COUNTRY_LABELS[code] ?? code

function communityBody(c) {
  const rows = c.servers
    .map(s => {
      const bits = [s.address ? `<code>${esc(s.address)}</code>` : null, esc(modLabel(s.gameId)), esc(country(s.country))]
      return `<li><a href="${esc(serverDetailPath(s.name))}">${esc(s.name)}</a> · ${bits.filter(Boolean).join(' · ')}</li>`
    })
    .join('\n')
  const others = FEATURED_COMMUNITIES.filter(o => o.slug !== c.slug)
    .map(o => `<li><a href="${communityPath(o)}">${esc(o.h1)}</a></li>`)
    .join('\n')
  return `
<nav aria-label="Breadcrumb"><a href="${HUB.path}">Battlefield 1942 servers</a> / ${esc(c.name)}</nav>
<h1>${esc(c.h1)}</h1>
<p>${esc(c.intro)}</p>
<h2>Servers</h2>
<ul>
${rows}
</ul>
<h2>More Battlefield 1942 servers</h2>
<ul>
${others}
<li><a href="/v4/servers/bf1942">Every live Battlefield 1942 server</a></li>
</ul>`
}

function hubBody() {
  const items = FEATURED_COMMUNITIES.map(
    c => `<li><a href="${communityPath(c)}">${esc(c.h1)}</a>: ${esc(c.intro)}</li>`,
  ).join('\n')
  return `
<h1>${esc(HUB.h1)}</h1>
<p>${esc(HUB.intro)}</p>
<ul>
${items}
</ul>
<p>Every server, live: <a href="/v4/servers/bf1942">the full Battlefield 1942 server list</a>.</p>`
}

/** Every prerendered page: path and contents. Exported for the test. */
export function pages() {
  return [
    { path: HUB.path, title: HUB.title, description: HUB.description, jsonLd: hubJsonLd(), body: hubBody() },
    ...FEATURED_COMMUNITIES.map(c => ({
      path: communityPath(c),
      title: c.title,
      description: c.description,
      jsonLd: communityJsonLd(c),
      body: communityBody(c),
    })),
  ]
}

/** <url> entries for the sitemap: the pages, then each featured server's own page. */
export function sitemapEntries() {
  const entry = (loc, changefreq, priority) =>
    `  <url>\n    <loc>${esc(`${SITE}${loc}`)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
  const servers = [...new Set(FEATURED_COMMUNITIES.flatMap(c => c.servers.map(s => s.name)))]
  return [
    entry(HUB.path, 'daily', '0.9'),
    ...FEATURED_COMMUNITIES.map(c => entry(communityPath(c), 'daily', '0.9')),
    ...servers.map(n => entry(serverDetailPath(n), 'hourly', '0.8')),
  ].join('\n\n')
}

export default function seoPrerender() {
  let outDir = 'dist'
  return {
    name: 'bfstats-seo-prerender',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const base = readFileSync(join(outDir, 'index.html'), 'utf8')
      for (const page of pages()) {
        const dir = join(outDir, page.path)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'index.html'), renderPage(base, page))
      }
      const sitemapPath = join(outDir, 'sitemap.xml')
      const sitemap = readFileSync(sitemapPath, 'utf8')
      const marker = '<!-- featured-servers -->'
      if (!sitemap.includes(marker)) throw new Error(`seoPrerender: ${marker} missing from sitemap.xml`)
      writeFileSync(sitemapPath, sitemap.replace(marker, `${marker}\n${sitemapEntries()}`))
    },
  }
}
