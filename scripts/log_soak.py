#!/usr/bin/env python3
import json
import time
import urllib.request
import os

API_URL = "https://disfigure-tribune-silo.ngrok-free.dev/api/public/overview"
LOG_FILE = "logs/soak_tracker.json"
SUMMARY_FILE = "logs/soak_summary.txt"

def fetch_overview():
    req = urllib.request.Request(API_URL, headers={"ngrok-skip-browser-warning": "true"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}

def log_point():
    now = time.time()
    try:
        with open(LOG_FILE, "r") as f:
            data = json.load(f)
    except Exception:
        data = {
            "goal_start_ts": now,
            "target_60m_ts": now + 60*60,
            "target_180m_ts": now + 180*60,
            "target_260m_ts": now + 260*60,
            "vps1_target_hunt": "glooth-cave",
            "vps2_target_hunt": "vexclaw-lair",
            "history": []
        }

    overview = fetch_overview()
    bots = overview.get("bots", {})
    vps1 = bots.get("vps1", {}).get("status", {})
    vps2 = bots.get("vps2", {}).get("status", {})

    point = {
        "timestamp": now,
        "elapsed_sec": now - data["goal_start_ts"],
        "elapsed_min": round((now - data["goal_start_ts"]) / 60, 1),
        "vps1": {
            "online": vps1.get("online", False),
            "hunt": vps1.get("hunt", ""),
            "force_hunt_id": vps1.get("force_hunt_id", ""),
            "uptime_sec": vps1.get("online_uptime_seconds", 0),
            "disconnects": vps1.get("ws_disconnect_count", 0),
            "kills": vps1.get("kills", 0),
            "waves": vps1.get("waves", 0),
            "gold": vps1.get("gold", 0),
            "level": vps1.get("level", 0)
        },
        "vps2": {
            "online": vps2.get("online", False),
            "hunt": vps2.get("hunt", ""),
            "force_hunt_id": vps2.get("force_hunt_id", ""),
            "uptime_sec": vps2.get("online_uptime_seconds", 0),
            "disconnects": vps2.get("ws_disconnect_count", 0),
            "kills": vps2.get("kills", 0),
            "waves": vps2.get("waves", 0),
            "gold": vps2.get("gold", 0),
            "level": vps2.get("level", 0)
        }
    }

    data["history"].append(point)
    if len(data["history"]) > 2000:
        data["history"] = data["history"][-2000:]

    with open(LOG_FILE, "w") as f:
        json.dump(data, f, indent=2)

    elapsed_m = point["elapsed_min"]
    status_line = (
        f"[{time.strftime('%H:%M:%S')}] Elapsed: {elapsed_m:.1f}m | "
        f"VPS1: online={point['vps1']['online']}, hunt={point['vps1']['hunt']}, up={point['vps1']['uptime_sec']}s, dc={point['vps1']['disconnects']}, kills={point['vps1']['kills']} | "
        f"VPS2: online={point['vps2']['online']}, hunt={point['vps2']['hunt']}, up={point['vps2']['uptime_sec']}s, dc={point['vps2']['disconnects']}, kills={point['vps2']['kills']}"
    )
    print(status_line)
    with open(SUMMARY_FILE, "a") as f:
        f.write(status_line + "\n")

if __name__ == "__main__":
    log_point()
