"""Bulk tag import from CSV, XML, or XLSX.

Formats like Illustrator's .ai often carry no embedded keywords, so tags for
them usually live in a spreadsheet. Every format reduces to the same shape:
one entry per file, identified by file name or asset UUID, plus its tags.

  * CSV / XLSX - first column is the file name (or UUID), the remaining
    columns hold tags. A cell may hold several tags separated by ``;``,
    ``,`` or ``|``. An optional header row is detected and skipped; if it
    names a ``tags``/``keywords`` column, other named columns (e.g. a title)
    are ignored.
  * XML - any element with a ``filename``/``file``/``uuid`` attribute or
    child, tagged by ``<tag>``/``<keyword>`` children or a ``tags`` attribute
    or child, e.g. ``<asset filename="logo.ai"><tag>vector</tag></asset>``.

Only the standard library is used (XLSX is a zip of XML), keeping the
dependency surface unchanged.
"""
from __future__ import annotations

import csv
import io
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import PurePath

from . import ingest
from .db import get_conn, transaction

SOURCE = "import"
MAX_XLSX_PART = 50 * 1024 * 1024   # guard against zip bombs

_ID_HEADERS = {"filename", "file", "file name", "file_name", "name", "uuid", "asset",
               "plik", "nazwa", "nazwa pliku"}
_TAG_HEADERS = {"tags", "tag", "keywords", "keyword", "tagi", "słowa kluczowe"}
_SPLIT = re.compile(r"[;,|]")

Entry = tuple[str, list[str]]


def _split_tags(values) -> list[str]:
    out = []
    for v in values:
        out += [t.strip() for t in _SPLIT.split(v or "") if t.strip()]
    return out


def _rows_to_entries(rows: list[list[str]]) -> list[Entry]:
    rows = [[(c or "").strip() for c in r] for r in rows if any((c or "").strip() for c in r)]
    if not rows:
        return []
    id_col, tag_cols = 0, None
    header = [c.lower() for c in rows[0]]
    if any(h in _ID_HEADERS or h in _TAG_HEADERS for h in header):
        rows = rows[1:]
        id_col = next((i for i, h in enumerate(header) if h in _ID_HEADERS), 0)
        # A named tags column also claims the header-less columns, so a row
        # can spill extra tags to the right of it.
        if any(h in _TAG_HEADERS for h in header):
            width = max(len(r) for r in rows) if rows else 0
            tag_cols = [i for i in range(max(width, len(header))) if i != id_col
                        and (i >= len(header) or header[i] in _TAG_HEADERS or not header[i])]
    entries = []
    for r in rows:
        if id_col >= len(r) or not r[id_col]:
            continue
        cols = tag_cols if tag_cols is not None else [i for i in range(len(r)) if i != id_col]
        entries.append((r[id_col], _split_tags(r[i] for i in cols if i < len(r))))
    return entries


def _decode(data: bytes) -> str:
    # Excel on Windows saves CSV in the local code page rather than UTF-8.
    for enc in ("utf-8-sig", "cp1250", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace")


def parse_csv(data: bytes) -> list[Entry]:
    text = _decode(data)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return _rows_to_entries(list(csv.reader(io.StringIO(text), dialect)))


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def parse_xml(data: bytes) -> list[Entry]:
    root = ET.fromstring(data)
    entries = []
    for el in root.iter():
        attrs = {_local(k): v for k, v in el.attrib.items()}
        children = {}
        for child in el:
            children.setdefault(_local(child.tag), []).append((child.text or "").strip())
        ident = next((attrs.get(k) or (children.get(k) or [""])[0]
                      for k in ("filename", "file", "uuid") if attrs.get(k) or children.get(k)), "")
        if not ident:
            continue
        tags = children.get("tag", []) + children.get("keyword", [])
        tags += [attrs.get("tags", ""), attrs.get("keywords", "")]
        tags += children.get("tags", []) + children.get("keywords", [])
        entries.append((ident.strip(), _split_tags(tags)))
    return entries


def _read_part(z: zipfile.ZipFile, name: str) -> bytes:
    info = z.getinfo(name)
    if info.file_size > MAX_XLSX_PART:
        raise ValueError(f"{name} is too large")
    return z.read(name)


def _col_index(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def parse_xlsx(data: bytes) -> list[Entry]:
    """Read the first worksheet of an .xlsx workbook."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = set(z.namelist())
        shared = []
        if "xl/sharedStrings.xml" in names:
            for si in ET.fromstring(_read_part(z, "xl/sharedStrings.xml")):
                shared.append("".join(t.text or "" for t in si.iter() if _local(t.tag) == "t"))
        workbook = ET.fromstring(_read_part(z, "xl/workbook.xml"))
        first = next(el for el in workbook.iter() if _local(el.tag) == "sheet")
        rel_id = next(v for k, v in first.attrib.items() if _local(k) == "id")
        rels = ET.fromstring(_read_part(z, "xl/_rels/workbook.xml.rels"))
        target = next(r.get("Target") for r in rels if r.get("Id") == rel_id)
        sheet_path = target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target)
        sheet = ET.fromstring(_read_part(z, posixpath.normpath(sheet_path)))

    rows = []
    for row in (el for el in sheet.iter() if _local(el.tag) == "row"):
        cells: dict[int, str] = {}
        for i, c in enumerate(el for el in row if _local(el.tag) == "c"):
            col = _col_index(c.get("r")) if c.get("r") else i
            kind = c.get("t")
            if kind == "inlineStr":
                value = "".join(t.text or "" for t in c.iter() if _local(t.tag) == "t")
            else:
                v = next((el.text for el in c if _local(el.tag) == "v"), None) or ""
                value = shared[int(v)] if kind == "s" and v else v
            cells[col] = value
        if cells:
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return _rows_to_entries(rows)


def parse(data: bytes, filename: str) -> list[Entry]:
    ext = PurePath(filename).suffix.lower()
    if ext == ".csv" or ext == ".txt":
        return parse_csv(data)
    if ext == ".xml":
        return parse_xml(data)
    if ext == ".xlsx":
        return parse_xlsx(data)
    raise ValueError("Unsupported file type; use .csv, .xml or .xlsx")


def apply(entries: list[Entry]) -> dict:
    """Attach tags to matching active assets. Matches on UUID, then on file
    name (case-insensitive, any folder path in the sheet is ignored)."""
    conn = get_conn()
    touched: set[int] = set()
    unmatched: list[str] = []
    links_before = conn.execute("SELECT COUNT(*) c FROM asset_tags").fetchone()["c"]
    with transaction() as conn:
        for ident, tags in entries:
            name = PurePath(ident.replace("\\", "/")).name
            ids = [r["id"] for r in conn.execute(
                "SELECT id FROM assets WHERE status = 'active' AND (uuid = ? "
                "OR lower(filename) = lower(?) OR lower(original_filename) = lower(?))",
                (ident, name, name))]
            if not ids:
                unmatched.append(ident)
                continue
            for asset_id in ids:
                ingest._set_tags(conn, asset_id, [(t, 1.0) for t in tags], SOURCE)
                touched.add(asset_id)
    added = conn.execute("SELECT COUNT(*) c FROM asset_tags").fetchone()["c"] - links_before
    for asset_id in touched:
        ingest.reindex_fts(asset_id)
        ingest.reindex_embedding(asset_id)
    return {"rows": len(entries), "assets_tagged": len(touched),
            "tags_added": added, "unmatched": unmatched}
