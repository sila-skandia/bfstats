# SEO for the servers people search for by name

Goal: a search for "Battlefield 1942 SiMPLE", "CHASABA BF1942", "ECHO DC",
"FHSW servers" or just "BF1942 servers" lands on bfstats.io.

## The problem (2026-11-01)

The site is a client-rendered SPA. Every URL answered with the same
`index.html`: one title ("Battlefield 1942 player and server stats"), a
description that still advertised FH2 and BF Vietnam, and an empty `#app`.
Titles, descriptions and canonicals were only set by the router after the
bundle ran. Server pages live at `/v4/servers/detail/<full name>`, so a name
change ("*NEW* SiMPLE | BF1942" losing its *NEW*) moves the URL. The sitemap
listed three `/servers/*` URLs that only redirect, and no server at all.

## What was built

- **Name-first pages.** `/bf1942-servers` (hub) and
  `/bf1942-servers/{simple,moongamers,chasaba,echo,fhsw}`. Each lists the live
  servers that match it, with address, mod, country, map and players, and
  links to each server's own page. Stable URLs: communities match live servers
  by name fragment, host or mod, never a full name.
  View: `ui/src/views/v4/Bf1942ServersV4.vue`.
- **One source of truth**: `ui/src/seo/featuredServers.ts`. Names, slugs,
  copy, match rules, the servers as last seen, and the JSON-LD builders.
- **Static HTML at build time**: `ui/build/seoPrerender.js` (a Vite plugin)
  writes `dist/bf1942-servers/**/index.html`, each with its own title,
  description, canonical, Open Graph, JSON-LD (`CollectionPage` + `ItemList`
  of `GameServer`) and the heading, intro, names, addresses and links as plain
  HTML in `#app`. Vue replaces that markup on mount. nginx serves the file for
  the path (`location /bf1942-servers` in `ui/nginx.conf`, same cache header
  as `index.html`, since the copies name hashed bundles).
- **Sitemap**: the build writes the hub, the five pages and every featured
  server's own page at the `<!-- featured-servers -->` marker in
  `ui/public/sitemap.xml`. The redirecting `/servers/*` and `/players`
  entries were replaced by the URLs they redirect to.
- **Router head handling** (`ui/src/router/index.ts`): `meta.jsonLd` writes or
  removes `#seo-jsonld`; `meta.noindex` sets the robots tag (round reports and
  unknown community slugs).
- **Server pages**: title "<name> · Battlefield 1942 server · bfstats.io" and a
  description naming the server. A featured server's page links back to its
  community ("SiMPLE servers →").
- **Sitewide**: index.html title, description and keywords lead with
  "BF1942 servers" and the community names; the footer links "BF1942 servers"
  to the hub on every page.

## Keeping it current

When a community renames or moves a server, update its `servers` list in
`featuredServers.ts` (only the static copy and sitemap use it; the live page
follows the match rules). To feature another community, add an entry; the
route, prerender and sitemap follow.

## Checked

- `vite build` writes six pages; sitemap has 21 URLs and passes `xmllint`.
- The production nginx image serves `/bf1942-servers`, `/bf1942-servers/` and
  `/bf1942-servers/simple` with their own titles and the no-store-in-browser
  cache header; an unknown slug falls back to the app.
- In a browser against the production API: live rows on every page, canonical
  matches the sitemap URL for server pages, no horizontal scroll at 375px.
- E2E: `ui/e2e/featured-servers.spec.ts`.

## Open

- After deploy: submit `https://bfstats.io/sitemap.xml` in Google Search
  Console and Bing Webmaster Tools, and request indexing of the six pages.
- Server pages for every other server are still client-rendered only.
