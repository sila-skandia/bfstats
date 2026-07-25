<template>
  <div class="tournament-settings-tab mm-admin">
    <div class="mm-admin-card" style="padding: 24px;">
      <div class="mm-admin-card__head" style="margin-bottom: 20px; border-bottom: 1px solid var(--mm-rule); padding-bottom: 14px;">
        <span class="mm-eyebrow">Tournament Configuration</span>
        <h2 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 20px; margin-top: 2px;">
          Settings & Customization
        </h2>
      </div>

      <!-- Error / Success Alert -->
      <div v-if="formError" class="mm-admin-alert mm-admin-alert--err" style="margin-bottom: 16px;">
        {{ formError }}
      </div>
      <div v-if="saveSuccess" class="mm-admin-alert mm-admin-alert--ok" style="margin-bottom: 16px;">
        Tournament settings updated successfully!
      </div>

      <div style="display: flex; flex-direction: column; gap: 28px;">
        <!-- General Section -->
        <div>
          <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px; color: var(--mm-ink);">
            General Configuration
          </div>
          <div class="mm-admin-form-grid" style="grid-template-columns: 1fr 1fr 1fr;">
            <div>
              <label class="mm-admin-label">Tournament Name</label>
              <input
                v-model="formData.name"
                type="text"
                class="mm-admin-input"
                :disabled="formLoading"
              >
            </div>
            <div>
              <label class="mm-admin-label">Organizer</label>
              <input
                v-model="formData.organizer"
                type="text"
                class="mm-admin-input"
                :disabled="formLoading"
              >
            </div>
            <div>
              <label class="mm-admin-label">Status</label>
              <select
                v-model="formData.status"
                class="mm-admin-select"
                :disabled="formLoading"
              >
                <option value="draft">Draft</option>
                <option value="registration">Registration</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div>
              <label class="mm-admin-label">Game Mode</label>
              <select
                v-model="formData.gameMode"
                class="mm-admin-select"
                :disabled="formLoading"
              >
                <option value="Conquest">Conquest</option>
                <option value="CTF">CTF</option>
                <option value="Objective">Objective</option>
              </select>
            </div>
            <div>
              <label class="mm-admin-label">Anticipated Matches</label>
              <input
                v-model.number="formData.anticipatedRoundCount"
                type="number"
                min="1"
                class="mm-admin-input mm-admin-input--mono"
                :disabled="formLoading"
              >
            </div>
            <div>
              <label class="mm-admin-label">URL Slug</label>
              <input
                v-model="formData.slug"
                type="text"
                class="mm-admin-input mm-admin-input--mono"
                :disabled="formLoading"
              >
            </div>
          </div>
        </div>

        <!-- Branding & Images Section -->
        <div>
          <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px; color: var(--mm-ink);">
            Branding & Images
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <!-- Hero Image -->
            <div>
              <label class="mm-admin-label">Hero Banner Image</label>
              <div
                class="image-upload-box"
                style="position: relative; height: 100px; border: 1px dashed var(--mm-rule-strong); border-radius: 2px; overflow: hidden; display: grid; place-items: center; background: var(--mm-bg-mute); cursor: pointer;"
                @click="triggerHeroUpload"
              >
                <input
                  ref="heroImageInput"
                  type="file"
                  accept="image/*"
                  style="display: none;"
                  @change="handleHeroImageSelect"
                >
                <img
                  v-if="heroImageUrl"
                  :src="heroImageUrl"
                  alt="Hero banner preview"
                  style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.5;"
                >
                <span class="mm-admin-mono" style="position: relative; z-index: 1; font-size: 10px; color: var(--mm-ink); text-shadow: 0 1px 4px rgba(0,0,0,0.8); background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 2px;">
                  {{ heroImageUrl ? 'Click to replace hero banner (1280 × 220)' : 'Drop hero banner or click to upload' }}
                </span>
              </div>
              <div v-if="heroImageFile" class="mm-admin-chip" style="margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; background: var(--mm-bg-soft); border-color: var(--mm-accent-soft); color: var(--mm-ink);">
                <span style="color: var(--mm-load-ok);">✓</span>
                <span>Staged: {{ heroImageFile.name }}</span>
                <span style="color: var(--mm-ink-muted);">({{ (heroImageFile.size / (1024 * 1024)).toFixed(2) }} MB)</span>
              </div>
              <button
                v-if="heroImageUrl || tournament.hasHeroImage"
                type="button"
                class="mm-admin-cell-btn"
                style="color: var(--mm-danger); border-color: var(--mm-danger); margin-top: 8px;"
                @click="removeHeroImage"
              >
                Remove Hero Image
              </button>
            </div>

            <!-- Logo Image -->
            <div>
              <label class="mm-admin-label">Community Logo</label>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 14px;">
                  <div
                    class="logo-upload-box"
                    style="position: relative; width: 64px; height: 64px; border: 1px dashed var(--mm-rule-strong); border-radius: 2px; overflow: hidden; display: grid; place-items: center; background: var(--mm-bg-mute); cursor: pointer;"
                    @click="triggerLogoUpload"
                  >
                    <input
                      ref="logoImageInput"
                      type="file"
                      accept="image/*"
                      style="display: none;"
                      @change="handleLogoImageSelect"
                    >
                    <img
                      v-if="logoImageUrl"
                      :src="logoImageUrl"
                      alt="Logo preview"
                      style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: rgba(0,0,0,0.4);"
                    >
                    <span v-else class="mm-admin-mono" style="font-size: 9px; color: var(--mm-ink-muted);">LOGO</span>
                  </div>
                  <button
                    v-if="logoImageUrl || tournament.hasCommunityLogo"
                    type="button"
                    class="mm-admin-cell-btn"
                    style="color: var(--mm-danger); border-color: var(--mm-danger);"
                    @click="removeLogoImage"
                  >
                    Remove Logo
                  </button>
                </div>
                <div v-if="logoImageFile" class="mm-admin-chip" style="display: inline-flex; align-items: center; gap: 6px; background: var(--mm-bg-soft); border-color: var(--mm-accent-soft); color: var(--mm-ink); width: fit-content;">
                  <span style="color: var(--mm-load-ok);">✓</span>
                  <span>Staged: {{ logoImageFile.name }}</span>
                  <span style="color: var(--mm-ink-muted);">({{ (logoImageFile.size / (1024 * 1024)).toFixed(2) }} MB)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Theme Preset Section -->
        <div>
          <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px; color: var(--mm-ink);">
            Public Theme & Accent Palette
          </div>
          <div class="mm-admin-form-grid" style="grid-template-columns: 1fr 1fr 1fr;">
            <div>
              <label class="mm-admin-label">Background</label>
              <div style="display: flex; align-items: center; gap: 8px; border: 1px solid var(--mm-rule); border-radius: 2px; padding: 6px 8px; background: var(--mm-bg-mute);">
                <input v-model="themeData.backgroundColour" type="color" style="width: 20px; height: 20px; border: 0; background: transparent; cursor: pointer;">
                <span class="mm-admin-mono" style="font-size: 11px;">{{ themeData.backgroundColour || '#131313' }}</span>
              </div>
            </div>
            <div>
              <label class="mm-admin-label">Text Color</label>
              <div style="display: flex; align-items: center; gap: 8px; border: 1px solid var(--mm-rule); border-radius: 2px; padding: 6px 8px; background: var(--mm-bg-mute);">
                <input v-model="themeData.textColour" type="color" style="width: 20px; height: 20px; border: 0; background: transparent; cursor: pointer;">
                <span class="mm-admin-mono" style="font-size: 11px;">{{ themeData.textColour || '#FFFFFF' }}</span>
              </div>
            </div>
            <div>
              <label class="mm-admin-label">Accent Color</label>
              <div style="display: flex; align-items: center; gap: 8px; border: 1px solid var(--mm-rule); border-radius: 2px; padding: 6px 8px; background: var(--mm-bg-mute);">
                <input v-model="themeData.accentColour" type="color" style="width: 20px; height: 20px; border: 0; background: transparent; cursor: pointer;">
                <span class="mm-admin-mono" style="font-size: 11px;">{{ themeData.accentColour || '#7D8849' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Social Links Section -->
        <div>
          <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px; color: var(--mm-ink);">
            Social Links
          </div>
          <div class="mm-admin-form-grid" style="grid-template-columns: 1fr 1fr 1fr;">
            <div>
              <label class="mm-admin-label">Discord URL</label>
              <input
                v-model="formData.discordUrl"
                type="url"
                placeholder="https://discord.gg/…"
                class="mm-admin-input mm-admin-input--mono"
                :disabled="formLoading"
              >
            </div>
            <div>
              <label class="mm-admin-label">Twitch Stream</label>
              <input
                v-model="formData.twitchUrl"
                type="url"
                placeholder="https://twitch.tv/…"
                class="mm-admin-input mm-admin-input--mono"
                :disabled="formLoading"
              >
            </div>
            <div>
              <label class="mm-admin-label">Forum Link</label>
              <input
                v-model="formData.forumUrl"
                type="url"
                placeholder="https://…"
                class="mm-admin-input mm-admin-input--mono"
                :disabled="formLoading"
              >
            </div>
          </div>
        </div>

        <!-- Rules & Markdown Content Section -->
        <div>
          <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px; color: var(--mm-ink);">
            Rules & Registration Content
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div>
              <label class="mm-admin-label">Rules (Markdown)</label>
              <textarea
                v-model="formData.rules"
                rows="6"
                placeholder="## Tournament Rules..."
                class="mm-admin-input mm-admin-input--mono"
                style="resize: vertical; line-height: 1.6;"
                :disabled="formLoading"
              />
            </div>
            <div>
              <label class="mm-admin-label">Registration Rules (Markdown)</label>
              <textarea
                v-model="formData.registrationRules"
                rows="6"
                placeholder="## Registration Guidelines..."
                class="mm-admin-input mm-admin-input--mono"
                style="resize: vertical; line-height: 1.6;"
                :disabled="formLoading"
              />
            </div>
          </div>
        </div>

        <!-- Form CTAs -->
        <div style="display: flex; justify-content: flex-end; gap: 14px; border-top: 1px solid var(--mm-rule); padding-top: 18px;">
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost"
            :disabled="formLoading"
            @click="resetForm"
          >
            Discard
          </button>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary"
            :disabled="formLoading"
            @click="submitForm"
          >
            {{ formLoading ? 'Saving...' : 'Save Settings' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { marked } from 'marked';
import { adminTournamentService, type TournamentDetail } from '@/services/adminTournamentService';
import MarkdownHelpModal from '@/components/tournament-admin/MarkdownHelpModal.vue';

interface PlayerSearchResult {
  playerName: string;
  totalPlayTimeMinutes: number;
}

const props = defineProps<{
  tournament: TournamentDetail;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
}>();

// View state: 'list', 'editDetails', or 'editTheme'
type ViewState = 'list' | 'editDetails' | 'editTheme';
const currentView = ref<ViewState>('list');

// Edit Panel State
const formLoading = ref(false);
const formError = ref<string | null>(null);
const saveSuccess = ref(false);
const showMarkdownHelp = ref(false);
const formData = ref({
  name: '',
  slug: '',
  organizer: '',
  game: 'bf1942' as 'bf1942' | 'fh2' | 'bfvietnam',
  anticipatedRoundCount: undefined as number | undefined,
  status: 'draft' as 'draft' | 'registration' | 'open' | 'closed',
  gameMode: 'Conquest',
  discordUrl: '',
  youTubeUrl: '',
  twitchUrl: '',
  forumUrl: '',
  promoVideoUrl: '',
  rules: '',
  registrationRules: '',
});

// Theme Panel State
const themeLoading = ref(false);
const themeError = ref<string | null>(null);
const themeData = ref({
  backgroundColour: '#000000',
  textColour: '#FFFFFF',
  accentColour: '#FFD700',
});

// Image upload state
const heroImageInput = ref<HTMLInputElement | null>(null);
const logoImageInput = ref<HTMLInputElement | null>(null);
const heroImagePreview = ref<string | null>(null);
const logoImagePreview = ref<string | null>(null);
const heroImageFile = ref<File | null>(null);
const logoImageFile = ref<File | null>(null);
const removeHeroImageFlag = ref(false);
const removeLogoImageFlag = ref(false);

const loadHeroImage = async () => {
  if (!props.tournament?.id) return;
  try {
    const { authService } = await import('@/services/authService');
    await authService.ensureValidToken();
    const token = localStorage.getItem('authToken');
    const response = await fetch(`/stats/admin/tournaments/${props.tournament.id}/image`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (response.ok) {
      const blob = await response.blob();
      if (heroImagePreview.value?.startsWith('blob:')) URL.revokeObjectURL(heroImagePreview.value);
      heroImagePreview.value = URL.createObjectURL(blob);
    } else {
      const pubResp = await fetch(`/stats/tournaments/${props.tournament.id}/image`);
      if (pubResp.ok) {
        const blob = await pubResp.blob();
        if (heroImagePreview.value?.startsWith('blob:')) URL.revokeObjectURL(heroImagePreview.value);
        heroImagePreview.value = URL.createObjectURL(blob);
      }
    }
  } catch {
    console.debug('No hero image available');
  }
};

const loadLogoImage = async () => {
  if (!props.tournament?.id) return;
  try {
    const { authService } = await import('@/services/authService');
    await authService.ensureValidToken();
    const token = localStorage.getItem('authToken');
    const response = await fetch(`/stats/admin/tournaments/${props.tournament.id}/logo`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (response.ok) {
      const blob = await response.blob();
      if (logoImagePreview.value?.startsWith('blob:')) URL.revokeObjectURL(logoImagePreview.value);
      logoImagePreview.value = URL.createObjectURL(blob);
    } else {
      const pubResp = await fetch(`/stats/tournaments/${props.tournament.id}/logo`);
      if (pubResp.ok) {
        const blob = await pubResp.blob();
        if (logoImagePreview.value?.startsWith('blob:')) URL.revokeObjectURL(logoImagePreview.value);
        logoImagePreview.value = URL.createObjectURL(blob);
      }
    }
  } catch {
    console.debug('No logo image available');
  }
};

const populateForm = () => {
  if (!props.tournament) return;
  formData.value = {
    name: props.tournament.name || '',
    slug: props.tournament.slug || '',
    organizer: props.tournament.organizer || '',
    game: props.tournament.game || 'bf1942',
    anticipatedRoundCount: props.tournament.anticipatedRoundCount,
    status: props.tournament.status || 'draft',
    gameMode: props.tournament.gameMode || 'Conquest',
    discordUrl: props.tournament.discordUrl || '',
    youTubeUrl: props.tournament.youTubeUrl || '',
    twitchUrl: props.tournament.twitchUrl || '',
    forumUrl: props.tournament.forumUrl || '',
    promoVideoUrl: props.tournament.promoVideoUrl || '',
    rules: props.tournament.rules || '',
    registrationRules: props.tournament.registrationRules || '',
  };
  if (props.tournament.theme) {
    themeData.value = {
      backgroundColour: props.tournament.theme.backgroundColour || '#000000',
      textColour: props.tournament.theme.textColour || '#FFFFFF',
      accentColour: props.tournament.theme.accentColour || '#FFD700',
    };
  }

  if (props.tournament.hasHeroImage && !heroImageFile.value && !removeHeroImageFlag.value) {
    loadHeroImage();
  }
  if (props.tournament.hasCommunityLogo && !logoImageFile.value && !removeLogoImageFlag.value) {
    loadLogoImage();
  }
};

watch(() => props.tournament, populateForm, { immediate: true });

// Player search state
const playerSuggestions = ref<PlayerSearchResult[]>([]);
const showPlayerDropdown = ref(false);
let searchTimeout: number | null = null;
let blurTimeout: number | null = null;

const heroImageUrl = computed(() => {
  if (heroImagePreview.value) return heroImagePreview.value;
  return null;
});

const logoImageUrl = computed(() => {
  if (logoImagePreview.value) return logoImagePreview.value;
  return null;
});

// Computed
const renderedRules = computed(() => {
  if (!props.tournament?.rules || !props.tournament.rules.trim()) {
    return '';
  }
  try {
    return marked(props.tournament.rules, { breaks: true });
  } catch {
    return '<p class="text-red-400">Invalid markdown in rules</p>';
  }
});

// Helpers
const getGameLabel = (game: string): string => {
  const labels: Record<string, string> = {
    'bf1942': 'Battlefield 1942',
    'fh2': 'Forgotten Hope 2',
    'bfvietnam': 'Battlefield Vietnam'
  };
  return labels[game] || game;
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};

// Edit Panel Functions
const openEditPanel = () => {
  formData.value = {
    name: props.tournament.name,
    slug: props.tournament.slug || '',
    organizer: props.tournament.organizer,
    game: props.tournament.game,
    anticipatedRoundCount: props.tournament.anticipatedRoundCount,
    status: props.tournament.status || 'draft',
    gameMode: props.tournament.gameMode || 'Conquest',
    discordUrl: props.tournament.discordUrl || '',
    youTubeUrl: props.tournament.youTubeUrl || '',
    twitchUrl: props.tournament.twitchUrl || '',
    forumUrl: props.tournament.forumUrl || '',
    promoVideoUrl: props.tournament.promoVideoUrl || '',
    rules: props.tournament.rules || '',
    registrationRules: props.tournament.registrationRules || '',
  };
  formError.value = null;
  currentView.value = 'editDetails';
};

const closeEditPanel = () => {
  currentView.value = 'list';
  formError.value = null;
};

const resetForm = () => {
  populateForm();
  heroImageFile.value = null;
  logoImageFile.value = null;
  if (heroImagePreview.value?.startsWith('blob:')) URL.revokeObjectURL(heroImagePreview.value);
  if (logoImagePreview.value?.startsWith('blob:')) URL.revokeObjectURL(logoImagePreview.value);
  heroImagePreview.value = null;
  logoImagePreview.value = null;
  removeHeroImageFlag.value = false;
  removeLogoImageFlag.value = false;
  formError.value = null;
};

const submitForm = async () => {
  if (!formData.value.name.trim() || !formData.value.organizer.trim()) {
    formError.value = 'Tournament name and organizer are required.';
    return;
  }

  formLoading.value = true;
  formError.value = null;
  saveSuccess.value = false;

  try {
    const request: any = {
      name: formData.value.name.trim(),
      slug: formData.value.slug.trim() || undefined,
      organizer: formData.value.organizer.trim(),
      game: formData.value.game,
      anticipatedRoundCount: formData.value.anticipatedRoundCount || undefined,
      status: formData.value.status,
      gameMode: formData.value.gameMode || undefined,
      discordUrl: formData.value.discordUrl.trim() || undefined,
      youTubeUrl: formData.value.youTubeUrl.trim() || undefined,
      twitchUrl: formData.value.twitchUrl.trim() || undefined,
      forumUrl: formData.value.forumUrl.trim() || undefined,
      promoVideoUrl: formData.value.promoVideoUrl.trim() || undefined,
      rules: formData.value.rules.trim() || undefined,
      registrationRules: formData.value.registrationRules.trim() || undefined,
      theme: {
        backgroundColour: themeData.value.backgroundColour,
        textColour: themeData.value.textColour,
        accentColour: themeData.value.accentColour,
      },
    };

    // Handle hero image
    if (heroImageFile.value) {
      const imageData = await adminTournamentService.imageToBase64(heroImageFile.value);
      request.heroImageBase64 = imageData.base64;
      request.heroImageContentType = imageData.contentType;
    } else if (removeHeroImageFlag.value) {
      request.RemoveHeroImage = true;
    }

    // Handle logo image
    if (logoImageFile.value) {
      const logoData = await adminTournamentService.imageToBase64(logoImageFile.value);
      request.communityLogoBase64 = logoData.base64;
      request.communityLogoContentType = logoData.contentType;
    } else if (removeLogoImageFlag.value) {
      request.RemoveCommunityLogo = true;
    }

    await adminTournamentService.updateTournament(props.tournament.id, request);
    saveSuccess.value = true;
    setTimeout(() => {
      saveSuccess.value = false;
    }, 4000);
    emit('refresh');
  } catch (err) {
    console.error('Error updating tournament:', err);
    formError.value = err instanceof Error ? err.message : 'Failed to update tournament';
  } finally {
    formLoading.value = false;
  }
};

// Player search
const searchPlayers = async (query: string) => {
  if (!query || query.length < 2) {
    playerSuggestions.value = [];
    showPlayerDropdown.value = false;
    return;
  }

  try {
    const response = await fetch(`/stats/Players/search?query=${encodeURIComponent(query)}&pageSize=10`);
    if (!response.ok) throw new Error('Failed to search');
    const data = await response.json();
    playerSuggestions.value = data.items || [];
    showPlayerDropdown.value = playerSuggestions.value.length > 0;
  } catch {
    playerSuggestions.value = [];
    showPlayerDropdown.value = false;
  }
};

const onOrganizerInput = () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchPlayers(formData.value.organizer);
  }, 300) as unknown as number;
};

const onOrganizerBlur = () => {
  blurTimeout = setTimeout(() => {
    showPlayerDropdown.value = false;
  }, 200) as unknown as number;
};

const selectPlayer = (player: PlayerSearchResult) => {
  formData.value.organizer = player.playerName;
  playerSuggestions.value = [];
  showPlayerDropdown.value = false;
};

// Theme Panel Functions
const openThemePanel = async () => {
  themeData.value = {
    backgroundColour: props.tournament.theme?.backgroundColour || '#000000',
    textColour: props.tournament.theme?.textColour || '#FFFFFF',
    accentColour: props.tournament.theme?.accentColour || '#FFD700',
  };
  themeError.value = null;
  heroImageFile.value = null;
  logoImageFile.value = null;
  removeHeroImageFlag.value = false;
  removeLogoImageFlag.value = false;

  // Load existing images
  heroImagePreview.value = null;
  logoImagePreview.value = null;

  currentView.value = 'editTheme';

  if (props.tournament.hasHeroImage) {
    await loadHeroImage();
  }
  if (props.tournament.hasCommunityLogo) {
    await loadLogoImage();
  }
};

const closeThemePanel = () => {
  currentView.value = 'list';
  themeError.value = null;
  // Clean up blob URLs
  if (heroImagePreview.value?.startsWith('blob:')) {
    URL.revokeObjectURL(heroImagePreview.value);
  }
  if (logoImagePreview.value?.startsWith('blob:')) {
    URL.revokeObjectURL(logoImagePreview.value);
  }
};

const triggerHeroUpload = () => heroImageInput.value?.click();
const triggerLogoUpload = () => logoImageInput.value?.click();

const handleHeroImageSelect = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) processImage(file, 'hero');
};

const handleLogoImageSelect = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) processImage(file, 'logo');
};

const processImage = (file: File, type: 'hero' | 'logo') => {
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    themeError.value = 'Invalid file type. Use JPEG, PNG, GIF, or WEBP.';
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    themeError.value = 'File size must be less than 4MB.';
    return;
  }

  themeError.value = null;
  const reader = new FileReader();
  reader.onload = (e) => {
    if (type === 'hero') {
      heroImageFile.value = file;
      heroImagePreview.value = e.target?.result as string;
      removeHeroImageFlag.value = false;
    } else {
      logoImageFile.value = file;
      logoImagePreview.value = e.target?.result as string;
      removeLogoImageFlag.value = false;
    }
  };
  reader.readAsDataURL(file);
};

const removeHeroImage = () => {
  heroImageFile.value = null;
  heroImagePreview.value = null;
  removeHeroImageFlag.value = true;
  if (heroImageInput.value) heroImageInput.value.value = '';
};

const removeLogoImage = () => {
  logoImageFile.value = null;
  logoImagePreview.value = null;
  removeLogoImageFlag.value = true;
  if (logoImageInput.value) logoImageInput.value.value = '';
};

const applyPreset = (preset: string) => {
  const presets: Record<string, { backgroundColour: string; textColour: string; accentColour: string }> = {
    dark: { backgroundColour: '#000000', textColour: '#FFFFFF', accentColour: '#FFD700' },
    light: { backgroundColour: '#FFFFFF', textColour: '#000000', accentColour: '#0066CC' },
    cyberpunk: { backgroundColour: '#0a0e27', textColour: '#FFFFFF', accentColour: '#FF00FF' },
    ocean: { backgroundColour: '#0f2c5c', textColour: '#FFFFFF', accentColour: '#00FFFF' },
  };
  const p = presets[preset];
  if (p) themeData.value = { ...p };
};

const submitThemeForm = async () => {
  themeLoading.value = true;
  themeError.value = null;

  try {
    const request: any = {
      theme: {
        backgroundColour: themeData.value.backgroundColour,
        textColour: themeData.value.textColour,
        accentColour: themeData.value.accentColour,
      },
    };

    // Handle hero image
    if (heroImageFile.value) {
      const imageData = await adminTournamentService.imageToBase64(heroImageFile.value);
      request.heroImageBase64 = imageData.base64;
      request.heroImageContentType = imageData.contentType;
    } else if (removeHeroImageFlag.value) {
      request.RemoveHeroImage = true;
    }

    // Handle logo image
    if (logoImageFile.value) {
      const logoData = await adminTournamentService.imageToBase64(logoImageFile.value);
      request.communityLogoBase64 = logoData.base64;
      request.communityLogoContentType = logoData.contentType;
    } else if (removeLogoImageFlag.value) {
      request.RemoveCommunityLogo = true;
    }

    await adminTournamentService.updateTournament(props.tournament.id, request);
    closeThemePanel();
    emit('refresh');
  } catch (err) {
    console.error('Error updating theme:', err);
    themeError.value = err instanceof Error ? err.message : 'Failed to update theme';
  } finally {
    themeLoading.value = false;
  }
};

// Cleanup
onUnmounted(() => {
  if (heroImagePreview.value?.startsWith('blob:')) {
    URL.revokeObjectURL(heroImagePreview.value);
  }
  if (logoImagePreview.value?.startsWith('blob:')) {
    URL.revokeObjectURL(logoImagePreview.value);
  }
});

// Expose load method for parent to trigger refresh
const load = () => {
  // Settings data comes from parent, nothing to load here
};

defineExpose({ load });
</script>

<style scoped>
.tournament-settings-tab {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.markdown-rules :deep(h1),
.markdown-rules :deep(h2),
.markdown-rules :deep(h3),
.markdown-rules :deep(h4),
.markdown-rules :deep(h5),
.markdown-rules :deep(h6) {
  color: var(--mm-ink);
  font-weight: 500;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}

.markdown-rules :deep(p) {
  margin-bottom: 0.5rem;
  color: var(--mm-ink-soft);
}

.markdown-rules :deep(strong) {
  font-weight: 600;
  color: var(--mm-ink);
}

.markdown-rules :deep(em) {
  color: var(--mm-ink-soft);
  font-style: italic;
}

.markdown-rules :deep(ul) {
  list-style-type: disc;
  margin-left: 1.5rem;
  margin-bottom: 0.5rem;
  padding-left: 0;
}

.markdown-rules :deep(ol) {
  list-style-type: decimal;
  margin-left: 1.5rem;
  margin-bottom: 0.5rem;
  padding-left: 0;
}

.markdown-rules :deep(li) {
  margin-bottom: 0.25rem;
  color: var(--mm-ink-soft);
  margin-left: 1rem;
}

.markdown-rules :deep(code) {
  background-color: var(--mm-bg-mute);
  padding: 0.125rem 0.375rem;
  border-radius: 2px;
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
}

.markdown-rules :deep(blockquote) {
  border-left: 3px solid var(--mm-rule-strong);
  padding-left: 1rem;
  margin-left: 0;
  color: var(--mm-ink-muted);
}

.markdown-rules :deep(a) {
  color: var(--mm-accent);
  text-decoration: underline;
}

.markdown-rules :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1rem 0;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  overflow: hidden;
}

.markdown-rules :deep(th) {
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-weight: 500;
  color: var(--mm-ink-muted);
  background: var(--mm-bg-soft);
  border-bottom: 1px solid var(--mm-rule);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-family: var(--mm-font-mono);
}

.markdown-rules :deep(td) {
  padding: 0.5rem 0.75rem;
  color: var(--mm-ink);
  border-bottom: 1px solid var(--mm-rule);
}
</style>
