"""The application's static sign-in: the credentials, the signed session, the
page gate, and what it leaves open.

Run: python test_app_login.py

No Postgres, no network, no model: the router and the gate are mounted on a
bare FastAPI app with a few stand-in pages, so this checks app_login.py alone.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import HTMLResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app_login  # noqa: E402
import demo_mode  # noqa: E402

app = FastAPI()
app.include_router(demo_mode.router)
app.include_router(app_login.router)


@app.get("/", response_class=HTMLResponse)
def index():
    return HTMLResponse("<p>app</p>")


@app.get("/rollout", response_class=HTMLResponse)
def rollout():
    return HTMLResponse("<p>rollout</p>")


@app.get("/api/health")
def health():
    return {"ok": True}


app_login.install(app)


def client() -> TestClient:
    return TestClient(app, follow_redirects=False)


def login(c: TestClient, username="test", password="test"):
    return c.post("/api/app/login", json={"username": username, "password": password})


def test_defaults_are_test_and_test():
    assert app_login.USERNAME == "test" and app_login.PASSWORD == "test"


def test_a_page_redirects_to_sign_in_and_remembers_where_it_was_going():
    res = client().get("/rollout?tab=brief")
    assert res.status_code == 303
    assert res.headers["location"] == "/login?next=/rollout%3Ftab%3Dbrief"
    assert client().get("/").headers["location"] == "/login?next=/"


def test_the_right_credentials_open_the_pages():
    c = client()
    res = login(c)
    assert res.status_code == 200 and res.json() == {"user": "test"}
    assert "httponly" in res.headers["set-cookie"].lower()
    assert c.get("/").status_code == 200
    assert c.get("/rollout").status_code == 200
    assert c.get("/api/app/session").json() == {"user": "test", "enabled": True}


def test_wrong_credentials_are_refused():
    c = client()
    for u, p in (("test", "nope"), ("nope", "test"), ("", ""), ("TEST", "test")):
        assert login(c, u, p).status_code == 401, (u, p)
    assert c.get("/").status_code == 303


def test_a_forged_or_expired_session_does_not_open_a_page():
    c = client()
    c.cookies.set(app_login.COOKIE, "test|9999999999|deadbeef")
    assert c.get("/").status_code == 303
    old = app_login.make_token("test", now=0)
    assert app_login.session_user(old) is None
    c.cookies.set(app_login.COOKIE, old)
    assert c.get("/").status_code == 303


def test_the_demo_session_does_not_open_the_application():
    c = client()
    assert c.post("/api/demo/login", json={"username": "solvay", "password": "solvay"}).status_code == 200
    assert c.get("/").status_code == 303


def test_the_api_and_the_demo_stay_as_they_were():
    # The demo's pages call the same API, so gating it would lock them out.
    assert client().get("/api/health").status_code == 200
    assert "/demo" not in app_login.page_paths(app)
    assert "/demo/login" not in app_login.page_paths(app)
    assert {"/", "/rollout"} <= app_login.page_paths(app)


def test_sign_in_page_sends_a_signed_in_reader_on():
    c = client()
    login(c)
    res = c.get("/login?next=/rollout")
    assert res.status_code == 303 and res.headers["location"] == "/rollout"


def test_next_never_leaves_the_site():
    for bad in ("https://evil.example", "//evil.example", "/login", "/login?next=/", "\\\\evil", ""):
        assert app_login.safe_next(bad) == "/", bad
    assert app_login.safe_next("/rollout?tab=brief") == "/rollout?tab=brief"


def test_sign_out_closes_the_pages_again():
    c = client()
    login(c)
    assert c.get("/").status_code == 200
    res = c.post("/api/app/logout")
    assert res.status_code == 200
    c.cookies.clear()
    assert c.get("/").status_code == 303


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
