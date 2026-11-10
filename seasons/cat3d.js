// Flat vector companion: animated Bezier silhouettes, no 3D shading or pose sprites.
export function createCompanion(THREE) {
  const group=new THREE.Group(),cat=new THREE.Group(),art=new THREE.Group();
  group.add(cat);cat.add(art);
  const ink=new THREE.MeshBasicMaterial({color:0x070d13,side:THREE.DoubleSide});
  const cream=new THREE.MeshBasicMaterial({color:0xe9e7d6,side:THREE.DoubleSide});
  const eyeInk=new THREE.MeshBasicMaterial({color:0xd3ddcb,side:THREE.DoubleSide});
  const wingMat=new THREE.MeshBasicMaterial({color:0xe9e2bf,side:THREE.DoubleSide});
  const lerp=THREE.MathUtils.lerp,smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
  function path(parent,material,commands,z=0){const s=new THREE.Shape();for(const [op,...v]of commands)s[op](...v);const mesh=new THREE.Mesh(new THREE.ShapeGeometry(s,18),material);mesh.position.z=z;parent.add(mesh);return mesh;}
  function ellipse(parent,material,x,y,rx,ry,z=0){const s=new THREE.Shape();s.absellipse(x,y,rx,ry,0,Math.PI*2,false,0);const mesh=new THREE.Mesh(new THREE.ShapeGeometry(s,24),material);mesh.position.z=z;parent.add(mesh);return mesh;}
  function ribbon(parent,material,count,z=0){const geometry=new THREE.BufferGeometry(),positions=new Float32Array(count*2*3),indices=[];for(let i=0;i<count-1;i++){let a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(indices);const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.position.z=z;parent.add(mesh);return{mesh,set(fn,width){const attr=geometry.attributes.position;for(let i=0;i<count;i++){const u=i/(count-1),p=fn(u),q=fn(Math.min(1,u+.002)),r=fn(Math.max(0,u-.002));let dx=q[0]-r[0],dy=q[1]-r[1],length=Math.hypot(dx,dy)||1;const w=typeof width==='function'?width(u):width;dx*=w/length;dy*=w/length;attr.setXYZ(i*2,p[0]-dy,p[1]+dx,0);attr.setXYZ(i*2+1,p[0]+dy,p[1]-dx,0);}attr.needsUpdate=true;}};}
  // Sitting contour is traced from the source at 20 s (pixel crop 990,690).
  // Preserve its broad short ears, left-offset cheek, narrow neck and curved back.
  function sourcePath(parent,material,commands,cx,cy,z=0){
    const units=.0076;
    const c=commands.map(([op,...v])=>[op,...v.map((n,i)=>i%2?(cy-n)*units:(n-cx)*units)]);
    return path(parent,material,c,z);
  }
  const body=new THREE.Group();art.add(body);
  sourcePath(body,ink,[["moveTo",34.0,52.0],["bezierCurveTo",35.0,55.0,37.0,57.0,36.0,60.0],["bezierCurveTo",35.0,64.0,31.0,67.0,29.0,70.0],["bezierCurveTo",27.0,74.0,27.0,83.0,25.5,92.0],["bezierCurveTo",29.0,93.0,33.0,94.0,37.0,94.0],["lineTo",37.5,89.5],["bezierCurveTo",39.0,92.0,39.0,95.0,42.0,95.0],["bezierCurveTo",47.0,95.0,49.0,93.0,51.0,90.0],["bezierCurveTo",55.0,90.0,59.0,92.0,65.0,90.0],["bezierCurveTo",64.5,86.0,65.5,81.0,65.5,77.0],["bezierCurveTo",65.5,74.0,63.8,72.0,62.0,70.0],["bezierCurveTo",61.0,66.0,62.0,61.0,58.0,57.0],["bezierCurveTo",55.0,55.0,53.5,53.0,53.0,49.5],["closePath"]],45,72.5);
  sourcePath(body,cream,[['moveTo',37,54],['bezierCurveTo',42,57,44,61,43,66],['bezierCurveTo',41,70,45,71,43,77],['bezierCurveTo',41,81,39,83,39,88],['lineTo',34,88],['bezierCurveTo',35,82,32,79,33,74],['bezierCurveTo',36,67,38,62,37,54]],45,72.5,.002);
  sourcePath(body,cream,[['moveTo',55,72],['bezierCurveTo',60,71,62,77,60,81],['bezierCurveTo',58,82,59,87,55,88],['quadraticCurveTo',49,89,48,85],['bezierCurveTo',51,81,49,78,52,77],['quadraticCurveTo',55,77,55,72]],45,72.5,.002);
  const head=new THREE.Group();art.add(head);
  sourcePath(head,ink,[["moveTo",24.0,17.0],["lineTo",32.0,23.0],["lineTo",43.0,23.0],["lineTo",50.0,18.0],["lineTo",50.0,26.0],["bezierCurveTo",50.5,29.0,53.5,32.0,55.0,35.0],["bezierCurveTo",57.2,39.0,56.6,45.0,54.0,48.0],["lineTo",53.0,51.0],["bezierCurveTo",48.0,54.0,40.0,56.0,33.0,54.0],["bezierCurveTo",27.0,53.0,21.0,49.0,18.5,45.0],["bezierCurveTo",16.8,40.0,19.0,35.0,23.0,32.0],["lineTo",25.0,30.0],["closePath"]],39,50,.006);
  // Flat white chin, not a long white forehead blaze or protruding muzzle.
  sourcePath(head,cream,[['moveTo',20,43],['bezierCurveTo',24,44,29,43,32,45],['quadraticCurveTo',35,48,39,49],['quadraticCurveTo',38,53,34,53],['bezierCurveTo',28,52,22,49,20,43]],39,50,.008);
  const eyes=[];for(const [x,y]of [[27,38],[45,35]]){const e=ellipse(head,eyeInk,(x-39)*.0076,(50-y)*.0076,.005,.007,.012);eyes.push(e);}
  const legs=[];for(let i=0;i<4;i++){const leg=ribbon(art,ink,16,i%2?-.003:.004);const paw=ellipse(art,i<2?cream:ink,0,0,.028,.015,.005);legs.push({leg,paw});}
  const tail=ribbon(art,ink,40,-.005);
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(.24,40),new THREE.MeshBasicMaterial({color:0x111c23,transparent:true,opacity:.15,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.scale.y=.48;shadow.position.y=.025;group.add(shadow);
  const butterfly=new THREE.Group(),wings=[];group.add(butterfly);
  ellipse(butterfly,ink,0,0,.012,.048,.004);
  for(const side of [-1,1]){const pivot=new THREE.Group();butterfly.add(pivot);wings.push(pivot);const wing=path(pivot,wingMat,[['moveTo',0,0],['bezierCurveTo',.035,.12,.149,.139,.124,.039],['quadraticCurveTo',.104,-.006,.043,-.006],['bezierCurveTo',.135,-.016,.095,-.101,.041,-.076],['quadraticCurveTo',.009,-.055,0,0]]);wing.scale.x=side;}
  let time=0,excitedUntil=-10,interactionX=0,interactionZ=0,interactions=0;
  const state={catPosition:cat.position,butterflyPosition:butterfly.position,interactions:0,pose:'crouch',style:'2D animated vector paths'};
  function update(t,phase,camera){
    time=t;const cycle=((t%23.8)+23.8)%23.8,excited=Math.max(0,excitedUntil-t),action=excited>0?2.4-excited:-1;
    const intervals=[[2.7,4.7],[8.7,10.7],[13.7,14.8],[18.6,20.5]];
    let sit=0;for(const [a,b]of intervals)sit=Math.max(sit,smooth((cycle-a)/.28)*(1-smooth((cycle-b+.28)/.28)));
    const jumpCenter=[2,8,13,21].find(j=>Math.abs(cycle-j)<.52),jumpPhase=jumpCenter===undefined?-1:(cycle-jumpCenter+.52)/1.04;
    const clickJump=action>.35&&action<1.35?(action-.35):0;
    const jump=jumpPhase>=0?Math.sin(jumpPhase*Math.PI):clickJump?Math.sin(clickJump*Math.PI):0;
    sit*=1-smooth(jump*2);
    const smallStep=Math.sin(t*3.2)*.035*(1-sit),hop=jump*.43;
    cat.position.set(.74+Math.sin(t*.58)*.11+smallStep+(excited?interactionX*Math.sin(action/2.4*Math.PI):0),.07+hop,2.43+Math.sin(t*.36)*.065+(excited?interactionZ*Math.sin(action/2.4*Math.PI):0));
    if(camera){cat.quaternion.copy(camera.quaternion);butterfly.quaternion.copy(camera.quaternion);}else{cat.rotation.x=-.53;butterfly.rotation.x=-.53;}
    cat.scale.setScalar(.85);
    art.rotation.z=jump?Math.sin((jumpPhase>=0?jumpPhase:clickJump)*Math.PI*2)*.16:Math.sin(t*2)*.014;
    const stretch=1+jump*.16,walk=1-sit;
    body.position.set(0,lerp(.15,.171,sit),0);
    body.rotation.z=(1-sit)*Math.PI/2;body.scale.set(lerp(.55,1,sit),lerp(1.22*stretch,1,sit),1);
    head.position.set(lerp(-.21,-.0456,sit),lerp(.205,.342,sit)+Math.sin(t*2.4)*.003,0);
    head.rotation.z=lerp(-.03,.02,sit)+Math.sin(t*.93)*.035-jump*.12;
    const blink=1-Math.pow(Math.max(0,Math.sin(t*1.4)),32)*.93;eyes.forEach(e=>e.scale.y=blink);
    for(let i=0;i<4;i++){
      const front=i<2,near=i%2===0,wave=Math.sin(t*8+(near?0:Math.PI)+(front?0:Math.PI));
      const x=front?lerp(-.15,-.075,sit):lerp(.17,.07,sit),y=front?lerp(.15,.265,sit):lerp(.15,.115,sit);
      const pawX=x+wave*.04*walk+(front?-jump*.1:jump*.11),pawY=.012+Math.max(0,wave)*.025*walk+jump*.08;
      const endX=front?pawX:lerp(pawX,.13,sit),endY=front?pawY:lerp(pawY,.015,sit);
      legs[i].leg.set(u=>{const knee=(front?-.016:.03)*Math.sin(u*Math.PI);return[lerp(x,endX,u)+knee,lerp(y,endY,u)];},u=>lerp(front?.023:.032,.014,u));
      legs[i].paw.position.set(endX-.008,endY,.005);legs[i].leg.mesh.visible=sit<.97;legs[i].paw.visible=sit<.97;
    }
    const tx=lerp(.215,.145,sit),ty=lerp(.16,.035,sit),sway=Math.sin(t*2.1)*.026;
    tail.set(u=>[tx+Math.sin(u*1.9)*lerp(.24,.13,sit)+sway*u*u,ty+u*lerp(.12,.15,sit)+Math.pow(u,4)*lerp(.10,.05,sit)],u=>.016*(1-u*.6));
    butterfly.position.set(-.35+Math.sin(t*.88)*.36+(excited?interactionX:0),.49+Math.sin(t*1.9)*.10+hop*.25,2.38+Math.cos(t*.67)*.13+(excited?interactionZ:0));
    butterfly.scale.setScalar(.7);wings[0].scale.x=.12+Math.abs(Math.sin(t*27))*.88;wings[1].scale.x=wings[0].scale.x;
    shadow.position.x=cat.position.x;shadow.position.z=cat.position.z;shadow.material.opacity=.15*(1-jump*.7);shadow.scale.x=1+jump*.4;
    state.pose=jump>.01?'jump':sit>.65?'sit':'crouch';state.interactions=interactions;
  }
  function interact(point){interactions++;excitedUntil=time+2.4;interactionX=point?THREE.MathUtils.clamp((point.x-cat.position.x)*.5,-.6,.6):-.35;interactionZ=point?THREE.MathUtils.clamp((point.z-cat.position.z)*.5,-.25,.25):-.1;}
  update(0,0);
  return{group,update,interact,hitObjects:[cat,butterfly],state};
}
