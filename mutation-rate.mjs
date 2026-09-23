export const BASE_MUTATION_RATE=.05;
export const MAX_MUTATION_RATE=.25;

export function normalizedRadiation(value) {
  return Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
}

export function mutationRateForRadiation(value) {
  return BASE_MUTATION_RATE+(MAX_MUTATION_RATE-BASE_MUTATION_RATE)*normalizedRadiation(value);
}

// Each locus rolls once per breeding attempt; additional hits only raise its threshold.
export function createInheritancePlan(definitions,parentA,parentB,random=Math.random) {
  return Object.freeze(definitions.map((definition,i)=>{
    const inherited=random()<.5?parentA[i]:parentB[i];
    const roll=random(),count=definition.opts.length;
    let alternative=inherited;
    if(count>1) {
      alternative=Math.floor(random()*(count-1));
      if(alternative>=inherited)alternative++;
    }
    return Object.freeze({inherited,alternative,roll});
  }));
}

export function resolveInheritancePlan(definitions,plan,radiation=0) {
  const progress=normalizedRadiation(radiation);
  const mutationRate=mutationRateForRadiation(progress),mutations=[];
  const genome=plan.map((locus,i)=>{
    const mutated=definitions[i].opts.length>1&&locus.roll<mutationRate;
    if(mutated)mutations.push(definitions[i]);
    return mutated?locus.alternative:locus.inherited;
  });
  return {genome,mutations,mutationRate,radiation:progress};
}
