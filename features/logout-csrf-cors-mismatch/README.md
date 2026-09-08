# Logout CSRF vs leftover munyard.dev CORS origin

`bfstats/Exceptions` paged at 18:01 UTC 09-07 on four `POST /stats/auth/logout`
calls at 17:59:36Z from a Chrome client on `https://bfstats.io`.

`EnforceCsrfForCookieEndpoints` compared the browser `Origin` against the
single `Cors:AllowedOrigins` value. Production still had
`https://1942.munyard.dev`. Logout then caught that `UnauthorizedAccessException`
as a generic 500 `LogError`, which matches `@Exception is not null`.

The requests were same-origin (`Host=bfstats.io`, `Origin=https://bfstats.io`)
and finished in 3–46ms. CORS middleware also logged
`OriginNotAllowed` for `https://bfstats.io`. Not a SQLITE_BUSY or volume stall.

## Change

- Allow comma-separated CORS origins and treat same-host Origin as CSRF-safe
  (edge TLS means `Request.Scheme` is http).
- Logout CSRF failures return 401 like refresh, without an Error log.
- Production `Cors__AllowedOrigins` is `https://bfstats.io,https://staging.bfstats.io`.
- Production `RefreshToken__CookieDomain` is `bfstats.io` so the httpOnly
  refresh cookie can actually be stored on the live host.

Jwt issuer/audience are still the munyard leftover. Tokens keep validating
against that issuer; changing them would invalidate existing JWTs and is
not required to stop this page.
