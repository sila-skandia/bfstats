<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { decodePlayerName } from '../utils/playerName';

interface Props {
  name: string;
  linkToPlayerDetails?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  linkToPlayerDetails: false,
  class: ''
});

const router = useRouter();

// Route URLs use the raw stored name so existing deep links and DB lookups keep working.
const handlePlayerNameClick = () => {
  if (props.linkToPlayerDetails) {
    router.push(`/players/${encodeURIComponent(props.name)}`);
  }
};

const displayName = computed(() => decodePlayerName(props.name));

const containerClass = computed(() => {
  const classes = ['player-name-container'];

  if (props.class) {
    classes.push(props.class);
  }

  return classes.join(' ');
});
</script>

<template>
  <span 
    :class="containerClass"
  >
    <span 
      class="player-name-text"
      :class="{ 'clickable-name': linkToPlayerDetails }"
      @click="handlePlayerNameClick"
    >
      {{ displayName }}
    </span>
  </span>
</template>

<style scoped>
.player-name-container {
  display: inline;
}

.player-name-text {
  color: inherit;
  font-weight: inherit;
  transition: all 0.2s ease;
}

.player-name-text.clickable-name {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: transparent;
  transition: all 0.2s ease;
}

.player-name-text.clickable-name:hover {
  text-decoration-color: currentColor;
  opacity: 0.8;
}
</style>