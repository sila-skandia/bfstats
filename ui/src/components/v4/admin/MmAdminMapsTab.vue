<template>
  <div class="mm-admin-maps">
    <!-- KPI Summary Shelf -->
    <div v-if="summary" class="mm-admin-maps__kpis">
      <div class="mm-admin-card mm-admin-maps__kpi mm-admin-maps__kpi--alert">
        <span class="mm-admin-maps__kpi-val">{{ summary.missingIconMaps.toLocaleString() }}</span>
        <span class="mm-admin-maps__kpi-label">Missing icon maps</span>
        <span class="mm-admin-maps__kpi-sub">Needs mod asset import</span>
      </div>

      <div class="mm-admin-card mm-admin-maps__kpi">
        <span class="mm-admin-maps__kpi-val">{{ summary.hasIconMaps.toLocaleString() }}</span>
        <span class="mm-admin-maps__kpi-label">Maps with icons</span>
        <span class="mm-admin-maps__kpi-sub">Assets present on volume</span>
      </div>

      <div class="mm-admin-card mm-admin-maps__kpi">
        <span class="mm-admin-maps__kpi-val">{{ summary.totalMaps.toLocaleString() }}</span>
        <span class="mm-admin-maps__kpi-label">Total unique maps</span>
        <span class="mm-admin-maps__kpi-sub">Recorded across rounds</span>
      </div>

      <div class="mm-admin-card mm-admin-maps__kpi mm-admin-maps__kpi--mod">
        <span class="mm-admin-maps__kpi-val">{{ summary.uninstalledMods.toLocaleString() }}</span>
        <span class="mm-admin-maps__kpi-label">Uninstalled mods</span>
        <span class="mm-admin-maps__kpi-sub">{{ summary.totalMods }} total mods identified</span>
      </div>
    </div>

    <!-- Mod Discovery Shelf -->
    <section v-if="mods.length > 0" class="mm-admin-card mm-admin-maps__mod-shelf">
      <div class="mm-admin-card__head">
        <h3 class="mm-admin-card__title mm-admin-card__title--strong">
          Mod discovery & coverage
        </h3>
        <p class="mm-admin-card__desc">
          Mods reported by rotating servers. Mods marked UNINSTALLED have missing map icons and are prime candidates for importing archives.
        </p>
      </div>
      <div class="mm-admin-card__body mm-admin-maps__mod-chips">
        <button
          type="button"
          class="mm-admin-chip"
          :class="{ 'mm-admin-chip--active': !selectedMod }"
          @click="selectMod(null)"
        >
          All mods ({{ summary?.totalMaps ?? 0 }})
        </button>
        <button
          v-for="m in sortedMods"
          :key="m.gameId"
          type="button"
          class="mm-admin-maps__mod-pill"
          :class="{
            'mm-admin-maps__mod-pill--active': selectedMod === m.gameId,
            'mm-admin-maps__mod-pill--uninstalled': !m.isInstalled,
            'mm-admin-maps__mod-pill--installed': m.isInstalled
          }"
          @click="selectMod(m.gameId)"
        >
          <span class="mm-admin-maps__mod-pill-name">{{ m.gameId }}</span>
          <span
            v-if="!m.isInstalled"
            class="mm-admin-maps__tag mm-admin-maps__tag--warn"
          >
            UNINSTALLED
          </span>
          <span class="mm-admin-maps__mod-pill-stat">
            {{ m.missingMaps }} missing / {{ m.totalMaps }} maps
          </span>
        </button>
      </div>
    </section>

    <!-- Main Report Card -->
    <section class="mm-admin-card">
      <div class="mm-admin-card__head mm-admin-maps__controls">
        <div class="mm-admin-maps__filters">
          <!-- View Switcher -->
          <div class="mm-admin-maps__view-group" role="group" aria-label="View mode">
            <button
              type="button"
              class="mm-admin-maps__view-btn"
              :class="{ 'mm-admin-maps__view-btn--active': viewMode === 'mod' }"
              @click="setViewMode('mod')"
            >
              Group by mod
            </button>
            <button
              type="button"
              class="mm-admin-maps__view-btn"
              :class="{ 'mm-admin-maps__view-btn--active': viewMode === 'flat' }"
              @click="setViewMode('flat')"
            >
              Flat list
            </button>
          </div>

          <!-- Status Switcher -->
          <div class="mm-admin-maps__status-group" role="group" aria-label="Status filter">
            <button
              type="button"
              class="mm-admin-maps__status-btn"
              :class="{ 'mm-admin-maps__status-btn--active': statusFilter === 'missing' }"
              @click="setStatusFilter('missing')"
            >
              Missing only
            </button>
            <button
              type="button"
              class="mm-admin-maps__status-btn"
              :class="{ 'mm-admin-maps__status-btn--active': statusFilter === 'all' }"
              @click="setStatusFilter('all')"
            >
              All maps
            </button>
            <button
              type="button"
              class="mm-admin-maps__status-btn"
              :class="{ 'mm-admin-maps__status-btn--active': statusFilter === 'has_icon' }"
              @click="setStatusFilter('has_icon')"
            >
              Has icon
            </button>
          </div>

          <!-- Text Search -->
          <div class="mm-admin-maps__search-wrap">
            <input
              v-model="searchQuery"
              type="search"
              placeholder="Search map, server, or mod…"
              class="mm-admin-input mm-admin-input--mono mm-admin-maps__search"
              @input="onSearchInput"
            />
          </div>

          <!-- Mod Dropdown -->
          <div class="mm-admin-maps__select-wrap">
            <select
              v-model="selectedMod"
              class="mm-admin-select mm-admin-maps__select"
              @change="onFilterChange"
            >
              <option :value="null">All mods</option>
              <option
                v-for="m in mods"
                :key="m.gameId"
                :value="m.gameId"
              >
                {{ m.gameId }}{{ !m.isInstalled ? ' (uninstalled)' : '' }} ({{ m.totalMaps }} maps)
              </option>
            </select>
          </div>

          <!-- Sort Selector -->
          <div class="mm-admin-maps__select-wrap">
            <select
              v-model="sortBy"
              class="mm-admin-select mm-admin-maps__select"
              @change="onFilterChange"
            >
              <option value="rounds">Sort: Total rounds</option>
              <option value="servers">Sort: Server count</option>
              <option value="lastSeen">Sort: Recently played</option>
              <option value="name">Sort: Map name</option>
            </select>
          </div>

          <!-- Refresh Button -->
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm mm-admin-maps__refresh-btn"
            :disabled="loading"
            @click="loadReport"
          >
            Refresh
          </button>
        </div>
      </div>

      <!-- Report Body -->
      <div class="mm-admin-card__body mm-admin-maps__body">
        <div v-if="error" class="mm-admin-alert mm-admin-alert--err">{{ error }}</div>

        <!-- Loading state -->
        <div v-if="loading" class="mm-admin-empty mm-admin-empty--loading">
          <span class="mm-admin-spinner" aria-hidden="true" />
          <span class="mm-admin-empty__text">Analyzing map rotations and icons…</span>
        </div>

        <!-- Mod Groups View -->
        <div v-else-if="viewMode === 'mod'" class="mm-admin-maps__mod-groups-wrap">
          <div v-if="modGroups.length === 0" class="mm-admin-empty">
            <span class="mm-admin-empty__title">No mod groups found</span>
            <span class="mm-admin-empty__desc">
              No maps match the current filters. Try changing your search query or status filter.
            </span>
          </div>

          <template v-else>
            <!-- Bulk Actions Bar -->
            <div class="mm-admin-maps__mod-groups-bar">
              <span class="mm-admin-maps__mod-groups-count">
                Showing <strong>{{ modGroups.length }}</strong> mod groups ({{ totalMissingInGroups.toLocaleString() }} missing maps)
              </span>
              <div class="mm-admin-maps__mod-groups-actions">
                <button
                  type="button"
                  class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--xs"
                  @click="expandAllMods"
                >
                  Expand all
                </button>
                <button
                  type="button"
                  class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--xs"
                  @click="collapseAllMods"
                >
                  Collapse all
                </button>
              </div>
            </div>

            <!-- Mod Cards List -->
            <div class="mm-admin-maps__mod-groups">
              <div
                v-for="group in modGroups"
                :key="group.gameId"
                class="mm-admin-maps__mod-card"
                :class="{
                  'mm-admin-maps__mod-card--uninstalled': !group.isInstalled,
                  'mm-admin-maps__mod-card--expanded': isModExpanded(group.gameId)
                }"
              >
                <!-- Mod Header -->
                <div
                  class="mm-admin-maps__mod-header"
                  @click="toggleModExpand(group.gameId)"
                >
                  <div class="mm-admin-maps__mod-title-area">
                    <span class="mm-admin-maps__mod-chevron">
                      {{ isModExpanded(group.gameId) ? '▲' : '▼' }}
                    </span>
                    <span class="mm-admin-maps__mod-name">{{ group.gameId }}</span>
                    <span
                      v-if="!group.isInstalled"
                      class="mm-admin-maps__tag mm-admin-maps__tag--warn"
                    >
                      UNINSTALLED
                    </span>
                    <span
                      v-else
                      class="mm-admin-maps__tag mm-admin-maps__tag--neutral"
                    >
                      INSTALLED
                    </span>
                    <span class="mm-admin-maps__mod-stat-pill mm-admin-mono">
                      <strong>{{ group.missingMaps }}</strong> missing / {{ group.totalMaps }} maps
                    </span>
                  </div>

                  <div class="mm-admin-maps__mod-meta-area">
                    <span class="mm-admin-maps__mod-rounds mm-admin-mono">
                      {{ group.totalRounds.toLocaleString() }} rounds
                    </span>
                    <span class="mm-admin-maps__mod-servers mm-admin-mono">
                      {{ group.serverCount }} server{{ group.serverCount === 1 ? '' : 's' }}
                    </span>
                    <button
                      v-if="group.missingMaps > 0"
                      type="button"
                      class="mm-admin-btn mm-admin-btn--sm mm-admin-maps__copy-btn"
                      :class="copiedMod === group.gameId ? 'mm-admin-btn--primary' : 'mm-admin-btn--ghost'"
                      :title="`Copy ${group.missingMaps} missing map names for ${group.gameId}`"
                      @click.stop="copyMissingMapNames(group)"
                    >
                      {{ copiedMod === group.gameId ? 'COPIED ' + group.missingMaps + ' NAMES!' : 'COPY MISSING (' + group.missingMaps + ')' }}
                    </button>
                  </div>
                </div>

                <!-- Mod Sample Servers preview when collapsed -->
                <div
                  v-if="!isModExpanded(group.gameId) && group.sampleServers.length > 0"
                  class="mm-admin-maps__mod-servers-preview"
                >
                  <span class="mm-admin-maps__preview-label">Servers:</span>
                  <span
                    v-for="(sName, idx) in group.sampleServers"
                    :key="idx"
                    class="mm-admin-maps__preview-server"
                  >
                    {{ $pn(sName) }}{{ idx < group.sampleServers.length - 1 ? ',' : '' }}
                  </span>
                </div>

                <!-- Mod Card Content (Maps Table) -->
                <div
                  v-if="isModExpanded(group.gameId)"
                  class="mm-admin-maps__mod-body"
                >
                  <div class="mm-admin-table-wrap">
                    <table class="mm-admin-table mm-admin-maps__table">
                      <thead>
                        <tr>
                          <th style="width: 54px;">Icon</th>
                          <th>Map name</th>
                          <th>Status</th>
                          <th class="is-num">Rounds</th>
                          <th class="is-num">Playtime</th>
                          <th>Last seen</th>
                          <th>Rotating servers</th>
                        </tr>
                      </thead>
                      <tbody>
                        <template v-for="m in group.maps" :key="m.normalizedMapName">
                          <tr
                            class="mm-admin-maps__row"
                            :class="{ 'mm-admin-maps__row--expanded': isExpanded(m.normalizedMapName) }"
                            @click="toggleExpand(m.normalizedMapName)"
                          >
                            <!-- Thumbnail / Placeholder -->
                            <td>
                              <div class="mm-admin-maps__thumb-wrap">
                                <MmMapThumb
                                  v-if="m.hasThumbnail"
                                  :game-id="m.resolvedMod || group.gameId || 'bf1942'"
                                  :map-name="m.mapName"
                                  :width="48"
                                  :framed="true"
                                />
                                <div
                                  v-else
                                  class="mm-admin-maps__no-thumb"
                                  title="No preview thumbnail found"
                                >
                                  <span class="mm-admin-maps__no-thumb-label">NO ICON</span>
                                </div>
                              </div>
                            </td>

                            <!-- Map Name & Slug -->
                            <td>
                              <div class="mm-admin-maps__name-col">
                                <span class="mm-admin-maps__map-title">{{ m.mapName }}</span>
                                <span class="mm-admin-maps__map-slug">{{ m.normalizedMapName }}</span>
                              </div>
                            </td>

                            <!-- Coverage Badges -->
                            <td>
                              <div class="mm-admin-maps__coverage-row">
                                <span
                                  class="mm-admin-maps__status-pill"
                                  :class="m.hasThumbnail ? 'mm-admin-maps__status-pill--ok' : 'mm-admin-maps__status-pill--err'"
                                >
                                  {{ m.hasThumbnail ? '[+] THUMB' : '[-] NO THUMB' }}
                                </span>
                                <span
                                  v-if="m.hasMinimap"
                                  class="mm-admin-maps__status-pill mm-admin-maps__status-pill--ok"
                                  title="Minimap exists"
                                >
                                  MAP
                                </span>
                                <span
                                  v-if="m.hasDossier"
                                  class="mm-admin-maps__status-pill mm-admin-maps__status-pill--ok"
                                  title="Level dossier exists"
                                >
                                  DOSSIER
                                </span>
                              </div>
                            </td>

                            <!-- Rounds -->
                            <td class="is-num mm-admin-mono">
                              {{ m.totalRounds.toLocaleString() }}
                            </td>

                            <!-- Playtime -->
                            <td class="is-num mm-admin-mono">
                              {{ formatPlayTime(m.totalPlayTimeMinutes) }}
                            </td>

                            <!-- Last Seen -->
                            <td class="mm-admin-mono mm-admin-maps__date-col">
                              {{ formatDate(m.lastSeen) }}
                            </td>

                            <!-- Servers toggle -->
                            <td>
                              <button
                                type="button"
                                class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm mm-admin-maps__toggle-btn"
                                :class="{ 'mm-admin-btn--primary': isExpanded(m.normalizedMapName) }"
                                @click.stop="toggleExpand(m.normalizedMapName)"
                              >
                                {{ m.serverCount }} server{{ m.serverCount === 1 ? '' : 's' }}
                                <span class="mm-admin-maps__chevron">{{ isExpanded(m.normalizedMapName) ? '▲' : '▼' }}</span>
                              </button>
                            </td>
                          </tr>

                          <!-- Expanded Servers Row -->
                          <tr
                            v-if="isExpanded(m.normalizedMapName)"
                            :key="`${group.gameId}-${m.normalizedMapName}-details`"
                            class="mm-admin-maps__details-row"
                          >
                            <td colspan="7">
                              <div class="mm-admin-maps__servers-panel">
                                <div class="mm-admin-maps__servers-head">
                                  <span class="mm-admin-maps__servers-title">
                                    Servers that rotated {{ m.mapName }}:
                                  </span>
                                  <span class="mm-admin-maps__servers-sub">
                                    Identify what mod each server runs to locate the mod archives.
                                  </span>
                                </div>

                                <div class="mm-admin-table-wrap">
                                  <table class="mm-admin-table mm-admin-maps__servers-table">
                                    <thead>
                                      <tr>
                                        <th>Server name</th>
                                        <th>Reported mod</th>
                                        <th>Address</th>
                                        <th>Status</th>
                                        <th class="is-num">Rounds</th>
                                        <th class="is-num">Playtime</th>
                                        <th>Last seen</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr v-for="s in m.servers" :key="s.serverGuid">
                                        <td>
                                          <span class="mm-admin-maps__server-name">
                                            {{ $pn(s.serverName) }}
                                          </span>
                                        </td>
                                        <td>
                                          <span
                                            class="mm-admin-maps__tag"
                                            :class="isModInstalled(s.gameId) ? 'mm-admin-maps__tag--neutral' : 'mm-admin-maps__tag--alert'"
                                          >
                                            {{ s.gameId }}
                                            <span v-if="!isModInstalled(s.gameId)" class="mm-admin-maps__tag-extra">UNINSTALLED</span>
                                          </span>
                                        </td>
                                        <td class="mm-admin-mono mm-admin-maps__server-addr">
                                          {{ s.ip }}:{{ s.port }}
                                        </td>
                                        <td>
                                          <span
                                            class="mm-admin-maps__online-tag"
                                            :class="s.isOnline ? 'mm-admin-maps__online-tag--on' : 'mm-admin-maps__online-tag--off'"
                                          >
                                            {{ s.isOnline ? 'ONLINE' : 'OFFLINE' }}
                                          </span>
                                        </td>
                                        <td class="is-num mm-admin-mono">
                                          {{ s.rounds.toLocaleString() }}
                                        </td>
                                        <td class="is-num mm-admin-mono">
                                          {{ formatPlayTime(s.totalPlayTimeMinutes) }}
                                        </td>
                                        <td class="mm-admin-mono">
                                          {{ formatDate(s.lastSeen) }}
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        </template>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Flat Table View (v-else) -->
        <template v-else>
          <div v-if="items.length === 0" class="mm-admin-empty">
            <span class="mm-admin-empty__title">No maps found</span>
            <span class="mm-admin-empty__desc">
              No maps match the current filters. Try changing your search query or status filter.
            </span>
          </div>

          <div v-else class="mm-admin-table-wrap">
            <table class="mm-admin-table mm-admin-maps__table">
              <thead>
                <tr>
                  <th style="width: 54px;">Icon</th>
                  <th>Map name</th>
                  <th>Detected mod(s)</th>
                  <th>Status</th>
                  <th class="is-num">Rounds</th>
                  <th class="is-num">Playtime</th>
                  <th>Last seen</th>
                  <th>Rotating servers</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="m in items" :key="m.normalizedMapName">
                  <!-- Map Row -->
                  <tr
                    class="mm-admin-maps__row"
                    :class="{ 'mm-admin-maps__row--expanded': isExpanded(m.normalizedMapName) }"
                    @click="toggleExpand(m.normalizedMapName)"
                  >
                    <!-- Thumbnail / Placeholder -->
                    <td>
                      <div class="mm-admin-maps__thumb-wrap">
                        <MmMapThumb
                          v-if="m.hasThumbnail"
                          :game-id="m.resolvedMod || m.servers[0]?.gameId || 'bf1942'"
                          :map-name="m.mapName"
                          :width="48"
                          :framed="true"
                        />
                        <div
                          v-else
                          class="mm-admin-maps__no-thumb"
                          title="No preview thumbnail found"
                        >
                          <span class="mm-admin-maps__no-thumb-label">NO ICON</span>
                        </div>
                      </div>
                    </td>

                    <!-- Map Names -->
                    <td>
                      <div class="mm-admin-maps__name-col">
                        <span class="mm-admin-maps__map-title">{{ m.mapName }}</span>
                        <span class="mm-admin-maps__map-slug">{{ m.normalizedMapName }}</span>
                      </div>
                    </td>

                    <!-- Mod Badges -->
                    <td>
                      <div class="mm-admin-maps__badge-row">
                        <span
                          v-for="mod in getUniqueMods(m)"
                          :key="mod"
                          class="mm-admin-maps__tag"
                          :class="isModInstalled(mod) ? 'mm-admin-maps__tag--neutral' : 'mm-admin-maps__tag--alert'"
                        >
                          {{ mod }}
                          <span v-if="!isModInstalled(mod)" class="mm-admin-maps__tag-extra">NEW</span>
                        </span>
                      </div>
                    </td>

                    <!-- Icon Coverage Badges -->
                    <td>
                      <div class="mm-admin-maps__coverage-row">
                        <span
                          class="mm-admin-maps__status-pill"
                          :class="m.hasThumbnail ? 'mm-admin-maps__status-pill--ok' : 'mm-admin-maps__status-pill--err'"
                        >
                          {{ m.hasThumbnail ? '[+] THUMB' : '[-] NO THUMB' }}
                        </span>
                        <span
                          v-if="m.hasMinimap"
                          class="mm-admin-maps__status-pill mm-admin-maps__status-pill--ok"
                          title="Minimap exists"
                        >
                          MAP
                        </span>
                        <span
                          v-if="m.hasDossier"
                          class="mm-admin-maps__status-pill mm-admin-maps__status-pill--ok"
                          title="Level dossier exists"
                        >
                          DOSSIER
                        </span>
                      </div>
                    </td>

                    <!-- Rounds -->
                    <td class="is-num mm-admin-mono">
                      {{ m.totalRounds.toLocaleString() }}
                    </td>

                    <!-- Playtime -->
                    <td class="is-num mm-admin-mono">
                      {{ formatPlayTime(m.totalPlayTimeMinutes) }}
                    </td>

                    <!-- Last Seen -->
                    <td class="mm-admin-mono mm-admin-maps__date-col">
                      {{ formatDate(m.lastSeen) }}
                    </td>

                    <!-- Servers Toggle -->
                    <td>
                      <button
                        type="button"
                        class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm mm-admin-maps__toggle-btn"
                        :class="{ 'mm-admin-btn--primary': isExpanded(m.normalizedMapName) }"
                        @click.stop="toggleExpand(m.normalizedMapName)"
                      >
                        {{ m.serverCount }} server{{ m.serverCount === 1 ? '' : 's' }}
                        <span class="mm-admin-maps__chevron">{{ isExpanded(m.normalizedMapName) ? '▲' : '▼' }}</span>
                      </button>
                    </td>
                  </tr>

                  <!-- Expanded Servers Row -->
                  <tr
                    v-if="isExpanded(m.normalizedMapName)"
                    :key="`${m.normalizedMapName}-details`"
                    class="mm-admin-maps__details-row"
                  >
                    <td colspan="8">
                      <div class="mm-admin-maps__servers-panel">
                        <div class="mm-admin-maps__servers-head">
                          <span class="mm-admin-maps__servers-title">
                            Servers that rotated {{ m.mapName }}:
                          </span>
                          <span class="mm-admin-maps__servers-sub">
                            Identify what mod each server runs to locate the mod archives.
                          </span>
                        </div>

                        <div class="mm-admin-table-wrap">
                          <table class="mm-admin-table mm-admin-maps__servers-table">
                            <thead>
                              <tr>
                                <th>Server name</th>
                                <th>Reported mod</th>
                                <th>Address</th>
                                <th>Status</th>
                                <th class="is-num">Rounds</th>
                                <th class="is-num">Playtime</th>
                                <th>Last seen</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr v-for="s in m.servers" :key="s.serverGuid">
                                <td>
                                  <span class="mm-admin-maps__server-name">
                                    {{ $pn(s.serverName) }}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    class="mm-admin-maps__tag"
                                    :class="isModInstalled(s.gameId) ? 'mm-admin-maps__tag--neutral' : 'mm-admin-maps__tag--alert'"
                                  >
                                    {{ s.gameId }}
                                    <span v-if="!isModInstalled(s.gameId)" class="mm-admin-maps__tag-extra">UNINSTALLED</span>
                                  </span>
                                </td>
                                <td class="mm-admin-mono mm-admin-maps__server-addr">
                                  {{ s.ip }}:{{ s.port }}
                                </td>
                                <td>
                                  <span
                                    class="mm-admin-maps__online-tag"
                                    :class="s.isOnline ? 'mm-admin-maps__online-tag--on' : 'mm-admin-maps__online-tag--off'"
                                  >
                                    {{ s.isOnline ? 'ONLINE' : 'OFFLINE' }}
                                  </span>
                                </td>
                                <td class="is-num mm-admin-mono">
                                  {{ s.rounds.toLocaleString() }}
                                </td>
                                <td class="is-num mm-admin-mono">
                                  {{ formatPlayTime(s.totalPlayTimeMinutes) }}
                                </td>
                                <td class="mm-admin-mono">
                                  {{ formatDate(s.lastSeen) }}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <!-- Pagination Footer -->
          <div v-if="totalMatching > 0" class="mm-admin-maps__pagination">
            <span class="mm-admin-maps__pagination-info">
              Showing {{ ((page - 1) * pageSize) + 1 }}–{{ Math.min(page * pageSize, totalMatching) }} of {{ totalMatching.toLocaleString() }} maps
            </span>

            <div class="mm-admin-maps__pagination-actions">
              <button
                type="button"
                class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                :disabled="page <= 1"
                @click="changePage(page - 1)"
              >
                Previous
              </button>
              <span class="mm-admin-mono mm-admin-maps__page-num">Page {{ page }} / {{ totalPages }}</span>
              <button
                type="button"
                class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                :disabled="page >= totalPages"
                @click="changePage(page + 1)"
              >
                Next
              </button>
            </div>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  adminDataService,
  type MapReportSummary,
  type MapReportModSummary,
  type MapReportModGroup,
  type MapReportItem,
  type MapReportRequest
} from '@/services/adminDataService'
import MmMapThumb from '@/components/v4/MmMapThumb.vue'
import { formatDateTimeShort } from '@/utils/date'

const loading = ref(false)
const error = ref<string | null>(null)

const summary = ref<MapReportSummary | null>(null)
const mods = ref<MapReportModSummary[]>([])
const items = ref<MapReportItem[]>([])
const modGroups = ref<MapReportModGroup[]>([])
const totalMatching = ref(0)
const page = ref(1)
const pageSize = ref(50)

// View & Filters
const viewMode = ref<'mod' | 'flat'>('mod')
const statusFilter = ref<'missing' | 'has_icon' | 'all'>('missing')
const selectedMod = ref<string | null>(null)
const searchQuery = ref('')
const sortBy = ref<'rounds' | 'name' | 'lastSeen' | 'servers'>('rounds')

// Expand collapse sets
const expandedMaps = ref<Set<string>>(new Set())
const expandedMods = ref<Set<string>>(new Set())
const copiedMod = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

const sortedMods = computed(() => {
  return [...mods.value].sort((a, b) => {
    // Show uninstalled mods with missing maps first
    if (!a.isInstalled && b.isInstalled) return -1
    if (a.isInstalled && !b.isInstalled) return 1
    return b.missingMaps - a.missingMaps
  })
})

const totalMissingInGroups = computed(() => {
  return modGroups.value.reduce((acc, g) => acc + g.missingMaps, 0)
})

const totalPages = computed(() => {
  return Math.max(1, Math.ceil(totalMatching.value / pageSize.value))
})

function isExpanded(normalizedName: string): boolean {
  return expandedMaps.value.has(normalizedName)
}

function toggleExpand(normalizedName: string) {
  if (expandedMaps.value.has(normalizedName)) {
    expandedMaps.value.delete(normalizedName)
  } else {
    expandedMaps.value.add(normalizedName)
  }
}

function isModExpanded(gameId: string): boolean {
  return expandedMods.value.has(gameId.toLowerCase())
}

function toggleModExpand(gameId: string) {
  const key = gameId.toLowerCase()
  if (expandedMods.value.has(key)) {
    expandedMods.value.delete(key)
  } else {
    expandedMods.value.add(key)
  }
}

function expandAllMods() {
  for (const g of modGroups.value) {
    expandedMods.value.add(g.gameId.toLowerCase())
  }
}

function collapseAllMods() {
  expandedMods.value.clear()
}

function setViewMode(mode: 'mod' | 'flat') {
  if (viewMode.value === mode) return
  viewMode.value = mode
  page.value = 1
  void loadReport()
}

async function copyMissingMapNames(group: MapReportModGroup) {
  const missingNames = group.maps
    .filter(m => !m.hasThumbnail)
    .map(m => m.normalizedMapName || m.mapName)
  const text = missingNames.join('\n')
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copiedMod.value = group.gameId
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copiedMod.value = null
    }, 2500)
  } catch (err) {
    console.error('Failed to copy map names', err)
  }
}

function isModInstalled(gameId: string): boolean {
  const modObj = mods.value.find(m => m.gameId.toLowerCase() === gameId.toLowerCase())
  return modObj?.isInstalled ?? false
}

function getUniqueMods(mapItem: MapReportItem): string[] {
  const set = new Set<string>()
  for (const s of mapItem.servers) {
    if (s.gameId) set.add(s.gameId)
  }
  if (set.size === 0) set.add('bf1942')
  return Array.from(set)
}

function setStatusFilter(status: 'missing' | 'has_icon' | 'all') {
  statusFilter.value = status
  page.value = 1
  void loadReport()
}

function selectMod(mod: string | null) {
  selectedMod.value = mod
  page.value = 1
  void loadReport()
}

function onFilterChange() {
  page.value = 1
  void loadReport()
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    void loadReport()
  }, 300)
}

function changePage(newPage: number) {
  if (newPage < 1 || newPage > totalPages.value) return
  page.value = newPage
  void loadReport()
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return formatDateTimeShort(iso)
}

function formatPlayTime(minutes: number): string {
  if (!minutes || minutes <= 0) return '0m'
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  if (hours === 0) return `${rem}m`
  return `${hours.toLocaleString()}h ${rem}m`
}

async function loadReport() {
  loading.value = true
  error.value = null

  try {
    const req: MapReportRequest = {
      status: statusFilter.value,
      mod: selectedMod.value || undefined,
      search: searchQuery.value.trim() || undefined,
      page: page.value,
      pageSize: pageSize.value,
      sortBy: sortBy.value,
      sortDesc: true,
      groupBy: viewMode.value === 'mod' ? 'mod' : 'none'
    }

    const res = await adminDataService.getMapReport(req)
    summary.value = res.summary
    mods.value = res.mods
    items.value = res.items
    totalMatching.value = res.totalMatching
    page.value = res.page
    modGroups.value = res.modGroups ?? []

    if (viewMode.value === 'mod') {
      if (searchQuery.value.trim() || selectedMod.value) {
        for (const g of modGroups.value) {
          expandedMods.value.add(g.gameId.toLowerCase())
        }
      } else if (expandedMods.value.size === 0) {
        for (const g of modGroups.value) {
          if (!g.isInstalled && g.missingMaps > 0) {
            expandedMods.value.add(g.gameId.toLowerCase())
          }
        }
      }
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Failed to load map report'
  } finally {
    loading.value = false
  }
}

// Expose load method for parent tabs
defineExpose({
  load: loadReport
})

onMounted(() => {
  void loadReport()
})
</script>

<style scoped>
.mm-admin-maps {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* KPI bar */
.mm-admin-maps__kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.mm-admin-maps__kpi {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-admin-maps__kpi--alert {
  border-left: 3px solid #f59e0b;
}

.mm-admin-maps__kpi--mod {
  border-left: 3px solid #8b5cf6;
}

.mm-admin-maps__kpi-val {
  font-family: var(--mm-font-mono);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--mm-ink);
}

.mm-admin-maps__kpi-label {
  font-family: var(--mm-font-display);
  font-size: 12px;
  font-weight: 500;
  color: var(--mm-ink-soft);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mm-admin-maps__kpi-sub {
  font-size: 11px;
  color: var(--mm-ink-muted);
}

/* Mod discovery shelf */
.mm-admin-maps__mod-shelf {
  background: var(--mm-bg-soft);
}

.mm-admin-maps__mod-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 18px;
}

.mm-admin-maps__mod-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid var(--mm-rule);
  background: var(--mm-bg);
  color: var(--mm-ink);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mm-admin-maps__mod-pill:hover {
  border-color: var(--mm-rule-strong);
  background: var(--mm-bg-mute);
}

.mm-admin-maps__mod-pill--uninstalled {
  border-color: rgba(245, 158, 11, 0.4);
}

.mm-admin-maps__mod-pill--active {
  background: var(--mm-ink);
  color: var(--mm-bg);
  border-color: var(--mm-ink);
}

.mm-admin-maps__mod-pill--active .mm-admin-maps__mod-pill-stat {
  color: rgba(255, 255, 255, 0.8);
}

.mm-admin-maps__mod-pill-name {
  font-weight: 600;
}

.mm-admin-maps__mod-pill-stat {
  font-size: 10px;
  color: var(--mm-ink-muted);
}

/* Filter controls */
.mm-admin-maps__controls {
  padding: 12px 18px;
}

.mm-admin-maps__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.mm-admin-maps__view-group {
  display: inline-flex;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 3px;
  overflow: hidden;
}

.mm-admin-maps__view-btn {
  padding: 6px 14px;
  font-family: var(--mm-font-display);
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--mm-ink-soft);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mm-admin-maps__view-btn:hover {
  color: var(--mm-ink);
  background: var(--mm-bg-mute);
}

.mm-admin-maps__view-btn--active {
  background: var(--mm-ink);
  color: var(--mm-bg);
}

.mm-admin-maps__status-group {
  display: inline-flex;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 3px;
  overflow: hidden;
}

.mm-admin-maps__status-btn {
  padding: 6px 14px;
  font-family: var(--mm-font-display);
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--mm-ink-soft);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mm-admin-maps__status-btn:hover {
  color: var(--mm-ink);
  background: var(--mm-bg-mute);
}

.mm-admin-maps__status-btn--active {
  background: var(--mm-ink);
  color: var(--mm-bg);
}

.mm-admin-maps__search-wrap {
  flex: 1 1 200px;
  min-width: 180px;
}

.mm-admin-maps__search {
  height: 34px;
  padding: 4px 10px;
}

.mm-admin-maps__select-wrap {
  min-width: 140px;
}

.mm-admin-maps__select {
  height: 34px;
  padding-top: 4px;
  padding-bottom: 4px;
}

.mm-admin-maps__refresh-btn {
  height: 34px;
}

/* Mod groups accordion & cards */
.mm-admin-maps__mod-groups-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
}

.mm-admin-maps__mod-groups-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--mm-ink-soft);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-admin-maps__mod-groups-actions {
  display: flex;
  gap: 6px;
}

.mm-admin-btn--xs {
  height: 24px;
  padding: 2px 8px;
  font-size: 11px;
}

.mm-admin-maps__mod-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mm-admin-maps__mod-card {
  border: 1px solid var(--mm-rule);
  border-radius: 4px;
  background: var(--mm-bg);
  overflow: hidden;
  transition: border-color 0.15s ease;
}

.mm-admin-maps__mod-card--uninstalled {
  border-left: 3px solid #f59e0b;
}

.mm-admin-maps__mod-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--mm-bg-soft);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
}

.mm-admin-maps__mod-header:hover {
  background: var(--mm-bg-mute);
}

.mm-admin-maps__mod-title-area {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.mm-admin-maps__mod-chevron {
  font-size: 9px;
  color: var(--mm-ink-muted);
  width: 12px;
}

.mm-admin-maps__mod-name {
  font-family: var(--mm-font-mono);
  font-size: 14px;
  font-weight: 700;
  color: var(--mm-ink);
}

.mm-admin-maps__mod-stat-pill {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 3px;
  color: var(--mm-ink-soft);
}

.mm-admin-maps__mod-meta-area {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.mm-admin-maps__mod-rounds,
.mm-admin-maps__mod-servers {
  font-size: 11px;
  color: var(--mm-ink-muted);
}

.mm-admin-maps__copy-btn {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  padding: 4px 10px;
  height: 28px;
}

.mm-admin-maps__mod-servers-preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 16px 10px 36px;
  font-size: 11px;
  background: var(--mm-bg-soft);
  border-top: 1px dashed var(--mm-rule);
}

.mm-admin-maps__preview-label {
  font-family: var(--mm-font-display);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-admin-maps__preview-server {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-soft);
}

.mm-admin-maps__mod-body {
  border-top: 1px solid var(--mm-rule);
}

/* Table elements */
.mm-admin-maps__body {
  padding: 0;
}

.mm-admin-maps__table {
  margin: 0;
}

.mm-admin-maps__row {
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.mm-admin-maps__row:hover {
  background: var(--mm-bg-mute);
}

.mm-admin-maps__row--expanded {
  background: var(--mm-bg-mute);
}

.mm-admin-maps__thumb-wrap {
  width: 48px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mm-admin-maps__no-thumb {
  width: 48px;
  height: 36px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px dashed rgba(245, 158, 11, 0.4);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mm-admin-maps__no-thumb-label {
  font-family: var(--mm-font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #d97706;
}

.mm-admin-maps__name-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-admin-maps__map-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--mm-ink);
}

.mm-admin-maps__map-slug {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-muted);
}

.mm-admin-maps__badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mm-admin-maps__tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 3px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

.mm-admin-maps__tag--neutral {
  background: var(--mm-bg-mute);
  color: var(--mm-ink-soft);
  border: 1px solid var(--mm-rule);
}

.mm-admin-maps__tag--alert {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
  border: 1px solid rgba(245, 158, 11, 0.35);
}

.mm-admin-maps__tag--warn {
  background: rgba(239, 68, 68, 0.12);
  color: #b91c1c;
  border: 1px solid rgba(239, 68, 68, 0.3);
  font-size: 9px;
  padding: 1px 5px;
}

.mm-admin-maps__tag-extra {
  font-size: 8.5px;
  font-weight: 700;
  opacity: 0.85;
}

.mm-admin-maps__coverage-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mm-admin-maps__status-pill {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  letter-spacing: 0.04em;
}

.mm-admin-maps__status-pill--ok {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.mm-admin-maps__status-pill--err {
  background: rgba(245, 158, 11, 0.12);
  color: #d97706;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.mm-admin-maps__date-col {
  font-size: 11px;
  color: var(--mm-ink-muted);
}

.mm-admin-maps__chevron {
  font-size: 8px;
  margin-left: 4px;
}

/* Expanded Servers Panel */
.mm-admin-maps__details-row td {
  padding: 0;
  background: var(--mm-bg-soft);
  border-bottom: 1px solid var(--mm-rule-strong);
}

.mm-admin-maps__servers-panel {
  padding: 14px 20px 18px;
}

.mm-admin-maps__servers-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.mm-admin-maps__servers-title {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--mm-ink);
}

.mm-admin-maps__servers-sub {
  font-size: 11.5px;
  color: var(--mm-ink-muted);
}

.mm-admin-maps__servers-table {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 3px;
}

.mm-admin-maps__servers-table th {
  background: var(--mm-bg-soft);
  font-size: 10px;
}

.mm-admin-maps__server-name {
  font-weight: 500;
  color: var(--mm-ink);
}

.mm-admin-maps__server-addr {
  font-size: 11px;
  color: var(--mm-ink-muted);
}

.mm-admin-maps__online-tag {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 2px;
}

.mm-admin-maps__online-tag--on {
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
}

.mm-admin-maps__online-tag--off {
  background: var(--mm-bg-mute);
  color: var(--mm-ink-faint);
}

/* Pagination */
.mm-admin-maps__pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px;
  border-top: 1px solid var(--mm-rule);
  font-size: 12px;
  color: var(--mm-ink-muted);
}

.mm-admin-maps__pagination-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mm-admin-maps__page-num {
  font-size: 11px;
}
</style>
