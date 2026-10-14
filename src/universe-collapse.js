import * as THREE from '/vendor/three.module.js';

// Sparse screen-space ribbons let the attraction reach far beyond the sculpture.
// All paths end at the projected throat, including while the sculpture tilts.
const vertex=`
 uniform float uTime;uniform vec2 uCenter;uniform vec2 uViewport;
 attribute vec4 aLane;varying vec2 vRibbon;varying float vOpacity;varying float vTint;
 varying float vFamily;varying vec2 vClipPosition;
 vec2 path(float radius,float angle){
  float family=mod(aLane.x,3.);
  float turn=family<.5?.38:family<1.5?-.56:.82;
  float bend=angle+turn*pow(1.-min(radius,1.),1.7);
  vec2 position=uCenter+vec2(cos(bend)*1.65,sin(bend)*1.42)*radius;
  // A few parallel traces separate gently, then resolve to the same throat.
  float separation=pow(sin(clamp(radius/1.45,0.,1.)*3.14159),1.4)*.022*aLane.w;
  return position+vec2(-sin(bend),cos(bend))*separation;
 }
 void main(){
  float seed=aLane.y;
  float family=mod(aLane.x,3.);
  // Three loose arrivals, followed by a quiet interval; never dependent on input.
  float age=mod(uTime+1.7,20.)-aLane.z-seed*1.7;
  float duration=6.3+family*.35+seed*.85;
  float progress=clamp(age/duration,0.,1.);
  float head=1.18*(1.-pow(progress,1.55+family*.18));
  float tail=min(1.45,head+.22+.065*sin(progress*3.14159));
  float radius=mix(head,tail,uv.x);
  float angle=aLane.x*2.399963+seed*.22+.035*sin(uTime*.045+family*2.1);
  vec2 center=path(radius,angle);
  vec2 tangent=normalize((path(radius+.002,angle)-center)*uViewport);
  vec2 normal=vec2(-tangent.y,tangent.x);
  float width=(2.1+seed*1.5)*sin(3.14159*uv.x)*mix(1.,.65,abs(aLane.w));
  center+=normal*position.y*width*2./uViewport;
  vRibbon=vec2(uv.x,position.y);vTint=seed;vFamily=family;
  vOpacity=smoothstep(0.,1.3,age)*(1.-smoothstep(duration-.95,duration,age))*mix(1.,.28,abs(aLane.w));
  vClipPosition=center;
  gl_Position=vec4(center,0.,1.);
 }`;
const fragment=`
 uniform float uLight;varying vec2 vRibbon;varying float vOpacity;varying float vTint;
 varying float vFamily;varying vec2 vClipPosition;uniform vec2 uViewport;uniform vec4 uClipBounds;
 void main(){
  float soft=exp(-vRibbon.y*vRibbon.y*4.);
  float thread=exp(-vRibbon.y*vRibbon.y*24.);
  float lengthFade=sin(vRibbon.x*3.14159)*pow(1.-vRibbon.x,.45);
  vec3 dusk=vFamily<.5?vec3(.24,.43,.58):vFamily<1.5?vec3(.51,.33,.64):vec3(.59,.43,.28);
  vec3 pearl=vFamily<.5?vec3(.54,.78,.91):vFamily<1.5?vec3(.78,.63,.94):vec3(.94,.80,.59);
  pearl=mix(pearl,vec3(.9,.92,.96),vTint*.15);
  vec3 color=mix(mix(pearl,vec3(.75,.79,.85),.24),dusk,uLight);
  float glint=exp(-pow((vRibbon.x-.20)*18.,2.));
  vec2 edgeDistance=min(vClipPosition-uClipBounds.xy,uClipBounds.zw-vClipPosition)*uViewport*.5;
  float edgeFade=smoothstep(0.,min(95.,min(uViewport.x,uViewport.y)*.13),min(edgeDistance.x,edgeDistance.y));
  float alpha=vOpacity*lengthFade*(soft*.12+thread*(.52+glint*.20))*edgeFade;
  gl_FragColor=vec4(color,alpha);
  #include <colorspace_fragment>
 }`;

export function createCollapseField(){
 const positions=[],uvs=[],lanes=[],indices=[],segments=64,count=24;
 for(let lane=0;lane<count;lane++){
  const seed=(Math.sin(lane*127.1+31.7)*43758.5453)%1;
  const random=seed-Math.floor(seed),offset=[0,3.2,6.8][lane%3];
  for(const echo of lane%4===0?[-1,0,1]:[0]){
   const base=positions.length/3;
   for(let step=0;step<=segments;step++)for(const side of [-1,1]){
    positions.push(0,side,0);uvs.push(step/segments,(side+1)/2);lanes.push(lane,random,offset,echo);
   }
   for(let step=0;step<segments;step++){const a=base+step*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
 geometry.setAttribute('aLane',new THREE.Float32BufferAttribute(lanes,4));geometry.setIndex(indices);
 const uniforms={uTime:{value:0},uLight:{value:0},uCenter:{value:new THREE.Vector2()},uViewport:{value:new THREE.Vector2(1,1)},uClipBounds:{value:new THREE.Vector4(-1,-1,1,1)}};
 const material=new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
 const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=2;
 return {mesh,resize(width,height,bounds){uniforms.uViewport.value.set(width,height);uniforms.uClipBounds.value.fromArray(bounds);},draw(time,center,light){uniforms.uTime.value=time;uniforms.uCenter.value.set(center.x,center.y);uniforms.uLight.value=light?1:0;},dispose(){geometry.dispose();material.dispose();}};
}
