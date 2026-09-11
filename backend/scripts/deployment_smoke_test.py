"""Minimal non-mutating deployment smoke test.

Usage:
  DEPLOYMENT_API_URL=https://api.example.invalid \
  DEPLOYMENT_WEB_URL=https://app.example.invalid \
  python backend/scripts/deployment_smoke_test.py

It intentionally checks only public health/UI endpoints and never sends
credentials, creates data, or logs secrets.
"""

from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urljoin, urlparse


def _url(base: str, path: str) -> str:
    parsed = urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"Invalid deployment URL: {base!r}")
    return urljoin(base.rstrip("/") + "/", path.lstrip("/"))


def _get(base: str, path: str) -> tuple[int, str]:
    request = Request(_url(base, path), headers={"User-Agent": "samarth-deployment-smoke/1.0"})
    try:
        with urlopen(request, timeout=15) as response:  # noqa: S310 - URLs are explicit operator input
            return response.status, response.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")
    except URLError as exc:
        raise RuntimeError(f"Could not reach {_url(base, path)}: {exc.reason}") from exc


def _assert_json_ok(base: str, path: str, *, ready: bool = False) -> None:
    status, body = _get(base, path)
    if status != 200:
        raise RuntimeError(f"{path} returned HTTP {status}: {body[:300]}")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{path} did not return JSON") from exc
    expected = "ok" if ready else "ok"
    if payload.get("status") != expected:
        raise RuntimeError(f"{path} reported {payload.get('status')!r}, expected {expected!r}")
    print(f"[OK] {path}: {payload.get('status')}")


def main() -> int:
    api_url = os.getenv("DEPLOYMENT_API_URL", "")
    web_url = os.getenv("DEPLOYMENT_WEB_URL", "")
    if not api_url or not web_url:
        print("Set DEPLOYMENT_API_URL and DEPLOYMENT_WEB_URL before running this smoke test.", file=sys.stderr)
        return 2

    try:
        _assert_json_ok(api_url, "/health")
        _assert_json_ok(api_url, "/ready", ready=True)
        status, _ = _get(web_url, "/login")
        if status != 200:
            raise RuntimeError(f"/login returned HTTP {status}")
        print("[OK] /login: HTTP 200")
        _assert_json_ok(web_url, "/api/health")
    except (RuntimeError, ValueError) as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        return 1
    print("Deployment smoke test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
