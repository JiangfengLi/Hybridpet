import {createGameActor} from './fusion-v1/game-actor.mjs';
import {sampleCombination,combinationContacts} from './fusion-v1/combine-session.mjs';
import {waveSections} from './fusion-v1/wave-motion.mjs';

export const CHAMBER_POSITIONS = Object.freeze([
  Object.freeze({x:0,z:23}),
  Object.freeze({x:-18,z:23}),
  Object.freeze({x:18,z:23}),
]);
export const CHAMBER_POSITION = CHAMBER_POSITIONS[0];

export function createChamberView(THREE, scene, camera, {position=CHAMBER_POSITION,id=0}={}) {
  const root = new THREE.Group();
  root.name = 'breeding-pod';
  root.userData.chamberId=id;
  root.position.set(position.x, 0, position.z);
  scene.add(root);
  const body=new THREE.Group();body.name='pod-suspension';root.add(body);
  const geometries = [], materials = [], textures = [], targets = [];
  const shell = material(0xeaf2ee, .76);
  const blue = material(0xa8d5e4, .68);
  const dark = material(0x526c77, .9);
  const mint = material(0x83d8c2, .6);
  const honey = material(0xf0cf78, .68);
  const lamp = material(0xe0f4bf, .5);
  lamp.emissive.set(0x83d8c2);
  const ringMats = [mint.clone(), honey.clone()];
  materials.push(...ringMats);
  for (const m of ringMats) { m.emissive.copy(m.color); m.emissiveIntensity = .15; }
  function material(color, roughness) {
    const m = new THREE.MeshStandardMaterial({color, roughness, metalness:.04});
    materials.push(m);
    return m;
  }
  function mesh(geo, mat, parent = body) {
    geometries.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  // Beveled extrusion, not thin box edges: all moving pieces retain their own pivot.
  function rounded(w,h,d,r,x,y,z,mat,parent=body) {
    r = Math.min(r,w/2-.01,h/2-.01,d/2-.01);
    const bevel=Math.min(r*.32,d*.24), corner=r-bevel;
    const shape = new THREE.Shape(), a=w/2-bevel, b=h/2-bevel;
    shape.moveTo(-a+corner,-b);shape.lineTo(a-corner,-b);
    shape.quadraticCurveTo(a,-b,a,-b+corner);shape.lineTo(a,b-corner);
    shape.quadraticCurveTo(a,b,a-corner,b);shape.lineTo(-a+corner,b);
    shape.quadraticCurveTo(-a,b,-a,b-corner);shape.lineTo(-a,-b+corner);
    shape.quadraticCurveTo(-a,-b,-a+corner,-b);
    const g = new THREE.ExtrudeGeometry(shape,{depth:d-2*bevel,bevelEnabled:true,bevelSegments:3,
      steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:6});
    g.translate(0,0,-(d-2*bevel)/2);
    const m=mesh(g,mat,parent); m.position.set(x,y,z); return m;
  }
  function cylinder(r,h,x,y,z,mat,parent=body) {
    const m=mesh(new THREE.CylinderGeometry(r,r,h,40),mat,parent);
    m.position.set(x,y,z);return m;
  }
  function sign(text,w,h,x,y,z,background='#eaf2ee',color='#29454c') {
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=192;
    const ctx=canvas.getContext('2d');
    function paint(value) {
      ctx.fillStyle=background;ctx.fillRect(0,0,768,192);
      ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='600 64px "Segoe UI", sans-serif';ctx.fillText(value,384,100);
    }
    paint(text);
    const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;textures.push(tex);
    const mat=new THREE.MeshBasicMaterial({map:tex});materials.push(mat);
    const m=mesh(new THREE.PlaneGeometry(w,h),mat);m.position.set(x,y,z);m.rotation.y=Math.PI;
    return {set(value){paint(value);tex.needsUpdate=true;}};
  }
  for(const x of [-2.7,2.7])for(const z of [-1.9,1.9])rounded(1,.42,1,.18,x,.23,z,dark);
  rounded(7.3,.55,5.65,.24,0,.58,0,blue);
  rounded(6.95,.65,5.3,.23,0,.98,0,shell);
  rounded(6.7,.16,5.1,.05,0,1.35,0,blue);
  const glassMaterial=new THREE.MeshBasicMaterial({
    color:0xc8edf1,transparent:true,opacity:.09,depthWrite:false,side:THREE.DoubleSide,
  });
  materials.push(glassMaterial);
  const windows=[];
  function windowPane(w,h,x,y,z,rotation,name,parent=body) {
    const pane=mesh(new THREE.PlaneGeometry(w,h),glassMaterial,parent);
    pane.name=name;pane.position.set(x,y,z);pane.rotation.y=rotation;
    pane.castShadow=false;pane.receiveShadow=false;windows.push(pane);return pane;
  }
  for(const y of [1.48,4.04])rounded(6.7,.24,.42,.09,0,y,2.37,shell);
  windowPane(5.99,2.25,0,2.76,2.39,0,'pod-observation-window-back');
  for(const x of [-3.18,3.18]) {
    for(const z of [-2.32,2.32])rounded(.38,2.8,.38,.12,x,2.76,z,shell);
    for(const y of [1.48,4.04])rounded(.42,.24,4.9,.09,x,y,0,shell);
    windowPane(4.25,2.25,x,2.76,0,Math.PI/2,
      x<0?'pod-observation-window-left':'pod-observation-window-right');
    rounded(.12,.08,4.2,.025,x,1.65,0,blue);
    rounded(.12,.08,4.2,.025,x,3.87,0,blue);
    rounded(.32,.14,3.6,.055,x,4.24,0,blue);
  }
  const slots=[1.64,-1.64].map((x,i)=>{
    cylinder(1.25,.16,x,1.49,0,shell);
    const ring=mesh(new THREE.TorusGeometry(1.18,.095,10,48),ringMats[i]);
    ring.rotation.x=Math.PI/2;ring.position.set(x,1.58,0);
    const mount=new THREE.Group();mount.name='pod-slot-'+i;mount.position.set(x,1.64,0);body.add(mount);
    const target=rounded(2.85,2.7,4.3,.05,x,2.8,-.1,new THREE.MeshBasicMaterial({visible:false}));
    materials.push(target.material);target.userData.slot=i;targets.push(target);
    sign(i?'02':'01',.58,.22,x,1.02,-2.658);
    return {mount,ring,x,visual:null,id:null,actor:null};
  });
  // HOME * .63 aligns the two deformation actors with the existing +/-1.64 slots.
  const incubationRoot=new THREE.Group();incubationRoot.name='pod-incubation';
  incubationRoot.position.set(0,1.64,-.35);incubationRoot.scale.setScalar(.63);
  incubationRoot.visible=false;body.add(incubationRoot);
  const lidPivot=new THREE.Group();lidPivot.name='pod-lid';lidPivot.position.set(0,4.23,2.35);body.add(lidPivot);
  rounded(6.95,.46,5.2,.2,0,0,-2.25,blue,lidPivot);
  rounded(6.25,.12,4.45,.045,0,-.29,-2.25,shell,lidPivot);
  lidPivot.rotation.x=1.12;
  const shutter=new THREE.Group();shutter.name='pod-window-door';
  shutter.position.set(0,2.83,-2.39);body.add(shutter);
  for(const y of [-1.245,1.245])rounded(6.45,.24,.4,.1,0,y,0,shell,shutter);
  for(const x of [-3.1,3.1])rounded(.25,2.3,.4,.1,x,0,0,shell,shutter);
  for(const y of [-1.105,1.105])rounded(5.99,.06,.1,.025,0,y,-.175,blue,shutter);
  for(const x of [-2.96,2.96])rounded(.06,2.23,.1,.025,x,0,-.175,blue,shutter);
  windowPane(5.94,2.25,0,0,-.16,0,'pod-observation-window',shutter);
  const interiorLight=new THREE.PointLight(0xe6fff1,8,7,2);
  interiorLight.position.set(0,3.75,-1.45);body.add(interiorLight);
  const frontMark=sign('GENESIS '+String(id+1).padStart(2,'0'),1.8,.27,0,.83,-2.679);
  const screen=sign('STANDBY',1.58,.24,0,1.15,-2.691,'#526c77','#ecf5ee');
  const hintCanvas=document.createElement('canvas');hintCanvas.width=1024;hintCanvas.height=192;
  const hintContext=hintCanvas.getContext('2d');
  const hintTexture=new THREE.CanvasTexture(hintCanvas);hintTexture.colorSpace=THREE.SRGBColorSpace;
  textures.push(hintTexture);
  const hintMaterial=new THREE.MeshBasicMaterial({map:hintTexture,transparent:true,depthWrite:false});
  materials.push(hintMaterial);
  const parentHints=mesh(new THREE.PlaneGeometry(3.25,.58),hintMaterial);
  parentHints.name='pod-parent-hints';parentHints.position.set(0,2.48,-2.29);parentHints.rotation.y=Math.PI;
  parentHints.visible=false;
  let hintSignature='',hasParentHints=false;
  function drawParentHints(lines) {
    const values=Array.isArray(lines)?lines.slice(0,2).map(value=>String(value||'')): [];
    const signature=values.join('\n');
    if(signature===hintSignature)return;
    hintSignature=signature;
    hintContext.clearRect(0,0,1024,192);
    hasParentHints=values.length>=2;
    if(values.length<2) {
      parentHints.visible=false;
      hintTexture.needsUpdate=true;
      return;
    }
    hintContext.fillStyle='rgba(38,61,66,.86)';
    hintContext.fillRect(12,12,1000,168);
    hintContext.fillStyle='#effcf5';
    hintContext.textAlign='center';hintContext.textBaseline='middle';
    hintContext.font='600 32px "Segoe UI","Microsoft YaHei",sans-serif';
    values.forEach((value,index)=>hintContext.fillText(value,512,62+index*68));
    parentHints.visible=hasParentHints;
    hintTexture.needsUpdate=true;
  }
  drawParentHints([]);
  rounded(5.4,.57,.12,.035,0,1.84,-2.62,dark);
  const waterCanvas=document.createElement('canvas');waterCanvas.width=1024;waterCanvas.height=96;
  const waterContext=waterCanvas.getContext('2d');
  const waterTexture=new THREE.CanvasTexture(waterCanvas);waterTexture.colorSpace=THREE.SRGBColorSpace;
  textures.push(waterTexture);
  const waterMaterial=new THREE.MeshBasicMaterial({map:waterTexture});materials.push(waterMaterial);
  const waterPanel=mesh(new THREE.PlaneGeometry(5.22,.43),waterMaterial);
  waterPanel.name='pod-water-meter';waterPanel.position.set(0,1.84,-2.69);waterPanel.rotation.y=Math.PI;
  let waterPercent=-1;
  function drawWater(value) {
    const percent=Math.floor(Math.max(0,Math.min(1,value))*100);
    if(percent===waterPercent)return;
    waterPercent=percent;
    waterContext.fillStyle='#351727';waterContext.fillRect(0,0,1024,96);
    waterContext.font='700 34px Consolas, monospace';waterContext.textBaseline='middle';
    for(let i=0;i<20;i++) {
      waterContext.fillStyle=(i+1)*5<=percent?(i>=15?'#ffa6d3':'#f36ba9'):'#63334c';
      waterContext.fillRect(24+i*41,22,33,52);
    }
    waterContext.textAlign='right';waterContext.fillStyle='#ffe1f0';
    waterContext.fillText(String(percent).padStart(3,'0')+'%',998,50);
    waterTexture.needsUpdate=true;
  }
  drawWater(0);
  for(const x of [-2.95,2.95]) {
    const cap=mesh(new THREE.SphereGeometry(.2,16,10),lamp);
    cap.position.set(x,4.48,-1.87);cap.scale.y=.65;
    cylinder(.23,.1,x,4.32,-1.87,blue);
  }
  const childMount=new THREE.Group();childMount.name='pod-offspring';childMount.position.set(0,1.6,-1.6);body.add(childMount);
  const childTarget=rounded(1.65,1.85,1.65,.05,0,2.4,-1.8,new THREE.MeshBasicMaterial({visible:false}));
  materials.push(childTarget.material);childTarget.userData.slot=2;targets.unshift(childTarget);childTarget.visible=false;
  const consoleTarget=rounded(1.8,.65,.3,.08,0,1,-2.65,new THREE.MeshBasicMaterial({visible:false}));
  materials.push(consoleTarget.material);consoleTarget.userData.slot=-1;targets.push(consoleTarget);
  const raycaster=new THREE.Raycaster();
  const waterRaycaster=new THREE.Raycaster();
  const waterTarget=mesh(new THREE.BoxGeometry(7.05,3.8,5.4),
    new THREE.MeshBasicMaterial({visible:false}),root);
  waterTarget.name='pod-water-target';waterTarget.position.y=2.5;materials.push(waterTarget.material);
  const childPosition=new THREE.Vector3(),viewerPosition=new THREE.Vector3();
  let openness=1,child=null,flight=null,lastPhase='',lastProgress=-1,incubationTime=0,shakeAmount=0;

  function fit(visual,max) {
    visual.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(visual),size=bounds.getSize(new THREE.Vector3());
    const s=Math.min(1,max/Math.max(size.x,size.y,size.z,.01));
    visual.scale.multiplyScalar(s);
    visual.position.y=-bounds.min.y*s;
    return visual;
  }
  function setParent(i,id,visual) {
    const slot=slots[i];
    if(slot.id===id){visual?.userData.dispose?.();return;}
    slot.actor?.dispose();slot.actor=null;
    slot.visual?.userData.dispose?.();
    slot.mount.clear();
    slot.id=id;slot.visual=visual;
    if(visual) {
      // Build from the unmounted local clone so world transforms are not baked twice.
      slot.actor=createGameActor(visual,{side:i===0?1:0,modelId:visual.userData.modelId});
      incubationRoot.add(slot.actor.root);
      slot.mount.add(fit(visual,2.05));
    }
    incubationTime=0;
  }
  function setChild(visual) {
    child?.userData.dispose?.();childMount.clear();child=visual;
    if(child)childMount.add(fit(child,1.65));
  }
  function hit(player) {
    if(Math.hypot(player.x-root.position.x,player.z-root.position.z)>11)return null;
    root.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2(),camera);
    const intersection=raycaster.intersectObjects(targets.filter(t=>t.visible),false)[0];
    return intersection&&intersection.distance<11
      ?{slot:intersection.object.userData.slot,distance:intersection.distance}:null;
  }
  function aim(player) {return hit(player)?.slot??null;}
  function waterHit(origin,direction,range) {
    root.updateWorldMatrix(true,true);
    waterRaycaster.set(origin,direction);waterRaycaster.far=range;
    const hit=waterRaycaster.intersectObject(waterTarget,false)[0];
    return hit?{point:hit.point,distance:hit.distance,
      normal:hit.face.normal.clone().transformDirection(waterTarget.matrixWorld)}:null;
  }
  function shoot(slot,visual,inward=false) {
    if(flight){flight.visual.userData.dispose?.();flight.visual.removeFromParent();}
    const from=new THREE.Vector3(.3,-.32,-.85).applyMatrix4(camera.matrixWorld);
    const to=(slot===2?childMount:slots[slot].mount).getWorldPosition(new THREE.Vector3());
    fit(visual,slot===2?1.65:2.05);scene.add(visual);
    flight={visual,from:inward?to:from,to:inward?from:to,scale:visual.scale.clone(),t:0,inward,slot};
  }
  function update(dt,time,phase,{progress=0,water=0,offline=false}={}) {
    const open=['loading','complete'].includes(phase);
    parentHints.visible=phase==='loading'&&hasParentHints;
    openness+=Math.sign((open?1:0)-openness)*Math.min(Math.abs((open?1:0)-openness),dt*1.25);
    const ease=openness*openness*(3-2*openness);
    lidPivot.rotation.x=ease*1.12;
    shutter.visible=openness<.995;
    shutter.scale.y=Math.max(.01,1-ease);
    shutter.position.y=4.19-1.365*(1-ease);
    const incubating=['sealing','irradiating','generating'].includes(phase)
      &&openness<=.001&&slots.every(slot=>slot.actor);
    incubationRoot.visible=incubating;
    let contacts=0;
    if(incubating&&dt>0) {
      const previous=incubationTime;
      incubationTime+=Math.min(dt,.05);
      const sections=waveSections(sampleCombination(incubationTime).points);
      slots.forEach(slot=>slot.actor.applySections(sections));
      contacts=combinationContacts(previous,incubationTime).length;
    }
    if(open)incubationTime=0;
    const shaking=incubating||phase==='playing';
    shakeAmount+=((shaking?1:0)-shakeAmount)*Math.min(1,dt*7);
    // Only the display rig rocks; the root and collision boundary stay fixed.
    body.position.set(Math.sin(time*13)*.055*shakeAmount,
      Math.abs(Math.sin(time*9))*.035*shakeAmount,Math.sin(time*11)*.024*shakeAmount);
    body.rotation.set(Math.sin(time*11)*.009*shakeAmount,0,Math.sin(time*13)*.016*shakeAmount);
    const ready=phase==='ready';
    lamp.emissiveIntensity=ready?.55+.25*Math.sin(time*3):phase==='generating'?.15+.12*Math.sin(time*2):.08;
    const complete=phase==='complete';
    childMount.visible=complete&&openness>.3&&!!child;
    childTarget.visible=complete&&openness>.85;
    for(const [i,slot] of slots.entries()) {
      slot.mount.position.set(slot.x,1.64,complete?.45:0);
      slot.mount.visible=!incubating&&phase!=='playing'&&!(flight&&!flight.inward&&flight.slot===i);
      slot.mount.rotation.y=0;
      slot.ring.material.emissiveIntensity=slot.id?.18+.07*Math.sin(time*1.6):.035;
    }
    if(child) {
      childMount.position.y=1.61+Math.sin(time*2)*.03;
      // Point the newborn's local +X axis horizontally toward the player.
      camera.getWorldPosition(viewerPosition);
      body.worldToLocal(viewerPosition);
      childPosition.copy(viewerPosition).sub(childMount.position);
      if(childPosition.x*childPosition.x+childPosition.z*childPosition.z>1e-8)
        childMount.rotation.y=Math.atan2(-childPosition.z,childPosition.x);
    }
    if(flight) {
      flight.t=Math.min(1,flight.t+dt/.48);
      const p=flight.t,s=p*p*(3-2*p);
      flight.visual.position.lerpVectors(flight.from,flight.to,s);
      flight.visual.position.y+=Math.sin(p*Math.PI)*.65;
      flight.visual.scale.copy(flight.scale).multiplyScalar(flight.inward?1-.9*p:.1+.9*p);
      if(p===1){flight.visual.userData.dispose?.();flight.visual.removeFromParent();flight=null;}
    }
    const percent=Math.floor(Math.max(0,Math.min(100,progress)));
    if(phase!==lastPhase||percent!==lastProgress) {
      screen.set(phase==='irradiating'?'RADIATION':['sealing','generating'].includes(phase)?(offline?'DEMO ':'')+percent+'%':
        ({loading:'STANDBY',error:'RETRY',ready:'100% READY',playing:'FUSION',complete:'NEW LIFE'})[phase]||'STANDBY');
      lastPhase=phase;lastProgress=percent;
    }
    drawWater(water);
    return {incubating,contacts};
  }
  function constrain(body,radius=.3) {
    const dx=body.x-root.position.x,dz=body.z-root.position.z;
    const x=3.65+radius,z=2.85+radius;
    if(Math.abs(dx)>=x||Math.abs(dz)>=z||body.y>5.4)return;
    if(x-Math.abs(dx)<z-Math.abs(dz))body.x=root.position.x+Math.sign(dx||1)*x;
    else body.z=root.position.z+Math.sign(dz||-1)*z;
  }
  return {root,setParent,setParentHints:drawParentHints,setChild,aim,hit,waterHit,shoot,update,constrain,
    status(){return {openness,closed:openness<=.001,opaque:false,observationWindow:true,windowCount:windows.length,
      incubating:incubationRoot.visible,incubationTime,flight:!!flight,shakeAmount,waterPercent,
      progress:lastProgress,parentHints:parentHints.visible};},
    dispose(){slots.forEach(s=>{s.actor?.dispose();s.visual?.userData.dispose?.();});child?.userData.dispose?.();flight?.visual.userData.dispose?.();
      flight?.visual.removeFromParent();root.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}
  };
}
