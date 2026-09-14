"""Chromium mínimo: sem GPU, 1 renderer, sem fonte/mídia/tracker."""

from __future__ import annotations

import os

BLOCK_TYPES = frozenset({"media", "font", "texttrack", "manifest", "ping"})
BLOCK_HOSTS = (
    "google-analytics.com",
    "googletagmanager.com",
    "googleadservices.com",
    "doubleclick.net",
    "facebook.net",
    "hotjar.com",
)


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def viewport() -> dict[str, int]:
    return {
        "width": int(os.environ.get("CHROME_WIDTH", "800")),
        "height": int(os.environ.get("CHROME_HEIGHT", "540")),
    }


def gl_mode() -> str:
    raw = os.environ.get("CHROME_GL", "off").strip().lower()
    if raw in ("swiftshader", "on", "1", "true"):
        return "swiftshader"
    return "off"


def launch_args() -> list[str]:
    args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-audio-output",
        "--mute-audio",
        "--disable-blink-features=AutomationControlled",
        "--disable-extensions",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-sync",
        "--disable-background-networking",
        "--disable-breakpad",
        "--disable-domain-reliability",
        "--disable-features=AudioServiceOutOfProcess,Translate,BackForwardCache,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion,site-per-process",
        "--disable-hang-monitor",
        "--disable-ipc-flooding-protection",
        "--disable-popup-blocking",
        "--disable-prompt-on-repost",
        "--disable-renderer-backgrounding",
        "--metrics-recording-only",
        "--no-first-run",
        "--password-store=basic",
        "--use-mock-keychain",
        "--renderer-process-limit=1",
        "--js-flags=--max-old-space-size=96",
    ]
    if gl_mode() == "swiftshader":
        args += [
            "--enable-unsafe-swiftshader",
            "--use-gl=swiftshader",
            "--use-angle=swiftshader-webgl",
            "--disable-gpu-compositing",
            "--disable-partial-raster",
            "--disable-gpu-memory-buffer-video-frames",
        ]
    else:
        args += [
            "--disable-gpu",
            "--disable-gpu-compositing",
            "--disable-software-rasterizer",
        ]
    if env_flag("CHROME_SINGLE_PROCESS"):
        args.append("--single-process")
    return args


def should_abort(url: str, resource_type: str) -> bool:
    if resource_type in BLOCK_TYPES:
        return True
    return any(host in url for host in BLOCK_HOSTS)


def attach_blocker(page) -> None:
    # Não interceptar rotas: page.route quebra o WebSocket Colyseus.
    return


def context_options(user_agent: str) -> dict:
    return {
        "viewport": viewport(),
        "device_scale_factor": 1,
        "user_agent": user_agent,
        "locale": "pt-BR",
        "reduced_motion": "reduce",
        "service_workers": "block",
        "has_touch": False,
    }


def describe() -> str:
    vp = viewport()
    extra = " single-process" if env_flag("CHROME_SINGLE_PROCESS") else ""
    return f"chrome-min gl={gl_mode()} {vp['width']}x{vp['height']}{extra}"
