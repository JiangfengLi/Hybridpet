import {MeshoptDecoder} from './vendor/meshopt_decoder.module.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use one bounding box for every mesh: accessories keep their placement.
export function normalizeOffspring(THREE, source, box) {
  source.updateWorldMatrix(true, true);
  const root = new THREE.Group(), body = new THREE.Group(), bounds = new THREE.Box3();
  root.add(body);
  const meshes = [];
  source.traverse(node => {
    if (!node.isMesh) return;
    if (node.isSkinnedMesh || node.isInstancedMesh) throw new Error('后代模型包含不支持的骨骼或实例');
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    geometry.computeBoundingBox(); bounds.union(geometry.boundingBox);
    const materials = (Array.isArray(node.material) ? node.material : [node.material]).map(m => m.clone());
    const mesh = new THREE.Mesh(geometry, Array.isArray(node.material) ? materials : materials[0]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    body.add(mesh); meshes.push(mesh);
  });
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  if (!meshes.length || [size.x,size.y,size.z].some(v => !Number.isFinite(v) || v < 1e-6)) {
    disposeModel(root); throw new Error('模型尺寸无效，无法生成后代');
  }
  const triangles = meshes.reduce((sum,m) => sum + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
  if (triangles > 3000) { disposeModel(root); throw new Error('模型超过 3000 三角面上限'); }
  for (const mesh of meshes) {
    mesh.geometry.translate(-center.x, -bounds.min.y, -center.z);
    const fit=Math.min(box.x/size.x,box.y/size.y,box.z/size.z);
    mesh.geometry.scale(...(box.preserveAspect?[fit,fit,fit]:[box.x/size.x,box.y/size.y,box.z/size.z]));
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
  }
  root.userData = {kind:'land', gait:'squash', body, speed:1, triangles};
  return root;
}

export function disposeModel(root, textures=false) {
  const owned = new Set();
  root?.traverse(n => {
    if (!n.isMesh) return;
    owned.add(n.geometry);
    for (const mat of Array.isArray(n.material) ? n.material : [n.material]) {
      owned.add(mat);
      if (textures) for (const value of Object.values(mat)) if (value?.isTexture) owned.add(value);
    }
  });
  root?.removeFromParent(); owned.forEach(r => r.dispose());
}

export function cloneOffspring(THREE, source) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  source.traverse(n => {
    if (!n.isMesh) return;
    const mats = (Array.isArray(n.material) ? n.material : [n.material]).map(m => m.clone());
    const mesh = new THREE.Mesh(n.geometry.clone(), Array.isArray(n.material) ? mats : mats[0]);
    mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh);
  });
  root.userData = {...source.userData, body};
  return root;
}

export function createTripoClient({THREE, GLTFLoader, fetcher=(...args)=>fetch(...args),
  confirmUnsubmitted=message=>globalThis.confirm?.(message)===true,
  pause=sleep, required=['http:','https:'].includes(globalThis.location?.protocol)}={}) {
  async function request(path, body) {
    const options = {signal:AbortSignal.timeout(60000)};
    if (body) {
      const config = await request('/api/tripo/config');
      if (!config.configured) throw new Error('Tripo 未配置，请检查本地服务密钥');
      Object.assign(options, {method:'POST', headers:{'Content-Type':'application/json','X-Tripo-Token':config.token},body:JSON.stringify(body)});
    }
    const response = await fetcher(path, options);
    let data;
    try { data = await response.json(); } catch { throw new Error('请使用 start.bat 启动支持 Tripo 的本地服务'); }
    if (!response.ok) throw new Error(data.error || '模型服务暂时不可用');
    return data;
  }
  async function load(url, box) {
    if (!GLTFLoader) throw new Error('GLB 加载器不可用');
    const response = await fetcher(url, {signal:AbortSignal.timeout(60000)});
    if (!response.ok) throw new Error('模型文件下载失败，可重试加载原任务');
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(await response.arrayBuffer(), '');
    try { return normalizeOffspring(THREE, gltf.scene, box); }
    finally { disposeModel(gltf.scene); }
  }
  async function generate(job, box, onProgress=()=>{}, resume=false) {
    // Reposting a local ID is idempotent: the server never repeats a Tripo POST.
    let result = await request('/api/tripo/jobs', {id:job.id, genome:job.genome, prompt:job.prompt,
      ...(['multiview','head_swap','creative_fusion'].includes(job.mode)?{mode:job.mode,images:job.images}:{})});
    if (resume) {
      let confirmation = false;
      if (result.status === 'unconfirmed') {
        confirmation = await confirmUnsubmitted('上次提交结果未知。请先到 Tripo 控制台核对本次任务。\n\n只有确认没有创建任务时，才点击“确定”重新提交；否则点击“取消”，避免重复生成和扣费。\n\n是否已核对并确认没有创建任务？');
      }
      if (result.status === 'unconfirmed' ? confirmation : result.can_resume || result.can_retry) {
        result = await request('/api/tripo/jobs/'+job.id+'/resume', {confirm_unsubmitted:confirmation});
      }
    }
    const deadline = Date.now()+21*60*1000;
    let errors = 0;
    while (true) {
      onProgress({...result, submission_status:result.status});
      if (result.status === 'success') {
        const model = await load(result.model_url, box);
        return {model, taskId:result.task_id, modelUrl:result.model_url, triangles:result.triangles};
      }
      if (!['uploading','submitting','queued','running','downloading'].includes(result.status)) {
        throw new Error(result.error || '模型生成未完成，本次基因已保留');
      }
      if (Date.now() > deadline) throw new Error('生成耗时较长，可继续查询本次任务');
      await pause(3000);
      try { result = await request('/api/tripo/jobs/'+job.id); errors = 0; }
      catch(error) { if (++errors >= 4) throw error; }
    }
  }
  return {required, generate, load};
}
