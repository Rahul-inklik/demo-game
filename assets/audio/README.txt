CUSTOM BACKGROUND MUSIC — where to put your MP3
================================================

1. Copy your music file into THIS folder.
2. Rename it to exactly:

       background-music.mp3

   Full path it must end up at:
       assets/audio/background-music.mp3

3. Reload the game (Ctrl + F5) and press Play. Your track starts with a soft
   fade-in and loops forever.

Want to keep a different file name?
-----------------------------------
Open  src/core/Config.js  and edit the audio block:

    musicTrack: 'assets/audio/background-music.mp3',   <-- your path here
    musicTrackVolume: 0.5,      // 0 = silent, 1 = full volume
    musicTrackLoop: true,       // loop forever
    musicFadeSeconds: 1.4,      // fade in / out time

Good to know
------------
* Only the BACKGROUND MUSIC is replaced. Footsteps, jumps, the quiz sounds,
  the wind ambience and the victory fanfare stay as they are.
* If this file is missing or the browser cannot play it, the game quietly goes
  back to its built-in synth music — nothing breaks.
* MP3 works in every modern browser. OGG / M4A / WAV also work if you point
  musicTrack at them.
* If you open index.html straight from the disk (file://) some browsers block
  local media. If you hear no music, run a tiny local server from the project
  folder instead:
      python -m http.server 8000        then open http://localhost:8000
* Please use music you own or that is licensed for use.
