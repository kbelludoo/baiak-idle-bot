"""Buffer + captura 480p (CDP e fallback screenshot). Sem ffmpeg / sem 4K."""

from __future__ import annotations

import base64
import threading
import time
from typing import Any, Callable

STREAM_W = 854
STREAM_H = 480
STREAM_FPS = 12
STREAM_Q = 70


class LatestFrame:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self.jpeg = b""
        self.seq = 0
        self.width = STREAM_W
        self.height = STREAM_H
        self.fps = 0.0
        self.last_ts = 0.0
        self._t0 = time.monotonic()
        self._n = 0

    def push(self, jpeg: bytes, width: int = 0, height: int = 0) -> None:
        if not jpeg:
            return
        with self._cond:
            self.jpeg = jpeg
            self.seq += 1
            self.last_ts = time.monotonic()
            if width:
                self.width = width
            if height:
                self.height = height
            self._n += 1
            now = self.last_ts
            dt = now - self._t0
            if dt >= 1.0:
                inst = self._n / dt
                self.fps = inst if self.fps <= 0 else (self.fps * 0.55 + inst * 0.45)
                self._t0 = now
                self._n = 0
            self._cond.notify_all()

    def snapshot(self) -> tuple[bytes, int]:
        with self._lock:
            return self.jpeg, self.seq

    def wait_next(self, last_seq: int, timeout: float = 1.0) -> tuple[bytes, int]:
        deadline = time.monotonic() + timeout
        with self._cond:
            while self.seq == last_seq or not self.jpeg:
                left = deadline - time.monotonic()
                if left <= 0:
                    return self.jpeg, self.seq
                self._cond.wait(timeout=left)
            return self.jpeg, self.seq

    def stats(self) -> dict[str, Any]:
        with self._lock:
            age = (time.monotonic() - self.last_ts) if self.last_ts else None
            return {
                "fps": round(self.fps, 1),
                "width": self.width,
                "height": self.height,
                "seq": self.seq,
                "bytes": len(self.jpeg),
                "ready": bool(self.jpeg),
                "age_s": round(age, 2) if age is not None else None,
            }


class StreamPump:
    """CDP screencast depois do goto; se falhar, JPEG via page.screenshot."""

    def __init__(
        self,
        frames: LatestFrame,
        *,
        width: int = STREAM_W,
        height: int = STREAM_H,
        quality: int = STREAM_Q,
        fps: int = STREAM_FPS,
    ) -> None:
        self.frames = frames
        self.width = max(320, min(1280, int(width)))
        self.height = max(240, min(720, int(height)))
        self.quality = max(40, min(85, int(quality)))
        self.fps = max(4, min(24, int(fps)))
        self.interval = 1.0 / self.fps
        self.mode = "off"
        self.error = "aguardando captura"
        self._session: Any = None
        self._acks: list[Any] = []
        self._lock = threading.Lock()

    def stats(self) -> dict[str, Any]:
        out = self.frames.stats()
        out["mode"] = self.mode
        out["error"] = "" if out.get("ready") else self.error
        return out

    def attach_cdp(self, page: Any) -> None:
        self._stop_cdp()
        try:
            session = page.context.new_cdp_session(page)
            try:
                session.send("Page.enable")
            except Exception:
                pass
            session.on("Page.screencastFrame", self._on_cdp_frame)
            session.send("Page.startScreencast", {
                "format": "jpeg",
                "quality": self.quality,
                "maxWidth": self.width,
                "maxHeight": self.height,
                "everyNthFrame": 1,
            })
            self._session = session
            self.mode = "cdp"
            self.error = ""
        except Exception as e:
            self._session = None
            self.mode = "shot"
            self.error = f"cdp: {e}"[:160]

    def tick(self, page: Any) -> None:
        self._flush_acks()
        age = time.monotonic() - self.frames.last_ts if self.frames.last_ts else 99.0
        if self.frames.jpeg and age < self.interval * 0.85:
            return
        try:
            raw = page.screenshot(type="jpeg", quality=self.quality, timeout=2500)
            self.frames.push(raw, self.width, self.height)
            if self.mode == "cdp" and age > 1.2:
                self.mode = "shot"
            elif self.mode == "off":
                self.mode = "shot"
            self.error = ""
        except Exception as e:
            self.error = f"screenshot: {e}"[:160]

    def _on_cdp_frame(self, params: dict[str, Any]) -> None:
        sid = params.get("sessionId")
        if sid is not None and self._session:
            try:
                self._session.send("Page.screencastFrameAck", {"sessionId": sid})
            except Exception:
                pass
        try:
            raw = base64.b64decode(params.get("data") or "", validate=False)
        except Exception:
            raw = b""
        if raw:
            md = params.get("metadata") or {}
            self.frames.push(
                raw,
                int(md.get("deviceWidth") or self.width),
                int(md.get("deviceHeight") or self.height),
            )
            self.mode = "cdp"
            self.error = ""

    def _flush_acks(self) -> None:
        pass

    def _stop_cdp(self) -> None:
        sess = self._session
        self._session = None
        if not sess:
            return
        try:
            sess.send("Page.stopScreencast")
        except Exception:
            pass


import queue

click_queue: queue.Queue = queue.Queue()
eval_queue: queue.Queue = queue.Queue()


def enqueue_click(x: int, y: int, button: str = "left", timeout: float = 5.0) -> dict[str, Any]:
    req = {
        "x": x,
        "y": y,
        "button": button,
        "done": threading.Event(),
        "result": {"ok": False, "reason": "timeout"},
    }
    click_queue.put(req)
    req["done"].wait(timeout=timeout)
    return req["result"]


def enqueue_eval(js: str, timeout: float = 15.0) -> dict[str, Any]:
    req = {
        "js": js,
        "done": threading.Event(),
        "result": {"ok": False, "error": "timeout"},
    }
    eval_queue.put(req)
    req["done"].wait(timeout=timeout)
    return req["result"]


def process_pending_evals(page: Any) -> int:
    count = 0
    while not eval_queue.empty():
        req = None
        try:
            req = eval_queue.get_nowait()
            js = str(req.get("js", ""))
            val = page.evaluate(js)
            req["result"] = {"ok": True, "result": val}
            req["done"].set()
            count += 1
        except Exception as e:
            if req and "done" in req and not req["done"].is_set():
                req["result"] = {"ok": False, "error": str(e)}
                req["done"].set()
    return count


def process_pending_clicks(page: Any, pump: StreamPump | None = None) -> int:
    count = 0
    while not click_queue.empty():
        req = None
        try:
            req = click_queue.get_nowait()
            cx = int(req.get("x", 0))
            cy = int(req.get("y", 0))
            cbtn = str(req.get("button", "left"))
            page.mouse.click(cx, cy, button=cbtn)
            time.sleep(0.06)
            if pump is not None:
                try:
                    raw = page.screenshot(type="jpeg", quality=pump.quality, timeout=1500)
                    pump.frames.push(raw, pump.width, pump.height)
                except Exception:
                    pass
            req["result"] = {"ok": True, "x": cx, "y": cy, "button": cbtn}
            req["done"].set()
            count += 1
        except Exception as e:
            if req and "done" in req and not req["done"].is_set():
                req["result"] = {"ok": False, "reason": str(e)}
                req["done"].set()
    return count


def idle_capture(
    page: Any,
    pump: StreamPump | None,
    seconds: float,
    should_continue: Callable[[], bool],
) -> None:
    end = time.time() + max(0.0, seconds)
    interval = pump.interval if pump else 0.1
    while should_continue() and time.time() < end:
        process_pending_clicks(page, pump)
        process_pending_evals(page)
        t0 = time.time()
        if pump is not None:
            try:
                pump.tick(page)
            except Exception:
                pass
        left = end - time.time()
        if left <= 0:
            break
        pause = interval - (time.time() - t0)
        time.sleep(min(max(0.0, pause), left))


def write_mjpeg(handler: Any, frames: LatestFrame | None) -> None:
    if frames is None:
        handler.send_error(503, "stream off")
        return
    handler.send_response(200)
    handler.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
    handler.send_header("Pragma", "no-cache")
    handler.send_header("Expires", "0")
    handler.send_header("Connection", "close")
    handler.send_header("X-Accel-Buffering", "no")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Type", "multipart/x-mixed-replace; boundary=baiakframe")
    handler.end_headers()
    last = -1
    try:
        while True:
            jpeg, seq = frames.wait_next(last, timeout=1.0)
            if not jpeg or seq == last:
                continue
            last = seq
            handler.wfile.write(b"--baiakframe\r\n")
            handler.wfile.write(b"Content-Type: image/jpeg\r\n")
            handler.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii"))
            handler.wfile.write(jpeg)
            handler.wfile.write(b"\r\n")
            handler.wfile.flush()
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
        return
