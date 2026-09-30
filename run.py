#!/usr/bin/env python3
"""Jalankan sekali untuk situs Volve DCA Edge.

- Melatih model HANYA jika public/model.onnx, public/samples.json, atau
  public/metrics.json belum ada (atau kosong). Sekali dilatih, hasilnya
  dipakai terus; skrip ini TIDAK melatih ulang pada run berikutnya.
- Menjalankan server statis di 127.0.0.1 (bukan localhost/[::]) dan
  membuka browser otomatis.

Pemakaian: python run.py   (atau klik dua kali run.bat di Windows)
Untuk melatih ulang: hapus salah satu dari tiga berkas di atas lalu
jalankan skrip ini lagi.
"""
import http.server
import socket
import socketserver
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
ARTIFACTS = [PUBLIC / "model.onnx", PUBLIC / "samples.json", PUBLIC / "metrics.json"]
PORT_CANDIDATES = [8000, 8001, 8002, 8080, 8888]


def artifacts_ready():
    return all(p.exists() and p.stat().st_size > 0 for p in ARTIFACTS)


def train_once():
    train_py = ROOT / "src" / "train.py"
    if not train_py.exists():
        print(f"[run.py] ERROR: {train_py} tidak ditemukan.")
        print("[run.py] Jalankan skrip ini dari akar repo (folder yang berisi src/ dan public/).")
        sys.exit(1)
    print("[run.py] Model belum lengkap di public/, melatih sekali (python src/train.py)...")
    result = subprocess.run([sys.executable, str(train_py)], cwd=ROOT)
    if result.returncode != 0:
        print("[run.py] ERROR: training gagal. Lihat pesan di atas untuk detailnya.")
        sys.exit(1)
    if not artifacts_ready():
        missing = [p.name for p in ARTIFACTS if not (p.exists() and p.stat().st_size > 0)]
        print(f"[run.py] ERROR: training selesai tapi masih kurang: {', '.join(missing)}.")
        sys.exit(1)
    print("[run.py] Training selesai. Hasil tersimpan di public/ dan tidak akan dilatih ulang.")


def find_free_port():
    for port in PORT_CANDIDATES:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def serve(port):
    if not PUBLIC.exists():
        print(f"[run.py] ERROR: folder {PUBLIC} tidak ditemukan.")
        sys.exit(1)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(PUBLIC), **kwargs)

        def log_message(self, fmt, *args):
            pass  # senyapkan log akses baris-per-baris; error tetap tampil lewat traceback

    with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
        url = f"http://127.0.0.1:{httpd.server_address[1]}"
        print(f"[run.py] Situs berjalan di {url}")
        print("[run.py] Tekan Ctrl+C di jendela ini untuk berhenti.")
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[run.py] Dihentikan.")


def main():
    if artifacts_ready():
        print("[run.py] Model sudah ada di public/ (model.onnx, samples.json, metrics.json).")
        print("[run.py] Memakai cache, TIDAK dilatih ulang. Hapus salah satu berkas itu untuk melatih ulang.")
    else:
        train_once()
    serve(find_free_port())


if __name__ == "__main__":
    main()