<template>
  <div
    class="portal-page"
    @click="closeAllModals"
  >
    <div
      class="portal-grid"
      aria-hidden="true"
    />
    <div class="portal-inner px-0 sm:px-6">
      <div
        class="pt-4 flex flex-col min-h-0 min-h-screen"
        :class="{ 'lg:flex-row': showPlayersPanel && isWideScreen }"
      >
        <!-- Main Server Table -->
        <div class="flex-1 min-w-0 w-full">
          <!-- LIVE PULSE BANNER -->
          <section
            v-if="!loading && !error"
            class="live-pulse"
            :class="[`live-pulse--${activeFilter}`, `live-pulse--${networkPulseLevel}`]"
            aria-label="Live network status"
          >
            <div
              class="live-pulse__fx"
              aria-hidden="true"
            >
              <div class="live-pulse__bg" />
              <div class="live-pulse__scan" />
            </div>
            <div class="live-pulse__inner">
              <!-- LIVE PULSE CONTROLS (Merged from Header) -->
              <div class="col-span-full live-pulse__controls mb-2">
                <div class="flex-1 md:max-w-2xl w-full">
                  <PlayerSearch
                    v-model="playerSearchQuery"
                    :full-width="true"
                    @select="selectPlayer"
                    @enter="navigateToPlayer"
                  />
                </div>
              </div>

              <!-- Status badge + tagline -->
              <div class="live-pulse__lead">
                <div class="flex flex-wrap items-center gap-2 sm:gap-3 mb-3">
                  <div class="live-pulse__badge">
                    <span
                      class="live-pulse__dot"
                      aria-hidden="true"
                    />
                    <span class="live-pulse__badge-text">{{ networkPulseLabel }}</span>
                  </div>
                  
                  <GameFilterButtons
                    :game-types="gameTypes"
                    :active-filter="activeFilter"
                    :get-game-icon="getGameIcon"
                    @update:active-filter="setActiveFilter"
                  />
                  
                  <InstallationLinksDropdown ref="installDropdownRef" />
                </div>
                
                <div class="live-pulse__headline">
                  <span class="live-pulse__num">{{ totalPlayersOnline.toLocaleString() }}</span>
                  <span class="live-pulse__text">online across</span>
                  <span class="live-pulse__num live-pulse__num--sub">{{ activeServersCount }}</span>
                  <span class="live-pulse__text">of {{ servers.length }} {{ getActiveGameName() }} servers</span>
                </div>
              </div>

              <!-- Stat tiles -->
              <div class="live-pulse__stats">
                <div class="pulse-stat">
                  <div class="pulse-stat__value">
                    {{ totalPlayersOnline.toLocaleString() }}
                  </div>
                  <div class="pulse-stat__label">
                    In Combat
                  </div>
                  <div class="pulse-stat__bar">
                    <div
                      class="pulse-stat__bar-fill"
                      :style="{ width: Math.min(100, capacityUsedPercent) + '%' }"
                    />
                  </div>
                </div>
                <div class="pulse-stat">
                  <div class="pulse-stat__value">
                    {{ activeServersCount }}
                  </div>
                  <div class="pulse-stat__label">
                    Live Hosts
                  </div>
                  <div class="pulse-stat__sub">
                    of {{ servers.length }} online
                  </div>
                </div>
                <div class="pulse-stat">
                  <div class="pulse-stat__value">
                    {{ capacityUsedPercent }}<span class="pulse-stat__suffix">%</span>
                  </div>
                  <div class="pulse-stat__label">
                    Load
                  </div>
                  <div class="pulse-stat__sub">
                    network capacity
                  </div>
                </div>
              </div>

              <!-- Top server spotlight -->
              <router-link
                v-if="topServer && topServer.numPlayers > 0"
                :to="`/servers/${encodeURIComponent(topServer.name)}`"
                class="live-pulse__spotlight"
                aria-label="View top server"
              >
                <div
                  class="spotlight__rail"
                  aria-hidden="true"
                />
                <div class="spotlight__col">
                  <div class="spotlight__label">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    ><path d="M12 2L13.09 8.26L19 9L14.5 13.5L15.91 19.76L12 16.27L8.09 19.76L9.5 13.5L5 9L10.91 8.26L12 2Z" /></svg>
                    <span>HOTTEST SERVER</span>
                  </div>
                  <div class="spotlight__name">
                    {{ topServer.name }}
                  </div>
                  <div class="spotlight__meta">
                    <span class="spotlight__players">{{ topServer.numPlayers }}/{{ topServer.maxPlayers }}</span>
                    <span class="spotlight__dot">·</span>
                    <span class="spotlight__map">{{ topServer.mapName }}</span>
                  </div>
                </div>
                <div
                  class="spotlight__arrow"
                  aria-hidden="true"
                >
                  →
                </div>
              </router-link>
            </div>
          </section>

          <!-- Player History Section -->
          <PlayerHistorySection
            ref="playerHistorySectionRef"
            :active-game-name="getActiveGameName()"
            :player-history-data="playerHistoryData"
            :player-history-insights="playerHistoryInsights"
            :history-period="historyPeriod"
            :longer-period="longerPeriod"
            :history-rolling-window="historyRollingWindow"
            :history-loading="historyLoading"
            :history-error="historyError"
            @toggle="togglePlayerHistory"
            @period-change="changePeriod"
            @longer-period-change="selectLongerPeriod"
            @rolling-window-change="changeRollingWindow"
          />

          <!-- Loading State -->
          <div
            v-if="loading"
            class="landing-loading"
            role="status"
            aria-label="Loading servers"
          >
            <div class="landing-loading__card">
              <div class="landing-loading__header">
                <span class="landing-loading__dot" />
                <span class="landing-loading__dot" />
                <span class="landing-loading__dot" />
                <span class="landing-loading__title">bfstats://servers/connect</span>
              </div>
              <div class="landing-loading__body">
                <div class="landing-loading__line">
                  <span class="landing-loading__prompt">$</span> init network_scan --game={{ activeFilter }}
                </div>
                <div class="landing-loading__line landing-loading__line--muted">
                  Resolving master list...
                </div>
                <div class="landing-loading__line landing-loading__line--muted">
                  Pinging active hosts...
                </div>
                <div class="landing-loading__line landing-loading__line--cursor">
                  Fetching live telemetry<span class="landing-loading__caret">▊</span>
                </div>
              </div>
              <div class="landing-loading__progress">
                <div class="landing-loading__progress-fill" />
              </div>
            </div>
          </div>

          <!-- Error State -->
          <div
            v-else-if="error"
            class="landing-error"
            role="alert"
          >
            <div class="landing-error__card">
              <div
                class="landing-error__glitch"
                aria-hidden="true"
              >
                <span>SIGNAL LOST</span>
                <span>SIGNAL LOST</span>
                <span>SIGNAL LOST</span>
              </div>
              <div
                class="landing-error__icon"
                aria-hidden="true"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line
                    x1="12"
                    y1="9"
                    x2="12"
                    y2="13"
                  />
                  <line
                    x1="12"
                    y1="17"
                    x2="12.01"
                    y2="17"
                  />
                </svg>
              </div>
              <div class="landing-error__title">
                CONNECTION SEVERED
              </div>
              <div class="landing-error__msg">
                {{ error }}
              </div>
              <button
                class="landing-error__retry"
                @click="fetchServersForGame(activeFilter as 'bf1942' | 'fh2' | 'bfvietnam', true)"
              >
                <span>↻</span> RETRY HANDSHAKE
              </button>
            </div>
          </div>

          <!-- Server Grid (replaces old server table) -->
          <div
            v-else
            class="server-view"
            :class="`server-view--${activeFilter}`"
          >
            <!-- Command Bar: filter + sort + count -->
            <div
              class="command-bar"
              role="toolbar"
              aria-label="Server filter and sort controls"
            >
              <div class="command-bar__filter">
                <span class="command-bar__prompt">&gt;</span>
                <input
                  v-model="serverFilterQuery"
                  type="search"
                  class="command-bar__input"
                  placeholder="grep --hosts name,map,ip..."
                  aria-label="Filter servers by name, map, or IP"
                >
                <button
                  v-if="serverFilterQuery"
                  type="button"
                  class="command-bar__clear"
                  aria-label="Clear filter"
                  @click="serverFilterQuery = ''"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  ><path d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <div class="command-bar__divider" aria-hidden="true" />

                <div class="command-bar__country">
                  <select
                    v-model="selectedCountry"
                    class="command-bar__select"
                    aria-label="Filter by country"
                  >
                    <option value="all">ALL REGIONS</option>
                    <option
                      v-for="code in availableCountries"
                      :key="code"
                      :value="code"
                    >
                      {{ getCountryFlag(code) }} {{ code }}
                    </option>
                  </select>
                </div>
              </div>

              <div
                class="command-bar__sort"
                role="group"
                aria-label="Sort by"
              >
                <span class="command-bar__sort-label">SORT</span>
                <button
                  v-for="field in [
                    { id: 'rank', label: 'RANK' },
                    { id: 'name', label: 'NAME' },
                    { id: 'numPlayers', label: 'PLAYERS' },
                    { id: 'mapName', label: 'MAP' },
                    { id: 'roundTimeRemain', label: 'TIME' },
                    { id: 'gameType', label: 'MODE' }
                  ]"
                  :key="field.id"
                  type="button"
                  class="command-bar__chip"
                  :class="{ 'command-bar__chip--active': sortField === field.id }"
                  :aria-pressed="sortField === field.id"
                  @click="sortBy(field.id as any)"
                >
                  {{ field.label }}
                  <span
                    v-if="sortField === field.id"
                    class="command-bar__chip-arrow"
                    :class="{ 'command-bar__chip-arrow--desc': sortDirection === 'desc' }"
                    aria-hidden="true"
                  >▲</span>
                </button>
              </div>

              <div
                class="command-bar__view"
                role="group"
                aria-label="View mode"
              >
                <button
                  type="button"
                  class="command-bar__view-btn"
                  :class="{ 'command-bar__view-btn--active': viewMode === 'grid' }"
                  aria-label="Grid view"
                  @click="viewMode = 'grid'"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                </button>
                <button
                  type="button"
                  class="command-bar__view-btn"
                  :class="{ 'command-bar__view-btn--active': viewMode === 'list' }"
                  aria-label="List view"
                  @click="viewMode = 'list'"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                </button>
              </div>

              <div
                class="command-bar__count"
                aria-live="polite"
              >
                <span class="command-bar__count-num">{{ sortedServers.length }}</span>
                <span class="command-bar__count-label">
                  {{ serverFilterQuery ? 'matched' : 'online' }}
                  <template v-if="serverFilterQuery">· {{ servers.length }} total</template>
                </span>
              </div>
            </div>

            <!-- Server Grid -->
            <div
              v-if="viewMode === 'grid' && sortedServers.length > 0"
              class="server-grid"
              role="list"
              aria-label="Live servers"
            >
              <article
                v-for="(server, serverIndex) in sortedServers"
                :key="server.guid"
                class="server-card"
                :class="[
                  `server-card--${getCardGameAccent(server)}`,
                  `server-card--${getCardHeat(server.guid)}`,
                  { 'server-card--full': server.numPlayers >= server.maxPlayers && server.maxPlayers > 0 }
                ]"
                role="listitem"
              >
                <!-- Scan line accent -->
                <div
                  class="server-card__scan"
                  aria-hidden="true"
                />

                <!-- Row 1: heat · rank · flag · capacity (compact) -->
                <header class="server-card__strip">
                  <div class="server-card__strip-left">
                    <div
                      class="server-card__heat"
                      :title="getCardHeatTitle(server.guid)"
                    >
                      <span
                        class="server-card__heat-dot"
                        aria-hidden="true"
                      />
                      <span class="server-card__heat-label">{{ getCardHeatLabel(server.guid) }}</span>
                    </div>
                    <button
                      v-if="getServerRank(server.guid)"
                      type="button"
                      class="server-card__rank"
                      :title="`Ranked by total playtime · ${formatTotalPlayTime(getServerTotalPlayTime(server.guid))} last 60 days`"
                      @click.stop="toggleRankTooltip(server.guid)"
                    >
                      #{{ getServerRank(server.guid) }}
                    </button>
                    <span
                      v-if="server.country"
                      class="server-card__flag"
                      :aria-label="server.country"
                    >{{ getCountryFlag(server.country) }}</span>
                  </div>
                  <button
                    type="button"
                    class="server-card__capacity"
                    :aria-label="`View ${server.numPlayers} online players`"
                    @click="showPlayers(server)"
                  >
                    <span class="server-card__capacity-num">
                      <span class="server-card__capacity-now">{{ server.numPlayers }}</span><span class="server-card__capacity-slash">/</span><span class="server-card__capacity-max">{{ server.maxPlayers }}</span>
                    </span>
                    <span
                      class="server-card__capacity-bar"
                      aria-hidden="true"
                    >
                      <span
                        class="server-card__capacity-fill"
                        :style="{ width: getPlayerPercentage(server) + '%' }"
                      />
                      <span
                        class="server-card__capacity-trail"
                        :style="{ width: getPlayerPercentage(server) + '%' }"
                      />
                    </span>
                  </button>
                </header>

                <!-- Row 2: Name (hero link) -->
                <router-link
                  :to="`/servers/${encodeURIComponent(server.name)}`"
                  class="server-card__name"
                  :title="server.name"
                >
                  {{ server.name }}
                </router-link>

                <!-- Row 3: compact meta line — mode · map · remaining · ip -->
                <div class="server-card__meta">
                  <span
                    class="server-card__meta-item server-card__meta-item--mode"
                    :title="getGameDisplayName(server.gameType)"
                  >
                    <span
                      class="server-card__game-icon"
                      :style="{ backgroundImage: getGameIcon(getGameIconClass(server.gameType)) }"
                      aria-hidden="true"
                    />
                    {{ getGameDisplayName(server.gameType) }}
                  </span>
                  <span
                    class="server-card__meta-sep"
                    aria-hidden="true"
                  >·</span>
                  <span
                    class="server-card__meta-item server-card__meta-item--map"
                    :title="server.mapName || '—'"
                  >
                    <span class="server-card__meta-map">{{ server.mapName || '—' }}</span>
                  </span>
                  <span
                    class="server-card__meta-sep"
                    aria-hidden="true"
                  >·</span>
                  <span
                    class="server-card__meta-item server-card__meta-item--time"
                    :title="'Round time remaining'"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    ><circle
                      cx="12"
                      cy="12"
                      r="10"
                    /><polyline points="12 6 12 12 16 14" /></svg>
                    {{ formatTimeRemaining(server.roundTimeRemain) }}
                  </span>
                  <span
                    v-if="getTimezoneDisplay(server.timezone)"
                    class="server-card__meta-item server-card__meta-item--tz"
                    :title="server.timezone || ''"
                  >
                    <span
                      class="server-card__meta-sep"
                      aria-hidden="true"
                    >·</span>
                    {{ getTimezoneDisplay(server.timezone) }}
                  </span>
                  <span
                    class="server-card__meta-item server-card__meta-item--ip"
                    :title="`${server.ip}:${server.port}`"
                  >
                    <span
                      class="server-card__meta-sep"
                      aria-hidden="true"
                    >·</span>
                    {{ server.ip }}:{{ server.port }}
                  </span>
                </div>

                <!-- Row 4: Google-style 24H busy-periods graph -->
                <div
                  v-if="serverTrendsByGuid[server.guid]?.hourlyTimeline"
                  class="server-card__busy"
                  role="group"
                  :aria-label="`Busy periods · ${serverTrendsByGuid[server.guid].busyIndicator.busyText}`"
                  :title="getCardHeatTitle(server.guid)"
                >
                  <div class="server-card__busy-head">
                    <span class="server-card__busy-title">POPULAR TIMES</span>
                    <span
                      class="server-card__busy-status"
                      :class="`server-card__busy-status--${serverTrendsByGuid[server.guid].busyIndicator.busyLevel}`"
                    >
                      {{ serverTrendsByGuid[server.guid].busyIndicator.busyText }}
                      <span class="server-card__busy-status-sub">· typ {{ Math.round(serverTrendsByGuid[server.guid].busyIndicator.typicalPlayers) }}</span>
                    </span>
                  </div>
                  <div class="server-card__busy-graph">
                    <div
                      v-for="(entry, idx) in serverTrendsByGuid[server.guid].hourlyTimeline"
                      :key="idx"
                      class="server-card__busy-col"
                      :title="formatTimelineTooltip(entry)"
                    >
                      <div
                        class="server-card__busy-bar"
                        :class="[
                          `server-card__busy-bar--${entry.busyLevel}`,
                          { 'server-card__busy-bar--now': entry.isCurrentHour }
                        ]"
                        :style="{ height: getTimelineBarHeight(server.guid, entry) + 'px' }"
                      />
                      <span
                        v-if="entry.isCurrentHour"
                        class="server-card__busy-now"
                        aria-hidden="true"
                      >NOW</span>
                    </div>
                  </div>
                  <div
                    class="server-card__busy-axis"
                    aria-hidden="true"
                  >
                    <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
                  </div>
                </div>

                <!-- Row 5: Actions -->
                <footer class="server-card__actions">
                  <button
                    type="button"
                    class="server-card__deploy"
                    :disabled="server.numPlayers >= server.maxPlayers"
                    @click="joinServer(server)"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="server-card__deploy-icon"
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    ><path d="M8 5v14l11-7z" /></svg>
                    <span class="server-card__deploy-label">
                      {{ server.numPlayers >= server.maxPlayers ? 'FULL' : 'JOIN' }}
                    </span>
                  </button>
                  <a
                    v-if="server.discordUrl"
                    :href="server.discordUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="server-card__link server-card__link--discord"
                    title="Join Discord"
                    aria-label="Join Discord"
                  >
                    <img
                      :src="discordIcon"
                      alt=""
                      class="server-card__link-icon"
                    >
                  </a>
                  <a
                    v-if="server.forumUrl"
                    :href="server.forumUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="server-card__link server-card__link--forum"
                    title="Visit Forum"
                    aria-label="Visit Forum"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    ><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></svg>
                  </a>
                </footer>

                <!-- Rank tooltip overlay -->
                <div
                  v-if="rankTooltipServer === server.guid"
                  class="server-card__rank-tip"
                  role="tooltip"
                >
                  <div class="server-card__rank-tip-title">
                    Ranked #{{ getServerRank(server.guid) }}
                  </div>
                  <div class="server-card__rank-tip-sub">
                    {{ formatTotalPlayTime(getServerTotalPlayTime(server.guid)) }} · last 60d
                  </div>
                </div>
              </article>
            </div>

            <!-- Server List -->
            <div
              v-else-if="viewMode === 'list' && sortedServers.length > 0"
              class="server-list"
              role="list"
              aria-label="Live servers list"
            >
              <div class="server-list__header" role="row">
                <div class="server-list__col server-list__col-label server-list__col--heat">HEAT</div>
                <div class="server-list__col server-list__col-label server-list__col--name">SERVER NAME</div>
                <div class="server-list__col server-list__col-label server-list__col--players">PLAYERS</div>
                <div class="server-list__col server-list__col-label server-list__col--map">MAP</div>
                <div class="server-list__col server-list__col-label server-list__col--mode">MODE</div>
                <div class="server-list__col server-list__col-label server-list__col--time">TIME</div>
                <div class="server-list__col server-list__col-label server-list__col--ip">IP ADDRESS</div>
                <div class="server-list__col server-list__col-label server-list__col--actions">JOIN</div>
              </div>

              <div
                v-for="server in sortedServers"
                :key="server.guid"
                class="server-list__row"
                :class="[
                  `server-list__row--${getCardGameAccent(server)}`,
                  `server-card--${getCardHeat(server.guid)}`
                ]"
                role="listitem"
              >
                <div class="server-list__col server-list__col--heat">
                  <div
                    class="server-card__heat"
                    :title="getCardHeatTitle(server.guid)"
                  >
                    <span class="server-card__heat-dot" aria-hidden="true" />
                    <span class="server-card__heat-label">{{ getCardHeatLabel(server.guid) }}</span>
                  </div>
                </div>

                <div class="server-list__col server-list__col--name">
                  <div class="flex items-center gap-2 overflow-hidden relative">
                    <button
                      v-if="getServerRank(server.guid)"
                      type="button"
                      class="server-card__rank flex-shrink-0"
                      :title="`Ranked by total playtime · ${formatTotalPlayTime(getServerTotalPlayTime(server.guid))} last 60 days`"
                      @click.stop="toggleRankTooltip(server.guid)"
                    >
                      #{{ getServerRank(server.guid) }}
                    </button>
                    <router-link
                      :to="`/servers/${encodeURIComponent(server.name)}`"
                      class="server-list__name"
                      :title="server.name"
                    >
                      <span v-if="server.country" class="mr-1">{{ getCountryFlag(server.country) }}</span>
                      {{ server.name }}
                    </router-link>

                    <!-- Rank tooltip overlay -->
                    <div
                      v-if="rankTooltipServer === server.guid"
                      class="server-card__rank-tip"
                      style="top: 1.5rem; left: 0;"
                      role="tooltip"
                    >
                      <div class="server-card__rank-tip-title">
                        Ranked #{{ getServerRank(server.guid) }}
                      </div>
                      <div class="server-card__rank-tip-sub">
                        {{ formatTotalPlayTime(getServerTotalPlayTime(server.guid)) }} · last 60d
                      </div>
                    </div>
                  </div>
                </div>

                <div class="server-list__col server-list__col--players">
                  <button
                    type="button"
                    class="server-list__players"
                    @click="showPlayers(server)"
                  >
                    <span class="server-list__players-num">{{ server.numPlayers }}/{{ server.maxPlayers }}</span>
                    <div class="server-card__capacity-bar" aria-hidden="true">
                      <div class="server-card__capacity-fill" :style="{ width: getPlayerPercentage(server) + '%' }" />
                    </div>
                  </button>
                </div>

                <div class="server-list__col server-list__col--map">
                  {{ server.mapName || '—' }}
                </div>

                <div class="server-list__col server-list__col--mode">
                  {{ getGameDisplayName(server.gameType) }}
                </div>

                <div class="server-list__col server-list__col--time">
                  {{ formatTimeRemaining(server.roundTimeRemain) }}
                </div>

                <div class="server-list__col server-list__col--ip">
                  {{ server.ip }}:{{ server.port }}
                </div>

                <div class="server-list__col server-list__col--actions">
                  <button
                    type="button"
                    class="server-card__deploy"
                    :disabled="server.numPlayers >= server.maxPlayers"
                    @click="joinServer(server)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                    <span>JOIN</span>
                  </button>
                </div>
              </div>
            </div>


            <!-- Empty Filter State -->
            <div
              v-if="serverFilterQuery && filteredServers.length === 0"
              class="landing-empty"
              role="status"
              aria-live="polite"
            >
              <div class="landing-empty__card">
                <div class="landing-empty__header">
                  <span class="landing-empty__dot" />
                  <span class="landing-empty__dot" />
                  <span class="landing-empty__dot" />
                  <span class="landing-empty__title">bfstats://servers/filter</span>
                </div>
                <div class="landing-empty__body">
                  <div class="landing-empty__line">
                    <span class="landing-empty__prompt">$</span> grep --hosts "{{ serverFilterQuery }}"
                  </div>
                  <div class="landing-empty__line landing-empty__line--muted">
                    Scanned {{ servers.length }} active hosts...
                  </div>
                  <div class="landing-empty__result">
                    <span class="landing-empty__result-num">0</span>
                    <span class="landing-empty__result-label">matches</span>
                  </div>
                  <div class="landing-empty__line landing-empty__line--hint">
                    Try a different name, map, or IP fragment.
                  </div>
                </div>
                <button
                  class="landing-empty__clear"
                  type="button"
                  @click="serverFilterQuery = ''"
                >
                  <span aria-hidden="true">↺</span> CLEAR FILTER
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Players Panel: overlay on mobile, right panel on lg when space permits -->
        <div
          v-if="showPlayersPanel"
          class="fixed inset-0 z-[100] lg:relative lg:inset-auto lg:z-auto lg:w-[480px] xl:w-[520px] lg:flex-shrink-0 lg:border-l lg:border-neutral-700/50 lg:min-h-0 lg:min-w-[480px] xl:min-w-[520px]"
        >
          <PlayersPanel
            :show="showPlayersPanel"
            :server="selectedServer"
            :inline="isWideScreen"
            @close="closePlayersPanel"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchAllServers, fetchServerBusyIndicators, fetchServerRankings, type ServerBusyIndicatorResult, type ServerHourlyTimelineEntry, type BusyLevel } from '../services/serverDetailsService'
import { ServerSummary } from '../types/server'
import { PlayerHistoryDataPoint, PlayerHistoryInsights, ServerRank } from '../types/playerStatsTypes'
import PlayersPanel from '../components/PlayersPanel.vue'
import { fetchPlayerOnlineHistory } from '../services/playerStatsService'
import { formatTimeRemaining } from '../utils/timeUtils'
import PlayerSearch from '../components/PlayerSearch.vue'
import GameFilterButtons from '../components/GameFilterButtons.vue'
import InstallationLinksDropdown from '../components/InstallationLinksDropdown.vue'
import PlayerHistorySection from '../components/PlayerHistorySection.vue'

import bf1942Icon from '@/assets/bf1942.webp'
import fh2Icon from '@/assets/fh2.webp'
import bfvIcon from '@/assets/bfv.webp'
import discordIcon from '@/assets/discord.webp'

// PlayerSearchResult interface is defined in PlayerSearch component
// We need it for the selectPlayer function
interface PlayerSearchResult {
  playerName: string
  totalPlayTimeMinutes: number
  lastSeen: string
  isActive: boolean
  currentServer?: {
    serverGuid: string
    serverName: string
    sessionKills: number
    sessionDeaths: number
    mapName: string
    gameId: string
  }
}

const router = useRouter()

// Props from router
interface Props {
  initialMode?: 'FH2' | '42' | 'BFV';
}

const props = defineProps<Props>();

// Game types configuration
const gameTypes = [
  { id: 'bf1942', name: 'BF1942', iconClass: 'icon-bf1942' },
]

// Map router props to filter IDs
const getFilterFromMode = (_mode?: string) => {
  return 'bf1942'
}

// State
const playerSearchQuery = ref('')
const serverFilterQuery = ref('')
const selectedCountry = ref('all')
const activeFilter = ref(getFilterFromMode(props.initialMode))
const viewMode = ref<'grid' | 'list'>((localStorage.getItem('serverViewMode') as 'grid' | 'list') || 'grid')

watch(viewMode, (newMode) => {
  localStorage.setItem('serverViewMode', newMode)
})

const sortField = ref('numPlayers')
const sortDirection = ref('desc')
const servers = ref<ServerSummary[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const refreshTimer = ref<number | null>(null)

// Component refs
const installDropdownRef = ref<InstanceType<typeof InstallationLinksDropdown> | null>(null)
const playerHistorySectionRef = ref<InstanceType<typeof PlayerHistorySection> | null>(null)

// Players panel state
const showPlayersPanel = ref(false)
const selectedServer = ref<ServerSummary | null>(null)

// Player history state
const playerHistoryData = ref<PlayerHistoryDataPoint[]>([])
const playerHistoryInsights = ref<PlayerHistoryInsights | null>(null)
const historyPeriod = ref<'1d' | '3d' | '7d' | 'longer'>('1d')
const longerPeriod = ref<'1month' | '3months' | 'thisyear' | 'alltime'>('1month')
const historyRollingWindow = ref('7d')
const historyLoading = ref(false)
const historyError = ref<string | null>(null)


// Per-server trends state (busy indicator + hourly timeline)
const serverTrendsByGuid = ref<Record<string, ServerBusyIndicatorResult>>({})

// Per-server modal state
const serverModalStates = ref<Record<string, boolean>>({})

// Server rankings state
const serverRankings = ref<ServerRank[]>([])
const rankingsLoading = ref(false)
const rankingsError = ref<string | null>(null)

// Rank tooltip state
const rankTooltipServer = ref<string | null>(null)

// Wide viewport: show players panel on the right (lg: 1024px+)
const isWideScreen = ref(false)
const updateWideScreen = () => {
  isWideScreen.value = typeof window !== 'undefined' && window.innerWidth >= 1024
}

// Helper to determine if modal should open upward (for rows near bottom)
const shouldOpenUpward = (index: number) => {
  const totalRows = sortedServers.value.length
  // Open upward if in the last 3 rows
  return index >= totalRows - 3
}

// Helper to get server rank
const getServerRank = (serverGuid: string): number | null => {
  const ranking = serverRankings.value.find(r => r.serverGuid === serverGuid)
  return ranking ? ranking.rank : null
}

// Helper to get server total playtime
const getServerTotalPlayTime = (serverGuid: string): number => {
  const ranking = serverRankings.value.find(r => r.serverGuid === serverGuid)
  return ranking ? ranking.totalPlayTimeMinutes : 0
}

// Format total playtime nicely
const formatTotalPlayTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''} total playtime`
  }
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  if (remainingHours === 0) {
    return `${days} day${days !== 1 ? 's' : ''} total playtime`
  }
  return `${days} day${days !== 1 ? 's' : ''}, ${remainingHours} hour${remainingHours !== 1 ? 's' : ''} total playtime`
}

// Toggle rank tooltip
const toggleRankTooltip = (serverGuid: string) => {
  rankTooltipServer.value = rankTooltipServer.value === serverGuid ? null : serverGuid
}

// Computed properties
const availableCountries = computed(() => {
  const countries = new Set<string>()
  servers.value.forEach(s => {
    if (s.country) countries.add(s.country)
  })
  
  return Array.from(countries).sort((a, b) => a.localeCompare(b))
})

const filteredServers = computed(() => {
  let result = servers.value

  // Country filter
  if (selectedCountry.value !== 'all') {
    result = result.filter(s => s.country === selectedCountry.value)
  }

  // Text search filter
  if (serverFilterQuery.value.trim()) {
    const query = serverFilterQuery.value.toLowerCase().trim()
    result = result.filter(server => {
      // Search across multiple fields
      return (
        server.name?.toLowerCase().includes(query) ||
        server.mapName?.toLowerCase().includes(query) ||
        server.ip?.toLowerCase().includes(query) ||
        server.gameType?.toLowerCase().includes(query) ||
        server.country?.toLowerCase().includes(query) ||
        server.timezone?.toLowerCase().includes(query) ||
        `${server.ip}:${server.port}`.toLowerCase().includes(query)
      )
    })
  }

  return result
})

const getTimezoneOffset = (timezone: string | undefined): number => {
  if (!timezone) return 999 // Sort servers without timezone to the end
  try {
    const now = new Date()
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
    const offsetMinutes = (tzDate.getTime() - now.getTime()) / 60000
    return Math.round(offsetMinutes / 60)
  } catch {
    return 999
  }
}

const sortedServers = computed(() => {
  const filtered = [...filteredServers.value]

  return filtered.sort((a, b) => {
    let aVal, bVal

    switch (sortField.value) {
      case 'name':
        aVal = a.name.toLowerCase()
        bVal = b.name.toLowerCase()
        break
      case 'numPlayers':
        aVal = a.numPlayers
        bVal = b.numPlayers
        break
      case 'mapName':
        aVal = a.mapName?.toLowerCase() || ''
        bVal = b.mapName?.toLowerCase() || ''
        break
      case 'gameType':
        aVal = a.gameType?.toLowerCase() || ''
        bVal = b.gameType?.toLowerCase() || ''
        break
      case 'roundTimeRemain':
        aVal = a.roundTimeRemain || 0
        bVal = b.roundTimeRemain || 0
        break
      case 'timezone':
        // Sort by absolute timezone offset (closest to user's time first)
        aVal = Math.abs(getTimezoneOffset(a.timezone))
        bVal = Math.abs(getTimezoneOffset(b.timezone))
        break
      case 'rank':
        // Sort by server rank (lower rank number = higher ranking)
        const aRank = getServerRank(a.guid) || 999999
        const bRank = getServerRank(b.guid) || 999999
        aVal = aRank
        bVal = bRank
        break
      default:
        aVal = a.numPlayers
        bVal = b.numPlayers
    }

    if (sortDirection.value === 'asc') {
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0
    } else {
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0
    }
  })
})

// Generate dynamic keywords from top 5 servers by player count for SEO
const topServerKeywords = computed(() => {
  const topServers = [...servers.value]
    .sort((a, b) => b.numPlayers - a.numPlayers)
    .slice(0, 5)
    .map(s => s.name)
    .filter(name => name && name.trim())

  return topServers.join(', ')
})

// Base keywords that always appear
const baseKeywords = computed(() => {
  const gameType = activeFilter.value
  if (gameType === 'bf1942') {
    return 'Battlefield 1942, BF1942, WW2 multiplayer, WWII FPS, BF1942 servers, online players, server browser, player stats'
  } else if (gameType === 'fh2') {
    return 'Forgotten Hope 2, FH2, BF2 mod, realistic WW2, FH2 servers, tactical shooter, milsim, online players'
  } else if (gameType === 'bfvietnam') {
    return 'Battlefield Vietnam, BF Vietnam, BFV, Vietnam War game, BFV servers, 1960s FPS, online players'
  }
  return 'Battlefield 1942, Forgotten Hope 2, Battlefield Vietnam, server browser, player statistics, gaming stats, server monitoring'
})

// Combined SEO keywords
const seoKeywords = computed(() => {
  const keywords = [baseKeywords.value]
  if (topServerKeywords.value) {
    keywords.push(topServerKeywords.value)
  }
  return keywords.join(', ')
})

// Aggregate live network stats for hero banner
const totalPlayersOnline = computed(() =>
  servers.value.reduce((sum, s) => sum + (s.numPlayers || 0), 0)
)

const activeServersCount = computed(() =>
  servers.value.filter(s => (s.numPlayers || 0) > 0).length
)

const totalCapacity = computed(() =>
  servers.value.reduce((sum, s) => sum + (s.maxPlayers || 0), 0)
)

const capacityUsedPercent = computed(() => {
  const cap = totalCapacity.value
  return cap > 0 ? Math.round((totalPlayersOnline.value / cap) * 100) : 0
})

const topServer = computed(() => {
  if (servers.value.length === 0) return null
  return [...servers.value].sort((a, b) => b.numPlayers - a.numPlayers)[0]
})

const networkPulseLevel = computed<'very_busy' | 'busy' | 'moderate' | 'quiet'>(() => {
  const pct = capacityUsedPercent.value
  if (pct >= 50) return 'very_busy'
  if (pct >= 25) return 'busy'
  if (pct >= 5) return 'moderate'
  return 'quiet'
})

const networkPulseLabel = computed(() => {
  switch (networkPulseLevel.value) {
    case 'very_busy': return 'PEAK COMBAT'
    case 'busy': return 'ACTIVE FRONT'
    case 'moderate': return 'OPERATIONAL'
    default: return 'STANDING BY'
  }
})

// Dynamic meta description with live stats
const seoDescription = computed(() => {
  const gameType = activeFilter.value
  const totalPlayers = totalPlayersOnline.value
  const activeServers = activeServersCount.value
  const topSrv = topServer.value

  let gameName = 'Battlefield 1942'
  if (gameType === 'fh2') gameName = 'Forgotten Hope 2'
  else if (gameType === 'bfvietnam') gameName = 'Battlefield Vietnam'

  let description = `Live ${gameName} server browser with ${activeServers} active servers`
  if (totalPlayers > 0) {
    description += ` and ${totalPlayers} online players`
  }
  if (topSrv && topSrv.numPlayers > 0) {
    description += `. Most popular: ${topSrv.name} (${topSrv.numPlayers}/${topSrv.maxPlayers})`
  }
  description += '. Real-time stats, player counts, maps, and instant join links.'

  return description
})

// Structured data for rich search results
const structuredData = computed(() => {
  const gameType = activeFilter.value
  const totalPlayers = servers.value.reduce((sum, s) => sum + (s.numPlayers || 0), 0)

  let gameName = 'Battlefield 1942'
  if (gameType === 'fh2') gameName = 'Forgotten Hope 2'
  else if (gameType === 'bfvietnam') gameName = 'Battlefield Vietnam'

  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: `${gameName} Server Browser - BF Stats`,
    applicationCategory: 'GameApplication',
    description: seoDescription.value,
    url: window.location.href,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD'
    },
    aggregateRating: totalPlayers > 0 ? {
      '@type': 'AggregateRating',
      ratingValue: '4.5',
      ratingCount: totalPlayers.toString()
    } : undefined,
    featureList: [
      'Real-time server monitoring',
      'Live player statistics',
      'Instant server join',
      'Player search and tracking',
      'Server activity forecasts'
    ]
  }
})

// Helper functions
const getGameIconClass = (gameType: string) => {
  const type = gameType?.toLowerCase() || ''
  if (type.includes('bf1942')) return 'icon-bf1942'
  if (type.includes('fh2')) return 'icon-fh2'
  if (type.includes('vietnam')) return 'icon-bfv'
  return 'icon-bf1942'
}

// Player search methods
const selectPlayer = (player: PlayerSearchResult) => {
  playerSearchQuery.value = player.playerName
  navigateToPlayerProfile(player.playerName)
}

const navigateToPlayer = () => {
  if (playerSearchQuery.value.trim()) {
    navigateToPlayerProfile(playerSearchQuery.value.trim())
  }
}

const navigateToPlayerProfile = (playerName: string) => {
  router.push(`/players/${encodeURIComponent(playerName)}`)
}

const setActiveFilter = (filterId: string) => {
  activeFilter.value = filterId

  const routeMap = {
    'bf1942': '/servers/bf1942',
    'fh2': '/servers/fh2',
    'bfvietnam': '/servers/bfv'
  }

  const newRoute = routeMap[filterId as keyof typeof routeMap]
  if (newRoute && router.currentRoute.value.path !== newRoute) {
    router.push(newRoute)
  }
}

const getGameDisplayName = (gameType: string): string => {
  return gameType || 'Unknown'
}

const getGameIcon = (iconClass: string): string => {
  const iconMap: Record<string, string> = {
    'icon-bf1942': `url('${bf1942Icon}')`,
    'icon-fh2': `url('${fh2Icon}')`,
    'icon-bfv': `url('${bfvIcon}')`
  }
  return iconMap[iconClass] || `url('${bf1942Icon}')`
}

const joinServer = (server: ServerSummary) => {
  const joinUrl = `bf1942://${server.ip}:${server.port}`
  const newWindow = window.open(joinUrl, '_blank', 'noopener,noreferrer')
  if (newWindow) {
    newWindow.blur()
    window.focus()
  }
}

const showPlayers = (server: ServerSummary) => {
  selectedServer.value = server
  showPlayersPanel.value = true
}

const closePlayersPanel = () => {
  showPlayersPanel.value = false
  selectedServer.value = null
}

const sortBy = (field: string) => {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    // Default sorting directions
    if (field === 'numPlayers' || field === 'rank') {
      sortDirection.value = 'asc' // Lower numbers first (higher rank = lower number)
    } else if (field === 'timezone') {
      sortDirection.value = 'asc' // Closest timezone first
    } else {
      sortDirection.value = 'asc'
    }
  }
}

const getPlayerPercentage = (server: ServerSummary) => {
  return server.maxPlayers > 0 ? (server.numPlayers / server.maxPlayers) * 100 : 0
}

const getPlayerCountClass = (server: ServerSummary) => {
  const percentage = getPlayerPercentage(server)
  if (percentage >= 100) return 'text-red-400'
  if (percentage >= 80) return 'text-orange-400'
  if (percentage >= 40) return 'text-green-400'
  return 'text-blue-400'
}

const getPlayerBarColor = (server: ServerSummary) => {
  const percentage = getPlayerPercentage(server)
  if (percentage >= 100) return '#f44336'
  if (percentage >= 80) return '#ff9800'
  if (percentage >= 40) return '#4caf50'
  return '#2196f3'
}

const getServerStatusClass = (server: ServerSummary) => {
  const percentage = getPlayerPercentage(server)
  if (percentage >= 100) return 'bg-red-500/5'
  if (percentage >= 80) return 'bg-orange-500/5'
  if (percentage === 0) return 'bg-neutral-500/5'
  return 'bg-green-500/5'
}

const getGameTypeClass = (gameType: string) => {
  const type = gameType?.toLowerCase() || ''
  if (type.includes('bf1942')) return 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
  if (type.includes('fh2')) return 'bg-green-500/20 text-green-400 border border-green-500/30'
  if (type.includes('vietnam')) return 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
  return 'bg-neutral-500/20 text-neutral-400 border border-neutral-500/30'
}

const getCountryFlag = (countryCode: string): string => {
  if (!countryCode || countryCode.length !== 2) return ''

  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0))

  return String.fromCodePoint(...codePoints)
}

const getTimezoneDisplay = (timezone: string | undefined): string | null => {
  if (!timezone) return null
  try {
    const now = new Date()
    const time = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit', minute: '2-digit', timeZone: timezone
    }).format(now)
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
    const offsetMinutes = (tzDate.getTime() - now.getTime()) / 60000
    const offsetHours = Math.round(offsetMinutes / 60)

    if (offsetHours === 0) {
      return `${time} (Same as you)`
    }

    const sign = offsetHours > 0 ? '+' : '-'
    return `${time} (${sign}${Math.abs(offsetHours)} hours)`
  } catch {
    return timezone
  }
}

const fetchServersForGame = async (gameType: 'bf1942' | 'fh2' | 'bfvietnam', isInitialLoad = false) => {
  if (isInitialLoad) {
    loading.value = true
  }
  error.value = null

  try {
    const serverData = await fetchAllServers(gameType)
    servers.value = serverData.sort((a, b) => b.numPlayers - a.numPlayers)
    // Update SEO meta tags with fresh server data
    updateSeoMetaTags()
    // Fire-and-forget: fetch per-server busy indicators for active servers (>=5 players)
    fetchAndAttachServerTrends()
    // Fire-and-forget: fetch server rankings
    fetchServerRankingsData()
  } catch (err) {
    error.value = 'Failed to fetch server data. Please try again.'
  } finally {
    if (isInitialLoad) {
      loading.value = false
    }
  }
}

const fetchServerRankingsData = async () => {
  rankingsLoading.value = true
  rankingsError.value = null

  try {
    const serverGuids = servers.value.map(s => s.guid)
    if (serverGuids.length > 0) {
      const rankings = await fetchServerRankings(serverGuids, 60) // Last 60 days for more data
      serverRankings.value = rankings
    }
  } catch (err) {
    rankingsError.value = 'Failed to load server rankings'
    console.error('Error fetching server rankings:', err)
  } finally {
    rankingsLoading.value = false
  }
}

// Helper: fetch per-server busy indicators without blocking main render
const fetchAndAttachServerTrends = async () => {
  try {
    // Get top 10 servers from the sorted list (as displayed to user)
    const topServers = sortedServers.value.slice(0, 10)
    const eligibleGuids = topServers.filter(s => !!s.guid).map(s => s.guid)

    if (eligibleGuids.length === 0) {
      return
    }

    // Chunk requests to avoid overly long URLs
    const chunkSize = 25
    const chunks: string[][] = []
    for (let i = 0; i < eligibleGuids.length; i += chunkSize) {
      chunks.push(eligibleGuids.slice(i, i + chunkSize))
    }

    const results = await Promise.all(chunks.map(chunk => fetchServerBusyIndicators(chunk)))
    const combined = results.flatMap(r => r.serverResults)

    // Merge into map keyed by serverGuid
    const updated: Record<string, ServerBusyIndicatorResult> = { ...serverTrendsByGuid.value }
    for (const res of combined) {
      updated[res.serverGuid] = res
    }
    serverTrendsByGuid.value = updated
  } catch (e) {
    // Non-fatal: keep UI working without trends
  }
}

// Only show busy badge when we have valid prediction data (not "Not enough data")
const hasValidBusyIndicator = (serverGuid: string): boolean => {
  const data = serverTrendsByGuid.value[serverGuid]?.busyIndicator
  return !!(data && data.busyText !== 'Not enough data')
}

// Server Card helpers — per-game accent + heat level
const getCardGameAccent = (server: ServerSummary): 'bf1942' | 'fh2' | 'bfvietnam' => {
  const g = (server.gameType || '').toLowerCase()
  if (g.includes('fh2')) return 'fh2'
  if (g.includes('vietnam') || g === 'bfv') return 'bfvietnam'
  if (activeFilter.value === 'fh2') return 'fh2'
  if (activeFilter.value === 'bfvietnam') return 'bfvietnam'
  return 'bf1942'
}

const getCardHeat = (serverGuid: string): 'very_busy' | 'busy' | 'moderate' | 'quiet' | 'very_quiet' | 'unknown' => {
  const ind = serverTrendsByGuid.value[serverGuid]?.busyIndicator
  if (!ind || ind.busyText === 'Not enough data') return 'unknown'
  return ind.busyLevel as any
}

const getCardHeatLabel = (serverGuid: string): string => {
  const level = getCardHeat(serverGuid)
  switch (level) {
    case 'very_busy': return 'PEAK'
    case 'busy': return 'ACTIVE'
    case 'moderate': return 'STEADY'
    case 'quiet': return 'QUIET'
    case 'very_quiet': return 'DORMANT'
    default: return 'LIVE'
  }
}

const getCardHeatTitle = (serverGuid: string): string => {
  const ind = serverTrendsByGuid.value[serverGuid]?.busyIndicator
  if (!ind || ind.busyText === 'Not enough data') return 'Live — not enough history'
  return `${ind.busyText} · typical ${Math.round(ind.typicalPlayers)} players`
}

// Timeline bar helpers - Pre-compute max heights for performance
const timelineMaxHeights = computed(() => {
  const maxHeights: Record<string, number> = {}
  Object.entries(serverTrendsByGuid.value).forEach(([guid, data]) => {
    const timeline = data?.hourlyTimeline || []
    maxHeights[guid] = Math.max(1, ...timeline.map(e => Math.max(0, e.typicalPlayers || 0)))
  })
  return maxHeights
})

const getTimelineBarHeight = (guid: string, entry: ServerHourlyTimelineEntry): number => {
  const maxTypical = timelineMaxHeights.value[guid] || 1
  const pct = Math.max(0, Math.min(1, (entry.typicalPlayers || 0) / maxTypical))
  const maxHeight = 24 // px
  const minHeight = 3
  return Math.max(minHeight, Math.round(pct * maxHeight))
}

const closeAllModals = () => {
  // Close all server modals
  Object.keys(serverModalStates.value).forEach(guid => {
    serverModalStates.value[guid] = false
  })
  // Close rank tooltip
  rankTooltipServer.value = null
}

const formatTimelineTooltip = (entry: ServerHourlyTimelineEntry): string => {
  // Convert UTC hour to local "HH:00" display
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), entry.hour, 0, 0))
  const local = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const levelLabel = getBusyLevelLabel(entry.busyLevel)
  return `${local} • Typical ${Math.round(entry.typicalPlayers)} • ${levelLabel}`
}

const getBusyLevelLabel = (level: BusyLevel): string => {
  switch (level) {
    case 'very_busy': return 'Very busy'
    case 'busy': return 'Busy'
    case 'moderate': return 'Moderate'
    case 'quiet': return 'Quiet'
    case 'very_quiet': return 'Very quiet'
    default: return 'Unknown'
  }
}

const fetchPlayerHistory = async () => {
  historyLoading.value = true
  historyError.value = null

  try {
    const apiPeriod = getCurrentPeriodForAPI()

    const response = await fetchPlayerOnlineHistory(
      activeFilter.value as 'bf1942' | 'fh2' | 'bfvietnam',
      apiPeriod,
      getRollingWindowDays(historyRollingWindow.value)
    )

    // Set the response data - only update if we have valid data
    if (response.dataPoints && response.dataPoints.length > 0) {
      playerHistoryData.value = response.dataPoints
    }
    if (response.insights) {
      playerHistoryInsights.value = response.insights
    }
  } catch {
    historyError.value = 'Failed to load player history'
    // Only clear data on error, not during normal updates
    if (playerHistoryData.value.length === 0) {
      playerHistoryData.value = []
      playerHistoryInsights.value = null
    }
  } finally {
    historyLoading.value = false
  }
}

const togglePlayerHistory = () => {
  if (playerHistorySectionRef.value) {
    // The child component already toggles its own state, so just check if we need to fetch data
    // Use a nextTick-like delay to read the state after the child has updated
    const isNowShowing = playerHistorySectionRef.value.show
    if (isNowShowing && playerHistoryData.value.length === 0) {
      fetchPlayerHistory()
    }
  }
}

const changePeriod = (period: '1d' | '3d' | '7d') => {
  historyPeriod.value = period
  fetchPlayerHistory()
}

const changeRollingWindow = (rollingWindow: string) => {
  historyRollingWindow.value = rollingWindow
  fetchPlayerHistory()
}

// Convert rolling window string to numerical days
const getRollingWindowDays = (rollingWindow: string): number => {
  switch (rollingWindow) {
    case '7d':
      return 7
    case '14d':
      return 14
    case '30d':
      return 30
    default:
      return 7
  }
}

const selectLongerPeriod = (period: '1month' | '3months' | 'thisyear' | 'alltime') => {
  longerPeriod.value = period
  historyPeriod.value = 'longer'
  fetchPlayerHistory()
}

const getCurrentPeriod = () => {
  return historyPeriod.value === 'longer' ? longerPeriod.value : historyPeriod.value
}

const getCurrentPeriodForAPI = (): string => {
  if (historyPeriod.value === 'longer') {
    // Return the longer period value directly
    return longerPeriod.value
  }
  // Return the actual period value for 1d, 3d, 7d
  return historyPeriod.value
}

const getActiveGameName = () => {
  const gameType = gameTypes.find(g => g.id === activeFilter.value)
  return gameType?.name || 'Game'
}

// Update SEO meta tags when server data changes
const updateSeoMetaTags = () => {
  // Helper function to update or create meta tags
  const updateMetaTag = (selector: string, attribute: string, content: string) => {
    let tag = document.querySelector(selector)
    if (!tag) {
      tag = document.createElement('meta')
      const attrName = attribute.includes('property') ? 'property' : 'name'
      const attrValue = attribute.replace('property=', '').replace('name=', '')
      tag.setAttribute(attrName, attrValue)
      document.head.appendChild(tag)
    }
    tag.setAttribute('content', content)
  }

  // Update keywords
  updateMetaTag('meta[name="keywords"]', 'name=keywords', seoKeywords.value)

  // Update descriptions
  updateMetaTag('meta[name="description"]', 'name=description', seoDescription.value)
  updateMetaTag('meta[property="og:description"]', 'property=og:description', seoDescription.value)
  updateMetaTag('meta[name="twitter:description"]', 'name=twitter:description', seoDescription.value)

  // Update or create structured data script tag
  let structuredDataScript = document.querySelector('script[type="application/ld+json"]')
  if (!structuredDataScript) {
    structuredDataScript = document.createElement('script')
    structuredDataScript.setAttribute('type', 'application/ld+json')
    document.head.appendChild(structuredDataScript)
  }
  structuredDataScript.textContent = JSON.stringify(structuredData.value)
}

// Watch for server data changes to update SEO
watch([servers, activeFilter], () => {
  if (servers.value.length > 0) {
    updateSeoMetaTags()
  }
}, { immediate: false })

// Watch for game filter changes and fetch new data
watch(activeFilter, (newFilter) => {
  // Reset per-server trends and rankings when switching games to avoid stale data
  serverTrendsByGuid.value = {}
  serverRankings.value = []
  fetchServersForGame(newFilter as 'bf1942' | 'fh2' | 'bfvietnam', true)
  // Also refresh player history if it's visible
  if (playerHistorySectionRef.value?.show) {
    fetchPlayerHistory()
  }
})

// Lifecycle
onMounted(() => {
  updateWideScreen()
  window.addEventListener('resize', updateWideScreen)
  fetchServersForGame(activeFilter.value as 'bf1942' | 'fh2' | 'bfvietnam', true)

  refreshTimer.value = window.setInterval(() => {
    fetchServersForGame(activeFilter.value as 'bf1942' | 'fh2' | 'bfvietnam', false)
  }, 300000)

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    const target = e.target as Element
    if (!target.closest('.relative')) {
      if (installDropdownRef.value) {
        installDropdownRef.value.close()
      }
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', updateWideScreen)
  if (refreshTimer.value) {
    clearInterval(refreshTimer.value)
  }
})
</script>

<style src="./portal-layout.css"></style>
<style scoped src="./LandingPageV2.vue.css"></style>
