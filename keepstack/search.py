"""Search and discovery.

Three complementary modes over one catalog:

  * keyword  - FTS5 full-text across title, description, tags, metadata
  * filter   - faceted structured filters (media type, tag, status, dates)
  * semantic - embedding cosine ranking ("natural language" / more-like-this)

Facet counts are returned alongside results so the UI can render a live,
drill-down sidebar.
"""
from __future__ import annotations

import threading
import time
from typing import Optional

from . import ai
from .db import get_conn

# Each sort ends on the row id so pages are stable when values tie, and each
# is backed by a (status, column) index in db.py.
SORTS = {
    "newest": "a.created_at DESC, a.id DESC",
    "oldest": "a.created_at ASC, a.id ASC",
    "name": "a.title ASC, a.id ASC",
    "largest": "a.size DESC, a.id DESC",
}

# Columns needed for a grid card; never the embedding blob.
_CARD_COLS = ("id, uuid, title, filename, media_type, mime_type, ext, size, width, height, "
              "alt_text, status, created_at")

FACETS_TTL = 60.0
_facet_cache: dict[str, tuple[float, dict]] = {}
_facet_lock = threading.Lock()


def invalidate_facets() -> None:
    """Drop cached sidebar counts; call after the catalog changes."""
    with _facet_lock:
        _facet_cache.clear()


def _fts_query(q: str) -> str:
    """Turn user text into a safe FTS5 prefix query."""
    terms = [t for t in "".join(c if c.isalnum() or c.isspace() else " " for c in q).split() if t]
    return " ".join(f'"{t}"*' for t in terms)


def search(
    *,
    q: str = "",
    media_type: Optional[str] = None,
    tag: Optional[str] = None,
    collection_id: Optional[int] = None,
    status: str = "active",
    sort: str = "newest",
    mode: str = "keyword",
    limit: int = 60,
    offset: int = 0,
) -> dict:
    conn = get_conn()

    # Semantic mode ranks the candidate pool by embedding similarity.
    if mode == "semantic" and q.strip():
        return _semantic_search(q, media_type, status, limit, offset)

    # Every filter lives in WHERE so placeholders and params stay in order.
    where = ["a.status = ?"]
    params: list = [status]
    source = "assets a"
    fts = _fts_query(q) if q.strip() else ""

    if fts:
        # Resolve the full-text match first (one index lookup), then join.
        # Otherwise SQLite may walk every asset and probe the FTS index once
        # per row, which took ~40 s for a COUNT on a 100k catalog. "LIMIT -1"
        # (no limit) stops the planner flattening the subquery into that plan.
        source = ("(SELECT rowid AS id, bm25(asset_fts) AS rank FROM asset_fts "
                  "WHERE asset_fts MATCH ? LIMIT -1) m JOIN assets a ON a.id = m.id")
        params.insert(0, fts)
    if media_type:
        where.append("a.media_type = ?")
        params.append(media_type)
    if tag:
        where.append("a.id IN (SELECT at.asset_id FROM asset_tags at "
                     "JOIN tags t ON t.id = at.tag_id WHERE t.name = ?)")
        params.append(tag.lower())
    if collection_id:
        where.append("a.id IN (SELECT asset_id FROM collection_assets WHERE collection_id = ?)")
        params.append(collection_id)

    where_sql = " AND ".join(where)
    order = "m.rank, a.id" if fts else SORTS.get(sort, SORTS["newest"])

    total = conn.execute(
        f"SELECT COUNT(*) AS c FROM {source} WHERE {where_sql}", params
    ).fetchone()["c"]

    # Page over ids only (served from the index), then load just those rows,
    # so deep pages don't drag every skipped row through memory.
    ids = [r["id"] for r in conn.execute(
        f"SELECT a.id FROM {source} WHERE {where_sql} ORDER BY {order} LIMIT ? OFFSET ?",
        [*params, limit, offset],
    )]
    rows = {}
    if ids:
        marks = ",".join("?" * len(ids))
        rows = {r["id"]: r for r in conn.execute(
            f"SELECT {_CARD_COLS} FROM assets WHERE id IN ({marks})", ids)}

    return {
        "total": total,
        "items": [_card(dict(rows[i])) for i in ids if i in rows],
        "facets": _facets(status),
        "mode": mode,
    }


def _semantic_search(q, media_type, status, limit, offset) -> dict:
    conn = get_conn()
    qvec = ai.embed(q)
    where = ["status = ?", "embedding IS NOT NULL"]
    params: list = [status]
    if media_type:
        where.append("media_type = ?")
        params.append(media_type)
    rows = conn.execute(
        f"SELECT * FROM assets WHERE {' AND '.join(where)}", params
    ).fetchall()
    scored = []
    for r in rows:
        score = ai.cosine(qvec, ai.unpack_embedding(r["embedding"]))
        scored.append((score, r))
    scored.sort(key=lambda x: x[0], reverse=True)
    page = scored[offset:offset + limit]
    items = []
    for score, r in page:
        card = _card(dict(r))
        card["score"] = round(score, 4)
        items.append(card)
    return {"total": len(scored), "items": items, "facets": _facets(status), "mode": "semantic"}


def more_like(asset_id: int, limit: int = 12) -> list[dict]:
    conn = get_conn()
    base = conn.execute("SELECT embedding FROM assets WHERE id = ?", (asset_id,)).fetchone()
    if not base or not base["embedding"]:
        return []
    bvec = ai.unpack_embedding(base["embedding"])
    rows = conn.execute(
        "SELECT * FROM assets WHERE id != ? AND status = 'active' AND embedding IS NOT NULL",
        (asset_id,),
    ).fetchall()
    scored = [(ai.cosine(bvec, ai.unpack_embedding(r["embedding"])), r) for r in rows]
    scored.sort(key=lambda x: x[0], reverse=True)
    out = []
    for score, r in scored[:limit]:
        card = _card(dict(r))
        card["score"] = round(score, 4)
        out.append(card)
    return out


def _facets(status: str) -> dict:
    """Sidebar counts, cached because they scan the whole catalog."""
    with _facet_lock:
        hit = _facet_cache.get(status)
    if hit and time.monotonic() - hit[0] < FACETS_TTL:
        return hit[1]
    data = _compute_facets(status)
    with _facet_lock:
        _facet_cache[status] = (time.monotonic(), data)
    return data


def _compute_facets(status: str) -> dict:
    conn = get_conn()
    media = conn.execute(
        "SELECT media_type, COUNT(*) c FROM assets WHERE status = ? GROUP BY media_type ORDER BY c DESC",
        (status,),
    ).fetchall()
    tags = conn.execute(
        """SELECT t.name, COUNT(*) c FROM tags t
           JOIN asset_tags at ON at.tag_id = t.id
           JOIN assets a ON a.id = at.asset_id AND a.status = ?
           GROUP BY t.name ORDER BY c DESC LIMIT 25""",
        (status,),
    ).fetchall()
    return {
        "media_types": [{"value": r["media_type"], "count": r["c"]} for r in media],
        "tags": [{"value": r["name"], "count": r["c"]} for r in tags],
    }


def _card(a: dict) -> dict:
    """Compact asset representation for grid/list views."""
    return {
        "id": a["id"],
        "uuid": a["uuid"],
        "title": a["title"],
        "filename": a["filename"],
        "media_type": a["media_type"],
        "mime_type": a["mime_type"],
        "ext": a["ext"],
        "size": a["size"],
        "width": a["width"],
        "height": a["height"],
        "alt_text": a["alt_text"],
        "status": a["status"],
        "created_at": a["created_at"],
    }
