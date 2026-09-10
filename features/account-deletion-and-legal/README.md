# Account deletion, data export, and legal pages

Discord's developer portal requires a published Terms of Service and Privacy
Policy URL for the OAuth app. Writing an honest privacy policy meant first
being able to honour what it promises — so this feature is two halves:

1. **Self-service data rights** — export and erasure, from the dashboard.
2. **The published documents** — `/terms` and `/privacy`.

## URLs to register with Discord

| Field | URL |
| --- | --- |
| Terms of Service | `https://bfstats.io/terms` |
| Privacy Policy | `https://bfstats.io/privacy` |

Both are absolute child routes of the V4 shell, kept top-level and short
deliberately: they get pasted into third-party consoles and should outlive any
internal route reshuffle.

## Erasure: why the User row survives

The obvious implementation — `DELETE FROM Users WHERE Id = @id` — does not work
here, and would have failed in production on the first request.

Four foreign keys onto `Users` are `DeleteBehavior.Restrict`:

| Table | Column |
| --- | --- |
| `Tournaments` | `CreatedByUserId` |
| `TournamentPosts` | `CreatedByUserId` |
| `TournamentMatchComments` | `CreatedByUserId` |
| `TournamentComments` | `AuthorUserId` |

So a hard delete throws for anyone who has ever created a tournament — exactly
the population most likely to be visible enough to ask. Switching those FKs to
`Cascade` would be worse: one person's erasure request would silently take an
entire tournament down with it, including other players' teams, matches,
results and comments.

`AccountService` therefore **tombstones**: everything personal is hard-deleted,
and the `User` row is left behind stripped of anything identifying. What
remains is an opaque integer that keeps other people's tournaments
referentially intact.

### What happens to each table

| Table | Action |
| --- | --- |
| `UserPlayerNames`, `UserFavoriteServers`, `UserBuddies` | Deleted |
| `RefreshTokens` | Deleted (includes stored IP + user-agent) |
| `PlayerComments`, `ServerComments`, `TournamentComments`, `TournamentMatchComments` | Deleted |
| `TournamentTeamPlayers` | `UserId` → `NULL`; `PlayerName` kept |
| `TournamentTeams` | `LeaderUserId` → `NULL` |
| `Tournaments`, `TournamentPosts` | `CreatedByUserEmail` → tombstone; row kept |
| `Users` | `Email` → tombstone, `Role` → `NULL`, `IsActive` → `false` |

The tombstone address is `deleted-user-{id}@deleted.invalid`. RFC 2606 reserves
`.invalid`, so it can never be routed or re-registered, and keying it on the
user id satisfies the unique index on `Users.Email`.

Because the real address is released, **signing in again with the same Discord
account produces a brand-new, empty account** — covered by a test.

The whole thing runs in one transaction. A half-erased account is worse than a
failed request, because the user is told it worked and the leftovers are
invisible.

### Logs

Deleting the address from the database is pointless if it is still sitting in
Seq. Three log lines carried the raw email and were changed to log the user id
instead (`DiscordAuthService.ExchangeCodeForUserAsync`, and both branches of
`AuthController.CreateOrUpdateUserAsync`). The erasure log line itself
deliberately records only the user id and the counts.

**Still to confirm:** Seq's retention policy. The privacy policy says server
logs roll off after "a limited period" — that claim needs a configured
retention rule behind it, and none was found in `deploy/`. Historic log entries
predating this change may still contain addresses.

## API

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/stats/auth/account/export` | Full account data as JSON |
| `DELETE` | `/stats/auth/account` | Body must be `{"confirm":"DELETE"}` |

Both require a Bearer token. The export deliberately omits `RefreshToken.TokenHash` —
it is a credential, and returning it would turn data portability into session
exfiltration. There's a test asserting the hash never appears in the serialised
export.

The confirmation phrase is duplicated as `DeleteAccountRequest.RequiredPhrase`
(API) and `DELETE_ACCOUNT_CONFIRM_PHRASE` (UI). Keep them in step.

## UI

- **Dashboard → Account** gains a "Download your data" row and a "Delete your
  account" row.
- Deletion opens a modal that spells out what goes and what stays, and requires
  the user to type `DELETE`. This is the one control on the site with no undo,
  so the friction is intentional.
- The legal pages share `MmLegalDocument.vue` (title block, at-a-glance grid,
  sticky contents rail ≥981px, prose styling). Section types live in
  `legalDocument.ts` because `<script setup>` can't carry ES module exports.

### Keep them short — this is the requirement, not a preference

Terms is ~300 words of body text, Privacy ~420. A typical privacy policy runs
2,000–4,000. **Length is a bug here.** Nobody reads the long ones, so a longer
document is a less-read document, not a safer one.

Rules that got them this short, in the order they matter:

1. **Only write about surfaces that exist.** Acceptable use is one line —
   *comments are public and tied to your player alias* — because comments are
   the only thing a user can post. A harassment / impersonation / malware /
   spam laundry list describes a site this isn't.
2. **Cut anything a reader already assumes.** "You're responsible for what
   happens under your account", "don't post anything unlawful", "one person,
   one account" — all removed. They inform nobody.
3. **Cut licence boilerplate.** No paragraph explaining that comments stay
   yours and we have a non-exclusive licence to display them. Displaying a
   comment someone posted is the obvious purpose of posting it.
4. **Tables over prose** for anything enumerable.
5. **Deletion is section 01 of the privacy policy**, not buried at the end,
   with a button straight to `Dashboard → Account`.
6. **The at-a-glance grid carries the answer people came for** — is this
   tracking me, what's stored, how do I leave. Olive marker = "nothing happens
   to you", neutral = "this is stored".

If you're adding a section, the test is: does this tell the reader something
about **what we capture or what they can do about it**? If not, it doesn't go
in.

Note `MmLegalDocument.vue` restates `font-family`, `background` and `color` on
`.mm-legal-table` cells: legacy `assets/base.css` styles bare `table`/`th`/`td`
globally with the old neon palette and a mono stack, and it wins otherwise.

## The line the policy has to hold

Public gameplay statistics are **not** account data. They're polled from public
game servers, keyed on self-chosen in-game names, and collected whether or not
the person ever visits the site. Deleting an account does not and should not
delete them — other players' round histories reference the same rounds.

Both documents state this plainly rather than burying it, and the deletion
modal repeats it, because it's the one thing a user is most likely to
misunderstand about what "delete my profile" does here. Removal of statistics
for a specific in-game name is a separate, manual request (Privacy Policy
§10), gated on the requester showing the name is theirs — names are
unverified, so we can't do that automatically.

## Decisions taken by the operator

- **Contact channel:** the bfstats.io Discord, not an email address. Both
  documents point there. This is defensible only because export and erasure are
  self-service — Discord is for questions, not for exercising rights.
- **Jurisdiction:** governing law Australia; GDPR-first framing, with the rights
  granted to everyone rather than only to EU/UK residents.

## Before these pages go live

- [ ] Confirm the Discord invite `discord.gg/6saqqTTYEM` is permanent, not a
      24-hour link. Both documents hardcode it as the sole contact route.
- [ ] Set (and document) a Seq retention policy — see *Logs* above.
- [ ] Re-read the effective date (10 September 2026) if these ship later.
- [ ] Restart the API so the two new routes are served — a running
      `dotnet run` from before this change returns 404 for them.
