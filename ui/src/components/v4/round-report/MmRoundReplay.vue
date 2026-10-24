<script setup lang="ts">
import { computed, ref } from 'vue'
import { mapImageUrl } from '@/utils/mapImage'
import { formatLocalTooltip, formatRelativeTime } from '@/utils/timeUtils'
import {
  formatClock,
  momentIn,
  momentWatchHref,
  recordingPageHref,
  roundWatchHref,
  type StatsRoundRecording,
} from '@/services/recordingsService'

/**
 * The round's shared replays on its report (features/recording-stats-round): the round's
 * recording to watch, merged when several players recorded it, who shared it, and the
 * moment the report's playback is on opened in the replay. The panel is only drawn when the
 * round has a recording.
 */
const props = defineProps<{
  recordings: StatsRoundRecording[]
  /** The moment the report's playback shows, an API (UTC) timestamp, or null. */
  moment: string | null
  /** The moment as the report labels it (`12:34` into the round). */
  momentLabel: string
}>()

const lead = computed(() => props.recordings[0])

/** Those that play merged with the lead: the feed's round it is in. */
const merged = computed(() => props.recordings.filter(r => r.group === lead.value.group))

/** Recordings of the round the feed has not put in the lead's round: each its own link. */
const others = computed(() => props.recordings.filter(r => r.group !== lead.value.group))

const uploaders = computed(() => {
  const seen = new Map<string, StatsRoundRecording>()
  for (const r of props.recordings) if (!seen.has(r.uploaderName)) seen.set(r.uploaderName, r)
  return [...seen.values()]
})

const views = computed(() => props.recordings.reduce((n, r) => n + r.viewCount, 0))

const momentHit = computed(() => (props.moment ? momentIn(props.recordings, props.moment) : null))

const failed = ref(new Set<string>())
const cover = computed(() => {
  const own = props.recordings.map(r => r.thumbnailUrl).find(u => u && !failed.value.has(u))
  if (own) return own
  const art = mapImageUrl(lead.value.mod, lead.value.level)
  return art && !failed.value.has(art) ? art : null
})

function onCoverError() {
  if (cover.value) failed.value = new Set([...failed.value, cover.value])
}
</script>

<template>
  <section class="mm-panel mm-rreplay" data-testid="round-replay">
    <div class="mm-pbar">
      <span class="mm-pbar__t"># Replay</span>
      <span class="mm-pbar__m">
        {{ recordings.length === 1 ? 'Recorded in game' : `${recordings.length} recordings` }}
      </span>
    </div>
    <div class="mm-panel__body mm-rreplay__body">
      <a
        class="mm-rreplay__cover"
        :href="roundWatchHref(recordings)"
        target="_blank"
        rel="noopener"
        data-testid="round-replay-watch"
        :aria-label="`Watch the replay of ${lead.title}`"
      >
        <img v-if="cover" :src="cover" alt="" loading="lazy" decoding="async" @error="onCoverError" />
        <span class="mm-rreplay__len">{{ formatClock(lead.durationSeconds) }}</span>
        <span class="mm-rreplay__play" aria-hidden="true"><i class="pi pi-play" /></span>
      </a>

      <div class="mm-rreplay__text">
        <div class="mm-eyebrow mm-eyebrow--strong">Watch the round</div>
        <p class="mm-rreplay__lede">
          Every soldier, vehicle and shot of this round, replayed in 3D from
          {{ merged.length === 1 ? 'a player\'s recording' : `${merged.length} players' recordings merged` }}.
        </p>
        <div class="mm-meta-row mm-rreplay__meta">
          <span>
            shared by
            <template v-for="(r, i) in uploaders" :key="r.uploaderName">
              <span v-if="i > 0">, </span>
              <router-link
                v-if="r.uploaderPlayer"
                :to="`/v4/players/${encodeURIComponent(r.uploaderPlayer)}`"
              >{{ $pn(r.uploaderPlayer) }}</router-link>
              <span v-else>{{ $pn(r.uploaderName) }}</span>
            </template>
          </span>
          <span class="mm-meta-row__sep">·</span>
          <span :title="formatLocalTooltip(lead.createdAt)">{{ formatRelativeTime(lead.createdAt) }}</span>
          <span class="mm-meta-row__sep">·</span>
          <span>{{ views.toLocaleString() }} {{ views === 1 ? 'view' : 'views' }}</span>
        </div>

        <div class="mm-rreplay__actions">
          <a
            class="mm-btn mm-btn--accent"
            :href="roundWatchHref(recordings)"
            target="_blank"
            rel="noopener"
          ><i class="pi pi-play" aria-hidden="true" /> Watch replay</a>
          <a
            v-if="momentHit"
            class="mm-btn mm-btn--strong"
            :href="momentWatchHref(momentHit.recording, momentHit.seconds)"
            target="_blank"
            rel="noopener"
            data-testid="round-replay-moment"
            :title="`Open ${momentHit.recording.uploaderName}'s recording at this point of the round`"
          ><i class="pi pi-step-forward" aria-hidden="true" /> Watch from {{ momentLabel }}</a>
          <a
            class="mm-rreplay__feed"
            :href="recordingPageHref(lead.slug)"
            target="_blank"
            rel="noopener"
          >Comments &amp; details <i class="pi pi-external-link" aria-hidden="true" /></a>
        </div>

        <ul v-if="others.length" class="mm-rreplay__others">
          <li v-for="r in others" :key="r.slug">
            <a :href="roundWatchHref([r])" target="_blank" rel="noopener">{{ r.title }}</a>
            <span class="mm-rreplay__others-by">by {{ $pn(r.uploaderPlayer ?? r.uploaderName) }} · {{ formatClock(r.durationSeconds) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mm-rreplay__body {
  display: grid;
  grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.mm-rreplay__cover {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg-mute);
}
.mm-rreplay__cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
}
.mm-rreplay__cover:hover img { transform: scale(1.03); }
.mm-rreplay__cover:hover { border-color: var(--mm-rule-strong); }
.mm-rreplay__len {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 1;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--mm-bg) 82%, transparent);
  color: var(--mm-ink);
}
.mm-rreplay__play {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--mm-bg) 25%, transparent);
  transition: background 0.2s ease;
}
.mm-rreplay__cover:hover .mm-rreplay__play { background: color-mix(in srgb, var(--mm-bg) 5%, transparent); }
.mm-rreplay__play .pi {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  font-size: 18px;
  padding-left: 3px;
  background: color-mix(in srgb, var(--mm-highlight) 88%, transparent);
  color: var(--mm-highlight-ink);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--mm-highlight) 55%, transparent);
  animation: mm-rreplay-pulse 2.4s ease-out infinite;
}
@keyframes mm-rreplay-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mm-highlight) 55%, transparent); }
  70% { box-shadow: 0 0 0 14px color-mix(in srgb, var(--mm-highlight) 0%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mm-highlight) 0%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  .mm-rreplay__play .pi { animation: none; }
  .mm-rreplay__cover img { transition: none; }
}
.mm-rreplay__text { min-width: 0; }
.mm-rreplay__lede {
  margin: 6px 0 8px;
  color: var(--mm-ink-soft);
  line-height: 1.5;
}
.mm-rreplay__meta { flex-wrap: wrap; }
.mm-rreplay__meta a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.mm-rreplay__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  margin-top: 14px;
}
.mm-rreplay__actions .mm-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}
.mm-rreplay__actions .pi { font-size: 11px; }
.mm-rreplay__feed {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mm-rreplay__feed .pi { font-size: 9px; }
.mm-rreplay__others {
  list-style: none;
  margin: 14px 0 0;
  padding: 10px 0 0;
  border-top: 1px solid var(--mm-rule);
  display: grid;
  gap: 6px;
  font-size: 12.5px;
}
.mm-rreplay__others a { color: var(--mm-ink); }
.mm-rreplay__others-by {
  margin-left: 8px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-muted);
}
@media (max-width: 720px) {
  .mm-rreplay__body { grid-template-columns: minmax(0, 1fr); gap: 14px; }
}
</style>
