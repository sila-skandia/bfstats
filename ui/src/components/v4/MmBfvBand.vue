<script setup lang="ts">
// BattleView Vietnam's banner on bfstats.io's own sign-in and Allow pages, for a
// visitor who came from bfv.bfstats.io (features/bfv-through-bfstats): its accounts
// are bfstats.io's, and this keeps them in its world while they sign in. The art is
// bfv's own share image, served by bfv.
defineProps<{ note?: string }>()
</script>

<template>
  <figure class="mm-bfv-band" data-testid="bfv-band">
    <img
      class="mm-bfv-band__art"
      src="https://bfv.bfstats.io/welcome/media/share.jpg"
      alt="BattleView Vietnam"
      width="1200"
      height="630"
      decoding="async"
    />
    <figcaption class="mm-bfv-band__note">
      {{ note ?? 'BattleView Vietnam uses bfstats.io accounts. Sign in or create one here and you go straight back.' }}
    </figcaption>
  </figure>
</template>

<style scoped>
.mm-bfv-band {
  margin: 0 0 20px;
  border: 1px solid var(--mm-rule-strong);
  background: var(--mm-bg);
  overflow: hidden;
}
.mm-bfv-band__art {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1200 / 630;
  object-fit: cover;
  object-position: 15% 45%;
  max-height: 180px;
}
.mm-bfv-band__note {
  margin: 0;
  padding: 10px 14px;
  border-top: 1px solid var(--mm-rule-strong);
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-body);
  font-size: 13px;
  line-height: 1.45;
}
</style>
