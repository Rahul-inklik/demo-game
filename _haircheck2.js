/* Raycast-based coverage check against the REAL triangulated mesh (not nearest-
 * vertex heuristics), plus the backpack/collar clearance and colour checks.
 * Deleted after use. */
'use strict';
const fs = require('fs');
const vm = require('vm');
global.window = global;
global.self = global;
global.document = { createElementNS: () => ({ style: {}, getContext: () => null }) };
vm.runInThisContext(fs.readFileSync('vendor/three.min.js', 'utf8'), { filename: 'three.min.js' });
vm.runInThisContext(fs.readFileSync('src/core/Utils.js', 'utf8'), { filename: 'Utils.js' });
vm.runInThisContext(fs.readFileSync('src/core/Config.js', 'utf8'), { filename: 'Config.js' });
vm.runInThisContext(fs.readFileSync('src/entities/CharacterRig.js', 'utf8'), { filename: 'CharacterRig.js' });

const CR = global.TFW.CharacterRig;
const HEAD = CR.HEAD;
const assets = { get: () => null };
let fails = 0;
const fail = (m) => { fails++; console.log('  FAIL: ' + m); };

const bi = {};
CR.RIG.forEach((d, i) => { bi[d[0]] = i; });
const nb = new CR.CharacterBuilder(assets, { seg: 24, segLimb: 16, details: true });
const geo = nb.build(bi);   // real built + normal-computed BufferGeometry

// Region lookup per vertex is on nb.builder.region (parallel array to positions).
const region = nb.builder.region;
const indexArr = geo.index.array;
// Map each triangle to the region of its first vertex (regions are per-part).
function regionOfFace(faceIndex) {
  const i0 = indexArr[faceIndex * 3];
  return region[i0];
}

const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
mesh.updateMatrixWorld(true);
const raycaster = new THREE.Raycaster();

// Cast rays radially inward, from far outside toward the head axis, at a grid
// of angles and heights spanning the whole scalp area (well above the collar
// and well below the crown), and check the FIRST surface hit.
let checked = 0;
const skinHits = [];
for (let deg = 0; deg < 360; deg += 4) {
  const a = (deg * Math.PI) / 180;
  const dirX = -Math.cos(a), dirZ = -Math.sin(a);
  for (const y of [1.40, 1.38, 1.36, 1.34, 1.32, 1.30]) {
    const origin = new THREE.Vector3(HEAD.cx - dirX * 0.6, y, HEAD.cz - dirZ * 0.6);
    const dir = new THREE.Vector3(dirX, 0, dirZ).normalize();
    raycaster.set(origin, dir);
    raycaster.far = 1.2;
    const hits = raycaster.intersectObject(mesh, false);
    if (!hits.length) continue; // ray missed the head entirely at this height (above crown) - not an error
    checked++;
    const r = regionOfFace(hits[0].faceIndex);
    if (r !== 'hair') skinHits.push(deg + 'deg y=' + y + ' region=' + r);
  }
}
console.log('raycast coverage: rays hit=' + checked + '  non-hair first-hit=' + skinHits.length +
  (skinHits.length ? '\n    ' + skinHits.slice(0, 20).join('\n    ') : ''));
if (checked < 200) fail('too few rays actually hit the head: ' + checked);
if (skinHits.length) fail('scalp is the first surface hit at ' + skinHits.length + ' sample(s)');

// ---- back-of-head clearance above the collar/backpack, via raycast --------
{
  const collarTop = 1.038 + 0.050;
  const backpackTop = 1.041 + 0.026;
  const clearance = Math.max(collarTop, backpackTop) + 0.01;
  let lowestHairY = 1e9;
  for (let deg = 150; deg <= 210; deg += 3) {
    const a = (deg * Math.PI) / 180;
    const dirX = -Math.cos(a), dirZ = -Math.sin(a);
    for (let y = 1.30; y >= 1.00; y -= 0.005) {
      const origin = new THREE.Vector3(HEAD.cx - dirX * 0.6, y, HEAD.cz - dirZ * 0.6);
      const dir = new THREE.Vector3(dirX, 0, dirZ).normalize();
      raycaster.set(origin, dir);
      raycaster.far = 1.2;
      const hits = raycaster.intersectObject(mesh, false);
      if (!hits.length) continue;
      const r = regionOfFace(hits[0].faceIndex);
      if (r === 'hair' && y < lowestHairY) lowestHairY = y;
    }
  }
  console.log('lowest hair surface at the back (150-210deg) = y=' + lowestHairY.toFixed(4) +
    '  (must stay above ' + clearance.toFixed(4) + ')');
  if (lowestHairY < clearance) {
    fail('hair at the back dips to y=' + lowestHairY.toFixed(4) + ', below the collar/backpack clearance ' + clearance.toFixed(4));
  }
}

// ---- colour ------------------------------------------------------------------
{
  const col = nb.builder.col;
  let maxLum = 0;
  for (let v = 0; v < region.length; v++) {
    if (region[v] !== 'hair') continue;
    maxLum = Math.max(maxLum, 0.2126 * col[v * 3] + 0.7152 * col[v * 3 + 1] + 0.0722 * col[v * 3 + 2]);
  }
  console.log('brightest hair luminance = ' + maxLum.toFixed(4));
  if (maxLum > 0.02) fail('hair not black: ' + maxLum);
}

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nHAIR_OK');
process.exit(fails ? 1 : 0);
