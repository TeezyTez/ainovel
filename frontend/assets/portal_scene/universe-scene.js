import * as THREE from './three.module.js';
import {worlds, sampleRoute, travelerAt} from './universe-paths.js?v=20261019-parallel';

// Four quiet spacetime slices, one connected journey and one possible detour.
// Geometry is allocated at mount; frames update transforms and uniforms.
const lineVertex = `
 attribute float strength; varying float vStrength; varying float vAcross;
 void main(){
  vStrength=strength; vAcross=clamp((position.x+2.)/4.,0.,1.);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
 }`;
const lineFragment = `
 uniform float uLight; uniform float uOpacity;
 varying float vStrength; varying float vAcross;
 void main(){
  vec3 violet=mix(vec3(.66,.60,.79),vec3(.43,.36,.56),uLight);
  vec3 teal=mix(vec3(.49,.72,.72),vec3(.32,.53,.54),uLight);
  gl_FragColor=vec4(mix(violet,teal,vAcross),vStrength*uOpacity);
  #include <colorspace_fragment>
 }`;

export function createUniverseScene({canvas, stage}) {
  let disposed = false;
  const renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true, powerPreference:'low-power'});
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene(), sculpture = new THREE.Group();
  const camera = new THREE.OrthographicCamera(-2.3, 2.3, 1.7, -1.7, .1, 30);
  camera.position.z = 10;
  scene.add(sculpture);
  const geometries = [], materials = [], lineMaterials = [], portals = [];

  function lines(points, strengths, opacity, segments = false) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setAttribute('strength', new THREE.Float32BufferAttribute(strengths, 1));
    const material = new THREE.ShaderMaterial({
      uniforms:{uLight:{value:1}, uOpacity:{value:opacity}},
      vertexShader:lineVertex, fragmentShader:lineFragment,
      transparent:true, depthWrite:false,
    });
    const mesh = segments ? new THREE.LineSegments(geometry, material) : new THREE.Line(geometry, material);
    geometries.push(geometry); materials.push(material); lineMaterials.push(material);
    sculpture.add(mesh);
    return mesh;
  }

  for (const center of worlds) {
    // A lightly bowed sheet pinches inward around each small aperture.
    const surface = (u, v) => {
      const pinch = Math.exp(-(u * u + v * v) * 10);
      const bend = .10 * pinch * v;
      return [center[0] + u * .70 * (1 - .55 * pinch) + bend,
        center[1] + v * (1 - .42 * pinch) + u * .35,
        -.10 - u * .30 - .16 * pinch];
    };
    const grid = [], weights = [];
    function contour(fixed, horizontal) {
      for (let j = 0; j < 44; j++) {
        const a = -1 + j / 22, b = -1 + (j + 1) / 22;
        const uvA = horizontal ? [a * .5, fixed] : [fixed, a * .82];
        const uvB = horizontal ? [b * .5, fixed] : [fixed, b * .82];
        if (Math.hypot(...uvA) < .075 || Math.hypot(...uvB) < .075) continue;
        grid.push(surface(...uvA), surface(...uvB));
        const weight = .42 + .32 * Math.exp(-fixed * fixed * 5);
        weights.push(weight, weight);
      }
    }
    for (let i = -6; i <= 6; i++) contour(i * .12, true);
    for (let i = -3; i <= 3; i++) contour(i * .14, false);
    lines(grid, weights, .22, true);
    const border = [[-.5,-.82],[.5,-.82],[.5,.82],[-.5,.82],[-.5,-.82]].map(uv => surface(...uv));
    lines(border, border.map(() => 1), .30);
    const centerVector = new THREE.Vector3(...center);
    // Nested micro rims carry the wormhole cue without a large dark funnel.
    for (let ring = 0; ring < 4; ring++) {
      const radius = .045 + ring * .025, points = [];
      for (let j = 0; j <= 64; j++) {
        const a = j / 64 * Math.PI * 2;
        points.push([center[0] + Math.cos(a) * radius * .63,
          center[1] + Math.sin(a) * radius + Math.cos(a) * radius * .32, .02]);
      }
      const rim = lines(points, points.map(() => 1), .48 - ring * .09);
      portals.push({material:rim.material, center:centerVector, base:.48 - ring * .09});
    }
  }

  const thread = [], strengths = [], branch = [];
  for (let i = 0; i <= 240; i++) {
    const t = i / 240;
    thread.push(sampleRoute(t));
    strengths.push(Math.min(1, t / .15, (1 - t) / .15));
    if (t >= .4 && t <= .6) branch.push(sampleRoute(t, true));
  }
  lines(thread, strengths, .70);
  lines(branch, branch.map(() => 1), .33);

  const beadGeometry = new THREE.SphereGeometry(.024, 12, 8);
  geometries.push(beadGeometry);
  const travelers = [
    {offset:.12, branch:false},
    {offset:.60, branch:true},
  ].map(route => {
    const material = new THREE.MeshBasicMaterial({color:0x8a7aa5, transparent:true, depthWrite:false});
    materials.push(material);
    const bead = new THREE.Mesh(beadGeometry, material);
    sculpture.add(bead);
    return {...route, bead};
  });

  function resize() {
    if (disposed) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    const aspect = width / height, halfWidth = Math.max(2.28, 1.35 * aspect);
    camera.left = -halfWidth; camera.right = halfWidth;
    camera.top = halfWidth / aspect; camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function draw({time = 0, x = 0, y = 0} = {}) {
    if (disposed) return;
    const light = stage.ownerDocument.body.dataset.theme === 'light';
    for (const material of lineMaterials) material.uniforms.uLight.value = light ? 1 : 0;
    // Small parallax keeps the sheets readable; no spinning or zooming.
    sculpture.rotation.set(y * .018, x * .026, Math.sin(time * .12) * .006);
    for (const traveler of travelers) {
      const state = travelerAt(time, traveler.offset, traveler.branch);
      traveler.bead.position.fromArray(state.position);
      traveler.bead.material.opacity = state.opacity * .9;
      traveler.bead.material.color.setHex(light ? 0x8a7aa5 : 0xc8bedb);
    }
    for (const portal of portals) {
      const distance = Math.min(...travelers.map(({bead}) => bead.position.distanceTo(portal.center)));
      portal.material.uniforms.uOpacity.value = portal.base + Math.exp(-distance * distance * 160) * .12;
    }
    renderer.render(scene, camera);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
  resize();
  return {draw, resize, dispose};
}
