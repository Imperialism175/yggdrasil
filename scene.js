/* Yggdrasil in 3D. Natural scroll: scrolling down descends the tree,
   from the crown under a Skyrim-like aurora sky to the roots at Urd's well.
   Pipeline: scene -> god rays (moon / well) -> bloom -> output. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const root = document.documentElement;
const canvas = document.getElementById('scene');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(max-width: 760px)').matches || (navigator.maxTouchPoints > 0 && innerWidth < 1100);

const ready = () => root.classList.add('is-ready');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
} catch (err) {
  root.classList.add('no-webgl');
  ready();
  throw err;
}

renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

/* ---------- helpers ---------- */
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const R = rng(175);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 4;
  t.userData.redraw = () => { draw(c.getContext('2d'), w, h); t.needsUpdate = true; };
  return t;
}

const GLSL_NOISE = /* glsl */`
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

/* ---------- scene ---------- */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(mobile ? 62 : 50, innerWidth / innerHeight, 0.5, 4000);
const clock = new THREE.Clock();
const uTime = { value: 0 };

const MOON_DIR = V(-0.2, 0.36, -0.92).normalize();
const MOON2_DIR = V(0.62, 0.3, -0.72).normalize();
const WELL = V(0, 0.15, 15);

scene.fog = new THREE.FogExp2(0x0d1838, 0.003);

/* occlusion bookkeeping for god rays */
const occBlack = [];   // [mesh, occMaterial]
const occWhite = [];   // [mesh, occMaterial]
const occHide = [];    // objects hidden in the occlusion pass
const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });

/* ---------- sky ---------- */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1500, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uTime, uLow: { value: 0 }, uMoon: { value: MOON_DIR }, uMoon2: { value: MOON2_DIR } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uLow;
      uniform vec3 uMoon, uMoon2;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        // linear values: the output pass converts to sRGB, which lifts darks a lot
        vec3 zen = vec3(0.0015, 0.003, 0.012), hor = vec3(0.012, 0.022, 0.055), below = vec3(0.002, 0.003, 0.006);
        vec3 col = mix(hor, zen, smoothstep(0.0, 0.6, h));
        col = mix(below, col, smoothstep(-0.15, 0.02, h));

        // milky way
        vec3 axis = normalize(vec3(0.35, 0.25, 0.9));
        float band = pow(1.0 - abs(dot(d, axis)), 6.0);
        float mw = fbm(vec2(atan(d.z, d.x) * 2.0, d.y * 4.0) * 1.5) * band;
        col += vec3(0.05, 0.03, 0.1) * mw * mw * 1.4 + vec3(0.01, 0.015, 0.04) * band * 0.3;

        // stars
        vec3 sp = d * 420.0;
        vec3 cell = floor(sp);
        float hs = hash3(cell);
        float st = step(0.991, hs) * smoothstep(0.38, 0.0, length(fract(sp) - 0.5));
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + hs * 3.0) + hs * 100.0);
        col += st * tw * mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.82, 0.88), fract(hs * 13.0)) * smoothstep(-0.02, 0.15, h) * (1.6 + band * 2.0);

        // aurora: green like the old north, blending into blue, pink and white
        if (h > 0.0) {
          vec2 auv = d.xz / (h + 0.18);
          float t = uTime * 0.04;
          float n = fbm(auv * 0.35 + vec2(t, -t * 0.6));
          float rays = 0.5 + 0.5 * noise(vec2(auv.x * 9.0 + n * 3.0, t * 6.0));
          float fade = smoothstep(0.05, 0.28, h) * (1.0 - smoothstep(0.6, 0.9, h));
          vec3 cG = vec3(0.25, 1.0, 0.6), cB = vec3(0.36, 0.81, 0.98), cP = vec3(0.96, 0.66, 0.72), cW = vec3(1.0);
          float hue = fract(auv.x * 0.05 + n * 0.35 + t * 0.4);
          vec3 ac = hue < 0.25 ? mix(cG, cB, hue / 0.25)
                  : hue < 0.5 ? mix(cB, cP, (hue - 0.25) / 0.25)
                  : hue < 0.75 ? mix(cP, cW, (hue - 0.5) / 0.25)
                  : mix(cW, cG, (hue - 0.75) / 0.25);
          // thin curtains: sharp lower edge, soft glow rising above it
          float c1 = auv.y * 0.6 + 1.2 + sin(auv.x * 0.45 + t * 2.0) * 0.8 + (n - 0.5) * 1.6;
          float r1 = exp(-c1 * c1 * 14.0) + exp(-max(c1, 0.0) * 4.0) * step(0.0, c1) * 0.25 * step(c1, 1.2);
          col += ac * r1 * rays * fade * 0.55;
          float c2 = auv.y * 0.45 - 1.4 + sin(auv.x * 0.3 - t * 1.5) * 1.0 + (n - 0.5) * 1.4;
          float r2 = exp(-c2 * c2 * 16.0) + exp(-max(c2, 0.0) * 4.0) * step(0.0, c2) * 0.2 * step(c2, 1.0);
          col += mix(cB, cP, 0.5 + 0.5 * sin(auv.x * 0.2 + t)) * r2 * rays * fade * 0.45;
        }

        // moon halos
        float m = max(dot(d, uMoon), 0.0);
        col += vec3(0.3, 0.4, 0.6) * (pow(m, 40.0) * 0.25 + pow(m, 6.0) * 0.04);
        float m2 = max(dot(d, uMoon2), 0.0);
        col += vec3(0.95, 0.62, 0.72) * pow(m2, 70.0) * 0.2;

        col *= mix(1.0, 0.6, uLow);
        gl_FragColor = vec4(col, 1.0);
      }`
  })
);
sky.renderOrder = -10;
scene.add(sky);
occHide.push(sky);

/* moons: billboards so they work in the occlusion pass */
function moonTex(tint) {
  return canvasTex(256, 256, (g, w) => {
    const r = rng(tint.length * 31);
    const grd = g.createRadialGradient(w * 0.45, w * 0.45, 10, w / 2, w / 2, w / 2);
    grd.addColorStop(0, tint[0]); grd.addColorStop(0.85, tint[1]); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 40; i++) {
      const x = r() * w, y = r() * w, rad = 4 + r() * 26;
      g.fillStyle = `rgba(60,70,90,${0.08 + r() * 0.16})`;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
  });
}
function makeMoon(dir, size, tint, color) {
  const tex = moonTex(tint);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false, toneMapped: false, color })
  );
  m.position.copy(dir).multiplyScalar(1200);
  m.renderOrder = -9;
  scene.add(m);
  return m;
}
const moon = makeMoon(MOON_DIR, 170, ['#ffffff', '#cfd9e8'], new THREE.Color(1.9, 1.95, 2.1));
const moon2 = makeMoon(MOON2_DIR, 70, ['#ffe8ee', '#e8a9b6'], new THREE.Color(1.5, 1.3, 1.4));
occWhite.push([moon, new THREE.MeshBasicMaterial({ map: moon.material.map, alphaTest: 0.5, fog: false, color: 0xffffff })]);
occHide.push(moon2);

/* ---------- lights ---------- */
scene.add(new THREE.AmbientLight(0x3a4a78, 0.7));
scene.add(new THREE.HemisphereLight(0x9ab8ff, 0x0e140c, 0.7));
const moonLight = new THREE.DirectionalLight(0xd6e2ff, 2.2);
moonLight.position.copy(MOON_DIR).multiplyScalar(300);
scene.add(moonLight);
const crownLight = new THREE.PointLight(0xf5a9b8, 400, 90, 2);
crownLight.position.set(0, 128, 6);
scene.add(crownLight);
const wellLight = new THREE.PointLight(0x5bcefa, 600, 70, 2);
wellLight.position.copy(WELL).add(V(0, 4, 0));
scene.add(wellLight);

/* ---------- tree ---------- */
const TRUNK_H = 112;
const trunkR = y => {
  const t = clamp(y / TRUNK_H, 0, 1);
  return lerp(7.2, 1.7, Math.pow(t, 0.7)) + 7 * Math.pow(1 - smooth(0, 0.14, t), 2);
};
const center = y => V(Math.sin(y * 0.03) * 1.6, y, Math.cos(y * 0.025) * 1.3 - 1.3);

const barkTex = canvasTex(256, 512, (g, w, h) => {
  const r = rng(9);
  g.fillStyle = '#3a2a1f'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const x = r() * w;
    g.strokeStyle = `rgba(${r() < 0.5 ? '15,9,6' : '92,72,54'},${0.25 + r() * 0.45})`;
    g.lineWidth = 1 + r() * 4;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= h; y += 32) g.lineTo(x + Math.sin(y * 0.05 + i) * 4, y);
    g.stroke();
  }
}, [3, 6]);
const barkMat = new THREE.MeshStandardMaterial({ map: barkTex, color: 0xb7a28c, roughness: 0.95, metalness: 0 });

// trunk
{
  const g = new THREE.CylinderGeometry(1, 1, TRUNK_H, mobile ? 32 : 56, mobile ? 90 : 160, true);
  g.translate(0, TRUNK_H / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let a = Math.atan2(z, x) + y * 0.012;
    let r = trunkR(y) * (1 + 0.09 * Math.sin(a * 5 + y * 0.15) + 0.05 * Math.sin(a * 11 - y * 0.3) + 0.03 * Math.sin(a * 23 + y * 0.9));
    const c = center(y);
    p.setXYZ(i, c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
  }
  g.computeVertexNormals();
  const trunk = new THREE.Mesh(g, barkMat);
  scene.add(trunk);
  occBlack.push([trunk, blackMat]);
}

// tapered tube along a curve
function taperedTube(points, r0, r1, tub = 8, rad = 6) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, tub, 1, rad, false);
  const p = g.attributes.position;
  for (let i = 0; i <= tub; i++) {
    const c = curve.getPointAt(i / tub);
    const r = lerp(r0, r1, i / tub);
    for (let j = 0; j <= rad; j++) {
      const k = i * (rad + 1) + j;
      p.setXYZ(k, c.x + (p.getX(k) - c.x) * r, c.y + (p.getY(k) - c.y) * r, c.z + (p.getZ(k) - c.z) * r);
    }
  }
  return g;
}

const woodGeos = [];
const leafData = [];  // {pos, scale, rot, color}
const sparkPos = [];
const LEAF_CAP = mobile ? 3500 : 9000;

function leafCluster(at, t, n, spread) {
  for (let i = 0; i < n && leafData.length < LEAF_CAP; i++) {
    const p = V(R() - 0.5, R() - 0.5, R() - 0.5).normalize().multiplyScalar(Math.cbrt(R()) * spread).add(at);
    const magic = R() < 0.06;
    const c = new THREE.Color().setHSL(
      magic ? lerp(0.52, 0.95, R()) : lerp(0.24, 0.38, R()),
      magic ? 0.55 : lerp(0.3, 0.5, R()),
      magic ? 0.55 : lerp(0.16, 0.3, R()) + t * 0.05
    );
    leafData.push({ p, s: lerp(2.6, 4.6, R()),rx: R() * 6.28, ry: R() * 6.28, rz: R() * 6.28, c });
  }
  if (t > 0.45 && R() < 0.6) sparkPos.push(at.clone().add(V((R() - 0.5) * spread * 2, (R() - 0.5) * spread, (R() - 0.5) * spread * 2)));
}

function grow(start, dir, len, r, depth, t, maxDepth) {
  const pts = [start.clone()];
  let p = start.clone(), d = dir.clone();
  for (let k = 0; k < 3; k++) {
    d.add(V((R() - 0.5) * 0.35, 0.06 + (R() - 0.5) * 0.15, (R() - 0.5) * 0.35)).normalize();
    p = p.clone().addScaledVector(d, len / 3);
    pts.push(p);
  }
  woodGeos.push(taperedTube(pts, r, r * 0.62, depth === maxDepth ? 10 : 6, depth >= maxDepth - 1 ? 7 : 5));
  const end = pts[3];
  if (depth > 0) {
    const n = R() < 0.35 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const axis = V(R() - 0.5, R() - 0.5, R() - 0.5).cross(d).normalize();
      const cd = d.clone().applyAxisAngle(axis, 0.45 + R() * 0.45);
      grow(end, cd, len * (0.62 + R() * 0.12), r * 0.6, depth - 1, t, maxDepth);
    }
    if (depth <= 2) leafCluster(pts[2], t, 6, 3.5);
  } else {
    leafCluster(end, t, mobile ? 12 : 22, 4.5);
  }
}

// side branches, denser toward the crown
for (let y = 34; y < TRUNK_H - 4;) {
  const t = clamp((y - 30) / (TRUNK_H - 30), 0, 1);
  const a = R() * Math.PI * 2;
  const out = V(Math.cos(a), lerp(0.25, 0.75, R()), Math.sin(a)).normalize();
  const c = center(y);
  const start = c.clone().add(V(Math.cos(a) * trunkR(y) * 0.7, 0, Math.sin(a) * trunkR(y) * 0.7));
  const depth = t > 0.55 ? 3 : 2;
  grow(start, out, lerp(16, 34, t), trunkR(y) * 0.38, depth, t, depth);
  y += lerp(9, 3.2, t) * (0.6 + R() * 0.8);
}
// crown fan
{
  const n = mobile ? 7 : 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R() * 0.4;
    const dir = V(Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8).normalize();
    grow(center(TRUNK_H - 2), dir, 24 + R() * 8, 1.6, 3, 1, 3);
  }
}
// roots
{
  const n = mobile ? 10 : 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.3;
    const c = center(4);
    const r0 = trunkR(4);
    const pts = [c.clone().add(V(Math.cos(a) * r0 * 0.5, 4, Math.sin(a) * r0 * 0.5))];
    let p = pts[0].clone();
    const len = 22 + R() * 26;
    for (let k = 1; k <= 5; k++) {
      p = p.clone().add(V(Math.cos(a + (R() - 0.5) * 0.4) * len / 5, -(k < 3 ? 1.6 : 0.5) + (R() - 0.5) * 0.6, Math.sin(a + (R() - 0.5) * 0.4) * len / 5));
      p.y = Math.max(p.y, -0.6);
      pts.push(p);
    }
    woodGeos.push(taperedTube(pts, 3.2 + R() * 1.4, 0.3, 14, 7));
    // a side root
    const s = pts[2];
    const b = a + (R() < 0.5 ? -0.7 : 0.7);
    woodGeos.push(taperedTube([s, s.clone().add(V(Math.cos(b) * 6, -0.5, Math.sin(b) * 6)), s.clone().add(V(Math.cos(b) * 13, -0.8, Math.sin(b) * 13))], 1.2, 0.15, 8, 5));
  }
}
{
  const wood = new THREE.Mesh(mergeGeometries(woodGeos), barkMat);
  scene.add(wood);
  occBlack.push([wood, blackMat]);
  woodGeos.length = 0;
}

// leaves (instanced clumps, swaying)
const leafTex = canvasTex(128, 128, (g, w) => {
  const r = rng(3);
  for (let i = 0; i < 14; i++) {
    const x = w / 2 + (r() - 0.5) * w * 0.6, y = w / 2 + (r() - 0.5) * w * 0.6;
    g.save(); g.translate(x, y); g.rotate(r() * Math.PI * 2);
    const l = 18 + r() * 16;
    const grd = g.createLinearGradient(0, -l, 0, l);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#9a9a9a');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(0, -l); g.quadraticCurveTo(l * 0.55, 0, 0, l); g.quadraticCurveTo(-l * 0.55, 0, 0, -l); g.fill();
    g.restore();
  }
});
function addSway(mat) {
  mat.onBeforeCompile = s => {
    s.uniforms.uTime = uTime;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 ip = instanceMatrix[3].xyz;
      transformed.x += sin(uTime * 1.3 + ip.x * 0.3 + ip.y * 0.2) * 0.18;
      transformed.y += cos(uTime * 1.1 + ip.z * 0.3) * 0.12;`);
  };
  return mat;
}
{
  const leafMat = addSway(new THREE.MeshStandardMaterial({
    map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75,
    emissive: 0x0b2014, emissiveIntensity: 0.6
  }));
  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), leafMat, leafData.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = V();
  leafData.forEach((L, i) => {
    q.setFromEuler(e.set(L.rx, L.ry, L.rz));
    m.compose(L.p, q, s.set(L.s, L.s, L.s));
    leaves.setMatrixAt(i, m);
    leaves.setColorAt(i, L.c);
  });
  leaves.instanceMatrix.needsUpdate = true;
  leaves.instanceColor.needsUpdate = true;
  scene.add(leaves);
  occBlack.push([leaves, addSway(new THREE.MeshBasicMaterial({ color: 0x000000, map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, fog: false }))]);
}

/* ---------- the Norns' thread ---------- */
let thread, threadSegs = 0;
{
  const pts = [];
  for (let y = TRUNK_H - 2; y >= 2; y -= 0.5) {
    const a = y * 0.2;
    const c = center(y), r = trunkR(y) * 1.06 + 0.35;
    pts.push(V(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r));
  }
  threadSegs = mobile ? 700 : 1400;
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), threadSegs, 0.16, 6, false);
  // golden thread: shimmers between deep and pale gold
  const pal = [new THREE.Color(0xe9b84a), new THREE.Color(0xffe3a0), new THREE.Color(0xd99a2b), new THREE.Color(0xffd27a)];
  const cols = new Float32Array(g.attributes.position.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < g.attributes.position.count; i++) {
    const y = g.attributes.position.getY(i);
    const f = ((y / 14) % 4 + 4) % 4, k = Math.floor(f);
    c.copy(pal[k]).lerp(pal[(k + 1) % 4], f - k).multiplyScalar(2.2);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  thread = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }));
  scene.add(thread);
  occHide.push(thread);
}

/* ---------- floating rune rings ---------- */
const runeRings = [];
const runeTextures = [];  // redrawn once the runic web font arrives
{
  const tex = canvasTex(2048, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '88px "Noto Sans Runic", "Segoe UI Historic", serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.shadowColor = '#ffffff'; g.shadowBlur = 16;
    const text = 'ᛊᛃᛞᚾᛖᛃ ᛟ ᚱᚢᚾᛟ ᛁᚷᚷᛞᚱᚨᛊᛁᛚ ᛟ ';
    let x = 10;
    while (x < w) { g.fillText(text, x, h / 2); x += g.measureText(text).width; }
  });
  tex.wrapS = THREE.RepeatWrapping;
  runeTextures.push(tex);
  [[28, 0xe9cc86], [66, 0x5bcefa], [98, 0xf5a9b8]].forEach(([y, col], i) => {
    const r = trunkR(y) + 2.6;
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 1.8, 96, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(col).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false })
    );
    m.position.copy(center(y));
    m.rotation.z = (i - 1) * 0.08;
    scene.add(m);
    occHide.push(m);
    runeRings.push(m);
  });
}

/* ---------- ground, well, standing stones ---------- */
{
  const groundTex = canvasTex(512, 512, (g, w) => {
    const r = rng(5);
    g.fillStyle = '#18241b'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '40,62,40' : '8,12,9'},${0.2 + r() * 0.4})`;
      g.beginPath(); g.arc(r() * w, r() * w, 1 + r() * 7, 0, Math.PI * 2); g.fill();
    }
  }, [40, 40]);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 64), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.4;
  scene.add(ground);
  occBlack.push([ground, blackMat]);
}

const water = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64),
  new THREE.ShaderMaterial({
    transparent: true, toneMapped: false, depthWrite: false,
    uniforms: { uTime, uRipple: { value: -100 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uTime, uRipple;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        vec3 col = mix(vec3(0.5, 1.5, 2.0), vec3(0.05, 0.35, 0.6), smoothstep(0.0, 1.0, r));
        col += vec3(0.25, 0.6, 0.8) * (0.5 + 0.5 * sin(r * 28.0 - uTime * 1.6)) * 0.18;
        float age = uTime - uRipple;
        float ring = exp(-pow((r - age * 0.55) * 10.0, 2.0)) * exp(-age * 0.9) * step(0.0, age);
        col += vec3(1.6, 1.9, 2.2) * ring;
        gl_FragColor = vec4(col, smoothstep(1.0, 0.9, r));
      }`
  })
);
water.rotation.x = -Math.PI / 2;
water.position.copy(WELL);
scene.add(water);
occWhite.push([water, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })]);

const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.9, flatShading: true });
{
  const rim = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.7, 8, 40), stoneMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.copy(WELL);
  scene.add(rim);
  occBlack.push([rim, blackMat]);

  const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᛟ';
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const h = 3 + R() * 2.5;
    const st = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 0.7, 1, 2, 1), stoneMat);
    st.position.set(WELL.x + Math.cos(a) * 10, h / 2 - 0.3, WELL.z + Math.sin(a) * 10);
    st.lookAt(WELL.x, h / 2, WELL.z);
    st.rotation.z += (R() - 0.5) * 0.15;
    scene.add(st);
    occBlack.push([st, blackMat]);
    const glyph = canvasTex(64, 64, (g, w) => {
      g.font = '48px "Noto Sans Runic", "Segoe UI Historic", serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ffffff'; g.shadowColor = '#ffffff'; g.shadowBlur = 8;
      g.clearRect(0, 0, w, w);
      g.fillText([...runes][i], w / 2, w / 2);
    });
    runeTextures.push(glyph);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: glyph, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(0x5bcefa).multiplyScalar(2.5), toneMapped: false }));
    plate.position.set(0, h * 0.18, 0.36);
    st.add(plate);
    occHide.push(plate);
  }
}

/* ---------- mountains of Midgard ---------- */
{
  const geos = [];
  const n = mobile ? 40 : 70;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R() * 0.1;
    const dist = 260 + R() * 220;
    const h = 60 + R() * 120;
    const g = new THREE.ConeGeometry(45 + R() * 50, h, 5 + ((R() * 3) | 0), 4);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      p.setX(k, p.getX(k) + (R() - 0.5) * 6);
      p.setZ(k, p.getZ(k) + (R() - 0.5) * 6);
      const snow = y > h * (0.12 + R() * 0.1) ? 1 : 0;
      const c = snow ? [0.82, 0.86, 0.95] : [0.12, 0.14, 0.18];
      col.set(c, k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.translate(Math.cos(a) * dist, h / 2 - 8, Math.sin(a) * dist);
    geos.push(g.toNonIndexed());
  }
  const mountains = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  scene.add(mountains);
  occBlack.push([mountains, blackMat]);
}

/* ---------- clouds ---------- */
const clouds = new THREE.Group();
{
  const tex = canvasTex(256, 256, (g, w) => {
    const r = rng(11);
    for (let i = 0; i < 26; i++) {
      const x = w / 2 + (r() - 0.5) * w * 0.5, y = w / 2 + (r() - 0.5) * w * 0.3, rad = 30 + r() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(255,255,255,.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
  });
  const n = mobile ? 70 : 150;
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, d = 10 + Math.pow(R(), 0.7) * 230;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color().setHSL(0.62 + R() * 0.12, 0.3, 0.32 + R() * 0.14), transparent: true, depthWrite: false, opacity: 0.6, fog: true }));
    s.position.set(Math.cos(a) * d, 54 + R() * 16, Math.sin(a) * d);
    const sc = 30 + R() * 50;
    s.scale.set(sc * 1.6, sc, 1);
    clouds.add(s);
  }
}
scene.add(clouds);
occHide.push(clouds);

/* ---------- particles ---------- */
function makePoints(positions, colors, { size = 3, rise = 0, height = 140, opacity = 1 } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  const seeds = new Float32Array(positions.length / 3).map(() => Math.random());
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime, uPixel: { value: renderer.getPixelRatio() }, uSize: { value: size }, uRise: { value: rise }, uH: { value: height }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aSeed;
      uniform float uTime, uPixel, uSize, uRise, uH;
      varying vec3 vColor; varying float vTw;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * uRise * (0.4 + aSeed), uH);
        p.x += sin(uTime * 0.3 + aSeed * 20.0) * 1.2;
        p.z += cos(uTime * 0.25 + aSeed * 17.0) * 1.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (0.6 + aSeed) * uPixel * (60.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
        vColor = aColor;
        vTw = 0.45 + 0.55 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 40.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vColor; varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor * 1.8, a * a * vTw * uOpacity);
      }`
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  occHide.push(pts);
  return pts;
}
const PALETTE = [0x5bcefa, 0xf5a9b8, 0xffffff, 0xe9cc86, 0x9effc8].map(c => new THREE.Color(c));
{
  const n = mobile ? 900 : 2200;
  const pos = [], col = [];
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, d = 6 + Math.pow(R(), 0.6) * 70;
    pos.push(Math.cos(a) * d, R() * 140, Math.sin(a) * d);
    const c = PALETTE[(R() * PALETTE.length) | 0];
    col.push(c.r, c.g, c.b);
  }
  makePoints(pos, col, { size: 2.2, rise: 0.8 });
}
{
  const pos = [], col = [];
  sparkPos.forEach(p => {
    pos.push(p.x, p.y, p.z);
    const c = PALETTE[(R() * 4) | 0];
    col.push(c.r, c.g, c.b);
  });
  if (pos.length) makePoints(pos, col, { size: 4.5, rise: 0, height: 10000 });
}

// rune burst from the well
const burst = (() => {
  const n = 220;
  const g = new THREE.BufferGeometry();
  const dir = new Float32Array(n * 3), seed = new Float32Array(n), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random();
    dir.set([Math.cos(a) * r, 0.6 + Math.random(), Math.sin(a) * r], i * 3);
    seed[i] = Math.random();
    const c = PALETTE[i % 3];
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime, uStart: { value: -100 }, uOrigin: { value: WELL }, uPixel: { value: renderer.getPixelRatio() } },
    vertexShader: /* glsl */`
      attribute vec3 aDir, aColor; attribute float aSeed;
      uniform float uTime, uStart, uPixel; uniform vec3 uOrigin;
      varying vec3 vColor; varying float vA;
      void main() {
        float age = uTime - uStart;
        vec3 p = uOrigin + vec3(aDir.x * 5.0 * age, aDir.y * age * (4.0 + aSeed * 6.0), aDir.z * 5.0 * age);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (3.0 + aSeed * 4.0) * uPixel * (60.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
        vColor = aColor;
        vA = step(0.0, age) * (1.0 - smoothstep(0.5, 3.0 + aSeed, age));
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vColor * 2.0, smoothstep(0.5, 0.0, d) * vA); }`
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  occHide.push(pts);
  return mat;
})();
addEventListener('ygg:rune', () => {
  burst.uniforms.uStart.value = uTime.value;
  water.material.uniforms.uRipple.value = uTime.value;
});

/* ---------- post-processing ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const occRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const SAMPLES = mobile ? 40 : 72;
const godrays = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    tOcc: { value: null },
    uLight: { value: new THREE.Vector2(0.5, 0.8) },
    uIntensity: { value: 0 },
    uTint: { value: new THREE.Color(0.75, 0.85, 1.0) }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tOcc;
    uniform vec2 uLight; uniform float uIntensity; uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 delta = (vUv - uLight) * (0.92 / float(${SAMPLES}));
      vec2 c = vUv;
      float illum = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < ${SAMPLES}; i++) {
        c -= delta;
        acc += texture2D(tOcc, c).rgb * illum;
        illum *= 0.955;
      }
      acc *= 0.018;
      gl_FragColor = vec4(base.rgb + acc * uIntensity * uTint, base.a);
    }`
});
godrays.uniforms.tOcc.value = occRT.texture;
composer.addPass(godrays);

const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), mobile ? 0.7 : 0.85, 0.55, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const occClear = new THREE.Color(0x000000);
const tmpClear = new THREE.Color();
function renderOcclusion() {
  const saved = [];
  occBlack.forEach(([m, mat]) => { saved.push([m, m.material]); m.material = mat; });
  occWhite.forEach(([m, mat]) => { saved.push([m, m.material]); m.material = mat; });
  const vis = occHide.map(o => o.visible);
  occHide.forEach(o => { o.visible = false; });
  const fog = scene.fog;
  scene.fog = null;
  renderer.getClearColor(tmpClear);
  const alpha = renderer.getClearAlpha();
  renderer.setClearColor(occClear, 1);
  renderer.setRenderTarget(occRT);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.setClearColor(tmpClear, alpha);
  scene.fog = fog;
  occHide.forEach((o, i) => { o.visible = vis[i]; });
  saved.forEach(([m, mat]) => { m.material = mat; });
}

/* ---------- camera path (one keyframe per chapter) ---------- */
const KEYS = [
  // [camera position, look target]
  [V(10, 98, 74), V(0, 124, 0)],     // hero: crown against the moon
  [V(58, 112, 26), V(0, 114, 0)],    // about: circling the crown
  [V(46, 90, -38), V(0, 86, 0)],     // branches
  [V(-62, 80, -72), V(0, 64, 0)],    // above the sea of clouds
  [V(-72, 42, 30), V(0, 38, 0)],     // Midgard: mountains on the horizon
  [V(16, 20, 36), V(0, 22, 0)],      // the Norns' thread
  [V(5, 13, 44), V(0, 1.5, 13)]      // Urd's well
];
const posCurve = new THREE.CatmullRomCurve3(KEYS.map(k => k[0]), false, 'centripetal');
const lookCurve = new THREE.CatmullRomCurve3(KEYS.map(k => k[1]), false, 'centripetal');

const FOG = [
  // [u, color, density]
  [0, 0x0d1838, 0.0026],
  [2, 0x16224a, 0.0032],
  [3, 0x2c3760, 0.0075],
  [3.6, 0x1a2440, 0.0042],
  [4, 0x121c30, 0.0030],
  [5, 0x0b1a1c, 0.0065],
  [6, 0x07130f, 0.0085]
];
const fogA = new THREE.Color(), fogB = new THREE.Color();
function fogAt(u) {
  let i = 0;
  while (i < FOG.length - 2 && u > FOG[i + 1][0]) i++;
  const [u0, c0, d0] = FOG[i], [u1, c1, d1] = FOG[i + 1];
  const t = smooth(u0, u1, u);
  scene.fog.color.copy(fogA.set(c0)).lerp(fogB.set(c1), t);
  scene.fog.density = lerp(d0, d1, t);
}

const chapters = [...document.querySelectorAll('.chapter')];
const SIDE = { left: -1, right: 1, center: 0 };
let anchors = [], sides = [];
function measureAnchors() {
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  anchors = chapters.map((c, i) => {
    if (i === 0) return 0;
    if (i === chapters.length - 1) return max;
    return clamp(c.offsetTop + c.offsetHeight / 2 - innerHeight / 2, 0, max);
  });
  sides = chapters.map(c => SIDE[c.dataset.side] ?? 0);
}
function scrollU() {
  const y = scrollY;
  for (let i = 0; i < anchors.length - 1; i++) {
    if (y <= anchors[i + 1]) {
      const span = anchors[i + 1] - anchors[i];
      return i + (span > 0 ? clamp((y - anchors[i]) / span, 0, 1) : 0);
    }
  }
  return anchors.length - 1;
}

/* ---------- resize ---------- */
let W = 0, H = 0;
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H, false);
  composer.setSize(W, H);
  bloom.setSize(W, H);
  const pr = renderer.getPixelRatio();
  occRT.setSize(Math.round(W * pr * 0.5), Math.round(H * pr * 0.5));
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  measureAnchors();
}
addEventListener('resize', resize);
resize();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureAnchors);
if (document.fonts && document.fonts.load) {
  document.fonts.load('48px "Noto Sans Runic"', 'ᛊᛃᛞ')
    .then(f => { if (f.length) runeTextures.forEach(t => t.userData.redraw()); })
    .catch(() => {});
}
addEventListener('load', measureAnchors);
addEventListener('ygg:content', measureAnchors);

/* ---------- frame ---------- */
let u = scrollU(), side = 0, first = true;
const pointer = new THREE.Vector2(), pointerS = new THREE.Vector2();
addEventListener('pointermove', e => { pointer.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5); }, { passive: true });

const camPos = V(), camLook = V(), tmp = V(), proj = V();
const N = KEYS.length - 1;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  uTime.value += reduceMotion ? dt * 0.3 : dt;

  const target = scrollU();
  u = first || reduceMotion ? target : lerp(u, target, 1 - Math.exp(-dt * 3.2));
  const i = Math.min(Math.floor(u), N - 1);
  const f = smooth(0, 1, u - i);
  side = lerp(sides[i] ?? 0, sides[i + 1] ?? 0, f);

  posCurve.getPoint(u / N, camPos);
  lookCurve.getPoint(u / N, camLook);
  // portrait screens: step back so the tree fits
  if (W < H) camPos.sub(camLook).multiplyScalar(lerp(1, 1.35, clamp((H / W - 1) / 1.2, 0, 1))).add(camLook);
  pointerS.lerp(pointer, 1 - Math.exp(-dt * 2));
  camPos.x += pointerS.x * 3; camPos.y -= pointerS.y * 2;
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  const shift = mobile ? 0 : side * W * 0.17;
  if (shift) camera.setViewOffset(W, H, shift, 0, W, H); else camera.clearViewOffset();

  sky.position.copy(camera.position);
  sky.material.uniforms.uLow.value = smooth(3, 6, u);
  moon.position.copy(camera.position).addScaledVector(MOON_DIR, 1200);
  moon2.position.copy(camera.position).addScaledVector(MOON2_DIR, 1200);
  moon.quaternion.copy(camera.quaternion);
  moon2.quaternion.copy(camera.quaternion);

  fogAt(u);
  clouds.rotation.y = uTime.value * 0.004;
  runeRings.forEach((r, k) => { r.rotation.y = uTime.value * (k % 2 ? -0.06 : 0.05); });

  // the thread is spun as you descend
  const reveal = clamp((TRUNK_H - camPos.y + 30) / TRUNK_H, 0.08, 1);
  thread.geometry.setDrawRange(0, Math.floor(threadSegs * reveal) * 6 * 6);

  // god rays: the moon above the clouds, Urd's well at the roots
  const moonW = 1 - smooth(2.4, 3.3, u);
  const wellW = smooth(5.1, 5.8, u);
  const src = moonW >= wellW ? moon.position : WELL;
  proj.copy(src).project(camera);
  const onScreen = proj.z < 1 ? 1 - smooth(0.9, 1.7, Math.hypot(proj.x, proj.y)) : 0;
  godrays.uniforms.uLight.value.set((proj.x + 1) / 2, (proj.y + 1) / 2);
  godrays.uniforms.uIntensity.value = Math.max(moonW * 1.0, wellW * 0.8) * onScreen;
  godrays.uniforms.uTint.value.setRGB(...(moonW >= wellW ? [0.78, 0.86, 1.0] : [0.45, 0.85, 1.0]));

  if (godrays.uniforms.uIntensity.value > 0.01) { renderOcclusion(); godrays.enabled = true; }
  else godrays.enabled = false;

  composer.render();
  if (first) { first = false; ready(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
