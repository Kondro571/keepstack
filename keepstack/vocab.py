"""Tag vocabulary: one canonical name per tag plus optional per-language labels.

A tag keeps a single name (what filters, URLs and the API use), and
``tag_translations`` adds a label per interface language, e.g. ``dog`` with
the Polish label ``pies``. The labels are used in three places:

  * display - the client fetches ``labels(lang)`` once and shows ``pies``
  * search  - a query term that matches a label also matches the tag name,
              resolved at query time, so nothing is reindexed when a label
              changes (see ``expand_term``)
  * input   - typing a label when tagging resolves to the existing tag
              (``resolve``), so ``pies`` never becomes a second tag

Labels are stored lowercase, like tag names.
"""
from __future__ import annotations

from typing import Optional

from .audit import now_iso
from .db import get_conn

TAG_LANGS = ("en", "pl")
LABEL_MAX = 100
EXPAND_LIMIT = 20  # tag names one search term may expand to


def clean(name: Optional[str]) -> str:
    return (name or "").strip().lower()


def resolve(conn, name: str) -> str:
    """The canonical tag name for ``name``: the tag itself when it exists,
    else the tag that has ``name`` as a label (the most used one), else
    ``name`` unchanged (a new tag)."""
    name = clean(name)
    if not name or conn.execute("SELECT 1 FROM tags WHERE name = ?", (name,)).fetchone():
        return name
    row = conn.execute(
        "SELECT t.name FROM tag_translations tt JOIN tags t ON t.id = tt.tag_id "
        "WHERE tt.label = ? ORDER BY (SELECT COUNT(*) FROM asset_tags at WHERE at.tag_id = t.id) DESC "
        "LIMIT 1", (name,)).fetchone()
    return row["name"] if row else name


def ensure_tag(conn, name: str) -> Optional[int]:
    """Id of the tag ``name`` refers to, creating it if needed."""
    name = resolve(conn, name)
    if not name:
        return None
    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
    return conn.execute("SELECT id FROM tags WHERE name = ?", (name,)).fetchone()["id"]


def expand_term(term: str) -> list[str]:
    """Tag names whose label (any language) starts with ``term``. An indexed
    range scan on the label, so it stays cheap however large the catalog."""
    term = clean(term)
    if not term:
        return []
    return [r["name"] for r in get_conn().execute(
        "SELECT DISTINCT t.name FROM tag_translations tt JOIN tags t ON t.id = tt.tag_id "
        "WHERE tt.label >= ? AND tt.label < ? LIMIT ?",
        (term, term + "￿", EXPAND_LIMIT))]


def labels(lang: str) -> dict[str, str]:
    """``{tag name: label}`` for every tag translated into ``lang``."""
    if lang not in TAG_LANGS:
        return {}
    return {r["name"]: r["label"] for r in get_conn().execute(
        "SELECT t.name, tt.label FROM tag_translations tt JOIN tags t ON t.id = tt.tag_id "
        "WHERE tt.lang = ?", (lang,))}


def listing(q: str = "", missing: Optional[str] = None, limit: int = 100, offset: int = 0) -> dict:
    """Tags with their usage count and labels, for the translation screen.
    ``q`` matches the name or any label; ``missing`` keeps only tags without
    a label in that language."""
    conn = get_conn()
    where, params = ["1 = 1"], []
    if q.strip():
        like = f"%{clean(q)}%"
        where.append("(t.name LIKE ? OR EXISTS (SELECT 1 FROM tag_translations x "
                     "WHERE x.tag_id = t.id AND x.label LIKE ?))")
        params += [like, like]
    if missing in TAG_LANGS:
        where.append("NOT EXISTS (SELECT 1 FROM tag_translations x WHERE x.tag_id = t.id AND x.lang = ?)")
        params.append(missing)
    where_sql = " AND ".join(where)
    total = conn.execute(f"SELECT COUNT(*) c FROM tags t WHERE {where_sql}", params).fetchone()["c"]
    # One grouped pass over asset_tags; a per-tag subquery here took ~47 s on
    # 100k assets / 500k tag links.
    rows = [dict(r) for r in conn.execute(
        f"""SELECT t.id, t.name, COALESCE(n.c, 0) AS count
            FROM tags t
            LEFT JOIN (SELECT at.tag_id, COUNT(*) AS c FROM asset_tags at
                       JOIN assets a ON a.id = at.asset_id AND a.status = 'active'
                       GROUP BY at.tag_id) n ON n.tag_id = t.id
            WHERE {where_sql}
            ORDER BY count DESC, t.name LIMIT ? OFFSET ?""", [*params, limit, offset])]
    if rows:
        marks = ",".join("?" * len(rows))
        found: dict[int, dict] = {r["id"]: {} for r in rows}
        for tr in conn.execute(f"SELECT tag_id, lang, label, source FROM tag_translations "
                               f"WHERE tag_id IN ({marks})", [r["id"] for r in rows]):
            found[tr["tag_id"]][tr["lang"]] = {"label": tr["label"], "source": tr["source"]}
        for r in rows:
            r["translations"] = found[r["id"]]
    return {"total": total, "items": rows}


class LabelConflict(ValueError):
    pass


def set_label(conn, tag_id: int, lang: str, label: str, source: str = "manual") -> Optional[str]:
    """Set (or with an empty ``label``, remove) a tag's label in ``lang``.
    Returns the stored label. A label must not be another tag's name or
    label, or typing it could not be resolved to one tag."""
    label = clean(label)[:LABEL_MAX]
    name = conn.execute("SELECT name FROM tags WHERE id = ?", (tag_id,)).fetchone()["name"]
    if not label or label == name:
        conn.execute("DELETE FROM tag_translations WHERE tag_id = ? AND lang = ?", (tag_id, lang))
        return None
    other = conn.execute("SELECT name FROM tags WHERE name = ? AND id != ?", (label, tag_id)).fetchone()
    if not other:
        other = conn.execute(
            "SELECT t.name FROM tag_translations tt JOIN tags t ON t.id = tt.tag_id "
            "WHERE tt.label = ? AND tt.tag_id != ?", (label, tag_id)).fetchone()
    if other:
        raise LabelConflict(f'"{label}" is already used by the tag "{other["name"]}"')
    conn.execute(
        "INSERT INTO tag_translations (tag_id, lang, label, source, updated_at) VALUES (?,?,?,?,?) "
        "ON CONFLICT(tag_id, lang) DO UPDATE SET label = excluded.label, source = excluded.source, "
        "updated_at = excluded.updated_at", (tag_id, lang, label, source, now_iso()))
    return label
