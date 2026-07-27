CUSTOM 3D CHARACTER — using your own Mixamo child model
========================================================

The game is now pre-configured for this exact Mixamo action set:

    Idle, Run, Fast_Run, Jump, Left Turn, Right Turn, Talking, Victory

If your .glb file has clips with exactly these names, you only need to do
steps 1 and 2 below — the mapping in Config.js is already done for you.

STEP 1 — Where to put the file
--------------------------------
Copy your exported file into this folder and name it exactly:

    assets/models/character.glb

Full path:
    assets/models/character.glb

(If you'd rather use a different name or folder, change
Config.player.model.url to match — see step 3.)

STEP 2 — Turn it on
--------------------
Open src/core/Config.js, find "player.model" and set:

    model: {
      enabled: true,
      ...
    }

Reload the game (Ctrl + F5) and press Play. The built-in procedural
character is used until your model finishes loading, then it's swapped in
automatically. If the file is missing or fails to parse, the game just
keeps the built-in character and prints a warning in the browser console
(F12) — nothing breaks.

STEP 3 — How your 8 actions are used in-game
-----------------------------------------------
This is already wired up in Config.player.model.clipMap, shown here for
reference:

    Idle        -> standing still / not moving
    Run         -> used for WALKING pace (there's no separate walk clip)
    Fast_Run    -> used for RUNNING pace (holding Shift / sprinting)
    Jump        -> used for both jumping up and falling (one clip covers both)
    Left Turn   -> playing when turning left while standing/slow-moving
    Right Turn  -> playing when turning right while standing/slow-moving
    Talking     -> playing while interacting (pressing E at signs/checkpoints)
    Victory     -> playing when planting the flag AND for the victory
                   celebration right after (it's one continuous clip across
                   both, since Victory already reads as a celebration)

There's no dedicated "landing" clip in this pack, so landing just falls
straight back to Idle/Run — this looks fine with Mixamo's Jump clip since
it already has its own landing frames built in.

If your file uses slightly different clip names (e.g. "Jumping" instead
of "Jump", or "Fast Run" with a space instead of "Fast_Run"), the game
tries an automatic keyword match first. If that still doesn't find the
clip, open the browser console (F12) after enabling the model — it prints
every clip name it actually found in your file. Copy the exact name into
the matching slot in Config.player.model.clipMap, e.g.:

    clipMap: {
      idle: 'Idle',
      walk: 'Run',
      run: 'Fast Run',   // <- your file's exact name
      ...
    }

STEP 4 — Turn-in-place feels off?
------------------------------------
Turning left/right only plays "Left Turn"/"Right Turn" while the
character is standing still or moving slowly and rotating quickly (e.g.
spinning the camera around while parked). While walking or running, the
Run/Fast_Run clip is used instead — real turning happens smoothly via the
character's own root rotation, same as before.

Two knobs in Config.player.model control this:

    turnAngularSpeed: 1.4   // how fast you must turn (rad/s) to trigger it
    turnMaxSpeed: 1.6       // only triggers below this movement speed

If "Left Turn" plays when you're actually turning right (or vice versa),
set:

    turnDirectionFlipped: true

Notes
-----
- Your model is scaled automatically to match Config.player.height, and
  positioned so its feet sit on the ground — no manual scaling needed.
- The Tiranga flag is attached to the model's right-hand bone
  automatically if a bone named like "RightHand"/"mixamorig:RightHand"
  is found. If it can't find one, the flag stays attached to the
  built-in character's hand instead (nothing breaks, it just won't
  follow the custom model's hand).
- Camera framing (look-at height) is taken from the model's head bone if
  found, otherwise from its overall height.
- Only .glb/.gltf files are supported (this is the standard Mixamo
  export format). FBX is not supported directly.
