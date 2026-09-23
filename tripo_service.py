"""Local, durable Tripo jobs. No automatic resubmission of chargeable POSTs."""
import json
import os
from pathlib import Path
import re
import struct
import threading
import time

from tripo_client import Client, TripoError, download_asset, load_key, output_url, save, task_id

MODEL_VERSION = 'P1-20260311'
FACE_LIMIT = 3000
GENE_OPTIONS = [1,6,13,8,4,2,13,4,2,13,4,2,13,6,2,13,3,2,13,4,2,13,4,2,13,2,2,13,2,2,13,2,4,5,5,5]


def validate_request(data):
    identifier = data.get('id', '')
    if not isinstance(identifier, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}', identifier):
        raise ValueError('无效的孕育编号')
    genome = data.get('genome')
    if not isinstance(genome, list) or len(genome) != len(GENE_OPTIONS) or any(
        type(v) is not int or not 0 <= v < n for v, n in zip(genome, GENE_OPTIONS)
    ):
        raise ValueError('后代基因必须是有效的 36 位数组')
    prompt = data.get('prompt')
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 1024:
        raise ValueError('模型描述长度必须为 1–1024 字符')
    return {'id': identifier, 'genome': genome, 'prompt': prompt}



def negative_prompt(genome):
    # Exclude absent genes through Tripo's negative prompt, not the positive description.
    absent = [(5, '眼睛'), (8, '耳朵'), (11, '角或冠'), (14, '翅膀'), (17, '尾巴'),
              (20, '背脊附件'), (23, '四肢'), (26, '爪子'), (29, '发光器官')]
    parts = ['场景', '底座', '文字', '水印', '多个角色', '多视角拼图', '骨骼绑定']
    parts.extend(name for index, name in absent if genome[index] == 1)
    if genome[32] == 0:
        parts.extend(['武器', '盾牌', '光环', '炸药包'])
    return '、'.join(parts)


def inspect_glb(path):
    """Count active scene instances and every primitive, including strips/fans."""
    raw = Path(path).read_bytes()
    if len(raw) < 20 or struct.unpack_from('<4sII', raw) != (b'glTF', 2, len(raw)):
        raise ValueError('模型不是完整的 GLB 2.0 文件')
    length, kind = struct.unpack_from('<II', raw, 12)
    if kind != 0x4E4F534A or 20 + length > len(raw):
        raise ValueError('模型缺少 GLB JSON')
    doc = json.loads(raw[20:20+length])
    for asset in doc.get('buffers', []) + doc.get('images', []):
        uri = asset.get('uri', '')
        if uri and not uri.startswith('data:'):
            raise ValueError('模型包含未内嵌资源，无法完整加载')
    if 'KHR_draco_mesh_compression' in doc.get('extensionsRequired', []):
        raise ValueError('该模型使用了当前加载器不支持的 Draco 压缩')
    meshes = doc.get('meshes', [])
    accessors = doc.get('accessors', [])
    mesh_counts = []
    for mesh in meshes:
        total = 0
        for primitive in mesh.get('primitives', []):
            mode = primitive.get('mode', 4)
            if mode not in (4, 5, 6):
                raise ValueError('模型包含非三角面图元')
            index = primitive.get('indices', primitive['attributes']['POSITION'])
            count = accessors[index]['count']
            if mode == 4 and count % 3:
                raise ValueError('模型三角面索引不完整')
            total += count // 3 if mode == 4 else max(0, count - 2)
        mesh_counts.append(total)
    nodes = doc.get('nodes', [])
    roots = doc.get('scenes', [])[doc.get('scene', 0)]['nodes']
    def count_node(index, ancestors):
        if index in ancestors:
            raise ValueError('模型节点循环引用')
        node = nodes[index]
        if node.get('skin') is not None or 'EXT_mesh_gpu_instancing' in node.get('extensions', {}):
            raise ValueError('后代模型必须是无骨骼的普通网格')
        return (mesh_counts[node['mesh']] if 'mesh' in node else 0) + sum(
            count_node(child, ancestors | {index}) for child in node.get('children', []))
    triangles = sum(count_node(index, set()) for index in roots)
    if triangles <= 0:
        raise ValueError('模型没有可显示的三角面')
    return triangles


class JobStore:
    def __init__(self, root, client_factory=None, poll_seconds=5):
        self.root = Path(root)
        self.folder = self.root / '.tripo'
        self.folder.mkdir(exist_ok=True)
        self.client_factory = client_factory or self.make_client
        self.poll_seconds = poll_seconds
        self.lock = threading.RLock()
        self.workers = set()

    def make_client(self):
        # Environment overrides the private local file. No key enters job JSON.
        explicit = None if os.environ.get('TRIPO_API_KEY') or os.environ.get('TRIPO_API_KEY_FILE') else str(self.root / '.secrets/tripo.key')
        return Client(load_key(explicit))

    def configured(self):
        try:
            self.client_factory()
            return True
        except (OSError, ValueError, TripoError):
            return False

    def record_path(self, identifier):
        task_id(identifier)
        return self.folder / (identifier + '.json')

    def read(self, identifier):
        return json.loads(self.record_path(identifier).read_text(encoding='utf-8'))

    def update(self, identifier, **fields):
        with self.lock:
            record = self.read(identifier)
            record.update(fields)
            save(self.record_path(identifier), record)
            return record

    def public(self, record):
        keys = ('id', 'task_id', 'status', 'progress', 'error', 'triangles')
        result = {key: record[key] for key in keys if key in record}
        if record.get('status') == 'success':
            result['model_url'] = '/api/tripo/models/' + record['id'] + '.glb'
        result['can_resume'] = bool(record.get('task_id')) and record.get('status') in ('interrupted', 'download_error')
        return result

    def create(self, data):
        request = validate_request(data)
        identifier = request['id']
        with self.lock:
            path = self.record_path(identifier)
            if path.exists():
                record = self.read(identifier)
                if any(record[key] != request[key] for key in ('genome', 'prompt')):
                    raise ValueError('孕育编号已使用，不能修改已确定的基因')
                return self.public(record)
            if self.workers:
                raise ValueError('另一个模型仍在生成，请稍后开始新的孕育')
            if not self.configured():
                raise ValueError('未配置 Tripo 密钥，请检查本地服务配置')
            record = {**request, 'status': 'submitting', 'progress': 0, 'task_id': None,
                      'model_version': MODEL_VERSION, 'face_limit': FACE_LIMIT, 'negative_prompt': negative_prompt(request['genome'])}
            # Exclusive creation prevents two local servers from submitting this ID.
            with path.open('x', encoding='utf-8') as file:
                json.dump(record, file, ensure_ascii=False)
            self.launch(identifier, submit=True)
            return self.public(record)

    def launch(self, identifier, submit=False):
        if identifier in self.workers:
            return
        self.workers.add(identifier)
        threading.Thread(target=self.run, args=(identifier, submit), daemon=True).start()

    def resume(self, identifier):
        with self.lock:
            record = self.read(identifier)
            if identifier not in self.workers and record.get('task_id') and record['status'] not in ('failed', 'success', 'invalid_model'):
                self.update(identifier, status='queued', error='')
                self.launch(identifier)
            return self.public(self.read(identifier))

    def recover(self):
        # After process interruption only GET the known task, never repeat POST.
        for path in self.folder.glob('*.json'):
            try:
                record = self.read(path.stem)
            except (OSError, ValueError):
                continue  # Keep damaged journals intact; never resubmit them.
            if not isinstance(record, dict) or record.get('id') != path.stem or 'status' not in record:
                continue  # This directory may also contain diagnostics or fixture metadata.
            if record['status'] in ('submitting', 'queued', 'running', 'downloading'):
                self.update(path.stem, status='interrupted' if record.get('task_id') else 'unconfirmed',
                            error='本地服务已重启；可继续查询原任务' if record.get('task_id') else '提交结果未确认，请在 Tripo 控制台核对，系统不会重复扣费提交')

    def run(self, identifier, submit):
        try:
            client = self.client_factory()
            record = self.read(identifier)
            if submit:
                try:
                    result = client.request('POST', '/task', {
                        'type': 'text_to_model', 'model_version': MODEL_VERSION,
                        'prompt': record['prompt'], 'face_limit': FACE_LIMIT,
                        'negative_prompt': record.get('negative_prompt', negative_prompt(record['genome'])),
                    })
                    remote = task_id(result['task_id'])
                    self.update(identifier, task_id=remote, status='queued')
                except Exception:
                    self.update(identifier, status='unconfirmed', error='Tripo 提交未确认，请检查密钥、余额和控制台任务；不会自动重复提交')
                    return
            remote = self.read(identifier)['task_id']
            deadline = time.monotonic() + 20 * 60
            failures = 0
            while time.monotonic() < deadline:
                try:
                    task = client.get_task(remote)
                    failures = 0
                except TripoError:
                    failures += 1
                    if failures >= 4:
                        self.update(identifier, status='interrupted', error='暂时无法查询进度；可继续查询原任务')
                        return
                    time.sleep(self.poll_seconds * failures)
                    continue
                status = task.get('status')
                if status in ('queued', 'running'):
                    self.update(identifier, status=status, progress=max(0, min(100, int(task.get('progress') or 0))))
                    time.sleep(self.poll_seconds)
                    continue
                if status != 'success':
                    self.update(identifier, status='failed', error='Tripo 任务未完成（' + str(status)[:24] + '）；本次基因已保留')
                    return
                self.update(identifier, status='downloading', progress=100)
                try:
                    output = task.get('output') or {}
                    url = next((output_url(output.get(key)) for key in ('pbr_model', 'model', 'base_model') if output_url(output.get(key))), None)
                    if not url:
                        raise TripoError('No model output')
                    folder = self.folder / identifier
                    folder.mkdir(exist_ok=True)
                    model = Path(download_asset(url, folder, 'model', '.bin'))
                except (TripoError, OSError):
                    self.update(identifier, status='download_error', error='模型下载中断；可重新下载原任务，无需重新生成')
                    return
                try:
                    triangles = inspect_glb(model)
                    if triangles > FACE_LIMIT:
                        raise ValueError('模型有 ' + str(triangles) + ' 个三角面，超过 3000 上限，需要本地减面')
                except (ValueError, KeyError, IndexError, TypeError) as exc:
                    self.update(identifier, status='invalid_model', error=str(exc)[:150])
                    return
                self.update(identifier, status='success', error='', triangles=triangles,
                            model_path=str(model.relative_to(self.folder)), consumed_credit=task.get('consumed_credit'))
                return
            self.update(identifier, status='interrupted', error='生成耗时较长；可继续查询原任务')
        except Exception:
            # Never echo arbitrary upstream data (which may contain credentials).
            self.update(identifier, status='interrupted', error='本地模型服务中断，请检查服务后继续查询原任务')
        finally:
            with self.lock:
                self.workers.discard(identifier)
