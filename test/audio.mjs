import {runGame,DRIVER_HEAD,DRIVER_FOOTER} from './harness.mjs';

await runGame(`
${DRIVER_HEAD}
sec('Audio categories, motion loops, birth cue and pause menu');
globalThis.Audio=class {
  constructor(src) {
    this.src=src;this.paused=true;this.ended=false;this.currentTime=0;
    this.volume=1;this.muted=false;this.plays=0;this.listeners={};
  }
  addEventListener(type,fn){this.listeners[type]=fn;}
  play(){this.plays++;this.paused=false;return Promise.resolve();}
  pause(){this.paused=true;}
};
initAudio();
ok(backgroundTrack.media.loop&&!backgroundTrack.media.paused,'background loops after audio unlock');
ok(grassTrack.media.paused&&flightTrack.media.paused,'stationary player has no motion sound');
const shotCount=()=>laserVoices.reduce((sum,voice)=>sum+voice.plays,0);
animals.filter(a=>!a.captured&&!a.launch).slice(0,3).forEach(captureAnimal);
const magazineBefore=mag.length,shotsBefore=shotCount();
fireKey('keydown','KeyG',{repeat:false});
ok(mag.length===magazineBefore-1&&shotCount()===shotsBefore+1,
  'one G press launches one creature and plays one laser cue');
fireKey('keydown','KeyG',{repeat:true});
fireKey('keydown','KeyG',{repeat:false});
ok(mag.length===magazineBefore-1&&shotCount()===shotsBefore+1,
  'held or duplicate G keydowns cannot launch or play audio again');
releaseKey('KeyG');
fireKey('keydown','KeyG',{repeat:false});
releaseKey('KeyG');
ok(mag.length===magazineBefore-2&&shotCount()===shotsBefore+2,
  'release then press immediately permits the next shot without a cooldown');
ok(laserVoices.every(voice=>voice.loop===false),'laser voices are explicitly one-shot');
volumeLevels.master=.5;volumeLevels.background=.4;volumeLevels.effects=.2;
syncGameAudio();
ok(Math.abs(backgroundTrack.media.volume-.064)<1e-8,'music gain is master times background times asset level');
ok(Math.abs(laserVoices[0].volume-.065)<1e-8,'laser gain is master times effects times asset level');
ok(channelVolume('effects')===.1,'collision callback receives effects mix');
groundMoving=true;player.flying=false;player.onGround=true;syncGameAudio();
ok(!grassTrack.media.paused&&grassTrack.media.loop,'ground movement starts looping grass audio');
player.flying=true;syncGameAudio();
ok(grassTrack.media.paused&&!flightTrack.media.paused&&flightTrack.media.loop,
  'flight replaces footsteps with looping jetpack audio');
player.flying=false;groundMoving=false;syncGameAudio();
ok(flightTrack.media.paused&&grassTrack.media.paused,'landing and standing stop motion loops');
groundMoving=true;bag.open=true;syncGameAudio();
ok(grassTrack.media.paused,'inventory stops movement audio');
bag.open=false;groundMoving=false;
const musicPlays=backgroundTrack.media.plays;
backgroundTrack.media.currentTime=12;
playBirthCelebration();
ok(birthTrack.media.plays===1&&!birthTrack.media.loop,'birth cue plays as a one-shot');
syncGameAudio();syncGameAudio();
ok(birthTrack.media.plays===1,'subsequent frames do not retrigger birth audio');
ok(backgroundTrack.media.plays===musicPlays&&backgroundTrack.media.currentTime===12,
  'birth does not replace or restart background music');
pauseGame();
ok(paused&&!el('dim').hidden&&el('dim').classList.contains('on'),'pause opens the settings menu');
ok(birthTrack.media.paused&&!backgroundTrack.media.paused,'pause suspends the birth cue but leaves music for mixing');
el('volume-effects').value='75';
fire('volume-effects','input',{target:el('volume-effects')});
ok(volumeLevels.effects===.75&&el('volume-effects-value').textContent==='75%','effects slider applies immediately');
const position=player.x;
pressKey('KeyW');loop();releaseKey('KeyW');
ok(player.x===position&&!keys.KeyW,'menu inputs cannot move the player');
resumeFromMenu();
ok(!paused&&el('dim').hidden&&!birthTrack.media.paused,'resume closes menu and continues the paused birth cue');
birthTrack.media.listeners.ended();syncGameAudio();
ok(!birthPlaying,'ended birth cue cannot loop');
volumeLevels.effects=0;syncGameAudio();
const laserPlays=laserVoices.reduce((sum,v)=>sum+v.plays,0);
playLaser();
ok(laserVoices.reduce((sum,v)=>sum+v.plays,0)===laserPlays,'zero effects volume suppresses new laser sounds');
ok(backgroundTrack.media.volume>0,'effects slider does not mute background music');
volumeLevels.master=0;syncGameAudio();
ok(backgroundTrack.media.volume===0&&channelVolume('effects')===0,'master zero silences both categories');
volumeLevels.master=1;volumeLevels.effects=1;toggleMute();
ok(backgroundTrack.media.muted&&channelVolume('effects')===0,'mute affects all categories');
toggleMute();
document.hidden=true;syncGameAudio();
ok(backgroundTrack.media.paused&&flightTrack.media.paused&&grassTrack.media.paused,'background tab stops all media loops');
document.hidden=false;
sec('Slaughter pop uses the effects bus without replacing music');
const originalContext=audioCtx,originalSoundGain=soundGain;
const audioNodes=[];
const param=()=>({value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}});
const makeNode=type=>{
  const node={type,gain:param(),frequency:param(),connections:[],starts:0,
    connect(destination){this.connections.push(destination);},
    disconnect(){},start(){this.starts++;},stop(){}};
  audioNodes.push(node);
  return node;
};
audioCtx={currentTime:0,sampleRate:8000,state:'running',
  createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};},
  createBufferSource:()=>makeNode('buffer'),
  createBiquadFilter:()=>makeNode('filter'),
  createGain:()=>makeNode('gain'),
  createOscillator:()=>makeNode('oscillator')};
soundGain={gain:param()};
slaughterPopBuffer=null;
volumeLevels.master=.5;volumeLevels.effects=.4;
syncGameAudio();
const musicBeforePop=backgroundTrack.media.plays;
backgroundTrack.media.currentTime=17;
playSlaughterPop();
ok(audioNodes.filter(n=>n.starts).length===9,'one pop has one splash layer and eight thump/bubble voices');
ok(audioNodes.filter(n=>n.connections.includes(soundGain)).length===9,
  'all pop layers connect to the existing effects bus');
ok(Math.abs(soundGain.gain.value-.2)<1e-9,'master and effects sliders also control the pop');
ok(backgroundTrack.media.plays===musicBeforePop&&backgroundTrack.media.currentTime===17,
  'slaughter pop neither replaces nor restarts background music');
const nodeCount=audioNodes.length;
volumeLevels.effects=0;syncGameAudio();playSlaughterPop();
ok(audioNodes.length===nodeCount,'effects zero suppresses the pop');
volumeLevels.effects=1;paused=true;playSlaughterPop();paused=false;
ok(audioNodes.length===nodeCount,'pause suppresses new pop sounds');
audioCtx=originalContext;soundGain=originalSoundGain;slaughterPopBuffer=null;
${DRIVER_FOOTER}
`,{search:'?autostart=1&intro=0&pos=-30,0'});
