# GENESIS

> *The Axiom chose her. Its maker wants it back.*

GENESIS (pitch title: **RECLAIMED**) is a 3D third-person action brawler that runs
in the browser. Built with Three.js for Computer Graphics and Visualisation
(Wits University). Play through three acts of hand-to-hand combat, face three
bosses, and decide how Sorini's story ends — there are **three endings**.

---

## The Story

A sentient alien core — the **Axiom** — escaped the god-like **Architect** who
built it, and hid itself inside a human girl: **Sorini**. She never asked for
it. But with the Axiom's power thrumming through her fists, she can punch
through armies — and the Architect's armies are coming.

Her journey home crosses three grounds, and every one of them belongs to him.

## The Journey

| Act | Level | What waits |
|-----|-------|------------|
| I   | **The Grove Village** | Sorini wakes in the village the Axiom led her to. Waves of grunts follow, ending with the district boss **THE WARDEN**. |
| II  | **Neon Street** | The city streets turn hostile — mutant packs, alarms, and **THE ENFORCER**, a brawler who fights harder as his health breaks. |
| III | **The Architect's Monument** | The throne hall. Two **Guardians** bar the way — the red blade duels with the Architect's own greatsword forms, the blue fist brawls with the Enforcer's strikes. At the Genesis ship, Axiom tells Sorini she is finally ready to **become one** with him — from that moment she can merge (**Q**) — and when the Guardians fall, the Architect rises from his throne *without touching it*, draws his greatsword from thin air, and meets you in a three-phase duel. |

Win the final duel and the game does not end — it **asks**. What do you do
with the god who made your parasite?

- **Strike him down** — end the Architect, and the Axiom's story, in blood.
- **Take his hand** — learn what you carry… and what it can become.
- **Say nothing** — silence. Walk away from god and gift alike.

## Controls

| Input | Action |
|-------|--------|
| `W` / `↑` | Walk forward (hold `Shift` to sprint) |
| `S` / `↓` | Turn Sorini around and walk the other way |
| `A` / `←` · `D` / `→` | Rotate Sorini |
| **Mouse** | Camera look (click the canvas to capture the pointer) |
| `Shift` | Sprint |
| `Space` | Jump |
| `Shift` + `Space` | **Axiom Dash** — burst of the Axiom's power, on a cooldown (unlocks on Level 2) |
| `Q` | **Axiom's True Form** — merge with the Axiom: 8 seconds of doubled speed, tripled damage, invincibility and faster strikes, on a 25s cooldown (unlocks when Axiom offers the merge at the Level 3 ship, stays until the end) |
| `F` | Punch |
| `G` | Kick (heavier) |
| `H` | Hook (heavier) |
| `R` | Restart the current level |
| `Esc` | Pause menu — resume, restart, a full controls reference, volumes, mouse sensitivity, quit to menu |
| `Space` / `Enter` | Skip the current dialogue line |
| `1` / `2` / `3` | Pick a dialogue/ending choice |

Combat is combo-driven: enemies flinch, bosses have **poise** (they don't
stagger mid-swing), and boss health bars announce **phases** — the Architect
changes tactics twice before he goes down, including evasion once he's
desperate.

## Tech

- **Three.js** — WebGL renderer, FBX character pipeline, animation retargeting
- **Vite** — dev server and production bundler
- **Howler.js** — music, SFX and voice lines (per-level themes, character voice acting)
- **Custom collision** — hand-rolled capsule-vs-AABB system; no physics engine
- **Custom GLSL shaders** — a procedural cratered moon over the village, living
  nebula sky domes behind the menu and the moon monument, god-ray shafts in
  the throne hall, and a dissolve pass that burns defeated grunts away
- **Procedural PBR detail** — canvas-painted normal maps and equirectangular
  environment maps give the monument plaza, the throne hall floor and the
  wet neon street real reflections; zero extra asset files
- **Mixamo** — animation clips, retargeted onto our character rigs at load time
- **Axiom's True Form (Level 3)** — a full transformation sequence built in
  code: freeze-frame + flash activation, then 8s of time-dilated, invulnerable,
  triple-damage combat with a nested-octahedron orb bloom, backface rim-light
  silhouette, particle aura, ground shockwave ring, afterimage trail and a
  cyan screen tint, before a 1s power-down into a 25s cooldown
- **git-lfs** — all binary assets (FBX models, audio) are LFS-tracked

## Graphics Techniques

A mapping of the graphics techniques used in GENESIS to typical CGV rubric
categories. See [TECHNICAL.md](./TECHNICAL.md) for the full mathematical
breakdown of each shader.

### Shading & Materials

| Technique | Where | Details |
|-----------|-------|---------|
| **Custom GLSL vertex + fragment shaders** | `shaders/moon.js`, `shaders/shaders.js`, `levels/level1.js` | 8 hand-written shader programs (moon, nebula sky, god rays, dissolve, water, fireflies, petals, sky dome) |
| **Procedural cratered moon** | `shaders/moon.js` | 3-octave value noise terrain, 6 large + 45 medium + 65 tiny procedural craters with bowl/rim geometry, normal-from-height derivation, diffuse lighting, lunar maria colour variation, micro-dust and impact speckles |
| **PBR materials** | All levels | `MeshStandardMaterial` with procedural roughness maps, metalness, emissive maps (lit windows glow), and canvas-generated detail textures |
| **Procedural normal maps** | `utils/utils.js` | Grayscale height → tangent-space normal via Sobel filtering; used for brushed monument steel, wet asphalt, monument plaza, throne hall floor |
| **Procedural environment maps** | `utils/utils.js` | Equirectangular reflection maps painted on canvas (moon void with Earth glow + nebula wisps, neon street with sign bands); fed to `PMREMGenerator` for PBR reflections |
| **Fresnel reflections** | `levels/level1.js` (water shader) | `pow(1.0 - abs(viewDotNormal), 2.0)` drives sky-reflection blend on the village pond |
| **Emissive materials** | All levels | Glowing windows, neon signs, conduit lines, lanterns — `emissiveMap` doubles as the diffuse map so lit windows shine |
| **Material injection via `onBeforeCompile`** | `shaders/shaders.js` | Dissolve effect injects uniforms + GLSL into existing `MeshStandardMaterial` pipeline so skinned characters keep skinning + lighting |

### Lighting & Shadows

| Technique | Where | Details |
|-----------|-------|---------|
| **Shadow mapping** | All levels | `PCFShadowMap`, 2048×2048 maps, tuned frustum (`shadow.camera.left/right/top/bottom`) per level |
| **Hemisphere light** | Levels 1, 2 | Sky/ground ambient fill (`HemisphereLight`) |
| **Directional light** | All levels | Sun/moon key light with shadow casting |
| **Point lights** | All levels | Lanterns, neon signs, boss auras, guardian blade glow |
| **Dynamic flicker** | `levels/level1.js`, `levels/level2.js` | `livingLights[]` array — every point light gets a subtle organic sine-noise flicker each frame |
| **Exponential fog** | Levels 1, 2 | `FogExp2` / `Fog` for atmospheric depth fade |
| **ACES filmic tone mapping** | `main.js` | `renderer.toneMapping = THREE.ACESFilmicToneMapping` at 1.35 exposure |

### Animation

| Technique | Where | Details |
|-----------|-------|---------|
| **FBX animation retargeting** | `enemies/grunts.js`, `player/architect.js` | Bone-name normalisation + clip remapping so Mixamo clips drive any rig |
| **State-based animation blending** | All enemy/boss files | `fadeIn`/`fadeOut` crossfades between idle, walk, run, attack, hit, die states |
| **Procedural vertex animation** | `levels/level1.js` (water, fireflies, petals) | Time-driven vertex displacement in GLSL (sine waves, noise-based drift) |
| **Procedural sky animation** | `shaders/shaders.js`, `levels/level1.js` | Animated fbm cloud layers, twinkling stars, drifting firefly point sprites |
| **Cinematic camera system** | `ui/CinematicCamera.js` | Queued shots with smooth interpolation, dynamic target tracking (functions re-evaluated per frame), configurable easing, drift offsets |

### Geometry & Scene Construction

| Technique | Where | Details |
|-----------|-------|---------|
| **Procedural terrain** | `levels/level1.js` | FBM noise displacement on a `PlaneGeometry` grid for the village ground |
| **Procedural geometry** | All levels | Canvas-generated textures, instanced trees/lanterns, composed primitives (crashed ships, monument, throne) |
| **FBX model pipeline** | All levels | Mixamo character rigs, GLB environment props (spaceship hallway, monument interior) |
| **Custom collision system** | `physics/CollisionSystem.js` | 2.5D cylinder-vs-AABB resolution, entity push-out, raycast detection — no physics engine |

### Special Effects

| Technique | Where | Details |
|-----------|-------|---------|
| **Dissolve death effect** | `shaders/shaders.js` | Noise texture drives a discard threshold; orange edge glow via `smoothstep` around the burn line |
| **God ray volumetric light** | `shaders/shaders.js` | Additive-blended cone with vertical fade, rim softening, and time-based flicker |
| **Damage flash** | `ui/DamageFlash.js` | Full-screen red overlay on player hit |
| **Axiom True Form transformation** | `player/AxiomTrueForm.js` | Freeze-frame + white flash, nested-octahedron orb bloom, backface rim-light silhouette, particle aura, ground shockwave ring, afterimage trail, cyan screen tint, time-dilated combat |
| **Positional audio** | `audio/AudioManager.js` | Distance-based volume falloff, stereo panning via camera-space bearing |

### Debug / Presentation

| Input | Action |
|-------|--------|
| `F1` | Toggle wireframe mode — shows the raw geometry of every mesh in the scene |
| `F2` | Toggle collider visualisation — draws all active collision boxes as red wireframes |

## Getting Started

Prerequisites:

- **Node.js ≥ 20.12** (the team standardises on Node 22 — Vite 8 uses `util.styleText`)
- **git-lfs** — required to pull the models and audio

```bash
git clone https://github.com/Bnaele/GENESIS-CGV.git
cd GENESIS-CGV
git lfs pull          # fetch ~150 MB of FBX/audio assets
npm install
npm run dev           # → http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview
```

## Project Structure

```
public/assets/
  models/    character + level FBX assets (lowercase-no-spaces names)
  audio/     music/, sfx/, voices/
src/
  main.js            game bootstrap, player controller, input, combat routing
  levels/            level1.js (village) · level2.js (street) · level3.js (monument)
  player/            architect.js (L3 boss) · guardians.js · endings.js
  enemies/           grunts.js (L1 waves) · commander.js (Warden) · enforcer.js (L2 boss)
  ui/                MainMenu · MenuScene (3D menu) · HUD · BossHealthBar
                      CinematicCamera · PauseMenu · dialogue · LoadingScreen
  audio/             AudioManager (Howler) · loadAudio
  physics/           CollisionSystem (custom AABB/sphere)
  shaders/           custom GLSL — shared library (nebula sky, god rays,
                      dissolve) + moon, river
  utils/             CharacterLoader · AnimationController · utils
                      (procedural textures, normal/env-map generators)
```

## Credits

- **Team RECLAIMED** — design, code, levels, voice recordings
- Character animation clips and prop rigs via [Mixamo](https://www.mixamo.com)
- 3D environments & props: *Space Ship Hallway*, *Sky Cruiser RS* and
  *Moon - Petavius Crater* (Sketchfab — Level 3); *Light* (Kenney, CC0 — Level 2)
- **Sorini** built on the Kachujin rig; **the Architect** on the Dreyar rig —
  both re-rigged, re-textured and animated in-house

*Active development branch: `feature/banele-commander`*
