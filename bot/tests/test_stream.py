import time

from stream import LatestFrame, STREAM_H, STREAM_W, write_mjpeg


def test_latest_frame_push_and_wait():
    f = LatestFrame()
    assert f.snapshot() == (b"", 0)
    f.push(b"\xff\xd8fake", STREAM_W, STREAM_H)
    jpeg, seq = f.snapshot()
    assert jpeg.startswith(b"\xff\xd8")
    assert seq == 1
    st = f.stats()
    assert st["ready"] is True
    assert st["width"] == STREAM_W
    nxt, seq2 = f.wait_next(0, timeout=0.2)
    assert seq2 == 1
    assert nxt == jpeg


def test_wait_next_times_out_without_new_frame():
    f = LatestFrame()
    f.push(b"abc")
    t0 = time.monotonic()
    jpeg, seq = f.wait_next(1, timeout=0.15)
    assert seq == 1
    assert jpeg == b"abc"
    assert time.monotonic() - t0 >= 0.12


class _FakeWfile:
    def __init__(self):
        self.chunks = []

    def write(self, data):
        self.chunks.append(data)

    def flush(self):
        raise BrokenPipeError()


class _FakeHandler:
    def __init__(self):
        self.wfile = _FakeWfile()
        self.headers = []
        self.status = None

    def send_response(self, code):
        self.status = code

    def send_header(self, k, v):
        self.headers.append((k, v))

    def end_headers(self):
        pass

    def send_error(self, code, msg=""):
        self.status = code


def test_mjpeg_writes_boundary_then_stops_on_disconnect():
    frames = LatestFrame()
    frames.push(b"\xff\xd8xx")
    h = _FakeHandler()
    write_mjpeg(h, frames)
    blob = b"".join(h.wfile.chunks)
    assert h.status == 200
    assert any("multipart/x-mixed-replace" in v for _, v in h.headers)
    assert b"--baiakframe" in blob
    assert b"Content-Type: image/jpeg" in blob


def test_mjpeg_off_is_503():
    h = _FakeHandler()
    write_mjpeg(h, None)
    assert h.status == 503


class _FakePage:
    def screenshot(self, **kwargs):
        return b"\xff\xd8shot"


def test_stream_pump_fallback_screenshot():
    from stream import StreamPump
    frames = LatestFrame()
    pump = StreamPump(frames, fps=12, width=854, height=480, quality=70)
    pump.tick(_FakePage())
    assert frames.seq == 1
    assert frames.jpeg.startswith(b"\xff\xd8")
    st = pump.stats()
    assert st["ready"] is True
    assert st["mode"] == "shot"
    assert st["error"] == ""


def test_idle_capture_fills_frames():
    from stream import StreamPump, idle_capture
    frames = LatestFrame()
    pump = StreamPump(frames, fps=12)
    idle_capture(_FakePage(), pump, 0.2, lambda: True)
    assert frames.seq >= 1


if __name__ == "__main__":
    test_latest_frame_push_and_wait()
    test_wait_next_times_out_without_new_frame()
    test_mjpeg_writes_boundary_then_stops_on_disconnect()
    test_mjpeg_off_is_503()
    test_stream_pump_fallback_screenshot()
    test_idle_capture_fills_frames()
    print("ok")
