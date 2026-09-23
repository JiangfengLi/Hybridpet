import io
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
from tripo_client import Client, TripoError
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
    def test_rejected_submit_can_retry_same_genome_only_on_resume(self):
        error = TripoError('upstream may echo a secret', http_status=429, code=2000,
                           trace_id='12345678-1234-1234-1234-123456789abc', rejected=True)
        with patch.object(self.client, 'request', side_effect=error) as request:
            self.store.create(self.request)
            record = self.wait()
            self.assertEqual(record['status'], 'rejected')
            self.assertIn('并发已满', record['error'])
            self.assertEqual(record['submission_error']['code'], 2000)
            self.assertNotIn('secret', json.dumps(record))
            self.assertTrue(self.store.public(record)['can_retry'])
            self.store.create(self.request)
            self.assertEqual(request.call_count, 1)
        with patch('tripo_service.download_asset', self.download):
            self.store.resume(self.request['id'])
            record = self.wait()
        self.assertEqual(record['status'], 'success')
        self.assertEqual(record['genome'], self.request['genome'])
        self.assertEqual(record['prompt'], self.request['prompt'])
        self.assertEqual(record['submission_history'][0]['status'], 'rejected')

    def test_unknown_requires_explicit_confirmation_and_deduplicates_retry(self):
        self.client.break_submit = True
        self.store.create(self.request)
        self.wait()
        self.store.resume(self.request['id'], confirm_unsubmitted='true')
        self.assertEqual(self.client.posts, 1)
        self.client.break_submit = False
        release = threading.Event()
        entered = threading.Event()
        original = self.client.request
        def blocked(*args):
            entered.set()
            release.wait(2)
            return original(*args)
        with patch.object(self.client, 'request', side_effect=blocked), patch('tripo_service.download_asset', self.download):
            self.store.resume(self.request['id'], confirm_unsubmitted=True)
            self.assertTrue(entered.wait(1))
            self.store.resume(self.request['id'], confirm_unsubmitted=True)
            release.set()
            record = self.wait()
        self.assertEqual(self.client.posts, 2)
        self.assertEqual(record['status'], 'success')
        self.assertEqual(record['submission_history'][0]['status'], 'unconfirmed')

    def test_resume_blocks_new_submission_while_another_job_is_active(self):
        self.client.break_submit = True
        self.store.create(self.request)
        self.wait()
        self.store.workers.add('another-job')
        try:
            with self.assertRaises(ValueError):
                self.store.resume(self.request['id'], confirm_unsubmitted=True)
            self.assertEqual(self.client.posts, 1)
        finally:
            self.store.workers.clear()

    def test_client_classifies_errors_without_leaking_response(self):
        client = Client('test-secret-key')
        trace = '12345678-1234-1234-1234-123456789abc'
        for status, code, rejected in [(401,1002,True),(403,2010,True),(429,2000,True),
                                        (400,1004,True),(500,1000,False),(502,2010,False),(400,9999,False)]:
            raw = json.dumps({'code':code, 'message':'test-secret-key'}).encode()
            error = urllib.error.HTTPError('https://api.tripo3d.ai',status,'Error',
                {'X-Tripo-Trace-ID':trace},io.BytesIO(raw))
            with patch.object(client.opener, 'open', side_effect=error):
                with self.assertRaises(TripoError) as caught:
                    client.request('POST','/task',{})
            self.assertEqual(caught.exception.rejected, rejected)
            self.assertEqual(caught.exception.trace_id, trace)
            self.assertNotIn('test-secret-key', str(caught.exception))
        for failure in (TimeoutError(), urllib.error.URLError('test-secret-key')):
            with patch.object(client.opener,'open',side_effect=failure):
                with self.assertRaises(TripoError) as caught:
                    client.request('POST','/task',{})
            self.assertFalse(caught.exception.rejected)
            self.assertNotIn('test-secret-key',str(caught.exception))

    def test_client_invalid_and_business_responses(self):
        client = Client('test-secret-key')
        for raw, rejected, reason in [
            (b'{', False, 'invalid_response'),
            (b'{"code":0}', False, 'invalid_response'),
            (b'{"code":2010}', True, 'unknown'),
            (b'{"code":["test-secret-key"]}', False, 'unknown'),
        ]:
            response = io.BytesIO(raw)
            response.headers = {}
            with patch.object(client.opener, 'open', return_value=response):
                with self.assertRaises(TripoError) as caught:
                    client.request('POST','/task',{})
            self.assertEqual(caught.exception.rejected, rejected)
            self.assertEqual(caught.exception.reason, reason)
            self.assertNotIn('test-secret-key', str(caught.exception))

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
            self.client.break_submit = True
            self.store.create(self.request)
            self.wait()
            def resume_http(confirmed):
                request = urllib.request.Request(base+'/api/tripo/jobs/'+self.request['id']+'/resume',
                    data=json.dumps({'confirm_unsubmitted':confirmed}).encode(),
                    headers={'X-Tripo-Token':server.api_token,'Content-Type':'application/json'})
                with urllib.request.urlopen(request) as response:
                    return json.load(response)
            self.assertEqual(resume_http('true')['status'],'unconfirmed')
            self.assertEqual(self.client.posts,1)
            self.client.break_submit = False
            with patch('tripo_service.download_asset',self.download):
                resume_http(True)
                self.assertEqual(self.wait()['status'],'success')
            self.assertEqual(self.client.posts,2)
        finally:
            server.shutdown(); server.server_close(); worker.join()

if __name__ == '__main__': unittest.main()
