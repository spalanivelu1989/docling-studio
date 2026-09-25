"""A static sign-in for the main application at `/`.

Built the same way as Demo Mode's (demo_mode.py), with its own credentials and
its own cookie: a presenter signed in to the demo is not thereby signed in to
the application, or the other way round.

═══ WHAT THE LOGIN IS, AND IS NOT ═══

A static username and password in front of the application's PAGES. It keeps
a casual visitor on a shared screen or a forwarded link on the sign-in page.
It is NOT access control: the `/api/*` endpoints stay open, exactly as Demo
Mode leaves them, because the demo's pages call the same API and gating it
here would lock the demo out. Do not put this on a network on the strength of
this login -- the README's "localhost only" note still applies in full.

The check runs on the server, so the password is never in the JavaScript
bundle, and the session is an HMAC-signed, HttpOnly cookie, so the page cannot
be unlocked by editing localStorage.

Configuration, all optional:

    APP_USERNAME   default "test"
    APP_PASSWORD   default "test"
    APP_SECRET     signs the session cookie. Unset, a random one is made per
                   process, so restarting the server signs everyone out.
    APP_SESSION_HOURS  default 12
    APP_LOGIN      "off" removes the sign-in entirely
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

ENABLED = os.environ.get("APP_LOGIN", "on").lower() not in ("off", "0", "false")
USERNAME = os.environ.get("APP_USERNAME", "test")
PASSWORD = os.environ.get("APP_PASSWORD", "test")
SECRET = (os.environ.get("APP_SECRET") or secrets.token_hex(32)).encode()
SESSION_SECONDS = int(float(os.environ.get("APP_SESSION_HOURS", "12")) * 3600)
COOKIE = "app_session"
LOGIN_PATH = "/login"

PAGE = Path(__file__).parent / "static" / "dist" / "login.html"

router = APIRouter()


def _sign(user: str, expires: int) -> str:
    # The purpose is part of what is signed, so a token minted for another
    # sign-in with the same secret could not be replayed here.
    return hmac.new(SECRET, f"app|{user}|{expires}".encode(), hashlib.sha256).hexdigest()


def make_token(user: str, now: float | None = None) -> str:
    expires = int((now if now is not None else time.time()) + SESSION_SECONDS)
    return f"{user}|{expires}|{_sign(user, expires)}"


def session_user(token: str | None, now: float | None = None) -> str | None:
    """The signed-in user, or None for a missing, forged or expired token."""
    if not token:
        return None
    try:
        user, expires_s, sig = token.split("|")
        expires = int(expires_s)
    except ValueError:
        return None
    if not hmac.compare_digest(sig, _sign(user, expires)):
        return None
    if expires < (now if now is not None else time.time()):
        return None
    return user


def check(username: str, password: str) -> bool:
    # Both compared, always, in constant time: returning early on a wrong
    # username would tell a guesser which half they had right.
    ok_user = hmac.compare_digest(username.encode(), USERNAME.encode())
    ok_pass = hmac.compare_digest(password.encode(), PASSWORD.encode())
    return ok_user and ok_pass


def signed_in(request: Request) -> bool:
    return not ENABLED or session_user(request.cookies.get(COOKIE)) is not None


def safe_next(target: str | None) -> str:
    """Only a path on this site, and never the sign-in page itself: `next`
    comes from the address bar, and an open redirect would make the sign-in
    page a way to bounce people elsewhere."""
    t = target or "/"
    if not t.startswith("/") or t.startswith("//") or t.startswith(LOGIN_PATH) or "\\" in t:
        return "/"
    return t


def page_paths(app) -> set[str]:
    """The application's own pages: every HTML route outside Demo Mode and the
    sign-in page. Read from the app rather than listed, so a page added later
    is gated without anyone remembering to add it here."""
    from fastapi.routing import APIRoute

    out: set[str] = set()
    for r in app.routes:
        if (isinstance(r, APIRoute) and "GET" in r.methods and r.response_class is HTMLResponse
                and not r.path.startswith("/demo") and r.path != LOGIN_PATH):
            out.add(r.path)
    return out


def install(app) -> None:
    """Gate the application's pages. Call after every page route is declared."""
    if not ENABLED:
        return
    gated = page_paths(app)

    @app.middleware("http")
    async def require_sign_in(request: Request, call_next):
        if request.method == "GET" and request.url.path in gated and not signed_in(request):
            target = request.url.path + (f"?{request.url.query}" if request.url.query else "")
            return RedirectResponse(f"{LOGIN_PATH}?next={quote(target)}", status_code=303)
        return await call_next(request)


class Login(BaseModel):
    username: str
    password: str


@router.get(LOGIN_PATH, response_class=HTMLResponse)
def login_page(request: Request, next: str = "/"):
    if signed_in(request):
        return RedirectResponse(safe_next(next), status_code=303)
    if not PAGE.exists():
        return HTMLResponse(
            "<p>The sign-in page has not been built. Run <code>cd frontend &amp;&amp; npm run build"
            "</code>, then reload.</p>", status_code=503)
    return HTMLResponse(PAGE.read_text(), headers={"Cache-Control": "no-cache"})


@router.post("/api/app/login")
def login(body: Login):
    if not check(body.username.strip(), body.password):
        return JSONResponse({"detail": "Incorrect username or password."}, status_code=401)
    res = JSONResponse({"user": USERNAME})
    res.set_cookie(COOKIE, make_token(USERNAME), max_age=SESSION_SECONDS,
                   httponly=True, samesite="lax", path="/")
    return res


@router.post("/api/app/logout")
def logout():
    res = JSONResponse({"ok": True})
    res.delete_cookie(COOKIE, path="/")
    return res


@router.get("/api/app/session")
def session(request: Request):
    if not ENABLED:
        return {"user": None, "enabled": False}
    user = session_user(request.cookies.get(COOKIE))
    return {"user": user, "enabled": True} if user else JSONResponse({"user": None, "enabled": True}, status_code=401)
