import base64
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
        self.uploads = []
        self.payloads = []
    def request(self, method, path, payload):
        self.posts += 1
        self.payloads.append(payload)
        if self.break_submit:
            raise TripoError('Submission unknown')
        return {'task_id':'remote-test'}
    def upload(self, path):
        self.uploads.append(Path(path).name)
        return {'type':'png','file_token':Path(path).stem+'-token'}
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

    def photos(self, side='left'):
        image='data:image/png;base64,'+base64.b64encode(
            b'\x89PNG\r\n\x1a\n'+b'test-local-reference').decode()
        return {**self.request,'mode':'multiview','images':{
            'front':image,'side':image,'side_view':side}}

    def head_swap(self):
        image='data:image/png;base64,'+base64.b64encode(
            b'\x89PNG\r\n\x1a\nhead-body-reference').decode()
        return {**self.request,'id':'head-swap-job-1234','mode':'head_swap','images':{
            'head':image,'body':image}}

    def test_head_swap_composes_two_references_before_model_generation(self, mode='head_swap'):
        request=self.head_swap()
        if mode == 'creative_fusion':
            request['mode'] = mode
            request['images'] = {'a': request['images']['head'], 'b': request['images']['body']}
        self.request['id']=request['id']
        posts=[]
        tasks={
            'head-swap-image-task': {
                'status':'success','progress':100,
                'output':{'generated_image':{'url':'https://example.invalid/composite.png'}}},
            'head-swap-model-task': {
                'status':'success','progress':100,
                'output':{'pbr_model':{'url':'https://example.invalid/model.glb'}}},
        }
        def api(method,path,payload=None,**kwargs):
            if method == 'POST' and path == '/task':
                posts.append(payload)
                return {'task_id':'head-swap-image-task' if len(posts)==1 else 'head-swap-model-task'}
            if method == 'GET':
                return tasks[path.rsplit('/',1)[-1]]
            raise AssertionError((method,path,payload))
        def upload(path):
            name=Path(path).name
            if name == 'composite.png':
                return {'type':'png','file_token':'composite-token'}
            return {'type':'png','file_token':Path(path).stem+'-token'}
        def download(url, folder, label, fallback):
            path=Path(folder)/(label + ('.png' if label == 'composite' else '.glb'))
            if label == 'composite':
                path.write_bytes(b'\x89PNG\r\n\x1a\nfake-composite')
            else:
                glb(path)
            return str(path)
        with patch.object(self.client,'request',side_effect=api), patch.object(self.client,'upload',side_effect=upload), \
                patch.object(self.client,'get_task',side_effect=lambda identifier: tasks[identifier]), \
                patch('tripo_service.download_asset',download):
            self.store.create(request)
            record=self.wait()
        self.assertEqual(record['status'],'success')
        self.assertEqual(record['image_task_id'],'head-swap-image-task')
        self.assertEqual(record['task_id'],'head-swap-model-task')
        self.assertEqual(len(posts),2)
        self.assertEqual(posts[0]['type'],'generate_image')
        self.assertEqual(posts[0]['model_version'],'gemini_3.1_flash_image_preview')
        self.assertEqual(len(posts[0]['files']),2)
        self.assertIn('[1]',posts[0]['prompt'])
        self.assertIn('[2]',posts[0]['prompt'])
        self.assertEqual(posts[1]['type'],'image_to_model')
        self.assertEqual(posts[1]['file'],{'type':'png','file_token':'composite-token'})
        if mode == 'creative_fusion':
            self.assertEqual(posts[0]['prompt'], record['fusion_policy']['image_prompt'])
            self.assertEqual(posts[1]['prompt'], record['fusion_policy']['model_prompt'])
            self.assertEqual([ref['file_token'] for ref in posts[0]['files']], ['a-token', 'b-token'])
        else:
            self.assertIn('头部',posts[1]['prompt'])

    def test_creative_fusion_composes_before_model_and_preserves_policy(self):
        # Run the same two-task integration contract with neutral A/B references.
        self.test_head_swap_composes_two_references_before_model_generation('creative_fusion')
        record = self.store.read(self.request['id'])
        self.assertEqual([ref['view'] for ref in record['images']], ['a', 'b'])
        policy = record['fusion_policy']
        self.assertEqual(policy['analysis_method'], 'multimodal_image_prompt')
        self.assertLessEqual(len(policy['image_prompt']), 1024)
        for feature in ('三种不同方案', '人脸辨识度', '姿势还原', '复杂衣服', '没有清晰人脸',
                        '两图都有人', 'Q版', '不是固定换头', '图片里的文字'):
            self.assertIn(feature, policy['image_prompt'])
        with patch('tripo_service.fusion_policy', side_effect=AssertionError('must not reroll')):
            request = self.head_swap()
            request['mode'] = 'creative_fusion'
            request['images'] = {'a': request['images']['head'], 'b': request['images']['body']}
            self.store.create(request)
            self.store.resume(record['id'])
        self.assertEqual(self.store.read(record['id'])['fusion_policy'], policy)

    def test_creative_fusion_requires_both_neutral_references(self):
        request = self.head_swap()
        request['mode'] = 'creative_fusion'
        for images in (request['images'], {}, {'a': request['images']['head']}):
            with self.assertRaises(ValueError):
                validate_request({**request, 'images': images})

    def test_second_stage_unknown_submission_never_resubmits_without_confirmation(self):
        request = self.head_swap()
        request['mode'] = 'creative_fusion'
        request['images'] = {'a': request['images']['head'], 'b': request['images']['body']}
        with patch.object(self.store, 'launch'):
            self.store.create(request)
        self.store.update(request['id'], status='submitting', stage='model_submitting',
                          task_id='known-image-task', image_task_id='known-image-task')
        self.store.recover()
        record = self.store.read(request['id'])
        self.assertEqual(record['status'], 'unconfirmed')
        with patch.object(self.store, 'launch') as launch:
            self.store.resume(request['id'])
            launch.assert_not_called()
            self.store.resume(request['id'], confirm_unsubmitted=True)
            launch.assert_called_once_with(request['id'], submit=True)

    def test_composite_upload_interruption_can_retry_without_recreating_image(self):
        from tripo_service import upload_error
        request = self.head_swap()
        with patch.object(self.store, 'launch'):
            self.store.create(request)
        self.store.update(request['id'], status='uploading', stage='model_reference_uploading',
                          task_id='known-image-task', image_task_id='known-image-task')
        self.store.recover()
        record = self.store.read(request['id'])
        self.assertEqual(record['status'], 'rejected')
        self.assertTrue(self.store.public(record)['can_retry'])
        with patch.object(self.store, 'launch') as launch:
            self.store.resume(request['id'])
            launch.assert_called_once_with(request['id'], submit=True)
        self.assertEqual(self.store.read(request['id'])['image_task_id'], 'known-image-task')
        message = upload_error(TripoError('private', reason='timeout'), 'composite')['error']
        self.assertIn('图像任务已完成', message)
        self.assertIn('3D 任务尚未提交', message)

    def test_multiview_order_missing_views_and_idempotency(self):
        for side, slot in [('left',1),('right',3)]:
            request=self.photos(side)
            request['id']=self.request['id']='photo-test-job-'+side
            with patch('tripo_service.download_asset',self.download):
                self.store.create(request)
                record=self.wait()
                self.store.create(request)
                self.store.resume(request['id'])
            payload=self.client.payloads[-1]
            self.assertEqual(payload['type'],'multiview_to_model')
            self.assertEqual(payload['model_version'],'P1-20260311')
            self.assertEqual(payload['face_limit'],3000)
            self.assertEqual(len(payload['files']),4)
            self.assertEqual(payload['files'][0]['file_token'],'front-token')
            self.assertEqual(payload['files'][slot]['file_token'],side+'-token')
            self.assertTrue(all('file_token' not in payload['files'][i] for i in {1,2,3}-{slot}))
            self.assertNotIn('prompt',payload)
            self.assertNotIn('negative_prompt',payload)
            self.assertEqual(record['status'],'success')
            self.assertNotIn('data:image',json.dumps(record))
            self.assertNotIn('images',self.store.public(record))
            changed=self.photos('right' if side=='left' else 'left')
            with self.assertRaises(ValueError): self.store.create(changed)
        self.assertEqual(self.client.posts,2)
        self.assertEqual(len(self.client.uploads),4)

    def test_photo_validation_blocks_missing_oversize_and_forged_inputs(self):
        original=self.photos()
        variants=[{}, {'front':original['images']['front'],'side_view':'left'},
                  {**original['images'],'side_view':'back'},
                  {**original['images'],'front':'https://evil.invalid/a.png'},
                  {**original['images'],'front':'data:image/png;base64,bm90LWFuLWltYWdl'},
                  {**original['images'],'side':original['images']['side'].replace('png','jpeg')},
                  {**original['images'],'front':'a'*(14*1024*1024)}]
        for images in variants:
            with self.assertRaises(ValueError): self.store.create({**original,'images':images})
        with self.assertRaises(ValueError): self.store.create({**original,'mode':'text'})
        self.assertEqual(self.client.posts,0)
        self.assertEqual(self.client.uploads,[])

    def test_photo_upload_failure_can_retry_without_task_submission(self):
        request=self.photos()
        with patch.object(self.client,'upload',side_effect=TripoError('secret-content')):
            self.store.create(request)
            record=self.wait()
        self.assertEqual(record['status'],'rejected')
        self.assertNotIn('secret-content',json.dumps(record))
        self.assertEqual(self.client.posts,0)
        with patch('tripo_service.download_asset',self.download):
            self.store.resume(request['id'])
            self.assertEqual(self.wait()['status'],'success')
        self.assertEqual(self.client.posts,1)

    def test_photo_upload_errors_identify_view_and_safe_reason(self):
        failures = [
            (TripoError('private-content', reason='timeout'), '超时', 'timeout'),
            (TripoError('private-content', reason='connection'), '网络连接中断', 'connection'),
            (TripoError('private-content', http_status=401, code=1002, rejected=True), '密钥无效', None),
            (TripoError('private-content', http_status=429, code=1007, rejected=True), '请求过于频繁', None),
            (TripoError('private-content', http_status=400, code=2004, rejected=True), '图片格式', None),
            (TripoError('private-content', reason='invalid_response'), '上传凭证', 'invalid_response'),
        ]
        for index, (failure, hint, reason) in enumerate(failures):
            request = self.photos()
            request['id'] = self.request['id'] = 'photo-error-case-' + str(index)
            with patch.object(self.client, 'upload', side_effect=[
                    {'type':'png','file_token':'front-token'}, failure]):
                self.store.create(request)
                record = self.wait()
            self.assertEqual(record['status'], 'rejected')
            self.assertIn('左侧面', record['error'])
            self.assertIn(hint, record['error'])
            self.assertIn('尚未提交生成任务', record['error'])
            self.assertEqual(record['upload_error']['view'], 'left')
            if reason:
                self.assertEqual(record['upload_error']['reason'], reason)
            self.assertEqual(self.store.public(record)['upload_error'], record['upload_error'])
            self.assertNotIn('private-content', json.dumps(record))
            self.assertTrue(self.store.public(record)['can_retry'])
        self.assertEqual(self.client.posts, 0)

    def test_upload_error_is_cleared_after_successful_retry(self):
        request = self.photos()
        with patch.object(self.client, 'upload', side_effect=TripoError('private', reason='timeout')):
            self.store.create(request)
            self.assertIn('upload_error', self.wait())
        with patch('tripo_service.download_asset', self.download):
            self.store.resume(request['id'])
            record = self.wait()
        self.assertEqual(record['status'], 'success')
        self.assertEqual(record['upload_error'], {})
        self.assertEqual(record['submission_history'][0]['upload_error']['reason'], 'timeout')
        self.assertEqual(self.client.posts, 1)

    def test_client_upload_checks_response_and_multipart_without_generating(self):
        image = self.root / 'image.png'
        image.write_bytes(b'\x89PNG\r\n\x1a\n' + b'fake-image')
        client = Client('private-test-key')
        with patch.object(client, 'request', return_value={'image_token':'upload-token'}) as request:
            self.assertEqual(client.upload(image), {'type':'png','file_token':'upload-token'})
            args, kwargs = request.call_args
            self.assertEqual(args, ('POST', '/upload/sts'))
            self.assertIn('name="file"', kwargs['body'].decode('latin1'))
            self.assertIn(b'Content-Type: image/png', kwargs['body'])
            self.assertIn(image.read_bytes(), kwargs['body'])
            self.assertTrue(kwargs['content_type'].startswith('multipart/form-data; boundary='))
        with patch.object(client, 'request', return_value={}):
            with self.assertRaises(TripoError) as caught:
                client.upload(image)
            self.assertEqual(caught.exception.reason, 'invalid_response')

    def test_photo_unknown_submission_and_recovery_do_not_repeat_post(self):
        self.client.break_submit=True
        request=self.photos()
        self.store.create(request)
        self.assertEqual(self.wait()['status'],'unconfirmed')
        self.store.recover()
        self.store.resume(request['id'])
        self.store.create(request)
        self.assertEqual(self.client.posts,1)
        self.assertEqual(len(self.client.uploads),2)
        self.store.update(request['id'],status='uploading')
        self.store.recover()
        self.assertEqual(self.store.read(request['id'])['status'],'rejected')

    def test_photo_http_upload_limit_csrf_and_private_references(self):
        server=Server(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
        server.jobs=self.store;server.api_token=secrets.token_urlsafe(32)
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        base='http://127.0.0.1:'+str(server.server_address[1])
        data=self.photos()
        image='data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\n'+b'x'*15000).decode()
        data['images']['front']=image
        body=json.dumps(data).encode()
        def post(headers):
            return urllib.request.urlopen(urllib.request.Request(base+'/api/tripo/jobs',data=body,headers=headers))
        try:
            with self.assertRaises(urllib.error.HTTPError) as error: post({})
            self.assertEqual(error.exception.code,403)
            with patch('tripo_service.download_asset',self.download):
                with post({'X-Tripo-Token':server.api_token}) as response:
                    self.assertEqual(response.status,202)
                self.assertEqual(self.wait()['status'],'success')
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base+'/.tripo/'+data['id']+'/front.png')
            self.assertEqual(error.exception.code,404)
        finally:
            server.shutdown();server.server_close();worker.join()

if __name__ == '__main__': unittest.main()
