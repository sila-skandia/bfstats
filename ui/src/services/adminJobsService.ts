/**
 * Admin API for triggering background jobs on-demand.
 * Used after round deletion to refresh aggregates, and for backfills/maintenance.
 */

const BASE = '/stats/admin/jobs';

async function request(
  path: string,
  opts: { method?: string; body?: string } = {}
): Promise<{ message?: string; error?: string }> {
  const { authService } = await import('./authService');
  const ok = await authService.ensureValidToken();
  if (!ok) throw new Error('Authentication required but token is invalid');

  const token = localStorage.getItem('authToken');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body,
  });

  if (res.status === 401) {
    const refreshed = await authService.refreshToken();
    if (refreshed) {
      const t = localStorage.getItem('authToken');
      if (t) headers['Authorization'] = `Bearer ${t}`;
      const retry = await fetch(`${BASE}${path}`, { method: opts.method ?? 'POST', headers, body: opts.body });
      if (!retry.ok) {
        const err = await retry.json().catch(() => ({}));
        throw new Error((err as { error?: string; message?: string }).error || (err as { message?: string }).message || `HTTP ${retry.status}`);
      }
      const ct = retry.headers.get('content-type');
      if (!ct?.includes('application/json') || retry.status === 204) return {} as { message?: string };
      return retry.json();
    }
    await authService.logout();
    throw new Error('Session expired. Please login again.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string; message?: string }).error || (err as { message?: string }).message || `HTTP ${res.status}`);
  }

  const ct = res.headers.get('content-type');
  if (!ct?.includes('application/json') || res.status === 204) return {} as { message?: string };
  return res.json();
}

/** Runs to completion. Refreshes ServerHourlyPatterns, HourlyPlayerPredictions, MapGlobalAverages. Run after round delete. */
export function triggerDailyAggregateRefresh(): Promise<{ message?: string; error?: string }> {
  return request('/daily-aggregate-refresh');
}

/** Runs to completion. Removes stale this_week best scores, prunes ServerOnlineCounts. */
export function triggerWeeklyCleanup(): Promise<{ message?: string; error?: string }> {
  return request('/weekly-cleanup');
}

/** Fire-and-forget. Tier 1–4. Returns 202 Accepted. */
export function triggerAggregateBackfillTier(tier: number): Promise<{ message?: string; error?: string }> {
  return request(`/aggregate-backfill/${tier}`);
}

/** Fire-and-forget. All tiers. Returns 202 Accepted. */
export function triggerAggregateBackfill(): Promise<{ message?: string; error?: string }> {
  return request('/aggregate-backfill');
}

/** Fire-and-forget. Full ServerMapStats from Rounds; daily only does ~2 months. */
export function triggerServerMapStatsBackfill(): Promise<{ message?: string; error?: string }> {
  return request('/server-map-stats-backfill');
}

/** Fire-and-forget. Full MapHourlyPatterns from Rounds; daily only ~60 days. */
export function triggerMapHourlyPatternsBackfill(): Promise<{ message?: string; error?: string }> {
  return request('/map-hourly-patterns-backfill');
}

/** Fire-and-forget. Daily refresh + weekly cleanup in sequence. */
export function triggerRunAll(): Promise<{ message?: string; error?: string }> {
  return request('/run-all');
}

/** Sync any completed rounds/sessions that have never been synced to Neo4j. Runs to completion, normally near-instant. */
export function triggerNeo4jSync(): Promise<{
  success: boolean;
  relationshipsProcessed?: number;
  durationMs?: number;
  errorMessage?: string;
}> {
  return fetch('/stats/admin/data/neo4j/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
    },
  }).then(async (res) => {
    if (res.status === 401) {
      const { authService } = await import('./authService');
      const refreshed = await authService.refreshToken();
      if (refreshed) {
        const retry = await fetch('/stats/admin/data/neo4j/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
          },
        });
        if (!retry.ok) {
          const err = await retry.json().catch(() => ({}));
          throw new Error(err.errorMessage || err.error || `HTTP ${retry.status}`);
        }
        return retry.json();
      }
      await authService.logout();
      throw new Error('Session expired. Please login again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.errorMessage || err.error || `HTTP ${res.status}`);
    }
    return res.json();
  });
}

/**
 * Repair tool (fire-and-forget). Resets the Neo4j sync watermark for every round/session
 * on or after `fromDate`, then drains the backlog through the normal incremental sync.
 * Only meaningful right after the Neo4j PLAYED_WITH/PLAYS_ON data has actually been wiped —
 * the write side stays additive, so running this against un-wiped data double-counts.
 */
export function triggerNeo4jRelationshipsBackfill(fromDate: string): Promise<{ message?: string; error?: string }> {
  return request(`/neo4j-relationships-backfill?fromDate=${encodeURIComponent(fromDate)}`);
}

/** Detect player communities using graph algorithms. Runs to completion. */
export function triggerCommunityDetection(): Promise<{ message?: string; error?: string }> {
  return fetch('/stats/communities/detect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
    },
  }).then(async (res) => {
    if (res.status === 401) {
      const { authService } = await import('./authService');
      const refreshed = await authService.refreshToken();
      if (refreshed) {
        const retry = await fetch('/stats/communities/detect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
          },
        });
        if (!retry.ok) {
          const err = await retry.json().catch(() => ({}));
          throw new Error((err as any).message || `HTTP ${retry.status}`);
        }
        return retry.json();
      }
      await authService.logout();
      throw new Error('Session expired. Please login again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).message || `HTTP ${res.status}`);
    }
    return res.json();
  });
}

/** Check Neo4j migration status. */
export function getNeo4jMigrationStatus(): Promise<{
  appliedCount: number;
  pendingCount: number;
  isUpToDate: boolean;
  appliedMigrations: string[];
  pendingMigrations: string[];
}> {
  return fetch('/stats/admin/data/neo4j/migrations', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
    },
  }).then(async (res) => {
    if (res.status === 401) {
      const { authService } = await import('./authService');
      const refreshed = await authService.refreshToken();
      if (refreshed) {
        const retry = await fetch('/stats/admin/data/neo4j/migrations', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
          },
        });
        if (!retry.ok) throw new Error(`HTTP ${retry.status}`);
        return retry.json();
      }
      await authService.logout();
      throw new Error('Session expired');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

/** Fire-and-forget. Pre-computes Server Wrapped data for all servers. Returns 202 Accepted. */
export function triggerServerWrappedCrunch(): Promise<{ message?: string; error?: string }> {
  return request('/server-wrapped-crunch');
}

/**
 * Fire-and-forget. Pre-computes Player Wrapped data. Returns 202 Accepted.
 *
 * With no argument it uses the configured allowlist. Pass `topPlayers` to crunch the busiest N
 * players of the year by total playtime instead — used to rehearse a full run at a manageable
 * size. Progress and ms/player are logged to Seq as it goes.
 */
export function triggerPlayerWrappedCrunch(topPlayers?: number): Promise<{ message?: string; error?: string }> {
  const query = topPlayers && topPlayers > 0 ? `?topPlayers=${topPlayers}` : '';
  return request(`/player-wrapped-crunch${query}`);
}

/** Fire-and-forget. Pre-computes and caches Player Wrapped data for every registered alias. Returns 202 Accepted. */
export function triggerProfileWrappedCrunch(): Promise<{ message?: string; error?: string }> {
  return request('/profile-wrapped-crunch');
}

