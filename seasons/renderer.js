/* Local WebGL renderer: real articulated grass geometry and volumetric weather.
 * Normal playback is a continuous four-revolution year (8π seconds by default).
 * phase 0 winter→spring; .25 spring→summer; .5 summer→autumn; .75 autumn→winter.
 * setReferenceTime retains the original 23.8-second clip for source comparison.
 * All runtime modules are shipped locally; transparent captures preserve alpha.
 */
import * as THREE from './vendor/three.module.js';
import {createTerrain,createWeather} from './terrain.js';
import {createCompanion} from './cat3d.js';
const TAU=Math.PI*2,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=v=>((v%1)+1)%1;
export class SeasonScene {
 constructor(canvas,options={}){
  if(!(canvas instanceof HTMLCanvasElement))throw new TypeError('SeasonScene requires a canvas');
  this.canvas=canvas;this.phase=wrap(options.phase??.25);this.speed=clamp(options.speed??8*Math.PI,8,600);this.playing=options.playing!==false;
  this.quality=['high','medium','low'].includes(options.quality)?options.quality:'high';this.weather=options.weather||'auto';this.background=options.background||'transparent';this.onChange=options.onChange||null;
  this.elapsed=0;this.frame=0;this.fps=60;this.interactions=0;this.dragging=false;this.destroyed=false;this.rendererName='Three.js WebGL · GPU animated grass';
  this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  this.renderer.setClearColor(0x000000,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.18;
  this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(42,1,.1,100);this.camera.position.set(0,6.5,10.8);this.camera.lookAt(0,.15,0);this.camera.zoom=1.18;
  const ambient=new THREE.HemisphereLight(0xe9f2e9,0x203020,2.1);this.scene.add(ambient);
  const key=new THREE.DirectionalLight(0xfff4da,3.1);key.position.set(-4,9,5);this.scene.add(key);
  const rimLight=new THREE.DirectionalLight(0xcbdde3,1.4);rimLight.position.set(4,4,-5);this.scene.add(rimLight);
  this.terrain=createTerrain();this.scene.add(this.terrain.group);this.weatherSystem=createWeather();this.scene.add(this.weatherSystem.group);
  this.companion=createCompanion(THREE);this.scene.add(this.companion.group);
  this._makeHubAndHand();
  this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this._plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);this._worldHit=new THREE.Vector3();
  this._pointerDown=this._pointerDown.bind(this);this._pointerMove=this._pointerMove.bind(this);this._pointerUp=this._pointerUp.bind(this);this._tick=this._tick.bind(this);this._resize=this._resize.bind(this);
  canvas.addEventListener('pointerdown',this._pointerDown);canvas.addEventListener('pointermove',this._pointerMove);canvas.addEventListener('pointerup',this._pointerUp);canvas.addEventListener('pointercancel',this._pointerUp);canvas.addEventListener('lostpointercapture',this._pointerUp);
  this._contextLost=e=>{e.preventDefault();this.contextLost=true;this._notify();};this._contextRestored=()=>{this.contextLost=false;this._notify();};canvas.addEventListener('webglcontextlost',this._contextLost);canvas.addEventListener('webglcontextrestored',this._contextRestored);
  this._observer=new ResizeObserver(this._resize);this._observer.observe(canvas);this.setQuality(this.quality);this._resize();this.step(0);const failed=this.renderer.info.programs?.find(p=>p.diagnostics?.runnable===false);if(failed){this.destroy();throw new Error("WebGL shader compilation failed: "+(failed.diagnostics.vertexShader?.log||failed.diagnostics.fragmentShader?.log||"unknown shader"));}this._raf=requestAnimationFrame(this._tick);
 }
 get state(){const r=this._referenceTime!=null?this._referenceData(this._referenceTime):this._cycleData(this.phase);return{phase:this.phase,season:r.old===4?r.next:r.sweep>.5?r.next:r.old,playing:this.playing,speed:this.speed,weather:this.weather,quality:this.quality,fps:Math.round(this.fps),interactions:this.interactions,renderer:this.rendererName,grassBlades:this.terrain.grass.geometry.instanceCount,contextLost:!!this.contextLost,transitionSoftness:this.terrain.uniforms.uTransitionWidth.value,timeline:this._referenceTime!=null?"reference":"loop"};}
 get interactionTargets(){const s=this.companion.state;return{cat:{...this.projectToClient(s.catPosition||new THREE.Vector3(.9,.3,2.7)),radius:23},butterfly:{...this.projectToClient(s.butterflyPosition||new THREE.Vector3(-.4,.7,2.4)),radius:18}};}
 projectToClient(point){const p=point.isVector3?point.clone():new THREE.Vector3(point.x??point[0],point.y??point[1],point.z??point[2]);p.project(this.camera);const r=this.canvas.getBoundingClientRect();return{x:r.left+(p.x*.5+.5)*r.width,y:r.top+(-p.y*.5+.5)*r.height};}
 setReferenceTime(seconds){this._referenceTime=clamp(+seconds||0,0,23.8);this.phase=this._referenceTime/23.8;this.elapsed=this._referenceTime;this.step(0);this._notify();}
 clearReferenceTime(){if(this._referenceTime!=null){const r=this._referenceData(this._referenceTime);this.phase=r.old===r.next?0:wrap((((r.old+1)%4)+r.sweep)/4);}this._referenceTime=null;this._last=0;}
 _cycleData(phase){const cycle=wrap(phase)*4,stage=Math.floor(cycle);return{old:(stage+3)%4,next:stage,sweep:cycle-stage,winterClock:cycle-3,looping:true};}
 _referenceData(t){const turn=TAU;let r;if(t<Math.PI)r={old:4,next:0,sweep:(Math.PI+t)/turn};else if(t<3*Math.PI)r={old:0,next:1,sweep:(t-Math.PI)/turn};else if(t<5*Math.PI)r={old:1,next:2,sweep:(t-3*Math.PI)/turn};else if(t<7*Math.PI)r={old:2,next:3,sweep:(t-5*Math.PI)/turn};else r={old:3,next:3,sweep:1};return{...r,winterClock:(t-5*Math.PI)/turn,looping:false};}
 setTransitionSoftness(width){if(Number.isFinite(+width)){const value=clamp(+width,.025,.35);this.terrain.uniforms.uTransitionWidth.value=value;this.weatherSystem.uniforms.uTransitionWidth.value=value;}}
 setPhase(v){if(Number.isFinite(+v)){this.phase=wrap(+v);this._notify();}}
 setSpeed(v){if(Number.isFinite(+v)){this.speed=clamp(+v,8,600);this._notify();}}
 setPlaying(v){this.playing=!!v;this._notify();}
 setQuality(v){if(!['high','medium','low'].includes(v))return;this.quality=v;this.terrain.setQuality(v);this.weatherSystem.setQuality(v);this._resize();this._notify();}
 setWeather(v){if(['auto','rain','snow','wind','clear'].includes(v)){this.weather=v;this._notify();}}
 setBackground(v){if(['transparent','dark','desktop'].includes(v)){this.background=v;this.renderer.setClearColor(v==='dark'?0x0c1310:0x000000,v==='dark'?1:0);}}
 _notify(){if(typeof this.onChange==='function')this.onChange(this.state);}
 _resize(){const r=this.canvas.getBoundingClientRect();this.cssWidth=Math.max(1,r.width);this.cssHeight=Math.max(1,r.height);this.dpr=Math.min(window.devicePixelRatio||1,this.quality==='high'?2:this.quality==='medium'?1.5:1);this.renderer.setPixelRatio(this.dpr);this.renderer.setSize(this.cssWidth,this.cssHeight,false);this.camera.aspect=this.cssWidth/this.cssHeight;
  // Preserve the entire disk even on a narrow mobile preview.
  this.camera.clearViewOffset();this.camera.zoom=1.18;
  this.camera.fov=this.camera.aspect<1.65?THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(42/2))*1.65/this.camera.aspect)):42;
  this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
  // Fit the full rotating hand, lawn edge and weather volume, including the
  // near edge which projects lower than the hub. A width-only rule cropped
  // the front edge in a 16:9 recording even when a tall widget looked correct.
  const envelope=[];for(let i=0;i<64;i++){const a=i/64*TAU;for(const [radius,height]of[[5.72,.1],[5.22,.6],[5.35,3.1]])envelope.push(new THREE.Vector3(Math.cos(a)*radius,height,Math.sin(a)*radius));}
  const bounds=()=>{let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;for(const q of envelope){const p=q.clone().project(this.camera);left=Math.min(left,p.x);right=Math.max(right,p.x);bottom=Math.min(bottom,p.y);top=Math.max(top,p.y);}return{left,right,bottom,top};};
  let b=bounds();if(Math.max(-b.left,b.right,-b.bottom,b.top)>.94){this.camera.zoom*=Math.min(1,1.88/(b.right-b.left),1.88/(b.top-b.bottom));this.camera.updateProjectionMatrix();b=bounds();this.camera.setViewOffset(this.cssWidth,this.cssHeight,(b.left+b.right)*this.cssWidth/4,-(b.bottom+b.top)*this.cssHeight/4,this.cssWidth,this.cssHeight);}
  this.terrain.resize(this.cssHeight*this.dpr*this.camera.zoom);this.weatherSystem.resize(this.cssHeight*this.dpr*this.camera.zoom);if(this._referenceTime!=null)this.step(0);}
 _setRay(e){const r=this.canvas.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);return this.raycaster.ray.intersectPlane(this._plane,this._worldHit);}
 _characterHit(e){const targets=this.interactionTargets;return Math.hypot(e.clientX-targets.cat.x,e.clientY-targets.cat.y)<targets.cat.radius||Math.hypot(e.clientX-targets.butterfly.x,e.clientY-targets.butterfly.y)<targets.butterfly.radius||this.raycaster.intersectObjects(this.companion.hitObjects||[],true).length>0;}
 interactAtClient(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return false;const event={clientX:x,clientY:y},point=this._setRay(event);if(!this._characterHit(event))return false;this.interactions++;this.companion.interact(point?.clone());this._notify();return true;}
 _pointerDown(e){if(e.button!==0)return;const p=this._setRay(e);if(this._characterHit(e)){this.interactions++;this.companion.interact(p?.clone());this._notify();e.preventDefault();return;}if(!p||Math.hypot(p.x,p.z)>5.48||Math.hypot(p.x,p.z)<.4)return;this.dragging=true;if(this._referenceTime!=null)this.clearReferenceTime();this._dragQuarter=Math.floor(this.phase*4);this._dragLast=wrap(this.phase*4);this.canvas.setPointerCapture(e.pointerId);this.canvas.style.cursor='grabbing';this._seek(p);e.preventDefault();}
 _pointerMove(e){const p=this._setRay(e);if(this.dragging){if(p)this._seek(p);return;}this.canvas.style.cursor=this._characterHit(e)?'pointer':p&&Math.hypot(p.x,p.z)<5.4?'grab':'default';}
 _pointerUp(){this.dragging=false;this.canvas.style.cursor='grab';}
 _seek(p){const f=wrap(Math.atan2(p.z,p.x)/TAU);const delta=f-this._dragLast;if(delta<-.5)this._dragQuarter++;if(delta>.5)this._dragQuarter--;this._dragLast=f;this.phase=wrap((this._dragQuarter+f)/4);this._notify();}
 _makeHubAndHand(){
  const hub=new THREE.Group();const black=new THREE.MeshStandardMaterial({color:0x020604,roughness:.45,metalness:.22});const gold=new THREE.MeshStandardMaterial({color:0xc9c08b,roughness:.65,metalness:.32});
  const drum=new THREE.Mesh(new THREE.CylinderGeometry(.92,.93,.12,96),black);drum.position.y=.18;hub.add(drum);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.9,.021,8,96),gold);ring.rotation.x=Math.PI/2;ring.position.y=.247;hub.add(ring);
  const face=new THREE.Mesh(new THREE.CircleGeometry(.875,96),new THREE.MeshStandardMaterial({color:0x020403,roughness:.7,metalness:.05}));face.rotation.x=-Math.PI/2;face.position.y=.245;hub.add(face);
  const inner=new THREE.Mesh(new THREE.TorusGeometry(.59,.003,5,80),new THREE.MeshBasicMaterial({color:0x747a64}));inner.rotation.x=Math.PI/2;inner.position.y=.251;hub.add(inner);this.scene.add(hub);
  this._hubFace=face;this._hubInner=inner;this._hubOriginalMaterial=face.material;
  this.hand=new THREE.Group();this.scene.add(this.hand);
  // A flexible reed-like gold shaft and a feather with individual fine barbs.
  const shaftGeometry=new THREE.BufferGeometry(),shaftP=new Float32Array(49*7*3),shaftI=[];for(let j=0;j<48;j++)for(let k=0;k<6;k++){const a=j*7+k;shaftI.push(a,a+1,a+7,a+1,a+8,a+7);}shaftGeometry.setAttribute('position',new THREE.BufferAttribute(shaftP,3));shaftGeometry.setIndex(shaftI);this._shaftGeometry=shaftGeometry;
  this._shaft=new THREE.Mesh(shaftGeometry,new THREE.MeshBasicMaterial({color:0xd7c77e,side:THREE.DoubleSide,toneMapped:false}));this._shaft.frustumCulled=false;this.hand.add(this._shaft);
  const featherGeometry=new THREE.BufferGeometry(),featherP=new Float32Array(26*2*3),featherI=[];for(let j=0;j<25;j++){const a=j*2;featherI.push(a,a+1,a+2,a+1,a+3,a+2);}featherGeometry.setAttribute('position',new THREE.BufferAttribute(featherP,3));featherGeometry.setIndex(featherI);this._featherGeometry=featherGeometry;
  const feather=new THREE.Mesh(featherGeometry,new THREE.MeshBasicMaterial({color:0xe2d58d,side:THREE.DoubleSide,toneMapped:false}));feather.frustumCulled=false;this.hand.add(feather);
  const barbGeometry=new THREE.BufferGeometry();barbGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(84*2*3),3));this._barbGeometry=barbGeometry;const barbs=new THREE.LineSegments(barbGeometry,new THREE.LineBasicMaterial({color:0xe9e3b5,transparent:true,opacity:.58}));barbs.frustumCulled=false;this.hand.add(barbs);
 }
 _shaftPoint(r,t){return new THREE.Vector3(r,.29+Math.sin(r/5.5*Math.PI)*.19,Math.sin(r*.8-t*1.3)*.014*r+Math.sin(r*.55)*.18);}
 setMusicArtwork(uri){
  if(uri===this._musicArtworkURI)return;this._musicArtworkURI=uri;
  const clear=()=>{this._musicTexture?.dispose();this._musicTexture=null;this._musicMaterial?.dispose();this._musicMaterial=null;this._hubFace.material=this._hubOriginalMaterial;this._hubInner.visible=true;};
  if(!uri||!/^data:image\/(jpeg|png|webp);base64,/.test(uri)){clear();return;}
  const img=new Image();img.onload=()=>{if(this.destroyed||this._musicArtworkURI!==uri)return;clear();
   const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d');const edge=Math.min(img.width,img.height);c.drawImage(img,(img.width-edge)/2,(img.height-edge)/2,edge,edge,0,0,512,512);
   this._musicTexture=new THREE.CanvasTexture(canvas);this._musicTexture.colorSpace=THREE.SRGBColorSpace;
   this._musicMaterial=new THREE.MeshBasicMaterial({map:this._musicTexture,toneMapped:false});this._hubFace.material=this._musicMaterial;this._hubInner.visible=false;
  };img.onerror=()=>{if(this._musicArtworkURI===uri)clear();};img.src=uri;
 }
 _updateHand(){const t=this.elapsed,data=this._referenceTime!=null?this._referenceData(this._referenceTime):this._cycleData(this.phase),a=data.sweep*TAU;this.hand.rotation.y=-a;
  const shaft=this._shaftGeometry.attributes.position;for(let j=0;j<49;j++){const r=.86+j/48*4.7,p=this._shaftPoint(r,t);for(let k=0;k<7;k++){const theta=k/6*TAU;shaft.setXYZ(j*7+k,p.x,p.y+Math.cos(theta)*.014,p.z+Math.sin(theta)*.014);}}shaft.needsUpdate=true;
  const fp=this._featherGeometry.attributes.position;for(let j=0;j<26;j++){const f=j/25,r=4.17+f*1.34,p=this._shaftPoint(r,t);let width=Math.pow(Math.sin(Math.PI*f),.8)*.135*(1+.15*Math.sin(j*7.));fp.setXYZ(j*2,p.x,p.y+.004,p.z-width);fp.setXYZ(j*2+1,p.x,p.y+.004,p.z+width*.88);}fp.needsUpdate=true;
  const bp=this._barbGeometry.attributes.position;for(let i=0;i<84;i++){const side=i%2?1:-1,f=(Math.floor(i/2)+1)/43,r=4.17+f*1.34,p=this._shaftPoint(r,t);const width=Math.pow(Math.sin(Math.PI*f),.8)*(.145+.028*Math.sin(i*4.));bp.setXYZ(i*2,p.x-.05,p.y+.008,p.z);bp.setXYZ(i*2+1,p.x+.06,p.y+.008,p.z+side*width);}bp.needsUpdate=true;
 }
 step(deltaSeconds=1/60){if(this.destroyed||this.contextLost)return;const dt=clamp(Number.isFinite(deltaSeconds)?deltaSeconds:1/60,0,.12);if(this._referenceTime!=null){this.elapsed=this._referenceTime;this.phase=this._referenceTime/23.8;}else{this.elapsed+=dt;if(this.playing&&!this.dragging)this.phase=wrap(this.phase+dt/this.speed);}const ref=this._referenceTime!=null?this._referenceData(this._referenceTime):this._cycleData(this.phase);this.terrain.update(this.elapsed,this.phase,this.weather==='wind'?1.8:1,ref);this.weatherSystem.update(this.elapsed,this.phase,this.weather,ref);this.companion.update(this.elapsed,this.phase,this.camera);this._updateHand();this.renderer.render(this.scene,this.camera);this.frame++;}
 _tick(now){if(this.destroyed)return;const raw=this._last?(now-this._last)/1000:1/60;this._last=now;this.fps=this.fps*.95+Math.min(240,1/Math.max(.001,raw))*.05;if(this._referenceTime==null)this.step(raw);if(!this._lastNotify||now-this._lastNotify>200){this._lastNotify=now;this._notify();}this._raf=requestAnimationFrame(this._tick);}
 destroy(){this.destroyed=true;cancelAnimationFrame(this._raf);this._observer.disconnect();for(const [type,fn]of[['pointerdown',this._pointerDown],['pointermove',this._pointerMove],['pointerup',this._pointerUp],['pointercancel',this._pointerUp],['lostpointercapture',this._pointerUp],['webglcontextlost',this._contextLost],['webglcontextrestored',this._contextRestored]])this.canvas.removeEventListener(type,fn);this.scene.traverse(o=>{o.geometry?.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];for(const mat of mats)mat?.dispose();});this.renderer.dispose();}
}
