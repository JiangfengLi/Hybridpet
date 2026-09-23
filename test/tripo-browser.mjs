// Opt-in browser smoke test: replay the already paid live fixture, never a new task.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const packageDir=process.env.PLAYWRIGHT_DIR || 'C:/Users/lijia/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const {chromium}=await import(pathToFileURL(path.join(packageDir,'index.mjs')).href);
const fixture=JSON.parse(fs.readFileSync('.tripo/live-fixture.json','utf8'));
const source=fs.readFileSync('index.html','utf8');
const replay=source
  .replace('  const r = inheritGenome(ga, gb);','  const r = {genome:'+JSON.stringify(fixture.genome)+', mutations:[]};')
  .replace('  pr.prompt = genomeToPrompt(r.genome);','  pr.prompt = '+JSON.stringify(fixture.prompt)+';')
  .replace('id:crypto.randomUUID(), genome:pr.genome.slice()', 'id:'+JSON.stringify(fixture.id)+', genome:pr.genome.slice()')
  .replace('globalThis.__chamberStatus = () => chamberSystem.status();', `globalThis.__chamberStatus = () => chamberSystem.status();
globalThis.__tripoInspect = () => {
 const baby = animals.find(a=>a.modelTaskId);
 if (!baby) return null;
 const meshes=[];baby.g.traverse(n=>{if(n.isMesh)meshes.push({triangles:(n.geometry.index?.count??n.geometry.attributes.position.count)/3,
  textured:!!(Array.isArray(n.material)?n.material[0]:n.material).map});});
 return {taskId:baby.modelTaskId, genome:baby.genome, meshes, height:baby.cyl.h, captured:baby.captured,
  inInventory:mag.includes(baby)||pals.includes(baby)};
};`);
assert.notEqual(source,replay);
fs.mkdirSync('_shots',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
 args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try {
 const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/index.html?*',route=>route.fulfill({status:200,contentType:'text/html',body:replay}));
 await page.goto('http://127.0.0.1:8766/index.html?autostart=1&intro=0&pos=0,14&mag=2&breed=fast&yaw=-2.9612&pitch=0.1004');
 await page.waitForFunction(()=>window.__gameBooted===true,{timeout:60000});
 await page.waitForTimeout(600);
 await page.keyboard.press('KeyG');
 await page.evaluate(()=>{
  const cv=document.getElementById('app');
  cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));
  document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,movementX:-2820,movementY:0}));
  document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 });
 await page.waitForTimeout(200);
 await page.keyboard.press('KeyG');
 await page.waitForFunction(()=>['ready','error'].includes(__chamberStatus().phase),null,{timeout:60000});
 const ready=await page.evaluate(()=>__chamberStatus());
 assert.equal(ready.phase,'ready',JSON.stringify(ready.generation));
 assert.equal(ready.generation.status,'success');
 console.log('ok browser: API job resumed, real textured GLB loaded, birth unlocked');
 await page.keyboard.press('KeyE');
 await page.waitForFunction(()=>__chamberStatus().phase==='playing');
 for(let i=0;i<12;i++) {await page.keyboard.press('Space');await page.waitForTimeout(100);}
 await page.waitForFunction(()=>__chamberStatus().performance.cinematicPhase==='result',null,{timeout:150000});
 await page.screenshot({path:'_shots/tripo-birth.png'});
 await page.waitForFunction(()=>__chamberStatus().phase==='complete',null,{timeout:15000});
 await page.screenshot({path:'_shots/tripo-chamber.png'});
 const baby=await page.evaluate(()=>__tripoInspect());
 assert.deepEqual(baby.genome,fixture.genome);
 assert.ok(baby.meshes.some(mesh=>mesh.textured));
 assert.ok(baby.meshes.reduce((s,m)=>s+m.triangles,0)<=3000);
 await page.keyboard.press('KeyE');
 await page.waitForFunction(()=>__tripoInspect()?.inInventory===true);
 assert.deepEqual(errors,[]);
 fs.writeFileSync('.tripo/browser-check.json',JSON.stringify({baby,afterCollection:await page.evaluate(()=>__tripoInspect()),errors},null,2));
 console.log('ok browser: full film, generated offspring, preserved genes, textures, collection, no page errors');
 console.log(JSON.stringify(baby));
} finally {await browser.close();}
