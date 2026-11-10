import * as THREE from './vendor/three.module.js';
const TAU=Math.PI*2;
function random(seed=8267){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let n=Math.imul(seed^seed>>>15,1|seed);n=n+Math.imul(n^n>>>7,61|n)^n;return((n^n>>>14)>>>0)/4294967296;};}
// Static field samples are computed once per blade, not repeatedly for every GPU vertex.
const fract=v=>v-Math.floor(v);
function fieldNoise(x,y){const ix=Math.floor(x),iy=Math.floor(y);let fx=x-ix,fy=y-iy;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);const hash=(a,b)=>fract(Math.sin(a*127.1+b*311.7)*43758.5453);const a=hash(ix,iy)*(1-fx)+hash(ix+1,iy)*fx,b=hash(ix,iy+1)*(1-fx)+hash(ix+1,iy+1)*fx;return a*(1-fy)+b*fy;}
const COMMON=`
uniform float uReference,uOld,uNext,uSweep,uTransitionWidth,uWinterClock,uLooping;
float oldSeason(float phase){return uReference>.5?uOld:floor(phase*4.);}
float newSeason(float phase){return uReference>.5?uNext:mod(floor(phase*4.)+1.,4.);}

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float seasonMixPrepared(float a,float phase,float field){float front=uReference>.5?uSweep:fract(phase*4.);float width=uTransitionWidth;float rough=(field-.5)*width*.27*smoothstep(0.,.08,front)*(1.-smoothstep(.92,1.,front));float travel=front*(1.+2.*width)-width;if(oldSeason(phase)>3.5){travel=mix(front-width*.55,1.+width*1.2,smoothstep(.982,1.,front));}float eased=smoothstep(a-width+rough,a+width+rough,travel);return eased*eased*(3.-2.*eased);}
float seasonMix(vec2 p,float phase){return seasonMixPrepared(fract(atan(p.y,p.x)/6.2831853),phase,noise(p*1.6));}
vec3 palette(float s){if(s>3.5)return vec3(.0015,.002,.0015);if(s<.5)return vec3(.132,.255,.079);if(s<1.5)return vec3(.053,.185,.012);if(s<2.5)return vec3(.53,.32,.075);return vec3(.34,.405,.57);}
float seasonHeight(float s){if(s>3.5)return 0.;if(s<.5)return .76;if(s<1.5)return 1.;if(s<2.5)return .9;return .22;}
float winter(float s){return step(2.5,s)*(1.-step(3.5,s));}
// Per-position age persists across both the stage seam and the complete-year seam.
// The previous winter remains spatially varied as the spring sweep grows through it.
float winterBladeHeight(float localAngle,float phase){float ageTurns=uWinterClock-localAngle;if(uLooping>.5&&oldSeason(phase)>2.5&&oldSeason(phase)<3.5)ageTurns=mod(ageTurns+4.,4.);float ageSeconds=max(0.,ageTurns*6.2831853);return mix(.86,.22,smoothstep(.55,5.2,ageSeconds));}
float resolvedBladeHeight(float localAngle,float phase,float blend){float old=oldSeason(phase),next=newSeason(phase);float coldHeight=winterBladeHeight(localAngle,phase);float oldHeight=winter(old)>.5?coldHeight:seasonHeight(old);float nextHeight=winter(next)>.5?coldHeight:seasonHeight(next);return mix(oldHeight,nextHeight,blend);}

vec3 windOffset(vec2 root,vec4 blade,float h,float height,float time,float strength,vec4 field,float flex){
 float cluster=field.x;float direction=(cluster-.5)*mix(3.1,8.2,clamp(flex-1.,0.,1.))+sin(root.x*.8+root.y*.6-time*.43)*.55;
 float wave=.5+.5*sin(root.x*1.55+root.y*.85-time*2.6+field.z*1.4);
 float flutter=sin(time*4.8+blade.w*20.+root.x*6.);
 float bend=(.075+wave*.47+sin(root.x*3.4-root.y*1.7-time*3.7)*.13+flutter*.07)*strength*flex;
 vec2 flow=vec2(cos(direction),sin(direction));vec2 individual=vec2(cos(blade.z),sin(blade.z))*.11;
 vec2 lateral=(flow*bend+individual)*height*h*h;
 float curl=sin(h*4.1+cluster*5.5+time*.65)*h*h*height*.24*max(0.,flex-.6);lateral+=flow*curl+vec2(-flow.y,flow.x)*sin(time*2.+blade.w*17.)*height*.07*h*h*h;
 return vec3(lateral.x,height*(h-h*h*.12*bend)-abs(curl)*.25,lateral.y);
}
`;
export function createTerrain(){
 const group=new THREE.Group(), rng=random(), uniforms={uTime:{value:0},uPhase:{value:0},uWind:{value:1},uReference:{value:0},uOld:{value:0},uNext:{value:1},uSweep:{value:0},uTransitionWidth:{value:.18},uWinterClock:{value:0},uLooping:{value:1}};
 const base=new THREE.Mesh(new THREE.CylinderGeometry(5.055,5.065,.13,192),new THREE.MeshStandardMaterial({color:0x080d0a,roughness:.85,metalness:.15}));base.position.y=-.075;group.add(base);
 const rim=new THREE.Mesh(new THREE.TorusGeometry(5.025,.015,6,192),new THREE.MeshStandardMaterial({color:0x627053,roughness:.8}));rim.rotation.x=Math.PI/2;rim.position.y=.005;group.add(rim);
 const groundMaterial=new THREE.ShaderMaterial({uniforms,vertexShader:`uniform float uPhase; varying vec3 vP; varying float vSnow;${COMMON}
 void main(){vec3 p=position;float s=oldSeason(uPhase);float blend=seasonMix(p.xz,uPhase);vSnow=mix(winter(s),winter(newSeason(uPhase)),blend);p.y+=vSnow*(.025+.075*noise(p.xz*2.8)+.022*noise(p.xz*11.));vP=p;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
 fragmentShader:`uniform float uPhase; varying vec3 vP;varying float vSnow;${COMMON}
 void main(){float s=oldSeason(uPhase);float blend=seasonMix(vP.xz,uPhase);vec3 color=mix(palette(s),palette(newSeason(uPhase)),blend);float grain=vSnow>.01?noise(vP.xz*130.):.5;float broad=vSnow>.01?noise(vP.xz*3.2):.5;color*=mix(.34,1.0,vSnow);color*=.87+grain*.055+broad*.17;float bumps=vSnow>.01?(noise(vP.xz*9.)-.5)*.07:0.;color+=vec3(bumps*vSnow);gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
 const groundGeo=new THREE.BufferGeometry(),groundVertices=[0,0,0],groundIndices=[],rings=48,slices=192;
 for(let j=1;j<=rings;j++)for(let i=0;i<slices;i++){const a=i/slices*TAU,r=j/rings*5.01;groundVertices.push(Math.cos(a)*r,0,Math.sin(a)*r);}
 for(let i=0;i<slices;i++)groundIndices.push(0,1+(i+1)%slices,1+i);
 for(let j=1;j<rings;j++)for(let i=0;i<slices;i++){const a=1+(j-1)*slices+i,b=1+(j-1)*slices+(i+1)%slices,c=1+j*slices+i,d=1+j*slices+(i+1)%slices;groundIndices.push(a,b,c,b,d,c);}
 groundGeo.setAttribute('position',new THREE.Float32BufferAttribute(groundVertices,3));groundGeo.setIndex(groundIndices);const ground=new THREE.Mesh(groundGeo,groundMaterial);group.add(ground);
 const tickGeo=new THREE.BoxGeometry(.024,.018,.087),tickMat=new THREE.MeshStandardMaterial({color:0xd1d3b7,roughness:.8});
 const ticks=new THREE.InstancedMesh(tickGeo,tickMat,84), dummy=new THREE.Object3D();for(let i=0;i<84;i++){const a=i/84*TAU;dummy.position.set(Math.sin(a)*5.03,.002,-Math.cos(a)*5.03);dummy.rotation.y=-a;dummy.scale.set(i%7?1:1.65,1,i%7?1:1.3);dummy.updateMatrix();ticks.setMatrixAt(i,dummy.matrix);}group.add(ticks);
 const baseDark=base.material.color.clone(),baseSnow=new THREE.Color(0x63728c),rimDark=rim.material.color.clone(),rimSnow=new THREE.Color(0xa5b1c8),tickDark=tickMat.color.clone(),tickSnow=new THREE.Color(0xdde6f1);
 // Every blade is real articulated GPU geometry. No baked grass image is animated.
 const bladeCount=125000,segments=5,positions=[],uvs=[],indices=[];
 for(let j=0;j<=segments;j++){let y=j/segments,wide=Math.pow(1-y,.65);positions.push(-.5*wide,y,0,.5*wide,y,0);uvs.push(0,y,1,y);if(j<segments){const a=j*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}}
 const geometry=new THREE.InstancedBufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);
 const offsets=new Float32Array(bladeCount*2),data=new Float32Array(bladeCount*4),fields=new Float32Array(bladeCount*4),fields2=new Float32Array(bladeCount*3);
 for(let i=0;i<bladeCount;i++){const a=rng()*TAU,r=Math.sqrt(.94*.94+rng()*(4.994*4.994-.94*.94));offsets[i*2]=Math.sin(a)*r;offsets[i*2+1]=Math.cos(a)*r;data[i*4]=.22+rng()*.30;data[i*4+1]=.0045+rng()*.007;data[i*4+2]=rng()*TAU;data[i*4+3]=rng();}
 for(let i=0;i<bladeCount;i++){const x=offsets[i*2],z=offsets[i*2+1];fields.set([fieldNoise(x*1.45,z*1.45),fieldNoise(x*2.6,z*2.6),fieldNoise(x*1.1,z*1.1),fieldNoise(x*.7,z*.7)],i*4);fields2.set([fieldNoise(x*1.6,z*1.6),fieldNoise(x*.85+7.2,z*.85+2),fract(Math.atan2(z,x)/TAU)],i*3);}
 geometry.setAttribute('aField',new THREE.InstancedBufferAttribute(fields,4));geometry.setAttribute('aField2',new THREE.InstancedBufferAttribute(fields2,3));
 geometry.setAttribute('aOffset',new THREE.InstancedBufferAttribute(offsets,2));geometry.setAttribute('aBlade',new THREE.InstancedBufferAttribute(data,4));geometry.instanceCount=bladeCount;
 const grassMaterial=new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms,vertexShader:`
 attribute vec2 aOffset;attribute vec4 aBlade;attribute vec4 aField;attribute vec3 aField2;uniform float uTime,uPhase,uWind;varying vec3 vColor;varying float vH;varying float vSeed;varying float vWidth;${COMMON}
 void main(){float season=oldSeason(uPhase);float blend=seasonMixPrepared(aField2.z,uPhase,aField2.x);float next=newSeason(uPhase);float snow=mix(winter(season),winter(next),blend);float height=aBlade.x*resolvedBladeHeight(aField2.z,uPhase,blend)*smoothstep(.94,1.13,length(aOffset))*(.75+.45*aField.y);vec3 p=vec3(aOffset.x,0.,aOffset.y);float h=position.y;
 float direction=aBlade.z;vec2 side=vec2(cos(direction),sin(direction));p.xz+=side*position.x*aBlade.y;
 float wave=sin(aOffset.x*1.55+aOffset.y*.85-uTime*2.6)*.5+.5;float wave2=sin(aOffset.x*3.4-aOffset.y*1.7-uTime*3.7);float small=sin(uTime*4.8+aBlade.w*20.+aOffset.x*6.);float bend=(.07+wave*.39+wave2*.13+small*.08)*uWind;
 p+=windOffset(aOffset,aBlade,h,height,uTime,uWind,aField,mix(season>1.5&&season<2.5?1.85:.8,next>1.5&&next<2.5?1.85:.8,blend));p.y+=snow*.025;
 vColor=mix(palette(season),palette(next),blend);float fiberLight=.84+.20*abs(dot(normalize(vec3(-sin(direction),bend*.35,cos(direction))),normalize(vec3(-.4,.8,.3))));
 vColor*=(.70+aBlade.w*.52)*(.83+wave*.22)*fiberLight*(.89+aField.w*.22)*(.88+.17*smoothstep(-4.,4.,aOffset.x)+.1*smoothstep(-4.,4.,aOffset.y));vH=h;vSeed=aBlade.w;vWidth=uv.x;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
 fragmentShader:`varying vec3 vColor;varying float vH;varying float vSeed;varying float vWidth;void main(){float fiber=.86+.14*sin(vWidth*3.1415926);vec3 color=vColor*mix(.34,1.14,pow(vH,.65))*fiber;color+=vec3(.048,.057,.048)*pow(vH,3.)*(.25+vSeed*.65);gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
 const grass=new THREE.Mesh(geometry,grassMaterial);grass.frustumCulled=false;group.add(grass);
 // Luminous dew/flower-tip points are attached to selected actual blades. Their
 // phase, growth and wind math is shared, so they never float as a sky backdrop.
 const tipCount=5600,flowersGeo=new THREE.BufferGeometry(),flowerP=new Float32Array(tipCount*3),flowerData=new Float32Array(tipCount*4),tipRandom=new Float32Array(tipCount),tipField=new Float32Array(tipCount*4),tipField2=new Float32Array(tipCount*3);
 for(let i=0;i<tipCount;i++){const index=Math.floor(i/tipCount*bladeCount);flowerP.set([offsets[index*2],0,offsets[index*2+1]],i*3);flowerData.set(data.slice(index*4,index*4+4),i*4);tipRandom[i]=rng();tipField.set(fields.slice(index*4,index*4+4),i*4);tipField2.set(fields2.slice(index*3,index*3+3),i*3);}
 flowersGeo.setAttribute('aField',new THREE.BufferAttribute(tipField,4));flowersGeo.setAttribute('aField2',new THREE.BufferAttribute(tipField2,3));flowersGeo.setAttribute('position',new THREE.BufferAttribute(flowerP,3));flowersGeo.setAttribute('aBlade',new THREE.BufferAttribute(flowerData,4));flowersGeo.setAttribute('aSeed',new THREE.BufferAttribute(tipRandom,1));
 const flowerUniform={...uniforms,uScale:{value:700}};
 const flowerMat=new THREE.ShaderMaterial({uniforms:flowerUniform,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexShader:`uniform float uTime,uPhase,uScale,uWind;attribute vec4 aBlade;attribute vec4 aField;attribute vec3 aField2;attribute float aSeed;varying float vA;varying vec3 vGlow;${COMMON}
 float tipPopulation(float s){if(s>3.5)return 0.;if(s<.5)return .97;if(s<1.5)return .24;if(s<2.5)return .49;return .12;}
 vec3 tipColor(float s){return s>1.5&&s<2.5?vec3(1.,.86,.53):vec3(.90,.98,1.);}
 void main(){vec2 root=position.xz;float season=oldSeason(uPhase),next=newSeason(uPhase),blend=seasonMixPrepared(aField2.z,uPhase,aField2.x);float population=mix(tipPopulation(season),tipPopulation(next),blend);
 float height=aBlade.x*resolvedBladeHeight(aField2.z,uPhase,blend)*smoothstep(.94,1.13,length(root))*(.75+.45*aField.y);float snow=mix(winter(season),winter(next),blend);
 float wave=sin(root.x*1.55+root.y*.85-uTime*2.6)*.5+.5;float wave2=sin(root.x*3.4-root.y*1.7-uTime*3.7);float small=sin(uTime*4.8+aBlade.w*20.+root.x*6.);float bend=(.07+wave*.39+wave2*.13+small*.08)*uWind;
 vec3 p=position+windOffset(root,aBlade,1.,height,uTime,uWind,aField,mix(season>1.5&&season<2.5?1.85:.8,next>1.5&&next<2.5?1.85:.8,blend));p.y+=snow*.025+.009;
 float glint=.56+.44*pow(.5+.5*sin(uTime*(1.4+aSeed*2.)+aBlade.z*3.+wave*2.),3.);float clusterPopulation=population*(.60+.40*aField2.y);float available=1.-smoothstep(clusterPopulation-.08,clusterPopulation+.08,aSeed);vA=available*glint*(.62+aBlade.w*.38)*smoothstep(0.,.025,population);vGlow=mix(tipColor(season),tipColor(next),blend);
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((.042+aBlade.w*.026)*uScale/(-mv.z),2.,13.);}`,
 fragmentShader:`varying float vA;varying vec3 vGlow;void main(){vec2 p=gl_PointCoord-.5;float r=length(p);if(r>.5||vA<.008)discard;float core=1.-smoothstep(.055,.155,r);float halo=exp(-r*r*29.)*.22;float alpha=(core+halo)*vA;gl_FragColor=vec4(vGlow,alpha);}`});
 const flowers=new THREE.Points(flowersGeo,flowerMat);flowers.frustumCulled=false;flowers.renderOrder=2;group.add(flowers);

 return {group,ground,grass,uniforms,update(time,phase,wind,ref){uniforms.uTime.value=time;uniforms.uPhase.value=phase;uniforms.uWind.value=wind;let snowCover=ref?((ref.old===3?1-ref.sweep:0)+(ref.next===3?ref.sweep:0)):0;base.material.color.copy(baseDark).lerp(baseSnow,snowCover);rim.material.color.copy(rimDark).lerp(rimSnow,snowCover);tickMat.color.copy(tickDark).lerp(tickSnow,snowCover);base.scale.y=1+.45*snowCover;base.position.y=-.075-.02925*snowCover;uniforms.uReference.value=ref?1:0;if(ref){uniforms.uOld.value=ref.old;uniforms.uNext.value=ref.next;uniforms.uSweep.value=ref.sweep;uniforms.uWinterClock.value=ref.winterClock??phase*4-3;uniforms.uLooping.value=ref.looping?1:0;}},setQuality(q){geometry.instanceCount=q==='high'?125000:q==='medium'?85000:45000;},resize(height){flowerUniform.uScale.value=height*1.17;}};
}
export function createWeather(){
 const group=new THREE.Group(),rng=random(128),count=3400;
 const p=new Float32Array(count*3),seeds=new Float32Array(count*3);
 for(let i=0;i<count;i++){let a=rng()*TAU,r=Math.sqrt(rng())*5.;p.set([Math.sin(a)*r,0,Math.cos(a)*r],i*3);seeds.set([rng(),rng(),rng()],i*3);}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(p,3));geo.setAttribute('aSeed',new THREE.BufferAttribute(seeds,3));
 const uniforms={uTime:{value:0},uSnow:{value:0},uSeed:{value:0},uScale:{value:700},uDensity:{value:1},uPhase:{value:0},uReference:{value:0},uOld:{value:0},uNext:{value:1},uSweep:{value:0},uTransitionWidth:{value:.18},uManual:{value:0}};
 const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms,vertexShader:`uniform float uTime,uSnow,uSeed,uScale,uDensity,uPhase,uManual;attribute vec3 aSeed;varying float vAlpha;varying float vKind;varying float vShape;varying float vRotation;${COMMON}
 float autumn(float s){return step(1.5,s)*(1.-step(2.5,s));}
 void main(){float season=oldSeason(uPhase),next=newSeason(uPhase),blend=seasonMix(position.xz,uPhase);float snowArea=mix(winter(season),winter(next),blend);float seedArea=mix(autumn(season),autumn(next),blend)*.85;float kind=uManual>.5?uSnow:snowArea/(snowArea+seedArea+.001);float amount=uManual>.5?max(uSnow,uSeed):max(snowArea,seedArea);
 float enabledParticle=(1.-smoothstep(amount*uDensity-.06,amount*uDensity+.06,aSeed.z))*smoothstep(0.,.03,amount);float loop=fract(aSeed.x+uTime*(.10+aSeed.y*.15));vec3 p=position;float plume=mix(1.16,2.1,kind)+kind*(1.-smoothstep(-4.,4.,position.x))*.7;p.y=(1.-loop)*plume+mix(.12,.03,kind);p.x+=sin(uTime*.9+aSeed.y*20.+loop*4.)*.22;p.z+=cos(uTime*.7+aSeed.x*20.)*.10;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((.028+aSeed.y*.039)*uScale/(-mv.z),1.5,9.);vAlpha=enabledParticle*(.65+aSeed.x*.35)*smoothstep(0.,.08,loop)*(1.-smoothstep(.88,1.,loop));vKind=kind;vShape=aSeed.x;vRotation=uTime*(.35+aSeed.y)+aSeed.z*6.283;}`,

 fragmentShader:`varying float vAlpha;varying float vKind;varying float vShape;varying float vRotation;void main(){vec2 p=gl_PointCoord-.5;float cs=cos(vRotation),sn=sin(vRotation);p=mat2(cs,-sn,sn,cs)*p;float thin=mix(.43,.68,vShape)*mix(.82,1.,vKind);float r=length(vec2(p.x/thin,p.y));if(r>.5)discard;float a=(1.-smoothstep(.30,.5,r))*vAlpha;vec3 c=mix(vec3(1.,.975,.865),vec3(.94,.97,1.),vKind);gl_FragColor=vec4(c,a);}`});
 const snow=new THREE.Points(geo,mat);snow.frustumCulled=false;group.add(snow);
 const rainCount=800,raingeo=new THREE.BufferGeometry(),rp=new Float32Array(rainCount*6),rs=new Float32Array(rainCount*6),ends=new Float32Array(rainCount*2);
 for(let i=0;i<rainCount;i++){let a=rng()*TAU,r=Math.sqrt(rng())*4.97,x=Math.sin(a)*r,z=Math.cos(a)*r,s1=rng(),s2=rng(),s3=rng();for(let k=0;k<2;k++){rp.set([x,0,z],i*6+k*3);rs.set([s1,s2,s3],i*6+k*3);ends[i*2+k]=k;}}
 raingeo.setAttribute('position',new THREE.BufferAttribute(rp,3));raingeo.setAttribute('aSeed',new THREE.BufferAttribute(rs,3));raingeo.setAttribute('aEnd',new THREE.BufferAttribute(ends,1));
 const rainUniform={uTime:uniforms.uTime,uRain:{value:0},uDensity:uniforms.uDensity};
 const rainMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:rainUniform,vertexShader:`attribute vec3 aSeed;attribute float aEnd;uniform float uTime,uRain,uDensity;varying float vA;void main(){float f=fract(aSeed.x+uTime*(1.5+aSeed.y));vec3 p=position;p.y=(1.-f)*2.4+aEnd*(.09+aSeed.y*.12);p.x-=p.y*.11;vA=step(aSeed.z,uRain*uDensity)*(.16+aSeed.y*.25);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
 fragmentShader:`varying float vA;void main(){gl_FragColor=vec4(.70,.83,.90,vA);}`});const rain=new THREE.LineSegments(raingeo,rainMat);rain.frustumCulled=false;group.add(rain);
 // Ripples expand on the horizontal surface; their height is fixed to the disk.
 const rippleGeo=new THREE.InstancedBufferGeometry();const ring=new THREE.RingGeometry(.83,1,20);ring.rotateX(-Math.PI/2);rippleGeo.index=ring.index;rippleGeo.attributes.position=ring.attributes.position;rippleGeo.attributes.uv=ring.attributes.uv;
 const rippleOffsets=new Float32Array(180*3);for(let i=0;i<180;i++){let a=rng()*TAU,r=Math.sqrt(rng())*4.8;rippleOffsets.set([Math.sin(a)*r,Math.cos(a)*r,rng()],i*3);}rippleGeo.setAttribute('aRipple',new THREE.InstancedBufferAttribute(rippleOffsets,3));rippleGeo.instanceCount=180;
 const rippleMat=new THREE.ShaderMaterial({uniforms:rainUniform,transparent:true,depthWrite:false,side:THREE.DoubleSide,vertexShader:`attribute vec3 aRipple;uniform float uTime,uRain;varying float vA;void main(){float f=fract(uTime*1.8+aRipple.z);vec3 p=position*(.018+f*.095);p+=vec3(aRipple.x,.035,aRipple.y);vA=(1.-f)*.45*uRain;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
 fragmentShader:`varying float vA;void main(){gl_FragColor=vec4(.72,.87,.94,vA);}`});const ripple=new THREE.Mesh(rippleGeo,rippleMat);ripple.frustumCulled=false;group.add(ripple);
 return {group,uniforms,update(time,phase,mode,ref){uniforms.uTime.value=time;uniforms.uPhase.value=phase;uniforms.uReference.value=ref?1:0;uniforms.uManual.value=mode==='auto'?0:1;if(ref){uniforms.uOld.value=ref.old;uniforms.uNext.value=ref.next;uniforms.uSweep.value=ref.sweep;}let weights=[0,0,0,0],v=phase*4,s=Math.floor(v)%4,f=v%1;weights[s]=1-f;weights[(s+1)%4]=f;if(ref){weights=[0,0,0,0];if(ref.old<4)weights[ref.old]=1-ref.sweep;weights[ref.next]=ref.sweep;}uniforms.uSnow.value=mode==='auto'?weights[3]:mode==='snow'?1:0;uniforms.uSeed.value=mode==='auto'?weights[2]*.9+weights[1]*.12:mode==='wind'?.9:0;rainUniform.uRain.value=mode==='rain'?1:0;},resize(h){uniforms.uScale.value=h*1.17;},setQuality(q){uniforms.uDensity.value=q==='high'?1:q==='medium'?.72:.45;}};
}
