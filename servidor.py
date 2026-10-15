"""Servidor local do Guitarra Guiada (sem cache, para ver suas edições na hora).

Uso:  py servidor.py [porta]
"""
import http.server
import os
import sys


class SemCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Guitarra Guiada em http://localhost:{porta}  (Ctrl+C para parar)")
    http.server.ThreadingHTTPServer(("127.0.0.1", porta), SemCache).serve_forever()
