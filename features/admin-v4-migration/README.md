# Admin V4 Migration — `/admin/data` to Neutral Depth

Scope expansion of the closed `features/v4-migration/` effort. The original
migration explicitly excluded admin pages
([README §"Decisions locked in"](../v4-migration/README.md)) — this folder
revisits that decision for the `/admin/data` page only.

## In scope

| Path | Legacy view | V4 view | Status |
| --- | --- | --- | --- |
| `/admin/data` | (deleted) | `views/v4/AdminDataManagementV4.vue` | **cut over — `/admin/data` redirects to `/v4/admin/data`** |

## Out of scope (stays on legacy `DashboardLayout` for now)

- `/admin/tournaments/*` — tournament admin (separate slice, big surface)
- `/alias-detection` — single-page legacy view

## Migrated component tree

Built depth-first per the prior recipe
([v4-migration/README.md §"How a single component gets migrated"](../v4-migration/README.md)).

```
views/v4/AdminDataManagementV4.vue                       (page shell — chips, tabs, banners)
└── components/v4/admin/
    ├── MmAdminQueryTab.vue              ← AdminQueryTab.vue        + AdminQueryTab.vue.css
    │   ├── MmRoundDetailPanel.vue       ← RoundDetailPanel.vue
    │   ├── MmRoundAchievementsPanel.vue ← RoundAchievementsPanel.vue
    │   ├── MmDeleteConfirmationModal.vue ← DeleteConfirmationModal.vue   (wraps MmBaseModal)
    │   └── MmBaseModal.vue              ← (reused; bulk-delete confirmation)
    ├── MmAdminAuditTab.vue              ← AdminAuditTab.vue
    ├── MmAdminCronTab.vue               ← AdminCronTab.vue
    ├── MmAdminMergeTab.vue              ← AdminMergeTab.vue        (also uses MmBaseModal x2)
    ├── MmAdminAccessTab.vue             ← AdminAccessTab.vue
    ├── MmAdminNoticeTab.vue             ← AdminNoticeTab.vue
    └── MmAdminAIFeedbackTab.vue         ← AdminAIFeedbackTab.vue
```

Plus a shared sidecar: `styles/mm-admin.css` (admin-specific primitives —
`.mm-admin-card`, `.mm-admin-input`, `.mm-admin-btn`, `.mm-admin-table`,
`.mm-admin-pagination`, `.mm-admin-banner`, etc.). Tokens come from
`modern-minimal.css`; no `--portal-*` survives.

## Design decisions

- **Editorial V4 only.** Dropped the cyberpunk-ops voice (`[ OPS ]`,
  `Data Intel`, `⟩` glyphs, `[ DELETION LOG ]`, scanline grid overlay,
  radial header glow). Titles are sentence case; section headings use
  `.mm-admin-card__title` (uppercase mono eyebrow).
- **Reused `MmBaseModal`** for the three confirmation dialogs (single,
  bulk, and two merge variants). Previously each tab inlined its own
  backdrop + panel.
- **Numeric tints aligned to V4.** Suspicious K/D row uses
  `--mm-load-busy`; warn banner uses the same; danger buttons use
  `--mm-danger`. No neon green.
- **Sidecar `AdminDataManagement.vue.css` and `AdminQueryTab.vue.css`
  are NOT migrated.** Their rules were folded into `mm-admin.css` (shared)
  and per-component `<style scoped>` blocks (component-local). Both files
  remain in the tree until the cutover commit — they are no longer imported.

## Wiring

- Route added: `/v4/admin/data` under the `/v4` parent (renders inside
  `ModernShell`). `beforeEnter` keeps the `isAuthenticated && isSupport`
  gate identical to the legacy route.
- Topbar `Admin` link (`layouts/ModernShell.vue`) retargeted from
  `/admin/data` → `/v4/admin/data`.
- `activeKey` recognises both `/admin/*` and `/v4/admin/*` so the link
  underline shows correctly.
- Legacy `/admin/data` route now `redirect: '/v4/admin/data'` — old
  bookmarks land on V4.
- `App.vue` `LEGACY_PREFIXES` narrowed from `/admin/` to
  `/admin/tournaments/` so non-tournament admin routes get the V4 shell.
- `services/telemetryService.ts` route-name map updated from `admin-data`
  to `v4-admin-data`.

## Verification protocol

The protocol mirrors `features/v4-migration/verification/README.md`. Open
both URLs in two tabs and walk tab-by-tab.

| Tab | URL (legacy) | URL (V4) |
| --- | --- | --- |
| Query | `/admin/data` (default tab) | `/v4/admin/data` (default tab) |
| Audit | `/admin/data` → Audit | `/v4/admin/data` → Audit |
| Cron | admin-only | admin-only |
| Merge | admin-only | admin-only |
| Access | admin-only | admin-only |
| Notice | admin-only | admin-only |
| AI feedback | admin-only | admin-only |

**Checklist per tab** (mark each row 🟢 / 🟡 / 🔴):

- Same data renders (counts, sorts, filters)
- All actions fire the same API (Network tab) and produce the same effect
- Loading + empty + error states all render
- Mobile (≤ 640px) layout doesn't break
- No console errors

See [VERIFICATION.md](./VERIFICATION.md) for the per-tab status grid.

## Cutover (done)

1. ✅ `/admin/data` route became `redirect: '/v4/admin/data'`; the
   `AdminDataManagement` lazy import was dropped from `router/index.ts`.
2. ✅ `App.vue` `LEGACY_PREFIXES` narrowed: `/admin/` → `/admin/tournaments/`.
   Non-tournament admin paths now render under `ModernShell`.
3. ✅ `services/telemetryService.ts` route-name map: `admin-data` →
   `v4-admin-data` (slug unchanged: `admin_data`).
4. ✅ Deleted (whole `components/admin-data/` folder removed):
   - `views/AdminDataManagement.vue`
   - `views/AdminDataManagement.vue.css`
   - `components/admin-data/` (folder + all 10 files inside)

`DashboardLayout`, `Sidebar`, and the `--color-*` token surface all stay
— `/admin/tournaments/*` and `/alias-detection` still depend on them.
