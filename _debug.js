'use strict';
const fs = require('fs');
const vm = require('vm');
global.window = global; global.self = global;
global.document = { createElementNS: () => ({ style: {}, getContext: () => null }) };
vm.runInThisContext(fs.readFileSync('vendor/three.min.js', 'utf8'), { filename: 'three.min.js' });
vm.runInThisContext(fs.readFileSync('src/core/Utils.js', 'utf8'), { filename: 'Utils.js' });
vm.runInThisContext(fs.readFileSync('src/core/Config.js', 'utf8'), { filename: 'Config.js' });
vm.runInThisContext(fs.readFileSync('src/entities/CharacterRig.js', 'utf8'), { filename: 'CharacterRig.js' });
const CR = global.TFW.CharacterRig;
const HEAD = CR.HEAD;
const U = global.TFW.Utils;
const bi = {};
CR.RIG.forEach((d, i) => { bi[d[0]] = i; });
const nb = new CR.CharacterBuilder({ get: () => null }, { seg: 24, segLimb: 16, details: true });

console.log('edge(0)=' + nb._hairEdge(0).toFixed(4) + ' edge(pi/2)=' + nb._hairEdge(Math.PI/2).toFixed(4) +
  ' edge(pi)=' + nb._hairEdge(Math.PI).toFixed(4) + ' edge(-pi/2)=' + nb._hairEdge(-Math.PI/2).toFixed(4));

for (const t of [0.10, 0.30, 0.50, 0.53, 0.60, 0.80, 1.0]) {
  const s = nb._hairSection(t);
  console.log('hairSection t=' + t.toFixed(2) + ' y=' + s.y.toFixed(4) + ' rx=' + s.rx.toFixed(4) + ' rz=' + s.rz.toFixed(4));
}
for (const t of [0.10, 0.30, 0.50, 0.53, 0.60, 0.80, 1.0]) {
  const s = nb._skull(t);
  console.log('skull      t=' + t.toFixed(2) + ' y=' + s.y.toFixed(4) + ' rx=' + s.rx.toFixed(4) + ' rz=' + s.rz.toFixed(4));
}

// Simulate the offset() function at angle a=0 (side) across the t range used
// by _hairShell (0.10..1.0, 31 samples) to see where hair stands off vs buries.
const thickness = 0.026, buried = -0.020, feather = 0.045;
for (let i = 0; i <= 30; i++) {
  const t = U.lerp(0.10, 1.0, i / 30);
  const a = 0;
  const edge = nb._hairEdge(a);
  const k = U.smootherstep(U.clamp01((t - edge) / feather));
  const off = U.lerp(buried, thickness, k);
  const s = nb._hairSection(t);
  const finalOff = Math.max(off, -s.rx * 0.6);
  if (i % 3 === 0) console.log('i=' + i + ' t=' + t.toFixed(3) + ' y=' + s.y.toFixed(4) +
    ' edge=' + edge.toFixed(3) + ' k=' + k.toFixed(3) + ' off=' + finalOff.toFixed(4) +
    ' finalRx=' + (s.rx + finalOff).toFixed(4) + '  skullRx=' + nb._skull(t).rx.toFixed(4));
}
