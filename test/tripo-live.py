"""Explicit live smoke test. Submit once with --submit, otherwise only query."""
import json
from pathlib import Path
import sys
import urllib.request

root = Path(__file__).resolve().parents[1]
fixture = json.loads((root / '.tripo/live-fixture.json').read_text(encoding='utf-8'))
base = 'http://127.0.0.1:8766'
if '--submit' in sys.argv:
    with urllib.request.urlopen(base + '/api/tripo/config') as response:
        config = json.load(response)
    request = urllib.request.Request(base + '/api/tripo/jobs', data=json.dumps(fixture).encode(),
        headers={'Content-Type':'application/json','X-Tripo-Token':config['token']})
else:
    request = base + '/api/tripo/jobs/' + fixture['id']
with urllib.request.urlopen(request) as response:
    print(json.dumps(json.load(response), ensure_ascii=False))
