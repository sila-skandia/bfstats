<template>
  <div class="mm mm-admin">
    <header class="mm-admin-header">
      <div class="mm-admin-header__top">
        <div>
          <h1 class="mm-admin-header__title">Tournaments</h1>
          <p class="mm-admin-header__sub">
            Create and manage competitive Battlefield tournaments, matches, brackets, and team rosters.
          </p>
        </div>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary"
          @click="openCreateModal"
        >
          + Create Tournament
        </button>
      </div>
    </header>

    <!-- Error Alert -->
    <div v-if="error" class="mm-admin-alert mm-admin-alert--err">
      {{ error }}
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="mm-admin-empty mm-admin-empty--loading">
      <div class="mm-admin-spinner" />
      <span class="mm-admin-empty__desc" style="margin-top: 12px">Loading tournaments...</span>
    </div>

    <!-- Empty State -->
    <div v-else-if="tournaments.length === 0" class="mm-admin-card">
      <div class="mm-admin-empty">
        <div class="mm-admin-empty__title">No tournaments found</div>
        <p class="mm-admin-empty__desc">
          You haven't created any tournaments yet.
        </p>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary"
          style="margin-top: 16px"
          @click="openCreateModal"
        >
          + Create Tournament
        </button>
      </div>
    </div>

    <!-- Tournaments List -->
    <div v-else class="mm-admin-tournaments-grid">
      <article
        v-for="t in tournaments"
        :key="t.id"
        class="mm-admin-card mm-tournament-card"
      >
        <div class="mm-admin-card__head mm-tournament-card__head">
          <div class="mm-tournament-card__title-row">
            <span class="mm-game-badge" :class="`mm-game-badge--${t.game}`">{{ t.game.toUpperCase() }}</span>
            <h2 class="mm-tournament-card__name">{{ t.name }}</h2>
          </div>
          <div class="mm-tournament-card__meta">
            <span>By <strong>{{ t.organizer }}</strong></span>
            <span>•</span>
            <span>Created {{ formatDate(t.createdAt) }}</span>
          </div>
        </div>

        <div class="mm-admin-card__body mm-tournament-card__body">
          <div class="mm-admin-mini-stats">
            <div class="mm-admin-mini-stat">
              <span class="mm-admin-mini-stat__label">Matches</span>
              <span class="mm-admin-mini-stat__value">
                {{ t.matchCount }}<span v-if="t.anticipatedRoundCount" class="mm-faint">/{{ t.anticipatedRoundCount }}</span>
              </span>
            </div>
            <div class="mm-admin-mini-stat">
              <span class="mm-admin-mini-stat__label">Teams</span>
              <span class="mm-admin-mini-stat__value">{{ t.teamCount }}</span>
            </div>
            <div class="mm-admin-mini-stat">
              <span class="mm-admin-mini-stat__label">Server</span>
              <span class="mm-admin-mini-stat__value mm-admin-mono" style="font-size: 13px">
                {{ t.serverName || 'Not linked' }}
              </span>
            </div>
          </div>
        </div>

        <div class="mm-admin-card__foot mm-tournament-card__foot">
          <div class="mm-admin-actions" style="margin-top: 0">
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
              @click="manageTournament(t.id)"
            >
              Manage →
            </button>

            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
              @click="viewPublic(t)"
            >
              View Public ↗
            </button>

            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--danger mm-admin-btn--sm"
              style="margin-left: auto"
              @click="promptDelete(t)"
            >
              Delete
            </button>
          </div>
        </div>
      </article>
    </div>

    <!-- Create Tournament Modal -->
    <MmBaseModal
      v-if="showCreateModal"
      title="Create Tournament"
      @close="showCreateModal = false"
    >
      <form @submit.prevent="handleCreateSubmit" class="mm-admin-form-grid" style="gap: 16px">
        <div class="mm-admin-field--wide">
          <label class="mm-admin-label">Tournament Name *</label>
          <input
            v-model="createForm.name"
            type="text"
            class="mm-admin-input"
            placeholder="e.g. BF1942 Summer Cup 2026"
            required
          />
        </div>

        <div>
          <label class="mm-admin-label">Organizer Name *</label>
          <input
            v-model="createForm.organizer"
            type="text"
            class="mm-admin-input"
            placeholder="e.g. Community Staff"
            required
          />
        </div>

        <div>
          <label class="mm-admin-label">Game *</label>
          <select v-model="createForm.game" class="mm-admin-select">
            <option value="bf1942">Battlefield 1942</option>
            <option value="fh2">Forgotten Hope 2</option>
            <option value="bfvietnam">Battlefield Vietnam</option>
          </select>
        </div>

        <div>
          <label class="mm-admin-label">Status</label>
          <select v-model="createForm.status" class="mm-admin-select">
            <option value="draft">Draft</option>
            <option value="registration">Registration Open</option>
            <option value="open">Active / Open</option>
            <option value="closed">Closed / Finished</option>
          </select>
        </div>

        <div>
          <label class="mm-admin-label">Anticipated Match Count</label>
          <input
            v-model.number="createForm.anticipatedRoundCount"
            type="number"
            min="1"
            class="mm-admin-input"
            placeholder="e.g. 10"
          />
        </div>

        <div>
          <label class="mm-admin-label">Game Mode</label>
          <input
            v-model="createForm.gameMode"
            type="text"
            class="mm-admin-input"
            placeholder="e.g. Conquest 8v8"
          />
        </div>

        <div>
          <label class="mm-admin-label">URL Slug (Optional)</label>
          <input
            v-model="createForm.slug"
            type="text"
            class="mm-admin-input mm-admin-input--mono"
            placeholder="e.g. summer-cup-2026"
          />
        </div>

        <div class="mm-admin-field--wide">
          <label class="mm-admin-label">Rules / Info (Markdown Supported)</label>
          <textarea
            v-model="createForm.rules"
            rows="4"
            class="mm-admin-input"
            placeholder="Tournament rules and details..."
          />
        </div>

        <div class="mm-admin-field--wide">
          <label class="mm-admin-label">Discord / Community Link</label>
          <input
            v-model="createForm.discordUrl"
            type="url"
            class="mm-admin-input"
            placeholder="https://discord.gg/..."
          />
        </div>

        <div v-if="createError" class="mm-admin-field--wide mm-admin-alert mm-admin-alert--err">
          {{ createError }}
        </div>

        <div class="mm-admin-field--wide mm-admin-actions" style="justify-content: flex-end">
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost"
            @click="showCreateModal = false"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="mm-admin-btn mm-admin-btn--primary"
            :disabled="submitting"
          >
            {{ submitting ? 'Creating...' : 'Create Tournament' }}
          </button>
        </div>
      </form>
    </MmBaseModal>

    <!-- Delete Confirmation Modal -->
    <MmBaseModal
      v-if="showDeleteModal"
      title="Confirm Delete Tournament"
      @close="showDeleteModal = false"
    >
      <p style="font-size: 13px; color: var(--mm-ink); line-height: 1.5">
        Are you sure you want to delete tournament <strong>"{{ targetTournament?.name }}"</strong>?
        This will remove all associated matches, teams, and settings.
      </p>
      <div class="mm-admin-actions" style="justify-content: flex-end; margin-top: 20px">
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          @click="showDeleteModal = false"
        >
          Cancel
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--danger"
          :disabled="deleting"
          @click="confirmDelete"
        >
          {{ deleting ? 'Deleting...' : 'Delete Tournament' }}
        </button>
      </div>
    </MmBaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  adminTournamentService,
  type TournamentListItem,
  type CreateTournamentRequest
} from '@/services/adminTournamentService'
import MmBaseModal from '@/components/v4/MmBaseModal.vue'
import '@/styles/mm-admin.css'

const router = useRouter()

const tournaments = ref<TournamentListItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const loadTournaments = async () => {
  loading.value = true
  error.value = null
  try {
    tournaments.value = await adminTournamentService.getAllTournaments()
  } catch (err) {
    console.error('Error loading tournaments:', err)
    error.value = err instanceof Error ? err.message : 'Failed to load tournaments'
    tournaments.value = []
  } finally {
    loading.value = false
  }
}

// Modal States
const showCreateModal = ref(false)
const submitting = ref(false)
const createError = ref<string | null>(null)

const createForm = ref<Partial<CreateTournamentRequest>>({
  name: '',
  organizer: '',
  game: 'bf1942',
  status: 'registration',
  anticipatedRoundCount: undefined,
  gameMode: '',
  slug: '',
  rules: '',
  discordUrl: '',
})

const openCreateModal = () => {
  createForm.value = {
    name: '',
    organizer: '',
    game: 'bf1942',
    status: 'registration',
    anticipatedRoundCount: undefined,
    gameMode: '',
    slug: '',
    rules: '',
    discordUrl: '',
  }
  createError.value = null
  showCreateModal.value = true
}

const handleCreateSubmit = async () => {
  if (!createForm.value.name?.trim() || !createForm.value.organizer?.trim()) {
    createError.value = 'Tournament name and organizer are required.'
    return
  }

  submitting.value = true
  createError.value = null

  try {
    const req: CreateTournamentRequest = {
      name: createForm.value.name.trim(),
      organizer: createForm.value.organizer.trim(),
      game: createForm.value.game || 'bf1942',
      status: createForm.value.status || 'registration',
      theme: {
        backgroundColour: '#0a0e27',
        textColour: '#FFFFFF',
        accentColour: '#3498db',
      }
    }

    if (createForm.value.anticipatedRoundCount) {
      req.anticipatedRoundCount = createForm.value.anticipatedRoundCount
    }
    if (createForm.value.gameMode?.trim()) {
      req.gameMode = createForm.value.gameMode.trim()
    }
    if (createForm.value.slug?.trim()) {
      req.slug = createForm.value.slug.trim()
    }
    if (createForm.value.rules?.trim()) {
      req.rules = createForm.value.rules.trim()
    }
    if (createForm.value.discordUrl?.trim()) {
      req.discordUrl = createForm.value.discordUrl.trim()
    }

    const newTournament = await adminTournamentService.createTournament(req)
    showCreateModal.value = false
    void router.push(`/v4/admin/tournaments/${newTournament.id}/settings`)
  } catch (err) {
    console.error('Error creating tournament:', err)
    createError.value = err instanceof Error ? err.message : 'Failed to create tournament.'
  } finally {
    submitting.value = false
  }
}

// Delete modal
const showDeleteModal = ref(false)
const targetTournament = ref<TournamentListItem | null>(null)
const deleting = ref(false)

const promptDelete = (t: TournamentListItem) => {
  targetTournament.value = t
  showDeleteModal.value = true
}

const confirmDelete = async () => {
  if (!targetTournament.value) return
  deleting.value = true
  try {
    await adminTournamentService.deleteTournament(targetTournament.value.id)
    showDeleteModal.value = false
    targetTournament.value = null
    await loadTournaments()
  } catch (err) {
    console.error('Error deleting tournament:', err)
  } finally {
    deleting.value = false
  }
}

const manageTournament = (id: number) => {
  void router.push(`/v4/admin/tournaments/${id}/matches`)
}

const viewPublic = (t: TournamentListItem) => {
  void router.push(`/t/${t.slug || t.id}`)
}

const formatDate = (dateStr: string) => {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  } catch {
    return dateStr
  }
}

onMounted(() => {
  void loadTournaments()
})
</script>

<style scoped>
.mm-admin-header__top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.mm-admin-filters {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

@media (min-width: 640px) {
  .mm-admin-filters {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

.mm-admin-search-wrap {
  flex: 1;
  max-width: 420px;
}

.mm-admin-tournaments-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
}

@media (min-width: 768px) {
  .mm-admin-tournaments-grid {
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  }
}

.mm-tournament-card {
  display: flex;
  flex-direction: column;
}

.mm-tournament-card__head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mm-tournament-card__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mm-game-badge {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 2px;
  background: var(--mm-bg-mute);
  color: var(--mm-ink);
  letter-spacing: 0.06em;
}

.mm-game-badge--bf1942 {
  background: rgba(52, 152, 219, 0.15);
  color: #60a5fa;
}

.mm-game-badge--fh2 {
  background: rgba(230, 126, 34, 0.15);
  color: #f59e0b;
}

.mm-game-badge--bfvietnam {
  background: rgba(46, 204, 113, 0.15);
  color: #34d399;
}

.mm-tournament-card__name {
  margin: 0;
  font-family: var(--mm-font-display);
  font-size: 16px;
  font-weight: 500;
  color: var(--mm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-tournament-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--mm-ink-muted);
}

.mm-tournament-card__body {
  flex: 1;
}

.mm-faint {
  opacity: 0.5;
}
</style>
