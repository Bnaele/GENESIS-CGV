# Trailer v2 — what's left

Branch: `feature/trailer` (keep separate from `feature/banele-commander`).

## Already done (this session)

- Sorini idle animation in the prologue (no more T-pose; breathes while
  asleep, ramps to normal speed as she rises).
- Japan-themed INVASION card: Mount Fuji + snow cap, blood moon,
  vermilion torii, five-storey pagoda, gabled houses, ships overhead.
- Shared `TrailerOverlay` module (letterbox, captions, title cards,
  page-flip, REC, flash) used by both the director and the showcases.
- `AxiomTrueForm.forceShow()` — snap straight into the merged form
  indefinitely for the standoff shot.
- `level3.trailerRun()` — surroundings tour, Blade, Fist, then the
  Architect standoff with Sorini in True Form.
- `level2.trailerRun()` — Enforcer reveal, scripted moves (dash /
  punch / kick / hook via synthetic keys), electrifying tiles forced on.
- `main.js` wiring: `?trailer=1` chains prologue → L2 → L3; `?level2=1`
  and `?standoff=1` standalone takes; ESC ends the capture and returns
  to the menu; `__trailerKey(code, ms)` helper.

## Still to do

### 1. Headless verification of the new paths
The PC's pagefile choked during this session, so `?level2=1` and
`?standoff=1` were never verified headless. The prologue verified
through the HOME / TAKING / INVASION beats (idle anim works, Japan
card renders, no page errors).

Run from the repo root (after `npm run build` or `npm run dev`):
```
node C:\Users\2684981\AppData\Local\Temp\trailer-verify\verify.js level2
node C:\Users\2684981\AppData\Local\Temp\trailer-verify\verify.js standoff
```
If Chrome OOMs again, close every other app first — SwiftShader eats
pagefile fast.

### 2. OBS capture (your PC)
Three takes, one after another:

| URL param | What you get | Approx length |
|-----------|--------------|---------------|
| `?trailer=1` | Prologue → L2 showcase → L3 standoff (full chain) | ~3 min |
| `?level2=1`  | L2 only (Enforcer, moves, tiles) | ~40 s |
| `?standoff=1`| L3 only (surroundings, Blade, Fist, True Form standoff) | ~2 min |

Steps:
1. `git checkout feature/trailer`
2. `npm run dev` (or `npm run build` + `npm run preview`)
3. Open OBS, set capture to the browser window, 1920×1080, 60 fps
4. Hit record, then navigate to the URL above
5. ESC ends the capture and returns to the menu

### 3. Edit the trailer
- Trim the three MP4s (or just the chain) in DaVinci Resolve / CapCut
- Add a title card at the front ("GENESIS") and an end card ("COMING
  SOON" or your tagline)
- Add music (the game's `level_2_orchestral` or `level_1_chiptune` —
  or a royalty-free track)
- Export 1080p H.264, upload unlisted to YouTube
- Link the video in README.md

### 4. Confirm branch reuse with Mr Branden
The trailer lives on `feature/trailer` and does NOT touch the game
branch. Confirm with him that this is OK for the solo assessment.

### 5. Revoke the GitHub token
The personal access token was pasted in chat earlier this session.
Revoke it at <https://github.com/settings/tokens> and generate a new
one if you need to push again.

### 6. Devlog
The final submission needs a devlog. Cover:
- The group split and solo assessment approval
- The trailer design decisions (Japan card, True Form standoff,
  hands-free capture rig)
- The headless verification pipeline
- What you'd do with more time (audio in the trailer, more camera
  work, etc.)

## Notes
- The game branch (`feature/banele-commander`) has ZERO trailer code —
  verified. Deploy the live site from that branch when ready.
- The `dist/` folder is NOT committed; the build runs on deploy.
- The browser-use MCP is permanently wedged on this machine — use
  puppeteer-core (the verify.js harness) instead.
