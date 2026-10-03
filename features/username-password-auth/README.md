# Username and password accounts

Discord OAuth made some prospective users uncomfortable. They did not want to
hand a third-party identity to the site. This feature adds a first-party
username + password provider next to it. Existing accounts stay Discord; JWTs,
refresh-token cookies and roles are unchanged, so nothing downstream moves.

## Design

- **One identity column.** `Users.Email` stays the unique identity field for
  every account kind. Discord users keep their real verified address there.
  Password sign-ups store an `EmailHashService` HMAC-SHA256 (`email-hmac$...`,
  base64) in the same column, so the existing unique index does the dedup work
  and nothing can ever leak the address. When the optional email is skipped the
  column gets a per-user `no-email-<guid>@users.bfstats.io` sentinel instead.
- **New columns** (`AddPasswordAuth` migration): `Username` (nullable and unique, and null for Discord rows so the index
  needs nothing from them), `PasswordHash`
  (nullable), `AuthProvider` (`discord` / `password`; tombstoned rows get
  `deleted` during the backfill).
- **Passwords.** PBKDF2-HMAC-SHA256, 210k iterations (OWASP's PBKDF2-SHA256
  figure), random 16-byte salt, stored as `pbkdf2-sha256$iter$salt$key` so the
  iteration count can be raised later without re-rolling every row. BCL-only,
  so no new package on the constrained node.
- **Email hashing.** Uses `Auth:EmailHashKey` when configured; otherwise it
  derives a key from the JWT private key so there is always a stable secret
  per deployment (fresh dev machines fall back to unkeyed SHA-256 with no
  error). Recovery normalises case/whitespace before hashing.
- **Endpoints** (`AuthController`):
  - `POST stats/auth/login` gained a `{username, password}` branch alongside
    Discord code and dev bypass. Unknown name and wrong password answer with
    the same message; per-IP 20 attempts/hour shares the cache key with the
    Discord exchange budget.
  - `POST stats/auth/register`. Username (3-24, `[A-Za-z0-9_.-]`,
    case-insensitive uniqueness), password min 8, optional email (hashed),
    optional player name linked straight into `UserPlayerNames` (a name with
    no tracked player yet is fine, because the alias table allows that on purpose).
  - `POST stats/auth/forgot-password`. Username plus email, HMAC lookup on the
    stored hash, uniform 200 always (no enumeration). Delivery goes through
    `IEmailSender`; the current `NoOpEmailSender` logs and drops because there
    is no SMTP relay on the node.
  - `POST stats/auth/password` (authorised). Changes the password; Discord-only
    accounts get a 400.
- **Display.** Login response, profile and account export blank out the
  email for password accounts rather than showing the hash or sentinel bytes.
- **Erasure** (`AccountService.DeleteAsync`) additionally nulls `Username` and
  `PasswordHash` and sets `AuthProvider = "deleted"` on the tombstone.

## UI

- `views/v4/AuthSignInV4.vue` on `/auth/login` and `/auth/register`: sign-in /
  sign-up tabs, optional email with copy explaining the one-way hash, optional
  player-name link, forgotten-password mode, and a "Continue with Discord"
  button for existing accounts.
- `MmHeaderAuth`'s Sign in button now routes to `/auth/login` instead of
  launching Discord directly.

## Follow-ups

- SMTP relay + real `IEmailSender` implementation; a one-time reset token
  table is the natural next step once delivery exists (today the forgot
  endpoint can only prove nothing left the server).
- Player-name autocomplete on the register form (free text now; backend
  accepts any name and links it).
- Registering with an email that already belongs to a Discord account is
  allowed on purpose. The hash check cannot match Discord rows (they store
  the plaintext address), and it grants the registrant nothing: the stored
  value is a hash, so the admin-role email comparison and password takeover
  of the Discord account are both out of reach.
- If a user forgets both username and email, there is no self-service
  recovery. The admin Access tab regenerates a temporary password for
  password accounts instead (`POST stats/admin/data/users/{id}/reset-password`):
  the plaintext is shown once to the admin, only the hash is stored, every
  session the user holds is revoked, and the action lands in the admin audit
  log as `reset_password`.