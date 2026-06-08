#!/usr/bin/env python3
"""Small /v1/runs adapter for Hermes CLI one-shot mode.

This is intentionally narrow: it exposes the HTTP/SSE surface expected by the
Agent Coworking Space Hermes provider and delegates each run to `hermes -z`.
It is useful when a Hermes install has the CLI but not a first-party runs API.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse


RUNS: dict[str, "HermesRun"] = {}
RUNS_LOCK = threading.Lock()


def now() -> float:
    return time.time()


def env_value(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def auth_token() -> str:
    return env_value("HERMES_API_KEY") or env_value("API_SERVER_KEY")


class HermesRun:
    def __init__(self, run_id: str, prompt: str, model: str | None, cwd: str | None):
        self.run_id = run_id
        self.prompt = prompt
        self.model = model
        self.cwd = cwd
        self.process: subprocess.Popen[str] | None = None
        self.events: list[dict[str, Any]] = []
        self.done = False
        self.condition = threading.Condition()

    def add_event(self, event: dict[str, Any]) -> None:
        event.setdefault("run_id", self.run_id)
        event.setdefault("timestamp", now())
        with self.condition:
            self.events.append(event)
            self.condition.notify_all()

    def mark_done(self) -> None:
        with self.condition:
            self.done = True
            self.condition.notify_all()


def run_hermes(job: HermesRun) -> None:
    hermes_bin = env_value("HERMES_BIN", "hermes")
    cwd = job.cwd or env_value("HERMES_ADAPTER_CWD") or None
    extra_args = [part for part in env_value("HERMES_ADAPTER_EXTRA_ARGS", "--ignore-rules").split(" ") if part]
    command = [hermes_bin, "-z", job.prompt]
    if job.model:
        command.extend(["--model", job.model])
    command.extend(extra_args)

    job.add_event({"event": "run.started"})
    try:
        job.process = subprocess.Popen(
            command,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except Exception as exc:
        job.add_event({"event": "run.failed", "error": f"failed_to_start_hermes: {exc}"})
        job.mark_done()
        return

    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []

    def read_stream(stream: Any, target: list[str], event_name: str) -> None:
        try:
            while True:
                chunk = stream.readline()
                if not chunk:
                    break
                target.append(chunk)
                job.add_event({"event": event_name, "delta" if event_name == "message.delta" else "text": chunk})
        finally:
            try:
                stream.close()
            except Exception:
                pass

    stdout_thread = threading.Thread(
        target=read_stream,
        args=(job.process.stdout, stdout_chunks, "message.delta"),
        daemon=True,
    )
    stderr_thread = threading.Thread(
        target=read_stream,
        args=(job.process.stderr, stderr_chunks, "reasoning.available"),
        daemon=True,
    )
    stdout_thread.start()
    stderr_thread.start()
    exit_code = job.process.wait()
    stdout_thread.join(timeout=2)
    stderr_thread.join(timeout=2)

    output = "".join(stdout_chunks).strip()
    error_output = "".join(stderr_chunks).strip()
    if exit_code == 0:
        job.add_event({"event": "run.completed", "output": output})
    else:
        job.add_event({"event": "run.failed", "error": error_output or f"hermes exited with {exit_code}"})
    job.mark_done()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[hermes-adapter] {self.address_string()} - {fmt % args}", flush=True)

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self) -> bool:
        token = auth_token()
        if not token:
            self.send_json(500, {"error": "adapter_api_key_missing"})
            return False
        expected = f"Bearer {token}"
        if self.headers.get("Authorization", "") != expected:
            self.send_json(401, {"error": "unauthorized"})
            return False
        return True

    def read_body(self) -> dict[str, Any]:
        size = int(self.headers.get("Content-Length", "0") or "0")
        if size <= 0:
            return {}
        raw = self.rfile.read(size)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/healthz":
            self.send_json(200, {"ok": True, "adapter": "hermes-cli"})
            return
        if path.startswith("/v1/runs/") and path.endswith("/events"):
            if not self.authorized():
                return
            run_id = path.split("/")[3]
            with RUNS_LOCK:
                job = RUNS.get(run_id)
            if not job:
                self.send_json(404, {"error": "run_not_found"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            index = 0
            while True:
                with job.condition:
                    while index >= len(job.events) and not job.done:
                        job.condition.wait(timeout=15)
                    events = job.events[index:]
                    index = len(job.events)
                    done = job.done and index >= len(job.events)
                for event in events:
                    data = json.dumps(event)
                    try:
                        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        return
                if done:
                    try:
                        self.wfile.write(b"data: [DONE]\n\n")
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                    self.close_connection = True
                    return
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if not self.authorized():
            return
        if path == "/v1/runs":
            try:
                body = self.read_body()
            except Exception:
                self.send_json(400, {"error": "invalid_json"})
                return
            user_input = str(body.get("input") or "").strip()
            instructions = str(body.get("instructions") or "").strip()
            if not user_input:
                self.send_json(400, {"error": "input_required"})
                return
            cwd = str(body.get("project_path") or body.get("cwd") or "").strip() or None
            if cwd:
                cwd = os.path.abspath(os.path.expanduser(cwd))
                if not os.path.isdir(cwd):
                    self.send_json(400, {"error": "invalid_project_path", "project_path": cwd})
                    return
            prompt = f"{instructions}\n\n{user_input}".strip() if instructions else user_input
            model = str(body.get("model") or "").strip() or None
            run_id = str(uuid.uuid4())
            job = HermesRun(run_id, prompt, model, cwd)
            with RUNS_LOCK:
                RUNS[run_id] = job
            threading.Thread(target=run_hermes, args=(job,), daemon=True).start()
            self.send_json(202, {"run_id": run_id, "status": "started"})
            return
        if path.startswith("/v1/runs/") and path.endswith("/stop"):
            run_id = path.split("/")[3]
            with RUNS_LOCK:
                job = RUNS.get(run_id)
            if job and job.process and job.process.poll() is None:
                try:
                    job.process.send_signal(signal.SIGTERM)
                except Exception:
                    pass
                job.add_event({"event": "run.cancelled"})
                job.mark_done()
            self.send_json(200, {"ok": True})
            return
        if path.startswith("/v1/runs/") and path.endswith("/approval"):
            self.send_json(200, {"ok": True})
            return
        self.send_json(404, {"error": "not_found"})


def main() -> None:
    parser = argparse.ArgumentParser(description="Expose Hermes CLI as a minimal /v1/runs API.")
    parser.add_argument("--host", default=env_value("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(env_value("PORT", "8787")))
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[hermes-adapter] listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
