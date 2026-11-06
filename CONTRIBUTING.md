# Contributing to Keepstack

Keepstack is small on purpose, so getting from clone to a running, tested change is
quick. This guide is also a decent map of the codebase if you just want to read.

## Set up and run

```bash
git clone <your-fork-url>
cd keepstack
python -m pip install -r requirements.txt
python -m keepstack seed      # optional: synthetic demo catalog
python -m keepstack           # http://localhost:8000, sign in admin / admin
```

You need Python 3.10 or newer. There is no frontend build step: the web client
in `web/` is plain HTML, CSS, and JavaScript served by the app.

## Run the tests

```bash
python -m pip install pytest
python -m pytest -q
```

The suite runs against a throwaway data directory, so it never touches a real
repository. If you change ingest, storage, search, auth, or the standards
output, add or update a test in `tests/test_core.py`.

## Where things live

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full picture. The short version:

| You want to change | Look in |
|--------------------|---------|
| The upload flow | `keepstack/ingest.py` |
| Storage, dedup, or fixity | `keepstack/storage.py` |
| Metadata extraction | `keepstack/metadata.py` |
| Search behavior | `keepstack/search.py` |
| AI tagging or embeddings | `keepstack/ai.py` |
| Dublin Core, OAI-PMH, or IIIF | `keepstack/standards.py` |
| Auth, roles, or tokens | `keepstack/auth.py` |
| API routes | `keepstack/app.py` |
| The web UI | `web/index.html`, `web/styles.css`, `web/js/` (ES modules; `main.js` is the entry and lists the rest) |
| UI text and translations | `web/js/i18n.js`: add every new string in English and Polish, use `t("key")` in scripts and `data-i18n="key"` in markup |
| Tag names, labels and translations | `keepstack/vocab.py` (create tags through `vocab.ensure_tag` so labels resolve), `web/js/tags.js` (display) |
| The database schema | `keepstack/db.py` |

## Adding a feature, the short path

1. If it is an architectural choice, add a short record in
   [docs/decisions/](docs/decisions/) explaining the tradeoff.
2. Make the change, keeping the module boundaries above.
3. Add a test that would fail without your change.
4. If it touches the UI, capture a screenshot into `docs/screenshots/`.
5. Update [CHANGELOG.md](CHANGELOG.md) under an "Unreleased" heading.

## Style

- Match the surrounding code. Modules are small and single-purpose; keep them
  that way rather than growing a catch-all.
- Prefer the standard library. New runtime dependencies need a good reason,
  since the four-dependency footprint is a feature (see
  [ADR-0001](docs/decisions/ADR-0001-sqlite-over-a-database-server.md)).
- In docs and comments, write plainly and skip the em dash.

## Good first issues

Look for the `good first issue` label. The [roadmap](ROADMAP.md) also lists
self-contained items (local OCR, IIIF level 2, XMP parsing) that make good
starting points.
