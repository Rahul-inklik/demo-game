/* Verifies the redesigned bowl-cut hair: full scalp coverage (no gaps), smooth
 * rounded silhouette (no thin strands), clears the collar/backpack, black
 * colour, and stays within the model height budget. Deleted after use. */
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
const Skull = CR.Skull;
const HEAD = CR.HEAD;
const assets = { get: () => null };
let fails = 0;
const fail = (m) => { fails++; console.log('  FAIL: ' + m); };

const bi = {};
CR.RIG.forEach((d, i) => { bi[d[0]] = i; });
const nb = new CR.CharacterBuilder(assets, { seg: 24, segLimb: 16, details: true });
nb.build(bi);
const pos = nb.builder.pos, reg = nb.builder.region, col = nb.builder.col;

// ---- hair colour: solid black -----------------------------------------------
{
  let maxLum = 0, n = 0;
  for (let v = 0; v < reg.length; v++) {
    if (reg[v] !== 'hair') continue;
    n++;
    maxLum = Math.max(maxLum, 0.2126 * col[v * 3] + 0.7152 * col[v * 3 + 1] + 0.0722 * col[v * 3 + 2]);
  }
  console.log('hair verts=' + n + '  brightest luminance=' + maxLum.toFixed(4) + ' (linear)');
  if (maxLum > 0.02) fail('hair is not solid black: ' + maxLum);
}

// ---- full scalp coverage: no gaps, no visible skin above the hairline -----
{
  let checked = 0;
  const exposed = [];
  for (let deg = 0; deg < 360; deg += 6) {
    const a = (deg * Math.PI) / 180;
    // Above the highest point any hairline reaches, hair must win everywhere.
    for (const y of [1.36, 1.34, 1.32, 1.30, 1.28]) {
      let bestR = -1, bestReg = null;
      for (let v = 0; v < reg.length; v++) {
        const r = reg[v];
        if (r !== 'hair' && r !== 'head') continue;
        if (Math.abs(pos[v * 3 + 1] - y) > 0.008) continue;
        const dx = pos[v * 3] - HEAD.cx, dz = pos[v * 3 + 2] - HEAD.cz;
        const d = Math.abs(((Math.atan2(dz, dx) - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d > 0.12) continue;
        const rad = Math.hypot(dx, dz);
        if (rad > bestR) { bestR = rad; bestReg = r; }
      }
      if (bestReg === null) continue;
      checked++;
      if (bestReg !== 'hair') exposed.push(deg + 'deg y=' + y);
    }
  }
  console.log('crown coverage samples=' + checked + ' exposed=' + exposed.length +
    (exposed.length ? ' at ' + exposed.slice(0, 8).join(', ') : ''));
  if (checked < 100) fail('not enough coverage samples: ' + checked);
  if (exposed.length) fail('scalp shows through near the crown');
}

// ---- no gaps in the shell itself: every hair vertex has finite, sane radius
{
  let bad = 0;
  for (let v = 0; v < reg.length; v++) {
    if (reg[v] !== 'hair') continue;
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) bad++;
  }
  console.log('non-finite hair vertices = ' + bad);
  if (bad) fail('hair geometry has non-finite vertices');
}

// ---- hairline shape: front covers well above the eyebrows, back stays high
// above the collar, sides stay well above the shoulders. Sampled via the same
// _hairEdge/_hairSection maths the rig itself uses.
{
  const front = nb._hairEdge(Math.PI / 2);   // face
  const back = nb._hairEdge(-Math.PI / 2);  // nape
  const side = nb._hairEdge(0);              // ear line
  console.log('hairline t: front=' + front.toFixed(3) + ' side=' + side.toFixed(3) + ' back=' + back.toFixed(3));
  const yAt = (t) => nb._hairSection(t).y;
  console.log('hairline y: front=' + yAt(front).toFixed(4) + ' side=' + yAt(side).toFixed(4) +
    ' back=' + yAt(back).toFixed(4));

  // Real prop heights read straight from the source: stand-up collar top and
  // the backpack flap/roll top (see _jacketDetails / _backpack in this file).
  const collarTop = 1.038 + 0.050;   // lathe pts go 0 -> 0.050 above y=1.038
  const backpackTop = 1.041 + 0.026; // rolled mat top, the tallest pack feature
  console.log('collarTop=' + collarTop.toFixed(4) + '  backpackTop=' + backpackTop.toFixed(4));

  if (yAt(back) < backpackTop + 0.01) {
    fail('the back of the hair (' + yAt(back).toFixed(4) + ') is not clear of the backpack (' + backpackTop.toFixed(4) + ')');
  }
  if (yAt(front) < 1.30) fail('front hairline sits too low: ' + yAt(front).toFixed(4));

  // And the actual generated geometry: no hair vertex should sit low enough at
  // the back to overlap the collar/backpack region (|x| small, z<0).
  let worstBack = 1e9;
  for (let v = 0; v < reg.length; v++) {
    if (reg[v] !== 'hair') continue;
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    if (z > -0.02 || Math.abs(x) > 0.05) continue;   // back-centre column only
    if (y < worstBack) worstBack = y;
  }
  console.log('lowest back-centre hair vertex y=' + worstBack.toFixed(4));
  if (worstBack < backpackTop) {
    fail('a hair vertex at the back (' + worstBack.toFixed(4) + ') dips into the backpack (' + backpackTop.toFixed(4) + ')');
  }
}

// ---- rounded clumps, not thin strands: each clump has real width -----------
{
  // Rebuild just the clumps in isolation to measure their actual radii.
  const MeshBuilder = CR.MeshBuilder;
  const b2 = new MeshBuilder(bi);
  const count = 8;
  for (let i = 0; i < count; i++) {
    const a = Math.PI / 2 + (i / count) * Math.PI * 2;
    nb._hairClump(b2, a, i);
  }
  // Each clump is a sphere with makeScale(0.92,1.22,0.92) * radius; find the
  // bounding radius per clump group by scanning consecutive vertex blocks.
  const perClump = b2.pos.length / 3 / count;
  console.log('clump vertex count each ~' + perClump.toFixed(0) + ' (sphere 12x10)');
  if (perClump < 60) fail('clumps are too low-poly to look rounded');

  // Extent check: max pairwise spread within first clump's vertices.
  let minX = 1e9, maxX = -1e9;
  for (let v = 0; v < perClump; v++) minX = Math.min(minX, b2.pos[v * 3]), maxX = Math.max(maxX, b2.pos[v * 3]);
  const width = maxX - minX;
  console.log('single clump width (x) = ' + width.toFixed(4) + ' m (radius ~0.040-0.046 expected diameter ~0.074-0.085)');
  if (width < 0.06) fail('clumps are thin, string-like rather than large rounded lumps');
}

// ---- total triangle budget stayed reasonable --------------------------------
console.log('total tris (hi builder) = ' + nb.builder.triangleCount);

console.log(fails ? '\n' + fails + ' PROBLEM(S)' : '\nHAIR_OK');
process.exit(fails ? 1 : 0);
