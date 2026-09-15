import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from stream import LatestFrame, write_mjpeg


class DashboardHandler(SimpleHTTPRequestHandler):
    data_dir = "data"
    frames: LatestFrame | None = None

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/api/status", "/api/status/"):
            self.send_json_file("status.json")
            return
        if path in ("/api/matrix", "/api/matrix/"):
            self.send_json_file("hunt_matrix.json")
            return
        if path in ("/api/benchmarks", "/api/benchmarks/"):
            self.send_json_file("benchmarks.json")
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

    def log_message(self, format, *args):
        pass


def start_dashboard_server(data_dir: str, port: int = 8080, frames: LatestFrame | None = None):
    DashboardHandler.data_dir = data_dir
    DashboardHandler.frames = frames
    try:
        server = ThreadingHTTPServer(("0.0.0.0", port), DashboardHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(f"[*] 🌐 [DASHBOARD WEB] Servidor ativo em http://0.0.0.0:{port}/ (Dashboard & API em tempo real)", flush=True)
        print(f"[*] 📺 [STREAM] MJPEG 480p em http://0.0.0.0:{port}/api/stream.mjpeg", flush=True)
        return server
    except Exception as e:
        print(f"[*] ⚠️ [DASHBOARD WEB AVISO] Não foi possível iniciar na porta {port}: {e}", flush=True)
        return None
