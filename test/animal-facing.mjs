import {runGame,DRIVER_HEAD,DRIVER_FOOTER} from './harness.mjs';

await runGame(`
${DRIVER_HEAD}
sec('World pals face the player with local positive X');
const a=animals.find(isSolid);
for(const other of animals)if(other!==a)other.captured=true;
clock.getDelta=()=>0;
const facing=()=>{
  a.g.updateWorldMatrix(true,false);
  const axis=new THREE.Vector3(1,0,0).transformDirection(a.g.matrixWorld);
  const toward=new THREE.Vector3(player.x-a.x,0,player.z-a.z).normalize();
  return axis.dot(toward)>1-1e-8;
};
for(const [dx,dz] of [[12,0],[-12,0],[0,12],[0,-12],[12,-12]]) {
  a.x=40;a.z=40;a.heading=.37;a.timer=5;a.wallT=0;
  player.x=a.x+dx;player.z=a.z+dz;player.y=0;
  loop();
  ok(facing(),'positive X faces the player at '+dx+','+dz);
  ok(a.heading===.37,'visual facing does not overwrite movement heading');
}
a.x=CHAMBER_POSITIONS[0].x;a.z=CHAMBER_POSITIONS[0].z;
player.x=12;player.z=14;
loop();
ok(a.x!==CHAMBER_POSITIONS[0].x||a.z!==CHAMBER_POSITIONS[0].z,'pod collision adjusts position');
ok(facing(),'facing uses the final collision-corrected position');
a.x=40;a.z=40;player.x=40;player.z=40;
a.g.rotation.y=.63;
loop();
ok(a.g.rotation.y===.63,'coincident horizontal positions retain a finite heading');
a.captured=true;a.g.rotation.y=.84;player.x=52;
loop();
ok(a.g.rotation.y===.84,'captured or pod-held parents are not reoriented');
a.captured=false;a.launch={t:0,dur:.55,x0:40,z0:40,y0:0,x1:46,z1:40,y1:0,peak:3.6};
loop();
ok(a.g.rotation.y===.84,'launch animation retains rotation ownership');
a.launch=null;a.suckT=.2;
loop();
ok(a.g.rotation.y===.84,'capture animation retains rotation ownership');
a.suckT=0;a.x=40;a.z=40;player.x=45;player.z=40;
a.heading=Math.PI/2;a.phase=.3;a.wallT=0;a.timer=5;
clock.getDelta=()=>1/60;
loop();
ok(a.x<40,'original fleeing movement still moves away from the player');
ok(facing(),'fleeing movement does not turn positive X away from the player');
pauseGame();
const pausedYaw=a.g.rotation.y;
player.z+=10;loop();
ok(a.g.rotation.y===pausedYaw,'pause freezes visual facing');
${DRIVER_FOOTER}
`,{search:'?autostart=1&intro=0'});
