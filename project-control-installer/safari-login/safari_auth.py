"""Optional interactive login for browsers that do not display HTTP Basic challenges.

Preserves read-only Site bearer and Basic credentials. Cookie sessions stay in
memory and expire; no password or session token is written to disk.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
import urllib.parse
from http import HTTPStatus
from http.cookies import SimpleCookie
from pathlib import Path

SESSION_TTL_SECONDS = 12 * 60 * 60
SESSIONS: dict[str, float] = {}
COOKIE_NAME = 'pcc_session'


def _cookie_key(handler):
    cookie = SimpleCookie()
    try:
        cookie.load(handler.headers.get('Cookie', ''))
    except Exception:
        return None
    item = cookie.get(COOKIE_NAME)
    if not item or len(item.value) > 128:
        return None
    return hashlib.sha256(item.value.encode('ascii', errors='ignore')).hexdigest()


def _session_valid(handler):
    key = _cookie_key(handler)
    if not key:
        return False
    expires = SESSIONS.get(key, 0)
    if time.monotonic() > expires:
        SESSIONS.pop(key, None)
        return False
    return True


def _same_origin(handler):
    origin = handler.headers.get('Origin') or handler.headers.get('Referer')
    if not origin:
        # Some legacy clients omit both; cookie-authenticated writes require
        # a confirmed same-origin request, whereas Basic clients keep working.
        return False
    try:
        url = urllib.parse.urlsplit(origin)
        return url.scheme in ('http', 'https') and url.netloc.lower() == handler.headers.get('Host', '').lower()
    except ValueError:
        return False


def _redirect(handler, location, *, cookie=None):
    handler.send_response(HTTPStatus.SEE_OTHER)
    handler.send_header('Location', location)
    handler.send_header('Cache-Control', 'no-store')
    handler.send_header('Referrer-Policy', 'no-referrer')
    if cookie:
        handler.send_header('Set-Cookie', cookie)
    handler.send_header('Content-Length', '0')
    handler.end_headers()


def _clear_cookie(handler):
    _redirect(handler, '/login', cookie=f'{COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')


def install_safari_login(Handler):
    # Keep the original Basic and Site bearer authentication unchanged.
    original_authorized = Handler.authorized
    original_get = Handler.do_GET
    original_post = Handler.do_POST

    def authorized(self):
        return original_authorized(self) or _session_valid(self)

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == '/login':
            # The login page is intentionally public; it contains no credentials.
            root = Path(__file__).resolve().parent.parent
            page = (root / 'static' / 'login.html').read_text(encoding='utf-8')
            if urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('error'):
                page = page.replace('<body>', '<body data-error="1">', 1)
            return self.reply(200, page.encode('utf-8'), 'text/html; charset=utf-8')
        if path in ('/', '/index.html') and not self.authorized():
            return _redirect(self, '/login')
        return original_get(self)

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == '/login':
            if self.headers.get('Origin') and not _same_origin(self):
                return self.reply(403, {'message': 'Invalid origin'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > 4096:
                    return self.reply(413, {'message': 'Invalid login payload'})
                fields = urllib.parse.parse_qs(self.rfile.read(length).decode('utf-8'), keep_blank_values=True)
                username = fields.get('username', [''])[0]
                password = fields.get('password', [''])[0]
                if not isinstance(username, str) or not isinstance(password, str):
                    raise ValueError()
            except (UnicodeDecodeError, ValueError, IndexError):
                return self.reply(400, {'message': 'Malformed login payload'})
            configured_username = os.getenv('PCC_DASHBOARD_USER', 'admin')
            secret_file = os.getenv('PCC_DASHBOARD_PASSWORD_FILE', '').strip()
            configured_password = Path(secret_file).read_text(encoding='utf-8').strip() if secret_file else os.getenv('PCC_DASHBOARD_PASSWORD', '')
            if not configured_password or not (
                hmac.compare_digest(username, configured_username) and hmac.compare_digest(password, configured_password)
            ):
                return _redirect(self, '/login?error=1')
            token = secrets.token_urlsafe(32)
            key = hashlib.sha256(token.encode('ascii')).hexdigest()
            # Sessions are held only in this process, with a 12-hour limit.
            SESSIONS[key] = time.monotonic() + SESSION_TTL_SECONDS
            return _redirect(self, '/', cookie=f'{COOKIE_NAME}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_TTL_SECONDS}')
        if path == '/logout':
            if not _same_origin(self):
                return self.reply(403, {'message': 'Invalid origin'})
            key = _cookie_key(self)
            if key:
                SESSIONS.pop(key, None)
            return _clear_cookie(self)
        # Cookie-authenticated POSTs must be same-origin; legacy Basic clients
        # continue to work, as do Site bearer GET requests (only those routes).
        if _session_valid(self) and not original_authorized(self) and not _same_origin(self):
            return self.reply(403, {'message': 'Invalid origin'})
        return original_post(self)

    Handler.authorized = authorized
    Handler.do_GET = do_GET
    Handler.do_POST = do_POST
