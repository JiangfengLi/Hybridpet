// Produce one real inheritance result for the opt-in live smoke test; no API call.
import {runGame} from './harness.mjs';
await runGame(`
const result = inheritGenome(initialGenomeFor({key:'slime-ring',body:'A'}), initialGenomeFor({key:'slime-ball',body:'A'}));
const fs = await import('node:fs');
fs.mkdirSync('.tripo',{recursive:true});
fs.writeFileSync('.tripo/live-fixture.json', JSON.stringify({id:crypto.randomUUID(), genome:result.genome,
  prompt:genomeToPrompt(result.genome), mutations:result.mutations.map(d=>d.key)},null,2));
console.log('Live fixture saved (one offspring, actual game inheritance).');
`);
