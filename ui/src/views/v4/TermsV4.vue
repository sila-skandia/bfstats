<script setup lang="ts">
import MmLegalDocument from '@/components/v4/MmLegalDocument.vue'
import type { LegalSection } from '@/components/v4/legalDocument'

const DISCORD_INVITE = 'https://discord.gg/6saqqTTYEM'

const sections: LegalSection[] = [
  { id: 'what-this-is', title: 'What this is' },
  { id: 'comments', title: 'Comments' },
  { id: 'account', title: 'Your account' },
  { id: 'stats', title: 'Stats and player names' },
  { id: 'liability', title: 'No warranty, no liability' },
  { id: 'admin', title: 'Admin' },
]
</script>

<template>
  <MmLegalDocument
    eyebrow="Legal"
    title="Terms of Service"
    effective-date="10 September 2026"
    :sections="sections"
  >
    <template #glance>
      <div class="mm-legal-fact mm-legal-fact--none">
        <div class="mm-legal-fact__label">Cost</div>
        <div class="mm-legal-fact__value">Free</div>
        <div class="mm-legal-fact__note">No payments, no subscriptions, no ads.</div>
      </div>
      <div class="mm-legal-fact">
        <div class="mm-legal-fact__label">Run by</div>
        <div class="mm-legal-fact__value">One person</div>
        <div class="mm-legal-fact__note">A hobby project. Not EA, not DICE, not a company.</div>
      </div>
      <div class="mm-legal-fact">
        <div class="mm-legal-fact__label">Uptime promised</div>
        <div class="mm-legal-fact__value">None</div>
        <div class="mm-legal-fact__note">One machine. It can break, and data can be lost.</div>
      </div>
      <div class="mm-legal-fact mm-legal-fact--none">
        <div class="mm-legal-fact__label">Leaving</div>
        <div class="mm-legal-fact__value">One click</div>
        <div class="mm-legal-fact__note">Delete your account from your dashboard, any time.</div>
      </div>
    </template>

    <h2 id="what-this-is"><span class="mm-legal__num">01</span>What this is</h2>
    <p>
      bfstats.io turns publicly broadcast Battlefield 1942 server information into
      statistics, rankings and tournament tooling. Free, ad-free, run as a hobby.
      Using it means you accept these terms and the
      <router-link to="/privacy">Privacy Policy</router-link>.
    </p>
    <p>
      Battlefield and Battlefield 1942 are trademarks of Electronic Arts Inc. This is an
      independent fan project with no affiliation with or endorsement from EA, DICE, or
      any mod team.
    </p>

    <h2 id="comments"><span class="mm-legal__num">02</span>Comments</h2>
    <p><strong>Comments are public and tied to the player alias you post under.</strong></p>

    <h2 id="account"><span class="mm-legal__num">03</span>Your account</h2>
    <p>
      Browsing needs no account. Creating one uses Discord, which sets a minimum age of
      13. Delete it any time from your dashboard.
    </p>

    <h2 id="stats"><span class="mm-legal__num">04</span>Stats and player names</h2>
    <p>
      In-game names are self-chosen and unverified, so linking one to your account is a
      convenience, <strong>not proof of identity</strong>.
    </p>
    <p>
      We don't promise stats are complete or accurate. Servers drop out and polls get
      missed.
    </p>

    <h2 id="liability"><span class="mm-legal__num">05</span>No warranty, no liability</h2>
    <p>
      Provided <strong>"as is" and "as available", with no warranties of any kind</strong>. It may be
      slow, down, or wiped by a hardware failure. Features may change or disappear. Keep
      your own copy of anything you'd hate to lose; your dashboard exports your data any
      time.
    </p>
    <p>
      As far as the law allows, we're not liable for indirect or consequential loss, lost
      data, lost rankings, or any tournament outcome. Where liability can't be excluded,
      it's capped at what you've paid us, which is nothing. Nothing here excludes
      liability that can't lawfully be excluded, and consumers keep whatever rights local
      law gives them.
    </p>

    <h2 id="admin"><span class="mm-legal__num">06</span>Admin</h2>
    <ul>
      <li><strong>Tournaments</strong> — we host the tooling, organisers run the events. If an organiser deletes their account the tournament stays, so participants keep their results.</li>
      <li><strong>Changes</strong> — the effective date at the top changes when these do.</li>
      <li><strong>Law</strong> — Australian law, Australian courts, non-exclusive jurisdiction.</li>
      <li>
        <strong>Contact</strong> —
        <a :href="DISCORD_INVITE" target="_blank" rel="noopener noreferrer">discord.gg/6saqqTTYEM</a>.
      </li>
    </ul>
  </MmLegalDocument>
</template>
