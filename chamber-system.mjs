import {createChamberView,CHAMBER_POSITION,CHAMBER_POSITIONS} from './chamber-view.mjs';
import {createChamberPerformance} from './chamber-performance.mjs';
import {createCombineAudio} from './fusion-v1/combine-audio.js';
import {createWaterCharge,WATER_THRESHOLDS} from './chamber-water.mjs';
export {CHAMBER_POSITION,CHAMBER_POSITIONS};

// The host owns genetics and entities; the pod owns presentation and one task lifecycle.
function createPod({THREE,scene,camera,player,host,id,position,performanceView,select,cinematic,
  waterThresholds,emitWater}) {
  const view=createChamberView(THREE,scene,camera,{position,id});
  const embeddedAudio=document.getElementById('__combine_audio');
  const incubationAudio=createCombineAudio(embeddedAudio
    ?'data:audio/mp4;base64,'+embeddedAudio.textContent.trim():'./assets/combine-audio.mp4');
  let incubationAudible=false;
  const hud=document.getElementById('chamber-hud');
  const $=id=>document.getElementById(id);
  let phase='loading',task=0,sealing=0,child=null,prepared=null,preparedId=0,lastHud='';
  let lastParents=[null,null],time=0,notice='';
  const water=createWaterCharge({thresholds:waterThresholds,
    onChange:event=>{
      if(event.reason==='spray')host.setRadiation?.(event.value);
      emitWater('change',{...event,chamberId:id,taskId:task});
      if(event.reason==='spray'&&event.value>=1&&phase==='irradiating')confirmRadiation();
    },
    onThreshold:event=>emitWater('threshold',{...event,chamberId:id,taskId:task})});
  const distance=()=>Math.hypot(player.x-position.x,player.z-position.z);
  const performanceKey=()=>id+':'+task;
  function syncAudio() {
    const enabled=host.running()&&!document.hidden&&!cinematic();
    incubationAudio.setMuted(host.isMuted()||!enabled);
    incubationAudio.setVolume(.48*Math.max(0,1-distance()/18)*(host.effectsVolume?.()??1));
  }
  function note(text){notice=text;host.notice(text);}
  function cloneVisual(entity) {
    const source=entity.g,root=new THREE.Group(),owned=[];
    source.updateWorldMatrix(true,true);
    const inverse=new THREE.Matrix4().copy(source.matrixWorld).invert();
    source.traverse(node=>{
      if(!node.isMesh)return;
      const geo=node.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,node.matrixWorld));
      const mats=(Array.isArray(node.material)?node.material:[node.material]).map(m=>m.clone());
      const mesh=new THREE.Mesh(geo,Array.isArray(node.material)?mats:mats[0]);
      mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);owned.push(geo,...mats);
    });
    root.userData.dispose=()=>{root.removeFromParent();owned.forEach(r=>r.dispose());};
    root.userData.modelId=entity.species.key;
    return root;
  }
  function syncParents() {
    host.parents().forEach((entity,i)=>{
      if(lastParents[i]===entity)return;
      view.setParent(i,entity,entity?cloneVisual(entity):null);lastParents[i]=entity;
    });
  }
  function clearPrepared() {
    prepared?.userData.dispose?.();prepared=null;preparedId=0;
  }
  function mutationStatus() {
    return phase==='complete'&&child
      ?{rate:child.mutationRate??.05,locked:true}
      :host.mutation?.()??{rate:.05,locked:false};
  }
  function confirmRadiation() {
    if(phase!=='irradiating'||!host.active())return false;
    if(!host.confirmRadiation?.(water.status().value))return false;
    host.stopRadiation?.();
    phase='generating';notice='';return true;
  }
  function startJob() {
    if(phase!=='loading'||host.parents().some(p=>!p))return false;
    if(!host.start())return false;
    // Unlock/decode on the deposit or interact gesture, before the lid finishes closing.
    syncAudio();
    void incubationAudio.activate();
    task++;water.reset();phase='sealing';sealing=0;notice='';return true;
  }
  function fire() {
    if(!host.active()||host.waterEquipped?.()||distance()>11)return false;
    const slot=view.aim(player);
    if(slot!==0&&slot!==1)return false;
    if(phase!=='loading'){note('舱体已密封');return true;}
    if(host.parents()[slot]){note('这个槽位已有亲代');return true;}
    const entity=host.deposit(slot);
    if(!entity){note('弹夹为空');return true;}
    syncParents();view.shoot(slot,cloneVisual(entity));
    host.sound('deposit');
    if(host.parents().every(Boolean))startJob();
    return true;
  }
  function collect() {
    if(phase!=='complete'||!child)return false;
    if(!host.receive(child)){note('弹夹和背包已满，后代仍留在舱内');return false;}
    view.shoot(2,cloneVisual(child),true);view.setChild(null);
    child=null;phase='loading';clearPrepared();notice='';
    host.sound('collect');host.notice('后代已收好 · 亲代留在舱内');
    return true;
  }
  function suck() {
    if(!host.active()||host.waterEquipped?.()||distance()>11)return false;
    if(phase==='error') {host.abortGeneration();phase='loading';notice='';clearPrepared();water.reset();return true;}
    const slot=view.aim(player);
    if(slot===null)return false;
    if(phase==='complete') {collect();return true;}
    if(phase!=='loading'){note('结合期间无法取回亲代');return true;}
    if(slot!==0&&slot!==1)return true;
    const entity=host.parents()[slot];
    if(!entity)return true;
    if(!host.withdraw(slot)){note('弹夹和背包已满');return true;}
    view.shoot(slot,cloneVisual(entity),true);syncParents();host.sound('suck');
    return true;
  }
  function prepare() {
    if(preparedId===task&&performanceView.preparedTask===performanceKey())return true;
    clearPrepared();
    const model=host.preview();
    if(!model)return false;
    const owned=[];model.traverse(n=>{if(n.isMesh)owned.push(n.geometry,...(Array.isArray(n.material)?n.material:[n.material]));});
    model.userData.dispose=()=>{model.removeFromParent();owned.forEach(r=>r.dispose());};
    const parents=host.parents().map(cloneVisual);
    try {performanceView.prepare(performanceKey(),parents,model,'alien-genome');}
    catch(error){model.userData.dispose();throw error;}
    finally{parents.forEach(p=>p.userData.dispose());}
    prepared=model;preparedId=task;
    return true;
  }
  function interact() {
    if(!host.active()||distance()>10)return false;
    if(phase==='complete'){collect();return true;}
    if(phase==='irradiating')return confirmRadiation();
    if(phase==='error'){host.retryGeneration();phase='generating';notice='';return true;}
    if(phase==='loading') {
      if(!startJob())note('等待两只亲代');
      return true;
    }
    if(phase==='ready') {
      try {
        select(id);
        if(prepare()) {
          phase='playing';
          if(!performanceView.start()){phase='ready';host.setCinematic(false);}
        }
      } catch(error){note('演出准备失败：'+error.message);phase='ready';}
      return true;
    }
    return true;
  }
  function cancel() {
    if(phase!=='playing')return false;
    performanceView.stop();phase='ready';host.setCinematic(false);return true;
  }
  function tick(dt) {
    const running=host.running()&&!document.hidden;
    if(running)time+=dt;
    syncParents();
    if(running&&phase==='sealing') {
      sealing+=dt;
      if(sealing>=1.4)phase=host.job().state==='irradiating'?'irradiating':
        host.job().state==='ready'?'ready':'generating';
    }
    if(phase==='irradiating'&&water.status().value>=1)confirmRadiation();
    if(phase==='irradiating'&&host.job().state==='running')phase='generating';
    if(phase==='generating'&&host.job().state==='ready')phase='ready';
    const generation=host.generation?.();
    if(['sealing','generating'].includes(phase)&&generation?.status==='error')phase='error';
    if(phase==='playing') {
      performanceView.update(dt,running);
      if(performanceView.done) {
        const id=task;
        const baby=host.finish();
        if(id===task&&baby) {
          child=baby;view.setChild(cloneVisual(baby));phase='complete';
          water.reset();
          performanceView.stop();host.setCinematic(false);
          host.sound('finish');
        }
      }
    }
    const progress=host.progress();
    const incubation=view.update(running?dt:0,time,phase==='sealing'&&sealing<.5?'loading':phase,
      {progress:progress.percent,offline:progress.offline,water:water.status().value});
    const audible=running&&incubation.incubating&&!host.isMuted()&&!cinematic()&&distance()<18;
    syncAudio();
    if(audible&&!incubationAudible)void incubationAudio.activate();
    if(!audible)incubationAudio.stop();
    if(audible&&incubation.contacts)incubationAudio.impact(1);
    incubationAudible=audible;
  }
  function renderHud(force=false) {
    if(force)lastHud='';
    const generation=host.generation?.();
    const progress=host.progress(),equipped=!!host.waterEquipped?.();
    const mutation=mutationStatus(),canConfirm=phase==='irradiating'&&distance()<10&&player.y<6;
    const aimed=view.aim(player),parents=host.parents();
    const canEquip=['sealing','irradiating'].includes(phase)&&distance()<10&&player.y<6&&!equipped;
    const canStow=equipped&&host.canStowWater?.();
    const state=JSON.stringify([phase,parents.map(p=>p?.species.name),host.loadedName(),aimed,progress,
      notice,child?.species.name,generation?.error,equipped,canEquip,canStow,mutation]);
    if(state!==lastHud) {
      lastHud=state;hud.dataset.phase=phase;
      hud.dataset.chamber=String(id);
      $('chamber-name').textContent='GENESIS / '+String(id+1).padStart(2,'0');
      $('chamber-phase').textContent=({loading:'等待亲代',sealing:'舱门密封',irradiating:'爱心辐射',generating:'孕育中',error:'孕育暂时中断',ready:'可以结合',playing:'结合中',complete:'新生命诞生'})[phase];
      $('chamber-left').textContent=parents[0]?.species.name||'左槽 · 空';
      $('chamber-right').textContent=parents[1]?.species.name||'右槽 · 空';
      $('chamber-left').classList.toggle('aimed',aimed===0);
      $('chamber-right').classList.toggle('aimed',aimed===1);
      $('chamber-loaded').textContent=equipped?'爱心辐射枪':host.loadedName()||'弹夹为空';
      const modelStatus=progress.offline?'离线演示':({submitting:'提交中',queued:'排队中',running:'模型生成',
        downloading:'模型下载中',loading:'模型载入中',ready:'模型已就绪',error:'生成中断'})[progress.stage]||'模型生成';
      $('chamber-countdown').textContent=phase==='error'?generation?.error||'模型生成中断':
        phase==='irradiating'?'等待确认生成':
        ['sealing','generating','ready'].includes(phase)?modelStatus+' · '+Math.floor(progress.percent)+'%':
        phase==='complete'?child?.species.name||'':progress.offline?'离线演示':'';
      $('chamber-mutation').textContent='突变概率 · '+(mutation.rate*100).toFixed(1)+'%'+
        (mutation.locked?' · 已锁定':'');
      $('chamber-fire').disabled=equipped||phase!=='loading'||![0,1].includes(aimed)||!!parents[aimed]||!host.loadedName();
      $('chamber-suck').textContent=phase==='error'?'结束本次孕育':'吸回';
      $('chamber-suck').disabled=equipped||phase!=='error'&&phase!=='complete'&&(phase!=='loading'||![0,1].includes(aimed)||!parents[aimed]);
      $('chamber-interact').disabled=!canConfirm&&!canEquip&&!canStow&&!['ready','complete','error'].includes(phase)&&!(phase==='loading'&&parents.every(Boolean));
      $('chamber-interact').textContent=phase==='irradiating'?'确认生成':canStow?'收起爱心辐射枪 · E':canEquip?'领取爱心辐射枪 · E':phase==='error'?'继续查询 / 加载':
        phase==='complete'?'收下后代':phase==='loading'?'再次孕育':
        phase==='sealing'?'舱门密封中':phase==='generating'?'模型生成中':'开始结合';
    }
  }
  return {id,position,fire,suck,interact,cancel,tick,collect,syncAudio,renderHud,confirmRadiation,
    get canConfirm(){return phase==='irradiating'&&distance()<10&&player.y<6;},
    get cinematic(){return phase==='playing';},
    get presentationPaused(){return phase==='playing'&&performanceView.paused;},
    get near(){return distance()<10;},
    get aimed(){return distance()<11&&view.aim(player)!==null;},
    get aimDistance(){return view.hit(player)?.distance??Infinity;},
    get distance(){return distance();},
    get ready(){return phase==='ready';},
    get offersWater(){return ['sealing','irradiating'].includes(phase)&&distance()<10&&player.y<6;},
    get hudVisible(){return host.visible()&&distance()<=11&&phase!=='playing';},
    get child(){return child;},
    boost(repeat){if(phase==='playing')performanceView.boost(repeat);},
    constrain(body,radius){view.constrain(body,radius);},
    waterHit(origin,direction,range){return view.waterHit(origin,direction,range);},
    addWater(seconds) {
      if(!host.active()||!['sealing','irradiating'].includes(phase)||!view.status().incubating||
        host.job().state!=='irradiating')return false;
      return water.add(Math.min(.1,seconds));
    },
    status(){
      const generation=host.generation?.();
      return {id,number:id+1,position,phase,task,
      slots:host.parents().map(p=>p?.species.name||null),child:child?.species.name||null,
      progress:host.progress(),remaining:host.offline?.()?host.remaining():null,
      water:water.status(),mutation:mutationStatus(),view:view.status(),
      generation:generation?{status:generation.status,progress:generation.progress,error:generation.error,taskId:generation.task_id}:null,
      performance:performanceView.preparedTask===performanceKey()?performanceView.status():{
        active:false,state:'setup',presses:0,surgeRound:0,time:0,cinematicTime:0,
        cinematicPhase:null,resultSource:'none',resultScale:0,done:false,paused:false}};},
    dispose(){incubationAudio.dispose();view.dispose();clearPrepared();}
  };
}

// Three independent tasks share one HUD and one full-screen renderer.
export function createChamberSystem({THREE,scene,camera,player,host,waterThresholds=WATER_THRESHOLDS}) {
  const hosts=CHAMBER_POSITIONS.map((_,id)=>host(id));
  const waterListeners={change:new Set(),threshold:new Set()};
  function emitWater(kind,event) {
    const detail=Object.freeze(event);
    for(const listener of waterListeners[kind]) {
      try {listener(detail);} catch(error){console.warn('[chamber-water] Effect callback failed:',error);}
    }
  }
  const hud=document.getElementById('chamber-hud');
  let owner=0,shown=null,pods=[];
  const cinematic=()=>pods.some(pod=>pod.cinematic);
  const performanceView=createChamberPerformance({
    onReturn:()=>pods[owner]?.cancel(),
    onStart:()=>hosts[owner].setCinematic(true),
    onBirth:()=>hosts[owner].celebrate?.(),
    isMuted:hosts[0].isMuted,toggleSound:hosts[0].toggleSound,effectsVolume:hosts[0].effectsVolume,
  });
  pods=CHAMBER_POSITIONS.map((position,id)=>createPod({
    THREE,scene,camera,player,host:hosts[id],id,position,performanceView,cinematic,waterThresholds,emitWater,
    select(value){owner=value;},
  }));
  function focused(aimOnly=false) {
    if(cinematic())return aimOnly?null:pods[owner];
    let aimed=null,closestHit=Infinity;
    for(const pod of pods) {
      const distance=pod.aimDistance;
      if(distance<closestHit){aimed=pod;closestHit=distance;}
    }
    if(aimed||aimOnly)return aimed;
    let nearest=null,closest=11;
    for(const pod of pods) {
      const distance=pod.distance;
      if(distance<=closest){nearest=pod;closest=distance;}
    }
    return nearest;
  }
  function fire(){return focused(true)?.fire()??false;}
  function suck(){return focused(true)?.suck()??false;}
  function waterNearby() {
    if(cinematic())return null;
    return pods.filter(pod=>pod.offersWater).sort((a,b)=>a.distance-b.distance)[0]||null;
  }
  function radiationPod(){
    const aimed=focused(true);
    return aimed?.offersWater?aimed:waterNearby();
  }
  function interact(){
    if(!hosts[0].active())return false;
    const nearby=radiationPod();
    if(hosts[0].waterEquipped?.()&&!nearby){hosts[0].stowWater?.();return true;}
    if(!hosts[0].waterEquipped?.()&&nearby){hosts[0].equipWater?.();return true;}
    if(hosts[0].waterEquipped?.()&&nearby?.canConfirm)return nearby.confirmRadiation();
    return focused()?.interact()??false;
  }
  function traceWater(origin,direction,range=12) {
    let result=null;
    for(const pod of pods) {
      const hit=pod.waterHit(origin,direction,range);
      if(hit&&(!result||hit.distance<result.distance))result={...hit,chamberId:pod.id};
    }
    return result;
  }
  function syncAudio() {
    pods.forEach(pod=>pod.syncAudio());
    performanceView.syncAudio(hosts[owner].running()&&!document.hidden);
  }
  const bindings=[['chamber-fire',fire],['chamber-suck',()=>focused()?.suck()??false],
    ['chamber-interact',()=>{const pod=focused();return pod?.canConfirm?pod.confirmRadiation():interact();}]];
  bindings.forEach(([id,handler])=>document.getElementById(id).addEventListener('click',handler));
  return {fire,suck,interact,syncAudio,
    confirmRadiation(){const pod=radiationPod();return pod?.canConfirm?pod.confirmRadiation():false;},
    get canConfirmRadiation(){return radiationPod()?.canConfirm??false;},
    get cinematic(){return cinematic();},
    get presentationPaused(){return cinematic()&&performanceView.paused;},
    get near(){return !!hosts[0].waterEquipped?.()||!!waterNearby()||(focused()?.near??false);},
    get waterNearby(){return waterNearby()?.id??null;},
    get aimed(){return !!focused(true);},
    get child(){return (focused()||pods[0]).child;},
    get ready(){return pods.some(pod=>pod.ready);},
    traceWater,
    sprayWater(origin,direction,seconds,range=12) {
      const hit=traceWater(origin,direction,range);
      if(hit&&hosts[0].waterEquipped?.()&&!cinematic())pods[hit.chamberId].addWater(seconds);
      return hit;
    },
    onWaterChange(listener){waterListeners.change.add(listener);return ()=>waterListeners.change.delete(listener);},
    onWaterThreshold(listener){waterListeners.threshold.add(listener);return ()=>waterListeners.threshold.delete(listener);},
    collect(){return focused()?.collect()??false;},
    cancel(){return cinematic()?pods[owner].cancel():false;},
    boost(repeat){if(cinematic())pods[owner].boost(repeat);},
    render(renderer){return performanceView.render(renderer);},
    constrain(body,radius){pods.forEach(pod=>pod.constrain(body,radius));},
    tick(dt) {
      pods.forEach(pod=>pod.tick(dt));
      const pod=focused();
      hud.hidden=cinematic()||!pod?.hudVisible;
      if(!hud.hidden)pod.renderHud(shown!==pod.id);
      shown=hud.hidden?null:pod.id;
    },
    status(id) {
      const pod=id===undefined?(focused()||pods[0]):pods[id];
      return pod?{...pod.status(),count:pods.length,chambers:pods.map(item=>item.status())}:null;
    },
    dispose() {
      bindings.forEach(([id,handler])=>document.getElementById(id).removeEventListener('click',handler));
      performanceView.dispose();pods.forEach(pod=>pod.dispose());hud.hidden=true;
      waterListeners.change.clear();waterListeners.threshold.clear();
    },
  };
}
