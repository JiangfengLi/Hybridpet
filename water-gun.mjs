export const HEART_RANGE = 12;
export const HEART_MIN_SIZE = .12;
export const HEART_MAX_SIZE = 1.4;
export const HEART_SPEED = 9;
export const HEART_INTERVAL = .1;
export const WATER_RANGE = HEART_RANGE; // Existing chamber integrations keep their API.

export function createWaterGun({THREE,scene,camera,collector,traceWater,sprayWater,getAudio}) {
  const rig=new THREE.Group();rig.name='heart-radiation-gun';camera.add(rig);
  rig.position.set(.29,-.25,-.53);rig.rotation.set(.04,-.08,-.08);rig.visible=false;
  const effects=new THREE.Group();effects.name='heart-projectiles';scene.add(effects);effects.visible=false;
  const geometries=[],materials=[];
  function material(color,extra={}) {
    const mat=new THREE.MeshStandardMaterial({color,roughness:.3,metalness:.06,...extra});
    materials.push(mat);return mat;
  }
  function part(geo,mat,parent=rig) {
    geometries.push(geo);
    const mesh=new THREE.Mesh(geo,mat);parent.add(mesh);return mesh;
  }
  const pink=material(0xf079b1),accent=material(0xda437f),white=material(0xfff5fc);
  const tankMat=material(0xffb8dc,{transparent:true,opacity:.7,depthWrite:false});
  const body=part(new THREE.CapsuleGeometry(.085,.19,4,12),pink);body.rotation.x=Math.PI/2;
  const barrel=part(new THREE.CylinderGeometry(.035,.055,.16,12),accent);
  barrel.rotation.x=Math.PI/2;barrel.position.z=-.24;
  const mouth=part(new THREE.TorusGeometry(.032,.009,6,16),white);mouth.position.z=-.326;
  const grip=part(new THREE.CapsuleGeometry(.038,.14,4,10),accent);
  grip.position.set(0,-.13,.065);grip.rotation.x=.3;
  const tank=part(new THREE.CapsuleGeometry(.07,.12,4,12),tankMat);
  tank.rotation.x=Math.PI/2;tank.position.set(0,.125,.015);
  const cap=part(new THREE.CylinderGeometry(.037,.037,.028,12),white);cap.position.set(0,.205,.055);
  const trigger=part(new THREE.TorusGeometry(.044,.009,6,12,Math.PI),white);
  trigger.rotation.z=-Math.PI/2;trigger.position.set(0,-.09,-.05);
  const muzzle=new THREE.Object3D();muzzle.position.set(0,0,-.34);rig.add(muzzle);
  // A thin tube draws only the closed outline; the heart interior stays entirely empty.
  const points=Array.from({length:80},(_,i)=>{
    const t=i/80*Math.PI*2;
    return new THREE.Vector3(Math.pow(Math.sin(t),3),
      (13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t)+2)/16,0);
  });
  const heartGeo=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points,true),96,.017,5,true);
  geometries.push(heartGeo);
  const shots=Array.from({length:24},()=>{
    const mat=new THREE.MeshBasicMaterial({color:0xff69b0,transparent:true,opacity:1,depthWrite:false});
    materials.push(mat);
    const mesh=new THREE.Mesh(heartGeo,mat);mesh.name='heart-outline';mesh.visible=false;effects.add(mesh);
    return {mesh,active:false,distance:0,width:HEART_MIN_SIZE,direction:new THREE.Vector3()};
  });
  const origin=new THREE.Vector3(),direction=new THREE.Vector3(),start=new THREE.Vector3();
  const aim=new THREE.Vector3(),p0=new THREE.Vector3(),forward=new THREE.Vector3(0,0,-1);
  const up=new THREE.Vector3(0,1,0),ground=new THREE.Plane(up,0),ray=new THREE.Ray();
  let equipped=false,pressed=false,spraying=false,time=0,lastHit=null,voice=null,noiseBuffer=null,cooldown=0;

  function stopSound() {
    if(!voice)return;
    voice.source.stop();voice.bubble.stop();
    for(const node of [voice.source,voice.filter,voice.gain,voice.bubble,voice.bubbleGain])node.disconnect();
    voice=null;
  }
  function sound(active) {
    if(!active){stopSound();return;}
    if(voice)return;
    const audio=getAudio();
    if(!audio?.context||!audio.destination)return;
    const ctx=audio.context;
    if(!noiseBuffer||noiseBuffer.sampleRate!==ctx.sampleRate) {
      noiseBuffer=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
      const data=noiseBuffer.getChannelData(0);
      for(let i=0;i<data.length;i++)
        data[i]=(Math.random()*2-1)*(.68+.22*Math.sin(i/ctx.sampleRate*Math.PI*2*19));
    }
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=noiseBuffer;source.loop=true;
    filter.type='bandpass';filter.frequency.value=1450;filter.Q.value=.65;
    gain.gain.value=.075;
    source.connect(filter);filter.connect(gain);gain.connect(audio.destination);
    const bubble=ctx.createOscillator(),bubbleGain=ctx.createGain();
    bubble.type='sine';bubble.frequency.value=165;bubbleGain.gain.value=.008;
    bubble.connect(bubbleGain);bubbleGain.connect(audio.destination);
    source.start();bubble.start();
    voice={source,filter,gain,bubble,bubbleGain};
  }
  function stop() {
    pressed=false;spraying=false;lastHit=null;effects.visible=false;
    cooldown=0;
    for(const shot of shots){shot.active=false;shot.mesh.visible=false;}
    rig.position.z=-.53;stopSound();
  }
  function emitHeart() {
    const shot=shots.find(candidate=>!candidate.active);
    if(!shot)return;
    camera.updateWorldMatrix(true,true);
    camera.getWorldPosition(origin);camera.getWorldDirection(direction);
    const hit=traceWater(origin,direction,HEART_RANGE);
    aim.copy(origin).addScaledVector(direction,HEART_RANGE);
    if(hit)aim.copy(hit.point);
    ray.set(origin,direction);
    if(ray.intersectPlane(ground,p0)&&p0.distanceTo(origin)<aim.distanceTo(origin))aim.copy(p0);
    muzzle.getWorldPosition(start);
    direction.subVectors(aim,start);
    if(direction.lengthSq()<.0001)return;
    direction.normalize();
    shot.active=true;shot.distance=0;shot.width=HEART_MIN_SIZE;
    shot.direction.copy(direction);shot.mesh.position.copy(start);
    shot.mesh.quaternion.setFromUnitVectors(forward,direction);
    shot.mesh.scale.setScalar(HEART_MIN_SIZE/2);
    shot.mesh.material.opacity=1;shot.mesh.visible=true;
  }
  function advanceShot(shot,dt) {
    const distance=Math.min(HEART_SPEED*dt,HEART_RANGE-shot.distance);
    const position=shot.mesh.position;
    // Sweep every travelled segment so a fast projectile cannot skip a chamber wall.
    const hit=traceWater(position,shot.direction,distance);
    ray.set(position,shot.direction);
    const groundHit=ray.intersectPlane(ground,p0);
    const groundDistance=groundHit?p0.distanceTo(position):Infinity;
    if(hit&&hit.distance<=distance&&hit.distance<=groundDistance) {
      lastHit=sprayWater(position,shot.direction,HEART_INTERVAL,distance);
      shot.active=false;
    } else if(groundDistance<=distance)shot.active=false;
    else {
      position.addScaledVector(shot.direction,distance);shot.distance+=distance;
      shot.width=HEART_MIN_SIZE+(HEART_MAX_SIZE-HEART_MIN_SIZE)*Math.min(1,shot.distance/8);
      shot.mesh.scale.setScalar(shot.width/2);
      shot.mesh.material.opacity=Math.min(1,(HEART_RANGE-shot.distance)/1.5);
      if(shot.distance>=HEART_RANGE-.00001)shot.active=false;
    }
    shot.mesh.visible=shot.active;
  }
  return {
    get equipped(){return equipped;},
    get spraying(){return spraying;},
    setEquipped(value) {
      stop();equipped=Boolean(value);rig.visible=equipped;collector.visible=!equipped;
    },
    setTrigger(value){
      if(value&&equipped){if(!pressed)cooldown=0;pressed=true;}
      else {pressed=false;spraying=false;rig.position.z=-.53;stopSound();}
    },
    stop,
    update(dt,{active,visible}) {
      rig.visible=visible&&equipped;collector.visible=visible&&!equipped;
      if(!active){stop();return;}
      spraying=equipped&&pressed;
      sound(spraying);
      if(!Number.isFinite(dt)||dt<=0)return;
      dt=Math.min(dt,.1);
      time+=dt;lastHit=null;
      rig.position.z=-.53+(spraying?Math.sin(time*35)*.003:0);
      for(const shot of shots)if(shot.active)advanceShot(shot,dt);
      if(spraying) {
        cooldown-=dt;
        while(cooldown<0) {
          emitHeart();
          cooldown+=HEART_INTERVAL;
        }
      }
      effects.visible=shots.some(shot=>shot.active);
    },
    status(){return {equipped,pressed,spraying,target:lastHit?.chamberId??null,
      name:'heart-radiation-gun',range:HEART_RANGE,maxSize:HEART_MAX_SIZE,
      projectiles:shots.filter(shot=>shot.active).map(shot=>({distance:shot.distance,size:shot.width}))};},
    dispose(){stop();rig.removeFromParent();effects.removeFromParent();
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());collector.visible=true;},
  };
}
