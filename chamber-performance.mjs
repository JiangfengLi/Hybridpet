import * as THREE from './vendor/three.module.min.js';
import {createCombineSession,sampleCombination,sampleCombinationRotation,ROTATION_SPEED} from './fusion-v1/combine-session.mjs';
import {waveSections} from './fusion-v1/wave-motion.mjs';
import {FILM_SETTLED_AT} from './fusion-v1/recombination-motion.mjs';
import {createRecombinationFilm} from './fusion-v1/recombination-film.js';
import {createGameActor,createFilmResult} from './fusion-v1/game-actor.mjs';
import {createSurfaceSampler,findContactPair} from './fusion-v1/surface-contact.js';
import {createSlimeSplash} from './fusion-v1/slime-splash.js';
import {createCombineAudio} from './fusion-v1/combine-audio.js';
import {createChamberStage} from './chamber-stage.mjs';

export function createChamberPerformance({onReturn,onStart,onBirth=()=>{},isMuted=()=>false,
  toggleSound=()=>{},effectsVolume=()=>1}) {
  const scene=new THREE.Scene(),stage=createChamberStage(scene);
  const camera=new THREE.OrthographicCamera(-6,6,4,-4,.1,100);
  const pair=new THREE.Group();pair.name='CombinationPair';scene.add(pair);
  const sampler=createSurfaceSampler(),splash=createSlimeSplash();scene.add(splash.root);
  const film=createRecombinationFilm({onBirth}),session=createCombineSession();
  const embedded=document.getElementById('__combine_audio');
  const audio=createCombineAudio(embedded?'data:audio/mp4;base64,'+embedded.textContent.trim():'./assets/combine-audio.mp4');
  const ui=document.createElement('section');ui.id='chamber-performance';ui.hidden=true;
  ui.innerHTML='<header><div><strong>生命结合</strong><span id="fusion-stage"></span></div><nav aria-label="结合控制"><button id="fusion-mute" title="切换音效">静音</button><button id="fusion-pause" title="暂停或继续结合">暂停</button><button id="fusion-replay" title="重播本次结合">重播</button><button id="fusion-return" title="返回太空舱，保留本次后代">返回</button></nav></header><div id="fusion-qte"><div><b id="fusion-count"></b><span id="fusion-speed"></span></div><div id="fusion-ticks" aria-hidden="true">'+Array.from({length:10},()=>'<i></i>').join('')+'</div><button id="fusion-boost" title="空格 / 点击：加速结合">加速</button></div><div id="fusion-result"></div>';
  document.body.append(ui);
  const $=id=>document.getElementById(id);
  let actors=[],colors=[],taskId=null,playing=false,paused=false,finished=false,width=0,height=0,lastUI='',environment=null,wasRunning=false;

  function syncAudio(running=true) {
    audio.setMuted(isMuted()||!running||paused||document.hidden);
    audio.setVolume(.48*effectsVolume());
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
        const actor=createGameActor(source,{side,modelId:source.userData.modelId});
        pair.add(actor.root);sampler.prepare(actor.root);return actor;
      });
      film.setResultAsset(createFilmResult(child,kind));
      taskId=id;
    } catch(error) {actors.forEach(a=>a.dispose());actors=[];taskId=null;throw error;}
  }
  function pose(time) {
    pair.rotation.y=sampleCombinationRotation(time);
    const sections=waveSections(sampleCombination(time).points);
    actors.forEach(actor=>actor.applySections(sections));pair.updateMatrixWorld(true);
  }
  function start() {
    if(!taskId||actors.length!==2)return false;
    /* ⚠️ **必须先 reset()**，不能直接 start()。
       原因（2026-09-23 融合时查出来的 bug）：`createCombineSession().start(ready)` 里有一句
         `if (!ready || state === "running") return false;`
       也就是说**在 QTE 阶段（state === 'running'）点重播会直接早退**，
       presses / time / surgeRound 一个都不重置，而演出却被摆回 0 位 ⇒ 进度条与画面错位；
       在 surge / cinematic 阶段点重播则恰好能重置 —— 所以这个 bug 只在**前半段**出现，很容易漏。
       reset() 把 state 打回 'setup'，于是 start() 一定走得到重置分支。
       回归：test/chamber.mjs 的 `replay resets presses`。 */
    session.reset();
    session.start(true);film.reset();splash.clear();pose(0);
    colors=actors.map(a=>a.color.clone());playing=true;paused=false;finished=false;wasRunning=false;
    syncAudio();void audio.activate();onStart?.();
    ui.hidden=false;layout();updateUI();return true;
  }
  function stop() {
    playing=false;paused=false;finished=false;wasRunning=false;
    session.reset();film.reset();splash.clear();audio.stop();ui.hidden=true;
  }
  function boost(repeat=false) {
    if(!playing||paused||document.hidden)return;
    if(session.press({repeat})){void audio.activate();updateUI();}
  }
  function updateUI() {
    const key=[session.state,session.presses,session.surgeRound,session.speed.toFixed(1),session.cinematicPhase,paused,isMuted(),finished].join('|');
    if(key===lastUI)return;
    lastUI=key;
    $('fusion-stage').textContent=paused?'已暂停':session.state==='running'?'结合加速':session.state==='surge'?'强化结合 '+session.surgeRound+' / 4':
      ({entry:'基因重组',drawing:'彩色拉线',weaving:'DNA 缠绕',coiling:'聚合',sphere:'聚合',separating:'分离',birth:'新生',result:'结合完成'})[session.cinematicPhase]||'结合';
    $('fusion-qte').hidden=session.state!=='running';
    $('fusion-count').textContent=String(session.presses).padStart(2,'0')+' / 10';
    $('fusion-speed').textContent=session.speed.toFixed(1)+'×';
    $('fusion-ticks').querySelectorAll('i').forEach((node,i)=>node.classList.toggle('active',i<session.presses));
    $('fusion-pause').textContent=paused?'继续':'暂停';
    $('fusion-mute').textContent=isMuted()?'开启声音':'静音';
    $('fusion-result').textContent=session.cinematicPhase==='result'?'结合完成':'';
    ui.dataset.state=session.state;ui.dataset.phase=session.cinematicPhase||'';ui.dataset.presses=session.presses;
  }
  function update(dt,running) {
    if(!playing)return;
    if(width!==innerWidth||height!==innerHeight)layout();
    syncAudio(running);
    const advancing=running&&!paused&&!document.hidden;
    if(!advancing)audio.stop();
    else if(!wasRunning&&session.state!=='cinematic')void audio.activate();
    wasRunning=advancing;
    if(advancing&&!finished) {
      for(const event of session.update(dt)) {
        pose(event.time);
        const contact=findContactPair(actors[0].root,actors[1].root);
        if(contact&&contact.gap<.25&&session.confirmContact(event)) {
          const samples=contact.hits.map(hit=>sampler.sample(hit));
          colors=samples.map(s=>s.color.clone());
          splash.emit({point:contact.point,axis:contact.axis,colors,time:event.time,seed:event.round});
          audio.impact(session.speed);
        }
      }
      if(session.state!=='cinematic'||!film.active)pose(session.time);
      if(session.state==='cinematic') {
        if(!film.active) {
          film.begin(actors,camera,{angularVelocity:ROTATION_SPEED*session.speed,orientation:pair.rotation.y,colors,environment:environment?.texture||null});
          splash.clear();audio.stop();
        }
        film.update(session.cinematicTime);
        finished=session.cinematicTime>=FILM_SETTLED_AT+1.5;
      }
      splash.update(session.time);
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
  $('fusion-pause').onclick=()=>{paused=!paused;syncAudio();updateUI();};
  $('fusion-mute').onclick=()=>{toggleSound();syncAudio();updateUI();};
  return {prepare,start,stop,boost,update,render,syncAudio,
    get preparedTask(){return taskId;},
    get active(){return playing;},get done(){return finished;},get paused(){return paused;},
    status(){return {active:playing,state:session.state,presses:session.presses,surgeRound:session.surgeRound,time:session.time,
      cinematicTime:session.cinematicTime,cinematicPhase:session.cinematicPhase,resultSource:film.resultSource,resultScale:film.resultScale,done:finished,paused};},
    dispose(){stop();actors.forEach(a=>a.dispose());film.dispose();stage.dispose();splash.dispose();sampler.dispose();audio.dispose();environment?.dispose();ui.remove();},
  };
}
