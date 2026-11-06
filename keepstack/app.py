"""Keepstack HTTP application (FastAPI).

Routes are grouped by concern: auth, assets, collections, tags, search,
sharing, administration, and open-standard endpoints (OAI-PMH, IIIF). The
single-page web client is served from the ``web/`` directory at the root.
"""
from __future__ import annotations

import html
import ipaddress
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import (Body, Depends, FastAPI, File, Form, HTTPException, Query,
                     Request, UploadFile)
from fastapi.responses import (FileResponse, HTMLResponse, JSONResponse,
                               PlainTextResponse, Response)
from fastapi.staticfiles import StaticFiles

from . import __version__, ingest, search, standards, storage, tagimport, thumbnails
from .audit import log, now_iso
from .auth import (OFFERED_ROLES, ROLE_INFO, ROLES, authenticate, hash_password,
                   login_locked, make_token, note_login_failure, note_login_success,
                   role_at_least, verify_password, verify_token)
from .config import config
from .db import get_conn, get_setting, init_db, set_setting, transaction

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="Keepstack DAM", version="0.1.0",
              docs_url="/docs" if config.api_docs else None,
              redoc_url="/redoc" if config.api_docs else None,
              openapi_url="/openapi.json" if config.api_docs else None)

# No inline scripts and no third-party origins; inline styles stay allowed for
# the style="" attributes the client sets and the share page's <style>.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; "
       "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
}
# The asset upload limit is an admin setting; tag lists are small, so they
# get a fixed cap.
TAG_IMPORT_MAX_MB = 50
MULTIPART_SLACK = 1024 * 1024  # form boundaries and the small text fields


def upload_limit_mb() -> int:
    try:
        return int(get_setting("max_upload_mb") or config.max_upload_mb)
    except ValueError:
        return config.max_upload_mb


def _upload_cap(path: str) -> Optional[int]:
    """Byte limit for an upload route, or None if ``path`` is not one."""
    if path == "/api/assets" or (path.startswith("/api/assets/") and path.endswith("/versions")):
        return upload_limit_mb() * 1024 * 1024
    if path == "/api/tags/import":
        return TAG_IMPORT_MAX_MB * 1024 * 1024
    return None


@app.middleware("http")
async def guard_requests(request: Request, call_next):
    """Refuse oversized uploads before the body is read, and add security
    headers to every response."""
    if request.method == "POST":
        cap = _upload_cap(request.url.path)
        if cap is not None:
            length = request.headers.get("content-length", "")
            if not length.isdigit():
                return JSONResponse({"detail": "Content-Length required"}, status_code=411)
            if int(length) > cap + MULTIPART_SLACK:
                return JSONResponse(
                    {"detail": f"File too large (limit {cap // (1024 * 1024)} MB)"}, status_code=413)
    response = await call_next(request)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    response.headers.setdefault("Content-Security-Policy", CSP)
    # Make browsers revalidate the web client (index.html, styles.css, js/) on
    # every load, so an update never pairs new HTML with a stale script.
    if not request.url.path.startswith(("/api/", "/iiif/", "/oai", "/s/")):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
@app.on_event("startup")
def _startup() -> None:
    init_db()
    conn = get_conn()
    has_users = conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
    if not has_users:
        conn.execute(
            "INSERT INTO users (username, email, full_name, password_hash, role, is_active, created_at) "
            "VALUES (?,?,?,?,?,1,?)",
            (config.admin_user, config.admin_email, "Administrator",
             hash_password(config.admin_password), "admin", now_iso()),
        )
        conn.commit()


# ---------------------------------------------------------------------------
# Auth dependencies
# ---------------------------------------------------------------------------
SESSION_COOKIE = "keepstack_session"
# The web client sends this header on every API call. A cross-site page can
# make the browser send the session cookie but cannot add a custom header
# without a CORS preflight, which this server never grants (CSRF defence).
CSRF_HEADER = "X-Requested-With"
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


def optional_user(request: Request) -> Optional[dict]:
    """The signed-in user from an API token (Authorization: Bearer) or the
    browser's HttpOnly session cookie, or None."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
    else:
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            return None
        if request.method not in SAFE_METHODS and request.headers.get(CSRF_HEADER) != "keepstack":
            raise HTTPException(403, "Missing CSRF header")
    payload = verify_token(token)
    if not payload:
        return None
    row = get_conn().execute(
        "SELECT * FROM users WHERE id = ? AND is_active = 1", (payload["sub"],)
    ).fetchone()
    if not row or row["token_version"] != payload.get("v", 0):
        return None  # revoked: the password changed after the token was issued
    return dict(row)


def require_user(request: Request) -> dict:
    user = optional_user(request)
    if not user:
        raise HTTPException(401, "Authentication required")
    return user


def require_role(minimum: str):
    def dep(request: Request) -> dict:
        user = require_user(request)
        if not role_at_least(user["role"], minimum):
            raise HTTPException(403, f"Requires {minimum} role")
        return user
    return dep


def _trusted_proxy_nets():
    nets = []
    for spec in config.trusted_proxies:
        try:
            nets.append(ipaddress.ip_network(spec, strict=False))
        except ValueError:
            continue
    return nets


def _ip_in(ip: str, nets) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in nets)


def client_ip(request: Request) -> str:
    """Resolve the client IP, trusting X-Forwarded-For only from a configured
    proxy. Without trusted proxies the direct peer address is authoritative, so
    a directly-connected client cannot spoof its IP to dodge rate limiting."""
    peer = request.client.host if request.client else ""
    nets = _trusted_proxy_nets()
    if nets and _ip_in(peer, nets):
        fwd = request.headers.get("X-Forwarded-For", "")
        for hop in reversed([h.strip() for h in fwd.split(",") if h.strip()]):
            if not _ip_in(hop, nets):
                return hop
    return peer


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@app.post("/api/auth/login")
def login(request: Request, body: dict = Body(...)):
    username = body.get("username", "")
    ip = client_ip(request)
    remaining = login_locked(username, ip)
    if remaining > 0:
        raise HTTPException(
            429, "Too many failed attempts, try again later",
            headers={"Retry-After": str(int(remaining) + 1)},
        )
    user = authenticate(username, body.get("password", ""))
    if not user:
        if note_login_failure(username, ip):
            log("login.lockout", detail=username, ip=ip)
        log("login.fail", detail=username, ip=ip)
        raise HTTPException(401, "Invalid credentials")
    note_login_success(username, ip)
    get_conn().execute("UPDATE users SET last_login = ? WHERE id = ?", (now_iso(), user["id"]))
    get_conn().commit()
    log("login.success", user=user, ip=ip)
    token = make_token(user["id"], user["role"], user["token_version"])
    # Browsers use the HttpOnly cookie (script cannot read it); the token in
    # the body is for API clients that send Authorization: Bearer.
    response = JSONResponse({"token": token, "user": _user_public(user)})
    response.set_cookie(SESSION_COOKIE, token, max_age=config.token_ttl_hours * 3600,
                        httponly=True, samesite="lax", secure=config.cookie_secure, path="/")
    return response


@app.post("/api/auth/logout")
def logout(request: Request):
    try:
        user = optional_user(request)
    except HTTPException:
        user = None
    if user:
        log("logout", user=user, ip=client_ip(request))
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax",
                           secure=config.cookie_secure)
    return response


@app.get("/api/auth/me")
def me(user: dict = Depends(require_user)):
    return _user_public(user)


PREFS_MAX_BYTES = 8192


def _load_prefs(user_id: int) -> dict:
    row = get_conn().execute(
        "SELECT prefs_json FROM user_preferences WHERE user_id = ?", (user_id,)).fetchone()
    try:
        return json.loads(row["prefs_json"]) if row else {}
    except ValueError:
        return {}


@app.get("/api/auth/me/preferences")
def get_preferences(user: dict = Depends(require_user)):
    return _load_prefs(user["id"])


@app.patch("/api/auth/me/preferences")
def update_preferences(body: dict = Body(...), user: dict = Depends(require_user)):
    """Merge the given keys into the user's stored UI preferences."""
    prefs = {**_load_prefs(user["id"]), **body}
    data = json.dumps(prefs)
    if len(data) > PREFS_MAX_BYTES:
        raise HTTPException(413, "Preferences too large")
    with transaction() as conn:
        conn.execute(
            "INSERT INTO user_preferences (user_id, prefs_json) VALUES (?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json",
            (user["id"], data))
    return prefs


def _user_public(u: dict) -> dict:
    return {"id": u["id"], "username": u["username"], "email": u["email"],
            "full_name": u["full_name"], "role": u["role"]}


# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------
# Upload handlers are plain functions so ingest (hashing, thumbnails, OCR) runs
# in the threadpool instead of blocking the event loop, and they stream the
# spooled upload into storage rather than reading it into memory.
@app.post("/api/assets")
def upload_assets(
    request: Request,
    files: list[UploadFile] = File(...),
    run_ai: bool = Form(True),
    user: dict = Depends(require_role("uploader")),
):
    results = []
    for f in files:
        asset = ingest.ingest_stream(f.file, f.filename or "upload.bin", user=user, run_ai=run_ai)
        if not asset.get("duplicate"):
            log("asset.create", user=user, target_type="asset", target_id=asset["uuid"],
                detail=asset["filename"], ip=client_ip(request))
        results.append({"uuid": asset["uuid"], "title": asset["title"],
                        "duplicate": asset.get("duplicate", False),
                        "media_type": asset["media_type"]})
    return {"created": results}


BULK_MAX = 1000
# Minimum role per bulk action, matching the single-asset endpoints.
BULK_ACTIONS = {"delete": "editor", "tag": "contributor", "untag": "contributor",
                "collection": "contributor"}


@app.post("/api/assets/bulk")
def bulk_assets(request: Request, body: dict = Body(...), user: dict = Depends(require_user)):
    """Apply one action to many assets: delete, tag, untag, or add to a collection."""
    action = body.get("action")
    if action not in BULK_ACTIONS:
        raise HTTPException(400, f"Unknown action; use one of {', '.join(BULK_ACTIONS)}")
    if not role_at_least(user["role"], BULK_ACTIONS[action]):
        raise HTTPException(403, f"Requires {BULK_ACTIONS[action]} role")
    uuids = body.get("uuids")
    if not isinstance(uuids, list) or not uuids or len(uuids) > BULK_MAX:
        raise HTTPException(400, f"Send 1 to {BULK_MAX} asset uuids")
    tag = (body.get("tag") or "").strip().lower()[:100]
    if action in ("tag", "untag") and not tag:
        raise HTTPException(400, "Tag name required")

    with transaction() as conn:
        marks = ",".join("?" * len(uuids))
        assets = [dict(r) for r in conn.execute(
            f"SELECT id, media_type FROM assets WHERE status = 'active' AND uuid IN ({marks})",
            [str(u) for u in uuids])]
        ids = [a["id"] for a in assets]
        id_marks = ",".join("?" * len(ids))
        detail = f"{len(ids)} assets"
        changed = 0
        if action == "collection":
            col = conn.execute("SELECT id, name FROM collections WHERE id = ?",
                               (body.get("collection_id"),)).fetchone()
            if not col:
                raise HTTPException(404, "Collection not found")
            detail += f", collection={col['name']}"
        if action in ("tag", "untag"):
            detail += f", tag={tag}"
        if ids:
            if action == "tag":
                conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag,))
                tid = conn.execute("SELECT id FROM tags WHERE name = ?", (tag,)).fetchone()["id"]
            # `changed` counts only the rows this action touched (new links, removals...)
            before = conn.total_changes
            if action == "delete":
                conn.execute(f"UPDATE assets SET status = 'deleted', updated_at = ? WHERE id IN ({id_marks})",
                             [now_iso(), *ids])
            elif action == "tag":
                conn.executemany("INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source) VALUES (?, ?, 'manual')",
                                 [(asset_id, tid) for asset_id in ids])
            elif action == "untag":
                conn.execute(f"DELETE FROM asset_tags WHERE tag_id = (SELECT id FROM tags WHERE name = ?) "
                             f"AND asset_id IN ({id_marks})", [tag, *ids])
            elif action == "collection":
                conn.executemany(
                    "INSERT OR IGNORE INTO collection_assets (collection_id, asset_id, added_at) VALUES (?,?,?)",
                    [(col["id"], asset_id, now_iso()) for asset_id in ids])
            changed = conn.total_changes - before

    if action == "delete":
        search.invalidate_facets()
    elif action in ("tag", "untag"):
        for a in assets:
            ingest.reindex_after_tag_change(a["id"], a["media_type"])
    log(f"asset.bulk_{action}", user=user, target_type="asset", detail=detail, ip=client_ip(request))
    return {"action": action, "matched": len(ids), "changed": changed}


@app.get("/api/assets")
def list_assets(
    q: str = "",
    media_type: Optional[str] = None,
    tag: list[str] = Query([]),
    not_tag: list[str] = Query([]),
    tag_match: str = Query("all", pattern="^(all|any)$"),
    collection_id: Optional[int] = None,
    status: str = "active",
    sort: str = search.DEFAULT_SORT,
    mode: str = "keyword",
    limit: int = Query(60, le=500),
    offset: int = 0,
    user: dict = Depends(require_user),
):
    # ?tag=a&tag=b (must have), ?not_tag=c (must not have), tag_match=all|any
    return search.search(q=q, media_type=media_type, tags=tag[:50], not_tags=not_tag[:50],
                         tag_match=tag_match, collection_id=collection_id, status=status,
                         sort=sort, mode=mode, limit=limit, offset=offset)


def _get_asset_or_404(uuid: str) -> dict:
    row = get_conn().execute("SELECT * FROM assets WHERE uuid = ?", (uuid,)).fetchone()
    if not row:
        raise HTTPException(404, "Asset not found")
    return dict(row)


@app.get("/api/assets/{uuid}")
def asset_detail(uuid: str, user: dict = Depends(require_user)):
    a = _get_asset_or_404(uuid)
    conn = get_conn()
    tags = [dict(r) for r in conn.execute(
        "SELECT t.name, at.source, at.confidence FROM tags t "
        "JOIN asset_tags at ON at.tag_id = t.id WHERE at.asset_id = ? ORDER BY t.name",
        (a["id"],))]
    versions = [dict(r) for r in conn.execute(
        "SELECT version_no, sha256, size, note, created_at FROM asset_versions "
        "WHERE asset_id = ? ORDER BY version_no DESC", (a["id"],))]
    collections = [dict(r) for r in conn.execute(
        "SELECT c.id, c.name FROM collections c JOIN collection_assets ca ON ca.collection_id = c.id "
        "WHERE ca.asset_id = ?", (a["id"],))]
    custom = [dict(r) for r in conn.execute(
        "SELECT cf.key, cf.label, acv.value FROM asset_custom_values acv "
        "JOIN custom_fields cf ON cf.id = acv.field_id WHERE acv.asset_id = ?", (a["id"],))]
    a.pop("embedding", None)
    a["dublin_core"] = standards.dublin_core(a)
    return {"asset": a, "tags": tags, "versions": versions,
            "collections": collections, "custom": custom}


@app.patch("/api/assets/{uuid}")
def update_asset(uuid: str, request: Request, body: dict = Body(...),
                 user: dict = Depends(require_role("contributor"))):
    a = _get_asset_or_404(uuid)
    editable = {"title", "description", "alt_text", "license", "rights_statement",
                "credit", "usage_expiry", "retention_until", "dc_creator",
                "dc_subject", "dc_publisher", "dc_date", "status"}
    sets, vals = [], []
    for k, v in body.items():
        if k in editable:
            sets.append(f"{k} = ?")
            vals.append(v)
    if sets:
        sets.append("updated_at = ?")
        vals.extend([now_iso(), a["id"]])
        with transaction() as conn:
            conn.execute(f"UPDATE assets SET {', '.join(sets)} WHERE id = ?", vals)
        ingest.reindex_fts(a["id"])
        ingest.reindex_embedding(a["id"])
        log("asset.update", user=user, target_type="asset", target_id=uuid,
            detail=",".join(body.keys()), ip=client_ip(request))
    return asset_detail(uuid, user)


@app.delete("/api/assets/{uuid}")
def delete_asset(uuid: str, request: Request, user: dict = Depends(require_role("editor"))):
    a = _get_asset_or_404(uuid)
    with transaction() as conn:
        conn.execute("UPDATE assets SET status = 'deleted', updated_at = ? WHERE id = ?",
                     (now_iso(), a["id"]))
    search.invalidate_facets()
    log("asset.delete", user=user, target_type="asset", target_id=uuid, ip=client_ip(request))
    return {"ok": True}


@app.get("/api/assets/{uuid}/file")
def asset_file(uuid: str, user: dict = Depends(require_user)):
    a = _get_asset_or_404(uuid)
    path = storage.blob_path(a["storage_key"])
    if not path.exists():
        raise HTTPException(410, "Blob missing")
    return FileResponse(path, media_type=a["mime_type"], filename=a["filename"])


# Renditions are loaded by <img> tags, which send the session cookie. Only the
# browser may cache them ("private"), never a shared proxy.
RENDITION_CACHE = {"Cache-Control": "private, max-age=3600"}


@app.get("/api/assets/{uuid}/thumb")
def asset_thumb(uuid: str, user: dict = Depends(require_user)):
    a = _get_asset_or_404(uuid)
    key = a["thumb_key"] or thumbnails.ensure_thumbnail(
        a["sha256"], a["storage_key"], a["media_type"], a["ext"])
    path = storage.thumb_path(key)
    if not path.exists():
        thumbnails.ensure_thumbnail(a["sha256"], a["storage_key"], a["media_type"], a["ext"])
    return FileResponse(path, media_type="image/jpeg", headers=RENDITION_CACHE)


@app.get("/api/assets/{uuid}/preview")
def asset_preview(uuid: str, size: int = Query(1600, le=4000), user: dict = Depends(require_user)):
    a = _get_asset_or_404(uuid)
    data = thumbnails.rendition(a["sha256"], a["storage_key"], a["media_type"], a["ext"], size)
    if data is None:
        return asset_thumb(uuid, user)
    return Response(content=data, media_type="image/jpeg", headers=RENDITION_CACHE)


@app.get("/api/assets/{uuid}/similar")
def asset_similar(uuid: str, user: dict = Depends(require_user)):
    a = _get_asset_or_404(uuid)
    return {"items": search.more_like(a["id"])}


@app.post("/api/assets/{uuid}/tags")
def add_tag(uuid: str, request: Request, body: dict = Body(...),
            user: dict = Depends(require_role("contributor"))):
    a = _get_asset_or_404(uuid)
    name = (body.get("name") or "").strip().lower()
    if not name:
        raise HTTPException(400, "Tag name required")
    with transaction() as conn:
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
        tid = conn.execute("SELECT id FROM tags WHERE name = ?", (name,)).fetchone()["id"]
        conn.execute("INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source) VALUES (?,?,?)",
                     (a["id"], tid, "manual"))
    ingest.reindex_fts(a["id"])
    ingest.reindex_embedding(a["id"])
    log("tag.add", user=user, target_type="asset", target_id=uuid, detail=name)
    return {"ok": True}


@app.delete("/api/assets/{uuid}/tags/{name}")
def remove_tag(uuid: str, name: str, user: dict = Depends(require_role("contributor"))):
    a = _get_asset_or_404(uuid)
    with transaction() as conn:
        conn.execute(
            "DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = "
            "(SELECT id FROM tags WHERE name = ?)", (a["id"], name.lower()))
    ingest.reindex_fts(a["id"])
    return {"ok": True}


@app.post("/api/assets/{uuid}/versions")
def add_version(uuid: str, request: Request, file: UploadFile = File(...),
                note: str = Form(""), user: dict = Depends(require_role("editor"))):
    a = _get_asset_or_404(uuid)
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else a["ext"]
    sha, key, size = storage.store_stream(file.file, ext)
    conn = get_conn()
    last = conn.execute("SELECT COALESCE(MAX(version_no),0) m FROM asset_versions WHERE asset_id = ?",
                        (a["id"],)).fetchone()["m"]
    with transaction() as conn:
        # snapshot the current version, then promote the new bytes to current
        conn.execute(
            "INSERT INTO asset_versions (asset_id, version_no, sha256, storage_key, size, note, created_by, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (a["id"], last + 1, a["sha256"], a["storage_key"], a["size"],
             "previous current", user["id"], now_iso()))
        conn.execute(
            "INSERT INTO asset_versions (asset_id, version_no, sha256, storage_key, size, note, created_by, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (a["id"], last + 2, sha, key, size, note or "new version", user["id"], now_iso()))
        conn.execute("UPDATE assets SET sha256 = ?, storage_key = ?, size = ?, updated_at = ? WHERE id = ?",
                     (sha, key, size, now_iso(), a["id"]))
    thumbnails.ensure_thumbnail(sha, key, a["media_type"], ext)
    log("asset.version", user=user, target_type="asset", target_id=uuid, detail=note)
    return {"ok": True, "version": last + 2}


@app.get("/api/assets/{uuid}/metadata")
def asset_metadata(uuid: str, user: dict = Depends(require_user)):
    a = _get_asset_or_404(uuid)
    row = get_conn().execute("SELECT * FROM asset_metadata WHERE asset_id = ?", (a["id"],)).fetchone()
    if not row:
        return {"exif": {}, "iptc": {}, "xmp": {}}
    return {"exif": json.loads(row["exif_json"] or "{}"),
            "iptc": json.loads(row["iptc_json"] or "{}"),
            "xmp": json.loads(row["xmp_json"] or "{}")}


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------
@app.get("/api/tags")
def list_tags(user: dict = Depends(require_user)):
    # Counts only active assets, matching what a tag filter would return.
    rows = get_conn().execute(
        "SELECT t.name, COUNT(a.id) c FROM tags t "
        "LEFT JOIN asset_tags at ON at.tag_id = t.id "
        "LEFT JOIN assets a ON a.id = at.asset_id AND a.status = 'active' "
        "GROUP BY t.name ORDER BY c DESC, t.name").fetchall()
    return {"tags": [dict(r) for r in rows]}


@app.post("/api/tags/import")
def import_tags(request: Request, file: UploadFile = File(...),
                user: dict = Depends(require_role("contributor"))):
    data = file.file.read()
    try:
        entries = tagimport.parse(data, file.filename or "")
    except Exception as exc:
        raise HTTPException(400, f"Could not read {file.filename}: {exc}")
    result = tagimport.apply(entries)
    log("tag.import", user=user, detail=f"{file.filename}: {result['assets_tagged']} assets, "
        f"{result['tags_added']} tags", ip=client_ip(request))
    return result


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------
@app.get("/api/collections")
def list_collections(user: dict = Depends(require_user)):
    rows = get_conn().execute(
        "SELECT c.*, (SELECT COUNT(*) FROM collection_assets ca WHERE ca.collection_id = c.id) AS asset_count "
        "FROM collections c ORDER BY c.name").fetchall()
    return {"collections": [dict(r) for r in rows]}


@app.post("/api/collections")
def create_collection(request: Request, body: dict = Body(...),
                      user: dict = Depends(require_role("contributor"))):
    import uuid as uuidlib
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Name required")
    cid = str(uuidlib.uuid4())
    with transaction() as conn:
        cur = conn.execute(
            "INSERT INTO collections (uuid, name, description, parent_id, kind, created_by, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (cid, name, body.get("description"), body.get("parent_id"),
             body.get("kind", "folder"), user["id"], now_iso()))
    log("collection.create", user=user, target_type="collection", target_id=cid, detail=name)
    return {"id": cur.lastrowid, "uuid": cid, "name": name}


@app.delete("/api/collections/{cid}")
def delete_collection(cid: int, user: dict = Depends(require_role("editor"))):
    with transaction() as conn:
        conn.execute("DELETE FROM collections WHERE id = ?", (cid,))
    log("collection.delete", user=user, target_type="collection", target_id=cid)
    return {"ok": True}


@app.post("/api/collections/{cid}/assets")
def add_to_collection(cid: int, body: dict = Body(...),
                      user: dict = Depends(require_role("contributor"))):
    uuids = body.get("uuids", [])
    conn = get_conn()
    added = 0
    with transaction() as conn:
        for u in uuids:
            row = conn.execute("SELECT id FROM assets WHERE uuid = ?", (u,)).fetchone()
            if row:
                conn.execute(
                    "INSERT OR IGNORE INTO collection_assets (collection_id, asset_id, added_at) VALUES (?,?,?)",
                    (cid, row["id"], now_iso()))
                added += 1
    log("collection.add", user=user, target_type="collection", target_id=cid, detail=f"{added} assets")
    return {"ok": True, "added": added}


@app.delete("/api/collections/{cid}/assets/{uuid}")
def remove_from_collection(cid: int, uuid: str, user: dict = Depends(require_role("contributor"))):
    with transaction() as conn:
        conn.execute(
            "DELETE FROM collection_assets WHERE collection_id = ? AND asset_id = "
            "(SELECT id FROM assets WHERE uuid = ?)", (cid, uuid))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Sharing (public, tokenised, expiring links)
# ---------------------------------------------------------------------------
@app.post("/api/shares")
def create_share(request: Request, body: dict = Body(...),
                 user: dict = Depends(require_role("contributor"))):
    import secrets
    if body.get("target_type", "asset") != "asset":
        raise HTTPException(400, "Only assets can be shared")
    permission = body.get("permission", "view")
    if permission not in ("view", "download"):
        raise HTTPException(400, "Permission must be view or download")
    max_downloads = body.get("max_downloads")
    if max_downloads is not None and (isinstance(max_downloads, bool)
                                      or not isinstance(max_downloads, int) or max_downloads < 1):
        raise HTTPException(400, "max_downloads must be a positive number")
    expires_at = body.get("expires_at")
    if expires_at:
        try:
            exp = datetime.fromisoformat(expires_at)
        except (TypeError, ValueError):
            raise HTTPException(400, "expires_at must be an ISO 8601 date")
        # stored in the same form as now_iso() so the expiry check compares strings
        expires_at = (exp if exp.tzinfo else exp.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
    asset = get_conn().execute("SELECT uuid FROM assets WHERE id = ? AND status = 'active'",
                               (body.get("target_id"),)).fetchone()
    if not asset:
        raise HTTPException(404, "Asset not found")
    token = secrets.token_urlsafe(16)
    with transaction() as conn:
        conn.execute(
            "INSERT INTO share_links (token, target_type, target_id, permission, expires_at, "
            "max_downloads, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (token, "asset", body["target_id"], permission, expires_at,
             max_downloads, user["id"], now_iso()))
    log("share.create", user=user, target_type="asset", target_id=asset["uuid"],
        ip=client_ip(request))
    return {"token": token, "url": f"{config.base_url}/s/{token}"}


@app.get("/api/shares")
def list_shares(user: dict = Depends(require_role("contributor"))):
    # Contributors manage their own links; editors and admins see all of them.
    mine_only = not role_at_least(user["role"], "editor")
    rows = get_conn().execute(
        "SELECT id, token, target_type, target_id, permission, expires_at, "
        "download_count, max_downloads, revoked, created_by, created_at FROM share_links "
        "WHERE revoked = 0" + (" AND created_by = ?" if mine_only else "") +
        " ORDER BY created_at DESC", (user["id"],) if mine_only else ()).fetchall()
    return {"shares": [dict(r) for r in rows]}


@app.delete("/api/shares/{sid}")
def revoke_share(sid: int, request: Request, user: dict = Depends(require_role("contributor"))):
    with transaction() as conn:
        row = conn.execute("SELECT created_by FROM share_links WHERE id = ?", (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "Share link not found")
        if row["created_by"] != user["id"] and not role_at_least(user["role"], "editor"):
            raise HTTPException(403, "You can only revoke your own share links")
        conn.execute("UPDATE share_links SET revoked = 1 WHERE id = ?", (sid,))
    log("share.revoke", user=user, target_type="share", target_id=sid, ip=client_ip(request))
    return {"ok": True}


def _valid_share(token: str) -> tuple[dict, dict]:
    """The share link and its asset, while the link is usable."""
    row = get_conn().execute("SELECT * FROM share_links WHERE token = ? AND revoked = 0",
                             (token,)).fetchone()
    if not row:
        raise HTTPException(404, "Invalid or revoked link")
    s = dict(row)
    if s["expires_at"] and s["expires_at"] < now_iso():
        raise HTTPException(410, "Link expired")
    if s["max_downloads"] and s["download_count"] >= s["max_downloads"]:
        raise HTTPException(410, "Download limit reached")
    a = get_conn().execute("SELECT * FROM assets WHERE id = ? AND status = 'active'",
                           (s["target_id"],)).fetchone()
    if not a:
        raise HTTPException(404, "Asset unavailable")
    return s, dict(a)


@app.get("/s/{token}", response_class=HTMLResponse)
def public_share(token: str):
    s, a = _valid_share(token)
    can_dl = s["permission"] == "download"
    dl = (f'<a class="btn" href="/s/{token}/file">Download original</a>' if can_dl else "")
    # Titles and descriptions are user input: escape everything from the catalog.
    title = html.escape(a["title"] or a["filename"] or "")
    alt = html.escape(a.get("alt_text") or a["title"] or "")
    desc = html.escape(a.get("description") or "")
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} - Shared via Keepstack</title>
<style>body{{margin:0;font-family:system-ui,sans-serif;background:#f4f6fa;color:#1d2433;
display:flex;flex-direction:column;align-items:center;gap:24px;padding:48px 16px}}
img{{max-width:min(900px,92vw);border-radius:12px;border:1px solid #dde3ec}}
.btn{{background:#4d68d6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none}}
.muted{{color:#64708a}}</style></head>
<body><h2>{title}</h2>
<img src="/s/{token}/preview" alt="{alt}">
<p class="muted">{desc}</p>{dl}
<p class="muted">Shared securely via Keepstack</p></body></html>"""


@app.get("/s/{token}/preview")
def public_share_preview(token: str):
    s, a = _valid_share(token)
    data = thumbnails.rendition(a["sha256"], a["storage_key"], a["media_type"], a["ext"], 1600)
    if data is None:
        key = a["thumb_key"]
        return FileResponse(storage.thumb_path(key), media_type="image/jpeg")
    return Response(content=data, media_type="image/jpeg")


@app.get("/s/{token}/file")
def public_share_file(token: str, request: Request):
    s, a = _valid_share(token)
    if s["permission"] != "download":
        raise HTTPException(403, "Download not permitted")
    with transaction() as conn:
        conn.execute("UPDATE share_links SET download_count = download_count + 1 WHERE id = ?", (s["id"],))
    log("share.download", target_type="asset", target_id=a["uuid"], detail=token, ip=client_ip(request))
    return FileResponse(storage.blob_path(a["storage_key"]), media_type=a["mime_type"],
                        filename=a["filename"])


# ---------------------------------------------------------------------------
# Administration
# ---------------------------------------------------------------------------
@app.get("/api/stats")
def stats(user: dict = Depends(require_user)):
    conn = get_conn()
    by_type = {r["media_type"]: r["c"] for r in conn.execute(
        "SELECT media_type, COUNT(*) c FROM assets WHERE status='active' GROUP BY media_type")}
    total = conn.execute("SELECT COUNT(*) c FROM assets WHERE status='active'").fetchone()["c"]
    size = conn.execute("SELECT COALESCE(SUM(size),0) s FROM assets WHERE status='active'").fetchone()["s"]
    tags = conn.execute("SELECT COUNT(*) c FROM tags").fetchone()["c"]
    cols = conn.execute("SELECT COUNT(*) c FROM collections").fetchone()["c"]
    # storage saved through dedup: bytes that would exist without content-addressing
    dup = conn.execute(
        "SELECT COALESCE(SUM(size),0) s FROM (SELECT sha256, size, COUNT(*) n "
        "FROM assets GROUP BY sha256 HAVING n > 1)").fetchone()["s"]
    return {"total_assets": total, "total_bytes": size, "by_type": by_type,
            "tags": tags, "collections": cols, "dedup_saved_bytes": dup}


UPLOAD_LIMIT_RANGE_MB = (1, 100 * 1024)


@app.get("/api/settings")
def get_settings(user: dict = Depends(require_user)):
    # Every signed-in user reads these: the upload dialog checks sizes up front.
    return {"max_upload_mb": upload_limit_mb()}


@app.patch("/api/settings")
def update_settings(request: Request, body: dict = Body(...),
                    user: dict = Depends(require_role("admin"))):
    if "max_upload_mb" in body:
        lo, hi = UPLOAD_LIMIT_RANGE_MB
        value = body["max_upload_mb"]
        if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
            raise HTTPException(400, f"Upload limit must be a whole number of MB between {lo} and {hi}")
        set_setting("max_upload_mb", str(value))
        log("settings.update", user=user, detail=f"max_upload_mb={value}", ip=client_ip(request))
    return get_settings(user)


USERNAME_RE = re.compile(r"^[A-Za-z0-9._@-]{3,64}$")
MIN_PASSWORD = 8
_USER_COLS = "id, username, email, full_name, role, is_active, created_at, last_login"
# Plus the columns handlers need but the API never returns.
_USER_INTERNAL_COLS = _USER_COLS + ", token_version"


@app.get("/api/roles")
def list_roles(user: dict = Depends(require_role("admin"))):
    return {"roles": [{"name": r, "label": ROLE_INFO[r][0], "description": ROLE_INFO[r][1],
                       "offered": r in OFFERED_ROLES} for r in ROLES]}


def _clean_user_fields(body: dict) -> dict:
    """Validate the editable user fields present in ``body``."""
    out = {}
    if "role" in body:
        if body["role"] not in ROLES:
            raise HTTPException(400, f"Unknown role: {body['role']}")
        out["role"] = body["role"]
    if "email" in body:
        email = (body["email"] or "").strip()
        if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise HTTPException(400, "Invalid email address")
        out["email"] = email or None
    if "full_name" in body:
        out["full_name"] = (body["full_name"] or "").strip()[:200] or None
    if "is_active" in body:
        out["is_active"] = 1 if body["is_active"] else 0
    if body.get("password"):
        if len(body["password"]) < MIN_PASSWORD:
            raise HTTPException(400, f"Password must be at least {MIN_PASSWORD} characters")
        out["password_hash"] = hash_password(body["password"])
    return out


def _guard_admins(conn, uid: int, acting: dict, *, role: Optional[str], active: bool) -> None:
    """Refuse changes that would lock everyone out of administration."""
    if uid == acting["id"] and (role != "admin" or not active):
        raise HTTPException(400, "You cannot remove your own admin access or delete yourself")
    if role == "admin" and active:
        return
    others = conn.execute(
        "SELECT COUNT(*) c FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?", (uid,)
    ).fetchone()["c"]
    if not others:
        raise HTTPException(400, "At least one active administrator must remain")


def _get_user_or_404(conn, uid: int, cols: str = _USER_COLS) -> dict:
    row = conn.execute(f"SELECT {cols} FROM users WHERE id = ?", (uid,)).fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    return dict(row)


@app.get("/api/users")
def list_users(user: dict = Depends(require_role("admin"))):
    rows = get_conn().execute(f"SELECT {_USER_COLS} FROM users ORDER BY username").fetchall()
    return {"users": [dict(r) for r in rows]}


@app.post("/api/users")
def create_user(request: Request, body: dict = Body(...), user: dict = Depends(require_role("admin"))):
    username = (body.get("username") or "").strip()
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(400, "Username must be 3-64 characters: letters, digits, . _ @ -")
    if not body.get("password"):
        raise HTTPException(400, "Password is required")
    fields = _clean_user_fields({"role": "viewer", "is_active": True, **body})
    try:
        with transaction() as conn:
            cur = conn.execute(
                "INSERT INTO users (username, email, full_name, password_hash, role, is_active, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (username, fields.get("email"), fields.get("full_name"), fields["password_hash"],
                 fields["role"], fields["is_active"], now_iso()))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Username already exists")
    log("user.create", user=user, target_type="user", target_id=username,
        detail=f"role={fields['role']}", ip=client_ip(request))
    return _get_user_or_404(get_conn(), cur.lastrowid)


@app.patch("/api/users/{uid}")
def update_user(uid: int, request: Request, body: dict = Body(...),
                user: dict = Depends(require_role("admin"))):
    fields = _clean_user_fields(body)
    with transaction() as conn:
        current = _get_user_or_404(conn, uid, _USER_INTERNAL_COLS)
        new_role = fields.get("role", current["role"])
        new_active = bool(fields.get("is_active", current["is_active"]))
        if current["role"] == "admin" and current["is_active"]:
            _guard_admins(conn, uid, user, role=new_role, active=new_active)
        if "password_hash" in fields:
            fields["token_version"] = current["token_version"] + 1  # sign out everywhere
        if fields:
            conn.execute(f"UPDATE users SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                         [*fields.values(), uid])
    changed = ", ".join(k if k != "password_hash" else "password"
                        for k in fields if k != "token_version")
    log("user.update", user=user, target_type="user", target_id=current["username"],
        detail=changed, ip=client_ip(request))
    return _get_user_or_404(get_conn(), uid)


@app.delete("/api/users/{uid}")
def delete_user(uid: int, request: Request, user: dict = Depends(require_role("admin"))):
    with transaction() as conn:
        current = _get_user_or_404(conn, uid)
        if uid == user["id"]:
            raise HTTPException(400, "You cannot remove your own admin access or delete yourself")
        if current["role"] == "admin" and current["is_active"]:
            _guard_admins(conn, uid, user, role=None, active=False)
        # Uploaded assets keep existing (uploaded_by becomes NULL); preferences go too.
        conn.execute("DELETE FROM users WHERE id = ?", (uid,))
    log("user.delete", user=user, target_type="user", target_id=current["username"],
        ip=client_ip(request))
    return {"ok": True}


@app.get("/api/audit")
def audit_log(limit: int = Query(100, le=1000), user: dict = Depends(require_role("admin"))):
    rows = get_conn().execute(
        "SELECT ts, username, action, target_type, target_id, detail, ip FROM audit_log "
        "ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return {"entries": [dict(r) for r in rows]}


@app.get("/api/custom-fields")
def list_custom_fields(user: dict = Depends(require_user)):
    rows = get_conn().execute("SELECT * FROM custom_fields ORDER BY sort_order, label").fetchall()
    return {"fields": [dict(r) for r in rows]}


@app.post("/api/custom-fields")
def create_custom_field(body: dict = Body(...), user: dict = Depends(require_role("admin"))):
    with transaction() as conn:
        cur = conn.execute(
            "INSERT INTO custom_fields (key, label, field_type, options_json, required, sort_order) "
            "VALUES (?,?,?,?,?,?)",
            (body["key"], body["label"], body.get("field_type", "text"),
             json.dumps(body.get("options")) if body.get("options") else None,
             1 if body.get("required") else 0, body.get("sort_order", 0)))
    return {"id": cur.lastrowid}


@app.put("/api/assets/{uuid}/custom/{field_id}")
def set_custom_value(uuid: str, field_id: int, body: dict = Body(...),
                     user: dict = Depends(require_role("contributor"))):
    a = _get_asset_or_404(uuid)
    with transaction() as conn:
        conn.execute(
            "INSERT INTO asset_custom_values (asset_id, field_id, value) VALUES (?,?,?) "
            "ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value",
            (a["id"], field_id, body.get("value")))
    ingest.reindex_fts(a["id"])
    return {"ok": True}


@app.post("/api/admin/fixity")
def fixity_check(user: dict = Depends(require_role("admin"))):
    """Re-hash every blob and report integrity failures (digital preservation)."""
    conn = get_conn()
    rows = conn.execute("SELECT uuid, sha256, storage_key FROM assets WHERE status != 'deleted'").fetchall()
    failures = []
    for r in rows:
        if not storage.verify_fixity(r["storage_key"], r["sha256"]):
            failures.append(r["uuid"])
    log("admin.fixity", user=user, detail=f"{len(failures)} failures of {len(rows)}")
    return {"checked": len(rows), "failures": failures, "ok": not failures}


# ---------------------------------------------------------------------------
# Open standards: OAI-PMH + IIIF
# ---------------------------------------------------------------------------
def standards_access(request: Request) -> None:
    """OAI-PMH and IIIF are open to harvesters and viewers only when
    KEEPSTACK_PUBLIC_API is on; otherwise they need a signed-in user."""
    if not config.public_api:
        require_user(request)


@app.get("/oai", dependencies=[Depends(standards_access)])
def oai(request: Request):
    body, status = standards.oai_response(dict(request.query_params))
    return Response(content=body, media_type="application/xml", status_code=status)


@app.get("/iiif/3/{uuid}/info.json", dependencies=[Depends(standards_access)])
def iiif_info(uuid: str):
    a = _get_asset_or_404(uuid)
    return JSONResponse(standards.iiif_info(a))


@app.get("/iiif/3/{uuid}/manifest.json", dependencies=[Depends(standards_access)])
def iiif_manifest(uuid: str):
    a = _get_asset_or_404(uuid)
    if a["media_type"] != "image":
        raise HTTPException(415, "IIIF manifests are available for images only")
    return JSONResponse(standards.iiif_manifest(a))


@app.get("/iiif/3/{uuid}/{region}/{size}/{rotation}/{quality}.{fmt}", dependencies=[Depends(standards_access)])
def iiif_image(uuid: str, region: str, size: str, rotation: str, quality: str, fmt: str):
    a = _get_asset_or_404(uuid)
    if fmt.lower() not in ("jpg", "jpeg"):
        raise HTTPException(400, "Only JPEG IIIF output is supported")
    try:
        data = thumbnails.iiif_rendition(
            a["sha256"], a["storage_key"], a["media_type"], region, size, rotation
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if data is None:
        raise HTTPException(415, "IIIF available for images only")
    return Response(content=data, media_type="image/jpeg")


@app.get("/api/version")
def version():
    """Report the running version (unauthenticated, for monitoring)."""
    return {"name": "keepstack", "version": __version__}


@app.get("/healthz", response_class=PlainTextResponse)
def healthz():
    return "ok"


# ---------------------------------------------------------------------------
# Static SPA (registered last so API routes win)
# ---------------------------------------------------------------------------
SPA_VIEWS = ("library", "collections", "dashboard", "users", "audit")


def spa_view():
    """Each client view has its own URL; all of them load the same page."""
    return FileResponse(WEB_DIR / "index.html")


# Explicit paths, not "/{view}", so static files like /styles.css still resolve.
for _view in SPA_VIEWS:
    app.add_api_route(f"/{_view}", spa_view, methods=["GET"], include_in_schema=False)


if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
