/**
 * Config.js — single source of truth for tuning values, palette and level content.
 * Gameplay code never hard-codes numbers or text; it reads them from here.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

  /** Bright, toy-like palette. All colours are original to this project. */
  const Palette = {
    saffron: 0xff9a3c,
    white: 0xfdfdff,
    green: 0x1f9c22,
    chakra: 0x122f8f,

    snowLight: 0xf6fbff,
    snowShade: 0xd6e8fb,
    rockLight: 0x9a94ad,
    rockDark: 0x655f78,
    ice: 0x9fe4ff,
    iceDeep: 0x5fc0ea,
    wood: 0xa9713c,
    woodDark: 0x7a4f27,
    pineDark: 0x0f6b48,
    pineMid: 0x18885a,
    pineLight: 0x27a86a,
    tent: 0xff6f5e,
    tentAlt: 0x3fb6d8,
    fire: 0xffa42b,
    skinTone: 0xf0b98a,
    hoodie: 0x2f8fd8,
    trouser: 0x2b3a63,
    boot: 0x5b3a22,
    scarf: 0xff5f5f,
    yetiFur: 0xeaf3ff,
    yetiFurShade: 0xcfe4f7,
    yetiSkin: 0xa9c8e8,
    sunWarm: 0xfff0cf,
    skyTop: 0x2f8ed6,
    skyMid: 0x9ad8f6,
    skyLow: 0xfdf3e0,
    fog: 0xd8ecff,
    checkpointOff: 0x9fb6cf,
    checkpointOn: 0xffc94d,
    sparkle: 0xfff3b0,
    coinGold: 0xffd23f,
    coinGoldDeep: 0xe8a416,
  };

  const Config = {
    Palette,

    render: {
      // A tighter lens than a wide "map view": keeps the character prominent.
      fov: 55,
      near: 0.4,
      far: 900,
      maxPixelRatio: 1.9,
      shadowMapSize: 2048,
      fogNear: 90,
      fogFar: 520,
      exposure: 1.06,
    },

    player: {
      radius: 0.55,
      height: 1.75,
      walkSpeed: 5.4,
      runSpeed: 9.6,
      acceleration: 46,
      deceleration: 34,
      airControl: 0.62,
      turnRate: 12,
      jumpVelocity: 11.6,
      gravity: 26,
      maxFallSpeed: 62,
      coyoteTime: 0.16,
      jumpBuffer: 0.16,
      groundSnap: 0.9,
      stepUp: 1.6,
      spawn: { x: 0, z: -14 },
      spawnYaw: 0,

      /**
       * How the Tiranga sits in the boy's right hand (see Player._attachFlag).
       *
       * The flag group is parented to the handR bone, so `offset` is in that
       * bone's bind-space (and gets multiplied by the character scale), placing
       * the pole base in the middle of his mitten.
       *
       * `rotation` exists to cancel the carry pose. The shoulder/arm/forearm
       * chain holds the right arm at roughly -1.328 rad about X (plus small
       * rest tilts), which used to leave the pole leaning back over his
       * shoulder. These angles are the exact inverse of that accumulated
       * rotation, so the pole stands vertical and the cloth flies out to his
       * right. Retune the arm angles in Player._poseLocomotion and these need
       * recomputing to match.
       */
      flagGrip: {
        scale: 0.72,
        offset: { x: 0, y: -0.040, z: 0.004 },
        rotation: { x: 1.3275, y: 0.0659, z: 0.0753 },
      },

      /**
       * ---------------------------------------------------------------
       * CUSTOM 3D CHARACTER MODEL (Mixamo-rigged GLB/GLTF)
       * ---------------------------------------------------------------
       * By default the game uses its built-in procedural character. To use
       * your own Mixamo child model instead:
       *
       *   1. On mixamo.com, upload/auto-rig your character, then download
       *      each animation with format "glTF Binary (.glb)" and skin ON.
       *      If you download several animations, use "Add another
       *      animation" in Mixamo BEFORE downloading so they all end up in
       *      ONE .glb file with multiple named clips.
       *      Prefer the "In Place" root motion option for walk/run so the
       *      clip doesn't fight this game's own movement code.
       *   2. Put the file at assets/models/character.glb (or change the url
       *      below).
       *   3. Set enabled: true.
       *   4. If your Mixamo clips aren't auto-detected correctly (check the
       *      browser console for a list of clip names found in your file),
       *      fill in clipMap with the exact clip names.
       */
      model: {
        enabled: false,
        url: 'assets/models/character.glb',
        
        // Exact AnimationClip names from your file. Pre-filled here for the
        // standard Mixamo action set this game was tuned for:
        //   Idle, Run, Fast_Run, Jump, Left Turn, Right Turn, Talking, Victory
        // Leave any entry as null to let the game guess from clip names
        // containing keywords instead (see GLTFCharacter.js CLIP_KEYWORDS).
        // There is no dedicated "walk" or "land" clip in that pack, so:
        //   - walk (light movement) reuses "Run"
        //   - run (sprinting) uses "Fast_Run"
        //   - jumping up and falling both reuse "Jump" (one clip, no separate fall)
        //   - landing has no clip and simply falls back to idle/run
        //   - planting the flag reuses "Victory" (it flows straight into the
        //     celebrate pose anyway once the flag is planted)
        clipMap: {
          idle: 'Idle',
          walk: 'Run',
          run: 'Fast_Run',
          jumpUp: 'Jump',
          jumpFall: 'Jump',
          land: null,
          interact: 'Talking',
          plant: 'Victory',
          celebrate: 'Victory',
          turnLeft: 'Left Turn',
          turnRight: 'Right Turn',
        },
        // Seconds to crossfade between animation clips.
        crossfade: 0.25,
        /**
         * Turn-in-place detection: while grounded and moving slowly, a fast
         * change of facing direction plays "Left Turn"/"Right Turn" instead
         * of idle/walk. Tune these if turns feel too twitchy or too sluggish.
         */
        turnAngularSpeed: 1.4,   // rad/s of yaw change needed to trigger a turn clip
        turnMaxSpeed: 1.6,       // only while moving slower than this (world units/s)
        // If "Left Turn"/"Right Turn" play backwards from the way the
        // character actually turns on screen, flip this instead of swapping
        // the clip names above.
        turnDirectionFlipped: false,
      },
    },

    camera: {
      // Closer, tighter third-person framing so the hero reads clearly on
      // screen (roughly a fifth of the screen height) instead of looking tiny.
      distance: 7.2,
      minDistance: 3.4,
      maxDistance: 13,
      zoomStep: 0.9,
      height: 2.0,
      minPitch: -0.42,
      maxPitch: 1.15,
      startPitch: 0.26,
      sensitivity: 0.0026,
      dragSensitivity: 0.005,
      touchSensitivity: 0.0062,
      followRate: 9,
      lookRate: 12,
      collisionPad: 1.5,
      /** Snap in fast when terrain blocks the view... */
      collisionInRate: 16,
      /** ...but ease back out slowly so it never looks like a self-zoom. */
      collisionOutRate: 2.2,

      /**
       * Cinematic dialogue camera (the "two-shot" used while the boy talks to
       * the Yeti) — see CameraController.startConversation.
       *
       * The shot is a raised three-quarter angle looking DOWN on both
       * characters, which is what keeps the much-taller Yeti and the small boy
       * both comfortably inside the frame instead of the Yeti filling the
       * screen. The framing distance is solved from the camera's real fov and
       * aspect every time, so it is correct on phones and desktops alike.
       */
      dialogue: {
        /** How far the camera looks down on the pair, in radians (~30°). */
        elevation: 0.52,
        /** Rotation off dead-perpendicular, in radians — gives a 3/4 view. */
        skew: 0.42,
        /** Extra breathing room left/right and above/below the pair (metres). */
        padH: 1.8,
        padV: 1.5,
        /** Never sit closer than this, however small the pair measures. */
        minDistance: 7,
        /** Seconds for the camera to glide from gameplay view into the shot. */
        easeSeconds: 1.15,
        /** Gentle dolly-in over the conversation: fraction of distance, and how long. */
        pushIn: 0.07,
        pushInSeconds: 7,
        /** Slow orbital drift so the held shot never feels frozen. */
        driftAmount: 0.07,
        driftSpeed: 0.22,
      },
    },

    gameplay: {
      // Lives are spent by falling off the mountain and by wrong quiz answers.
      // At 0 lives it is game over; a few extra keep the climb fair and fun.
      startLives: 5,
      checkpointScore: 150,
      signScore: 75,
      quizScore: 300,
      summitScore: 800,
      timeBonusBase: 900,
      /** Falling this far below the trail corridor counts as "off the mountain". */
      fallDepth: 26,
      respawnDelay: 0.85,
      interactRange: 4.2,
    },

    /**
     * The floating golden star above every signboard (see Signboard.js). It is
     * purely a "this is worth score" marker, styled like a coin/reward icon so
     * it reads instantly as a bonus rather than as more scenery.
     */
    signStar: {
      /** Height above the signboard's own top edge. */
      height: 1.15,
      /** Point radii of the 3D star shape. */
      outerRadius: 0.30,
      innerRadius: 0.13,
      /** Extrusion thickness. */
      depth: 0.09,
      /** Bob + spin, so it never sits dead still. */
      bobAmplitude: 0.10,
      bobSpeed: 1.6,
      spinSpeed: 1.1,
      /** Pulsing emissive glow range. */
      glowMin: 0.85,
      glowMax: 1.6,
      glowSpeed: 2.2,
      /** Soft point light cast from the star. */
      lightIntensity: 1.1,
      lightDistance: 7,
      /** Halo sprite size, relative to outerRadius. */
      haloScale: 5.4,
    },

    /**
     * On-screen touch controls — mobile only (TouchControls.js is created just
     * for touch devices, see DeviceProfile).
     *
     * Sprinting is AUTOMATIC, the way PUBG Mobile and Free Fire do it: the Run
     * button is never required. Push the thumbstick fully forward and simply
     * keep holding it there — after `sprintHoldTime` seconds the boy breaks
     * into a sprint on his own and stays sprinting until the stick eases back
     * off. Player speed (and therefore the Idle/Walk/Run animation the mixer
     * plays) follows from that automatically, since Player.js picks its clip
     * from real movement speed.
     */
    touch: {
      /**
       * Seconds the stick must be held past `sprintJoystickThreshold` before
       * the sprint kicks in.
       */
      sprintHoldTime: 3.0,
      /** Stick deflection (0..1) that counts as "pushed fully forward". */
      sprintJoystickThreshold: 0.9,
      /**
       * Once sprinting, keep going until deflection drops below this. The gap
       * between the two thresholds is what stops the sprint flickering off when
       * the thumb drifts a few pixels while steering.
       */
      sprintReleaseThreshold: 0.62,
      /**
       * How "forward" the stick must point to begin charging a sprint, as the
       * cosine of the angle away from straight up (0.55 ≈ a 57° cone either
       * side of forward). Sideways and backwards pushes stay a walk.
       */
      sprintForwardBias: 0.55,
      /**
       * How fast the charge-up bleeds away when the stick eases off, as a
       * multiple of real time. Above 1 so a deliberate release cancels quickly,
       * while a momentary wobble costs barely any progress.
       */
      sprintDecayRate: 2.2,
    },

    /**
     * The collapsing wooden bridge over Chandani Gorge (see src/entities/Bridge.js).
     * Stepping onto the deck shakes it briefly as a warning, then planks fall
     * one by one, chasing the player toward whichever end is closer to the
     * side they entered from.
     */
    bridge: {
      /** Seconds the deck shakes before the first plank falls. */
      shakeDuration: 1.1,
      /** How far planks jostle during the shake (world units). */
      shakeAmplitude: 0.05,
      /** Seconds between each additional plank giving way. */
      plankFallInterval: 0.22,
      /** Seconds a single plank takes to tip and drop out of the way. */
      plankFallDuration: 0.9,
    },

    /** Elevation of the trail centre along +Z (the climb axis). */
    spine: [
      [-140, -14], [-60, -4], [-20, -0.6], [0, 0], [22, 0.8], [42, 2.6], [62, 5.2],
      [80, 8.4], [96, 10.6], [112, 12.6], [130, 21], [150, 32], [170, 43.5],
      [186, 51], [202, 55], [218, 58.5], [234, 62], [246, 65.5], [262, 69.5],
      [278, 74], [292, 81], [306, 87], [320, 91.5], [340, 93], [460, 94]
    ],

    /** Half-width of the walkable trail corridor along +Z. */
    corridor: [
      [-140, 62], [-40, 54], [0, 46], [24, 42], [46, 30], [70, 25], [84, 15],
      [108, 15], [122, 21], [142, 17], [166, 16], [180, 9], [192, 5.2],
      [220, 5.2], [236, 8], [248, 10], [280, 10], [294, 17], [308, 24],
      [330, 34], [460, 36]
    ],

    /** Gentle S-curve of the trail centre in X (keeps the climb interesting). */
    trailCurve: [
      [-140, 0], [0, 0], [50, 6], [90, 2], [140, -8], [190, -3],
      [240, 5], [280, 2], [320, 0], [460, 0]
    ],

    /** Deep gaps carved across the trail. Each is crossed by bridges or ice platforms. */
    chasms: [
      { from: 84, to: 108, depth: 44, feather: 5 },   // gorge with the frozen river + wooden bridge
      { from: 243, to: 281, depth: 52, feather: 5 }   // ice-platform crossing
    ],

    /** Forced-flat pads: readable landing zones, bridge heads and plateaus. */
    pads: [
      { x: 0, z: -14, w: 46, d: 42, y: 0, feather: 8 },      // village campsite
      { x: 4, z: 78, w: 20, d: 16, y: 8.6, feather: 6 },     // south bridge head
      { x: 2, z: 114, w: 20, d: 16, y: 12.9, feather: 12 },  // north bridge head
      { x: -8, z: 166, w: 22, d: 20, y: 42, feather: 16 },   // rocky rest ledge
      { x: -3, z: 236, w: 18, d: 14, y: 62, feather: 4 },    // ridge exit
      { x: 5, z: 240, w: 14, d: 8, y: 64.4, feather: 3 },    // ice-field launch pad
      { x: 2, z: 284, w: 18, d: 12, y: 77.2, feather: 14 },  // ice-field landing
      { x: 0, z: 320, w: 46, d: 32, y: 92.0, feather: 16 }   // summit plateau
    ],

    /** Checkpoints in climb order. The first one is claimed automatically at spawn. */
    checkpoints: [
      { id: 0, name: 'Base Camp', x: 0, z: -6, objective: 'Follow the trail north into the pine forest' },
      { id: 1, name: 'Pine Forest', x: 6, z: 58, objective: 'Cross the wooden bridge over Chandani Gorge' },
      { id: 2, name: 'Chandani Bridge', x: 2, z: 114, objective: 'Climb the rocky path to Sunrise Ledge' },
      { id: 3, name: 'Sunrise Ledge', x: -8, z: 166, objective: 'Walk carefully along the narrow snow ridge' },
      { id: 4, name: 'Sky Ridge', x: -3, z: 236, objective: 'Hop across the floating ice platforms' },
      { id: 5, name: 'Ice Field', x: 2, z: 285, objective: 'Say hello to the friendly Yeti' }
    ],

    /** Educational signboards (press E). Original wording written for this game. */
    signboards: [
      {
        id: 'sign-flag',
        x: -7, z: 12,
        title: 'Our Tiranga',
        text: 'The Indian National Flag has three colour bands: saffron for courage, white for peace and truth, and green for growth and prosperity. In the white band sits the navy-blue Ashoka Chakra with 24 spokes, standing for the wheel of progress that never stops turning.'
      },
      {
        id: 'sign-1947',
        x: 11, z: 46,
        title: '15 August 1947',
        text: 'India became independent on 15 August 1947. The tricolour we carry today was adopted a few weeks earlier, on 22 July 1947, by the Constituent Assembly. Every Independence Day, the flag is hoisted at the Red Fort in Delhi.'
      },
      {
        id: 'sign-anthem',
        x: -6, z: 124,
        title: 'Jana Gana Mana',
        text: 'Our national anthem, "Jana Gana Mana", was written by Rabindranath Tagore. It was adopted as the national anthem on 24 January 1950 and takes about 52 seconds to sing. When it plays, we stand still to show respect.'
      },
      {
        id: 'sign-heroes',
        x: -14, z: 172,
        title: 'Brave Hearts of the Freedom Struggle',
        text: 'Countless people worked for India\'s freedom: Rani Lakshmibai of Jhansi, Mangal Pandey, Bhagat Singh, Sarojini Naidu, Subhas Chandra Bose, Sardar Vallabhbhai Patel and Mahatma Gandhi. Some marched peacefully, some fought bravely — all of them dreamed of a free India.'
      },
      {
        id: 'sign-flagcode',
        x: 8, z: 296,
        title: 'Respecting the Flag',
        text: 'The Flag Code of India tells us how to treat the Tiranga with respect: it should never touch the ground, never be flown upside down, and always be raised briskly and lowered slowly. Carrying it to a mountain top is a proud salute to our country.'
      }
    ],

    /** One educational quiz, hosted by the friendly Yeti near the summit. */
    quiz: {
      title: "Yeti's History Quiz",
      questions: [
        {
          question: 'Who is known as the first freedom fighter of India?',
          options: ['Mahatma Gandhi', 'Bhagat Singh', 'Mangal Pandey', 'Subhas Chandra Bose'],
          answer: 2,
          fact: 'Mangal Pandey, a soldier at Barrackpore, sparked the revolt of 1857 and is remembered as India\'s first freedom fighter.'
        },
        {
          question: 'On which date did India become an independent nation?',
          options: ['26 January 1950', '15 August 1947', '2 October 1869', '22 July 1947'],
          answer: 1,
          fact: 'India became independent on 15 August 1947. 26 January 1950 is Republic Day, when our Constitution came into force.'
        },
        {
          question: 'How many spokes does the Ashoka Chakra on the flag have?',
          options: ['12', '18', '24', '32'],
          answer: 2,
          fact: 'The Ashoka Chakra has 24 spokes, inspired by the wheel on the Lion Capital of Ashoka at Sarnath.'
        }
      ]
    },

    /** Friendly Yeti dialogue: greeting, quiz intro, reactions, farewell. */
    yeti: {
      name: 'Bholu the Yeti',
      position: { x: 4, z: 297 },
      triggerRadius: 7.5,
      /**
       * Centre-to-centre distance (world units ≈ metres) the Yeti steps to
       * when appearing for the face-to-face greeting:
       *
       *   Player 😊 |\   1.5–2 m   /| 🐻 Yeti
       *
       * The Yeti is a big, scaled-up giant (body radius ≈ 1.62 m facing the
       * player) and the boy has a body radius of Config.player.radius (0.55 m),
       * so this value already accounts for both bodies — the actual visible
       * gap between them works out to roughly 1.5–2 m, not a plain
       * human-scale distance.
       */
      greetDistance: 3.9,
      greeting: [
        'Namaste, little warrior! I am Bholu, keeper of these snows.',
        'You carried the Tiranga all the way up here? How brave!',
        'Before the summit, answer my history questions — knowledge keeps a flag flying.'
      ],
      correct: [
        'Shabaash! That is exactly right.',
        'Wonderful! You have been reading the signboards.',
        'Yes! Your history is as strong as your legs.'
      ],
      wrong: [
        'Oh! Not quite. Take a breath and think again.',
        'Almost! Try once more, my brave friend.',
        'Hmm, not that one. You can do it!'
      ],
      finished: [
        'Perfect! The summit path is yours, flag warrior.',
        'Go on — plant the Tiranga where the whole sky can see it!'
      ]
    },

    /** Summit flag pole + celebration area. */
    summit: {
      flagPole: { x: 0, z: 322 },
      poleHeight: 9.5
    },

    audio: {
      masterVolume: 0.85,
      musicVolume: 0.3,
      ambienceVolume: 0.28,
      sfxVolume: 0.55,

      /**
       * ---------------------------------------------------------------
       * CUSTOM BACKGROUND MUSIC
       * ---------------------------------------------------------------
       * Put your own MP3 file at:   assets/audio/background-music.mp3
       * (keep that exact name, or change the path below to match your file)
       *
       * If the file is present it becomes the background music and loops for
       * the whole game. If it is missing or the browser cannot play it, the
       * game automatically falls back to the built-in synthesised music, so
       * nothing ever breaks. Set musicTrack to null to force the synth music.
       */
      musicTrack: 'assets/audio/background-music.mp3',
      /** Loudness of your MP3, 0..1 (this is multiplied by masterVolume). */
      musicTrackVolume: 0.5,
      /** Loop the track forever (recommended for background music). */
      musicTrackLoop: true,
      /** Seconds used to fade the music in when it starts / out when it stops. */
      musicFadeSeconds: 1.4,
    },
  };

  TFW.Config = Config;
})(window);
