// Browser acceptance uses synthetic photos and an intercepted API; never submits paid tasks.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';

const packages=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=await import(pathToFileURL(path.join(process.env.PLAYWRIGHT_DIR||path.join(packages,'playwright'),'index.mjs')));
const sharp=createRequire(path.join(packages,'package.json'))('sharp');
const base=process.env.PHOTO_TEST_URL||'http://127.0.0.1:8765';
const entry=process.env.PHOTO_TEST_PAGE||'index.html';
const shots=path.resolve('_shots');
fs.mkdirSync(shots,{recursive:true});

function modelFixture() {
  const geometry=new THREE.BoxGeometry(1,1.5,.8).toNonIndexed();
  const positions=Buffer.from(geometry.attributes.position.array.buffer);
  const normals=Buffer.from(geometry.attributes.normal.array.buffer);
  const bin=Buffer.concat([positions,normals]);
  const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},material:0}]}],
    materials:[{pbrMetallicRoughness:{baseColorFactor:[.3,.7,.65,1],metallicFactor:0,roughnessFactor:.7}}],
    buffers:[{byteLength:bin.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.length},{buffer:0,byteOffset:positions.length,byteLength:normals.length}],
    accessors:[{bufferView:0,componentType:5126,count:36,type:'VEC3',min:[-.5,-.75,-.4],max:[.5,.75,.4]},
      {bufferView:1,componentType:5126,count:36,type:'VEC3'}]};
  const json=Buffer.from(JSON.stringify(doc)),padded=Buffer.concat([json,Buffer.alloc((-json.length>>>0)%4,32)]);
  const header=Buffer.alloc(20),binHeader=Buffer.alloc(8);
  header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+bin.length,8);
  header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);
  binHeader.writeUInt32LE(bin.length);binHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,padded,binHeader,bin]);
}
const model=modelFixture();
const photo=async(color)=>sharp({create:{width:320,height:320,channels:3,background:color}}).png().toBuffer();
const front=await photo('#679a91'),side=await photo('#d894a5');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try {
  for(const viewport of [{width:1280,height:800},{width:390,height:844}]) {
    const page=await browser.newPage({viewport}),errors=[],requests=[];
    let polls=0,resumes=0,fail=viewport.width<500;
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/tripo/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      const reply=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
      if(url.pathname.endsWith('/config'))return reply({configured:true,token:'test-only-token'});
      if(url.pathname.includes('/models/'))return route.fulfill({status:200,contentType:'model/gltf-binary',body:model});
      if(url.pathname.endsWith('/resume')) {
        resumes++;fail=false;polls=0;
        return reply({status:'queued',stage:'compositing',progress:0,
          image_task_id:'photo-image-fixture',task_id:'photo-image-fixture'});
      }
      if(request.method()==='POST') {
        requests.push(request.postDataJSON());
        return reply(fail?{status:'rejected',can_retry:true,error:'测试上传中断'}:{
          status:'queued',stage:'compositing',progress:0,
          image_task_id:'photo-image-fixture',task_id:'photo-image-fixture'});
      }
      polls++;
      if(polls===1)return reply({status:'running',stage:'compositing',progress:25,
        image_task_id:'photo-image-fixture',task_id:'photo-image-fixture'});
      if(polls===2)return reply({status:'queued',stage:'model',progress:50,
        model_task_id:'photo-model-fixture',task_id:'photo-model-fixture'});
      if(polls===3)return reply({status:'running',stage:'model',progress:75,
        model_task_id:'photo-model-fixture',task_id:'photo-model-fixture'});
      return reply({status:'success',stage:'complete',progress:100,task_id:'photo-model-fixture',
        model_task_id:'photo-model-fixture',model_url:'/api/tripo/models/fixture.glb',triangles:12});
    });
    await page.goto(base+'/'+entry+'?autostart=1&intro=0&pos=0,14&yaw=3.14159&pitch=0.1');
    await page.waitForFunction(()=>window.__gameBooted===true,null,{timeout:60000});
    await page.locator('#chamber-photos').waitFor({state:'visible'});
    const canvas=page.locator('#app');
    const pixels=await sharp(await canvas.screenshot()).resize(80,60).removeAlpha().raw().toBuffer();
    assert.ok(new Set(pixels).size>40,'3D canvas is nonblank');
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(180);
    await page.keyboard.up('KeyA');
    const moved=await sharp(await canvas.screenshot()).resize(80,60).removeAlpha().raw().toBuffer();
    assert.ok(!pixels.equals(moved),'3D scene responds to player movement');
    await page.keyboard.press('KeyE');
    await page.locator('#photo-dialog').waitFor({state:'visible'});
    assert.match(await page.locator('#photo-title').textContent(),/创意融合/);
    assert.match(await page.locator('.photo-fields').textContent(),/人物参考/);
    assert.match(await page.locator('.photo-fields').textContent(),/姿势与造型/);
    assert.equal(await page.locator('#photo-submit').isDisabled(),true);
    await page.locator('#photo-front').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
    await page.locator('#photo-error').filter({hasText:'无法读取'}).waitFor();
    assert.equal(requests.length,0);
    await page.locator('#photo-front').setInputFiles({name:'front.png',mimeType:'image/png',buffer:front});
    await page.locator('#photo-front-preview').waitFor({state:'visible'});
    assert.equal(await page.locator('#photo-submit').isDisabled(),true);
    await page.locator('#photo-side').setInputFiles({name:'side.png',mimeType:'image/png',buffer:side});
    await page.locator('#photo-side-preview').waitFor({state:'visible'});
    assert.equal(await page.locator('#photo-submit').isEnabled(),true);
    const layout=await page.locator('.photo-window').evaluate(node=>{
      const rect=node.getBoundingClientRect();
      return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,overflow:node.scrollWidth>node.clientWidth};
    });
    await page.screenshot({path:path.join(shots,`photos-${viewport.width}-selected.png`)});
    assert.ok(layout.left>=0&&layout.right<=viewport.width&&layout.top>=0&&layout.bottom<=viewport.height&&!layout.overflow,JSON.stringify(layout));
    await page.keyboard.press('KeyW');
    assert.equal(await page.locator('#photo-dialog').isVisible(),true);
    await page.locator('#photo-submit').click();
    if(viewport.width<500) {
      await page.waitForFunction(()=>__chamberStatus(0).phase==='error');
      await page.locator('#chamber-interact').click();
    }
    await page.waitForFunction(()=>__chamberStatus(0).phase==='complete',null,{timeout:45000});
    assert.equal(requests[0].mode,'creative_fusion');
    assert.equal(requests[0].images.a,'data:image/png;base64,'+front.toString('base64'));
    assert.equal(requests[0].images.b,'data:image/png;base64,'+side.toString('base64'));
    assert.equal(requests.length,viewport.width<500?2:1);
    if(requests.length===2)assert.deepEqual(requests[1],requests[0]);
    assert.equal(resumes,viewport.width<500?1:0);
    await page.screenshot({path:path.join(shots,`photos-${viewport.width}-complete.png`)});
    await page.locator('#chamber-interact').click();
    await page.waitForFunction(()=>__chamberStatus(0).phase==='loading');
    await page.locator('#chamber-photos').click();
    await page.locator('#photo-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#photo-front-preview').isHidden(),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#photo-dialog').isHidden(),true);
    assert.equal(await page.locator('#chamber-photos').isVisible(),true);
    assert.deepEqual(errors,[]);
    console.log(`ok browser ${entry} ${viewport.width}: creative fusion, A/B references, ${resumes?'retry, ':''}model birth, collect, modal reset, bounded layout, moving canvas pixels, no errors`);
    await page.close();
  }
} finally {await browser.close();}
