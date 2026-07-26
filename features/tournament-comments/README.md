# Tournament Comments

Public commenting on tournaments and individual matches. Any signed-in user
with a linked player profile can post a comment at the tournament level or on
a specific match, using a simple Bold/Italic/Link/Image toolbar (Tiptap →
sanitized HTML, no raw markdown entry).

## Decisions

- **Author identity**: reuses the `PlayerComment`/`ServerComment` convention
  — a commenter must have a linked player profile and posts "as" one of
  those profile names, not just their Discord account. Keeps the trust model
  consistent across all comment surfaces on the site.
- **Storage**: a new `TournamentComment` table, separate from the existing
  `TournamentMatchComment` (organizer/admin "referee notes", written via
  `AdminTournamentController`). Keeping them separate means organizer notes
  and public discussion are never conflated in the UI or the data model.
- **Visibility**: comments show in two places — a "Discussion" widget
  (tournament-level comments in a right-hand rail on the Overview tab,
  match-level comments inline inside the match details modal) and as entries
  in the existing chronological activity feed.
- **Overview layout (per Claude Design mockup `Tournament Comments.dc.html`,
  option 1A)**: the Discussion panel moved from a full-width block above the
  Activity Feed to a bordered, self-scrolling rail (`max-height: 560px`) in
  the Overview sidebar, above Standings. Comment rows got square initials
  avatars and hover-reveal Edit/Del actions; the rail header has a "+ Add"
  button that scrolls the internal list to the composer and focuses it. The
  mockup was built against the site's `--mm-*` ("Neutral Depth"/v4) design
  system — the only one available in Claude Design — but tournament-v2 pages
  render with a separate, per-tournament-themed `--t-*` token set. Every
  token in the mockup CSS was translated 1:1 to its `--t-*` equivalent
  (`--mm-highlight` → `--t-accent`, `--mm-ink-muted` → `--t-muted`, etc.)
  rather than pulling in `--mm-*` styling, to keep the rail visually
  consistent with the rest of the per-tournament-themed page.
- **One component, two variants**: `T2CommentThread.vue` takes a
  `variant: 'rail' | 'inline'` prop. `'rail'` (Overview) is the boxed,
  scrollable widget above; `'inline'` (match modal, unchanged behavior) is
  the original unboxed section with numbered pagination — the design only
  covered the Overview surface, so the match modal's structure/pagination
  was intentionally left as-is. The new avatar + hover-reveal-actions row
  style applies to both variants for a consistent comment "row" look
  everywhere.
- **UI reuse**: the existing `MmCommentsThread.vue` (used on player/server
  profile pages) was *not* reused directly. It's styled with the `--mm-*`
  design tokens (`modern-minimal.css`), which aren't loaded on tournament-v2
  pages — those use a separate, per-tournament themed token set (`--t-*`,
  resolved in `t2Theme.ts`). Reusing it as-is would have rendered unstyled.
  Instead, `T2CommentThread.vue` is a tournament-v2-native sibling: same
  backend API, same Tiptap toolbar/sanitization approach, but built with
  `t2-*` classes/tokens to match the rest of the tournament-v2 design system.
- **Threaded replies**: `ParentCommentId` exists on `TournamentComment` from
  day one (nullable, unused) so a future reply feature doesn't need a
  migration + backfill. No reply UI or reply endpoint in this pass.

## Key files

Backend:
- `api/PlayerTracking/PlayerTrackerDbContext.cs` — `TournamentComment` entity
  + EF config (search for `TournamentComment`)
- `api/Social/TournamentCommentsController.cs` — public GET, `[Authorize]`
  POST/PATCH/DELETE at `stats/tournaments/{idOrName}/comments`
  (`?matchId=` selects tournament- vs match-level)
- `api/Social/Models/TournamentCommentDto.cs`,
  `CreateTournamentCommentRequest.cs`, `PagedTournamentCommentsDto.cs`
- `api/Gamification/Services/TournamentFeedService.cs` — 5th feed query
  block, emits `"tournament_comment"` feed items
- `api/Migrations/20260726102649_AddTournamentComments.cs`

Frontend:
- `ui/src/components/tournament-v2/T2CommentThread.vue` — the comment thread
  UI (list, pagination, Tiptap editor, sign-in gate, post-as-profile picker),
  `rail`/`inline` variants
- `ui/src/services/tournamentCommentsService.ts` — API client
- `ui/src/components/tournament-v2/T2Overview.vue` — Discussion rail in the
  sidebar (above Standings) + `tournament_comment` feed item rendering
- `ui/src/components/tournament-v2/T2MatchDetailsModal.vue` — Discussion
  section below the existing read-only "Referee comments" block
- `ui/src/services/tournamentFeedService.ts` — `FeedCommentData` type +
  `isCommentData` guard

## Not built yet

- Threaded replies (schema-ready, no UI/API)
- Real-time updates for the comment panels (currently load-on-mount /
  reload-after-post, no SignalR — matches the existing feed's polling model)

## Verification

- `./scripts/verify.sh --skip-e2e` for API tests + typecheck
- `./scripts/verify.sh e2e/tournament-comments.spec.ts --project=chromium`
  for the E2E coverage (sign-in gate, post/edit/delete, tournament- and
  match-level comments, feed rendering)
