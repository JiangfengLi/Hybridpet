import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(args) {
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
for(const dir of ['.','test','fusion-v1']) {
  for(const file of fs.readdirSync(path.join(root,dir))) {
    if(/\.(mjs|js)$/.test(file))run(['--check',path.join(dir,file)]);
  }
}
// Harness temp paths are process-local; suites must run serially.
for(const file of ['test/check-driver-backticks.mjs','test/audio.mjs','test/mutation-rate.mjs','test/integration.mjs','test/cursor.mjs','test/input.mjs',
  'test/boot-params.mjs','test/chamber.mjs','test/chambers.mjs','test/water.mjs','test/bone-physics.mjs','test/heart-gun.mjs','test/tripo.mjs','test/scene-cost.mjs','test/animal-facing.mjs','test/animal-aim.mjs',
  'build-standalone.mjs','test/standalone.mjs']) {
  console.log('\n### '+file);
  run([file]);
}
console.log('\nAll Node checks and standalone build passed.');
