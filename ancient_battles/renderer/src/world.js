// Battlefield environment: sky, terrain, shore and sea, vegetation, ships, light.
// Kept deliberately simple and "diorama-like" to match the miniature figures.
import * as THREE from 'three';
import { rng } from './rng.js';
import { mergeGeos } from './parts.js';

export function materials() {
  const std = (o) => new THREE.MeshStandardMaterial({ color: 0xffffff, ...o });
  const wicker = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d8c39a'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) { g.fillStyle = (y / 8) % 2 ? '#a88a5a' : '#c4a674'; g.fillRect(0, y, w, 5); }
    for (let x = 0; x < w; x += 22) { g.fillStyle = 'rgba(80,55,30,0.55)'; g.fillRect(x, 0, 4, h); }
  });
  wicker.repeat.set(1, 2);
  const scale = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#9a978e'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 10) for (let x = (y / 10) % 2 ? 0 : 6; x < w; x += 12) { g.fillStyle = '#5f5c55'; g.beginPath(); g.arc(x, y + 8, 6, 0, Math.PI); g.fill(); }
  });
  scale.repeat.set(4, 3);
  return {
    skin: std({ roughness: 0.62 }), cloth: std({ roughness: 0.78 }), linen: std({ roughness: 0.82 }), felt: std({ roughness: 0.92, side: THREE.DoubleSide }),
    bronze: std({ metalness: 0.85, roughness: 0.33 }), iron: std({ metalness: 0.75, roughness: 0.45 }), wood: std({ roughness: 0.7 }), leather: std({ roughness: 0.62 }),
    hair: std({ roughness: 0.95 }), dark: std({ roughness: 0.9 }), paint: std({ roughness: 0.5, side: THREE.DoubleSide }),
    wicker: std({ roughness: 0.92, map: wicker }), scale: std({ roughness: 0.5, metalness: 0.55, map: scale }),
  };
}
export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function skyMaterial(top, horizon, ground) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(horizon) }, gnd: { value: new THREE.Color(ground) }, sun: { value: new THREE.Vector3() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top,hor,gnd,sun; varying vec3 vDir;
      void main(){ float y=vDir.y; vec3 c = y>0.0 ? mix(hor, top, pow(clamp(y,0.0,1.0),0.55)) : mix(hor, gnd, clamp(-y*6.0,0.0,1.0));
        float s = max(dot(normalize(vDir), normalize(sun)),0.0); c += vec3(1.0,0.85,0.6)*(pow(s,600.0)*4.0 + pow(s,8.0)*0.25);
        gl_FragColor = vec4(c,1.0); }`,
  });
}

export function buildWorld(scene, renderer, W, mats) {
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, (90 - W.sun.elevation) * Math.PI / 180, W.sun.azimuth * Math.PI / 180);
  const haze = new THREE.Color('#d8c7a3');
  scene.fog = new THREE.FogExp2(haze, 0.0036);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMaterial('#6f8fb0', '#e6d4ae', '#cbb48a'));
  sky.material.uniforms.sun.value.copy(sunDir); scene.add(sky);

  // environment for metal reflections (sky gradient + sun)
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial('#7f9cbc', '#f0dfba', '#8a7650'));
  envSky.material.uniforms.sun.value.copy(sunDir); envScene.add(envSky);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(envScene, 0.02).texture; scene.environmentIntensity = 0.7;

  scene.add(new THREE.HemisphereLight('#d6e2ee', '#7d6a48', 1.0));
  const sun = new THREE.DirectionalLight('#ffe2b4', 3.2);
  sun.position.copy(sunDir).multiplyScalar(120); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // terrain
  const rnd = rng(5);
  const shore = W.shore_z;
  const geo = new THREE.PlaneGeometry(1400, 1400, 280, 280); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  const dry = new THREE.Color('#ab9862'), green = new THREE.Color('#7f8248'), earth = new THREE.Color('#9a7c55'), sand = new THREE.Color('#d6c193');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = noise(x * 0.02, z * 0.02) * 0.6 + noise(x * 0.09, z * 0.09) * 0.4;
    c.copy(dry).lerp(green, Math.max(0, n)).lerp(earth, Math.max(0, -n) * 0.8);
    if (Math.abs(x) < 50 && z > -30 && z < 40) c.lerp(earth, 0.18); // trampled ground
    let y = 0;
    if (z < shore + 8) c.lerp(sand, S(shore + 8, shore + 1, z));
    if (z < shore) y = -0.8 * S(shore, shore - 6, z);
    const hz = W.hills_z; // hills behind the Greek side
    if (z > hz - 40) y += Math.max(0, (z - (hz - 40)) * 0.35 + 18 * noise(x * 0.012, z * 0.01)) * S(hz - 40, hz + 30, z);
    if (Math.abs(x) > 180) y += (Math.abs(x) - 180) * 0.15 * (0.6 + 0.4 * noise(z * 0.01, x * 0.01));
    pos.setY(i, y);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const detail = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 150 + Math.floor(rnd() * 105); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3); }
  });
  detail.repeat.set(220, 220);
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95 }));
  ground.receiveShadow = true; scene.add(ground);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 700).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4d7d8f', roughness: 0.18, metalness: 0.1 }));
  sea.position.set(0, -0.25, shore - 352); scene.add(sea);

  // vegetation (outside the formations)
  const busy = (x, z) => Math.abs(x) < 46 && z > -48 && z < 50;
  const bushGeo = new THREE.IcosahedronGeometry(1, 1); const bushes = [];
  for (let i = 0; i < 1400; i++) { const x = rnd.range(-260, 260), z = rnd.range(shore + 6, 200); if (busy(x, z) && rnd() < 0.92) continue; bushes.push([x, z, rnd.range(0.35, 1.1)]); }
  const bm = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), bushes.length);
  bushes.forEach(([x, z, s], i) => { bm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, s * 0.45, z), new THREE.Quaternion(), new THREE.Vector3(s * 1.3, s * 0.85, s * 1.2))); bm.setColorAt(i, c.set(rnd.pick(['#5d6334', '#6b6a3a', '#4f5a30', '#7a7444']))); });
  bm.castShadow = bm.receiveShadow = true; scene.add(bm);
  const tufts = []; for (let i = 0; i < 6000; i++) tufts.push([rnd.range(-90, 90), rnd.range(shore + 4, 90)]);
  const blade = (a) => new THREE.ConeGeometry(0.025, 0.24, 3).translate(0, 0.11, 0).rotateZ(0.35 * Math.cos(a)).rotateX(0.35 * Math.sin(a));
  const tm = new THREE.InstancedMesh(mergeGeos([blade(0), blade(2.1), blade(4.2)]), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), tufts.length);
  tufts.forEach(([x, z], i) => { const s = rnd.range(0.6, 1.4); tm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s))); tm.setColorAt(i, c.set(rnd.pick(['#9b8a52', '#86804a', '#b09a62']))); });
  tm.receiveShadow = true; scene.add(tm);
  // olive trees
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6).translate(0, 1.1, 0), crown = new THREE.IcosahedronGeometry(1.6, 1);
  const trees = []; for (let i = 0; i < 160; i++) { const x = rnd.range(-220, 220), z = rnd.range(-40, 180); if (busy(x, z)) continue; trees.push([x, z]); }
  const tr = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 0.9 }), trees.length);
  const cr = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), trees.length);
  trees.forEach(([x, z], i) => { const s = rnd.range(0.8, 1.3); tr.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s))); cr.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, 2.6 * s, z), new THREE.Quaternion(), new THREE.Vector3(1.4 * s, 0.9 * s, 1.3 * s))); cr.setColorAt(i, c.set(rnd.pick(['#6f7650', '#7b8058', '#646b47']))); });
  tr.castShadow = cr.castShadow = true; scene.add(tr, cr);

  // beached ships (generic hulls)
  const hull = new THREE.Shape(); hull.moveTo(-15, 0.4); hull.quadraticCurveTo(-16.5, 2.8, -14, 4.2); hull.lineTo(-12.8, 2.6); hull.lineTo(13, 2.6); hull.quadraticCurveTo(15.5, 2.4, 16.2, 0.9); hull.lineTo(15, 0.2); hull.quadraticCurveTo(0, -0.6, -15, 0.4);
  const hg = new THREE.ExtrudeGeometry(hull, { depth: 3.6, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, curveSegments: 10 }).translate(0, 0, -1.8);
  const ships = W.ships; const hm = new THREE.InstancedMesh(hg, new THREE.MeshStandardMaterial({ color: '#3d2c20', roughness: 0.75 }), ships.count);
  for (let i = 0; i < ships.count; i++) {
    const x = ships.x[0] + (ships.x[1] - ships.x[0]) * (i + 0.5) / ships.count + rnd.range(-3, 3);
    hm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, -0.3, ships.z + rnd.range(-3, 3)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd.range(-0.12, 0.12), 0)), new THREE.Vector3(0.85, 0.75, 0.85)));
  }
  hm.castShadow = true; scene.add(hm);
  return { sun, sunDir };
}

const S = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
export function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
