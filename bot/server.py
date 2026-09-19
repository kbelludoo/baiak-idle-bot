import hmac
import json
import os
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from stream import LatestFrame, write_mjpeg, enqueue_click, enqueue_eval


class DashboardHandler(SimpleHTTPRequestHandler):
    data_dir = "data"
    frames: LatestFrame | None = None

    def is_authorized_control(self) -> bool:
        """Allow control only from loopback or with the explicit admin token."""
        expected = os.environ.get("ADMIN_TOKEN", "").strip()
        raw = self.headers.get("Authorization") or self.headers.get("X-API-Key") or ""
        received = raw.removeprefix("Bearer ").strip()
        if expected and hmac.compare_digest(received, expected):
            return True
        return self.client_address[0] in {"127.0.0.1", "::1", "::ffff:127.0.0.1"}

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def deny_control(self) -> None:
        self.send_json({"ok": False, "error": "forbidden"}, status=403)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/healthz", "/healthz/"):
            status_path = os.path.join(self.data_dir, "status.json")
            try:
                with open(status_path, "r", encoding="utf-8") as f:
                    status = json.load(f)
                updated_at = float(status.get("last_update_ts") or 0)
                age_seconds = round(max(0.0, time.time() - updated_at), 1) if updated_at else None
                ready = bool(updated_at and age_seconds is not None and age_seconds < 45)
                self.send_json({"ok": ready, "age_seconds": age_seconds}, status=200 if ready else 503)
            except (OSError, ValueError, TypeError):
                self.send_json({"ok": False, "error": "status_unavailable"}, status=503)
            return
        if path in ("/api/status", "/api/status/"):
            self.send_json_file("status.json")
            return
        if path in ("/api/matrix", "/api/matrix/"):
            self.send_json_file("hunt_matrix.json")
            return
        if path in ("/api/benchmarks", "/api/benchmarks/"):
            self.send_json_file("benchmarks.json")
            return
        if path in ("/api/hunts", "/api/hunts/"):
            try:
                from hunts import HUNTS_TABLE
                body = json.dumps({"ok": True, "hunts": HUNTS_TABLE}, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                self.send_error(500, str(e))
                return
        if path in ("/", "/dashboard", "/index.html"):
            dash_path = os.path.join(self.data_dir, "dashboard.html")
            if os.path.exists(dash_path):
                try:
                    with open(dash_path, "rb") as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(content)))
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(content)
                    return
                except Exception as e:
                    self.send_error(500, str(e))
                    return
        if path in ("/api/stream", "/api/stream.mjpeg", "/stream.mjpeg"):
            write_mjpeg(self, self.frames)
            return
        if path.startswith("/api/screenshot") or path in ("/screenshot.jpg", "/screenshot_live.jpg"):
            self.send_latest_jpeg()
            return
        file_name = path.lstrip("/")
        file_path = os.path.join(self.data_dir, file_name)
        if os.path.isfile(file_path):
            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                if file_name.endswith(".png"):
                    mime = "image/png"
                elif file_name.endswith((".jpg", ".jpeg")):
                    mime = "image/jpeg"
                elif file_name.endswith(".html"):
                    mime = "text/html; charset=utf-8"
                elif file_name.endswith(".json"):
                    mime = "application/json; charset=utf-8"
                else:
                    mime = "text/plain"
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(content)
                return
            except Exception:
                pass
        self.send_error(404, "Not Found")

    def send_latest_jpeg(self):
        content = b""
        if self.frames is not None:
            content, _ = self.frames.snapshot()
        if not content:
            live_path = os.path.join(self.data_dir, "screenshot_live.jpg")
            if not os.path.exists(live_path):
                live_path = os.path.join(self.data_dir, "screenshot.png")
            if os.path.exists(live_path):
                with open(live_path, "rb") as f:
                    content = f.read()
        if not content:
            self.send_error(404, "no frame")
            return
        mime = "image/jpeg"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(content)

    def send_json_file(self, filename):
        path = os.path.join(self.data_dir, filename)
        data = {}
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {"error": "read_failed"}
        body = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        if path in ("/api/eval", "/api/eval/", "/api/click", "/api/click/", "/api/hunt", "/api/hunt/") and not self.is_authorized_control():
            self.deny_control()
            return

        # Endpoint temporário de inspeção — executa JS pelo Playwright
        if path in ("/api/eval", "/api/eval/"):
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
                data = json.loads(body)
                js = data.get("js") or data.get("expression") or "document.title"
                result = enqueue_eval(js)
                resp_bytes = json.dumps(result, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(resp_bytes)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(resp_bytes)
                return
            except Exception as e:
                err = json.dumps({"ok": False, "error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(err)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(err)
                return

        if path in ("/api/click", "/api/click/"):
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
                data = json.loads(body)
                x = int(data.get("x", 0))
                y = int(data.get("y", 0))
                button = str(data.get("button", "left")).lower()
                if button not in ("left", "right", "middle"):
                    button = "left"

                resp_data = {"ok": False, "reason": "no_handler"}
                if click_handler is not None:
                    resp_data = click_handler(x, y, button)

                resp_bytes = json.dumps(resp_data).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(resp_bytes)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(resp_bytes)
                return
            except Exception as e:
                err = json.dumps({"ok": False, "error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(err)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(err)
                return

        if path in ("/api/hunt", "/api/hunt/"):
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
                data = json.loads(body)
                hunt_id = str(data.get("hunt_id") or data.get("hunt") or "").strip()
                auto = bool(data.get("auto") or hunt_id.lower() in ("auto", "automatico", ""))
                resp_data = {"ok": False, "reason": "no_handler"}
                if hunt_handler is not None:
                    resp_data = hunt_handler("auto" if auto else hunt_id)
                resp_bytes = json.dumps(resp_data, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(resp_bytes)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(resp_bytes)
                return
            except Exception as e:
                err = json.dumps({"ok": False, "error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(err)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(err)
                return

        self.send_error(404, "Not Found")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def cdp_dispatch_click(x: int, y: int, button: str = "left") -> dict:
    import base64
    import socket
    import time
    import urllib.request
    try:
        req = urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=1.2)
        targets = json.loads(req.read())
        pages = [t for t in targets if t.get("type") == "page"]
        if not pages:
            return {"ok": False, "reason": "no_page"}
        ws_url = pages[0]["webSocketDebuggerUrl"]
        path = "/" + ws_url.split("/", 3)[3]

        s = socket.create_connection(("127.0.0.1", 9222), timeout=1.5)
        key = base64.b64encode(os.urandom(16)).decode()
        handshake = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: 127.0.0.1:9222\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        s.sendall(handshake.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = s.recv(1024)
            if not chunk:
                break
            resp += chunk

        def send_frame(text: str):
            data = text.encode("utf-8")
            mask = os.urandom(4)
            header = bytes([0x81, 0x80 | len(data)]) + mask
            masked = bytes([b ^ mask[i % 4] for i, b in enumerate(data)])
            s.sendall(header + masked)

        b_name = "right" if button == "right" else "left"
        msg1 = json.dumps({
            "id": 1,
            "method": "Input.dispatchMouseEvent",
            "params": {"type": "mousePressed", "x": x, "y": y, "button": b_name, "clickCount": 1}
        })
        msg2 = json.dumps({
            "id": 2,
            "method": "Input.dispatchMouseEvent",
            "params": {"type": "mouseReleased", "x": x, "y": y, "button": b_name, "clickCount": 1}
        })
        send_frame(msg1)
        time.sleep(0.04)
        send_frame(msg2)
        s.close()
        return {"ok": True, "x": x, "y": y, "button": b_name, "method": "cdp_direct"}
    except Exception as e:
        # Fallback to enqueue_click if CDP port is not open
        try:
            return enqueue_click(x, y, button, timeout=1.5)
        except Exception:
            return {"ok": False, "error": str(e)}


    def log_message(self, format, *args):
        pass

    def log_error(self, format, *args):
        pass


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Silencia ConnectionResetError e tentativas de scanners externos
        pass


click_handler = cdp_dispatch_click
eval_handler = None
hunt_handler = None


def set_click_handler(fn):
    global click_handler
    click_handler = fn


def set_eval_handler(fn):
    global eval_handler
    eval_handler = fn


def set_hunt_handler(fn):
    global hunt_handler
    hunt_handler = fn


def start_dashboard_server(data_dir: str, port: int = 8080, frames: LatestFrame | None = None, on_click=None, on_eval=None, on_hunt=None):
    DashboardHandler.data_dir = data_dir
    DashboardHandler.frames = frames
    if on_click is not None:
        set_click_handler(on_click)
    if on_eval is not None:
        set_eval_handler(on_eval)
    if on_hunt is not None:
        set_hunt_handler(on_hunt)
    try:
        server = QuietThreadingHTTPServer(("0.0.0.0", port), DashboardHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(f"[*] 🌐 [DASHBOARD WEB] Servidor ativo em http://0.0.0.0:{port}/ (Dashboard & API em tempo real)", flush=True)
        print(f"[*] 🖱️ [INTERATIVO] Cliques remotos nativos CDP habilitados em POST /api/click", flush=True)
        return server
    except Exception as e:
        print(f"[*] ⚠️ [DASHBOARD WEB AVISO] Não foi possível iniciar na porta {port}: {e}", flush=True)
        return None
