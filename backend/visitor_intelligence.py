"""
Visitor Intelligence, Consent-Based GPS Tracking & Location Analytics Module
for MediTrack (SQLite + Python 3.11 stdlib).
"""

from __future__ import annotations

import csv
import hashlib
import hmac
import io
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request as UrlRequest, urlopen

RATE_LOCK = threading.RLock()
LOGIN_FAILURES: dict[str, list[float]] = {}
INGEST_REQUESTS: dict[str, list[float]] = {}

VALID_PAGE_PATTERN = re.compile(r"^/[A-Za-z0-9\-._~/?=&%#]*$")
VALID_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

ALLOWED_PROVIDERS = ("ipwhois", "ipapi", "ipinfo", "custom", "disabled")
SORT_COLUMN_MAP = {
    "latest": "s.last_active_at",
    "started": "s.started_at",
    "duration": "s.duration_sec",
    "location": "COALESCE(s.city, s.country, '')",
    "source": "s.location_source",
    "browser": "s.browser",
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def utc_now_iso() -> str:
    return utc_now().isoformat()


def clean_text(value: Any, max_len: int = 160, default: str = "") -> str:
    if value is None:
        return default
    txt = str(value).strip()
    txt = re.sub(r"[\x00-\x1f\x7f]", "", txt)
    if not txt:
        return default
    return txt[:max_len]


def sanitize_page_path(path: Any) -> str:
    txt = clean_text(path, 240, "/")
    if not txt.startswith("/"):
        txt = "/" + txt.lstrip("/")
    if not VALID_ID_PATTERN.match(txt) and not VALID_PAGE_PATTERN.match(txt):
        return "/"
    return txt


def sanitize_referrer(ref: Any) -> str:
    txt = clean_text(ref, 200, "Direct")
    if not txt or txt.lower() in ("none", "null", "undefined"):
        return "Direct"
    if txt.startswith(("http://", "https://")):
        parsed = urlparse(txt)
        host = parsed.hostname or "External"
        return host[:120]
    return txt[:120]


def parse_user_agent(ua: str) -> dict[str, str]:
    """Minimal, non-invasive User-Agent parser (no browser fingerprinting)."""
    raw = (ua or "").strip()
    low = raw.lower()

    if any(tok in low for tok in ("bot", "crawler", "spider", "curl", "python-urllib")):
        device = "bot"
    elif "ipad" in low or "tablet" in low or ("android" in low and "mobile" not in low):
        device = "tablet"
    elif any(tok in low for tok in ("mobile", "iphone", "ipod", "android")):
        device = "mobile"
    elif raw:
        device = "desktop"
    else:
        device = "unknown"

    if "edg/" in low or "edge/" in low:
        browser = "Edge"
    elif "opr/" in low or "opera" in low:
        browser = "Opera"
    elif "firefox/" in low or "fxios/" in low:
        browser = "Firefox"
    elif "brave" in low:
        browser = "Brave"
    elif "chrome/" in low or "crios/" in low:
        browser = "Chrome"
    elif "safari/" in low:
        browser = "Safari"
    else:
        browser = "Other"

    if "windows" in low:
        os_family = "Windows"
    elif "android" in low:
        os_family = "Android"
    elif "iphone" in low or "ipad" in low or "ios" in low:
        os_family = "iOS"
    elif "mac os" in low or "macintosh" in low:
        os_family = "macOS"
    elif "linux" in low:
        os_family = "Linux"
    else:
        os_family = "Other"

    return {"device_category": device, "browser": browser, "os_family": os_family}


def init_visitor_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS visitor_profiles (
            visitor_id TEXT PRIMARY KEY,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            visit_count INTEGER NOT NULL DEFAULT 1,
            gps_consent_status TEXT NOT NULL DEFAULT 'unset',
            gps_consent_updated_at TEXT,
            continuous_gps_consent INTEGER NOT NULL DEFAULT 0,
            ip_geo_consent INTEGER NOT NULL DEFAULT 1,
            analytics_opt_out INTEGER NOT NULL DEFAULT 0,
            device_category TEXT NOT NULL DEFAULT 'unknown',
            browser TEXT NOT NULL DEFAULT 'Other',
            os_family TEXT NOT NULL DEFAULT 'Other'
        );

        CREATE TABLE IF NOT EXISTS visitor_sessions (
            session_id TEXT PRIMARY KEY,
            visitor_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            last_active_at TEXT NOT NULL,
            duration_sec INTEGER NOT NULL DEFAULT 0,
            is_returning INTEGER NOT NULL DEFAULT 0,
            landing_page TEXT NOT NULL,
            current_page TEXT NOT NULL,
            referrer_source TEXT NOT NULL DEFAULT 'Direct',
            page_views_count INTEGER NOT NULL DEFAULT 1,
            device_category TEXT NOT NULL DEFAULT 'unknown',
            browser TEXT NOT NULL DEFAULT 'Other',
            location_source TEXT NOT NULL DEFAULT 'none',
            latitude REAL,
            longitude REAL,
            accuracy_m REAL,
            location_timestamp TEXT,
            country TEXT,
            region TEXT,
            city TEXT,
            ip_hash TEXT,
            gps_consent_status TEXT NOT NULL DEFAULT 'unset',
            is_ended INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (visitor_id) REFERENCES visitor_profiles(visitor_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS visitor_page_views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            visitor_id TEXT NOT NULL,
            page_path TEXT NOT NULL,
            page_title TEXT NOT NULL DEFAULT '',
            referrer_source TEXT NOT NULL DEFAULT 'Direct',
            viewed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS visitor_location_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            visitor_id TEXT NOT NULL,
            location_source TEXT NOT NULL,
            latitude REAL,
            longitude REAL,
            accuracy_m REAL,
            country TEXT,
            region TEXT,
            city TEXT,
            recorded_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS visitor_consent_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visitor_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            consent_type TEXT NOT NULL,
            status TEXT NOT NULL,
            recorded_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS admin_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
            token_hash TEXT PRIMARY KEY,
            admin_label TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS admin_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_key TEXT UNIQUE,
            severity TEXT NOT NULL DEFAULT 'info',
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            acknowledged INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_vs_visitor_id ON visitor_sessions(visitor_id);
        CREATE INDEX IF NOT EXISTS idx_vs_last_active ON visitor_sessions(last_active_at);
        CREATE INDEX IF NOT EXISTS idx_vs_started_at ON visitor_sessions(started_at);
        CREATE INDEX IF NOT EXISTS idx_vpv_session ON visitor_page_views(session_id);
        CREATE INDEX IF NOT EXISTS idx_vle_visitor ON visitor_location_events(visitor_id);
        """
    )

    now = utc_now_iso()
    defaults = [
        ("retention_days", "90"),
        ("ip_geo_provider", os.environ.get("IP_GEO_PROVIDER", "ipwhois").strip().lower() or "ipwhois"),
        ("ip_hash_salt", secrets.token_hex(16)),
    ]
    for k, v in defaults:
        conn.execute(
            "INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, ?)",
            (k, v, now),
        )
    conn.commit()


def _get_setting(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM admin_settings WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else default


def _set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO admin_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value, utc_now_iso()),
    )
    conn.commit()


def extract_client_ip(headers: Any, remote_addr: str = "") -> str:
    xff = ""
    xri = ""
    if headers is not None:
        xff = str(headers.get("X-Forwarded-For") or headers.get("x-forwarded-for") or "")
        xri = str(headers.get("X-Real-IP") or headers.get("x-real-ip") or "")

    candidates: list[str] = []
    if xff:
        for part in xff.split(","):
            p = part.strip()
            if p:
                candidates.append(p)
    if xri:
        candidates.append(xri.strip())
    if remote_addr:
        candidates.append(remote_addr.strip())

    for cand in candidates:
        cleaned = cand.split("%")[0]
        if cleaned.startswith("::ffff:"):
            cleaned = cleaned[7:]
        try:
            ip_obj = ipaddress.ip_address(cleaned)
            if ip_obj.is_global:
                return str(ip_obj)
        except ValueError:
            continue

    for cand in candidates:
        cleaned = cand.split("%")[0]
        if cleaned.startswith("::ffff:"):
            cleaned = cleaned[7:]
        try:
            return str(ipaddress.ip_address(cleaned))
        except ValueError:
            continue
    return "127.0.0.1"


def hash_ip(conn: sqlite3.Connection, ip_str: str) -> str:
    salt = os.environ.get("VISITOR_IP_SALT") or _get_setting(conn, "ip_hash_salt", "meditrack-salt")
    return hmac.new(salt.encode("utf-8"), ip_str.encode("utf-8"), hashlib.sha256).hexdigest()[:24]


def check_rate_limit(bucket: dict[str, list[float]], key: str, limit: int, window_sec: int) -> bool:
    now_ts = time.time()
    cutoff = now_ts - window_sec
    with RATE_LOCK:
        stamps = [ts for ts in bucket.get(key, []) if ts >= cutoff]
        if len(stamps) >= limit:
            bucket[key] = stamps
            return False
        stamps.append(now_ts)
        bucket[key] = stamps
        return True


def _record_login_failure(key: str) -> None:
    now_ts = time.time()
    with RATE_LOCK:
        stamps = [ts for ts in LOGIN_FAILURES.get(key, []) if ts >= now_ts - 300]
        stamps.append(now_ts)
        LOGIN_FAILURES[key] = stamps


def _is_login_blocked(key: str) -> bool:
    now_ts = time.time()
    with RATE_LOCK:
        stamps = [ts for ts in LOGIN_FAILURES.get(key, []) if ts >= now_ts - 300]
        LOGIN_FAILURES[key] = stamps
        return len(stamps) >= 10


def _clear_login_failures(key: str) -> None:
    with RATE_LOCK:
        LOGIN_FAILURES.pop(key, None)


def _hash_passcode(passcode: str, salt_hex: str | None = None) -> str:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    derived = hashlib.scrypt(passcode.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${derived.hex()}"


def _verify_passcode_hash(passcode: str, stored: str) -> bool:
    try:
        scheme, salt_hex, hash_hex = stored.split("$", 2)
        if scheme != "scrypt":
            return False
        computed = _hash_passcode(passcode, salt_hex)
        return hmac.compare_digest(computed, stored)
    except Exception:
        return False


def get_configured_env_passcode() -> str:
    return (
        os.environ.get("ADMIN_PASSCODE")
        or os.environ.get("ADMIN_PASSWORD")
        or ""
    ).strip()


def get_admin_auth_status(conn: sqlite3.Connection, auth_header: str | None) -> dict[str, Any]:
    env_code = get_configured_env_passcode()
    stored_hash = _get_setting(conn, "admin_password_hash", "")
    source = "env" if env_code else ("claimed" if stored_hash else "unconfigured")
    configured = source != "unconfigured"

    session = verify_admin_bearer(conn, auth_header)
    return {
        "configured": configured,
        "source": source,
        "authenticated": session is not None,
        "adminLabel": session["admin_label"] if session else None,
        "expiresAt": session["expires_at"] if session else None,
    }


def setup_initial_admin(conn: sqlite3.Connection, passcode: str) -> dict[str, Any]:
    env_code = get_configured_env_passcode()
    if env_code:
        raise PermissionError("Admin passcode is already managed via server environment variables.")
    existing = _get_setting(conn, "admin_password_hash", "")
    if existing:
        raise PermissionError("Admin account has already been configured.")
    clean_pw = (passcode or "").strip()
    if len(clean_pw) < 8:
        raise ValueError("Admin passcode must be at least 8 characters long.")
    hashed = _hash_passcode(clean_pw)
    _set_setting(conn, "admin_password_hash", hashed)
    return _issue_admin_session(conn, "MediTrack Administrator")


def _issue_admin_session(conn: sqlite3.Connection, admin_label: str) -> dict[str, Any]:
    now = utc_now()
    expires = (now + timedelta(hours=24)).isoformat()
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    conn.execute("DELETE FROM admin_sessions WHERE expires_at <= ?", (now.isoformat(),))
    conn.execute(
        """
        INSERT INTO admin_sessions (token_hash, admin_label, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        (token_hash, admin_label, now.isoformat(), expires),
    )
    conn.commit()
    return {"token": raw_token, "expiresAt": expires, "adminLabel": admin_label}


def login_admin(conn: sqlite3.Connection, passcode: str, ip_key: str) -> tuple[int, dict[str, Any]]:
    if _is_login_blocked(ip_key):
        return 429, {"error": "Too many failed login attempts. Try again in 5 minutes."}

    candidate = (passcode or "").strip()
    if not candidate:
        return 400, {"error": "Passcode is required."}

    env_code = get_configured_env_passcode()
    if env_code:
        ok = hmac.compare_digest(candidate, env_code)
    else:
        stored_hash = _get_setting(conn, "admin_password_hash", "")
        if not stored_hash:
            return 409, {"error": "Admin passcode is not configured yet. Complete initial setup first."}
        ok = _verify_passcode_hash(candidate, stored_hash)

    if not ok:
        _record_login_failure(ip_key)
        return 401, {"error": "Invalid administrator passcode."}

    _clear_login_failures(ip_key)
    session = _issue_admin_session(conn, "MediTrack Administrator")
    return 200, session


def verify_admin_bearer(conn: sqlite3.Connection, auth_header: str | None) -> dict[str, Any] | None:
    if not auth_header:
        return None
    parts = auth_header.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    raw_token = parts[1].strip()
    if not raw_token:
        return None
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    now_iso = utc_now_iso()
    row = conn.execute(
        "SELECT token_hash, admin_label, created_at, expires_at FROM admin_sessions WHERE token_hash = ?",
        (token_hash,),
    ).fetchone()
    if not row or str(row["expires_at"]) <= now_iso:
        if row:
            conn.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (token_hash,))
            conn.commit()
        return None
    return {
        "admin_label": str(row["admin_label"]),
        "expires_at": str(row["expires_at"]),
    }


def logout_admin(conn: sqlite3.Connection, auth_header: str | None) -> None:
    if not auth_header:
        return
    parts = auth_header.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return
    token_hash = hashlib.sha256(parts[1].strip().encode("utf-8")).hexdigest()
    conn.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (token_hash,))
    conn.commit()


def is_safe_public_https_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            return False
        host = (parsed.hostname or "").strip().lower()
        if not host or host in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
            return False
        try:
            ip_obj = ipaddress.ip_address(host)
            if (
                ip_obj.is_private
                or ip_obj.is_loopback
                or ip_obj.is_link_local
                or ip_obj.is_reserved
                or ip_obj.is_multicast
            ):
                return False
        except ValueError:
            pass
        return True
    except Exception:
        return False


def resolve_ip_geo_provider(conn: sqlite3.Connection) -> str:
    env_p = os.environ.get("IP_GEO_PROVIDER", "").strip().lower()
    if env_p in ALLOWED_PROVIDERS:
        return env_p
    stored = _get_setting(conn, "ip_geo_provider", "ipwhois").strip().lower()
    return stored if stored in ALLOWED_PROVIDERS else "ipwhois"


def build_ip_geo_url(provider: str, client_ip: str, api_key: str = "", custom_template: str = "") -> str | None:
    try:
        ip_obj = ipaddress.ip_address(client_ip)
        if not ip_obj.is_global:
            return None
        safe_ip = quote(str(ip_obj))
    except ValueError:
        return None

    if provider == "disabled":
        return None
    if provider == "ipwhois":
        return f"https://ipwho.is/{safe_ip}"
    if provider == "ipapi":
        base = f"https://ipapi.co/{safe_ip}/json/"
        return f"{base}?key={quote(api_key)}" if api_key else base
    if provider == "ipinfo":
        base = f"https://ipinfo.io/{safe_ip}/json"
        return f"{base}?token={quote(api_key)}" if api_key else base
    if provider == "custom" and custom_template:
        candidate = custom_template.replace("{ip}", safe_ip)
        if api_key and "{key}" in candidate:
            candidate = candidate.replace("{key}", quote(api_key))
        return candidate if is_safe_public_https_url(candidate) else None
    return None


def parse_ip_geo_response(provider: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    if provider == "ipwhois" and payload.get("success") is False:
        return None
    if payload.get("error"):
        return None

    country = clean_text(payload.get("country_name") or payload.get("country"), 80)
    region = clean_text(payload.get("region") or payload.get("regionName"), 80)
    city = clean_text(payload.get("city"), 80)

    lat_val = payload.get("latitude") or payload.get("lat")
    lng_val = payload.get("longitude") or payload.get("lon") or payload.get("lng")
    if (lat_val is None or lng_val is None) and isinstance(payload.get("loc"), str):
        loc_parts = payload["loc"].split(",")
        if len(loc_parts) == 2:
            lat_val, lng_val = loc_parts[0], loc_parts[1]

    lat_f: float | None = None
    lng_f: float | None = None
    try:
        if lat_val is not None and lng_val is not None:
            cand_lat = float(lat_val)
            cand_lng = float(lng_val)
            if -90.0 <= cand_lat <= 90.0 and -180.0 <= cand_lng <= 180.0:
                lat_f = round(cand_lat, 4)
                lng_f = round(cand_lng, 4)
    except (TypeError, ValueError):
        lat_f = None
        lng_f = None

    if not country and not city and lat_f is None:
        return None

    return {
        "country": country or "Unknown",
        "region": region or "Unknown",
        "city": city or "Unknown",
        "latitude": lat_f,
        "longitude": lng_f,
    }


def lookup_ip_location(conn: sqlite3.Connection, client_ip: str) -> dict[str, Any] | None:
    provider = resolve_ip_geo_provider(conn)
    api_key = os.environ.get("IP_GEO_API_KEY", "").strip()
    template = os.environ.get("IP_GEO_ENDPOINT_TEMPLATE", "").strip()
    url = build_ip_geo_url(provider, client_ip, api_key=api_key, custom_template=template)
    if not url or not is_safe_public_https_url(url):
        return None

    try:
        req = UrlRequest(url, headers={"User-Agent": "MediTrack-VisitorIntel/1.0"})
        with urlopen(req, timeout=3.5) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        return parse_ip_geo_response(provider, raw)
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return None


def _maybe_create_traffic_notifications(conn: sqlite3.Connection) -> None:
    now = utc_now()
    today_prefix = now.date().isoformat()
    active_cutoff = (now - timedelta(minutes=5)).isoformat()

    active_count = conn.execute(
        "SELECT COUNT(*) FROM visitor_sessions WHERE is_ended = 0 AND last_active_at >= ?",
        (active_cutoff,),
    ).fetchone()[0]
    if active_count >= 5:
        ev_key = f"active_spike_{today_prefix}_{active_count // 5 * 5}"
        conn.execute(
            """
            INSERT OR IGNORE INTO admin_notifications (event_key, severity, title, message, created_at)
            VALUES (?, 'warning', ?, ?, ?)
            """,
            (
                ev_key,
                "Active Visitor Traffic Spike",
                f"{active_count} concurrent active sessions detected in the last 5 minutes.",
                now.isoformat(),
            ),
        )

    today_count = conn.execute(
        "SELECT COUNT(*) FROM visitor_sessions WHERE started_at >= ?",
        (today_prefix,),
    ).fetchone()[0]
    if today_count >= 10:
        ev_key = f"daily_milestone_{today_prefix}_{today_count // 10 * 10}"
        conn.execute(
            """
            INSERT OR IGNORE INTO admin_notifications (event_key, severity, title, message, created_at)
            VALUES (?, 'info', ?, ?, ?)
            """,
            (
                ev_key,
                "Daily Traffic Milestone",
                f"MediTrack has recorded {today_count} visitor sessions today.",
                now.isoformat(),
            ),
        )
    conn.commit()


def register_visit(
    conn: sqlite3.Connection,
    body: dict[str, Any],
    user_agent: str,
    client_ip: str,
) -> dict[str, Any]:
    now = utc_now_iso()
    req_visitor_id = clean_text(body.get("visitor_id"), 64)
    req_session_id = clean_text(body.get("session_id"), 64)
    landing_page = sanitize_page_path(body.get("landing_page") or body.get("page_path") or "/")
    page_title = clean_text(body.get("page_title"), 140, "MediTrack")
    referrer_source = sanitize_referrer(body.get("referrer_source"))

    ua_meta = parse_user_agent(user_agent)
    device_category = clean_text(body.get("device_category"), 32) or ua_meta["device_category"]
    browser = clean_text(body.get("browser"), 40) or ua_meta["browser"]
    os_family = ua_meta["os_family"]

    if req_visitor_id and VALID_ID_PATTERN.match(req_visitor_id):
        visitor_id = req_visitor_id
    else:
        visitor_id = f"VIS-{secrets.token_hex(6).upper()}"

    if req_session_id and VALID_ID_PATTERN.match(req_session_id):
        session_id = req_session_id
    else:
        session_id = f"SES-{secrets.token_hex(8).upper()}"

    profile = conn.execute(
        "SELECT * FROM visitor_profiles WHERE visitor_id = ?",
        (visitor_id,),
    ).fetchone()

    if profile and int(profile["analytics_opt_out"]) == 1:
        return {
            "opted_out": True,
            "visitor_id": visitor_id,
            "session_id": session_id,
            "gps_consent_status": str(profile["gps_consent_status"]),
            "continuous_gps_consent": False,
        }

    existing_session = conn.execute(
        "SELECT * FROM visitor_sessions WHERE session_id = ?",
        (session_id,),
    ).fetchone()

    is_returning = 0
    if profile:
        if existing_session:
            is_returning = int(existing_session["is_returning"])
        else:
            is_returning = 1
            conn.execute(
                """
                UPDATE visitor_profiles
                SET last_seen_at = ?, visit_count = visit_count + 1, device_category = ?, browser = ?, os_family = ?
                WHERE visitor_id = ?
                """,
                (now, device_category, browser, os_family, visitor_id),
            )
    else:
        conn.execute(
            """
            INSERT INTO visitor_profiles (
                visitor_id, first_seen_at, last_seen_at, visit_count,
                gps_consent_status, device_category, browser, os_family
            ) VALUES (?, ?, ?, 1, 'unset', ?, ?, ?)
            """,
            (visitor_id, now, now, device_category, browser, os_family),
        )

    profile = conn.execute(
        "SELECT * FROM visitor_profiles WHERE visitor_id = ?",
        (visitor_id,),
    ).fetchone()
    consent_status = str(profile["gps_consent_status"]) if profile else "unset"
    continuous_consent = bool(profile["continuous_gps_consent"]) if profile else False
    ip_geo_allowed = bool(profile["ip_geo_consent"]) if profile else True

    ip_hashed = hash_ip(conn, client_ip)

    if not existing_session:
        conn.execute(
            """
            INSERT INTO visitor_sessions (
                session_id, visitor_id, started_at, last_active_at, duration_sec,
                is_returning, landing_page, current_page, referrer_source, page_views_count,
                device_category, browser, location_source, ip_hash, gps_consent_status, is_ended
            ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?, 'none', ?, ?, 0)
            """,
            (
                session_id,
                visitor_id,
                now,
                now,
                is_returning,
                landing_page,
                landing_page,
                referrer_source,
                device_category,
                browser,
                ip_hashed,
                consent_status,
            ),
        )
        conn.execute(
            """
            INSERT INTO visitor_page_views (
                session_id, visitor_id, page_path, page_title, referrer_source, viewed_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_id, visitor_id, landing_page, page_title, referrer_source, now),
        )
    else:
        conn.execute(
            "UPDATE visitor_sessions SET last_active_at = ?, is_ended = 0 WHERE session_id = ?",
            (now, session_id),
        )

    session_row = conn.execute(
        "SELECT * FROM visitor_sessions WHERE session_id = ?",
        (session_id,),
    ).fetchone()

    # Run IP fallback only if GPS is not granted/active for this session and IP lookup hasn't run yet
    if (
        session_row
        and ip_geo_allowed
        and str(session_row["location_source"]) == "none"
        and consent_status != "granted"
    ):
        ip_loc = lookup_ip_location(conn, client_ip)
        if ip_loc:
            conn.execute(
                """
                UPDATE visitor_sessions
                SET location_source = 'ip', latitude = ?, longitude = ?, accuracy_m = NULL,
                    location_timestamp = ?, country = ?, region = ?, city = ?
                WHERE session_id = ? AND location_source != 'gps'
                """,
                (
                    ip_loc["latitude"],
                    ip_loc["longitude"],
                    now,
                    ip_loc["country"],
                    ip_loc["region"],
                    ip_loc["city"],
                    session_id,
                ),
            )
            conn.execute(
                """
                INSERT INTO visitor_location_events (
                    session_id, visitor_id, location_source, latitude, longitude,
                    accuracy_m, country, region, city, recorded_at
                ) VALUES (?, ?, 'ip', ?, ?, NULL, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    visitor_id,
                    ip_loc["latitude"],
                    ip_loc["longitude"],
                    ip_loc["country"],
                    ip_loc["region"],
                    ip_loc["city"],
                    now,
                ),
            )

    conn.commit()
    _maybe_create_traffic_notifications(conn)

    final_sess = conn.execute(
        "SELECT * FROM visitor_sessions WHERE session_id = ?",
        (session_id,),
    ).fetchone()

    return {
        "opted_out": False,
        "visitor_id": visitor_id,
        "session_id": session_id,
        "is_returning": bool(is_returning),
        "gps_consent_status": consent_status,
        "continuous_gps_consent": continuous_consent,
        "location_source": str(final_sess["location_source"]) if final_sess else "none",
    }


def record_page_view_or_heartbeat(conn: sqlite3.Connection, body: dict[str, Any]) -> dict[str, Any]:
    visitor_id = clean_text(body.get("visitor_id"), 64)
    session_id = clean_text(body.get("session_id"), 64)
    if not visitor_id or not session_id:
        raise ValueError("visitor_id and session_id are required.")

    profile = conn.execute(
        "SELECT analytics_opt_out FROM visitor_profiles WHERE visitor_id = ?",
        (visitor_id,),
    ).fetchone()
    if profile and int(profile["analytics_opt_out"]) == 1:
        return {"ok": True, "opted_out": True}

    sess = conn.execute(
        "SELECT * FROM visitor_sessions WHERE session_id = ? AND visitor_id = ?",
        (session_id, visitor_id),
    ).fetchone()
    if not sess:
        raise LookupError("Visitor session not found.")

    now_dt = utc_now()
    now_iso = now_dt.isoformat()
    try:
        started_dt = datetime.fromisoformat(str(sess["started_at"]))
        computed_dur = max(0, int((now_dt - started_dt).total_seconds()))
    except Exception:
        computed_dur = int(sess["duration_sec"] or 0)

    req_dur = body.get("duration_sec")
    if isinstance(req_dur, (int, float)) and 0 <= req_dur <= 86400:
        duration_sec = max(computed_dur, int(req_dur))
    else:
        duration_sec = computed_dur

    event_type = clean_text(body.get("event_type"), 24, "heartbeat")
    page_path = sanitize_page_path(body.get("page_path") or sess["current_page"])
    page_title = clean_text(body.get("page_title"), 140, "MediTrack")
    referrer = sanitize_referrer(body.get("referrer_source") or sess["referrer_source"])
    is_ended = 1 if event_type == "end" else 0

    if event_type == "pageview":
        conn.execute(
            """
            INSERT INTO visitor_page_views (
                session_id, visitor_id, page_path, page_title, referrer_source, viewed_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_id, visitor_id, page_path, page_title, referrer, now_iso),
        )
        conn.execute(
            """
            UPDATE visitor_sessions
            SET last_active_at = ?, duration_sec = ?, current_page = ?, page_views_count = page_views_count + 1, is_ended = 0
            WHERE session_id = ?
            """,
            (now_iso, duration_sec, page_path, session_id),
        )
    else:
        conn.execute(
            """
            UPDATE visitor_sessions
            SET last_active_at = ?, duration_sec = ?, current_page = ?, is_ended = CASE WHEN ? = 1 THEN 1 ELSE is_ended END
            WHERE session_id = ?
            """,
            (now_iso, duration_sec, page_path, is_ended, session_id),
        )

    conn.execute(
        "UPDATE visitor_profiles SET last_seen_at = ? WHERE visitor_id = ?",
        (now_iso, visitor_id),
    )
    conn.commit()
    return {"ok": True, "duration_sec": duration_sec}


def update_visitor_consent(
    conn: sqlite3.Connection,
    body: dict[str, Any],
    client_ip: str,
) -> dict[str, Any]:
    visitor_id = clean_text(body.get("visitor_id"), 64)
    session_id = clean_text(body.get("session_id"), 64)
    consent_type = clean_text(body.get("consent_type"), 32, "gps")
    status = clean_text(body.get("status"), 32)
    if not visitor_id or not session_id:
        raise ValueError("visitor_id and session_id are required.")
    if consent_type not in ("gps", "continuous_gps", "analytics"):
        raise ValueError("Invalid consent_type.")

    profile = conn.execute(
        "SELECT * FROM visitor_profiles WHERE visitor_id = ?",
        (visitor_id,),
    ).fetchone()
    if not profile:
        raise LookupError("Visitor profile not found.")

    now = utc_now_iso()
    if consent_type == "gps":
        if status not in ("granted", "denied", "revoked"):
            raise ValueError("Invalid GPS consent status.")
        conn.execute(
            """
            UPDATE visitor_profiles
            SET gps_consent_status = ?, gps_consent_updated_at = ?,
                continuous_gps_consent = CASE WHEN ? IN ('denied', 'revoked') THEN 0 ELSE continuous_gps_consent END
            WHERE visitor_id = ?
            """,
            (status, now, status, visitor_id),
        )
        conn.execute(
            "UPDATE visitor_sessions SET gps_consent_status = ? WHERE session_id = ?",
            (status, session_id),
        )
        if status == "revoked":
            # Immediately wipe stored GPS coordinates when visitor revokes sharing
            conn.execute(
                """
                UPDATE visitor_sessions
                SET location_source = CASE WHEN location_source = 'gps' THEN 'none' ELSE location_source END,
                    latitude = CASE WHEN location_source = 'gps' THEN NULL ELSE latitude END,
                    longitude = CASE WHEN location_source = 'gps' THEN NULL ELSE longitude END,
                    accuracy_m = NULL,
                    location_timestamp = CASE WHEN location_source = 'gps' THEN NULL ELSE location_timestamp END
                WHERE visitor_id = ?
                """,
                (visitor_id,),
            )
            conn.execute(
                "DELETE FROM visitor_location_events WHERE visitor_id = ? AND location_source = 'gps'",
                (visitor_id,),
            )
        elif status == "denied":
            # Ensure IP fallback estimation runs if location_source is still 'none'
            sess = conn.execute(
                "SELECT location_source FROM visitor_sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if sess and str(sess["location_source"]) == "none" and int(profile["ip_geo_consent"]) == 1:
                ip_loc = lookup_ip_location(conn, client_ip)
                if ip_loc:
                    conn.execute(
                        """
                        UPDATE visitor_sessions
                        SET location_source = 'ip', latitude = ?, longitude = ?, accuracy_m = NULL,
                            location_timestamp = ?, country = ?, region = ?, city = ?
                        WHERE session_id = ? AND location_source != 'gps'
                        """,
                        (
                            ip_loc["latitude"],
                            ip_loc["longitude"],
                            now,
                            ip_loc["country"],
                            ip_loc["region"],
                            ip_loc["city"],
                            session_id,
                        ),
                    )
                    conn.execute(
                        """
                        INSERT INTO visitor_location_events (
                            session_id, visitor_id, location_source, latitude, longitude,
                            accuracy_m, country, region, city, recorded_at
                        ) VALUES (?, ?, 'ip', ?, ?, NULL, ?, ?, ?, ?)
                        """,
                        (
                            session_id,
                            visitor_id,
                            ip_loc["latitude"],
                            ip_loc["longitude"],
                            ip_loc["country"],
                            ip_loc["region"],
                            ip_loc["city"],
                            now,
                        ),
                    )

    elif consent_type == "continuous_gps":
        if status not in ("granted", "revoked"):
            raise ValueError("Invalid continuous_gps consent status.")
        if status == "granted" and str(profile["gps_consent_status"]) != "granted":
            raise PermissionError("Base GPS consent must be granted before enabling continuous updates.")
        conn.execute(
            "UPDATE visitor_profiles SET continuous_gps_consent = ?, gps_consent_updated_at = ? WHERE visitor_id = ?",
            (1 if status == "granted" else 0, now, visitor_id),
        )

    elif consent_type == "analytics":
        if status not in ("opted_out", "opted_in"):
            raise ValueError("Invalid analytics consent status.")
        opt_out_val = 1 if status == "opted_out" else 0
        conn.execute(
            "UPDATE visitor_profiles SET analytics_opt_out = ?, ip_geo_consent = ? WHERE visitor_id = ?",
            (opt_out_val, 0 if opt_out_val else 1, visitor_id),
        )

    conn.execute(
        """
        INSERT INTO visitor_consent_logs (visitor_id, session_id, consent_type, status, recorded_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (visitor_id, session_id, consent_type, status, now),
    )
    conn.commit()
    updated = conn.execute(
        "SELECT gps_consent_status, continuous_gps_consent, analytics_opt_out FROM visitor_profiles WHERE visitor_id = ?",
        (visitor_id,),
    ).fetchone()
    return {
        "ok": True,
        "gps_consent_status": str(updated["gps_consent_status"]) if updated else status,
        "continuous_gps_consent": bool(updated["continuous_gps_consent"]) if updated else False,
        "analytics_opt_out": bool(updated["analytics_opt_out"]) if updated else False,
    }


def record_gps_location(
    conn: sqlite3.Connection,
    body: dict[str, Any],
    client_ip: str,
) -> dict[str, Any]:
    visitor_id = clean_text(body.get("visitor_id"), 64)
    session_id = clean_text(body.get("session_id"), 64)
    if not visitor_id or not session_id:
        raise ValueError("visitor_id and session_id are required.")

    profile = conn.execute(
        "SELECT * FROM visitor_profiles WHERE visitor_id = ?",
        (visitor_id,),
    ).fetchone()
    if not profile:
        raise LookupError("Visitor profile not found.")
    if int(profile["analytics_opt_out"]) == 1:
        raise PermissionError("Visitor has opted out of analytics.")

    explicit_grant = body.get("consent_granted") is True
    current_consent = str(profile["gps_consent_status"])
    if current_consent in ("denied", "revoked") and not explicit_grant:
        raise PermissionError("GPS location consent has not been granted.")
    if current_consent == "unset" and not explicit_grant:
        raise PermissionError("Explicit GPS consent is required before saving coordinates.")

    try:
        lat = float(body.get("latitude"))
        lng = float(body.get("longitude"))
    except (TypeError, ValueError):
        raise ValueError("Valid numeric latitude and longitude are required.")

    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
        raise ValueError("Coordinates out of valid Earth bounds.")

    acc_raw = body.get("accuracy_m")
    accuracy_m: float | None = None
    if acc_raw is not None:
        try:
            acc_val = float(acc_raw)
            if acc_val < 0 or acc_val > 1_000_000:
                raise ValueError("Invalid accuracy value.")
            accuracy_m = round(acc_val, 1)
        except (TypeError, ValueError):
            raise ValueError("Invalid accuracy_m value.")

    is_continuous = body.get("is_continuous") is True
    if is_continuous and int(profile["continuous_gps_consent"]) != 1:
        raise PermissionError("Continuous GPS updates require separate explicit consent.")

    now = utc_now_iso()
    loc_ts = clean_text(body.get("location_timestamp"), 64, now)

    if explicit_grant and current_consent != "granted":
        conn.execute(
            "UPDATE visitor_profiles SET gps_consent_status = 'granted', gps_consent_updated_at = ? WHERE visitor_id = ?",
            (now, visitor_id),
        )
        conn.execute(
            "INSERT INTO visitor_consent_logs (visitor_id, session_id, consent_type, status, recorded_at) VALUES (?, ?, 'gps', 'granted', ?)",
            (visitor_id, session_id, now),
        )

    sess = conn.execute(
        "SELECT country, region, city FROM visitor_sessions WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    country = clean_text(body.get("country"), 80) or (str(sess["country"]) if sess and sess["country"] else "")
    region = clean_text(body.get("region"), 80) or (str(sess["region"]) if sess and sess["region"] else "")
    city = clean_text(body.get("city"), 80) or (str(sess["city"]) if sess and sess["city"] else "")

    if not country and not city:
        ip_meta = lookup_ip_location(conn, client_ip)
        if ip_meta:
            country = ip_meta["country"]
            region = ip_meta["region"]
            city = ip_meta["city"]

    conn.execute(
        """
        UPDATE visitor_sessions
        SET location_source = 'gps', latitude = ?, longitude = ?, accuracy_m = ?,
            location_timestamp = ?, country = COALESCE(NULLIF(?, ''), country),
            region = COALESCE(NULLIF(?, ''), region), city = COALESCE(NULLIF(?, ''), city),
            gps_consent_status = 'granted', last_active_at = ?
        WHERE session_id = ?
        """,
        (
            round(lat, 6),
            round(lng, 6),
            accuracy_m,
            loc_ts,
            country,
            region,
            city,
            now,
            session_id,
        ),
    )
    conn.execute(
        """
        INSERT INTO visitor_location_events (
            session_id, visitor_id, location_source, latitude, longitude,
            accuracy_m, country, region, city, recorded_at
        ) VALUES (?, ?, 'gps', ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            visitor_id,
            round(lat, 6),
            round(lng, 6),
            accuracy_m,
            country or None,
            region or None,
            city or None,
            now,
        ),
    )
    conn.commit()
    return {
        "ok": True,
        "location_source": "gps",
        "latitude": round(lat, 6),
        "longitude": round(lng, 6),
        "accuracy_m": accuracy_m,
    }


def delete_visitor_data(conn: sqlite3.Connection, visitor_id: str) -> bool:
    clean_id = clean_text(visitor_id, 64)
    if not clean_id:
        return False
    exists = conn.execute(
        "SELECT 1 FROM visitor_profiles WHERE visitor_id = ?",
        (clean_id,),
    ).fetchone()
    if not exists:
        return False
    conn.execute("DELETE FROM visitor_location_events WHERE visitor_id = ?", (clean_id,))
    conn.execute("DELETE FROM visitor_page_views WHERE visitor_id = ?", (clean_id,))
    conn.execute("DELETE FROM visitor_consent_logs WHERE visitor_id = ?", (clean_id,))
    conn.execute("DELETE FROM visitor_sessions WHERE visitor_id = ?", (clean_id,))
    conn.execute("DELETE FROM visitor_profiles WHERE visitor_id = ?", (clean_id,))
    conn.commit()
    return True


def prune_old_visitor_data(conn: sqlite3.Connection, retention_days: int | None = None) -> int:
    days = retention_days if retention_days is not None else int(_get_setting(conn, "retention_days", "90") or 90)
    days = max(1, min(3650, days))
    cutoff = (utc_now() - timedelta(days=days)).isoformat()

    cur = conn.execute(
        "DELETE FROM visitor_location_events WHERE recorded_at < ?",
        (cutoff,),
    )
    deleted = cur.rowcount
    conn.execute("DELETE FROM visitor_page_views WHERE viewed_at < ?", (cutoff,))
    conn.execute("DELETE FROM visitor_consent_logs WHERE recorded_at < ?", (cutoff,))
    conn.execute("DELETE FROM visitor_sessions WHERE last_active_at < ?", (cutoff,))
    conn.execute(
        "DELETE FROM visitor_page_views WHERE session_id NOT IN (SELECT session_id FROM visitor_sessions)"
    )
    conn.execute(
        """
        DELETE FROM visitor_profiles
        WHERE last_seen_at < ?
          AND visitor_id NOT IN (SELECT DISTINCT visitor_id FROM visitor_sessions)
        """,
        (cutoff,),
    )
    conn.commit()
    return max(0, deleted)


def _compute_date_bounds(range_key: str, start_date: str = "", end_date: str = "") -> tuple[str | None, str | None]:
    today = utc_now().date()
    rk = (range_key or "all").lower()
    if rk == "today":
        return today.isoformat(), (today + timedelta(days=1)).isoformat()
    if rk == "yesterday":
        yest = today - timedelta(days=1)
        return yest.isoformat(), today.isoformat()
    if rk == "7d":
        return (today - timedelta(days=6)).isoformat(), (today + timedelta(days=1)).isoformat()
    if rk == "30d":
        return (today - timedelta(days=29)).isoformat(), (today + timedelta(days=1)).isoformat()
    if rk == "custom":
        s_iso = None
        e_iso = None
        if re.match(r"^\d{4}-\d{2}-\d{2}$", start_date or ""):
            s_iso = start_date
        if re.match(r"^\d{4}-\d{2}-\d{2}$", end_date or ""):
            try:
                ed = datetime.strptime(end_date, "%Y-%m-%d").date() + timedelta(days=1)
                e_iso = ed.isoformat()
            except ValueError:
                e_iso = None
        return s_iso, e_iso
    return None, None


def _build_session_where(
    range_key: str = "all",
    start_date: str = "",
    end_date: str = "",
    source_filter: str = "all",
    visitor_type: str = "all",
    search: str = "",
) -> tuple[str, list[Any]]:
    clauses: list[str] = ["1=1"]
    params: list[Any] = []

    s_bound, e_bound = _compute_date_bounds(range_key, start_date, end_date)
    if s_bound:
        clauses.append("s.started_at >= ?")
        params.append(s_bound)
    if e_bound:
        clauses.append("s.started_at < ?")
        params.append(e_bound)

    if source_filter in ("gps", "ip", "none"):
        clauses.append("s.location_source = ?")
        params.append(source_filter)

    if visitor_type == "new":
        clauses.append("s.is_returning = 0")
    elif visitor_type == "returning":
        clauses.append("s.is_returning = 1")

    q = clean_text(search, 80).lower()
    if q:
        like = f"%{q}%"
        clauses.append(
            "(LOWER(s.visitor_id) LIKE ? OR LOWER(s.session_id) LIKE ? OR LOWER(COALESCE(s.city, '')) LIKE ? OR LOWER(COALESCE(s.country, '')) LIKE ? OR LOWER(s.browser) LIKE ? OR LOWER(s.landing_page) LIKE ?)"
        )
        params.extend([like, like, like, like, like, like])

    return " AND ".join(clauses), params


def build_admin_overview(conn: sqlite3.Connection, range_key: str = "all", start_date: str = "", end_date: str = "") -> dict[str, Any]:
    prune_old_visitor_data(conn)
    where_sql, params = _build_session_where(range_key=range_key, start_date=start_date, end_date=end_date)
    active_cutoff = (utc_now() - timedelta(minutes=5)).isoformat()

    row = conn.execute(
        f"""
        SELECT
            COUNT(*) AS total_sessions,
            COUNT(DISTINCT s.visitor_id) AS unique_visitors,
            SUM(CASE WHEN s.is_returning = 1 THEN 1 ELSE 0 END) AS returning_sessions,
            COUNT(DISTINCT CASE WHEN s.is_returning = 1 THEN s.visitor_id END) AS returning_visitors,
            COUNT(DISTINCT CASE WHEN s.location_source = 'gps' THEN s.visitor_id END) AS gps_visitors,
            COUNT(DISTINCT CASE WHEN s.location_source = 'ip' THEN s.visitor_id END) AS ip_visitors,
            COALESCE(SUM(s.page_views_count), 0) AS total_page_views,
            COALESCE(AVG(s.duration_sec), 0) AS avg_duration_sec
        FROM visitor_sessions s
        WHERE {where_sql}
        """,
        params,
    ).fetchone()

    active_sessions = conn.execute(
        "SELECT COUNT(*) FROM visitor_sessions WHERE is_ended = 0 AND last_active_at >= ?",
        (active_cutoff,),
    ).fetchone()[0]

    notifications = [
        {k: r[k] for k in r.keys()}
        for r in conn.execute(
            "SELECT id, severity, title, message, created_at, acknowledged FROM admin_notifications ORDER BY id DESC LIMIT 12"
        ).fetchall()
    ]

    return {
        "kpis": {
            "total_visitors": int(row["total_sessions"] or 0),
            "unique_visitors": int(row["unique_visitors"] or 0),
            "returning_visitors": int(row["returning_visitors"] or 0),
            "returning_sessions": int(row["returning_sessions"] or 0),
            "active_sessions": int(active_sessions or 0),
            "gps_visitors": int(row["gps_visitors"] or 0),
            "ip_visitors": int(row["ip_visitors"] or 0),
            "total_page_views": int(row["total_page_views"] or 0),
            "avg_session_duration_sec": round(float(row["avg_duration_sec"] or 0.0), 1),
        },
        "notifications": notifications,
        "retention_days": int(_get_setting(conn, "retention_days", "90") or 90),
        "ip_geo_provider": resolve_ip_geo_provider(conn),
    }


def build_admin_map_points(conn: sqlite3.Connection, source_filter: str = "all") -> dict[str, Any]:
    where_parts = ["s.latitude IS NOT NULL", "s.longitude IS NOT NULL"]
    params: list[Any] = []
    if source_filter in ("gps", "ip"):
        where_parts.append("s.location_source = ?")
        params.append(source_filter)
    else:
        where_parts.append("s.location_source IN ('gps', 'ip')")

    active_cutoff = (utc_now() - timedelta(minutes=5)).isoformat()
    rows = conn.execute(
        f"""
        SELECT
            s.session_id, s.visitor_id, s.location_source, s.latitude, s.longitude,
            s.accuracy_m, s.location_timestamp, s.country, s.region, s.city,
            s.device_category, s.browser, s.duration_sec, s.is_returning,
            s.current_page, s.last_active_at, s.is_ended, s.gps_consent_status
        FROM visitor_sessions s
        WHERE {' AND '.join(where_parts)}
        ORDER BY s.last_active_at DESC
        LIMIT 250
        """,
        params,
    ).fetchall()

    markers = []
    for r in rows:
        is_active = int(r["is_ended"]) == 0 and str(r["last_active_at"]) >= active_cutoff
        markers.append(
            {
                "session_id": r["session_id"],
                "visitor_id": r["visitor_id"],
                "location_source": r["location_source"],
                "is_estimated": r["location_source"] != "gps",
                "latitude": float(r["latitude"]),
                "longitude": float(r["longitude"]),
                "accuracy_m": float(r["accuracy_m"]) if r["accuracy_m"] is not None else None,
                "location_timestamp": r["location_timestamp"],
                "country": r["country"] or "Unknown",
                "region": r["region"] or "Unknown",
                "city": r["city"] or "Unknown",
                "device_category": r["device_category"],
                "browser": r["browser"],
                "duration_sec": int(r["duration_sec"] or 0),
                "is_returning": bool(r["is_returning"]),
                "current_page": r["current_page"],
                "last_active_at": r["last_active_at"],
                "is_active": is_active,
                "gps_consent_status": r["gps_consent_status"],
            }
        )

    return {"markers": markers, "refreshed_at": utc_now_iso()}


def list_admin_visitors(conn: sqlite3.Connection, qs: dict[str, list[str]]) -> dict[str, Any]:
    range_key = qs.get("range", ["all"])[0]
    start_date = qs.get("start_date", [""])[0]
    end_date = qs.get("end_date", [""])[0]
    source_filter = qs.get("source", ["all"])[0]
    visitor_type = qs.get("visitor_type", ["all"])[0]
    search = qs.get("search", [""])[0]
    sort_key = qs.get("sort", ["latest"])[0]
    sort_dir = "ASC" if qs.get("dir", ["desc"])[0].lower() == "asc" else "DESC"

    try:
        page = max(1, int(qs.get("page", ["1"])[0]))
    except ValueError:
        page = 1
    try:
        page_size = max(5, min(100, int(qs.get("page_size", ["15"])[0])))
    except ValueError:
        page_size = 15

    sort_col = SORT_COLUMN_MAP.get(sort_key, "s.last_active_at")
    where_sql, params = _build_session_where(
        range_key=range_key,
        start_date=start_date,
        end_date=end_date,
        source_filter=source_filter,
        visitor_type=visitor_type,
        search=search,
    )

    total = conn.execute(
        f"SELECT COUNT(*) FROM visitor_sessions s WHERE {where_sql}",
        params,
    ).fetchone()[0]

    offset = (page - 1) * page_size
    active_cutoff = (utc_now() - timedelta(minutes=5)).isoformat()
    rows = conn.execute(
        f"""
        SELECT
            s.session_id, s.visitor_id, s.started_at, s.last_active_at, s.duration_sec,
            s.is_returning, s.landing_page, s.current_page, s.referrer_source,
            s.page_views_count, s.device_category, s.browser, s.location_source,
            s.latitude, s.longitude, s.accuracy_m, s.location_timestamp,
            s.country, s.region, s.city, s.gps_consent_status, s.is_ended,
            p.visit_count
        FROM visitor_sessions s
        JOIN visitor_profiles p ON s.visitor_id = p.visitor_id
        WHERE {where_sql}
        ORDER BY {sort_col} {sort_dir}, s.started_at DESC
        LIMIT ? OFFSET ?
        """,
        [*params, page_size, offset],
    ).fetchall()

    records = []
    for r in rows:
        records.append(
            {
                "session_id": r["session_id"],
                "visitor_id": r["visitor_id"],
                "started_at": r["started_at"],
                "last_active_at": r["last_active_at"],
                "duration_sec": int(r["duration_sec"] or 0),
                "is_returning": bool(r["is_returning"]),
                "visit_count": int(r["visit_count"] or 1),
                "landing_page": r["landing_page"],
                "current_page": r["current_page"],
                "referrer_source": r["referrer_source"],
                "page_views_count": int(r["page_views_count"] or 1),
                "device_category": r["device_category"],
                "browser": r["browser"],
                "location_source": r["location_source"],
                "latitude": float(r["latitude"]) if r["latitude"] is not None else None,
                "longitude": float(r["longitude"]) if r["longitude"] is not None else None,
                "accuracy_m": float(r["accuracy_m"]) if r["accuracy_m"] is not None else None,
                "location_timestamp": r["location_timestamp"],
                "country": r["country"] or "Unknown",
                "region": r["region"] or "Unknown",
                "city": r["city"] or "Unknown",
                "gps_consent_status": r["gps_consent_status"],
                "is_active": int(r["is_ended"]) == 0 and str(r["last_active_at"]) >= active_cutoff,
            }
        )

    return {
        "records": records,
        "total": int(total),
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (int(total) + page_size - 1) // page_size),
    }


def get_admin_visitor_detail(conn: sqlite3.Connection, visitor_id: str) -> dict[str, Any] | None:
    clean_id = clean_text(visitor_id, 64)
    profile = conn.execute(
        "SELECT * FROM visitor_profiles WHERE visitor_id = ?",
        (clean_id,),
    ).fetchone()
    if not profile:
        return None

    sessions = [
        {k: r[k] for k in r.keys()}
        for r in conn.execute(
            "SELECT * FROM visitor_sessions WHERE visitor_id = ? ORDER BY started_at DESC",
            (clean_id,),
        ).fetchall()
    ]
    page_views = [
        {k: r[k] for k in r.keys()}
        for r in conn.execute(
            "SELECT * FROM visitor_page_views WHERE visitor_id = ? ORDER BY viewed_at DESC LIMIT 100",
            (clean_id,),
        ).fetchall()
    ]
    location_events = [
        {k: r[k] for k in r.keys()}
        for r in conn.execute(
            "SELECT * FROM visitor_location_events WHERE visitor_id = ? ORDER BY recorded_at DESC LIMIT 50",
            (clean_id,),
        ).fetchall()
    ]
    consent_logs = [
        {k: r[k] for k in r.keys()}
        for r in conn.execute(
            "SELECT * FROM visitor_consent_logs WHERE visitor_id = ? ORDER BY recorded_at DESC LIMIT 50",
            (clean_id,),
        ).fetchall()
    ]

    latest_sess = sessions[0] if sessions else None
    return {
        "profile": {
            "visitor_id": profile["visitor_id"],
            "first_seen_at": profile["first_seen_at"],
            "last_seen_at": profile["last_seen_at"],
            "visit_count": int(profile["visit_count"]),
            "gps_consent_status": profile["gps_consent_status"],
            "gps_consent_updated_at": profile["gps_consent_updated_at"],
            "continuous_gps_consent": bool(profile["continuous_gps_consent"]),
            "analytics_opt_out": bool(profile["analytics_opt_out"]),
            "device_category": profile["device_category"],
            "browser": profile["browser"],
            "os_family": profile["os_family"],
        },
        "latest_location": {
            "location_source": latest_sess["location_source"] if latest_sess else "none",
            "latitude": latest_sess["latitude"] if latest_sess else None,
            "longitude": latest_sess["longitude"] if latest_sess else None,
            "accuracy_m": latest_sess["accuracy_m"] if latest_sess else None,
            "country": latest_sess["country"] if latest_sess else None,
            "region": latest_sess["region"] if latest_sess else None,
            "city": latest_sess["city"] if latest_sess else None,
            "location_timestamp": latest_sess["location_timestamp"] if latest_sess else None,
        },
        "sessions": sessions,
        "page_views": page_views,
        "location_events": location_events,
        "consent_logs": consent_logs,
    }


def build_admin_analytics(
    conn: sqlite3.Connection,
    range_key: str = "30d",
    start_date: str = "",
    end_date: str = "",
) -> dict[str, Any]:
    where_sql, params = _build_session_where(range_key=range_key, start_date=start_date, end_date=end_date)

    daily_rows = conn.execute(
        f"""
        SELECT
            SUBSTR(s.started_at, 1, 10) AS period,
            COUNT(*) AS visits,
            COUNT(DISTINCT s.visitor_id) AS unique_visitors,
            SUM(CASE WHEN s.is_returning = 1 THEN 1 ELSE 0 END) AS returning_visits
        FROM visitor_sessions s
        WHERE {where_sql}
        GROUP BY SUBSTR(s.started_at, 1, 10)
        ORDER BY period ASC
        """,
        params,
    ).fetchall()

    weekly_rows = conn.execute(
        f"""
        SELECT
            STRFTIME('%Y-W%W', s.started_at) AS period,
            COUNT(*) AS visits,
            COUNT(DISTINCT s.visitor_id) AS unique_visitors,
            SUM(CASE WHEN s.is_returning = 1 THEN 1 ELSE 0 END) AS returning_visits
        FROM visitor_sessions s
        WHERE {where_sql}
        GROUP BY STRFTIME('%Y-W%W', s.started_at)
        ORDER BY period ASC
        """,
        params,
    ).fetchall()

    monthly_rows = conn.execute(
        f"""
        SELECT
            SUBSTR(s.started_at, 1, 7) AS period,
            COUNT(*) AS visits,
            COUNT(DISTINCT s.visitor_id) AS unique_visitors,
            SUM(CASE WHEN s.is_returning = 1 THEN 1 ELSE 0 END) AS returning_visits
        FROM visitor_sessions s
        WHERE {where_sql}
        GROUP BY SUBSTR(s.started_at, 1, 7)
        ORDER BY period ASC
        """,
        params,
    ).fetchall()

    new_vs_returning = conn.execute(
        f"""
        SELECT
            SUM(CASE WHEN s.is_returning = 0 THEN 1 ELSE 0 END) AS new_sessions,
            SUM(CASE WHEN s.is_returning = 1 THEN 1 ELSE 0 END) AS returning_sessions
        FROM visitor_sessions s
        WHERE {where_sql}
        """,
        params,
    ).fetchone()

    countries = conn.execute(
        f"""
        SELECT COALESCE(NULLIF(s.country, ''), 'Unknown') AS name, COUNT(*) AS count
        FROM visitor_sessions s
        WHERE {where_sql}
        GROUP BY name
        ORDER BY count DESC
        LIMIT 12
        """,
        params,
    ).fetchall()

    cities = conn.execute(
        f"""
        SELECT
            COALESCE(NULLIF(s.city, ''), 'Unknown') AS city,
            COALESCE(NULLIF(s.region, ''), '') AS region,
            COALESCE(NULLIF(s.country, ''), 'Unknown') AS country,
            COUNT(*) AS count
        FROM visitor_sessions s
        WHERE {where_sql}
        GROUP BY city, region, country
        ORDER BY count DESC
        LIMIT 12
        """,
        params,
    ).fetchall()

    referrers = conn.execute(
        f"""
        SELECT s.referrer_source AS source, COUNT(*) AS count
        FROM visitor_sessions s
        WHERE {where_sql}
        GROUP BY s.referrer_source
        ORDER BY count DESC
        LIMIT 10
        """,
        params,
    ).fetchall()

    devices = conn.execute(
        f"""
        SELECT s.device_category AS name, COUNT(*) AS count
        FROM visitor_sessions s
        WHERE {where_sql}
        GROUP BY s.device_category
        ORDER BY count DESC
        """,
        params,
    ).fetchall()

    browsers = conn.execute(
        f"""
        SELECT s.browser AS name, COUNT(*) AS count
        FROM visitor_sessions s
        WHERE {where_sql}
        GROUP BY s.browser
        ORDER BY count DESC
        """,
        params,
    ).fetchall()

    s_bound, e_bound = _compute_date_bounds(range_key, start_date, end_date)
    pv_clauses = ["1=1"]
    pv_params: list[Any] = []
    if s_bound:
        pv_clauses.append("viewed_at >= ?")
        pv_params.append(s_bound)
    if e_bound:
        pv_clauses.append("viewed_at < ?")
        pv_params.append(e_bound)

    top_pages = conn.execute(
        f"""
        SELECT page_path, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS unique_visitors
        FROM visitor_page_views
        WHERE {' AND '.join(pv_clauses)}
        GROUP BY page_path
        ORDER BY views DESC
        LIMIT 12
        """,
        pv_params,
    ).fetchall()

    return {
        "daily_traffic": [
            {
                "period": r["period"],
                "visits": int(r["visits"]),
                "unique_visitors": int(r["unique_visitors"]),
                "returning_visits": int(r["returning_visits"] or 0),
            }
            for r in daily_rows
        ],
        "weekly_traffic": [
            {
                "period": r["period"],
                "visits": int(r["visits"]),
                "unique_visitors": int(r["unique_visitors"]),
                "returning_visits": int(r["returning_visits"] or 0),
            }
            for r in weekly_rows
        ],
        "monthly_traffic": [
            {
                "period": r["period"],
                "visits": int(r["visits"]),
                "unique_visitors": int(r["unique_visitors"]),
                "returning_visits": int(r["returning_visits"] or 0),
            }
            for r in monthly_rows
        ],
        "new_vs_returning": {
            "new_sessions": int(new_vs_returning["new_sessions"] or 0),
            "returning_sessions": int(new_vs_returning["returning_sessions"] or 0),
        },
        "countries": [{"name": r["name"], "count": int(r["count"])} for r in countries],
        "cities": [
            {
                "city": r["city"],
                "region": r["region"],
                "country": r["country"],
                "count": int(r["count"]),
            }
            for r in cities
        ],
        "top_pages": [
            {
                "page_path": r["page_path"],
                "views": int(r["views"]),
                "unique_visitors": int(r["unique_visitors"]),
            }
            for r in top_pages
        ],
        "referrers": [{"source": r["source"], "count": int(r["count"])} for r in referrers],
        "devices": [{"name": r["name"], "count": int(r["count"])} for r in devices],
        "browsers": [{"name": r["name"], "count": int(r["count"])} for r in browsers],
    }


def export_visitors_csv(conn: sqlite3.Connection, qs: dict[str, list[str]]) -> str:
    range_key = qs.get("range", ["all"])[0]
    start_date = qs.get("start_date", [""])[0]
    end_date = qs.get("end_date", [""])[0]
    source_filter = qs.get("source", ["all"])[0]
    visitor_type = qs.get("visitor_type", ["all"])[0]
    search = qs.get("search", [""])[0]

    where_sql, params = _build_session_where(
        range_key=range_key,
        start_date=start_date,
        end_date=end_date,
        source_filter=source_filter,
        visitor_type=visitor_type,
        search=search,
    )

    rows = conn.execute(
        f"""
        SELECT
            s.visitor_id, s.session_id, s.started_at, s.last_active_at, s.duration_sec,
            s.is_returning, s.landing_page, s.referrer_source, s.page_views_count,
            s.device_category, s.browser, s.location_source,
            s.latitude, s.longitude, s.accuracy_m, s.country, s.region, s.city,
            s.gps_consent_status
        FROM visitor_sessions s
        WHERE {where_sql}
        ORDER BY s.started_at DESC
        LIMIT 5000
        """,
        params,
    ).fetchall()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Visitor ID",
            "Session ID",
            "Visit Started (UTC)",
            "Last Active (UTC)",
            "Duration (sec)",
            "Visitor Type",
            "Landing Page",
            "Referrer",
            "Page Views",
            "Device",
            "Browser",
            "Location Source",
            "City",
            "Region",
            "Country",
            "Latitude",
            "Longitude",
            "GPS Accuracy (m)",
            "GPS Consent Status",
        ]
    )
    for r in rows:
        writer.writerow(
            [
                r["visitor_id"],
                r["session_id"],
                r["started_at"],
                r["last_active_at"],
                int(r["duration_sec"] or 0),
                "Returning" if int(r["is_returning"]) else "New",
                r["landing_page"],
                r["referrer_source"],
                int(r["page_views_count"] or 1),
                r["device_category"],
                r["browser"],
                "GPS (Consented)" if r["location_source"] == "gps" else ("IP Estimate (Approximate)" if r["location_source"] == "ip" else "Unavailable"),
                r["city"] or "",
                r["region"] or "",
                r["country"] or "",
                r["latitude"] if r["latitude"] is not None else "",
                r["longitude"] if r["longitude"] is not None else "",
                r["accuracy_m"] if r["accuracy_m"] is not None else "",
                r["gps_consent_status"],
            ]
        )
    return buf.getvalue()


def update_admin_privacy_settings(conn: sqlite3.Connection, body: dict[str, Any]) -> dict[str, Any]:
    if "retention_days" in body and body["retention_days"] is not None:
        try:
            days = int(body["retention_days"])
        except (TypeError, ValueError):
            raise ValueError("retention_days must be an integer.")
        if not (1 <= days <= 3650):
            raise ValueError("retention_days must be between 1 and 3650.")
        _set_setting(conn, "retention_days", str(days))

    if "ip_geo_provider" in body and body["ip_geo_provider"] is not None:
        prov = str(body["ip_geo_provider"]).strip().lower()
        if prov not in ALLOWED_PROVIDERS:
            raise ValueError("Unsupported IP geolocation provider.")
        _set_setting(conn, "ip_geo_provider", prov)

    pruned_count = 0
    if body.get("run_cleanup") is True:
        pruned_count = prune_old_visitor_data(conn)

    return {
        "retention_days": int(_get_setting(conn, "retention_days", "90") or 90),
        "ip_geo_provider": resolve_ip_geo_provider(conn),
        "pruned_count": pruned_count,
    }


def acknowledge_notifications(conn: sqlite3.Connection, notification_id: int | None = None) -> None:
    if notification_id is not None:
        conn.execute("UPDATE admin_notifications SET acknowledged = 1 WHERE id = ?", (notification_id,))
    else:
        conn.execute("UPDATE admin_notifications SET acknowledged = 1")
    conn.commit()
