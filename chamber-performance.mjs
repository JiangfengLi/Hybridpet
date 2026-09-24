import * as THREE from './vendor/three.module.min.js';
import {createCombineSession,ROTATION_SPEED} from './fusion-v1/combine-session.mjs';
import {createRecombinationFilm} from './fusion-v1/recombination-film.js';
import {createGameActor,createFilmResult} from './fusion-v1/game-actor.mjs';
import {createCombineAudio} from './fusion-v1/combine-audio.js';

export function createChamberPerformance({onReturn,onStart,onBirth=()=>{},isMuted=()=>false,
  toggleSound=()=>{},effectsVolume=()=>1,musicVolume=()=>1}) {
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-6,6,4,-4,.1,100);
  const pair=new THREE.Group();pair.name='CombinationPair';scene.add(pair);
  const film=createRecombinationFilm({onBirth}),session=createCombineSession({progressive:true});
  const embedded=document.getElementById('__combine_audio');
  const audio=createCombineAudio(embedded?'data:audio/mp4;base64,'+embedded.textContent.trim():'./assets/combine-audio.mp4',
    undefined,{music:true});
  const ui=document.createElement('section');ui.id='chamber-performance';ui.hidden=true;
  ui.innerHTML='<header><div><strong>生命结合</strong><span id="fusion-stage"></span></div><nav aria-label="结合控制"><button id="fusion-mute" title="切换音效">静音</button><button id="fusion-pause" title="暂停或继续结合">暂停</button><button id="fusion-replay" title="重播本次结合">重播</button><button id="fusion-return" title="返回太空舱，保留本次后代">返回</button></nav></header><div id="fusion-qte"><div><b id="fusion-count"></b><span id="fusion-speed"></span></div><div id="fusion-progress" role="progressbar" aria-label="融合进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="fusion-progress-fill"></i></div><button id="fusion-boost" title="空格 / 点击：加速融合">持续按压融合</button></div><div id="fusion-result"></div>';
  document.body.append(ui);
  const $=id=>document.getElementById(id);
  let actors=[],colors=[],taskId=null,playing=false,paused=false,finished=false,width=0,height=0,lastUI='',environment=null,wasRunning=false,completedAt=-1;
  let pressShake=0;

  function syncAudio(running=true) {
    audio.setMuted(isMuted()||!running||paused||document.hidden);
    audio.setVolume(.48*effectsVolume());
    audio.setMusicVolume(.16*musicVolume());
  }
  function layout() {
    width=innerWidth;height=innerHeight;
    const aspect=width/height,halfWidth=Math.max(5.3,2.95*aspect);
    camera.left=-halfWidth;camera.right=halfWidth;camera.top=halfWidth/aspect;camera.bottom=-camera.top;
    camera.position.set(0,4.5,24);camera.lookAt(0,1.1,0);
    camera.updateProjectionMatrix();camera.updateMatrixWorld(true);film.resize(width,height);
  }
  function prepare(id,parents,child,kind) {
    stop();actors.forEach(a=>a.dispose());actors=[];
    try {
      actors=parents.map((source,side)=>{
        const actor=createGameActor(source,{side,modelId:source.userData.modelId,initialWave:false});
        pair.add(actor.root);return actor;
      });
      film.setResultAsset(createFilmResult(child,kind));
      taskId=id;
    } catch(error) {actors.forEach(a=>a.dispose());actors=[];taskId=null;throw error;}
  }
  function start() {
    if(!taskId||actors.length!==2)return false;
    // Reset input and presentation together; replay retains the prepared child.
    session.reset();
    session.start(true);film.reset();
    colors=actors.map(a=>a.color.clone());playing=true;paused=false;finished=false;wasRunning=false;
    completedAt=-1;pressShake=0;lastUI='';
    syncAudio();void audio.activate();onStart?.();
    ui.hidden=false;layout();updateUI();return true;
  }
  function stop() {
    playing=false;paused=false;finished=false;wasRunning=false;completedAt=-1;
    session.reset();film.reset();audio.stop();ui.hidden=true;pressShake=0;
    $('app').style.transform='';
  }
  function boost(repeat=false) {
    if(!playing||paused||document.hidden)return;
    if(session.press({repeat})){
      void audio.activate();
      audio.press(session.speed);
      pressShake=1;
      updateUI();
    }
  }
  function updateUI() {
    const key=[session.state,session.progress.toFixed(3),session.speed.toFixed(1),session.cinematicPhase,paused,isMuted(),finished].join('|');
    if(key===lastUI)return;
    lastUI=key;
    $('fusion-stage').textContent=paused?'已暂停':
      ({entry:'迪斯科融合',weaving:'生物螺旋',coiling:'聚合',sphere:'失控融合',
        birth:'新生命诞生',result:'结合完成'})[session.cinematicPhase]||'持续融合';
    $('fusion-qte').hidden=session.state!=='cinematic'||session.completed;
    $('fusion-count').textContent='融合进度 '+Math.round(session.progress*100)+'%';
    $('fusion-speed').textContent=session.speed.toFixed(1)+'×';
    const percent=Math.round(session.progress*100);
    $('fusion-progress').dataset.value=String(percent);
    $('fusion-progress').ariaValueNow=String(percent);
    $('fusion-progress-fill').style.width=percent+'%';
    $('fusion-pause').textContent=paused?'继续':'暂停';
    $('fusion-mute').textContent=isMuted()?'开启声音':'静音';
    $('fusion-boost').disabled=session.completed;
    $('fusion-result').textContent=session.completed?
      (finished?'新生命已诞生':'融合完成，生命正在诞生'):'';
    ui.dataset.state=session.state;ui.dataset.phase=session.cinematicPhase||'';ui.dataset.presses=session.presses;
    ui.dataset.progress=String(session.progress);
  }
  function update(dt,running) {
    if(!playing)return;
    if(width!==innerWidth||height!==innerHeight)layout();
    syncAudio(running);
    const advancing=running&&!paused&&!document.hidden;
    pressShake=advancing?Math.max(0,pressShake-dt*8):0;
    const shakeTime=session.cinematicTime*180;
    $('app').style.transform=pressShake?
      `translate(${Math.sin(shakeTime)*pressShake*5}px,${Math.cos(shakeTime*1.3)*pressShake*3}px)`:'';
    if(!advancing)audio.stop();
    else if(!wasRunning)void audio.activate();
    wasRunning=advancing;
    if(advancing&&!finished) {
      session.update(dt);
      if(session.state==='cinematic') {
        if(!film.active) {
          pair.updateMatrixWorld(true);
          film.begin(actors,camera,{angularVelocity:ROTATION_SPEED*session.speed,orientation:pair.rotation.y,colors,environment:environment?.texture||null});
        }
        film.update(session.cinematicTime,{progress:session.progress,completed:session.completed});
        if(session.completed&&completedAt<0)completedAt=session.cinematicTime;
        finished=session.completed&&completedAt>=0&&session.cinematicTime-completedAt>=1.65;
      }
    }
    updateUI();
  }
  // Reuse the game's renderer and animation loop, as required by the V1 host API.
  function render(renderer) {
    if(!playing)return false;
    if(!environment&&renderer.isWebGLRenderer) {
      const room=new THREE.Scene();room.background=new THREE.Color('#c9d4ce');
      for(const [x,y,z,sx,sy] of [[-4,6,5,5,4],[5,4,2,2,6],[0,7,-4,5,3]]) {
        const panel=new THREE.Mesh(new THREE.PlaneGeometry(sx,sy),new THREE.MeshBasicMaterial({color:'#ffffff',side:THREE.DoubleSide}));
        panel.position.set(x,y,z);panel.lookAt(0,1,0);room.add(panel);
      }
      const generator=new THREE.PMREMGenerator(renderer);environment=generator.fromScene(room,.05);generator.dispose();
      room.traverse(node=>{node.geometry?.dispose();node.material?.dispose();});
      scene.environment=environment.texture;
    }
    const exposure=renderer.toneMappingExposure;renderer.toneMappingExposure=.98;
    try {if(session.state==='cinematic')film.render(renderer);else renderer.render(scene,camera);}
    finally {renderer.toneMappingExposure=exposure;}
    return true;
  }
  $('fusion-boost').onclick=()=>boost();
  $('fusion-return').onclick=()=>onReturn?.();
  $('fusion-replay').onclick=start;
  $('fusion-pause').onclick=()=>{paused=!paused;if(paused)audio.stop();syncAudio();updateUI();};
  $('fusion-mute').onclick=()=>{toggleSound();syncAudio();updateUI();};
  return {prepare,start,stop,boost,update,render,syncAudio,
    get preparedTask(){return taskId;},
    get active(){return playing;},get done(){return finished;},get paused(){return paused;},
    status(){return {active:playing,state:session.state,presses:session.presses,progress:session.progress,
      speed:session.speed,surgeRound:session.surgeRound,time:session.time,
      cinematicTime:session.cinematicTime,cinematicPhase:session.cinematicPhase,resultSource:film.resultSource,
      resultScale:film.resultScale,done:finished,paused};},
    dispose(){stop();actors.forEach(a=>a.dispose());film.dispose();audio.dispose();environment?.dispose();ui.remove();},
  };
}
