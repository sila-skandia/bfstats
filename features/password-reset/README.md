# Password reset

A password account that forgets its password gets a one-time link by email, or,
when it has no email, the owner is told on Discord and resets it by hand.

## How it works

- **The address is never stored.** Password sign-ups keep an HMAC of their
  optional email in `Users.Email` (`features/username-password-auth`). On
  `POST stats/auth/forgot-password` the requester types username and email; the
  typed address is hashed and compared, and only on a match is the link sent,
  to the address just typed. Nothing new about the address is kept.
- **The link.** 32 random bytes, base64url, in
  `https://bfstats.io/auth/reset-password?token=...`. The `PasswordResetTokens`
  row keeps its SHA-256 only. Thirty minutes, single use, and only the newest
  link for an account works (asking again deletes the older rows).
- **Spending it.** `POST stats/auth/reset-password {token, newPassword}`
  claims the row with a conditional update (two tabs cannot both use it), sets
  the password (8 characters minimum, as everywhere else), revokes every refresh
  token the account holds and spends any other open link. The page then says
  every device was signed out and offers Sign in.
- **No email, or the wrong one.** The account exists but cannot get a link:
  `DiscordWebhookService.SendPasswordResetHelpAsync` posts the username and user
  id to the password reset channel, with the reason (no email on the account, or
  the typed one did not match). Never the typed address. The owner finds them on
  Discord and uses Admin, Data, Access, which regenerates a temporary password.
- **The answer never changes.** Unknown username, wrong email, no email, a
  failed send: the same 200 and the same sentence. Account existence is not
  revealed.
- **Limits.** Ten forgot or reset calls an hour per IP (429 beyond), one email
  per account per two minutes, one Discord notice per account per hour (Redis).

## The hash key

`EmailHashService` keys its HMAC with `Auth:EmailHashKey`, which production
does not set, so it falls back to a key derived from the JWT signing key
(`bf42-stats-secrets`, `jwt-private-key`). **Rotating the JWT key, or setting
`Auth:EmailHashKey` now, makes every stored email hash unmatchable**: every
reset would become a Discord notice. If either must change, re-hashing is not
possible (the addresses are not stored), so plan for that. Checked 2026-11-27:
the JWT secret was last written 2026-02-10, before the first hashed-email
account (2026-10-03), so every stored hash matches today's key.

## Reading the log

Every request leaves one line from `PasswordResetService`: "link sent",
"cannot be emailed (NoEmailOnAccount | EmailDidNotMatch); asking the owner",
"... the owner was already asked within the hour, no new notice", or "asked
again inside the cooldown; no email sent". An unknown username leaves none.
Delivery adds `Cloudflare Email sent '...' (<message id>)`, or `Cloudflare Email
refused` with Cloudflare's error code.

## The email

`api/Auth/PasswordResetEmail.cs`. The logo (`ui/public/email/logo.png`, a PNG
of the header sigil, since few mail clients draw webp), one sentence naming the
account, one button, the link again as text, and "ignore this if it was not
you". Tables and inline styles, with a plain-text part beside the HTML.

## Delivery: Cloudflare Email Service

The API calls the REST endpoint directly
(`POST /client/v4/accounts/{account}/email/sending/send`), so no Worker is
needed. `CloudflareEmailSender` is registered when `CloudflareEmail:AccountId`
and `CloudflareEmail:ApiToken` are both set; otherwise `NoOpEmailSender` logs
and drops, so a dev machine and the E2E API need no credentials.

- **Domain.** Email Sending was enabled for `bfstats.io` on 2026-11-27 with
  `wrangler email sending enable bfstats.io` (account
  `eec964a0ad385fef75646d4b6b7d2f51`). It added the `cf-bounce` return path
  (MX and SPF on `cf-bounce.bfstats.io`, DKIM at
  `cf-bounce._domainkey.bfstats.io`) and `_dmarc.bfstats.io` = `p=reject`. The
  zone had no MX, SPF or DMARC before, so nothing else sends as bfstats.io;
  relax the DMARC record if that ever changes. Check it with
  `wrangler email sending dns get bfstats.io`.
- **No mailbox.** `noreply@bfstats.io` only sends. Replies bounce, which is
  why the email asks nobody to reply.
- **Plan.** Workers Paid allows any recipient. Workers Free only sends to
  verified addresses, which would fail with error 10208.

## Deploying

`deploy/app/deployment.yaml` reads these:

| Env | From |
|---|---|
| `CloudflareEmail__AccountId` | value in the manifest |
| `CloudflareEmail__From` | `noreply@bfstats.io` |
| `CloudflareEmail__ApiToken` | secret `cloudflare-email`, key `api-token` (optional) |
| `DiscordPasswordReset__WebhookUrl` | secret `discord-secrets`, key `password-reset-webhook` (optional) |

Live since 2026-11-27: both secrets created, the whole `deployment.yaml`
applied (the Jenkins build only restarts the deployment, it never applies the
manifest, so a new env var needs that apply), migration
`20261127122407_AddPasswordResetTokens` in the production database.

Both secrets are optional, so the pod starts without them. Without the token,
emails are dropped; without the webhook, notices are skipped.

The token is an account API token with **Email Sending: Edit**, made in the
dashboard (My Profile, API Tokens, Create Token, Custom). Then:

```bash
kubectl --context hetzner -n bf42-stats create secret generic cloudflare-email --from-literal=api-token='<token>'
kubectl --context hetzner -n bf42-stats patch secret discord-secrets -p '{"stringData":{"password-reset-webhook":"<webhook url>"}}'
kubectl --context hetzner -n bf42-stats rollout restart deployment/bf42-stats
```

## Tests

- `tests/api/Auth/PasswordResetServiceTests.cs`: match, mismatch, no email,
  unknown name, cooldowns, single use, expiry, supersession, weak password, a
  failed send. Runs against SQLite.
- `tests/api/Auth/CloudflareEmailSenderTests.cs`: the request Cloudflare
  gets, and refusals (JSON or not) surfacing as `EmailDeliveryException`.
- `ui/e2e/password-reset.spec.ts`: the forgot form's uniform answer, a bad
  link, a link with no token, and the whole emailed-link flow ending in a
  sign-in. The E2E API sends no mail, so `E2eDatabaseSeed` seeds `e2e-reset`
  with a known token, re-armed on every boot.
