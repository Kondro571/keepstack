# Architecture

Keepstack is a single Python package that serves both a REST API and a zero-build
web client. It is deliberately small: one process, one SQLite database, one blob
directory, four runtime dependencies. This document explains how the pieces fit,
with diagrams that render directly on GitHub.

For the reasoning behind the big choices, see the decision records in
[docs/decisions/](docs/decisions/).

## System at a glance

```mermaid
flowchart LR
  subgraph client [Web client]
    UI["Zero-build SPA<br/>(HTML / CSS / vanilla JS)"]
  end
  subgraph server [Keepstack process - FastAPI + Uvicorn]
    API["REST API<br/>app.py"]
    ING["Ingest pipeline<br/>ingest.py"]
    SRCH["Search<br/>search.py"]
    STD["Standards<br/>Dublin Core / OAI-PMH / IIIF"]
    AUTH["Auth + RBAC + audit"]
    AI["AI enrichment<br/>(optional)"]
  end
  subgraph store [Local data dir]
    DB[("SQLite + FTS5<br/>catalog")]
    BLOB[["Content-addressable<br/>blob store (SHA-256)"]]
    THUMB[["Thumbnail /<br/>rendition cache"]]
  end
  ext["Optional providers<br/>Groq (vision) / Cohere (embed)"]

  UI -->|HTTP| API
  API --> ING & SRCH & STD & AUTH
  ING --> AI
  AI -. "only if key set" .-> ext
  ING --> DB & BLOB & THUMB
  SRCH --> DB
  STD --> DB
  API --> BLOB & THUMB
```

Everything inside the server is stdlib except FastAPI/Uvicorn (HTTP) and Pillow
(images). No message queue, no cache server, no external database.

## Module responsibilities

| Module | Responsibility |
|--------|----------------|
| `config.py` | Environment-driven settings with safe local defaults |
| `db.py` | SQLite connection, schema, and the FTS5 full-text index |
| `storage.py` | Content-addressable blob store: dedup, fixity, retrieval |
| `metadata.py` | EXIF / IPTC / XMP extraction and descriptive-field seeding |
| `thumbnails.py` | Thumbnails and on-the-fly resized renditions (cached) |
| `ai.py` | Optional enrichment: tagging, captions, embeddings, with local fallbacks |
| `ingest.py` | The upload pipeline that ties storage, metadata, AI, and indexing together |
| `search.py` | Keyword (FTS5), faceted, and semantic (embedding) search |
| `auth.py` | scrypt passwords, stateless HMAC tokens, role hierarchy |
| `audit.py` | Append-only audit logging |
| `standards.py` | Dublin Core, OAI-PMH 2.0, IIIF Image API |
| `app.py` | FastAPI routes for every resource, and the static client mount |

## Data model

```mermaid
erDiagram
  users ||--o{ assets : uploads
  assets ||--|| asset_metadata : has
  assets ||--o{ asset_tags : tagged
  tags ||--o{ asset_tags : applied
  assets ||--o{ asset_versions : versioned
  collections ||--o{ collection_assets : groups
  assets ||--o{ collection_assets : "in"
  assets ||--o{ asset_custom_values : "custom fields"
  custom_fields ||--o{ asset_custom_values : defines
  assets ||--o{ share_links : shared
  users ||--o{ audit_log : acts

  assets {
    int id PK
    string uuid
    string sha256
    string media_type
    string title
    string status
    string storage_key
    blob embedding
    string retention_until
  }
  asset_metadata {
    int asset_id PK
    string exif_json
    string iptc_json
    string xmp_json
  }
  share_links {
    string token
    string expires_at
    int max_downloads
  }
```

An `asset_fts` FTS5 virtual table mirrors the searchable text (title,
description, tags, metadata) and is kept in sync by the ingest pipeline.

## The ingest pipeline

The most important flow in the system. One function, `ingest_stream`, runs the
full intake so an asset is findable the moment it lands.

```mermaid
sequenceDiagram
  participant U as Client
  participant A as app.py
  participant I as ingest.py
  participant S as storage.py
  participant M as metadata.py
  participant AI as ai.py
  participant DB as SQLite

  U->>A: POST /api/assets (file)
  A->>I: ingest_stream(bytes, filename)
  I->>S: store_stream -> sha256, key
  alt identical sha already exists
    S-->>I: existing blob
    I-->>A: duplicate (deduped)
  else new content
    I->>M: extract EXIF / IPTC / XMP + dimensions
    I->>S: generate thumbnail
    I->>DB: insert asset + metadata + seeded tags
    opt image and AI enabled
      I->>AI: enrich (tags, alt-text, caption)
    end
    I->>DB: rebuild FTS row + embedding
    I-->>A: created asset
  end
  A-->>U: 201 with asset summary
```

## Request and auth flow

```mermaid
flowchart TD
  R["Incoming request"] --> H{"Bearer token or<br/>session cookie?"}
  H -->|no| P{"Public route?<br/>(share link, health,<br/>OAI/IIIF if public)"}
  P -->|yes| OK["Serve"]
  P -->|no| E401["401"]
  H -->|cookie, mutating| C{"X-Requested-With<br/>header?"}
  C -->|no| E403
  C -->|yes| V
  H -->|bearer, or cookie on GET| V{"HMAC valid, not expired,<br/>token version current?"}
  V -->|no| E401
  V -->|yes| ROLE{"Role high enough<br/>for this route?"}
  ROLE -->|no| E403["403"]
  ROLE -->|yes| AUD["Log to audit trail<br/>(on mutations)"] --> OK
```

Tokens are HMAC payloads signed with a server secret (a minimal JWT-style
scheme on the standard library), so there is no session store and no crypto
dependency. The browser keeps its token in an HttpOnly cookie; API clients send
it as `Authorization: Bearer`. Each token carries the user's `token_version`,
and a password change bumps it, which revokes every earlier token.

## Why it is shaped this way

- **One process, one file.** SQLite plus a blob directory means the entire
  repository is portable and needs no separate database to run or back up. See
  [ADR-0001](docs/decisions/ADR-0001-sqlite-over-a-database-server.md).
- **Hash-keyed storage.** Deduplication and preservation fixity are the same
  mechanism. See [ADR-0002](docs/decisions/ADR-0002-content-addressable-storage.md).
- **Optional AI, never required.** The pipeline calls a provider only if a key
  is set, and falls back to deterministic local logic otherwise. See
  [ADR-0004](docs/decisions/ADR-0004-optional-offline-ai.md).

## Scaling notes and current limits

Honest boundaries of the current design:

- SQLite in WAL mode handles the read-heavy, modest-write profile of a
  self-hosted DAM well into the hundreds of thousands of assets. Very high
  write concurrency would eventually want Postgres, which the storage and query
  layers are structured to allow later.
- Semantic search currently loads candidate embeddings and ranks in Python.
  That is fine for tens of thousands of assets; beyond that it wants an ANN
  index (for example sqlite-vec or a pgvector backend). Tracked in
  [ROADMAP.md](ROADMAP.md).
- Thumbnailing is synchronous in the request for now. Large video and document
  rendering would move to a background worker.
