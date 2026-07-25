# The Flag Warrior – Kids' Tiranga Quest

A bright, family‑friendly **3D educational adventure** built with **Three.js** and plain
HTML/CSS/JavaScript. You play a young child carrying the Indian National Flag,
climbing a stylised snowy Himalayan trail. Reach the summit, meet **Bholu the
friendly Yeti**, answer a short history quiz, plant the **Tiranga**, and enjoy a
fireworks finale.

Everything in the game is **original and generated in code** — textures, the
flag with its 24‑spoke Ashoka Chakra, characters, terrain, music and sound
effects. There are no downloaded images or audio files, so the game works
completely offline.

---

## How to play (quick start)

**Option A — just open it**
1. Double‑click `index.html`. It opens in your browser and plays immediately.

**Option B — run a tiny local server** (recommended; avoids any browser
file‑access quirks)

```bash
# From this folder, pick whichever you have installed:
python -m http.server 8000
# or
npx serve .
```
Then visit `http://localhost:8000` and press **▶ Play**.

> Requirements: any modern browser with WebGL (Chrome, Edge, Firefox, Safari).
> The first screen builds all the artwork with a progress bar, then shows the
> title screen.

### Controls — touch (phones & tablets)
On-screen controls appear **only on touch devices**:

| Action | Touch |
| --- | --- |
| Move | Left **thumbstick** (anchors wherever your thumb lands) |
| Run | Push the stick to the ring edge, or tap **Run** to keep running |
| Jump | **Jump** button |
| Interact / read signs / plant flag | **E** button (glows green when something is in range) |
| Rotate camera | Drag anywhere on the **right** half |
| Zoom | **Pinch** |
| Answer the quiz | Tap an answer |
| Pause | **⏸** top right |

Landscape is recommended — a gentle "turn your device" nudge appears in portrait.

### Controls — desktop
| Action | Keys |
| --- | --- |
| Move | **W A S D** or **Arrow keys** |
| Run | **Shift** (hold) |
| Jump | **Space** |
| Interact / read signs / plant flag | **E** |
| Rotate camera | **Mouse** (click‑drag or pointer‑lock) |
| Zoom | **Mouse wheel** |
| Answer the quiz | **1–4** or click an option |
| Pause | **P** or **Esc** |

### The journey
Base Camp → Pine Forest → **Chandani wooden bridge** (over a frozen gorge) →
Sunrise Ledge → Sky Ridge → **floating ice platforms** → the Yeti's history quiz
→ the summit → **plant the Tiranga** → victory cinematic with fireworks.

If you slip off the trail into a chasm, you respawn at your **latest
checkpoint** (no lives lost — falling is just a gentle do‑over). Lives are only
spent on wrong quiz answers, and you can always retry.

---

## What was built

This project started with the HTML shell, the CSS, and a handful of core
modules (`Utils`, `Config`, `AssetLoader`, `Input`) plus the audio/effects/quiz
systems. The following modules were added to complete a fully playable game:

| Module | Responsibility |
| --- | --- |
| `src/ui/UI.js` | Owns every DOM screen/HUD/overlay: title, loading, error, HUD, toasts, subtitles, sign popup, quiz modal, pause, victory, game‑over, fades. Turns clicks/keys into callbacks, and switches the layout/help text for touch devices. |
| `src/core/DeviceProfile.js` | Detects touch support and device class at boot, then picks a **quality tier** (low / medium / high) and writes the budgets into `Config.quality` **before** the world is built — pixel ratio, shadow map size, terrain resolution, tree/rock/bird/decor counts, snow and particle pools, fog distance and character LOD distance. Also honours `prefers-reduced-motion` and `saveData`. |
| `src/ui/TouchControls.js` | The on-screen pad, mounted **only on touch devices**: an anchoring virtual thumbstick (push to the edge to run), Jump / Interact / Run buttons, right-half drag to orbit the camera and pinch to zoom. Feeds the same intent API the keyboard uses, so no gameplay code branches on input type. |
| `src/core/CameraController.js` | Smooth, damped third‑person orbit camera with mouse look, zoom, **analytic terrain collision** (no expensive raycasts) and a summit **cinematic** mode. |
| `src/world/Terrain.js` | The procedural snow mountain. Fully **analytic height field** (`heightAt`) built from an elevation spine, trail curve, corridor widths, flat pads and carved chasms — so what you see is exactly what you walk on. |
| `src/world/Environment.js` | HDR‑style gradient **sky** dome + sun glow, warm key light with **dynamic shadows**, hemisphere/ambient fill, **fog**, a player‑following **snow field**, drifting **clouds**, and a soft PMREM environment map. |
| `src/entities/Flag.js` | The Tiranga with a **procedurally waving cloth** (layered sine waves, stronger toward the free edge). Used for the carried flag and the big planted flag. |
| `src/entities/Checkpoint.js` | Banner gates that light up (grey → gold), spin and bob when reached. |
| `src/entities/Signboard.js` | Interactable wooden signs carrying original educational facts (press **E**). |
| `src/world/Course.js` | Assembles the whole level on the terrain: the **wooden bridge**, **floating ice platforms**, base‑camp tents + campfire, **pine forests**, snow‑covered rocks, the summit shrine + prayer flags, and all checkpoints/signs. Exposes the combined walkable surface. |
| `src/entities/CharacterRig.js` | Builds the hero child as **one procedural `SkinnedMesh`**: a real `Bone` skeleton, a single continuous lofted body with blended skin weights (smooth joints, no seams), clothing/hair/boots/gloves/scarf/backpack via `LatheGeometry`/`TubeGeometry`/`ExtrudeGeometry`/`ShapeGeometry`, facial **morph targets**, `MeshPhysicalMaterial` with procedural normal/roughness/AO maps, and a 2‑level `LOD` (~11.5k tris). |
| `src/entities/Player.js` | The movement controller (accel/decel, running, gravity, jumping, coyote time, ground snapping, step‑up walls, fall detection) that **drives the `CharacterRig` skeleton** — bone‑based idle/walk/run/jump/land/interact/plant/celebrate animation and morph‑target expressions, carrying the flag. |
| `src/entities/Yeti.js` | Bholu, the big friendly guide, with **idle / wave / talk / point / celebrate** animation states. Never attacks. |
| `src/core/GameManager.js` | All gameplay **rules and flow**: score, lives, timer, checkpoints, respawn, Yeti dialogue, the quiz sequence, flag planting, the victory cinematic and game‑over. |
| `src/core/Game.js` | Top‑level orchestrator: renderer/scene/camera setup, world + system creation, input wiring, resize handling and the render loop. Rendering lives here; rules live in `GameManager`. |
| `src/main.js` | Bootstrap: verifies the engine loaded, builds artwork with a real progress bar, wires the UI buttons, and shows clear error overlays — **no silent fallbacks**. |

### Features delivered
- Third‑person controller with smooth, responsive movement and satisfying running.
- Stable, cinematic, damped follow camera with collision and a scripted ending shot.
- One handcrafted trail: base camp, snowy path, pine forests, snow rocks, a
  narrow wooden bridge, ice‑platform crossing, ledges/cliffs and a summit
  celebration zone that naturally guides you upward.
- Friendly Yeti that auto‑starts the quiz, reacts to answers, and points you on.
- Educational quiz (Mangal Pandey, 15 Aug 1947, the 24 Ashoka Chakra spokes)
  with score on correct, life lost + retry on wrong.
- Score, lives, timer, checkpoints, fall‑respawn, restart (from pause, victory
  and game‑over) and a victory screen with completion time and final score.
- Particle effects for running, snow footprints, falling snow, checkpoints,
  quiz success, flag planting, fireworks and confetti, plus camera shake and
  smooth fade/flash transitions.
- Fully synthesised audio: gentle background music, wind ambience that grows
  with altitude, footsteps, quiz/flag/UI sounds and a victory fanfare.
- **Mobile support** from a single `index.html`: touch controls that appear only
  on touch devices, a responsive HUD/quiz/menu layout (including short landscape
  phones and notch-safe insets), automatic quality tiers, `visualViewport`-aware
  resizing for the mobile URL bar, FOV widening in portrait, and auto-pause when
  the tab is backgrounded.

### How it was verified
- **Syntax‑checked** every JavaScript module with `node --check`.
- **Validated the level math** headlessly (real `Terrain`/`Config` code): the
  centre‑line trail has no unwalkable steps, every checkpoint/sign/landmark
  sits on solid ground, chasms are deeper than the fall threshold, the corridor
  never pinches shut, and the climb gains ~92 m.
- **Ran a headless runtime smoke test** that drives the real world, entities and
  `GameManager` through a full playthrough (spawn → all checkpoints → sign →
  fall/respawn → Yeti quiz → flag plant → cinematic → victory) to catch runtime
  errors.

---

## Project structure

```
web game new/
├─ index.html            # markup for canvas + all UI screens; loads modules in order
├─ styles/main.css       # bright, rounded, family-friendly UI styling
├─ vendor/three.min.js   # the Three.js engine (vendored so it runs offline)
├─ README.md
└─ src/
   ├─ main.js                    # bootstrap + error handling
   ├─ core/
   │  ├─ Utils.js                # math/helpers (noise, curves, damping, timing)
   │  ├─ Config.js               # ALL tuning, palette and level/quiz content
   │  ├─ AssetLoader.js          # procedural textures (flag, snow, rock, wood, ice…)
   │  ├─ Input.js                # keyboard + mouse + touch intent
   │  ├─ DeviceProfile.js        # device detection + quality tiers
   │  ├─ CameraController.js     # third-person + cinematic camera
   │  ├─ GameManager.js          # gameplay rules & flow
   │  └─ Game.js                 # orchestrator + render loop
   ├─ systems/
   │  ├─ Audio.js                # synthesised music, ambience, SFX
   │  ├─ Effects.js              # pooled particles, footprints, fireworks, shake
   │  └─ Quiz.js                 # pure quiz logic (no DOM)
   ├─ world/
   │  ├─ Terrain.js              # analytic snow mountain + mesh
   │  ├─ Environment.js          # sky, lights, fog, snow, clouds
   │  └─ Course.js               # bridges, platforms, forests, props, entities
   ├─ entities/
   │  ├─ CharacterRig.js         # procedural SkinnedMesh: bones, morphs, LOD
   │  ├─ Player.js               # controller + bone/morph animation
   │  ├─ Yeti.js                 # friendly guide + animation states
   │  ├─ Flag.js                 # waving Tiranga
   │  ├─ Checkpoint.js           # banner gates
   │  └─ Signboard.js            # educational signs
   └─ ui/
      ├─ UI.js                   # all DOM screens/HUD/overlays
      └─ TouchControls.js        # on-screen pad (touch devices only)
```

## Tuning & extending
Almost everything you'd want to tweak lives in **`src/core/Config.js`**: the
colour palette, player speeds/jump, camera feel, scoring, the trail shape
(`spine`, `trailCurve`, `corridor`, `pads`, `chasms`), checkpoints, signboard
text, the quiz questions and the Yeti's dialogue. Gameplay code reads from here
rather than hard‑coding values, so you can reshape the level or swap in new
questions without touching the systems.

## Notes & credits
- Original educational adventure. Characters, environment, props, colours and
  level design are created for this project; no commercial game assets are used.
- Built with [Three.js](https://threejs.org/) (vendored in `vendor/`).
- Historical facts are presented for children's learning. **Jai Hind! 🇮🇳**
