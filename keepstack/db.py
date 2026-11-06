"""SQLite access layer and schema.

Keepstack uses a single SQLite database with WAL mode and FTS5 full-text
search. SQLite keeps the install dependency-free and makes the whole
repository a single portable file plus a blob directory: no external
database server to provision, back up, or secure.
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from typing import Iterator

from .config import config

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT,
    full_name     TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'viewer',
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    last_login    TEXT
);

-- Per-user UI state (e.g. which sidebar groups are collapsed), as JSON.
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id    INTEGER PRIMARY KEY,
    prefs_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assets (
    id                INTEGER PRIMARY KEY,
    uuid              TEXT UNIQUE NOT NULL,
    sha256            TEXT NOT NULL,
    filename          TEXT NOT NULL,
    original_filename TEXT,
    mime_type         TEXT,
    media_type        TEXT,
    ext               TEXT,
    size              INTEGER,
    width             INTEGER,
    height            INTEGER,
    duration          REAL,
    title             TEXT,
    description       TEXT,
    alt_text          TEXT,
    status            TEXT NOT NULL DEFAULT 'active',
    storage_key       TEXT NOT NULL,
    thumb_key         TEXT,
    license           TEXT,
    rights_statement  TEXT,
    credit            TEXT,
    usage_expiry      TEXT,
    retention_until   TEXT,
    dc_creator        TEXT,
    dc_subject        TEXT,
    dc_publisher      TEXT,
    dc_date           TEXT,
    uploaded_by       INTEGER,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    embedding         BLOB,
    FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_sha    ON assets (sha256);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets (status);
CREATE INDEX IF NOT EXISTS idx_assets_media  ON assets (media_type);
CREATE INDEX IF NOT EXISTS idx_assets_created ON assets (created_at);

CREATE TABLE IF NOT EXISTS asset_metadata (
    asset_id  INTEGER PRIMARY KEY,
    exif_json TEXT,
    iptc_json TEXT,
    xmp_json  TEXT,
    raw_json  TEXT,
    FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS custom_fields (
    id          INTEGER PRIMARY KEY,
    key         TEXT UNIQUE NOT NULL,
    label       TEXT NOT NULL,
    field_type  TEXT NOT NULL DEFAULT 'text',
    options_json TEXT,
    required    INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS asset_custom_values (
    asset_id INTEGER NOT NULL,
    field_id INTEGER NOT NULL,
    value    TEXT,
    PRIMARY KEY (asset_id, field_id),
    FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE CASCADE,
    FOREIGN KEY (field_id) REFERENCES custom_fields (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
    id       INTEGER PRIMARY KEY,
    name     TEXT UNIQUE NOT NULL,
    category TEXT
);

CREATE TABLE IF NOT EXISTS asset_tags (
    asset_id   INTEGER NOT NULL,
    tag_id     INTEGER NOT NULL,
    source     TEXT NOT NULL DEFAULT 'manual',
    confidence REAL,
    PRIMARY KEY (asset_id, tag_id),
    FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)   REFERENCES tags (id)   ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collections (
    id          INTEGER PRIMARY KEY,
    uuid        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    parent_id   INTEGER,
    kind        TEXT NOT NULL DEFAULT 'folder',
    query_json  TEXT,
    created_by  INTEGER,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES collections (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collection_assets (
    collection_id INTEGER NOT NULL,
    asset_id      INTEGER NOT NULL,
    added_at      TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, asset_id),
    FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id)      REFERENCES assets (id)      ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asset_versions (
    id          INTEGER PRIMARY KEY,
    asset_id    INTEGER NOT NULL,
    version_no  INTEGER NOT NULL,
    sha256      TEXT,
    storage_key TEXT,
    size        INTEGER,
    note        TEXT,
    created_by  INTEGER,
    created_at  TEXT,
    FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS share_links (
    id             INTEGER PRIMARY KEY,
    token          TEXT UNIQUE NOT NULL,
    target_type    TEXT NOT NULL,
    target_id      INTEGER NOT NULL,
    permission     TEXT NOT NULL DEFAULT 'view',
    expires_at     TEXT,
    max_downloads  INTEGER,
    download_count INTEGER NOT NULL DEFAULT 0,
    password_hash  TEXT,
    created_by     INTEGER,
    created_at     TEXT,
    revoked        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY,
    ts          TEXT NOT NULL,
    user_id     INTEGER,
    username    TEXT,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    detail      TEXT,
    ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts);

CREATE TABLE IF NOT EXISTS saved_searches (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER,
    name       TEXT,
    query_json TEXT,
    created_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS asset_fts USING fts5(
    title, description, alt_text, filename, tags, metadata_text, custom_text,
    tokenize = 'porter unicode61'
);
"""

_local = threading.local()


def get_conn() -> sqlite3.Connection:
    """One connection per thread (SQLite connections are not thread-safe)."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        config.ensure_dirs()
        conn = sqlite3.connect(config.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
        _local.conn = conn
    return conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def init_db() -> None:
    """Create the schema if it does not exist. Idempotent."""
    config.ensure_dirs()
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()
