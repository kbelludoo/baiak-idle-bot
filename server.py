import os
import json
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler


class DashboardHandler(SimpleHTTPRequestHandler):
    data_dir = "data"

    def do_GET(self):
        # API: Status em tempo real
        if self.path in ("/api/status", "/api/status/"):
            self.send_json_file("status.json")
            return

        # API: Matriz de aprendizado de hunts
        if self.path in ("/api/matrix", "/api/matrix/"):
            self.send_json_file("hunt_matrix.json")
            return

        # API: Benchmarks brutos
        if self.path in ("/api/benchmarks", "/api/benchmarks/"):
            self.send_json_file("benchmarks.json")
            return

        # Rota principal / Dashboard
        if self.path in ("/", "/dashboard", "/index.html"):
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

        # Fallback para arquivos estáticos na pasta data/
        file_name = self.path.lstrip("/").split("?")[0]
        file_path = os.path.join(self.data_dir, file_name)
        if os.path.isfile(file_path):
            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                mime = "image/png" if file_name.endswith(".png") else "text/plain"
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(content)
                return
            except Exception:
                pass

        self.send_error(404, "Not Found")

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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Silencia logs HTTP para não poluir o terminal do bot
        pass


def start_dashboard_server(data_dir: str, port: int = 8080):
    DashboardHandler.data_dir = data_dir
    try:
        server = HTTPServer(("0.0.0.0", port), DashboardHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(f"[*] 🌐 [DASHBOARD WEB] Servidor ativo em http://0.0.0.0:{port}/ (Dashboard & API em tempo real)", flush=True)
        return server
    except Exception as e:
        print(f"[*] ⚠️ [DASHBOARD WEB AVISO] Não foi possível iniciar na porta {port}: {e}", flush=True)
        return None
