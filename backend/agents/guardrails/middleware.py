"""Redact contact details from every agent response at the HTTP boundary.

The agents redact what they produce, but that covers only runs made from now
on. Runs recorded before this rule existed sit in Postgres with whatever the
documents said, and reopening one from history -- or exporting its workshop
pack -- would show it. Redacting here, on the way out, covers the live stream,
the history, the exports and anything added later under these prefixes,
whatever produced it.

Text responses only (JSON, server-sent events, Markdown, plain text). The one
binary export, the Fit-Gap Copilot's PDF, is built from a record that is
redacted before it is rendered; see app.py.
"""

from __future__ import annotations

from . import contact

PREFIXES = ("/api/evidence", "/api/fitgap", "/api/rollout",
            # Ask RAG, its history and its scores, and the Quality workspace,
            # which shows questions, answers and excerpts from both.
            "/api/ask", "/api/quality")
_TEXTUAL = (b"application/json", b"text/event-stream", b"text/markdown", b"text/plain",
            b"text/csv")


class RedactContactDetails:
    """Pure ASGI, so a streamed response stays streamed."""

    def __init__(self, app, prefixes: tuple[str, ...] = PREFIXES):
        self.app = app
        self.prefixes = prefixes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith(self.prefixes):
            await self.app(scope, receive, send)
            return

        start: dict | None = None
        textual = False

        async def wrapped(message):
            nonlocal start, textual
            if message["type"] == "http.response.start":
                headers = dict(message.get("headers") or [])
                ctype = headers.get(b"content-type", b"").split(b";")[0].strip()
                textual = ctype in _TEXTUAL
                if not textual:
                    await send(message)
                    return
                start = message  # held until the first body arrives
                return
            if message["type"] == "http.response.body" and textual:
                body = message.get("body", b"")
                more = message.get("more_body", False)
                if body:
                    body = contact.redact(body.decode("utf-8", errors="replace")).encode("utf-8")
                if start is not None:
                    # The length changes when anything is masked, so the header
                    # is rewritten for a whole body and dropped for a stream.
                    headers = [(k, v) for k, v in start.get("headers", [])
                               if k.lower() != b"content-length"]
                    if not more:
                        headers.append((b"content-length", str(len(body)).encode()))
                    await send({**start, "headers": headers})
                    start = None
                await send({**message, "body": body})
                return
            await send(message)

        await self.app(scope, receive, wrapped)
