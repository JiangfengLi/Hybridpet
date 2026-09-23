import {World,Body,Box,Plane,Vec3,Material,ContactMaterial,SAPBroadphase} from './vendor/cannon-es.mjs';

const FIXED_STEP=1/60;

export function createBonePhysics({ground=0,arena=100,pods=[]}={}) {
  const world=new World({gravity:new Vec3(0,-12,0),allowSleep:true});
  world.broadphase=new SAPBroadphase(world);
  world.solver.iterations=20;
  world.solver.tolerance=.001;
  const material=new Material('bone-remains');
  world.addContactMaterial(new ContactMaterial(material,material,{
    friction:.75,restitution:.035,contactEquationStiffness:1e7,contactEquationRelaxation:4,
  }));
  const records=new Map();
  const offset=new Vec3();
  const floor=new Body({mass:0,material,shape:new Plane()});
  floor.position.y=ground;
  floor.quaternion.setFromEuler(-Math.PI/2,0,0);
  world.addBody(floor);
  function wall(x,y,z,hx,hy,hz) {
    const body=new Body({mass:0,material,shape:new Box(new Vec3(hx,hy,hz))});
    body.position.set(x,y,z);world.addBody(body);
  }
  for(const sign of [-1,1]) {
    wall(sign*(arena+.5),ground+50,0,.5,50,arena+1);
    wall(0,ground+50,sign*(arena+.5),arena+1,50,.5);
  }
  for(const pod of pods)wall(pod.x,ground+2.7,pod.z,3.65,2.7,2.85);

  function sync(record) {
    const {entity,body,center}=record;
    body.quaternion.vmult(center,offset);
    entity.x=body.position.x-offset.x;
    entity.y=body.position.y-offset.y;
    entity.z=body.position.z-offset.z;
    entity.g.position.set(entity.x,entity.y,entity.z);
    entity.g.quaternion.set(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w);
    body.updateAABB();
    const min=body.aabb.lowerBound,max=body.aabb.upperBound;
    Object.assign(entity.boneBounds,{
      minX:min.x,maxX:max.x,minY:min.y,maxY:max.y,minZ:min.z,maxZ:max.z,
    });
    entity.cyl.r=Math.max(max.x-min.x,max.z-min.z)/2;
    entity.cyl.h=max.y-min.y;
  }
  function supportHeight(x,z,ceiling=Infinity,radius=0,includePods=true) {
    let height=ground;
    if(includePods&&ground+5.4<=ceiling)for(const pod of pods) {
      if(Math.abs(x-pod.x)<3.65+radius&&Math.abs(z-pod.z)<2.85+radius)
        height=Math.max(height,ground+5.4);
    }
    for(const {entity} of records.values()) {
      const b=entity.boneBounds;
      if(b.maxY<=ceiling+.015&&x+radius>b.minX&&x-radius<b.maxX
        &&z+radius>b.minZ&&z-radius<b.maxZ)height=Math.max(height,b.maxY);
    }
    return height;
  }
  function add(entity,size) {
    if(records.has(entity))return records.get(entity).body;
    const limit=arena-1.3*size;
    entity.x=Math.max(-limit,Math.min(limit,entity.x));
    entity.z=Math.max(-limit,Math.min(limit,entity.z));
    // Two convex volumes follow the crossed bones and skull, with a broad, stable base.
    const body=new Body({
      mass:Math.max(.5,size*size*size*1.8),material,allowSleep:true,
      linearDamping:.38,angularDamping:.65,sleepSpeedLimit:.1,sleepTimeLimit:1,
    });
    body.addShape(new Box(new Vec3(.94*size,.18*size,.63*size)),new Vec3(0,-.30*size,.23*size));
    body.addShape(new Box(new Vec3(.47*size,.42*size,.36*size)),new Vec3(0,.04*size,-.19*size));
    const height=Math.max(entity.y,supportHeight(entity.x,entity.z,Infinity,.7*size)+.06);
    body.position.set(entity.x,height+.48*size,entity.z);
    body.quaternion.setFromEuler(0,entity.slaughterYaw||0,0);
    body.velocity.y=.45;
    world.addBody(body);
    entity.boneBody=body;
    entity.boneBounds={};
    entity.cyl={r:size,h:.94*size};
    const record={entity,body,size,center:new Vec3(0,.48*size,0)};
    records.set(entity,record);sync(record);
    return body;
  }
  function remove(entity) {
    const record=records.get(entity);
    if(!record)return false;
    world.removeBody(record.body);records.delete(entity);
    delete entity.boneBody;delete entity.boneBounds;
    return true;
  }
  function step(dt) {
    if(!Number.isFinite(dt)||dt<=0||!records.size)return;
    world.step(FIXED_STEP,Math.min(dt,.1),6);
    for(const record of records.values())sync(record);
  }
  function constrain(actor,radius=.3,height=1.68) {
    // Bridge the existing character controller to the current rigid-body bounds.
    for(let pass=0;pass<2;pass++)for(const {entity} of records.values()) {
      const b=entity.boneBounds;
      if(actor.y>=b.maxY-.025||actor.y+height<=b.minY+.025)continue;
      const cx=Math.max(b.minX,Math.min(b.maxX,actor.x));
      const cz=Math.max(b.minZ,Math.min(b.maxZ,actor.z));
      let dx=actor.x-cx,dz=actor.z-cz;
      const length=Math.hypot(dx,dz);
      if(length>=radius)continue;
      let push=radius-length;
      if(length>.0001){dx/=length;dz/=length;}
      else {
        const sides=[
          {d:actor.x-b.minX,x:-1,z:0},{d:b.maxX-actor.x,x:1,z:0},
          {d:actor.z-b.minZ,x:0,z:-1},{d:b.maxZ-actor.z,x:0,z:1},
        ];
        sides.sort((a,b)=>a.d-b.d);
        dx=sides[0].x;dz=sides[0].z;push=radius+sides[0].d;
      }
      actor.x+=dx*(push+.001);actor.z+=dz*(push+.001);
      if(Number.isFinite(actor.vx)&&Number.isFinite(actor.vz)) {
        const inward=actor.vx*dx+actor.vz*dz;
        if(inward<0){actor.vx-=dx*inward;actor.vz-=dz*inward;}
      }
    }
  }
  return {
    add,remove,step,supportHeight,constrain,
    applyImpulse(entity,impulse) {
      const record=records.get(entity);
      if(!record||!impulse||![impulse.x,impulse.y,impulse.z].every(Number.isFinite))return false;
      record.body.wakeUp();record.body.applyImpulse(new Vec3(impulse.x,impulse.y,impulse.z));
      return true;
    },
    teleport(entity,{x,y,z},yaw=0) {
      const record=records.get(entity);
      if(!record||![x,y,z,yaw].every(Number.isFinite))return false;
      const body=record.body;
      body.position.set(x,y+.48*record.size,z);
      body.quaternion.setFromEuler(0,yaw,0);
      body.velocity.setZero();body.angularVelocity.setZero();body.wakeUp();
      body.aabbNeedsUpdate=true;sync(record);
      return true;
    },
    status(entity) {
      const record=records.get(entity);
      return record?{mass:record.body.mass,shapes:record.body.shapes.length,
        sleeping:record.body.sleepState===Body.SLEEPING,bounds:{...entity.boneBounds}}:null;
    },
    dispose(){for(const entity of [...records.keys()])remove(entity);},
  };
}
