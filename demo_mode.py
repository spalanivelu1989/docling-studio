"""Demo Mode: a client-presentation front door beside the application.

`/demo` is a second page over the same API: two primary tabs (Knowledge
Graph, Fit-Gap Copilot) with every other module in a sidebar that starts
hidden. It is a separate bundle (`frontend/demo.html`), so nothing about the
main application -- its routes, its tab bar, its pages -- changes.

═══ WHAT THE LOGIN IS, AND IS NOT ═══

A static username and password, for a presentation. It keeps a casual visitor
on a shared screen or a forwarded link on the login page. It is NOT access
control: the main application at `/` and every `/api/*` endpoint stay exactly
as open as they were, because gating them would change the application this
module promises not to touch. Do not put this on a network on the strength of
this login -- the README's "localhost only" note still applies in full.

The check runs on the server so the password is never shipped in the
JavaScript bundle, and the session is an HMAC-signed, HttpOnly cookie so the
page cannot be unlocked by editing localStorage.

Configuration, all optional:

    DEMO_USERNAME   default "solvay"
    DEMO_PASSWORD   default "solvay"
    DEMO_SECRET     signs the session cookie. Unset, a random one is made per
                    process, so restarting the server signs everyone out --
                    set it to keep a presenter signed in across restarts.
    DEMO_SESSION_HOURS  default 12
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

USERNAME = os.environ.get("DEMO_USERNAME", "solvay")
PASSWORD = os.environ.get("DEMO_PASSWORD", "solvay")
SECRET = (os.environ.get("DEMO_SECRET") or secrets.token_hex(32)).encode()
SESSION_SECONDS = int(float(os.environ.get("DEMO_SESSION_HOURS", "12")) * 3600)
COOKIE = "demo_session"

PAGE = Path(__file__).parent / "static" / "dist" / "demo.html"

router = APIRouter()


def _sign(user: str, expires: int) -> str:
    return hmac.new(SECRET, f"{user}|{expires}".encode(), hashlib.sha256).hexdigest()


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


def _page() -> HTMLResponse:
    if not PAGE.exists():
        return HTMLResponse(
            "<p>The demo page has not been built. Run <code>cd frontend &amp;&amp; npm run build"
            "</code>, then reload.</p>", status_code=503)
    return HTMLResponse(PAGE.read_text(), headers={"Cache-Control": "no-cache"})


class Login(BaseModel):
    username: str
    password: str


@router.get("/demo/login", response_class=HTMLResponse)
def login_page(request: Request):
    # Already signed in: straight through, rather than a login form that
    # looks like the session was lost.
    if session_user(request.cookies.get(COOKIE)):
        return RedirectResponse("/demo", status_code=303)
    return _page()


@router.get("/demo", response_class=HTMLResponse)
@router.get("/demo/{rest:path}", response_class=HTMLResponse)
def demo_page(request: Request, rest: str = ""):
    if not session_user(request.cookies.get(COOKIE)):
        target = "/demo" + (f"/{rest}" if rest else "")
        return RedirectResponse(f"/demo/login?next={quote(target)}", status_code=303)
    return _page()


@router.post("/api/demo/login")
def login(body: Login):
    if not check(body.username.strip(), body.password):
        return JSONResponse({"detail": "Incorrect username or password."}, status_code=401)
    res = JSONResponse({"user": USERNAME})
    res.set_cookie(COOKIE, make_token(USERNAME), max_age=SESSION_SECONDS,
                   httponly=True, samesite="lax", path="/")
    return res


@router.post("/api/demo/logout")
def logout():
    res = JSONResponse({"ok": True})
    res.delete_cookie(COOKIE, path="/")
    return res


@router.get("/api/demo/session")
def session(request: Request):
    user = session_user(request.cookies.get(COOKIE))
    return {"user": user} if user else JSONResponse({"user": None}, status_code=401)
