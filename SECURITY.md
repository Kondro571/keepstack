# Security

Keepstack is a young project. This document is an honest description of its current
security posture, so you can deploy it with the right expectations rather than
assumptions.

## The authentication model

- **Passwords** are hashed with scrypt (`hashlib.scrypt`, from the standard
  library) with a per-user random salt. Plaintext passwords are never stored.
- **Sessions are signed tokens.** A successful login returns a token that is a
  base64url payload (user id, role, token version, expiry) signed with
  HMAC-SHA256 using a server secret, a minimal JWT-style scheme built on the
  standard library. Tampering invalidates the signature.
- **The browser never sees the token.** The web client gets it as an
  `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `KEEPSTACK_BASE_URL` is
  https), so injected script cannot read or exfiltrate it. Requests that change
  state with the cookie must carry `X-Requested-With: keepstack`, which a
  cross-site page cannot add (CSRF defence). Scripts and integrations can still
  send the token as `Authorization: Bearer`.
- **Revocation.** Changing a user's password bumps their token version and
  signs them out everywhere; disabling or deleting a user takes effect on their
  next request. Logging out clears the cookie.
- **The server secret** comes from `KEEPSTACK_SECRET_KEY`. If you do not set one, a
  random secret is generated and persisted so tokens survive a restart in
  development. **Set an explicit, long, random `KEEPSTACK_SECRET_KEY` in
  production.** Rotating it invalidates all existing tokens.

## Access control

Five roles (viewer, uploader, contributor, editor, admin) are enforced on the
server for every route, not just hidden in the UI. Files, thumbnails and
previews all require a signed-in user. OAI-PMH and IIIF do too, unless
`KEEPSTACK_PUBLIC_API=true` deliberately opens them (that also exposes every
image through IIIF). The role hierarchy lives in
`auth.py` and is applied through a `require_role` dependency in `app.py`. Every
state change is written to the audit log with the acting user and client IP.

## Share links

Public share links are unguessable tokens (`secrets.token_urlsafe`). Each link
can carry an expiry, a maximum download count, and a view-only-versus-download
permission, and can be revoked. A revoked or expired link, or one whose asset was
deleted, returns an error and serves nothing. Contributors see and revoke only
their own links; editors and admins manage all of them. The share page escapes
every catalog field it shows.

## Browser hardening and uploads

Every response carries a `Content-Security-Policy` (scripts only from the app
itself, no framing), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
and `Referrer-Policy: same-origin`. The interactive API docs are off unless
`KEEPSTACK_API_DOCS=true`.

Uploads are refused with 413 before the body is read when they exceed the limit
(3 GB by default, `KEEPSTACK_MAX_UPLOAD_MB`, changeable by an admin in the
dashboard), and accepted files are streamed to disk rather than held in memory.
Put the same limit on your reverse proxy.

## What is not hardened yet

Deploy behind a reverse proxy with TLS, and be aware of the current limits:

- Login is rate limited on two axes: after `KEEPSTACK_LOGIN_MAX_ATTEMPTS`
  failures (default 5) for one username and IP, and after
  `KEEPSTACK_LOGIN_MAX_ATTEMPTS_PER_IP` failures (default 20) from one IP across
  any usernames, further attempts return 429 with a `Retry-After` header for
  `KEEPSTACK_LOGIN_LOCKOUT_SECONDS` (default 300), and lockouts are audit-logged.
  The client IP is the direct peer address; `X-Forwarded-For` is trusted only
  when the peer is listed in `KEEPSTACK_TRUSTED_PROXIES` (comma-separated IPs or
  CIDRs), so a directly-connected client cannot spoof its address to dodge the
  limit. Set `KEEPSTACK_TRUSTED_PROXIES` when you run behind a reverse proxy.
  The counter is in-memory (and thread-safe within one process); for a
  multi-process deployment put a shared limiter in front as well. Share
  endpoints are not yet rate limited.
- Authentication is constant-time with respect to whether a username exists (the
  absent-user path still runs a scrypt hash), so response timing does not leak
  which usernames are valid.
- The default bootstrap admin is `admin` / `admin`. Change
  `KEEPSTACK_ADMIN_PASSWORD` before first run, or change the password immediately.
- Uploaded files are stored as-is and served only as downloads
  (`Content-Disposition: attachment`, `nosniff`). If you accept untrusted
  uploads, serving them from a separate origin is still the stronger option.
- There is no SSO, MFA, or account lockout yet. These are on the
  [roadmap](ROADMAP.md).

## Reporting a vulnerability

Please open a private security advisory on the repository rather than a public
issue, or contact the maintainer directly. A clear description and a reproduction
are enough to get started; there is no bounty program.
