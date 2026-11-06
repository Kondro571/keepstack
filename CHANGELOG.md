# Changelog

All notable changes to Keepstack are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
semantic versioning.

## [Unreleased]

### Security

- Files, thumbnails and previews now require a signed-in user; before, anyone
  with an asset UUID could load its full-resolution image. OAI-PMH (which listed
  every UUID) and IIIF require sign-in too, unless `KEEPSTACK_PUBLIC_API=true`.
- The web client keeps its session in an `HttpOnly`, `SameSite=Lax` cookie
  instead of `localStorage`, with a CSRF header check on state-changing
  requests. Bearer tokens still work for API clients. A password change revokes
  the user's existing sessions, and logout clears the cookie on the server.
- The public share page escaped nothing, so a title could run script on the
  app's origin; all fields are now escaped. Share links stop working when their
  asset is deleted, contributors manage only their own links, and new links are
  validated (existing asset, permission, expiry, download count).
- Security headers on every response (CSP, `nosniff`, `X-Frame-Options`,
  `Referrer-Policy`); `/docs` and `/openapi.json` are off unless
  `KEEPSTACK_API_DOCS=true`.
- Uploads are limited (3 GB by default, adjustable by an admin in the
  dashboard) and refused before the body is read; files are streamed to disk
  instead of read into memory, and ingest no longer blocks the server while it
  runs.

### Added

- Tag filter in the library: a "Filter tags" panel where each tag can be
  marked "must have" or "must not have" (with "all" or "any" of the wanted
  tags), applied with Filter. Active filters show as removable chips and live
  in the URL (`?tag=a&tag=b&not=c&match=any`); a sidebar tag adds a "must
  have" tag. The API takes repeated `tag` and `not_tag` plus `tag_match`.
- Sortable list columns: click Name, Type, Size, Dimensions or Added to sort,
  again to reverse. New sorts (`name_desc`, `smallest`, `type`, `type_desc`,
  `dims`, `dims_desc`) and `relevance`, which is the default while searching;
  any other sort now applies to search results too.
- Library list layout next to the grid: small thumbnail, title, file name,
  type, a preview of tags, size, dimensions and date. The choice is stored per
  user. Search results now include `tags` (up to 5) and `tag_count`.
- Multi-select with bulk actions: checkboxes on cards and rows, Shift for a
  range, Ctrl/Cmd-click, "Select page", and a selection that survives paging
  (it is cleared when the search or filters change). A bar offers add/remove
  tag, add to a (new) collection and delete, via `POST /api/assets/bulk`
  with the same role rules as the single-asset endpoints.

- User management: a real add/edit form with role cards, inline role change,
  disable/enable and delete (`DELETE /api/users/{id}`, `GET /api/roles`).
  New `uploader` role (browse and add files, no editing). The server validates
  usernames, emails, passwords (min. 8) and roles, and refuses to demote,
  disable or delete the last active admin or the acting admin themselves.
  The UI hides Upload, tag import and edit controls the role cannot use.

- Bulk tag import from CSV, XLSX, or XML (`POST /api/tags/import`, and an
  "Import tags" section in the upload dialog). Rows are matched to assets by
  file name or UUID, which covers formats like Illustrator `.ai` that carry no
  embedded keywords. See `docs/examples/tag-import.csv`. No new dependencies.
- Real thumbnails for `.ai`/`.eps`/`.indd`/`.pdf` files from the preview they
  embed (XMP JPEG or DOS EPS TIFF), instead of a generic placeholder.

- Parse common XMP RDF fields into structured metadata, catalog fields, and
  full-text search.
- OCR images at ingest through the Tesseract binary when it is installed, so
  text inside scans and photos becomes searchable. No new Python dependencies;
  disable with `KEEPSTACK_OCR_ENABLED=false`.
- On-device CLIP vision model (optional `pip install onnxruntime`): real
  semantic search over image content, visual similarity, and zero-shot
  auto-tagging with no API keys, plus a `python -m keepstack reindex` command
  to re-embed an existing catalog.
- Advertise IIIF Image API level 2 and support region cropping, percent
  regions, best-fit sizing, and rotation for IIIF image requests.
- Added `python -m keepstack gc` to remove blob files no longer referenced by
  active assets or their version history.

- IIIF Presentation API 3.0 manifest at `GET /iiif/3/{uuid}/manifest.json`, so
  viewers like Mirador and Universal Viewer open assets directly with their
  label and metadata.
- Login rate limiting: repeated failed attempts for a username and IP are
  locked out with a 429 and `Retry-After`, and the lockout is audit-logged.
  Tunable with `KEEPSTACK_LOGIN_MAX_ATTEMPTS` and `KEEPSTACK_LOGIN_LOCKOUT_SECONDS`.

### Changed

- Switched the web interface to a light theme: white and soft-gray surfaces
  with an indigo accent, applied across the app, placeholders, and share pages.
- Centered the captions in generated seed images so square thumbnails no
  longer crop them.
- Tidied the chrome: background scrolling now locks while the drawer or upload
  modal is open (one scrollbar instead of two), scrollbars are slim and themed,
  and the dropdown controls got a custom chevron with roomier padding.
- The library is paged (numbered pages, 10/50/100/500 per page) instead of
  showing only the first 120 assets, and deep pages stay fast via id-only
  paging and `(status, ...)` indexes. Sidebar facet counts are cached and
  refreshed when the catalog changes. Media type and Top tags groups can be
  collapsed; that choice and the page size are stored per user
  (`/api/auth/me/preferences`).
- Every view has its own URL (`/library`, `/collections`, `/dashboard`,
  `/users`, `/audit`), and the library's search, filters, page and page size
  live in the query string, so back/forward, refresh and shared links work.
- Split the single `web/app.js` into native ES modules under `web/js/`
  (`main.js` entry, plus router, library, asset drawer, upload, collections
  and admin), still with no build step. The web client is served with
  `Cache-Control: no-cache` so browsers pick up updates instead of reusing a
  stale script.

### Fixed

- Dialogs (upload, add/edit user) are capped to the screen height with a
  scrolling body, so after uploading many files the Close button no longer
  falls off-screen. The upload dialog shows a running "N of M processed"
  count, and Esc closes dialogs and the asset drawer. Reopening the upload
  dialog starts clean (unless an upload is still running), tag files can be
  dragged onto their own drop zone, and a file dropped beside a drop zone no
  longer opens in the tab.

- Filtering by tag or collection always returned nothing: the SQL parameters
  were bound in the wrong order.
- Keyword search took ~40 s on a 100k-asset catalog because SQLite probed the
  full-text index once per asset; it now resolves the match once (~30 ms).

## [0.1.0] - 2026-06-28

The first working release. A complete DAM core, built to sit in the gap between
standards-rich heritage tools and modern AI photo libraries.

### Added

- Content-addressable blob storage with automatic deduplication and SHA-256 fixity
- Ingest pipeline with EXIF / IPTC / XMP extraction and thumbnail generation
- Search: SQLite FTS5 full-text, faceted filtering, and embedding-based semantic
  search with a "more like this" mode
- Collections, tags (manual and AI-suggested), and per-asset version history
- Four-role access control (admin, editor, contributor, viewer), an audit log on
  every state change, and tokenised expiring share links
- Open standards: Dublin Core mapping, an OAI-PMH 2.0 endpoint, and an IIIF
  Image API endpoint for every asset
- A repository-wide fixity check for digital-preservation integrity
- Optional AI enrichment (Groq vision, Cohere embeddings) with deterministic
  offline fallbacks, so the product is fully useful with zero API keys
- A zero-build two-tone web client and a REST API covering every resource
- A passing test suite, synthetic seed data, and a Docker deployment

### Known limitations

Tracked in [ROADMAP.md](ROADMAP.md) and graded honestly in
[COMPARISON.md](COMPARISON.md): AI is heuristic without a provider key,
preservation is fixity rather than format migration, IIIF is level 1, and there
is no OCR, SSO, or published accessibility conformance report yet.
