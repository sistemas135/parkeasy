"""Mini PostgREST + Storage para pruebas locales: ejecuta las RPC contra el Postgres local como rol anon."""
import json, os, re, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import psycopg2, psycopg2.extras

DSN = "host=/tmp port=5499 user=postgres dbname=pe"
DOCS = os.path.join(os.path.dirname(__file__), "..", "docs")
UP = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UP, exist_ok=True)

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)): body = json.dumps(body, default=str).encode()
        elif isinstance(body, str): body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "*"); self.send_header("Access-Control-Allow-Methods", "*")
        self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self._send(204, b"")
    def do_GET(self):
        p = self.path.split("?")[0]
        if p.startswith("/storage/v1/object/public/fotos/"):
            f = os.path.join(UP, p.split("/fotos/", 1)[1].replace("/", "__"))
            if os.path.exists(f): return self._send(200, open(f, "rb").read(), "image/jpeg")
            return self._send(404, {"error": "not found"})
        if p.startswith("/rest/"): return self._send(401, {"message": "permission denied for table"})
        # archivos estáticos
        if p == "/config.js":
            src = open(os.path.join(DOCS, "config.js")).read()
            src = re.sub(r'SUPABASE_URL: "[^"]+"', 'SUPABASE_URL: "http://127.0.0.1:8787"', src)
            return self._send(200, src, "text/javascript")
        f = os.path.join(DOCS, "index.html" if p in ("/", "") else p.lstrip("/"))
        if os.path.isfile(f):
            ct = {"html": "text/html", "js": "text/javascript", "css": "text/css", "png": "image/png", "json": "application/json"}.get(f.rsplit(".", 1)[-1], "application/octet-stream")
            return self._send(200, open(f, "rb").read(), ct)
        return self._send(404, "no")
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = self.rfile.read(n)
        p = self.path.split("?")[0]
        if p.startswith("/storage/v1/object/fotos/"):
            key = p.split("/fotos/", 1)[1]
            open(os.path.join(UP, key.replace("/", "__")), "wb").write(body)
            return self._send(200, {"Key": "fotos/" + key})
        m = re.match(r"/rest/v1/rpc/(\w+)$", p)
        if not m: return self._send(404, {"message": "not found"})
        params = json.loads(body or b"{}")
        try:
            with psycopg2.connect(DSN) as c:
                c.autocommit = False
                cur = c.cursor()
                cur.execute("set role anon")
                args = ", ".join(f"{k} := %({k})s" for k in params)
                psycopg2.extras.register_default_jsonb(cur, loads=lambda x: x)
                cur.execute(f"select {m.group(1)}({args})", {k: (json.dumps(v) if isinstance(v, dict) or (isinstance(v, list) and k == "p_fotos") else v) for k, v in params.items()})
                row = cur.fetchone()[0]
                c.commit()
            if isinstance(row, str):
                try: row = json.loads(row)
                except Exception: pass
            return self._send(200, row)
        except Exception as e:
            msg = str(e).split("\n")[0]
            code = 400
            return self._send(code, {"message": msg, "code": "P0001"})

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print("mock backend on", port); sys.stdout.flush()
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
