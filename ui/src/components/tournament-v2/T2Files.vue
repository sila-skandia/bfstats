<template>
  <div>
    <div
      v-if="categories.length === 0"
      class="t2-empty"
    >
      No files uploaded yet.
    </div>

    <section
      v-for="category in categories"
      :key="category.name"
      style="margin-bottom: 34px"
    >
      <div
        class="t2-section-head"
        style="margin-bottom: 6px"
      >
        <span class="t2-section-head__mark">//</span>
        <h2
          class="t2-section-head__title"
          style="font-size: 20px"
        >{{ category.name }}</h2>
        <span class="t2-section-head__meta">{{ category.files.length }} {{ category.files.length === 1 ? 'file' : 'files' }}</span>
      </div>

      <div
        v-for="file in category.files"
        :key="file.id"
        class="t2-file-row"
      >
        <i
          class="pi t2-file-row__icon"
          :class="fileIcon(category.name)"
        />
        <div>
          <div class="t2-file-row__name">{{ file.name }}</div>
          <div
            class="t2-file-row__meta"
            :title="formatLocalTooltip(file.uploadedAt)"
          >Uploaded {{ formatDate(file.uploadedAt) }}</div>
        </div>
        <span class="t2-chip t2-file-row__pill">{{ category.name }}</span>
        <a
          :href="file.url"
          target="_blank"
          rel="noopener noreferrer"
          class="t2-file-row__dl"
        >
          Download <i
            class="pi pi-arrow-down"
            style="font-size: 10px"
          />
        </a>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
// Icon font for the `pi pi-*` classes in this component's template. Imported
// here rather than via a <link> in index.html so it ships in this route's CSS
// chunk — it used to be a render-blocking stylesheet fetched from unpkg.com on
// every page load, including the three routes that never use an icon from it.
import 'primeicons/primeicons.css'
import { computed } from 'vue'
import type { PublicTournamentDetail, TournamentFile } from '@/services/publicTournamentService'
import { formatDate, formatLocalTooltip } from '@/utils/timeUtils'

const props = defineProps<{ tournament: PublicTournamentDetail }>()

const categories = computed(() => {
  const files = props.tournament.files ?? []
  const byCategory = new Map<string, TournamentFile[]>()
  for (const file of files) {
    const key = file.category?.trim() || 'Other'
    const list = byCategory.get(key)
    if (list) list.push(file)
    else byCategory.set(key, [file])
  }
  return [...byCategory.entries()].map(([name, categoryFiles]) => ({ name, files: categoryFiles }))
})

const fileIcon = (category: string): string => {
  const c = category.toLowerCase()
  if (c.includes('map')) return 'pi-box'
  if (c.includes('rule') || c.includes('doc')) return 'pi-file-pdf'
  if (c.includes('config') || c.includes('server')) return 'pi-cog'
  if (c.includes('replay') || c.includes('demo') || c.includes('video')) return 'pi-video'
  if (c.includes('program') || c.includes('tool')) return 'pi-wrench'
  return 'pi-file'
}
</script>
