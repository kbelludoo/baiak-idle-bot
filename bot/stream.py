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
        if sid is not None:
            with self._lock:
                self._acks.append(sid)
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
        with self._lock:
            acks = self._acks
            self._acks = []
        sess = self._session
        if not sess:
            return
        for sid in acks:
            try:
                sess.send("Page.screencastFrameAck", {"sessionId": sid})
            except Exception:
                self._session = None

    def _stop_cdp(self) -> None:
        sess = self._session
        self._session = None
        if not sess:
            return
        try:
            sess.send("Page.stopScreencast")
        except Exception:
            pass


def idle_capture(
    page: Any,
    pump: StreamPump | None,
    seconds: float,
    should_continue: Callable[[], bool],
) -> None:
    end = time.time() + max(0.0, seconds)
    interval = pump.interval if pump else 0.08
    while should_continue() and time.time() < end:
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
