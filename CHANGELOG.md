# Changelog

All notable changes to Keepstack are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
semantic versioning.

## [Unreleased]

### Added

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
