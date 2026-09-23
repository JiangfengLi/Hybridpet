import functools
import json
from pathlib import Path
import secrets
import struct
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tripo_service import JobStore, inspect_glb, validate_request, GENE_OPTIONS, negative_prompt
from tripo_client import TripoError
from serve import Handler, Server, ROOT


def glb(path, count=3, mode=4, instances=1, external=False):
    doc = {'asset':{'version':'2.0'},'accessors':[{'count':count}],
        'meshes':[{'primitives':[{'attributes':{'POSITION':0},'mode':mode}]}],
        'nodes':[{'mesh':0} for _ in range(instances)],'scenes':[{'nodes':list(range(instances))}]}
    if external:
        doc['images'] = [{'uri':'https://example.invalid/image.png'}]
    data = json.dumps(doc).encode()
    data += b' ' * (-len(data) % 4)
    Path(path).write_bytes(struct.pack('<4sIIII', b'glTF',2,20+len(data),len(data),0x4E4F534A)+data)


class FakeClient:
    def __init__(self):
        self.posts = 0
        self.polls = 0
        self.break_submit = False
        self.break_poll = False
    def request(self, method, path, payload):
        self.posts += 1
        if self.break_submit:
            raise TripoError('Submission unknown')
        return {'task_id':'remote-test'}
    def get_task(self, identifier):
        self.polls += 1
        if self.break_poll:
            raise TripoError('Network error')
        return {'status':'success','progress':100,'output':{'pbr_model':{'url':'https://example.invalid/model.glb'}}}


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.client = FakeClient()
        self.store = JobStore(self.root, lambda:self.client, .001)
        self.request = {'id':'local-test-job-1234','genome':[0]*36,'prompt':'单只球形胶质宠物'}
    def tearDown(self):
        self.temp.cleanup()
    def wait(self):
        end = time.monotonic()+3
        while self.store.workers and time.monotonic()<end:
            time.sleep(.01)
        self.assertFalse(self.store.workers)
        return self.store.read(self.request['id'])
    def download(self, url, folder, label, fallback):
        path = Path(folder)/'model.glb'
        glb(path)
        return str(path)
    def test_validate_genome(self):
        self.assertEqual(len(GENE_OPTIONS),36)
        for value in ([0]*35, [True]*36, [99]*36):
            with self.assertRaises(ValueError): validate_request({**self.request,'genome':value})
        with self.assertRaises(ValueError): validate_request({**self.request,'id':'../secrets'})
    def test_negative_prompt_excludes_only_absent_genes(self):
        genome=[0]*36
        self.assertNotIn('眼睛', negative_prompt(genome))
        genome[5]=1
        self.assertIn('眼睛', negative_prompt(genome))
        self.assertLessEqual(len(negative_prompt(genome)),255)
    def test_count_all_instances_and_modes(self):
        for mode, count, expected in [(4,9,9),(5,5,9),(6,6,12)]:
            path=self.root/'test.glb'; glb(path,count,mode,3)
            self.assertEqual(inspect_glb(path),expected)
        glb(path, external=True)
        with self.assertRaises(ValueError): inspect_glb(path)
    def test_idempotent_submit_and_download(self):
        with patch('tripo_service.download_asset', self.download):
            self.store.create(self.request)
            self.store.create(self.request)
            record=self.wait()
            self.store.create(self.request)
            self.store.resume(self.request['id'])
        self.assertEqual(self.client.posts,1)
        self.assertEqual(record['status'],'success')
        self.assertEqual(record['triangles'],1)
        self.assertNotIn('prompt',self.store.public(record))
        with self.assertRaises(ValueError): self.store.create({**self.request,'prompt':'Changed'})
    def test_unknown_post_never_resubmitted(self):
        self.client.break_submit=True
        self.store.create(self.request)
        self.assertEqual(self.wait()['status'],'unconfirmed')
        self.store.create(self.request); self.store.resume(self.request['id'])
        self.assertEqual(self.client.posts,1)
    def test_retry_query_and_download_same_remote_task(self):
        self.client.break_poll=True
        self.store.create(self.request)
        self.assertEqual(self.wait()['status'],'interrupted')
        self.client.break_poll=False
        with patch('tripo_service.download_asset', side_effect=TripoError('expired')):
            self.store.resume(self.request['id'])
            self.assertEqual(self.wait()['status'],'download_error')
        with patch('tripo_service.download_asset', self.download):
            self.store.resume(self.request['id'])
            self.assertEqual(self.wait()['status'],'success')
        self.assertEqual(self.client.posts,1)
    def test_restart_does_not_resubmit(self):
        path=self.store.record_path(self.request['id'])
        path.write_text(json.dumps({**self.request,'status':'submitting','task_id':None}))
        self.store.recover()
        self.assertEqual(self.store.read(self.request['id'])['status'],'unconfirmed')
        self.store.create(self.request)
        self.assertEqual(self.client.posts,0)
    def test_restart_ignores_diagnostics_and_damaged_records(self):
        (self.store.folder/'live-fixture.json').write_text(json.dumps(self.request))
        (self.store.folder/'damaged-record.json').write_text('{')
        self.store.recover()
        self.assertEqual(self.client.posts,0)
    def test_static_and_api_secret_isolation(self):
        server=Server(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
        server.jobs=self.store; server.api_token=secrets.token_urlsafe(32)
        worker=threading.Thread(target=server.serve_forever,daemon=True); worker.start()
        base='http://127.0.0.1:'+str(server.server_address[1])
        try:
            for path in ['/.secrets/tripo.key','/%2esecrets/tripo.key','/.tripo/live-fixture.json','/tripo_client.py','/serve.py','/vendor/','/assets/../.secrets/tripo.key']:
                with self.assertRaises(urllib.error.HTTPError) as err: urllib.request.urlopen(base+path)
                self.assertEqual(err.exception.code,404,path)
            with urllib.request.urlopen(base+'/api/tripo/config') as response:
                self.assertTrue(json.load(response)['configured'])
            for headers in ({},{'X-Tripo-Token':server.api_token,'Origin':'https://evil.invalid'}):
                with self.assertRaises(urllib.error.HTTPError) as err:
                    urllib.request.urlopen(urllib.request.Request(base+'/api/tripo/jobs',data=b'{}',headers=headers))
                self.assertEqual(err.exception.code,403)
            self.assertEqual(self.client.posts,0)
        finally:
            server.shutdown(); server.server_close(); worker.join()

if __name__ == '__main__': unittest.main()
