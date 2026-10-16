"""Servidor local do Palheta (sem cache, para ver suas edições na hora).

Uso:  py servidor.py [porta]
A porta também pode vir da variável de ambiente PORT; o padrão é 8000.
"""
import http.server
import os
import sys


class SemCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Servidor(http.server.ThreadingHTTPServer):
    # No Windows, reaproveitar o endereço deixa dois servidores dividirem a mesma porta
    # sem erro; desligado, a segunda tentativa falha e dá para avisar.
    allow_reuse_address = sys.platform != "win32"


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8000))
    try:
        servidor = Servidor(("127.0.0.1", porta), SemCache)
    except OSError:
        print(f"A porta {porta} já está em uso: o Palheta talvez já esteja aberto em http://localhost:{porta}")
        sys.exit(1)
    print(f"Palheta em http://localhost:{porta}  (Ctrl+C para parar)")
    servidor.serve_forever()
