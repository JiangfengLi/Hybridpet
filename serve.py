#!/usr/bin/env python3
"""Local game server and credential-isolated Tripo gateway (stdlib only)."""
import functools
import http.server
import json
from pathlib import Path
import secrets
import socketserver
import sys
from urllib.parse import urlsplit, unquote
from tripo_service import JobStore

ROOT = Path(__file__).resolve().parent
HOST = '127.0.0.1'

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json',
        '.wasm':'application/wasm', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json',
        '.webp':'image/webp', '.svg':'image/svg+xml'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def local_request(self):
        port = self.server.server_address[1]
        hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
        origin = self.headers.get('Origin')
        return self.headers.get('Host') in hosts and (not origin or origin in {'http://' + h for h in hosts})

    def json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.local_request():
            return self.send_error(403)
        path = urlsplit(self.path).path
        store = self.server.jobs
        if path == '/api/tripo/config':
            return self.json_response({'configured': store.configured(), 'token': self.server.api_token})
        if path.startswith('/api/tripo/jobs/'):
            try:
                return self.json_response(store.public(store.read(path.rsplit('/', 1)[1])))
            except (OSError, ValueError):
                return self.json_response({'error': '找不到本次孕育任务'}, 404)
        if path.startswith('/api/tripo/models/') and path.endswith('.glb'):
            try:
                record = store.read(path.rsplit('/', 1)[1][:-4])
                if record['status'] != 'success':
                    return self.send_error(404)
                model = (store.folder / record['model_path']).resolve()
                if not model.is_relative_to(store.folder.resolve()):
                    return self.send_error(403)
                body = model.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'model/gltf-binary')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except (OSError, ValueError, KeyError):
                return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        if not self.local_request() or self.headers.get('X-Tripo-Token') != self.server.api_token:
            return self.json_response({'error': '请求来源无效，请刷新游戏'}, 403)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 12000:
                return self.json_response({'error': '请求大小无效'}, 400)
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('请求格式无效')
            path = urlsplit(self.path).path
            if path == '/api/tripo/jobs':
                return self.json_response(self.server.jobs.create(data), 202)
            if path.startswith('/api/tripo/jobs/') and path.endswith('/resume'):
                return self.json_response(self.server.jobs.resume(path.split('/')[-2]))
            return self.json_response({'error': '接口不存在'}, 404)
        except (ValueError, OSError) as exc:
            message = str(exc) if isinstance(exc, ValueError) else '本地任务记录不可用'
            return self.json_response({'error': message}, 400)

    def send_head(self):
        # Allow only game assets. Keys, jobs, code and listings never go on HTTP.
        if not self.local_request():
            self.send_error(403)
            return None
        path = unquote(urlsplit(self.path).path).replace('\\', '/')
        parts = path.strip('/').split('/')
        root_files = {'index.html','alien-walk-standalone.html','chamber.css','favicon.ico'}
        safe = not any(p.startswith('.') or ':' in p for p in parts if p)
        safe = safe and (path == '/' or (len(parts) == 1 and (parts[0] in root_files or parts[0].endswith('.mjs')))
            or (parts[0] in {'assets','models','vendor','fusion-v1'} and Path(path).suffix.lower() in
                {'.js','.mjs','.css','.glb','.png','.jpg','.jpeg','.webp','.mp3','.mp4','.wav','.wasm'}))
        resolved = Path(self.translate_path(path)).resolve()
        if not safe or not resolved.is_relative_to(ROOT):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def log_message(self, fmt, *args):
        sys.stderr.write('  %s\n' % (fmt % args))

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(Handler, directory=str(ROOT))
    with Server((HOST, port), handler) as httpd:
        httpd.api_token = secrets.token_urlsafe(32)
        httpd.jobs = JobStore(ROOT)
        httpd.jobs.recover()
        print('KEPLER-9c + Tripo -> http://%s:%d/' % (HOST, port), flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('Stopped')
