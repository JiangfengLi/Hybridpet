import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'alien-walk-standalone.html'),'utf8');
const grab=id=>{
  const found=html.match(new RegExp('<script id="'+id+'" type="text/plain">([\\s\\S]*?)</script>'));
  assert.ok(found,'missing '+id);
  return found[1];
};
const entries=JSON.parse(grab('__chamber_modules'));
const available=new Set(['vendor/three.module.min.js']);
assert.equal(entries.length,21);
for(const {name,source,dependencies} of entries) {
  assert.equal(source,fs.readFileSync(path.join(root,name),'utf8'),name+' embedded source');
  for(const [specifier,target] of Object.entries(dependencies)) {
    assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(name),specifier)),target);
    assert.ok(available.has(target),name+' dependency '+target);
  }
  available.add(name);
}
assert.ok(available.has('chamber-system.mjs'));
assert.ok(!html.includes("await import('./chamber-system.mjs')"));
assert.ok(!html.includes("await import('./water-gun.mjs')"));
assert.ok(available.has('mutation-rate.mjs'));
assert.ok(!html.includes("await import('./mutation-rate.mjs')"));
assert.ok(available.has('vendor/cannon-es.mjs')&&available.has('bone-physics.mjs'));
assert.ok(!html.includes("await import('./bone-physics.mjs')"));
assert.ok(!html.includes('href="./chamber.css"'));
assert.equal(html.match(/<style id="__chamber_css">([\s\S]*?)<\/style>/)[1],
  fs.readFileSync(path.join(root,'chamber.css'),'utf8'));
assert.deepEqual(Buffer.from(grab('__combine_audio'),'base64'),
  fs.readFileSync(path.join(root,'assets/combine-audio.mp4')));
for (const [id, file] of [
  ['__background_audio', 'Audio_BackGround.mp3'],
  ['__laser_audio', 'Audio_Laser.wav'],
  ['__birth_audio', 'birth-mama.wav'],
  ['__grass_audio', 'grasswalk.mp3'],
  ['__flight_audio', 'jetpack-flight.wav'],
]) {
  assert.deepEqual(Buffer.from(grab(id), 'base64'),
    fs.readFileSync(path.join(root, 'assets', file)), file + ' embedded audio');
}
assert.ok(!/id="(?:bagTab1|bagPage1|palMenu)"/.test(html));
assert.ok(html.includes('const BREED_PAIRS = CHAMBER_POSITIONS.length;'));
const {CHAMBER_POSITIONS}=await import('../chamber-view.mjs');
assert.equal(CHAMBER_POSITIONS.length,3);
assert.equal(new Set(CHAMBER_POSITIONS.map(({x,z})=>x+','+z)).size,3);
console.log('ok   standalone: 21 modules, inline physics/audio, independent radiation genetics, no old UI');
