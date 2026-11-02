"""Thumbnail and on-the-fly rendition generation.

Images get a real downscaled thumbnail. Everything else gets a tasteful
generated placeholder card (media-type glyph) so the asset grid stays
visually consistent without shelling out to ffmpeg/ghostscript. Renditions
are produced on demand and cached in the content-addressable thumb store.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import mmap
import re
import struct
from pathlib import Path
from typing import Optional

from PIL import Image, ImageDraw, ImageFont, ImageOps

from . import storage

THUMB_MAX = 512        # longest edge for grid thumbnails
PREVIEW_MAX = 1600     # longest edge for the detail-view preview

# Two-tone palette mirrored from the web UI so placeholders match the app.
_BASE = (238, 241, 246)
_ACCENT = (77, 104, 214)
_GLYPH = {
    "video": "▶",
    "audio": "♪",
    "document": "≡",
    "other": "◆",
}


def _placeholder(media_type: str, label: str) -> bytes:
    img = Image.new("RGB", (THUMB_MAX, THUMB_MAX), _BASE)
    draw = ImageDraw.Draw(img)
    glyph = _GLYPH.get(media_type, _GLYPH["other"])
    try:
        font = ImageFont.truetype("arial.ttf", 180)
        small = ImageFont.truetype("arial.ttf", 34)
    except Exception:
        font = ImageFont.load_default()
        small = ImageFont.load_default()
    draw.text((THUMB_MAX / 2, THUMB_MAX / 2 - 30), glyph, font=font, fill=_ACCENT, anchor="mm")
    draw.text((THUMB_MAX / 2, THUMB_MAX - 70), label[:22], font=small, fill=(100, 112, 138), anchor="mm")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


# Adobe apps (Illustrator, InDesign, Acrobat) embed a preview in the file
# itself, either a JPEG in the XMP packet or a TIFF behind a DOS EPS header,
# so we can show it without a PostScript/PDF renderer.
_EMBEDDED_PREVIEW_EXT = {"ai", "eps", "indd", "pdf"}
_XMP_THUMB_RE = re.compile(rb"<xmpGImg:image>\s*([A-Za-z0-9+/=\s&#xA;]+?)\s*</xmpGImg:image>")


def _xmp_preview(blob: Path) -> Optional[Image.Image]:
    with open(blob, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        m = _XMP_THUMB_RE.search(mm)
        if not m:
            return None
        raw = base64.b64decode(re.sub(rb"&#xA;|\s", b"", m.group(1)))
    img = Image.open(io.BytesIO(raw))
    img.load()
    return img


def _palette_alpha_tiff(tiff: bytes) -> Optional[Image.Image]:
    """Decode the uncompressed palette+alpha TIFF Illustrator writes, which
    Pillow cannot read (it has no mode for a palette with an extra sample)."""
    if tiff[:4] != b"II*\x00":
        return None
    ifd = struct.unpack_from("<I", tiff, 4)[0]
    tags = {}
    for i in range(struct.unpack_from("<H", tiff, ifd)[0]):
        tag, typ, count, val = struct.unpack_from("<HHII", tiff, ifd + 2 + 12 * i)
        tags[tag] = val & 0xFFFF if typ == 3 and count == 1 else val
    # photometric=palette, uncompressed, 8-bit, chunky, single strip
    if (tags.get(262), tags.get(259, 1), tags.get(258), tags.get(284, 1)) != (3, 1, 8, 1) or 320 not in tags:
        return None
    w, h, spp = tags[256], tags[257], tags.get(277, 1)
    px = tiff[tags[273]:tags[273] + w * h * spp]
    pal = struct.unpack_from("<768H", tiff, tags[320])
    img = Image.frombytes("P", (w, h), px[0::spp])
    img.putpalette([pal[c * 256 + i] >> 8 for i in range(256) for c in range(3)])
    img = img.convert("RGB")
    if spp == 2:
        alpha = Image.frombytes("L", (w, h), px[1::2])
        img = Image.composite(img, Image.new("RGB", (w, h), "white"), alpha)
    return img


def _eps_tiff_preview(blob: Path) -> Optional[Image.Image]:
    """TIFF preview from a DOS EPS binary header (also used by many .ai files)."""
    with open(blob, "rb") as f:
        header = f.read(28)
        if len(header) < 28 or header[:4] != b"\xc5\xd0\xd3\xc6":
            return None
        offset, length = struct.unpack_from("<II", header, 20)
        if not length:
            return None
        f.seek(offset)
        tiff = f.read(length)
    try:
        img = Image.open(io.BytesIO(tiff))
        img.load()
        return img
    except OSError:
        return _palette_alpha_tiff(tiff)


def _embedded_preview(blob: Path, max_edge: int) -> Optional[bytes]:
    """Largest preview the file carries itself (EPS TIFF or XMP JPEG)."""
    candidates = []
    for extract in (_eps_tiff_preview, _xmp_preview):
        try:
            img = extract(blob)
        except (OSError, ValueError, struct.error, binascii.Error):
            img = None
        if img is not None:
            candidates.append(img)
    if not candidates:
        return None
    img = max(candidates, key=lambda i: i.width * i.height)
    img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
    img.thumbnail((max_edge, max_edge), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82)
    return buf.getvalue()


def make_thumbnail(blob: Path, media_type: str, ext: str, max_edge: int = THUMB_MAX) -> bytes:
    if ext.lower() in _EMBEDDED_PREVIEW_EXT:
        data = _embedded_preview(blob, max_edge)
        if data:
            return data
    if media_type == "image":
        try:
            with Image.open(blob) as img:
                img = ImageOps.exif_transpose(img)
                img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
                img.thumbnail((max_edge, max_edge), Image.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=82)
                return buf.getvalue()
        except Exception:
            return _placeholder("other", ext.upper())
    return _placeholder(media_type, ext.upper())


def ensure_thumbnail(sha: str, blob_key: str, media_type: str, ext: str) -> str:
    """Generate (if needed) and cache a grid thumbnail. Returns its key."""
    key = f"{sha[:2]}/{sha[2:4]}/{sha}_thumb.jpg"
    out = storage.thumb_path(key)
    if not out.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
        data = make_thumbnail(storage.blob_path(blob_key), media_type, ext)
        out.write_bytes(data)
    return key


def rendition(sha: str, blob_key: str, media_type: str, ext: str, max_edge: int) -> Optional[bytes]:
    """On-the-fly resized rendition (cached). Images and embedded previews only."""
    if media_type != "image" and ext.lower() not in _EMBEDDED_PREVIEW_EXT:
        return None
    key = f"{sha[:2]}/{sha[2:4]}/{sha}_{max_edge}.jpg"
    out = storage.thumb_path(key)
    if out.exists():
        return out.read_bytes()
    data = make_thumbnail(storage.blob_path(blob_key), media_type, ext, max_edge=max_edge)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return data


def _parse_region(img: Image.Image, region: str) -> tuple[int, int, int, int]:
    width, height = img.size
    if region == "full":
        return 0, 0, width, height
    if region == "square":
        edge = min(width, height)
        return (width - edge) // 2, (height - edge) // 2, edge, edge

    percent = region.startswith("pct:")
    raw = region[4:] if percent else region
    parts = raw.split(",")
    if len(parts) != 4:
        raise ValueError("IIIF region must be full, square, x,y,w,h, or pct:x,y,w,h")

    try:
        values = [float(p) for p in parts]
    except ValueError as exc:
        raise ValueError("IIIF region values must be numeric") from exc

    if percent:
        x = round(width * values[0] / 100)
        y = round(height * values[1] / 100)
        w = round(width * values[2] / 100)
        h = round(height * values[3] / 100)
    else:
        x, y, w, h = [round(v) for v in values]

    if x < 0 or y < 0 or w <= 0 or h <= 0 or x >= width or y >= height:
        raise ValueError("IIIF region is outside the image")

    w = min(w, width - x)
    h = min(h, height - y)
    return x, y, w, h


def _apply_size(img: Image.Image, size: str) -> Image.Image:
    if size in ("full", "max"):
        return img

    best_fit = size.startswith("!")
    raw = size[1:] if best_fit else size
    parts = raw.split(",")
    if len(parts) != 2:
        raise ValueError("IIIF size must be full, max, w,, ,h, w,h, or !w,h")

    try:
        target_w = int(parts[0]) if parts[0] else None
        target_h = int(parts[1]) if parts[1] else None
    except ValueError as exc:
        raise ValueError("IIIF size values must be integers") from exc

    if target_w is not None and target_w <= 0:
        raise ValueError("IIIF width must be positive")
    if target_h is not None and target_h <= 0:
        raise ValueError("IIIF height must be positive")
    if target_w is None and target_h is None:
        raise ValueError("IIIF size must include width or height")

    width, height = img.size
    if target_w is None:
        target_w = max(1, round(width * target_h / height))
    elif target_h is None:
        target_h = max(1, round(height * target_w / width))
    elif best_fit:
        scale = min(target_w / width, target_h / height)
        target_w = max(1, round(width * scale))
        target_h = max(1, round(height * scale))

    return img.resize((target_w, target_h), Image.LANCZOS)


def _apply_rotation(img: Image.Image, rotation: str) -> Image.Image:
    mirror = rotation.startswith("!")
    raw = rotation[1:] if mirror else rotation
    try:
        degrees = float(raw)
    except ValueError as exc:
        raise ValueError("IIIF rotation must be numeric") from exc

    if mirror:
        img = ImageOps.mirror(img)
    if degrees % 360:
        img = img.rotate(-degrees, expand=True, resample=Image.BICUBIC)
    return img


def iiif_rendition(
    sha: str,
    blob_key: str,
    media_type: str,
    region: str,
    size: str,
    rotation: str,
) -> Optional[bytes]:
    """IIIF Image API level-2 region, size, and rotation rendition."""
    if media_type != "image":
        return None

    token = hashlib.sha256(f"{region}|{size}|{rotation}".encode("utf-8")).hexdigest()[:16]
    key = f"{sha[:2]}/{sha[2:4]}/{sha}_iiif_{token}.jpg"
    out = storage.thumb_path(key)
    if out.exists():
        return out.read_bytes()

    with Image.open(storage.blob_path(blob_key)) as img:
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
        x, y, w, h = _parse_region(img, region)
        img = img.crop((x, y, x + w, y + h))
        img = _apply_size(img, size)
        img = _apply_rotation(img, rotation)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=82)
        data = buf.getvalue()

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return data
