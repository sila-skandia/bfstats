/**
 * The server communities people search for by name ("Battlefield 1942 SiMPLE",
 * "CHASABA BF1942"), each with a stable page at /bf1942-servers/<slug>.
 *
 * One source for three consumers:
 *  - the page itself (Bf1942ServersV4.vue), which lists the live servers that match;
 *  - the router, for the title, description and JSON-LD;
 *  - the build (build/seoPrerender.js), which writes a static HTML copy of every
 *    page so a crawler gets the names, addresses and links without running the app,
 *    and adds the pages to sitemap.xml.
 *
 * Server names change ("*NEW* SiMPLE | BF1942" will lose its *NEW*), so a community
 * matches live servers by a name fragment, a host or a mod, never a full name.
 * `servers` is the list as last seen, for the static HTML only.
 * See features/seo-featured-servers/README.md.
 */

export const SITE = 'https://bfstats.io'
export const HUB_PATH = '/bf1942-servers'

export interface KnownServer {
  name: string
  /** Omitted for hosts on a dynamic address. */
  address?: string
  gameId: string
  country: string
}

export interface FeaturedCommunity {
  slug: string
  /** The name people search for. */
  name: string
  h1: string
  title: string
  description: string
  intro: string
  match: {
    /** Case-insensitive fragments of the server name. */
    names?: string[]
    /** Server IPs. */
    hosts?: string[]
    /** Mods, as gameId. */
    gameIds?: string[]
  }
  servers: KnownServer[]
}

/** gameId to the mod's name, for the mods these pages list. */
export const MOD_LABELS: Record<string, string> = {
  bf1942: 'Battlefield 1942',
  xpack1: 'Road to Rome',
  xpack2: 'Secret Weapons of WWII',
  dc_final: 'Desert Combat Final',
  fhsw: 'Forgotten Hope: Secret Weapon',
  fhsweurope: 'FHSW Europe',
}

export const modLabel = (gameId?: string | null): string =>
  (gameId && MOD_LABELS[gameId.toLowerCase()]) || gameId || 'Battlefield 1942'

export const COUNTRY_LABELS: Record<string, string> = {
  CA: 'Canada',
  DE: 'Germany',
  FR: 'France',
  JP: 'Japan',
  US: 'United States',
}

export const FEATURED_COMMUNITIES: FeaturedCommunity[] = [
  {
    slug: 'simple',
    name: 'SiMPLE',
    h1: 'SiMPLE Battlefield 1942 servers',
    title: 'SiMPLE BF1942 servers · live players and stats · bfstats.io',
    description:
      'SiMPLE Battlefield 1942 servers at 37.187.92.162: vanilla BF1942 on 14567 and Road to Rome + Secret Weapons on 14568. Live players, current map and stats.',
    intro:
      'SiMPLE runs a family of Battlefield 1942 servers from France: vanilla BF1942, Road to Rome with Secret Weapons, new maps and a tank server.',
    match: { names: ['SiMPLE |'], hosts: ['37.187.92.162'] },
    servers: [
      { name: '*NEW* SiMPLE | BF1942', address: '37.187.92.162:14567', gameId: 'bf1942', country: 'FR' },
      { name: '*NEW* SiMPLE | RtR+SW', address: '37.187.92.162:14568', gameId: 'xpack2', country: 'FR' },
      { name: '*NEW* SiMPLE | New Maps', address: '37.187.92.162:14569', gameId: 'bf1942', country: 'FR' },
      { name: '*NEW* SiMPLE | Tanks a lot!', address: '37.187.92.162:14571', gameId: 'bf1942', country: 'FR' },
    ],
  },
  {
    slug: 'moongamers',
    name: 'MoonGamers',
    h1: 'MoonGamers Battlefield 1942 server',
    title: 'MoonGamers BF1942 server · live players and stats · bfstats.io',
    description:
      'MoonGamers.com Battlefield 1942 server at 51.81.48.224:14567, running since 2004. Live players, current map, rankings and round history.',
    intro:
      'MoonGamers.com has run a Battlefield 1942 server since 2004. It is hosted in the United States and plays vanilla Battlefield 1942 maps.',
    match: { names: ['MoonGamers'], hosts: ['51.81.48.224'] },
    servers: [
      { name: 'MoonGamers.com | Est. 2004', address: '51.81.48.224:14567', gameId: 'bf1942', country: 'US' },
    ],
  },
  {
    slug: 'chasaba',
    name: 'CHASABA',
    h1: 'CHASABA Battlefield 1942 servers',
    title: 'CHASABA BF1942 servers · FHSW in Japan · bfstats.io',
    description:
      'CHASABA Main and Sub Battlefield 1942 servers, running Forgotten Hope: Secret Weapon from Japan. Live players, current map and stats.',
    intro:
      'CHASABA hosts Battlefield 1942 servers in Japan running Forgotten Hope: Secret Weapon (FHSW). The host address changes, so join from the in-game server list or the live address below.',
    match: { names: ['CHASABA'] },
    servers: [
      { name: 'CHASABA Main BF1942 Server', gameId: 'fhsw', country: 'JP' },
      { name: 'CHASABA Sub BF1942 Server', gameId: 'fhsw', country: 'JP' },
    ],
  },
  {
    slug: 'echo',
    name: 'ECHO',
    h1: 'ECHO Battlefield 1942 and Desert Combat servers',
    title: 'ECHO DC servers · Desert Combat BF1942 · bfstats.io',
    description:
      '-[ECHO]- Desert Combat Final server for North America at 51.222.249.54:14567, plus ECHO Battlefield 1942 in Europe. Live players, current map and stats.',
    intro:
      '-[ECHO]- runs Desert Combat Final for North America from Canada, and a Battlefield 1942 server in Europe.',
    match: { names: ['-[ECHO]-'] },
    servers: [
      { name: '-[ECHO]- DC | North America', address: '51.222.249.54:14567', gameId: 'dc_final', country: 'CA' },
      { name: '-[ECHO]- BF1942 | Europe', address: '57.129.118.115:14567', gameId: 'xpack1', country: 'DE' },
    ],
  },
  {
    slug: 'fhsw',
    name: 'FHSW',
    h1: 'FHSW servers: Forgotten Hope Secret Weapon for Battlefield 1942',
    title: 'FHSW servers · Forgotten Hope Secret Weapon BF1942 · bfstats.io',
    description:
      'Every live Forgotten Hope: Secret Weapon (FHSW) server for Battlefield 1942, including fhsw-europe.com and CHASABA. Live players, current map and stats.',
    intro:
      'Forgotten Hope: Secret Weapon is a Second World War mod for Battlefield 1942. These are the servers running it now, including the fhsw-europe.com server in Germany and the CHASABA servers in Japan.',
    match: { gameIds: ['fhsw', 'fhsweurope'], hosts: ['176.9.19.239'] },
    servers: [
      { name: 'FHSW 0.81+FHSWeu0.84 ! UPDATE !', address: '176.9.19.239:14567', gameId: 'fhsweurope', country: 'DE' },
      { name: 'CHASABA Main BF1942 Server', gameId: 'fhsw', country: 'JP' },
      { name: 'Kabu.server FHSW0.81', address: '163.43.113.199:14567', gameId: 'fhsw', country: 'JP' },
    ],
  },
]

export const HUB = {
  path: HUB_PATH,
  h1: 'Battlefield 1942 servers',
  title: 'BF1942 servers · live Battlefield 1942 server list · bfstats.io',
  description:
    'Battlefield 1942 servers people still play on: SiMPLE, MoonGamers, CHASABA, ECHO Desert Combat and FHSW. Live players, maps, addresses and stats.',
  intro:
    'The Battlefield 1942 servers with players on them most nights. Each page lists the live servers, who is on them and the address to join.',
}

export const communityBySlug = (slug: string): FeaturedCommunity | undefined =>
  FEATURED_COMMUNITIES.find(c => c.slug === slug)

export const communityPath = (c: FeaturedCommunity): string => `${HUB_PATH}/${c.slug}`

/** The URL of a server's own page, as the rest of the site links it. */
export const serverDetailPath = (name: string): string => `/v4/servers/detail/${encodeURIComponent(name)}`

interface MatchableServer {
  name: string
  ip?: string
  gameId?: string | null
}

export function matchesCommunity(c: FeaturedCommunity, s: MatchableServer): boolean {
  const name = s.name.toLowerCase()
  const { names = [], hosts = [], gameIds = [] } = c.match
  if (names.some(n => name.includes(n.toLowerCase()))) return true
  if (s.ip && hosts.includes(s.ip)) return true
  if (s.gameId && gameIds.includes(s.gameId.toLowerCase())) return true
  return false
}

/** The community a server belongs to, for linking a server page back to it. */
export const communityForServer = (s: MatchableServer): FeaturedCommunity | undefined =>
  FEATURED_COMMUNITIES.find(c => c.slug !== 'fhsw' && matchesCommunity(c, s))
    ?? FEATURED_COMMUNITIES.find(c => matchesCommunity(c, s))

/** schema.org JSON-LD for a community page: the page, and its servers as GameServer items. */
export function communityJsonLd(c: FeaturedCommunity): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: c.h1,
    description: c.description,
    url: `${SITE}${communityPath(c)}`,
    about: { '@type': 'VideoGame', name: 'Battlefield 1942' },
    breadcrumb: breadcrumbJsonLd([
      { name: 'Battlefield 1942 servers', path: HUB_PATH },
      { name: c.name, path: communityPath(c) },
    ]),
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: c.servers.map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'GameServer',
          name: s.name,
          url: `${SITE}${serverDetailPath(s.name)}`,
          game: { '@type': 'VideoGame', name: modLabel(s.gameId) },
          ...(s.address ? { identifier: s.address } : {}),
        },
      })),
    },
  }
}

export function hubJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: HUB.h1,
    description: HUB.description,
    url: `${SITE}${HUB_PATH}`,
    about: { '@type': 'VideoGame', name: 'Battlefield 1942' },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: FEATURED_COMMUNITIES.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.h1,
        url: `${SITE}${communityPath(c)}`,
      })),
    },
  }
}

function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${SITE}${it.path}`,
    })),
  }
}
