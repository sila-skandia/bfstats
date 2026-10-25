<script setup lang="ts">
// The account's BF1942 profiles (features/game-profiles): import them from the
// game's Settings/Profiles folder once, and the viewer plays with the active
// one's player name and controls on any machine.
import { computed, onMounted, ref } from 'vue'
import { decodePlayerName } from '@/utils/playerName'
import { parseUtc, formatLocalTooltip } from '@/utils/timeUtils'
import {
  GAME_PROFILE_FILES,
  GAME_PROFILE_MAX_PROFILES,
  fileLabel,
  scanGameProfiles,
  type FoundGameProfile,
} from '@/utils/gameProfileImport'
import { gameProfilesService, type GameProfile } from '@/services/gameProfilesService'

const emit = defineEmits<{ (e: 'count', count: number): void }>()

const profiles = ref<GameProfile[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const busyName = ref<string | null>(null)
const actionError = ref<string | null>(null)

const picker = ref<HTMLInputElement | null>(null)
/** Set when Re-import was pressed: the pick is narrowed to that profile. */
const reimportName = ref<string | null>(null)

const found = ref<FoundGameProfile[]>([])
const selected = ref<Set<string>>(new Set())
const scanNote = ref<string | null>(null)
const uploading = ref(false)
const uploadErrors = ref<{ name: string; message: string }[]>([])
const uploadedCount = ref<number | null>(null)

const key = (name: string) => name.toLowerCase()
const stored = computed(() => new Set(profiles.value.map(p => key(p.name))))

/** New names past the ten-profile limit, in the order they would be uploaded. */
const overLimit = computed(() => {
  let room = GAME_PROFILE_MAX_PROFILES - profiles.value.length
  const over = new Set<string>()
  for (const p of found.value) {
    if (!selected.value.has(key(p.name)) || stored.value.has(key(p.name))) continue
    if (room > 0) room--
    else over.add(key(p.name))
  }
  return over
})

const toUpload = computed(() =>
  found.value.filter(p => selected.value.has(key(p.name)) && !overLimit.value.has(key(p.name))))

const load = async () => {
  loading.value = true
  loadError.value = null
  try {
    profiles.value = await gameProfilesService.list()
    emit('count', profiles.value.length)
  } catch {
    loadError.value = 'Could not load your game profiles.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const openPicker = (name: string | null = null) => {
  reimportName.value = name
  uploadedCount.value = null
  uploadErrors.value = []
  if (picker.value) {
    picker.value.value = ''
    picker.value.click()
  }
}

const onPicked = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  const scan = await scanGameProfiles(files)
  let list = scan.profiles
  const notes: string[] = []
  if (reimportName.value) {
    const wanted = key(reimportName.value)
    list = list.filter(p => key(p.name) === wanted)
    if (list.length === 0) notes.push(`No profile named ${reimportName.value} in that folder.`)
  } else if (list.length === 0) {
    notes.push('No profiles in that folder. Pick Settings/Profiles, or one profile folder inside it.')
  }
  if (scan.duplicates.length) notes.push(`Found in more than one mod, first kept: ${scan.duplicates.join(', ')}.`)
  found.value = list
  selected.value = new Set(list.map(p => key(p.name)))
  scanNote.value = notes.length ? notes.join(' ') : null
}

const toggle = (name: string) => {
  const next = new Set(selected.value)
  if (next.has(key(name))) next.delete(key(name))
  else next.add(key(name))
  selected.value = next
}

const cancelImport = () => {
  found.value = []
  selected.value = new Set()
  scanNote.value = null
  reimportName.value = null
}

const upload = async () => {
  if (uploading.value || toUpload.value.length === 0) return
  uploading.value = true
  uploadErrors.value = []
  let done = 0
  for (const p of toUpload.value) {
    try {
      // The stored name keeps its spelling on a re-import.
      const name = reimportName.value ?? p.name
      await gameProfilesService.upsert(name, { playerName: p.playerName, files: p.files as Record<string, string> })
      done++
    } catch (e) {
      uploadErrors.value.push({ name: p.name, message: e instanceof Error ? e.message : 'Upload failed' })
    }
  }
  uploadedCount.value = done
  uploading.value = false
  found.value = []
  reimportName.value = null
  scanNote.value = null
  await load()
}

const activate = async (name: string) => {
  busyName.value = name
  actionError.value = null
  try {
    await gameProfilesService.activate(name)
    await load()
  } catch {
    actionError.value = `Could not make ${name} active.`
  } finally {
    busyName.value = null
  }
}

const remove = async (name: string) => {
  if (!window.confirm(`Delete the game profile ${name}? Your game install is not touched.`)) return
  busyName.value = name
  actionError.value = null
  try {
    await gameProfilesService.remove(name)
    await load()
  } catch {
    actionError.value = `Could not delete ${name}.`
  } finally {
    busyName.value = null
  }
}

const formatRelative = (iso: string): string => {
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '-'
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`
  return `${Math.round(ms / (30 * 86_400_000))}mo ago`
}

const monogram = (name: string) => decodePlayerName(name).charAt(0).toUpperCase() || '?'
const fileKeys = (files: Record<string, string> | Partial<Record<string, string>>) =>
  GAME_PROFILE_FILES.filter(k => k in files)
</script>

<template>
  <section class="mm-gp">
    <header class="mm-gp__head">
      <div>
        <div class="mm-eyebrow mm-eyebrow--strong">Game profiles · BF1942</div>
        <p class="mm-card__hint mm-gp__lead">
          Your in-game name and controls, for the map viewer on any machine you sign in on.
        </p>
      </div>
      <div class="mm-gp__head-actions">
        <span class="mm-gp__meta">
          <span class="mm-meta-row__strong">{{ profiles.length }}</span> / {{ GAME_PROFILE_MAX_PROFILES }}
        </span>
        <button
          type="button"
          class="mm-btn mm-btn--accent"
          data-testid="game-profiles-import"
          :disabled="uploading"
          @click="openPicker()"
        >Import from game</button>
      </div>
    </header>

    <input
      ref="picker"
      type="file"
      class="mm-gp__picker"
      data-testid="game-profiles-picker"
      webkitdirectory
      directory
      multiple
      @change="onPicked"
    />

    <details class="mm-gp__where">
      <summary>Where is the folder?</summary>
      <p>
        Pick <strong>Profiles</strong> to import every profile in it, or one profile's folder
        inside it. Only GeneralOptions.con and the four Controls files are uploaded.
      </p>
      <dl class="mm-gp__paths">
        <dt>Windows</dt>
        <dd><code>C:\Program Files (x86)\EA Games\Battlefield 1942\Mods\bf1942\Settings\Profiles</code></dd>
        <dd><code>C:\Program Files\EA Games\Battlefield 1942\Mods\bf1942\Settings\Profiles</code></dd>
        <dd><code>C:\Program Files (x86)\Origin Games\Battlefield 1942\Mods\bf1942\Settings\Profiles</code></dd>
        <dt>Linux (Wine)</dt>
        <dd><code>~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Settings/Profiles</code></dd>
        <dd><code>~/.wine/drive_c/Program Files (x86)/EA Games/Battlefield 1942/Mods/bf1942/Settings/Profiles</code></dd>
        <dt>Mods</dt>
        <dd>The same layout under <code>Mods/&lt;mod&gt;/Settings/Profiles</code>.</dd>
      </dl>
    </details>

    <!-- What the pick found, before anything is uploaded -->
    <div v-if="found.length > 0 || scanNote" class="mm-gp__preview" data-testid="game-profiles-preview">
      <div class="mm-eyebrow" style="margin-bottom: 10px">
        {{ reimportName ? `Re-import ${reimportName}` : `Found ${found.length} profile${found.length === 1 ? '' : 's'}` }}
      </div>
      <p v-if="scanNote" class="mm-gp__note">{{ scanNote }}</p>
      <ol v-if="found.length > 0" class="mm-gp__found">
        <li v-for="p in found" :key="p.name" class="mm-gp__found-row" :data-profile="p.name">
          <label class="mm-gp__check">
            <input
              type="checkbox"
              :checked="selected.has(p.name.toLowerCase())"
              :aria-label="`Import ${p.name}`"
              @change="toggle(p.name)"
            />
          </label>
          <div class="mm-gp__body">
            <div class="mm-gp__name-line">
              <span class="mm-gp__name">{{ p.name }}</span>
              <span v-if="p.mod" class="mm-chip">{{ p.mod }}</span>
              <span v-if="stored.has(p.name.toLowerCase())" class="mm-chip">Replaces stored</span>
              <span v-if="overLimit.has(p.name.toLowerCase())" class="mm-chip mm-chip--loss">Over limit</span>
            </div>
            <div class="mm-gp__sub">
              Plays as <span class="mm-gp__player">{{ p.playerName ? $pn(p.playerName) : p.name }}</span>
            </div>
            <div class="mm-gp__files">
              <span v-for="k in GAME_PROFILE_FILES" :key="k" class="mm-gp__file" :class="{ 'mm-gp__file--missing': !(k in p.files) }">
                {{ fileLabel(k) }}
              </span>
            </div>
            <div v-if="p.skipped.length" class="mm-gp__note">Skipped: {{ p.skipped.join(', ') }}</div>
          </div>
        </li>
      </ol>
      <div class="mm-gp__preview-actions">
        <button type="button" class="mm-btn" @click="cancelImport">Cancel</button>
        <button
          v-if="found.length > 0"
          type="button"
          class="mm-btn mm-btn--accent"
          data-testid="game-profiles-upload"
          :disabled="uploading || toUpload.length === 0"
          @click="upload"
        >{{ uploading ? 'Uploading…' : `Upload ${toUpload.length}` }}</button>
      </div>
    </div>

    <div v-if="uploadedCount !== null && uploadErrors.length === 0" class="mm-gp__status" role="status">
      Uploaded {{ uploadedCount }} profile{{ uploadedCount === 1 ? '' : 's' }}.
    </div>
    <div v-for="e in uploadErrors" :key="e.name" class="mm-gp__error" role="alert">{{ e.name }}: {{ e.message }}</div>
    <div v-if="actionError" class="mm-gp__error" role="alert">{{ actionError }}</div>

    <div v-if="loading && profiles.length === 0" style="padding: 12px 0">
      <div v-for="i in 2" :key="i" class="mm-skeleton mm-skeleton--lg" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="loadError" class="mm-empty" style="padding: 28px">{{ loadError }}</div>

    <ol v-else-if="profiles.length > 0" class="mm-gp__list" data-testid="game-profiles-list">
      <li
        v-for="p in profiles"
        :key="p.name"
        class="mm-gp__row"
        :class="{ 'mm-gp__row--active': p.isActive }"
        :data-profile="p.name"
      >
        <span class="mm-gp__monogram" :class="{ 'mm-gp__monogram--active': p.isActive }">{{ monogram(p.name) }}</span>
        <div class="mm-gp__body">
          <div class="mm-gp__name-line">
            <span class="mm-gp__name">{{ p.name }}</span>
            <span v-if="p.isActive" class="mm-chip mm-chip--accent" data-testid="game-profile-active">Active</span>
          </div>
          <div class="mm-gp__sub">
            Plays as <span class="mm-gp__player">{{ $pn(p.playerName) }}</span>
            <span class="mm-meta-row__sep">·</span>
            Updated <span :title="formatLocalTooltip(p.updatedAt)">{{ formatRelative(p.updatedAt) }}</span>
          </div>
          <div class="mm-gp__files">
            <span v-for="k in fileKeys(p.files)" :key="k" class="mm-gp__file">{{ fileLabel(k) }}</span>
          </div>
        </div>
        <div class="mm-gp__actions">
          <button
            v-if="!p.isActive"
            type="button"
            class="mm-btn mm-btn--inline"
            :disabled="busyName === p.name"
            @click="activate(p.name)"
          >Set active</button>
          <button
            type="button"
            class="mm-btn mm-btn--inline"
            :disabled="busyName === p.name || uploading"
            @click="openPicker(p.name)"
          >Re-import</button>
          <button
            type="button"
            class="mm-btn mm-btn--inline mm-gp__delete"
            :disabled="busyName === p.name"
            :aria-label="`Delete ${p.name}`"
            @click="remove(p.name)"
          >Delete</button>
        </div>
      </li>
    </ol>

    <div v-else-if="found.length === 0" class="mm-empty" style="padding: 28px">
      No game profiles yet. Import them from your game once and the viewer uses your name and controls.
    </div>
  </section>
</template>

<style scoped>
.mm-gp__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.mm-gp__lead { margin-top: 4px; max-width: 540px; }
.mm-gp__head-actions { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.mm-gp__meta {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.mm-gp__head-actions .mm-btn--accent:disabled { opacity: 0.5; cursor: default; }

/* Opened by the Import button, never seen. */
.mm-gp__picker { display: none; }

.mm-gp__where {
  margin-bottom: 18px;
  font-size: 13px;
  color: var(--mm-ink-muted);
}
.mm-gp__where summary {
  cursor: pointer;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  width: fit-content;
}
.mm-gp__where summary:hover { color: var(--mm-accent-soft); }
.mm-gp__where p { margin: 10px 0; line-height: 1.6; max-width: 70ch; }
.mm-gp__where strong { color: var(--mm-ink); font-weight: 500; }
.mm-gp__paths { margin: 0; display: grid; gap: 4px; }
.mm-gp__paths dt {
  margin-top: 8px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
}
.mm-gp__paths dd { margin: 0; min-width: 0; }
.mm-gp__paths code {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  color: var(--mm-ink-soft);
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 2px 6px;
}

.mm-gp__preview {
  border: 1px solid var(--mm-rule-strong);
  border-left: 2px solid var(--mm-accent);
  background: var(--mm-bg-soft);
  border-radius: 2px;
  padding: 14px 16px;
  margin-bottom: 18px;
}
.mm-gp__found { list-style: none; margin: 0; padding: 0; }
.mm-gp__found-row {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 10px;
  align-items: start;
  padding: 10px 0;
  border-bottom: 1px solid var(--mm-rule);
}
.mm-gp__found-row:last-child { border-bottom: 0; }
.mm-gp__check { display: grid; place-items: center; padding-top: 2px; cursor: pointer; }
.mm-gp__check input { accent-color: var(--mm-accent); width: 16px; height: 16px; cursor: pointer; }
.mm-gp__preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 12px;
}
.mm-gp__preview-actions .mm-btn--accent:disabled { opacity: 0.5; cursor: default; }

.mm-gp__note { margin: 0 0 8px; font-size: 12.5px; color: var(--mm-ink-muted); }
.mm-gp__status { font-size: 12.5px; color: var(--mm-success); margin-bottom: 12px; }
.mm-gp__error {
  border-left: 2px solid var(--mm-danger);
  background: var(--mm-bg-mute);
  color: var(--mm-danger);
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 12.5px;
}

.mm-gp__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.mm-gp__row {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--mm-rule);
}
.mm-gp__row:last-child { border-bottom: 0; }

.mm-gp__monogram {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-weight: 600;
  font-size: 18px;
  display: grid;
  place-items: center;
}
.mm-gp__monogram--active { border-color: var(--mm-accent); color: var(--mm-accent-soft); }

.mm-gp__body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mm-gp__name-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mm-gp__name {
  font-family: var(--mm-font-display);
  font-size: 16px;
  font-weight: 500;
  color: var(--mm-ink);
  overflow-wrap: anywhere;
}
.mm-gp__sub {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 6px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
}
.mm-gp__player { color: var(--mm-ink-soft); }
.mm-gp__files { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.mm-gp__file {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 1px 5px;
}
.mm-gp__file--missing { color: var(--mm-ink-faint); border-style: dashed; text-decoration: line-through; }

.mm-gp__actions { display: flex; align-items: center; gap: 10px; }
.mm-gp__actions .mm-btn:disabled { opacity: 0.45; cursor: default; }
.mm-gp__delete:hover:not(:disabled) { color: var(--mm-danger); }

@media (max-width: 720px) {
  .mm-gp__head { flex-direction: column; gap: 10px; }
  .mm-gp__head-actions { width: 100%; justify-content: space-between; }
  .mm-gp__row { grid-template-columns: 44px 1fr; row-gap: 8px; }
  .mm-gp__actions { grid-column: 2; flex-wrap: wrap; gap: 14px; }
}
</style>
