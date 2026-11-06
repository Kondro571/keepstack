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
from typing import Iterable, Optional

from . import ai, vocab
from .db import get_conn

# Each sort ends on the row id so pages are stable when values tie. Date, name,
# size and type are backed by (status, column) indexes in db.py; dimensions
# sort in memory (width x height has no index), still fine at 100k rows.
SORTS = {
    "newest": "a.created_at DESC, a.id DESC",
    "oldest": "a.created_at ASC, a.id ASC",
    "name": "a.title COLLATE NOCASE ASC, a.id ASC",
    "name_desc": "a.title COLLATE NOCASE DESC, a.id DESC",
    "largest": "a.size DESC, a.id DESC",
    "smallest": "a.size ASC, a.id ASC",
    "type": "a.media_type ASC, a.ext ASC, a.id ASC",
    "type_desc": "a.media_type DESC, a.ext DESC, a.id DESC",
    "dims_desc": "COALESCE(a.width * a.height, 0) DESC, a.id DESC",
    "dims": "COALESCE(a.width * a.height, 0) ASC, a.id ASC",
}
# "relevance" orders full-text matches by rank; without a query it means newest.
DEFAULT_SORT = "relevance"
TAG_MATCHES = ("all", "any")
_TAGGED = ("SELECT at.asset_id FROM asset_tags at JOIN tags t ON t.id = at.tag_id "
           "WHERE t.name IN ({marks})")


def _clean_tags(tags: Optional[Iterable[str]]) -> list[str]:
    out = []
    for t in tags or ():
        t = (t or "").strip().lower()
        if t and t not in out:
            out.append(t)
    return out

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
    """Turn user text into a safe FTS5 prefix query. A term that starts a tag
    label in any language also matches that tag's name, so "pies" finds
    files tagged "dog" without the label being in the index."""
    terms = [t for t in "".join(c if c.isalnum() or c.isspace() else " " for c in q).split() if t]
    parts = []
    for t in terms:
        alts = [f'"{t}"*'] + ['"' + name.replace('"', '""') + '"' for name in vocab.expand_term(t)]
        parts.append(alts[0] if len(alts) == 1 else "(" + " OR ".join(alts) + ")")
    return " ".join(parts)


def search(
    *,
    q: str = "",
    media_type: Optional[str] = None,
    tag: Optional[str] = None,
    tags: Optional[Iterable[str]] = None,
    not_tags: Optional[Iterable[str]] = None,
    tag_match: str = "all",
    collection_id: Optional[int] = None,
    status: str = "active",
    sort: str = DEFAULT_SORT,
    mode: str = "keyword",
    limit: int = 60,
    offset: int = 0,
) -> dict:
    """``tags`` must be on an asset (all of them, or any with
    ``tag_match="any"``) and ``not_tags`` must not; ``tag`` is one more
    required tag, kept for older callers."""
    conn = get_conn()
    # filters take tag names, or labels such as "pies" for "dog"
    include = _clean_tags(vocab.resolve(conn, t) for t in [*(tags or ()), *([tag] if tag else [])])
    exclude = _clean_tags(vocab.resolve(conn, t) for t in not_tags or ())

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
    if include:
        sub = _TAGGED.format(marks=",".join("?" * len(include)))
        if tag_match == "any" or len(include) == 1:
            where.append(f"a.id IN ({sub})")
            params.extend(include)
        else:
            where.append(f"a.id IN ({sub} GROUP BY at.asset_id HAVING COUNT(DISTINCT t.id) = ?)")
            params.extend([*include, len(include)])
    if exclude:
        where.append(f"a.id NOT IN ({_TAGGED.format(marks=','.join('?' * len(exclude)))})")
        params.extend(exclude)
    if collection_id:
        where.append("a.id IN (SELECT asset_id FROM collection_assets WHERE collection_id = ?)")
        params.append(collection_id)

    where_sql = " AND ".join(where)
    order = "m.rank, a.id" if fts and sort not in SORTS else SORTS.get(sort, SORTS["newest"])

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
        "items": _attach_tags([_card(dict(rows[i])) for i in ids if i in rows]),
        "facets": _facets(status),
        "mode": mode,
    }


def _attach_tags(items: list[dict], per_item: int = 5) -> list[dict]:
    """Add a short tag preview (``tags``) and the full ``tag_count`` to each
    card, in one query for the whole page. Hand-added tags come first."""
    if not items:
        return items
    ids = [i["id"] for i in items]
    marks = ",".join("?" * len(ids))
    names: dict[int, list[str]] = {i: [] for i in ids}
    for r in get_conn().execute(
        f"""SELECT at.asset_id, t.name FROM asset_tags at JOIN tags t ON t.id = at.tag_id
            WHERE at.asset_id IN ({marks})
            ORDER BY at.asset_id,
                     CASE at.source WHEN 'manual' THEN 0 WHEN 'import' THEN 1
                                    WHEN 'embedded' THEN 2 ELSE 3 END, t.name""", ids):
        names[r["asset_id"]].append(r["name"])
    for item in items:
        item["tags"] = names[item["id"]][:per_item]
        item["tag_count"] = len(names[item["id"]])
    return items


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
    return {"total": len(scored), "items": _attach_tags(items), "facets": _facets(status), "mode": "semantic"}


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
