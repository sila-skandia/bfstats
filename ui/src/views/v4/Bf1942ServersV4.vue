<script setup lang="ts">
/**
 * /bf1942-servers and /bf1942-servers/:slug. Stable, name-first pages for the
 * server communities people search for, listing their live servers. The build
 * writes a static copy of each for crawlers (build/seoPrerender.js), so the
 * names, addresses and links here should match that copy.
 * features/seo-featured-servers/README.md
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fetchAllServers, peekCachedLiveServers } from '@/services/serverDetailsService'
import type { ServerSummary } from '@/types/server'
import {
  COUNTRY_LABELS,
  FEATURED_COMMUNITIES,
  HUB,
  communityBySlug,
  communityPath,
  matchesCommunity,
  modLabel,
  serverDetailPath,
  type FeaturedCommunity,
} from '@/seo/featuredServers'

const route = useRoute()

const live = ref<ServerSummary[] | null>(peekCachedLiveServers()?.servers ?? null)
const loadFailed = ref(false)

const load = async () => {
  try {
    live.value = (await fetchAllServers('bf1942')).servers
    loadFailed.value = false
  } catch {
    loadFailed.value = true
  }
}
onMounted(load)

const community = computed<FeaturedCommunity | undefined>(() =>
  typeof route.params.slug === 'string' ? communityBySlug(route.params.slug) : undefined,
)
const isHub = computed(() => !route.params.slug)
watch(() => route.params.slug, () => { if (!live.value) load() })

const liveFor = (c: FeaturedCommunity): ServerSummary[] =>
  (live.value ?? [])
    .filter(s => matchesCommunity(c, s))
    .sort((a, b) => (b.numPlayers || 0) - (a.numPlayers || 0))

const playersFor = (c: FeaturedCommunity) =>
  liveFor(c).reduce((n, s) => n + (s.numPlayers || 0), 0)

const liveServers = computed(() => (community.value ? liveFor(community.value) : []))

/** Servers last seen for this community that are not in the live feed now. */
const missingServers = computed(() => {
  const c = community.value
  if (!c || !live.value) return c?.servers ?? []
  const names = new Set(liveServers.value.map(s => s.name))
  const addrs = new Set(liveServers.value.map(s => `${s.ip}:${s.port}`))
  return c.servers.filter(k => !names.has(k.name) && !(k.address && addrs.has(k.address)))
})

const others = computed(() => FEATURED_COMMUNITIES.filter(c => c.slug !== community.value?.slug))

const serverCount = (n: number) => (n === 1 ? '1 server' : `${n} servers`)

const country = (code?: string) => (code ? COUNTRY_LABELS[code.toUpperCase()] ?? code.toUpperCase() : '')
</script>

<template>
  <div class="mm-container mm-section fs">
    <!-- Hub -->
    <template v-if="isHub">
      <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 8px">Server list</div>
      <h1 class="mm-display">{{ HUB.h1 }}</h1>
      <p class="fs__lede">{{ HUB.intro }}</p>

      <ul class="fs-hub" data-testid="featured-communities">
        <li v-for="c in FEATURED_COMMUNITIES" :key="c.slug">
          <router-link :to="communityPath(c)" class="fs-hub__card">
            <span class="fs-hub__name">{{ c.h1 }}</span>
            <span class="fs-hub__intro">{{ c.intro }}</span>
            <span class="fs-hub__meta">
              <template v-if="live && liveFor(c).length">
                <span :class="playersFor(c) > 0 ? 'fs-dot fs-dot--on' : 'fs-dot'" aria-hidden="true" />
                {{ playersFor(c) }} playing · {{ serverCount(liveFor(c).length) }}
              </template>
              <template v-else-if="live">
                <span class="fs-dot" aria-hidden="true" />
                {{ serverCount(c.servers.length) }} · offline now
              </template>
              <template v-else>{{ serverCount(c.servers.length) }}</template>
            </span>
          </router-link>
        </li>
      </ul>

      <p class="fs__more">
        Every server, live:
        <router-link to="/v4/servers/bf1942">the full Battlefield 1942 server list</router-link>.
      </p>
    </template>

    <!-- One community -->
    <template v-else-if="community">
      <nav class="fs-crumbs" aria-label="Breadcrumb">
        <router-link :to="HUB.path">Battlefield 1942 servers</router-link>
        <span aria-hidden="true">/</span>
        <span>{{ community.name }}</span>
      </nav>
      <h1 class="mm-display">{{ community.h1 }}</h1>
      <p class="fs__lede">{{ community.intro }}</p>

      <section class="fs-list" aria-labelledby="fs-live" data-testid="community-servers">
        <h2 id="fs-live" class="fs-list__title">
          Servers
          <span v-if="live" class="fs-list__count">{{ playersFor(community) }} playing now</span>
        </h2>

        <p v-if="!live && !loadFailed" class="fs-note">Loading live servers...</p>
        <p v-else-if="loadFailed" class="fs-note">The live server list did not load. The addresses below are the last ones seen.</p>

        <article v-for="s in liveServers" :key="s.guid" class="fs-row">
          <span :class="(s.numPlayers || 0) > 0 ? 'fs-dot fs-dot--on' : 'fs-dot'" aria-hidden="true" />
          <div class="fs-row__body">
            <router-link :to="serverDetailPath(s.name)" class="fs-row__name">{{ $pn(s.name) }}</router-link>
            <div class="fs-row__meta">
              <span class="fs-row__addr">{{ s.ip }}:{{ s.port }}</span>
              <span>{{ modLabel(s.gameId) }}</span>
              <span v-if="s.country">{{ country(s.country) }}</span>
              <span v-if="s.mapName">{{ s.mapName }}</span>
            </div>
          </div>
          <div class="fs-row__players">
            <span class="fs-row__num">{{ s.numPlayers || 0 }}</span><span class="fs-row__max">/{{ s.maxPlayers }}</span>
          </div>
        </article>

        <article v-for="k in missingServers" :key="k.name" class="fs-row fs-row--off">
          <span class="fs-dot" aria-hidden="true" />
          <div class="fs-row__body">
            <router-link :to="serverDetailPath(k.name)" class="fs-row__name">{{ $pn(k.name) }}</router-link>
            <div class="fs-row__meta">
              <span v-if="k.address" class="fs-row__addr">{{ k.address }}</span>
              <span>{{ modLabel(k.gameId) }}</span>
              <span>{{ country(k.country) }}</span>
              <span v-if="live">Not in the live list right now</span>
            </div>
          </div>
        </article>
      </section>

      <section class="fs-others" aria-labelledby="fs-others">
        <h2 id="fs-others" class="fs-list__title">More Battlefield 1942 servers</h2>
        <ul>
          <li v-for="c in others" :key="c.slug">
            <router-link :to="communityPath(c)">{{ c.h1 }}</router-link>
          </li>
          <li><router-link to="/v4/servers/bf1942">Every live Battlefield 1942 server</router-link></li>
        </ul>
      </section>
    </template>

    <template v-else>
      <h1 class="mm-display">Server group not found</h1>
      <p class="fs__lede">
        See the <router-link :to="HUB.path">Battlefield 1942 servers</router-link> people play on.
      </p>
    </template>
  </div>
</template>

<style scoped>
.fs__lede {
  max-width: 680px;
  margin: 12px 0 0;
  color: var(--mm-ink-soft);
  font-size: 15px;
  line-height: 1.6;
}
.fs__lede a, .fs__more a, .fs-others a, .fs-crumbs a {
  color: var(--mm-accent-soft);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.fs__lede a:hover, .fs__more a:hover, .fs-others a:hover, .fs-crumbs a:hover { color: var(--mm-ink); }

.fs-crumbs {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

/* ---------- hub ---------- */

.fs-hub {
  list-style: none;
  margin: 28px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 881px) {
  .fs-hub { grid-template-columns: 1fr 1fr; }
}
.fs-hub__card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  box-sizing: border-box;
  padding: 18px 20px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-top: 2px solid var(--mm-accent);
  color: var(--mm-ink-soft);
  text-decoration: none;
  transition: border-color 0.2s ease, background 0.2s ease;
}
.fs-hub__card:hover { border-color: var(--mm-rule-strong); background: var(--mm-bg-mute); color: var(--mm-ink-soft); }
.fs-hub__name {
  font-family: var(--mm-font-display);
  font-size: 19px;
  color: var(--mm-ink);
  letter-spacing: -0.01em;
}
.fs-hub__intro { font-size: 14px; line-height: 1.55; }
.fs-hub__meta {
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.fs__more { margin-top: 24px; color: var(--mm-ink-soft); font-size: 14px; }

/* ---------- one community ---------- */

.fs-list { margin-top: 28px; max-width: 880px; }
.fs-list__title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 0 0 10px;
  font-family: var(--mm-font-display);
  font-size: 20px;
  font-weight: 400;
  color: var(--mm-ink);
}
.fs-list__count {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.fs-note { color: var(--mm-ink-muted); font-size: 14px; }

.fs-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  margin-bottom: 8px;
}
.fs-row--off { opacity: 0.7; }
.fs-row__body { min-width: 0; }
.fs-row__name {
  display: block;
  color: var(--mm-ink);
  font-size: 15.5px;
  text-decoration: none;
  overflow-wrap: anywhere;
}
.fs-row__name:hover { color: var(--mm-accent-soft); }
.fs-row__meta {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12.5px;
  color: var(--mm-ink-muted);
}
.fs-row__addr { font-family: var(--mm-font-mono); color: var(--mm-ink-soft); user-select: all; }
.fs-row__players { font-family: var(--mm-font-mono); white-space: nowrap; }
.fs-row__num { font-size: 18px; color: var(--mm-ink); }
.fs-row__max { font-size: 12px; color: var(--mm-ink-muted); }

.fs-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mm-ink-faint);
  flex-shrink: 0;
}
.fs-dot--on { background: var(--mm-success); box-shadow: 0 0 7px var(--mm-success); }

.fs-others { margin-top: 36px; max-width: 880px; }
.fs-others ul { margin: 0; padding-left: 18px; color: var(--mm-ink-soft); line-height: 1.9; font-size: 14.5px; }
</style>
