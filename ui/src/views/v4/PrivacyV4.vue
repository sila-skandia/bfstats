<script setup lang="ts">
import MmLegalDocument from '@/components/v4/MmLegalDocument.vue'
import type { LegalSection } from '@/components/v4/legalDocument'

const DISCORD_INVITE = 'https://discord.gg/6saqqTTYEM'

const sections: LegalSection[] = [
  { id: 'delete', title: 'Delete your account' },
  { id: 'collect', title: 'What we store' },
  { id: 'stats', title: 'Player stats' },
  { id: 'sharing', title: 'Who else sees it' },
  { id: 'retention', title: 'How long we keep it' },
  { id: 'rights', title: 'Your rights' },
  { id: 'admin', title: 'Admin' },
]
</script>

<template>
  <MmLegalDocument
    eyebrow="Legal"
    title="Privacy Policy"
    effective-date="10 September 2026"
    :sections="sections"
  >
    <template #glance>
      <div class="mm-legal-fact mm-legal-fact--none">
        <div class="mm-legal-fact__label">Advertising</div>
        <div class="mm-legal-fact__value">None</div>
        <div class="mm-legal-fact__note">No ads, no ad networks, no ad IDs.</div>
      </div>
      <div class="mm-legal-fact mm-legal-fact--none">
        <div class="mm-legal-fact__label">Tracking &amp; analytics</div>
        <div class="mm-legal-fact__value">None</div>
        <div class="mm-legal-fact__note">No Google Analytics, no pixels, no third-party scripts.</div>
      </div>
      <div class="mm-legal-fact mm-legal-fact--none">
        <div class="mm-legal-fact__label">Data sold or shared</div>
        <div class="mm-legal-fact__value">Never</div>
        <div class="mm-legal-fact__note">Not sold, not brokered, not used for profiling.</div>
      </div>
      <div class="mm-legal-fact">
        <div class="mm-legal-fact__label">Stored about you</div>
        <div class="mm-legal-fact__value">Your email</div>
        <div class="mm-legal-fact__note">Only if you sign in. Plus buddies, aliases and favourites you add.</div>
      </div>
      <div class="mm-legal-fact">
        <div class="mm-legal-fact__label">Cookies</div>
        <div class="mm-legal-fact__value">One</div>
        <div class="mm-legal-fact__note">Keeps you signed in. That's why there's no cookie banner.</div>
      </div>
      <div class="mm-legal-fact mm-legal-fact--none">
        <div class="mm-legal-fact__label">Deleting it all</div>
        <div class="mm-legal-fact__value">One click</div>
        <div class="mm-legal-fact__note">Dashboard → Account. Instant, no request, no waiting.</div>
      </div>
    </template>

    <h2 id="delete"><span class="mm-legal__num">01</span>Delete your account</h2>
    <p>Go here. It's immediate and can't be undone.</p>
    <router-link to="/v4/dashboard" class="mm-legal-cta">Dashboard → Account</router-link>
    <p>Same place, <strong>Export</strong> downloads everything we hold about you as JSON.</p>
    <p>
      Deleting removes your email, linked player names, buddies, favourite servers,
      sessions and comments. Two things stay: <strong>player stats</strong> (see below) and
      <strong>tournaments you created</strong>, so other players keep their results. Your email is
      erased from those.
    </p>

    <h2 id="collect"><span class="mm-legal__num">02</span>What we store</h2>
    <table class="mm-legal-table">
      <tbody>
        <tr><td>Account</td><td>Your Discord email. Nothing else from Discord is stored on our servers.</td></tr>
        <tr><td>Preferences</td><td>Player names, favourite servers and buddies you add yourself.</td></tr>
        <tr><td>Sessions</td><td>A one-way hash of each session token, plus the IP and browser it came from.</td></tr>
        <tr><td>Posts</td><td>Comments, tournaments and teams you create or join.</td></tr>
        <tr><td>Logs</td><td>IP address, path, user-agent. For uptime and abuse investigation.</td></tr>
        <tr><td>AI chat</td><td>Questions go to Azure OpenAI for an answer. Rated replies are stored with no link to you.</td></tr>
      </tbody>
    </table>
    <p>
      No real name, address, birthday, phone number or payment details. The site takes no
      money.
    </p>

    <h2 id="stats"><span class="mm-legal__num">03</span>Player stats</h2>
    <p>
      Battlefield 1942 servers broadcast their scores and player list to anyone who
      queries them. We poll that and keep the history, filed under the in-game name
      someone played as, whether or not they've ever visited this site.
    </p>
    <p>
      So <strong>stats aren't account data, and deleting your account doesn't delete them</strong> —
      other players' match histories reference the same rounds. To get stats for a name
      removed, message us.
    </p>

    <h2 id="sharing"><span class="mm-legal__num">04</span>Who else sees it</h2>
    <table class="mm-legal-table">
      <tbody>
        <tr><td>Discord</td><td>Handles sign-in. We never see your password.</td></tr>
        <tr><td>Azure&nbsp;OpenAI</td><td>Gets your question when you use the AI assistant.</td></tr>
        <tr><td>Hetzner</td><td>Hosts the server.</td></tr>
      </tbody>
    </table>
    <p>Nobody else, unless legally compelled. That hasn't happened.</p>

    <h2 id="retention"><span class="mm-legal__num">05</span>How long we keep it</h2>
    <ul>
      <li><strong>Account data</strong> — until you delete it.</li>
      <li><strong>Sessions</strong> — until they expire or you sign out.</li>
      <li><strong>Logs</strong> — a limited period, then they roll off.</li>
      <li><strong>Player stats</strong> — indefinitely. A stats site with holes in its history isn't one.</li>
    </ul>

    <h2 id="rights"><span class="mm-legal__num">06</span>Your rights</h2>
    <p>
      Access, correct, delete, or object to processing. The first three are self-service
      in your dashboard. For anything else, message us. EU and UK residents can also
      complain to their national data protection authority.
    </p>
    <p>
      Legal bases: <strong>contract</strong> for your account and preferences,
      <strong>legitimate interests</strong> for stats, logs and security.
    </p>

    <h2 id="admin"><span class="mm-legal__num">07</span>Admin</h2>
    <ul>
      <li><strong>Who runs it</strong> — one person, as a hobby, and the data controller for GDPR. These rights apply to everyone, not just the EU and UK.</li>
      <li><strong>Age</strong> — accounts need Discord, which sets a minimum age of 13.</li>
      <li><strong>Security</strong> — HTTPS, session tokens stored only as hashes.</li>
      <li><strong>Changes</strong> — the effective date at the top changes when this does.</li>
      <li>
        <strong>Contact</strong> —
        <a :href="DISCORD_INVITE" target="_blank" rel="noopener noreferrer">discord.gg/6saqqTTYEM</a>.
      </li>
    </ul>
  </MmLegalDocument>
</template>
