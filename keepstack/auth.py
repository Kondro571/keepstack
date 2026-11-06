"""Authentication, password hashing, and role-based access control.

Tokens are stateless HMAC-signed payloads (a minimal JWT-style scheme)
built entirely on the standard library, so there is no cryptography
dependency to install. Passwords are hashed with scrypt.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from typing import Optional

from .config import config
from .db import get_conn

# Role hierarchy: each role implies every capability of the ones after it.
ROLES = ["admin", "editor", "contributor", "uploader", "viewer"]
_RANK = {r: i for i, r in enumerate(ROLES)}

# Labels and descriptions shown in the user management UI.
ROLE_INFO = {
    "admin": ("Administrator", "Full access, including users, audit log and settings."),
    "editor": ("Editor", "Browse, add, edit and delete assets."),
    "contributor": ("Contributor", "Browse, add and edit assets, tags and collections. Cannot delete."),
    "uploader": ("Uploader", "Browse, search, download and add new files. Cannot edit or delete."),
    "viewer": ("Viewer", "Browse, search, view and download."),
}
# Roles offered when creating a user; the others stay valid for existing accounts.
OFFERED_ROLES = ("admin", "uploader", "viewer")


def role_at_least(role: str, minimum: str) -> bool:
    return _RANK.get(role, 99) <= _RANK.get(minimum, 99)


# ----------------------------------------------------------------------------
# Login throttling
#
# Two buckets per attempt, both required so the two common brute-force shapes
# are covered: a per-(username, ip) bucket protects a targeted account, and a
# per-ip bucket protects against one host spraying many usernames. The ``ip``
# must be a trustworthy peer address (see client_ip in app.py), never a raw
# X-Forwarded-For value, or an attacker rotates the header to mint fresh
# buckets. In-memory only: put a shared limiter in front for multi-process
# deployments.
# ----------------------------------------------------------------------------
_login_lock = threading.Lock()
_login_attempts: dict[str, dict] = {}
_MAX_TRACKED = 20000


def _pair_key(username: str, ip: str) -> str:
    return "p:" + (username or "").strip().lower() + "|" + (ip or "")


def _ip_key(ip: str) -> str:
    return "i:" + (ip or "")


def _remaining(key: str, now: float) -> float:
    rec = _login_attempts.get(key)
    if rec and rec["until"] > now:
        return rec["until"] - now
    return 0.0


def _touch(key: str, now: float, threshold: int) -> bool:
    window = config.login_lockout_seconds
    rec = _login_attempts.get(key)
    if not rec or rec["reset"] <= now:
        rec = {"fails": 0, "reset": now + window, "until": 0.0}
    rec["fails"] += 1
    tripped = False
    if rec["fails"] >= threshold and rec["until"] <= now:
        rec["until"] = now + window
        tripped = True
    _login_attempts[key] = rec
    return tripped


def _purge_expired(now: float) -> None:
    if len(_login_attempts) < _MAX_TRACKED:
        return
    for key in [k for k, r in _login_attempts.items() if r["reset"] <= now and r["until"] <= now]:
        _login_attempts.pop(key, None)


def login_locked(username: str, ip: str, now: Optional[float] = None) -> float:
    """Seconds remaining in a lockout for this username or IP, 0.0 if open."""
    now = time.time() if now is None else now
    with _login_lock:
        return max(_remaining(_pair_key(username, ip), now), _remaining(_ip_key(ip), now))


def note_login_failure(username: str, ip: str, now: Optional[float] = None) -> bool:
    """Record a failed attempt. Returns True if it tripped a new lockout."""
    now = time.time() if now is None else now
    with _login_lock:
        _purge_expired(now)
        pair = _touch(_pair_key(username, ip), now, config.login_max_attempts)
        by_ip = _touch(_ip_key(ip), now, config.login_max_attempts_per_ip)
        return pair or by_ip


def note_login_success(username: str, ip: str) -> None:
    """Clear a user's own lockout on success (leaves the shared per-IP bucket)."""
    with _login_lock:
        _login_attempts.pop(_pair_key(username, ip), None)


def reset_login_throttle() -> None:
    """Clear all throttling state (used by tests)."""
    with _login_lock:
        _login_attempts.clear()


# ----------------------------------------------------------------------------
# Password hashing (scrypt, stdlib)
# ----------------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, hash_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# ----------------------------------------------------------------------------
# Token signing
# ----------------------------------------------------------------------------
def _secret() -> bytes:
    if config.secret_key:
        return config.secret_key.encode()
    # Persist a generated secret so tokens survive restarts in dev.
    conn = get_conn()
    row = conn.execute("SELECT value FROM schema_meta WHERE key = 'secret_key'").fetchone()
    if row:
        return row["value"].encode()
    generated = secrets.token_hex(32)
    conn.execute(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('secret_key', ?)",
        (generated,),
    )
    conn.commit()
    return generated.encode()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def make_token(user_id: int, role: str, version: int = 0) -> str:
    # ``v`` must match users.token_version; bumping that column (e.g. on a
    # password change) revokes every token issued before.
    payload = {
        "sub": user_id,
        "role": role,
        "v": version,
        "exp": int(time.time()) + config.token_ttl_hours * 3600,
    }
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(_secret(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64(sig)}"


def verify_token(token: str) -> Optional[dict]:
    try:
        body, sig = token.split(".")
        expected = hmac.new(_secret(), body.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_unb64(sig), expected):
            return None
        payload = json.loads(_unb64(body))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


# A throwaway hash so the absent-user path still pays the scrypt cost, keeping
# authenticate() constant-time with respect to whether the username exists
# (otherwise a fast reply reveals a username does not exist).
_DUMMY_HASH = hash_password("keepstack-constant-time-placeholder")


def authenticate(username: str, password: str) -> Optional[dict]:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM users WHERE username = ? AND is_active = 1", (username,)
    ).fetchone()
    if row is None:
        verify_password(password, _DUMMY_HASH)  # equalise timing, then fail
        return None
    if verify_password(password, row["password_hash"]):
        return dict(row)
    return None
