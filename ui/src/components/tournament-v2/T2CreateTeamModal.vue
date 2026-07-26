<template>
  <Teleport to="body">
    <div
      v-if="isVisible"
      class="t2 t2-modal"
      :style="themeVars"
      @click.self="closeModal"
    >
      <div class="t2-modal__panel t2-modal__panel--wide">
        <div class="t2-modal__head">
          <div>
            <div class="t2-modal__eyebrow">Team registration</div>
            <h2 class="t2-modal__title">Create a team</h2>
          </div>
          <button
            class="t2-modal__close"
            aria-label="Close"
            @click="closeModal"
          >×</button>
        </div>

        <div
          v-if="isLoadingPlayerNames"
          class="t2-loading"
          style="min-height: 160px"
        >
          <div class="t2-spinner" />
        </div>

        <form
          v-else
          class="t2-modal__body"
          @submit.prevent="handleSubmit"
        >
          <!-- Registration info -->
          <div
            v-if="registrationRules"
            class="t2-collapse"
          >
            <button
              type="button"
              class="t2-collapse__toggle"
              @click="showRegistrationRules = !showRegistrationRules"
            >
              <span>Registration info</span>
              <i
                class="pi"
                :class="showRegistrationRules ? 'pi-chevron-up' : 'pi-chevron-down'"
                style="font-size: 11px"
              />
            </button>
            <div
              v-if="showRegistrationRules"
              class="t2-collapse__body t2-md"
              v-html="renderedRegistrationRules"
            />
          </div>

          <div class="t2-field">
            <label class="t2-label">Team name <span class="t2-req">*</span></label>
            <input
              v-model="form.teamName"
              type="text"
              maxlength="100"
              class="t2-input"
              placeholder="Enter team name"
              required
            >
            <div class="t2-hint">2–100 characters</div>
          </div>

          <div class="t2-field">
            <label class="t2-label">Team tag <span class="t2-opt">(optional)</span></label>
            <input
              v-model="form.tag"
              type="text"
              maxlength="20"
              class="t2-input"
              placeholder="e.g. [TAG]"
            >
            <div class="t2-hint">Up to 20 characters, shown before player names</div>
          </div>

          <div class="t2-field">
            <label class="t2-label">Your in-game name <span class="t2-req">*</span></label>

            <label
              v-for="player in linkedPlayerNames"
              :key="player.id"
              class="t2-option"
              :class="{ 't2-option--active': form.playerName === player.playerName }"
            >
              <input
                v-model="form.playerName"
                type="radio"
                :value="player.playerName"
              >
              <span class="t2-option__name">{{ $pn(player.playerName) }}</span>
            </label>

            <button
              v-if="!showAddPlayerName && linkedPlayerNames.length > 0"
              type="button"
              class="t2-match__details-link"
              style="margin-top: 4px"
              @click="showAddPlayerName = true"
            >
              + Link a different player name
            </button>

            <div v-if="showAddPlayerName || linkedPlayerNames.length === 0">
              <div
                v-if="linkedPlayerNames.length === 0"
                class="t2-hint"
                style="margin-bottom: 8px"
              >
                Search for your in-game player name:
              </div>
              <div class="t2-search__row">
                <T2PlayerSearch
                  v-model="newPlayerName"
                  placeholder="Search for your player name..."
                  @select="handlePlayerSelected"
                />
                <button
                  type="button"
                  class="t2-btn t2-btn--accent"
                  :disabled="!newPlayerName.trim() || isLinkingPlayerName"
                  @click="handleLinkPlayerName"
                >
                  {{ isLinkingPlayerName ? '…' : 'Link' }}
                </button>
              </div>
              <div
                v-if="linkPlayerError"
                class="t2-errbox"
                style="margin-top: 8px"
              >{{ linkPlayerError }}</div>
            </div>
          </div>

          <div
            v-if="errorMessage"
            class="t2-errbox"
          >{{ errorMessage }}</div>
        </form>

        <div class="t2-modal__footer">
          <button
            type="button"
            class="t2-btn t2-btn--outline"
            @click="closeModal"
          >Cancel</button>
          <button
            type="button"
            class="t2-btn t2-btn--accent"
            :disabled="isSubmitting || !isFormValid"
            @click="handleSubmit"
          >
            {{ isSubmitting ? 'Creating…' : 'Create team' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { marked } from 'marked'
import T2PlayerSearch from './T2PlayerSearch.vue'
import { resolveT2Theme } from './t2Theme'
import { teamRegistrationService, type CreateTeamRequest, type LinkedPlayerName } from '@/services/teamRegistrationService'
import type { PublicTournamentDetail } from '@/services/publicTournamentService'

interface Props {
  isVisible: boolean
  tournamentId: number
  registrationRules?: string
  tournament?: PublicTournamentDetail | null
}

const props = withDefaults(defineProps<Props>(), {
  registrationRules: '',
  tournament: null,
})

const emit = defineEmits<{
  close: []
  success: [teamId: number, teamName: string]
}>()

// V2 theme vars for the teleported root
const themeVars = computed(() => {
  const t = resolveT2Theme(props.tournament)
  return { '--t-bg': t.bg, '--t-text': t.text, '--t-accent': t.accent }
})

const showRegistrationRules = ref(false)
const renderedRegistrationRules = computed(() => {
  if (!props.registrationRules) return ''
  try {
    return marked(props.registrationRules, { breaks: true }) as string
  } catch {
    return ''
  }
})

// --- logic ported verbatim from CreateTeamModal ---
const linkedPlayerNames = ref<LinkedPlayerName[]>([])
const isLoadingPlayerNames = ref(false)
const showAddPlayerName = ref(false)
const newPlayerName = ref('')
const isLinkingPlayerName = ref(false)
const linkPlayerError = ref('')

const form = ref({ teamName: '', tag: '', playerName: '', rulesAcknowledged: true })
const isSubmitting = ref(false)
const errorMessage = ref('')

const isFormValid = computed(() =>
  form.value.teamName.trim().length >= 2 && form.value.playerName !== '')

const loadPlayerNames = async () => {
  isLoadingPlayerNames.value = true
  try {
    linkedPlayerNames.value = await teamRegistrationService.getLinkedPlayerNames()
    if (linkedPlayerNames.value.length === 1) {
      form.value.playerName = linkedPlayerNames.value[0].playerName
    }
  } catch {
    linkedPlayerNames.value = []
  } finally {
    isLoadingPlayerNames.value = false
  }
}

const handlePlayerSelected = (player: { playerName: string }) => {
  newPlayerName.value = player.playerName
}

const handleLinkPlayerName = async () => {
  if (!newPlayerName.value.trim() || isLinkingPlayerName.value) return
  isLinkingPlayerName.value = true
  linkPlayerError.value = ''
  try {
    const linked = await teamRegistrationService.linkPlayerName(newPlayerName.value.trim())
    linkedPlayerNames.value.push(linked)
    form.value.playerName = linked.playerName
    newPlayerName.value = ''
    showAddPlayerName.value = false
  } catch (error) {
    linkPlayerError.value = error instanceof Error ? error.message : 'Failed to link player name'
  } finally {
    isLinkingPlayerName.value = false
  }
}

const closeModal = () => emit('close')

const resetForm = () => {
  form.value = { teamName: '', tag: '', playerName: '', rulesAcknowledged: true }
  errorMessage.value = ''
  showAddPlayerName.value = false
  newPlayerName.value = ''
  linkPlayerError.value = ''
}

const handleSubmit = async () => {
  if (!isFormValid.value || isSubmitting.value) return
  isSubmitting.value = true
  errorMessage.value = ''
  try {
    const request: CreateTeamRequest = {
      teamName: form.value.teamName.trim(),
      tag: form.value.tag.trim() || undefined,
      playerName: form.value.playerName,
      rulesAcknowledged: form.value.rulesAcknowledged,
    }
    const response = await teamRegistrationService.createTeam(props.tournamentId, request)
    emit('success', response.teamId, response.teamName)
    resetForm()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to create team'
  } finally {
    isSubmitting.value = false
  }
}

watch(() => props.isVisible, (visible) => {
  if (visible) loadPlayerNames()
  else resetForm()
})
</script>

<style src="@/styles/tournament-v2.css"></style>
