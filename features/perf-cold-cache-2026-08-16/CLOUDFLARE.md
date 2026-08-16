# Cloudflare changes — bfstats.io

Two settings. Neither is in this repo, and between them they are worth more than every
code change in `FINDINGS.md`. Do #1 first — it is a correctness fix, and it gates the
value of the `[EdgeCache]` work.

---

## 1. Stop overriding `max-age` (required)

**Dashboard → bfstats.io → Caching → Configuration → Browser Cache TTL
→ set to `Respect Existing Headers`.**

Currently set to 4 hours, which rewrites `max-age` on every proxied response:

```
origin  Cache-Control: public, max-age=0, s-maxage=20, stale-while-revalidate=15
edge    Cache-Control: public, max-age=14400, s-maxage=20, stale-while-revalidate=15
                                       ^^^^^ injected by Cloudflare
```

`max-age=0` is deliberate — it is the whole design of `EdgeCacheAttribute`: the edge
absorbs repeat traffic while the browser still revalidates, so an SPA route change never
serves a stale payload from disk. The override defeats that, and means live server data
and player profiles can sit in a visitor's browser cache for **4 hours**.

**Verify after changing:**

```bash
curl -sI https://bfstats.io/stats/liveservers/bf1942/servers | grep -i cache-control
```

Expect `max-age=0` (with `s-maxage=30`). If it still says `14400`, the setting didn't
take — check for a Page Rule or Cache Rule also setting Browser TTL, which would win.

---

## 2. Give the SPA shell one cache entry instead of thousands

The HTML shell is byte-identical on every route (verified by md5 across `/`,
`/v4/players/*`, `/v4/servers/detail/*`), but Cloudflare keys it per-URL at
`s-maxage=300`. The landing page gets enough traffic to stay warm; individual player
pages do not, so a page nobody opened in the last 5 minutes costs ~1.1s to fetch HTML the
edge already holds under another key:

```
/v4/players/Chumpy    45ms  HIT
/v4/players/Snail   1082ms  MISS
/v4/players/Lecter  1154ms  MISS
```

**Dashboard → Caching → Cache Rules → Create rule.**

- Name: `SPA shell — single cache entry`
- **If** — use the expression editor:
  ```
  (http.host eq "bfstats.io" and not starts_with(http.request.uri.path, "/stats/")
   and not starts_with(http.request.uri.path, "/assets/")
   and not starts_with(http.request.uri.path, "/hub")
   and not starts_with(http.request.uri.path, "/health")
   and not starts_with(http.request.uri.path, "/swagger"))
  ```
- **Then**:
  - Cache eligibility: **Eligible for cache**
  - Edge TTL: **Use cache-control header if present**
  - **Cache Key → Custom cache key → Query String: Ignore all**, and under
    *Cache Key → Custom* set the URI component so all SPA routes collapse to one key.

If the cache-key UI on the current plan won't let you normalise the path, the fallback is
to raise the shell's `s-maxage` instead — it only changes on deploy, and `last-modified`
is already deploy-stamped. That does not fix the long tail (each URL still warms
separately) but it makes each entry last far longer.

**Verify:**

```bash
for n in Snail Lecter Atem4444; do curl -s -o /dev/null -D - "https://bfstats.io/v4/players/$n" | grep -i "^cf-cache-status"; done
```

Expect `HIT` on the second and third even though you've never requested those URLs —
that's the shared key working. Also confirm a deploy still busts it: after the next
release, the shell should serve the new asset hashes within `s-maxage`.

---

## Watch out for

- **Don't cache `/stats/*` at the zone level.** Those endpoints set their own
  `Cache-Control` per-endpoint; a blanket rule would cache authenticated responses
  (`/stats/auth/profile`) and admin routes. The exclusion above is deliberate.
- **`stale-while-revalidate` appears not to be honoured on this plan.** An expired entry
  was measured revalidating synchronously (`cf-cache-status: EXPIRED`, 1164ms) rather
  than serving stale and refreshing behind the request. Don't count on SWR to hide origin
  latency — the TTL is what actually protects visitors.
- Both changes are dashboard state that no manifest captures. Worth a line in
  `deploy/NODE_TUNING.md` alongside the other out-of-band settings, since a zone
  reconfigure restores neither.
