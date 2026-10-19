import * as THREE from './three.module.js';
import {createCollapseField} from './universe-collapse.js?v=20261019-restored';

// Original parametric throat: a broad curved sheet falls into a displaced void.
const vertex=`
 uniform float uTime; uniform vec2 uPointer; varying vec2 vUv; varying float vDepth;
 varying vec3 vViewPosition;
 void main(){
  vUv=uv;float a=uv.x*6.283185;float d=uv.y;
  float r=.20+2.65*pow(d,1.65);
  r+=sin(a*3.+uTime*.20+d*2.)*.055*pow(d,1.5);
  vec3 p=vec3(cos(a)*r,sin(a)*r,-1.9*pow(1.-d,1.18));
  p.x+=.46*pow(1.-d,1.2);p.y+=.13*sin(d*3.+uTime*.13)*d;
  p.z+=sin(a*2.+uTime*.17)*.12*d*d;
  float attraction=exp(-length(p.xy-uPointer*2.)*1.8);
  p.z+=attraction*.14*d;
  vDepth=d;vec4 viewPosition=modelViewMatrix*vec4(p,1.);
  vViewPosition=viewPosition.xyz;gl_Position=projectionMatrix*viewPosition;
 }`;
const fragment=`
 uniform float uTime;uniform float uLight;varying vec2 vUv;varying float vDepth;
 varying vec3 vViewPosition;
 float grid(float value){float w=max(fwidth(value),.005);return 1.-smoothstep(w*.12,w*.78,abs(fract(value-.5)-.5));}
 vec4 pointSeed(vec2 cell){
  vec4 h=fract(vec4(cell.xy,cell.xy)*vec4(.1031,.1030,.0973,.1099));
  h+=dot(h,h.wzxy+33.33);
  return fract((h.xxyz+h.yzzw)*h.zywx);
 }
 float scatteredLight(vec2 point,float columns){
  vec2 cell=floor(point);float glow=0.;
  for(int row=-1;row<=1;row++)for(int column=-1;column<=1;column++){
   vec2 neighbor=cell+vec2(float(column),float(row));
   // Wrap only the seed so the two sides of the circular surface match.
   vec4 seed=pointSeed(vec2(mod(neighbor.x,columns),neighbor.y));
   vec2 delta=point-neighbor-(.12+.76*seed.xy);
   float size=.075+.045*seed.w;
   vec2 shape=delta/vec2(size*.8,size*1.3);
   float breath=.80+.20*sin(uTime*(.12+seed.z*.06)+seed.w*6.283185);
   float spot=exp(-2.*dot(shape,shape))*(1.-smoothstep(.27,.40,length(delta)));
   glow+=spot*step(.58,seed.z)*(.68+.32*seed.w)*breath;
  }
  return min(glow,1.);
 }
 void main(){
  float d=vDepth,a=vUv.x*6.283185;
  float spiral=vUv.x*88.+pow(1.-d,1.8)*7.+sin(a*2.+uTime*.16)*.12+uTime*.025;
  float radial=grid(spiral);
  // Positive time advances each fixed phase toward smaller depth: inward.
  float rings=grid(d*36.+uTime*.40);
  // Stable random positions drift inward; no per-frame randomness or flashing.
  float columns=mix(12.,19.,uLight);
  vec2 lightPoint=vec2(vUv.x*columns+pow(1.-d,1.8)*1.43,(d+uTime*.028)*mix(2.,2.4,uLight));
  float flow=scatteredLight(lightPoint,columns)*smoothstep(mix(.09,.04,uLight),mix(.24,.18,uLight),d)*mix(.62,1.,uLight);
  // Light grazes the curved weave; the inner turns gradually disappear in depth.
  vec3 normal=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));
  vec3 eye=normalize(-vViewPosition);
  float grazing=pow(1.-abs(dot(normal,eye)),2.4);
  float illumination=abs(dot(normal,normalize(vec3(-.45,.8,1.2))));
  float depthReveal=smoothstep(.015,.29,d);
  float lattice=max(radial*.33,rings*.74)*mix(.16,1.,depthReveal);
  vec3 pearl=.59+.30*cos(a+d*2.5+uTime*.045+vec3(.25,2.2,4.2));
  vec3 base=mix(vec3(.025,.028,.044),vec3(.44,.45,.54),pow(d,.85));
  base=mix(base,pearl,.24*depthReveal);
  vec3 silver=mix(vec3(.32,.36,.44),vec3(.84,.88,.91),illumination*.56+grazing*.44);
  vec3 line=mix(silver,pearl,.78)*mix(.38,1.,depthReveal);
  // A diffuse, uneven sheen avoids the silhouette of three rotating blades.
  float folds=smoothstep(.52,.94,.5+.26*sin(a+d*4.+uTime*.025)+.24*sin(a*2.-d*5.-uTime*.018));
  folds*=smoothstep(.12,.28,d)*(1.-smoothstep(.70,.94,d));
  vec3 spectral=.63+.22*cos(a+vec3(.2,2.3,4.4));
  float throatRim=exp(-pow((d-.07)*34.,2.));
  vec3 color=mix(base,line,lattice*.90)+pearl*flow*.48+spectral*folds*.025+pearl*throatRim*.025;
  float outer=1.-smoothstep(.70,1.,d);
  // Slightly stronger weave contrast on the light page; keep the soft edge.
  float alpha=(.032+pow(1.-d,2.)*.24+lattice*mix(.72,1.,uLight)+grazing*.05*depthReveal+flow*.32+folds*.012)*outer;
  color=mix(color,color*.54,uLight*.6);
  gl_FragColor=vec4(color,alpha);
  #include <colorspace_fragment>
 }`;

const coreVertex=`
 varying vec2 vUv;
 void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const coreFragment=`
 uniform float uLight;varying vec2 vUv;
 void main(){
  float radius=length(vUv-.5)*2.;
  vec3 center=mix(vec3(.0015,.002,.003),vec3(.017,.016,.026),uLight);
  vec3 edge=mix(vec3(.004,.005,.007),vec3(.036,.032,.05),uLight);
  gl_FragColor=vec4(mix(center,edge,smoothstep(.1,1.,radius)),1.);
  #include <colorspace_fragment>
 }`;

export function createUniverseScene({canvas,stage}){
 let disposed=false;
 const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
 renderer.setClearColor(0x000000,0);renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.5));
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,30);
 camera.position.z=8.8;
 const geometry=new THREE.PlaneGeometry(1,1,220,85);
 const uniforms={uTime:{value:0},uLight:{value:0},uPointer:{value:new THREE.Vector2()}};
 const material=new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,side:THREE.DoubleSide,depthWrite:false});
 const sheet=new THREE.Mesh(geometry,material);sheet.frustumCulled=false;
 const sculpture=new THREE.Group();sculpture.add(sheet);scene.add(sculpture);
 sculpture.scale.setScalar(.74);
 const voidGeometry=new THREE.CircleGeometry(.202,96),voidMaterial=new THREE.ShaderMaterial({uniforms,vertexShader:coreVertex,fragmentShader:coreFragment,side:THREE.DoubleSide});
 const core=new THREE.Mesh(voidGeometry,voidMaterial);core.position.set(.46,0,-1.905);sculpture.add(core);
 const collapse=createCollapseField(),throat=new THREE.Vector3();scene.add(collapse.mesh);
 function resize(){
  const rect=canvas.parentElement.getBoundingClientRect(),bounds=stage.getBoundingClientRect(),width=Math.max(1,rect.width),height=Math.max(1,rect.height);
  camera.aspect=width/height;camera.position.z=width/height<1.1?10.1:8.8;camera.updateProjectionMatrix();renderer.setSize(width,height,false);
  collapse.resize(width,height,[(bounds.left-rect.left)/width*2-1,1-(bounds.bottom-rect.top)/height*2,(bounds.right-rect.left)/width*2-1,1-(bounds.top-rect.top)/height*2]);
 }
 function draw({time=0,x=0,y=0,progress=0}={}){
  if(disposed)return;
  const light=stage.ownerDocument.body.dataset.theme==='light';uniforms.uTime.value=time;uniforms.uLight.value=light?1:0;
  uniforms.uPointer.value.set(x,-y);
  sculpture.rotation.set(-.52+y*.08+Math.sin(time*.065)*.032,-.35+x*.11,-.32+Math.sin(time*.045)*.028+progress*.035);
  sculpture.position.set(.36,Math.sin(time*.13)*.045,0);
  sculpture.updateMatrixWorld(true);camera.updateMatrixWorld();
  core.getWorldPosition(throat).project(camera);collapse.draw(time,throat,light);
  renderer.render(scene,camera);
 }
 function dispose(){
  if(disposed)return;disposed=true;geometry.dispose();material.dispose();voidGeometry.dispose();voidMaterial.dispose();collapse.dispose();renderer.dispose();renderer.forceContextLoss();
 }
 resize();return {draw,resize,dispose};
}
