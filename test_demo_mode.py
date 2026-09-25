"""Demo Mode's sign-in: the static credentials, the signed session, the gate.

Run: python test_demo_mode.py

No Postgres, no network, no model: the router is mounted on a bare FastAPI
app, so this checks demo_mode.py and nothing else.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import demo_mode  # noqa: E402

app = FastAPI()
app.include_router(demo_mode.router)


def client() -> TestClient:
    return TestClient(app, follow_redirects=False)


def login(c: TestClient, username="solvay", password="solvay"):
    return c.post("/api/demo/login", json={"username": username, "password": password})


def test_right_credentials_sign_in_with_httponly_cookie():
    c = client()
    res = login(c)
    assert res.status_code == 200, res.text
    cookie = res.headers["set-cookie"]
    assert cookie.startswith(f"{demo_mode.COOKIE}=") and "HttpOnly" in cookie, cookie
    assert c.get("/api/demo/session").json() == {"user": "solvay"}


def test_wrong_password_and_wrong_username_are_refused():
    for u, p in [("solvay", "nope"), ("admin", "solvay"), ("", ""), ("SOLVAY", "solvay")]:
        res = login(client(), u, p)
        assert res.status_code == 401, (u, p, res.status_code)
        assert "set-cookie" not in res.headers, (u, p)


def test_demo_page_redirects_to_login_without_a_session_and_keeps_the_target():
    res = client().get("/demo/fit-gap-copilot")
    assert res.status_code == 303
    assert res.headers["location"] == "/demo/login?next=/demo/fit-gap-copilot"


def test_demo_page_is_served_with_a_session():
    c = client()
    login(c)
    for path in ("/demo", "/demo/graph", "/demo/ask"):
        res = c.get(path)
        # 503 is "not built yet"; either way the gate let it through.
        assert res.status_code in (200, 503), (path, res.status_code)


def test_login_page_skips_straight_through_when_signed_in():
    c = client()
    assert c.get("/demo/login").status_code in (200, 503)
    login(c)
    res = c.get("/demo/login")
    assert res.status_code == 303 and res.headers["location"] == "/demo"


def test_logout_ends_the_session():
    c = client()
    login(c)
    c.post("/api/demo/logout")
    assert c.get("/api/demo/session").status_code == 401
    assert c.get("/demo").status_code == 303


def test_forged_tampered_and_expired_tokens_are_rejected():
    good = demo_mode.make_token("solvay", now=1000)
    assert demo_mode.session_user(good, now=1001) == "solvay"
    user, expires, sig = good.split("|")
    assert demo_mode.session_user(f"admin|{expires}|{sig}", now=1001) is None  # other user
    assert demo_mode.session_user(f"{user}|{int(expires) + 10**6}|{sig}", now=1001) is None  # extended
    assert demo_mode.session_user(f"{user}|{expires}|{'0' * 64}", now=1001) is None  # forged
    assert demo_mode.session_user(good, now=int(expires) + 1) is None  # expired
    for junk in (None, "", "solvay", "a|b", "a|notanumber|c", "a|1|b|c"):
        assert demo_mode.session_user(junk) is None, junk


def test_main_application_routes_are_not_gated():
    # The promise: Demo Mode adds routes and changes none. The router must not
    # claim anything outside /demo and /api/demo.
    paths = {r.path for r in demo_mode.router.routes}
    assert all(p.startswith("/demo") or p.startswith("/api/demo/") for p in paths), paths


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in tests:
        try:
            fn()
        except Exception as exc:
            failed += 1
            print(f"  FAIL {fn.__name__}: {exc.__class__.__name__}: {exc}")
        else:
            print(f"  ok   {fn.__name__}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
