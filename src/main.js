// ============================================================
// main.js — bootstrap, player controller, level manager, minimap
// ============================================================
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { StreetLevel } from './levels/level1.js';
import { AlienLevel } from './levels/level2.js';
import { ArchitectLevel } from './levels/level3.js';
import { PlayerHealth } from './player/PlayerHealth.js';
import { AxiomTrueForm } from './player/AxiomTrueForm.js';
import { attachChestArtifact } from './player/chestArtifact.js';
import { AudioManager } from './audio/AudioManager.js';
import { loadAllAudio } from './audio/loadAudio.js';
import { Dialogue } from './ui/dialogue.js';
import { endingAttack, endingLearn, endingSilence } from './player/endings.js';
import { UIManager } from './ui/UIManager.js';
import { createMainMenu } from './ui/MainMenu.js';
import { MenuScene } from './ui/MenuScene.js';
import { CinematicCamera } from './ui/CinematicCamera.js';
import { createHUD, updateHUD } from './ui/HUD.js';   // ← ADDED updateHUD
import { createObjectivesPanel, updateObjectives } from './ui/ObjectivesPanel.js';
import { createDamageFlash, flashDamageFrom } from './ui/DamageFlash.js';
import { showLevelClear, hideDebrief, isDebriefVisible } from './ui/DebriefScreen.js';
import { showFailScreen, hideFailScreen, isFailScreenVisible } from './ui/FailScreen.js';
import {
  resetStats, resetRunStats, gameStats, runStats, recordDeath,
  recordAttack, recordAttackLanded, recordDash, recordTrueFormTime,
  recordPlayTime, attackAccuracy, computeRank, parForLevel,
} from './utils/stats.js';
import { createLoadingScreen, updateLoadingScreen } from './ui/LoadingScreen.js';
import { worldColliders } from './physics/CollisionSystem.js';
import { PauseMenu } from './ui/PauseMenu.js';

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  console.error('[GENESIS] WebGL context lost. Refresh the tab.');
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1200);
camera.rotation.order = 'YXZ';
window.__camera = camera;

const cinematicCamera = new CinematicCamera();
window.__cinematicCamera = cinematicCamera;

// ---------- audio ----------
const audioManager = new AudioManager();
loadAllAudio(audioManager);
window.__audioManager = audioManager;
audioManager.setListener(() => player.pos, camera);

// ---------- root motion fix ----------
function stripRootMotion(clip) {
  if (!clip || !clip.tracks) return clip;
  for (const track of clip.tracks) {
    if (!/Hips/i.test(track.name) || !/\.position/i.test(track.name)) continue;
    const v = track.values;
    if (!v || v.length < 3) continue;
    const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
  return clip;
}

// ---------- player ----------
const player = {
  pos: new THREE.Vector3(0, 0, 55),
  vel: new THREE.Vector3(),
  yaw: Math.PI,
  cameraYaw: Math.PI,
  pitch: 0,
  grounded: false,
  EYE: 1.7,
  R: 0.4, H: 1.8,
};

// =====================================================
// PLAYER HEALTH — shared across all levels
// =====================================================
let _lastDeathPos = null;

const playerHealth = new PlayerHealth({
  onDeath: () => {
    trueForm.abort();   // dying ends the merge instantly
    _lastDeathPos = player.pos.clone();
    recordDeath();
    _levelDeaths++;
    showDeathScreen();
  },
  onRespawn: (spawnPos) => {
    let target = null;
    if (spawnPos && spawnPos.isVector3) {
      target = spawnPos;
    } else if (_lastDeathPos) {
      target = _lastDeathPos;
    } else if (level && level.spawn) {
      target = level.spawn;
    }
    if (target) {
      player.pos.copy(target);
      player.pos.y = (level && level.getSurfaceHeight)
        ? level.getSurfaceHeight(player.pos.x, player.pos.z) + 0.2
        : player.pos.y + 0.2;
    }
    player.vel.set(0, 0, 0);
    _lastDeathPos = null;
  },
  onHurt: () => {
    // Red vignette from the attacker's screen direction — cosmetic only
    try { flashDamageFrom(_nearestThreatPos(), player.pos, camera); } catch (e) { /* never block damage */ }
  }
});
window.__playerHealth = playerHealth;

// Nearest living hostile to Sorini — used to aim the damage flash when a
// hit lands (callers don't all pass their position through).
function _nearestThreatPos() {
  if (!level || !player) return null;
  const p = player.pos;
  let best = null, bestD = Infinity;
  const consider = (pos) => {
    if (!pos || !pos.isVector3) return;
    const d = pos.distanceToSquared(p);
    if (d < bestD) { bestD = d; best = pos; }
  };
  if (level.commander && level.commander.alive) consider(level.commander.getPosition());
  if (level.enforcer && level.enforcer.alive) consider(level.enforcer.getPosition());
  if (level.architect && (!level.architect.canBeHit || level.architect.canBeHit())) {
    consider(level.architect.getPosition());
  }
  if (Array.isArray(level.guardians)) {
    for (const g of level.guardians) {
      if (g && !g._disposed && !g.dead && g.group) consider(g.group.position);
    }
  }
  if (level.grunts && Array.isArray(level.grunts.grunts)) {
    for (const g of level.grunts.grunts) consider(g.position);
  }
  return best ? best.clone() : null;
}

// ---------- Sorini avatar ----------
const soriniGroup = new THREE.Group();
scene.add(soriniGroup);

// ── Axiom (the artifact) — the glowing reactor in Sorini's chest ──
// The visible reactor comes from chestArtifact.js and hooks onto her
// Spine2 bone once the model loads (below). This block keeps the
// legacy intensity API: axiomLevel scales the always-on chest glow
// (1 = baseline brightness), used by the Axiom Dash flash and the
// Level-1 dialogue pulse.
let chestArtifact = null;
let axiomLevel = 1;

window.__axiom = {
  activate() {
    axiomLevel = 1;
  },
  setIntensity(v) {
    axiomLevel = v;
  },
};

// ── Axiom Dash trail ──
const dashTrailPool = [];
const DASH_TRAIL_COUNT = 6;   // how many ghost sprites left behind

for (let i = 0; i < DASH_TRAIL_COUNT; i++) {
  const ghost = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0x88ddff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  );
  ghost.visible = false;
  scene.add(ghost);
  dashTrailPool.push({ mesh: ghost, life: 0 });
}

function spawnDashTrail(fromPos) {
  // Find an unused ghost
  for (const t of dashTrailPool) {
    if (t.life <= 0) {
      t.mesh.position.copy(fromPos);
      t.mesh.position.y += 1.0;
      t.mesh.visible = true;
      t.mesh.material.opacity = 0.7;
      t.mesh.scale.setScalar(1.0);
      t.life = 0.4;   // seconds
      return;
    }
  }
}

function updateDashTrails(dt) {
  for (const t of dashTrailPool) {
    if (t.life > 0) {
      t.life -= dt;
      const progress = Math.max(0, t.life / 0.4);
      t.mesh.material.opacity = 0.7 * progress;
      t.mesh.scale.setScalar(1.0 + (1 - progress) * 1.5);
      if (t.life <= 0) {
        t.mesh.visible = false;
        t.mesh.material.opacity = 0;
      }
    }
  }
}

let soriniMixer  = null;
let soriniActions = {};
let soriniCurrentAction = null;
let _soriniPending = null;

function playSoriniAction(name, loop = true) {
  let next = soriniActions[name];
  if (!next && name === 'walk') next = soriniActions['run'] || soriniActions['idle'];
  if (!next) { _soriniPending = { name, loop }; return; }
  if (next === soriniCurrentAction) {
    if (next.isRunning()) return;
    next.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.05).play();
    return;
  }
  if (soriniCurrentAction) soriniCurrentAction.fadeOut(0.22);
  next.reset()
    .setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
    .fadeIn(0.22).play();
  if (!loop) next.clampWhenFinished = true;
  soriniCurrentAction = next;
}

const soriniClips = {};

function _bindSoriniClip(key) {
  if (!soriniMixer || !soriniClips[key] || soriniActions[key]) return;
  soriniActions[key] = soriniMixer.clipAction(soriniClips[key]);
  if (_soriniPending && _soriniPending.name === key) {
    const p = _soriniPending; _soriniPending = null;
    playSoriniAction(p.name, p.loop);
  }
}

function loadSoriniAnim(path, key, onDone) {
  new FBXLoader().load(path, (fbx) => {
    if (fbx.animations?.[0]) {
      soriniClips[key] = stripRootMotion(fbx.animations[0]);
      _bindSoriniClip(key);
      if (onDone) onDone();
    }
  }, undefined, (e) => console.warn('sorini anim failed:', path, e));
}

new FBXLoader().load('./assets/models/player/sorini.fbx', (fbx) => {
  fbx.scale.setScalar(0.013);
  // Her feet sit at local y≈0 (Mixamo origin) and soriniGroup rides the
  // surface height each frame — keep her un-offset so boots rest ON the
  // ground (a previous -0.13 here sank her 13 cm into every floor).
  fbx.position.y = 0;
  fbx.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    // Mixamo quirk: her boots/bodysuit material ships with the specular
    // PNG wired as an alphaMap and transparent:true — the map's dark
    // regions punch alpha to zero and her shoes vanish. Force it opaque.
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.transparent && m.alphaMap) {
        m.transparent = false;
        m.alphaMap = null;
        m.opacity = 1;
        m.needsUpdate = true;
      }
    }
  });
  soriniGroup.add(fbx);

  // Iron-Man-style Axiom reactor embedded in her chest — the same
  // module the main menu uses; rides every animation via the Spine2 bone.
  chestArtifact = attachChestArtifact(fbx);
  window.__chestArtifact = chestArtifact;
  if (!chestArtifact) console.warn('sorini.fbx: chest bone not found — artifact skipped');

  soriniMixer = new THREE.AnimationMixer(fbx);
  for (const k of Object.keys(soriniClips)) _bindSoriniClip(k);

  setTimeout(() => {
    const want = ['idle', 'walk', 'run', 'punch', 'kick', 'hook', 'jump', 'die'];
    const missing = want.filter(k => !soriniClips[k]);
    if (missing.length) console.warn('[Sorini] clips missing:', missing.join(', '));
  }, 8000);

  const base = './assets/models/player/';
  loadSoriniAnim(base + 'idle.fbx',           'idle',     null);
  loadSoriniAnim(base + 'dying.fbx',          'die',      null);
  loadSoriniAnim(base + 'swagger_walk.fbx',   'walk',     null);
  loadSoriniAnim(base + 'running.fbx',        'run',      null);
  loadSoriniAnim(base + 'punching.fbx',       'punch',    null);
  loadSoriniAnim(base + 'kicking.fbx',        'kick',     null);
  loadSoriniAnim(base + 'hook.fbx',           'hook',     null);
  loadSoriniAnim(base + 'jump.fbx',           'jump',     null);
}, undefined, (e) => console.warn('sorini.fbx load failed:', e));

// ---------- input ----------
const keys = {};
let locked = false;
const attackCooldown = { f: 0, g: 0, h: 0 };
let attackLock = false;

// ── Axiom Dash state ──
const dash = {
  cooldown: 0,        // seconds remaining
  maxCooldown: 1.5,   // 1.5s cooldown
  duration: 0.15,     // how long the snap-dash lasts
  distance: 12,        // world units to travel
  activeTimer: 0,
  iframeDuration: 0.4,
  enabled: false,     // disabled until Level 2+
};

// ── Axiom True Form — the Level 3 payoff transformation (Q key) ──
// Owns its phase machine, visuals and buffs; main.js feeds it dt,
// scales the world by trueForm.timeScale and multiplies movement,
// damage and cooldowns by its getters while she is merged.
// Unlock: the first time the guardians wake and fight, the True
// Form is Sorini's for the rest of the level — through the
// Architect fight to the endgame (latched; resets on level exit).
let axiomUnlocked = false;
const trueForm = new AxiomTrueForm({
  scene,
  player,
  playerHealth,
  dash,
  spawnTrail: spawnDashTrail,
  getSoriniRoot: () => soriniGroup.children[0] || null,
  getSoriniGroup: () => soriniGroup,
  getChestArtifact: () => chestArtifact,
  isFightActive: () => {
    const l = window.__level;
    if (!l || !Array.isArray(l.guardians)) {
      axiomUnlocked = false;   // left Level 3 — lock it again
      return false;
    }
    // Axiom offered the merge at the Genesis ship — from that moment
    // the True Form is Sorini's to call anywhere in Level 3.
    if (l.axiomFormGranted) {
      axiomUnlocked = true;
      return true;
    }
    if (l.architect && typeof l.architect.canBeHit === 'function' &&
        l.architect.canBeHit()) {
      return true;
    }
    if (l.guardians.some((g) => g && !g._disposed && !g.dead && g.alerted)) {
      axiomUnlocked = true;
    }
    return axiomUnlocked;
  },
});
window.__trueForm = trueForm;

// ── Debug visualisation helpers ──
let _wireframeOn = false;
let _colliderHelpers = [];   // THREE.BoxHelper instances for collider viz

function toggleWireframe() {
  _wireframeOn = !_wireframeOn;
  scene.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if ('wireframe' in m) m.wireframe = _wireframeOn;
      }
    }
  });
  console.log(`[GENESIS] Wireframe ${_wireframeOn ? 'ON' : 'OFF'}`);
}

function toggleColliderViz() {
  // Remove existing helpers
  for (const h of _colliderHelpers) scene.remove(h);
  _colliderHelpers = [];

  const wasShowing = _colliderHelpers.length > 0;
  if (!wasShowing && level && Array.isArray(level.colliders)) {
    for (const box of level.colliders) {
      if (!box) continue;
      const helper = new THREE.Box3Helper(box, 0xff2222);
      scene.add(helper);
      _colliderHelpers.push(helper);
    }
    console.log(`[GENESIS] Collider viz ON — ${_colliderHelpers.length} boxes`);
  } else {
    console.log('[GENESIS] Collider viz OFF');
  }
}

// Arrow keys mirror WASD — same movement, nothing else changes.
const ARROW_TO_KEY = { ArrowUp: 'KeyW', ArrowLeft: 'KeyA', ArrowDown: 'KeyS', ArrowRight: 'KeyD' };

addEventListener('keydown', e => {
  if (window.__dialogue && window.__dialogue.active) {
    // Space/Enter skips the current line
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (typeof window.__dialogue.skip === 'function') {
        // Skipping a line also cuts its voice — otherwise the speech
        // keeps playing over whatever comes next.
        if (window.__audioManager) {
          for (const k of Object.keys(window.__audioManager.sounds)) {
            if (/^l1_intro$|^l1_axiom_|^l1_ship_|^l2_enforcer_|^l3_axiom_|^l3_architect_|^l3_ending_/.test(k)) {
              window.__audioManager.sounds[k].stop();
            }
          }
        }
        window.__dialogue.skip();
      }
      return;
    }
    window.__dialogue.handleKey(e.code);
    return;
  }

  // ── Esc toggles the pause menu directly — no prior mouse click ──
  // When the pointer is LOCKED, the browser exits the lock on Esc and
  // the pointerlockchange handler below opens the menu. When it is
  // NOT locked (player never clicked the canvas, or lock was lost),
  // this keydown is the only path to pause, so handle it here too.
  if (e.code === 'Escape') {
    if (!gameStarted.value || !level) return;
    if (cinematicCamera.active) return;
    if (isFailScreenVisible() || isDebriefVisible()) return;   // dead or level cleared — those screens own input
    if (document.getElementById('endOverlay')) return;
    if (tipPause) return;   // the True Form tip is modal — no pause menu on top
    if (pauseMenu.visible) {
      pauseMenu.resume();   // Esc again un-pauses
    } else {
      pauseMenu.show();
    }
    return;
  }

  // ── Debug visualisation (works even while paused) ──
  if (e.code === 'F1' && !e.repeat) { e.preventDefault(); toggleWireframe(); return; }
  if (e.code === 'F2' && !e.repeat) { e.preventDefault(); toggleColliderViz(); return; }

  // Gameplay input frozen while paused, dead, or reading the debrief —
  // the debrief keeps its own Space/Enter listener for CONTINUE.
  if (pauseMenu.visible || tipPause || isFailScreenVisible() || isDebriefVisible()) return;

  keys[e.code] = true;
  // Arrows drive the same movement keys as WASD
  if (ARROW_TO_KEY[e.code]) keys[ARROW_TO_KEY[e.code]] = true;
  if (e.code === 'Space') e.preventDefault();

    // ── Axiom Dash: Shift + Space ──
  if ((e.code === 'Space') &&
      (keys.ShiftLeft || keys.ShiftRight) &&
      dash.enabled &&
      dash.cooldown <= 0 &&
      player.grounded) {
    _triggerDash();
    return;   // consume the space so it doesn't also trigger a jump
  }

  // ── Axiom True Form: Q, gated to the Architect fight ──
  if (e.code === 'KeyQ' && !e.repeat) {
    trueForm.tryActivate();
  }
  // Key repeat must not reach these — holding R rebuilt the whole level
  // ~15 times a second.
  if (e.code === 'KeyR' && !e.repeat) switchLevel(current);

  // Debug: jump straight to a level. Top-row digits only — e.code for the
  // numpad is Numpad1, which is not bound.
  const debugLevel = { Digit1: 1, Digit2: 2, Digit3: 3 }[e.code];
  if (debugLevel && !e.repeat) switchLevel(debugLevel);

    if (e.code === 'Space' && player.grounded && !attackLock && !keys._spaceConsumed
      && !keys.ShiftLeft && !keys.ShiftRight) {
    player.vel.y = 12;
    keys._spaceConsumed = true;
  }

  if (e.code === 'KeyF' && attackCooldown.f <= 0) {
    attackCooldown.f = 0.7 * trueForm.attackRateMult;
    playSoriniAction('punch', false);
    _triggerAttack();
    recordAttack('punch');
    if (_damageEnemiesIfClose(1)) recordAttackLanded();
    audioManager.playSfx('punch_hit');
  }
  if (e.code === 'KeyG' && attackCooldown.g <= 0) {
    attackCooldown.g = 0.8 * trueForm.attackRateMult;
    playSoriniAction('kick', false);
    _triggerAttack();
    recordAttack('kick');
    if (_damageEnemiesIfClose(2)) recordAttackLanded();
    audioManager.playSfx('punch_hit');
  }
  if (e.code === 'KeyH' && attackCooldown.h <= 0) {
    attackCooldown.h = 0.7 * trueForm.attackRateMult;
    playSoriniAction('hook', false);
    _triggerAttack();
    recordAttack('hook');
    if (_damageEnemiesIfClose(2)) recordAttackLanded();
    audioManager.playSfx('punch_hit');
  }
});

function _triggerAttack() {
  if (level && typeof level.onMouseClick === 'function') {
    level.onMouseClick(camera, player.pos);
  } else if (level && level.streetEnemies) {
    level.streetEnemies.onMouseClick(camera, player.pos);
  }
}

// Returns true when the swing connected with something — the debrief's
// accuracy figure is landed swings over swings thrown.
function _damageEnemiesIfClose(damage) {
  if (!level) return false;
  damage = damage * trueForm.damageMult;
  let landed = false;

  if (level.commander && level.commander.alive) {
    const dist = level.commander.getPosition().distanceTo(player.pos);
    if (dist < 2.5) { level.commander.takeDamage(damage); landed = true; }
  }
  if (level.grunts) {
    if (level.grunts.checkHit(player.pos, 2.2, damage)) landed = true;
  }

  // Level 3 guardians — previously unhittable: no branch here at all.
  // Both guardians in range take the hit (it's a 2v1, not a duel).
  if (Array.isArray(level.guardians)) {
    for (const g of level.guardians) {
      if (!g || g._disposed || g.dead) continue;
      const dx = g.group.position.x - player.pos.x;
      const dz = g.group.position.z - player.pos.z;
      if (Math.hypot(dx, dz) < 2.6) { g.takeDamage(damage); landed = true; }
    }
  }

  if (level.enforcer && level.enforcer.alive) {
    const dist = level.enforcer.getPosition().distanceTo(player.pos);
    if (dist < 2.0) { level.enforcer.takeDamage(damage); landed = true; }
  }

  // Level 3 final boss — only hittable once he's actually fighting
  if (level.architect && level.architect.canBeHit && level.architect.canBeHit()) {
    const dist = level.architect.getPosition().distanceTo(player.pos);
    if (dist < 2.8) { level.architect.takeDamage(damage); landed = true; }
  }

  return landed;
}

addEventListener('keyup', e => {
  keys[e.code] = false;
  if (ARROW_TO_KEY[e.code]) keys[ARROW_TO_KEY[e.code]] = false;
  if (e.code === 'Space') keys._spaceConsumed = false;
});

renderer.domElement.addEventListener('click', () => {
  requestGamePointerLock();

  if (window.Howler && window.Howler.ctx && window.Howler.ctx.state === 'suspended') {
    window.Howler.ctx.resume();
  }

  // Safety net: if the level track ever drops out, bring it back here.
  if (window.__audioManager && !window.__audioManager.currentMusic) {
    const musicMap = { 1: 'level_1_chiptune', 2: 'level_2_orchestral', 3: 'level_3_electronic' };
    const track = musicMap[current];
    if (track) audioManager.playMusic(track);
  }
});

function _triggerDash() {
  dash.cooldown = dash.maxCooldown;
  dash.activeTimer = dash.duration;
  recordDash();

  // Direction: where the player is currently moving (WASD) or facing
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let dirX, dirZ;

  if (f === 0 && r === 0) {
    // Not moving — dash forward in facing direction
    dirX = Math.sin(player.yaw);
    dirZ = Math.cos(player.yaw);
  } else {
    // Movement direction — combine forward + strafe, normalize
    const fwdX = Math.sin(player.yaw);
    const fwdZ = Math.cos(player.yaw);
    const rgtX = Math.cos(player.yaw);
    const rgtZ = -Math.sin(player.yaw);
    dirX = fwdX * f + rgtX * r;
    dirZ = fwdZ * f + rgtZ * r;
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len;
    dirZ /= len;
  }

    // Leave a trail behind at the OLD position
  if (typeof spawnDashTrail === 'function') {
    spawnDashTrail(player.pos.clone());
  }

  // Snap position forward
  player.pos.x += dirX * dash.distance;
  player.pos.z += dirZ * dash.distance;

  // I-frames — mark player invincible
  if (window.__playerHealth) {
    window.__playerHealth._hurtCooldown = dash.iframeDuration;
  }

  // Axiom glow flash — 3× burst, then back to the baseline glow
  if (window.__axiom) {
    window.__axiom.setIntensity(3.0);
    setTimeout(() => {
      if (window.__axiom) window.__axiom.setIntensity(1.0);
    }, 300);
  }

  // Sound
  if (window.__audioManager) {
    window.__audioManager.playSfx('punch_hit');
  }
}

let _wasLocked = false;

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;

  if (locked) {
    _wasLocked = true;
    _lockFailCount = 0;
    clearTimeout(_lockRetryTimer);
    _lockRetryTimer = null;
    const hint = document.getElementById('recapture-hint');
    if (hint) hint.remove();
    pauseMenu.hide();
    return;
  }

  // Esc (or alt-tab) released the pointer mid-game → open the pause
  // menu, except during dialogue, cinematics, or the ending overlays.
  if (_wasLocked && gameStarted.value && level &&
      !(window.__dialogue && window.__dialogue.active) &&
      !cinematicCamera.active &&
      !isFailScreenVisible() &&
      !isDebriefVisible() &&
      !document.getElementById('endOverlay')) {
    pauseMenu.show();
  }
  _wasLocked = false;
});

// ── Pointer re-capture ──
// Chrome refuses to re-capture the pointer for ~1.25 s after an Esc
// release, so a quick RESUME click inside that window fails silently
// and the game keeps running in free-cursor mode. Retry once the
// cooldown has passed, and as a last resort show a recapture hint.
let _lockRetryTimer = null;
let _lockFailCount = 0;

function _showRecaptureHint() {
  let hint = document.getElementById('recapture-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'recapture-hint';
    Object.assign(hint.style, {
      position: 'fixed',
      left: '50%',
      bottom: '12%',
      transform: 'translateX(-50%)',
      padding: '10px 26px',
      border: '2px solid #00ffff',
      borderRadius: '8px',
      background: 'rgba(2, 10, 20, 0.85)',
      color: '#00ffff',
      fontFamily: "'Courier New', monospace",
      fontSize: '0.95rem',
      letterSpacing: '3px',
      zIndex: '400',
      pointerEvents: 'none',
    });
    document.body.appendChild(hint);
  }
  hint.innerText = 'CLICK TO CAPTURE THE MOUSE';
  clearTimeout(hint._t);
  hint._t = setTimeout(() => hint.remove(), 3000);
}

function _scheduleLockRetry() {
  if (_lockRetryTimer) return;   // a retry is already pending
  _lockRetryTimer = setTimeout(() => {
    _lockRetryTimer = null;
    if (document.pointerLockElement === renderer.domElement) return;
    if (_lockFailCount >= 3) return;             // browser keeps refusing — stop
    if (pauseMenu.visible || tipPause) return;   // re-paused / tip — leave the cursor free
    if (!gameStarted.value || !level) return;    // back at the main menu
    if (window.__dialogue && window.__dialogue.active) return;
    if (cinematicCamera.active) return;
    if (document.getElementById('endOverlay')) return;
    requestGamePointerLock(false);               // one silent retry, then the hint
  }, 1400);
}

function requestGamePointerLock(retryOnFail = true) {
  if (document.pointerLockElement === renderer.domElement) return;
  const fail = () => {
    _lockFailCount++;
    if (retryOnFail) _scheduleLockRetry();
    else _showRecaptureHint();
  };
  try {
    const p = renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(fail);
  } catch (e) { fail(); }
}

// Safari/Firefox signal failures via an event instead of a rejected
// promise — route those through the same retry.
document.addEventListener('pointerlockerror', () => {
  if (document.pointerLockElement !== renderer.domElement &&
      _lockFailCount < 3) {
    _scheduleLockRetry();
  }
});

let mouseSensitivity = 0.0022;   // radians per pixel — tunable in the pause menu

addEventListener('mousemove', e => {
  if (!locked || tipPause) return;   // world frozen under the tip — don't spin the camera
  player.cameraYaw -= e.movementX * mouseSensitivity;
  player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch - e.movementY * mouseSensitivity));
});

// ---------- levels ----------
const LEVELS = { 1: StreetLevel, 2: AlienLevel, 3: ArchitectLevel };
let level = null, current = 1;
// One-shot guard — a level must not be able to fire the debrief twice
let _summaryShown = false;

function disposeCurrentLevel() {
  if (level) {
    try {
      if (typeof level.dispose === 'function') level.dispose(scene);
      else {
        if (level.root && level.root.parent) level.root.parent.remove(level.root);
        if (level.level && level.level.parent) level.level.parent.remove(level.level);
      }
    } catch (e) { console.warn('dispose error', e); }

    // Boss HP bar lives in the DOM (document.body), not the scene — make
    // sure it is removed on switch even if the level's own dispose missed
    // it or threw before reaching it. Otherwise the bar keeps showing on
    // the next level and steals the new bar's id-based DOM lookups.
    if (level.bossHealthBar) {
      try { level.bossHealthBar.dispose(); } catch (e) {}
      level.bossHealthBar = null;
    }

    if (level.root && scene.children.includes(level.root)) scene.remove(level.root);
    if (level.level && scene.children.includes(level.level)) scene.remove(level.level);
    if (level.sky && scene.children.includes(level.sky)) scene.remove(level.sky);
    if (level.stars && scene.children.includes(level.stars)) scene.remove(level.stars);
  }

  if (window.__dialogue) {
    try { window.__dialogue.dispose(); } catch (e) {}
    window.__dialogue = null;
  }

  try {
    if (renderer.renderLists) renderer.renderLists.dispose();
    if (renderer.info) renderer.info.reset();
  } catch (e) { console.warn('renderer cache flush failed:', e); }
}

// ---------- checkpoints ----------
// The last gate the player reached in the current level. Index 0 is the
// level start (a retry from it skips the opening story beats); higher
// indices are reported by the levels themselves through level.onCheckpoint
// at boss wakes, guardian wakes and similar gates. Retrying rebuilds the
// level with { checkpoint: n } so it constructs in the post-gate state.
let checkpoint = null;

// Deaths in the level currently being played. Kept out of gameStats
// because a retry rebuilds the level and resetStats() would wipe it —
// the debrief has to show every death it took to finish, not just the
// ones from the successful attempt. Cleared when the level is cleared.
let _levelDeaths = 0;

function showCheckpointToast(label) {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed; top:64px; left:50%; transform:translateX(-50%);
    padding:8px 26px; border:1px solid rgba(0,255,255,0.55); border-radius:8px;
    background:rgba(2,10,20,0.85); color:#7fe8ff;
    font-family:'Courier New', monospace; font-size:12px; letter-spacing:4px;
    z-index:90; pointer-events:none; opacity:1; transition:opacity 0.6s ease;
  `;
  t.innerText = `CHECKPOINT — ${label}`;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; }, 2400);
  setTimeout(() => t.remove(), 3200);
}

function setCheckpoint(index, label) {
  checkpoint = { index, label, pos: player.pos.clone(), yaw: player.yaw };
  showCheckpointToast(label);
}

// ── Death — MISSION FAILED screen with checkpoint retry ──
function showDeathScreen() {
  if (document.pointerLockElement) document.exitPointerLock();
  audioManager.pauseMusic();
  if (cinematicCamera.active) cinematicCamera.stop();

  // Silence any voiced line in flight and hide its captions so the
  // dialogue isn't talking over Axiom on the fail screen.
  if (window.__dialogue) {
    try {
      for (const k of Object.keys(audioManager.sounds)) {
        if (/^l[123]_/.test(k)) audioManager.sounds[k].stop();
      }
      window.__dialogue.hide();
    } catch (e) { /* never block the fail screen */ }
  }

  const cp = checkpoint;
  showFailScreen({
    checkpointLabel: cp ? cp.label : 'LEVEL START',
    // Run total, not the level total — a retry resets gameStats, which
    // would otherwise pin Axiom to the same quote forever.
    deaths: runStats.deaths,
    onRetry: () => retryFromCheckpoint(),
    onRestart: () => {
      switchLevel(current);
      requestGamePointerLock();
    },
    onQuit: () => restartToMenu(),
  });
}

function retryFromCheckpoint() {
  const cp = checkpoint;
  switchLevel(current, { checkpoint: cp ? cp.index : 0 });
  if (cp) {
    player.pos.copy(cp.pos);
    player.vel.set(0, 0, 0);
    player.yaw = cp.yaw;
    player.cameraYaw = cp.yaw;
  }
  requestGamePointerLock();
}

// ── Level clear — the debrief owns the transition ──
// The levels only report that the exit was reached; the next level is
// built when the player dismisses this screen, so nothing is ever torn
// down underneath them while they are still reading their result.
function showLevelComplete() {
  if (document.pointerLockElement) document.exitPointerLock();
  audioManager.pauseMusic();
  if (cinematicCamera.active) cinematicCamera.stop();

  const finished = current;
  const timeSec = gameStats.playSeconds;
  const rank = computeRank({
    deaths: _levelDeaths,
    damageTaken: gameStats.damageTaken,
    accuracy: attackAccuracy(gameStats),
    timeSec,
    parSec: parForLevel(finished),
  });

  showLevelClear({
    levelName: level ? level.name : `LEVEL ${finished}`,
    stats: { ...gameStats, deaths: _levelDeaths },
    rank,
    timeSec,
    health: playerHealth.hp,
    maxHealth: playerHealth.maxHp,
    nextLabel: `CONTINUE — LEVEL ${finished + 1}`,
    onContinue: () => {
      _levelDeaths = 0;
      const nextLevel = finished + 1;

      // Levels 2 and 3 get a story briefing before loading
      if (nextLevel === 2 || nextLevel === 3) {
        hideDebrief();
        const storyText = nextLevel === 2 ? LEVEL2_STORY : LEVEL3_STORY;
        const levelLabel = nextLevel === 2 ? 'LEVEL 2' : 'LEVEL 3';
        const levelTitle = nextLevel === 2 ? 'NEON STREET' : "THE ARCHITECT'S MONUMENT";
        const musicKey = nextLevel === 2 ? 'level_2_orchestral' : 'level_3_electronic';

        uiManager.showScreen('loading');
        updateLoadingScreen(levelLabel, levelTitle, storyText, 0, 'Initializing...');

        let progress = 0;
        const loadInterval = setInterval(() => {
          progress += Math.random() * 18 + 4;
          if (progress >= 100) {
            progress = 100;
            clearInterval(loadInterval);
            updateLoadingScreen(levelLabel, levelTitle, storyText, 100, 'Ready!', true);

            const continueBtn = document.getElementById('continueBtn');
            if (continueBtn) {
              continueBtn.onclick = () => {
                uiManager.hideAllScreens();
                uiManager.showHUD();
                audioManager.playMusic(musicKey);
                switchLevel(nextLevel);
                requestGamePointerLock();
              };
            }
          } else {
            const statuses = ['Loading assets...', 'Building world...', 'Spawning enemies...', 'Almost ready...'];
            const statusIndex = Math.floor(progress / 25);
            updateLoadingScreen(levelLabel, levelTitle, storyText, progress, statuses[statusIndex % statuses.length]);
          }
        }, 200);
      } else {
        // Level 1 → no extra briefing (already shown at game start)
        switchLevel(nextLevel);
        requestGamePointerLock();
      }
    },
  });
}

function switchLevel(n, opts = {}) {
  disposeCurrentLevel();
  hideDebrief();

  current = n;
  _lastDeathPos = null;
  _summaryShown = false;
  resetStats();
  trueForm.reset();   // never carry the merge across a level switch
  dash.cooldown = 0;
  dash.activeTimer = 0;
  attackCooldown.f = 0; attackCooldown.g = 0; attackCooldown.h = 0;
  attackLock = false;

  try {
    level = new LEVELS[n](scene, renderer, opts);

    if (n === 3 && level instanceof ArchitectLevel) {
      window.__level3 = level;   // debug hook — fight/asset testing
      window.__player = player;
      const dialogue = new Dialogue();
      window.__dialogue = dialogue;
      level.dialogue = dialogue;

      level.onEndingChosen = (choice) => {
        if (choice === 'attack') {
          dialogue.dispose();
          window.__dialogue = null;
          endingAttack();
        } else if (choice === 'learn') {
          endingLearn(dialogue).then(() => {
            window.__dialogue = null;
          });
        } else {
          dialogue.dispose();
          window.__dialogue = null;
          endingSilence();
        }
      };
    }
  } catch (e) {
    console.warn(`Level ${n} primary constructor failed:`, e);
    try { level = new LEVELS[n](scene, opts); } catch (e2) { level = new LEVELS[n](); }
  }

  // Wire player damage callback
  if (level) {
    level.onDamagePlayer = (dmg) => {
      playerHealth.takeDamage(dmg);
    };
    level.playerHealth = playerHealth;

    // Levels report story/combat gates here; the saved position is
    // wherever Sorini stood when the gate fired.
    level.onCheckpoint = (index, label) => setCheckpoint(index, label);

    // Levels call this the moment the exit portal is entered — the
    // debrief freezes the world there and holds the transition until the
    // player continues. Level 3 never calls it: its ending cinematic
    // closes the run with the campaign summary instead.
    level.onLevelComplete = () => {
      if (_summaryShown) return;
      _summaryShown = true;
      showLevelComplete();
    };
  }

  // Fresh start — Sorini always begins a level at full health, no matter
  // how beaten up she finished the previous fight
  playerHealth.reset();

  if (level.scene && level.scene !== scene) {
    if (level.scene.background) scene.background = level.scene.background;
    scene.fog = level.scene.fog !== undefined ? level.scene.fog : null;
    if (level.level && level.level.parent === level.scene) {
      level.scene.remove(level.level);
      scene.add(level.level);
    }
    if (level.root && level.root.parent === level.scene) {
      level.scene.remove(level.root);
      scene.add(level.root);
    }
    if (level.sky && level.sky.parent === level.scene) {
      level.scene.remove(level.sky);
      scene.add(level.sky);
    }
    if (level.stars && level.stars.parent === level.scene) {
      level.scene.remove(level.stars);
      scene.add(level.stars);
    }
  }

  if (typeof level.getSpawn === 'function') {
    try { level.spawn = level.getSpawn(); } catch (e) { console.warn('getSpawn failed:', e); }
  }

  // Levels bake 2048 shadows at build time — re-apply the trimmed
  // resolution when LOW quality is active so the setting survives switches.
  if (qualityMode === 'low') _setShadowResolution(1024);

  if (n === 2 && typeof level.startIntroSequence === 'function') {
    level.startIntroSequence();
  }

  if (!level.spawn || !level.spawn.isVector3) {
    console.warn(`Level ${n} missing spawn, using fallback`);
    let fallbackY = 0;
    try {
      if (typeof level.getSurfaceHeight === 'function') fallbackY = level.getSurfaceHeight(0, 55);
      else if (typeof level.groundHeight === 'function') fallbackY = level.groundHeight(0, 55);
      else if (typeof level.terrainHeight === 'function') fallbackY = level.terrainHeight(0, 55);
    } catch (e) { fallbackY = 0; }
    level.spawn = new THREE.Vector3(0, fallbackY + 0.1, 55);
  }

  if (!Array.isArray(level.colliders)) level.colliders = [];
  if (!level.name) level.name = `LEVEL ${n}`;

  // ── Register level colliders to the global worldColliders registry ──
  // Enemies (grunts, guardians, etc.) resolve against worldColliders,
  // so every level must push its colliders there. Clear stale entries
  // from the previous level first.
  worldColliders.length = 0;
  for (const c of level.colliders) {
    if (c && !worldColliders.includes(c)) worldColliders.push(c);
  }

  player.pos.copy(level.spawn);
  player.vel.set(0, 0, 0);
  player.yaw   = (typeof level.spawnYaw === 'number') ? level.spawnYaw : Math.PI;
  player.pitch = 0;
    player.cameraYaw = player.yaw;   // start camera behind her facing forward

  // Fresh level (or a checkpoint retry) — the saved gate resets to the
  // start; retryFromCheckpoint overwrites the position afterwards.
  checkpoint = { index: 0, label: level.name, pos: level.spawn.clone(), yaw: player.yaw };

  // Axiom Dash unlocks from Level 2 onward
dash.enabled = (n >= 2);

  const musicMap = { 1: 'level_1_chiptune', 2: 'level_2_orchestral', 3: 'level_3_electronic' };
  const track = musicMap[n];
  if (track) audioManager.playMusic(track);
}

window.__switchLevel = switchLevel;

// ---------- minimap ----------
const mini = new THREE.OrthographicCamera(-55, 55, 55, -55, 1, 300);
mini.layers.set(1);
mini.layers.enable(2);
const marker = new THREE.Mesh(
  new THREE.ConeGeometry(1.1, 2.6, 6),
  new THREE.MeshBasicMaterial({ color: 0x33ffee }));
marker.rotation.order = 'YXZ';
marker.layers.set(2);
scene.add(marker);

const MAX_DOTS = 32;
const enemyDots = [];
const gruntDotMat = new THREE.MeshBasicMaterial({ color: 0xff3a3a });
const bossDotMat  = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
const dotGeo = new THREE.CircleGeometry(1.6, 12);

for (let i = 0; i < MAX_DOTS; i++) {
  const dot = new THREE.Mesh(dotGeo, gruntDotMat);
  dot.rotation.x = -Math.PI / 2;
  dot.layers.set(1);
  dot.visible = false;
  scene.add(dot);
  enemyDots.push(dot);
}

// ---------- physics ----------
const GRAV = 30, SPEED = 4.5, SPRINT = 9;
const TURN_SPEED = 2.2;

// Scratch objects for stepPlayer's collider pass, created once and
// reused every frame — the hottest path in the game used to hand the
// GC three fresh objects per tick, the classic source of micro-stutter.
// _pb aliases _pMin/_pMax (Box3's constructor stores the vectors by
// reference), so refilling them refreshes the box with zero allocations.
const _pMin = new THREE.Vector3();
const _pMax = new THREE.Vector3();
const _pb = new THREE.Box3(_pMin, _pMax);

function stepPlayer(dt) {
  const isSprint = keys.ShiftLeft || keys.ShiftRight;
  const sp = (isSprint ? SPRINT : SPEED) * trueForm.speedMult;

  // ── Rotation ──
  // A/D rotate Sorini ONLY (camera stays put unless mouse-look)
  if (!attackLock) {
    if (keys.KeyA) player.yaw += TURN_SPEED * dt;
    if (keys.KeyD) player.yaw -= TURN_SPEED * dt;
  }

  // S turns her 180° smoothly (over ~0.35s)
  const fwd = keys.KeyW ? 1 : 0;
  const back = keys.KeyS ? 1 : 0;

  if (back && !fwd && !attackLock) {
    // Target yaw: 180° from current
    const targetYaw = player._sTargetYaw !== undefined
      ? player._sTargetYaw
      : (player._sTargetYaw = player.yaw + Math.PI);
    const diff = ((targetYaw - player.yaw + Math.PI) % (2 * Math.PI)) - Math.PI;
    player.yaw += diff * Math.min(1, dt * 8);
  } else {
    player._sTargetYaw = undefined;   // reset when S released
  }

  // ── Movement ──
  // W or S both move her FORWARD in her facing direction
  // (S already flipped her yaw, so she walks toward where she's facing)
  const f = attackLock ? 0 : (fwd || back ? 1 : 0);
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  player.vel.x = sin * f * sp;
  player.vel.z = cos * f * sp;

  player.vel.y -= GRAV * dt;
  player.pos.addScaledVector(player.vel, dt);

  // ── Ground snap ──
  let g = 0;
  try {
    if (level && typeof level.getSurfaceHeight === 'function') g = level.getSurfaceHeight(player.pos.x, player.pos.z);
    else if (level && typeof level.groundHeight === 'function') g = level.groundHeight(player.pos.x, player.pos.z, player.pos.y);
    else if (level && typeof level.terrainHeight === 'function') g = level.terrainHeight(player.pos.x, player.pos.z);
  } catch (e) { g = 0; }
  if (player.pos.y <= g) { player.pos.y = g; player.vel.y = 0; player.grounded = true; }
  else player.grounded = false;

  // ── Colliders ──
  const colliders = (level && Array.isArray(level.colliders)) ? level.colliders : [];
  _pMin.set(player.pos.x - player.R, player.pos.y, player.pos.z - player.R);
  _pMax.set(player.pos.x + player.R, player.pos.y + player.H, player.pos.z + player.R);
  for (const c of colliders) {
    if (!c || typeof c.intersectsBox !== 'function') continue;
    if (!c.intersectsBox(_pb)) continue;
    const ox = Math.min(_pMax.x - c.min.x, c.max.x - _pMin.x);
    const oz = Math.min(_pMax.z - c.min.z, c.max.z - _pMin.z);
    if (ox < oz) player.pos.x += (_pMax.x - c.min.x < c.max.x - _pMin.x) ? -ox : ox;
    else         player.pos.z += (_pMax.z - c.min.z < c.max.z - _pMin.z) ? -oz : oz;
    _pMin.set(player.pos.x - player.R, player.pos.y, player.pos.z - player.R);
    // +H here — this refill used to drop the height term, collapsing
    // the box to zero height after the first push-out so later
    // colliders in the same frame were tested against a flat slab
    _pMax.set(player.pos.x + player.R, player.pos.y + player.H, player.pos.z + player.R);
  }

  if (player.pos.y < -60) {
    if (level && level.spawn && level.spawn.isVector3) player.pos.copy(level.spawn);
    else player.pos.set(0, 2, 55);
    player.vel.set(0, 0, 0);
  }
}

// ── True Form tip — modal "what you have gained" card ──
// Shown by Level 3 right after the merge dialogue. Freezes the whole
// world (same early-return path as the pause menu) until the player
// presses SPACE. Shown once per activation; safe to call twice.
let tipPause = false;
function showTrueFormTip() {
  if (tipPause || document.getElementById('true-form-tip')) return;
  tipPause = true;

  const overlay = document.createElement('div');
  overlay.id = 'true-form-tip';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:260',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(1,2,8,0.86)', 'backdrop-filter:blur(3px)',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'max-width:640px', 'margin:24px', 'padding:36px 44px',
    'background:rgba(4,10,22,0.94)',
    'border:1px solid rgba(0,217,242,0.55)', 'border-radius:14px',
    'box-shadow:0 0 44px rgba(0,217,242,0.22), inset 0 0 26px rgba(0,217,242,0.06)',
    'color:#d9f6ff', 'text-align:center',
  ].join(';');
  card.innerHTML = `
    <div style="font-size:12px;letter-spacing:4px;color:#7fe8ff;opacity:.85;">THE ARCHITECT'S MONUMENT</div>
    <h2 style="margin:14px 0 6px;font-size:26px;letter-spacing:2px;color:#eaffff;text-shadow:0 0 18px rgba(0,217,242,.65);">YOU HAVE BECOME ONE WITH AXIOM</h2>
    <div style="width:120px;height:1px;margin:10px auto 18px;background:linear-gradient(90deg,transparent,rgba(0,217,242,.8),transparent);"></div>
    <p style="margin:0 0 14px;line-height:1.65;font-size:15px;color:#cfeefb;">
      Sorini has merged with Axiom and assumed his <b style="color:#9ff2ff;">True Form</b>.
      Press <b style="color:#9ff2ff;">Q</b> to unleash it: for <b>8 seconds</b> you move twice
      as fast, strike three times as hard, swing far more rapidly, and cannot be harmed by
      any blow. Even your <b>Axiom Dash</b> is transformed, recovering almost instantly and
      carrying you much farther.
    </p>
    <p style="margin:0 0 22px;line-height:1.65;font-size:15px;color:#cfeefb;">
      When the form fades, it must recharge for <b>25 seconds</b> before you can call upon
      it again. The Guardians and the Architect are powerful foes — but you are no longer
      facing them alone. Choose your moment wisely.
    </p>
    <div id="true-form-tip-continue" style="font-size:13px;letter-spacing:3px;color:#7fe8ff;opacity:.9;">— PRESS SPACE TO CONTINUE —</div>
  `;
  overlay.appendChild(card);

  // Pulsing prompt — kept on the overlay so it dies with it
  const style = document.createElement('style');
  style.textContent = '@keyframes tipPulse{0%,100%{opacity:.5}50%{opacity:1}}';
  overlay.appendChild(style);
  const prompt = card.querySelector('#true-form-tip-continue');
  prompt.style.animation = 'tipPulse 1.6s ease-in-out infinite';

  document.body.appendChild(overlay);

  const dismiss = () => {
    if (!tipPause) return;
    tipPause = false;
    overlay.remove();
    style.remove();
    document.removeEventListener('keydown', onKey, true);
    overlay.removeEventListener('click', dismiss);
  };
  const onKey = (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    e.stopPropagation();   // never leak into gameplay keys — no jump, no dash
    dismiss();
  };
  document.addEventListener('keydown', onKey, true);   // capture — beats every other handler
  overlay.addEventListener('click', dismiss);
}
window.__showTrueFormTip = showTrueFormTip;

// ---------- loop ----------
const timer = new THREE.Timer();
let _rafId = 0;

function tick() {
  _rafId = requestAnimationFrame(tick);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const t  = timer.getElapsed();

  // True Form phases run on REAL time; everything world-side below
  // uses dtW, which the form slows during its activation moment.
  trueForm.updateState(dt);
  const dtW = dt * trueForm.timeScale;

  if (!level) return;

  // Freeze the whole world while the pause menu is open — the last
  // presented frame stays on screen behind the overlay. The True Form
  // tip, the MISSION FAILED screen and the level debrief freeze through
  // the same path, so none of them tick up the play clock.
  if (pauseMenu.visible || tipPause || isFailScreenVisible() || isDebriefVisible()) return;

  // Real time, not dtW — the merge slows dtW, which would under-count
  // both the clock and the seconds spent merged.
  recordPlayTime(dt);
  if (trueForm.active) recordTrueFormTime(dt);

  playerHealth.update(dt);

  stepPlayer(dtW);
  if (soriniMixer) soriniMixer.update(dtW);

  // ── Axiom chest reactor — always-on breathing glow ──
  // Mirrors the main-menu pulse; axiomLevel scales it for the Axiom
  // Dash flash and the Level-1 dialogue pulse.
  if (chestArtifact) {
    if (trueForm.tickArtifact(chestArtifact, t, dtW)) {
      // The merged reactor drives itself while the form is up.
    } else {
      const p = 0.6 + Math.sin(t * 2) * 0.4;
      chestArtifact.ring.material.emissiveIntensity = (1.8 + p * 1.2) * axiomLevel;
      chestArtifact.core.material.emissiveIntensity = (3.0 + p * 1.3) * axiomLevel;
      chestArtifact.light.intensity = (1.8 + p * 2.0) * axiomLevel;
      chestArtifact.coreSpin.rotation.z += 0.02;
    }
  }

  if (typeof level.update === 'function') {
    try { level.update(dtW, t, player); }
    catch (e) { console.warn('level.update error', e); }
  }

  // ── Update HUD every frame (health, wave counter, level name) ──
  const hasWaves    = (typeof level.waveIndex === 'number');
  const waveCurrent = hasWaves ? level.waveIndex : 0;
  const waveTotal   = (level.waves ? level.waves.length : 3);
  updateHUD(
    playerHealth.hp,
    playerHealth.maxHp,
    0,           // fragments — unused
    0,           // fragments — unused
    waveCurrent,
    waveTotal,
    level.name || 'LEVEL 1',
    hasWaves     // levels 2 & 3 have no waves — hide the counter
  );

  // ── Per-level objectives tracker ──
  if (typeof level.getObjectives === 'function') {
    try { updateObjectives(level.getObjectives()); }
    catch (e) { console.warn('objectives update failed:', e); }
  }

  // ── Cinematic camera takes over during dialogue ──
  // applyTo() drives both position and orientation, so nothing after
  // this block may touch the camera while a sequence is playing — an
  // unconditional gameplay lookAt() here used to re-aim every cinematic
  // shot back at the player, silently overriding each shot's designed
  // look target.
  const CAM_DIST   = 5.5;
  const CAM_HEIGHT = 2.8;
  const CAM_LOOK_UP = 1.2;
  if (cinematicCamera.active) {
    cinematicCamera.update(dt);
    cinematicCamera.applyTo(camera);
  } else {
    // Normal third-person camera
    const camOffX = -Math.sin(player.cameraYaw) * CAM_DIST;
    const camOffZ = -Math.cos(player.cameraYaw) * CAM_DIST;
    camera.position.set(
      player.pos.x + camOffX,
      player.pos.y + CAM_HEIGHT,
      player.pos.z + camOffZ
    );
    if (level && typeof level.getSurfaceHeight === 'function') {
      const camGround = level.getSurfaceHeight(camera.position.x, camera.position.z) + 0.5;
      if (camera.position.y < camGround) camera.position.y = camGround;
    }
    camera.lookAt(player.pos.x, player.pos.y + CAM_LOOK_UP, player.pos.z);

    // True Form pull-in — lerp the FOV, never snap it
    const wantFov = 75 * trueForm.fovScale;
    if (Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    }
  }

  soriniGroup.position.set(player.pos.x, player.pos.y, player.pos.z);
  soriniGroup.rotation.y = player.yaw;
  trueForm.updateVisuals(dtW, t);

  for (const k of ['f','g','h']) if (attackCooldown[k] > 0) attackCooldown[k] -= dtW;
  if (dash.cooldown > 0) dash.cooldown -= dtW;
  if (dash.activeTimer > 0) dash.activeTimer -= dtW;

  updateDashTrails(dtW);

  const isSprint  = keys.ShiftLeft || keys.ShiftRight;
  const isMovingW = keys.KeyW || keys.KeyS;

  const attackNames = ['punch','kick','hook','jump'];
  const currentIsAttack = soriniCurrentAction && attackNames.some(
    n => soriniActions[n] && soriniActions[n] === soriniCurrentAction
  );
  const attackStillPlaying = currentIsAttack &&
    soriniCurrentAction.isRunning() &&
    soriniCurrentAction.loop === THREE.LoopOnce;
  attackLock = attackStillPlaying;

  // Merged Sorini fights faster — the clip itself speeds up so the
  // cooldown cut and the animation stay in sync.
  if (soriniCurrentAction) {
    soriniCurrentAction.setEffectiveTimeScale(trueForm.active ? 1.4 : 1);
  }

  if (soriniMixer && !attackStillPlaying) {
    if (!player.grounded)             playSoriniAction('jump');
    else if (isSprint && isMovingW)   playSoriniAction('run');
    else if (isMovingW)               playSoriniAction('walk');
    else                              playSoriniAction('idle');
  }

  marker.position.set(player.pos.x, player.pos.y + 2, player.pos.z);
  marker.rotation.set(Math.PI / 2, player.yaw, 0);

  // ── Update minimap enemy dots ──
  const enemies = (level && typeof level.getEnemyMarkers === 'function')
    ? level.getEnemyMarkers()
    : [];

  for (let i = 0; i < MAX_DOTS; i++) {
    const dot = enemyDots[i];
    if (i < enemies.length) {
      const e = enemies[i];
      dot.position.set(e.x, 1, e.z);
      dot.material = (e.kind === 'commander') ? bossDotMat : gruntDotMat;
      dot.visible = true;
    } else if (dot.visible) {
      dot.visible = false;
    }
  }

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.clear();
  renderer.render(scene, camera);

  const S = 200;
  renderer.setScissorTest(true);
  renderer.setViewport(innerWidth - S - 12, 12, S, S);
  renderer.setScissor(innerWidth - S - 12, 12, S, S);
  renderer.setClearColor(0x0a0a14, 1);
  renderer.clearDepth();
  mini.position.set(player.pos.x, 90, player.pos.z);
  mini.up.set(0, 0, -1);
  mini.lookAt(player.pos.x, 0, player.pos.z);
  renderer.render(scene, mini);
  renderer.setScissorTest(false);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- debug globals ----------
window.__player = player;

Object.defineProperty(window, '__level', {
  get() { return level; },
  configurable: true,
});

// ============================================================
// UI SYSTEM — Main Menu, Loading Screen, HUD
// ============================================================
const uiManager = new UIManager();

const hudElement = createHUD();
uiManager.registerScreen('hud', hudElement);

createObjectivesPanel();
createDamageFlash();

const loadingScreenElement = createLoadingScreen();
uiManager.registerScreen('loading', loadingScreenElement);

// Credits overlay
// Centred by auto margins on the first and last child rather than
// justify-content: center, which clips a taller-than-viewport list out of
// scrolling reach.
function showCreditsOverlay() {
  const creditsDiv = document.createElement('div');
  creditsDiv.id = 'credits-overlay';
  creditsDiv.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: rgba(0,0,0,0.95);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    color: white;
    font-family: 'Courier New', monospace;
    z-index: 200;
    overflow-y: auto;
    padding: 20px;
  `;
    creditsDiv.innerHTML = `
    <h1 style="color: #00ffff; font-size: 36px; margin: auto auto 30px;">CREDITS</h1>
    <div style="text-align: left; font-size: 15px; line-height: 1.7; color: #aaa; max-width: 720px;">
      <h2 style="color: #ffffff; font-size: 20px; margin-bottom: 10px;">AI ASSISTANCE ACKNOWLEDGMENT</h2>
      <p>This project was developed with the assistance of AI tools:</p>
      <p>● <strong style="color: #00ffff;">Qoder</strong> — AI-powered coding assistant for code generation, debugging, documentation, and technical implementation</p>
      <p>● <strong style="color: #00ffff;">DeepSeek</strong> — AI language model for code review, problem-solving, and development support</p>
      <p style="font-size: 13px; color: #666; margin-left: 20px; margin-top: 8px;">AI tools were used under human supervision. All creative decisions, game design, and final code ownership remain with the development team.</p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 24px; margin-bottom: 10px;">LIBRARIES</h2>
      <p>● Three.js r186 (MIT) — renderer, animation, FBX/glTF loaders - <a href="https://threejs.org" style="color: #00ffff;">threejs.org</a></p>
      <p>● Howler.js 2.2 (MIT) — audio playback - <a href="https://howlerjs.com" style="color: #00ffff;">howlerjs.com</a></p>
      <p>● Vite 8 (MIT) — build tool - <a href="https://vitejs.dev" style="color: #00ffff;">vitejs.dev</a></p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 24px; margin-bottom: 10px;">MUSIC</h2>
      <p>● Level 1 — chiptune loop: <em>source to confirm</em></p>
      <p>● Level 2 — orchestral loop: <em>source to confirm</em></p>
      <p>● Level 3 — electronic loop (OpenGameArt "Sci-Fi Drone" by jdagenet, CC-BY 4.0) - <a href="https://opengameart.org/content/sci-fi-drone" style="color: #00ffff;">opengameart.org</a></p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 24px; margin-bottom: 10px;">SOUND EFFECTS (OpenGameArt)</h2>
      <p>● Punch SFX by DavidW (CC-BY 3.0) - <a href="https://opengameart.org/content/punch-sfx" style="color: #00ffff;">Link</a></p>
      <p>● 37 hits/punches by independent.nu (CC-BY 3.0) - <a href="https://opengameart.org/content/37-hitspunches" style="color: #00ffff;">Link</a></p>
      <p>● Spell Sounds Starter Pack by p0ss (CC-BY-SA 3.0) - <a href="https://opengameart.org/content/spell-sounds-starter-pack" style="color: #00ffff;">Link</a></p>
      <p>● A Kinda Cool Sound Effect by Spring Spring (CC0) - <a href="https://opengameart.org/content/a-kinda-cool-sound-effect" style="color: #00ffff;">Link</a></p>
      <p>● Tactical Weapons and Tactics Sound Pack by XCVG (CC-BY 3.0) - <a href="https://opengameart.org/content/tactical-weapons-and-tactics-sound-pack" style="color: #00ffff;">Link</a></p>
      <p style="font-size: 13px; color: #666; margin-left: 20px;">Used for punch_hit, boss_hit, boss_phase_change, enemy_death, fragment_collected and portal_activate.</p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 24px; margin-bottom: 10px;">VOICE ACTING (AI-Generated)</h2>
      <p>● Sorini (Sonia) & Axiom (Brian) — <a href="https://freetts.ai" style="color: #00ffff;">FreeTTS.ai</a></p>
      <p>● The Enforcer (Darlene, Monster effect) — <a href="https://speechgen.io" style="color: #00ffff;">SpeechGen.io</a></p>
      <p>● The Architect (Pain) & Narrator (Madara Uchiha V1) — <a href="https://fish.audio" style="color: #00ffff;">Fish Audio</a></p>
      <p style="font-size: 13px; color: #666; margin-left: 20px;">42 lines across Levels 1–3. All voices are AI-generated and used under their respective free-tier terms.</p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 24px; margin-bottom: 10px;">CHARACTER MODELS (Mixamo)</h2>
      <p>● Kachujin — player, Sorini</p>
      <p>● X_Bot — grunts, the Commander, and both Level 3 guardians (Blade and Fist)</p>
      <p>● Dreyar — The Architect</p>
      <p>● Enforcer — Level 2 boss</p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 24px; margin-bottom: 10px;">ANIMATIONS (Mixamo)</h2>
      <p>● <em>Sorini</em> — Idle, Swagger Walk, Running, Punching, Kicking, Hook, Jump, Dying</p>
      <p>● <em>Grunts / Commander / guardians</em> — Idle, Walk, Run, Punch, Kick, Hit, Dying, Running, Boxing, Kicking, Reaction, Dying, Sprinting Forward Roll, Being Cocky, Sitting Pose</p>
      <p>● <em>The Architect</em> — Idle, Great Sword Run, Standing Clap, Stable Sword Inward Slash, Stable Sword Outward Slash, Hurricane Kick, Great Sword Attack, Drop Kick, Great Sword High Spin Attack, Reaction, Sword Death, Sitting Pose</p>
      <p>● <em>Blade</em> — Great Sword Idle, Great Sword Run, Great Sword Casting, Great Sword Kick, Great Sword Slash, Hit To Body, Sword Death</p>
      <p>● <em>Fist / Level 2 boss</em> — Idle, Walk, Run, Left Punch, Right Punch, Cross Punch, Elbow Punch, Kick, Roundhouse Kick, Head Hit, Stomach Hit, Dying</p>
      <p style="font-size: 13px; color: #666; margin-left: 20px;">All character models and animation clips are downloaded from <a href="https://www.mixamo.com" style="color: #666;">Mixamo</a> and used under the <a href="https://www.adobe.com/legal/terms.html" style="color: #666;">Adobe/Mixamo terms</a>. Animation clips are retargeted in-engine onto each rig's skeleton.</p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 24px; margin-bottom: 10px;">ENVIRONMENTS & PROPS</h2>
      <p>● Space Ship Hallway — Level 3 interior corridor (Sketchfab download) - <a href="https://sketchfab.com" style="color: #00ffff;">sketchfab.com</a> · <em>author + licence to confirm</em></p>
      <p>● Light — Level 2 prop, Kenney (CC0) - <a href="https://kenney.nl" style="color: #00ffff;">kenney.nl</a></p>
      <p>● Spaceship — Level 3 exterior hull: <em>source to confirm</em></p>
      <p style="font-size: 13px; color: #666; margin-left: 20px;">The Level 3 moon terrain, its environment map, all portals, particles and Level 1 village geometry are generated procedurally in code by the team.</p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 24px; margin-bottom: 10px;">TEXTURES (Level 2)</h2>
      <p>● Road, Brick, Ground, Poster, Burner, Skybox</p>
      <p style="font-size: 13px; color: #666; margin-left: 20px;"><em>Source + licence to confirm.</em></p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 24px; margin-bottom: 10px;">ORIGINAL WORK BY THE TEAM</h2>
      <p>● All GLSL (Banele &amp; Pumelela) — analytic moon (craters, maria, rim lighting), Level 1 night sky, animated water, fireflies, Level 3 nebula skybox, god-ray cone, and the model dissolve effect</p>
      <p>● Level geometry, story, dialogue, cinematics, combat AI, physics and UI</p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 24px; margin-bottom: 10px;">TEAM MEMBERS</h2>
      <p>● Banele — UI, Audio, Deployment, Voice Direction, Players, Shaders</p>
      <p>● Pumelela — Environment, Art, Shaders</p>
      <p>● Sibusiso — Player, Controls, Physics</p>
    </div>
    <button id="credits-back" style="
      margin: 40px auto auto;
      background: #00ffff;
      border: none;
      color: #000;
      padding: 12px 40px;
      font-size: 18px;
      font-family: 'Courier New', monospace;
      cursor: pointer;
      border-radius: 8px;
    ">BACK</button>
  `;
  document.body.appendChild(creditsDiv);
  document.getElementById('credits-back').addEventListener('click', () => {
    creditsDiv.remove();
  });
}

// Controls overlay — how to play.
// fromMenu: opened from the main menu rather than the pause menu —
// closing then restores the main-menu screen.
function showControlsOverlay(fromMenu = false) {
  const controlsDiv = document.createElement('div');
  controlsDiv.id = 'controls-overlay';
  controlsDiv.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: rgba(0,0,0,0.95);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: white;
    font-family: 'Courier New', monospace;
    z-index: 400; /* above the pause menu (300) — also opened from pause */
    overflow-y: auto;
    padding: 20px;
  `;
    controlsDiv.innerHTML = `
    <h1 style="color: #00ffff; font-size: 36px; margin-bottom: 30px;">CONTROLS</h1>
    <div style="text-align: left; font-size: 16px; line-height: 2; color: #aaa; max-width: 600px; max-height: 78vh; overflow-y: auto; padding-right: 12px;">
      <h2 style="color: #ffffff; font-size: 20px; margin-bottom: 10px;">MOVEMENT</h2>
      <p>● W / ↑ — Walk forward (hold SHIFT to sprint)</p>
      <p>● S / ↓ — Turn around and walk the other way</p>
      <p>● A / ← and D / → — Rotate Sorini</p>
      <p>● Mouse — Look around (click the screen to capture the mouse)</p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 20px; margin-bottom: 10px;">COMBAT</h2>
      <p>● F — Punch</p>
      <p>● G — Kick</p>
      <p>● H — Hook</p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 20px; margin-bottom: 10px;">MOVES</h2>
      <p>● SPACE — Jump</p>
      <p>● SHIFT + SPACE — Axiom dash (unlocks on Level 2)</p>
      <p>● Q — Axiom's True Form — merge with the Axiom for 8s of boosted power (unlocks in Level 3, when Axiom offers the merge at the ship)</p>

      <h2 style="color: #ffffff; font-size: 20px; margin-top: 20px; margin-bottom: 10px;">GENERAL</h2>
      <p>● SPACE / ENTER — Skip a dialogue line</p>
      <p>● ESC — Pause menu</p>
    </div>
    <button id="controls-back" style="
      margin-top: 40px;
      background: #00ffff;
      border: none;
      color: #000;
      padding: 12px 40px;
      font-size: 18px;
      font-family: 'Courier New', monospace;
      cursor: pointer;
      border-radius: 8px;
    ">BACK</button>
  `;
  document.body.appendChild(controlsDiv);
  document.getElementById('controls-back').addEventListener('click', () => {
    controlsDiv.remove();
    // Opened from the main menu → guarantee the menu is the screen
    // showing when we return. (The overlay used to be the only thing
    // keeping the menu visible on some machines; this makes BACK
    // self-healing.)
    if (fromMenu && !gameStarted.value && uiManager) {
      uiManager.showScreen('main-menu');
    }
  });
}

// ── Pause menu — options, restart level, quit to menu ──
// ── Quality toggle (pause menu) — LOW trades fill rate and shadow
// resolution for FPS on weak GPUs; HIGH is the full setup. ──
function _setShadowResolution(size) {
  scene.traverse((o) => {
    if (o.isLight && o.shadow) {
      o.shadow.mapSize.set(size, size);
      if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
    }
  });
}
function applyQuality(mode) {
  if (mode === 'low') {
    renderer.setPixelRatio(1);
    _setShadowResolution(1024);
  } else {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    _setShadowResolution(2048);
  }
  try { localStorage.setItem('genesis-quality', mode); } catch (e) { /* private mode */ }
}
let qualityMode = 'high';
try { qualityMode = localStorage.getItem('genesis-quality') === 'low' ? 'low' : 'high'; } catch (e) {}
applyQuality(qualityMode);

const pauseMenu = new PauseMenu({
  audioManager,
  initialSensitivity: 0.0022,
  initialQuality: qualityMode,
  onSensitivityChange: (v) => { mouseSensitivity = v; },
  onQualityChange: (mode) => { qualityMode = mode; applyQuality(mode); },
  onResume: () => {
    pauseMenu.hide();
    // This click is the browser gesture; if Chrome's post-Esc cooldown
    // rejects the lock, requestGamePointerLock retries ~1.4 s later.
    requestGamePointerLock();
  },
  onRestartLevel: () => {
    pauseMenu.hide();
    switchLevel(current);
  },
  onControls: () => {
    showControlsOverlay(false);   // pause menu context — just close on BACK
  },
  onQuitToMenu: () => restartToMenu(),
});

// ── Full in-page restart — back to the main menu, no page refresh ──
function restartToMenu() {
  if (document.pointerLockElement) document.exitPointerLock();
  pauseMenu.hide();
  hideDebrief();
  hideFailScreen();

  disposeCurrentLevel();
  level = null;
  current = 1;
  _lastDeathPos = null;
  _levelDeaths = 0;
  resetRunStats();   // the campaign total belongs to the run just finished

  // Remove any ending overlay left over from the Level 3 endings
  const endOverlay = document.getElementById('endOverlay');
  if (endOverlay && endOverlay.parentNode) endOverlay.parentNode.removeChild(endOverlay);

  // Reset transient gameplay state
  playerHealth.reset();
  player.vel.set(0, 0, 0);
  dash.enabled = false;
  dash.cooldown = 0;
  dash.activeTimer = 0;
  trueForm.reset();
  attackCooldown.f = 0; attackCooldown.g = 0; attackCooldown.h = 0;
  attackLock = false;
  for (const k of Object.keys(keys)) keys[k] = false;

  // Silence every sound and blank the game canvas
  audioManager.reset();
  renderer.clear();

  // Back to the main menu
  uiManager.hideHUD();
  updateObjectives(null);
  uiManager.showScreen('main-menu');
  menuCanvas.style.display = '';
  if (menuScene) menuScene.start();
}
window.__restartToMenu = restartToMenu;

// Main Menu — with PLAY and CREDITS callbacks
const gameStarted = { value: false };

const LEVEL1_STORY =
  'The Axiom on Sorini\'s chest drew her to an unfamiliar land — and the aliens ' +
  'hunting it followed. Stop them before they ruin the village looking for her, ' +
  'then face the Warden.';

const LEVEL2_STORY =
  'The Warden is dead, but the Architect\'s grip on the city is tightening. ' +
  'Sorini moves through the neon-lit streets — the Axiom thrumming against her chest, ' +
  'guiding her toward the signal source. But the Architect sent his deadliest enforcer ' +
  'to hold the district. Break through The Enforcer, and the path to the monument opens.';

const LEVEL3_STORY =
  'The Enforcer lies broken in the street behind you. Above the city, the Architect\'s ' +
  'monument pulses on the moon — a black spire built from the same alien metal as the ' +
  'Axiom itself. Sorini boards the Genesis ship. The Axiom speaks: *"You are ready."* ' +
  'At the throne room, the Architect rises without touching his seat. He draws a ' +
  'greatsword from thin air. This is the last fight. Win, and you decide what becomes ' +
  'of the god who made your parasite.';

const mainMenuElement = createMainMenu(
  // PLAY
  () => {
        // Hide the menu 3D scene
    menuCanvas.style.display = 'none';
    if (menuScene) {
      menuScene.stop();
    }
    audioManager.playMusic('level_1_chiptune');

    uiManager.showScreen('loading');
    updateLoadingScreen(
      'LEVEL 1',
      'THE GROVE VILLAGE',
      LEVEL1_STORY,
      0,
      'Initializing...'
    );

    let progress = 0;
    const loadInterval = setInterval(() => {
      progress += Math.random() * 15 + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(loadInterval);
        updateLoadingScreen(
          'LEVEL 1',
          'THE GROVE VILLAGE',
          LEVEL1_STORY,
          100,
          'Ready!',
          true
        );

        const continueBtn = document.getElementById('continueBtn');
        if (continueBtn) {
          continueBtn.onclick = () => {
            uiManager.hideAllScreens();
            uiManager.showHUD();
            if (!gameStarted.value) {
              gameStarted.value = true;
              switchLevel(1);
              tick();
            } else {
              switchLevel(1);
            }
            // Capture the mouse right away — THIS click is the user
            // gesture the browser requires, so Esc can pause without
            // any extra click on the canvas.
            requestGamePointerLock();
          };
        }
      } else {
        const statuses = ['Loading assets...', 'Building world...', 'Spawning enemies...', 'Almost ready...'];
        const statusIndex = Math.floor(Math.random() * statuses.length);
        updateLoadingScreen(
          'LEVEL 1',
          'THE GROVE VILLAGE',
          LEVEL1_STORY,
          progress,
          statuses[statusIndex % statuses.length]
        );
      }
    }, 200);
  },
  // CONTROLS
  () => {
    showControlsOverlay(true);   // main-menu context — BACK re-shows the menu
  },
  // CREDITS
  () => {
    showCreditsOverlay();
  }
);

uiManager.registerScreen('main-menu', mainMenuElement);

// ── Main Menu 3D Scene ──
const menuCanvas = document.createElement('canvas');
menuCanvas.id = 'menu-canvas';
// z-index 20 sits BELOW the UI stack (#ui-container is z-30, see
// UIManager.js) so the DOM menu always draws over this canvas.
// History: the canvas used to sit ABOVE the UI as a workaround for
// a Chromium compositing blackout caused by a backdrop-filter on
// the menu panel — that filter was removed, and the old stacking
// hid the panel's lower DOM (PLAY/CREDITS) behind the scene's
// opaque ground plane.
// The canvas is transparent where nothing is drawn, so the 3D
// characters blend behind the menu DOM, and pointer-events:none
// keeps stray clicks off the canvas.
menuCanvas.style.cssText = `
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 20;
  pointer-events: none;
`;
document.body.appendChild(menuCanvas);

const menuScene = new MenuScene(menuCanvas);
menuScene.start();
window.__menuScene = menuScene;   // debug handle for live inspection

uiManager.showScreen('main-menu');

// ---------- Vite HMR cleanup ----------
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(_rafId);
    try {
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement?.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    } catch (e) { console.warn('HMR renderer dispose failed:', e); }
    try {
      if (level && typeof level.dispose === 'function') level.dispose(scene);
    } catch (e) { console.warn('HMR level dispose failed:', e); }
    try {
      if (window.__dialogue) window.__dialogue.dispose();
    } catch (e) {}
  });
}