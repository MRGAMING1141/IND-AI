"""Simple HTML UI server for IND-AI chatbot.

Run:
    python ind_ai_web_ui.py --host 127.0.0.1 --port 8000
Then open http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from ind_ai_memory_agent import ChatBot, MemoryStore, SessionStore


class INDWebApp:
    """Application service layer used by HTTP routes and tests."""

    def __init__(self, memory_file: str = "memory_store.json", session_file: str = "session_history.json") -> None:
        self.memory_store = MemoryStore(memory_file=memory_file)
        self.session_store = SessionStore(session_file=session_file)
        self.bot = ChatBot(memory_store=self.memory_store, session_store=self.session_store)

    def send_message(self, message: str) -> dict[str, Any]:
        response = self.bot.reply(message)
        return {"reply": response}

    def add_memory(self, task: str, solution: str, tags: list[str] | None = None) -> dict[str, Any]:
        entry = self.memory_store.add_memory(task=task, solution=solution, tags=tags or [])
        return {
            "task": entry.task,
            "solution": entry.solution,
            "tags": entry.tags,
            "created_at": entry.created_at,
        }

    def list_memories(self) -> dict[str, Any]:
        rows = [
            {
                "task": m.task,
                "solution": m.solution,
                "tags": m.tags,
                "created_at": m.created_at,
            }
            for m in self.memory_store.list_memories()
        ]
        return {"items": rows}


class INDRequestHandler(BaseHTTPRequestHandler):
    app: INDWebApp
    static_dir = Path(__file__).parent / "web"

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            return self._serve_file("index.html", "text/html; charset=utf-8")
        if self.path == "/styles.css":
            return self._serve_file("styles.css", "text/css; charset=utf-8")
        if self.path == "/app.js":
            return self._serve_file("app.js", "application/javascript; charset=utf-8")
        if self.path == "/api/memories":
            return self._send_json(HTTPStatus.OK, self.app.list_memories())
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        body = self._read_json_body()
        if body is None:
            return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON payload"})

        if self.path == "/api/chat":
            message = str(body.get("message", "")).strip()
            if not message:
                return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "'message' is required"})
            return self._send_json(HTTPStatus.OK, self.app.send_message(message))

        if self.path == "/api/memory":
            task = str(body.get("task", "")).strip()
            solution = str(body.get("solution", "")).strip()
            tags = body.get("tags") or []
            if not task or not solution:
                return self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Both 'task' and 'solution' are required"},
                )
            if not isinstance(tags, list):
                return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "'tags' must be a list"})
            clean_tags = [str(tag).strip() for tag in tags if str(tag).strip()]
            return self._send_json(HTTPStatus.CREATED, self.app.add_memory(task, solution, clean_tags))

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def _serve_file(self, filename: str, content_type: str) -> None:
        path = self.static_dir / filename
        if not path.exists():
            return self._send_json(HTTPStatus.NOT_FOUND, {"error": "File missing"})

        content = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _read_json_body(self) -> dict[str, Any] | None:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def run_server(host: str, port: int, memory_file: str, session_file: str) -> None:
    handler_cls = INDRequestHandler
    handler_cls.app = INDWebApp(memory_file=memory_file, session_file=session_file)

    server = ThreadingHTTPServer((host, port), handler_cls)
    print(f"IND-AI Web UI running at http://{host}:{port}")
    print("Press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="IND-AI HTML UI server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--memory-file", default="memory_store.json")
    parser.add_argument("--session-file", default="session_history.json")
    return parser


def main() -> None:
    args = _build_parser().parse_args()
    run_server(
        host=args.host,
        port=args.port,
        memory_file=args.memory_file,
        session_file=args.session_file,
    )


if __name__ == "__main__":
    main()
