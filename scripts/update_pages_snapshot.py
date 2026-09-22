#!/usr/bin/env python3
"""Refresh the static Pages snapshot from the live fleet APIs."""

import datetime
import json
import pathlib
import sys
import urllib.request


def fetch(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "baiak-pages-snapshot"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def bundle(status: dict) -> dict:
    online = bool(status.get("online") and status.get("connected", status.get("online")))
    return {
        "status": status,
        "benchmarks": status.get("benchmarks", {}),
        "matrix": status.get("hunt_matrix", {}),
        "health": {
            "state": "online" if online else "offline",
            "detail": "Consulta direta à VPS",
            "received_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        },
    }


def main() -> int:
    out_path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "docs/fleet-snapshot.json")
    try:
        previous = json.loads(out_path.read_text())
    except Exception:
        previous = {}

    statuses = {}
    urls = {
        "vps1": "http://168.138.151.18:8080/api/status",
        "vps2": "http://137.131.226.117:8080/api/status",
    }
    for bot_id, url in urls.items():
        try:
            statuses[bot_id] = bundle(fetch(url))
        except Exception as exc:
            old = previous.get("bots", {}).get(bot_id)
            if old:
                old = dict(old)
                old["health"] = {
                    **(old.get("health") or {}),
                    "state": "api_error",
                    "detail": f"Consulta direta indisponível: {exc}",
                }
                statuses[bot_id] = old
                print(f"{bot_id}: mantendo dados anteriores ({exc})")
            else:
                print(f"{bot_id}: sem dados anteriores ({exc})")

    if not any(bot.get("health", {}).get("state") == "online" for bot in statuses.values()):
        print("nenhuma VPS respondeu; snapshot anterior preservado")
        return 1

    snapshot = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "bots": statuses,
        "history": previous.get("history", {}),
    }
    out_path.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n")
    print("snapshot atualizado por consulta direta às VPS:", snapshot["generatedAt"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
