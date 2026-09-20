#!/usr/bin/env python3
import time
import subprocess
import os

SCRIPT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "log_soak.py")

while True:
    try:
        subprocess.run(["python3", SCRIPT_PATH], timeout=15)
    except Exception as e:
        print(f"[soak_daemon] erro: {e}")
    time.sleep(30)
