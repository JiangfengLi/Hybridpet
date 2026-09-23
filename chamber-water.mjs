export const WATER_CHARGE_RATE = .06;
export const WATER_THRESHOLDS = Object.freeze([.25,.5,.75,1]);

export function createWaterCharge({rate=WATER_CHARGE_RATE,thresholds=WATER_THRESHOLDS,
  onChange=()=>{},onThreshold=()=>{}}={}) {
  const stops=[...new Set(thresholds)].filter(v=>Number.isFinite(v)&&v>0&&v<=1).sort((a,b)=>a-b);
  let value=0;
  const status=()=>Object.freeze({value,percent:Math.floor(value*100),thresholds:[...stops]});
  function set(next,reason) {
    const previous=value;
    value=Math.max(0,Math.min(1,next));
    if(value===previous)return false;
    const event=Object.freeze({previous,value,percent:Math.floor(value*100),reason});
    onChange(event);
    for(const threshold of stops)if(previous<threshold&&value>=threshold)
      onThreshold(Object.freeze({...event,threshold}));
    return true;
  }
  return {
    add(seconds){return Number.isFinite(seconds)&&seconds>0&&Number.isFinite(rate)&&rate>0
      ?set(value+seconds*rate,'spray'):false;},
    reset(){return set(0,'reset');},
    status,
  };
}
