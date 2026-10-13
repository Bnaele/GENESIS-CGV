// ============================================================
// guardians.js — Level 3 boss guardians (grunt skin)
//   • Deferred model load (Enemy ctor fires _loadModel() before
//     this.kind exists — we wait one tick)
//   • skeletonClone per guardian (plain .clone() breaks SkinnedMesh)
//   • Root-motion-stripped clips (kills the run stutter)
//   • Sorini-grade physics + coordinated attack gate
// ============================================================
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Enemy, STATE } from './streetEnemies.js';
import {
  resolveEntity, pushOutOfCircle, worldColliders
} from '../physics/CollisionSystem.js';

const GRAV = 30;

const GUARDIAN_STATS = {
  blade: {
    health: 20, damage: 15, speed: 6.0,
    attackRange: 2.5, windup: 0.55, tail: 0.65, cooldown: 1.4,
    slot: 1.9, tint: 0xcc2233, scale: 1.1,
  },
  fist: {
    health: 30, damage: 25, speed: 4.2,
    attackRange: 3.0, windup: 0.35, tail: 0.5, cooldown: 1.2,
    slot: 2.1, tint: 0x2266cc, scale: 1.25,
  },
};

// ─────────────────────────────────────────────────────────────
// SHARED ASSET CACHE
// Load the base grunt FBX and every clip once; both guardians
// skeletonClone their own copy of the model afterwards.
// ─────────────────────────────────────────────────────────────
const GUARDIAN_BASE = './assets/models/enemy/';
const GUARDIAN_CLIP_FILES = {
  idle:    'grunt_idle.fbx',
  move:    'running.fbx',
  hit:     'reaction.fbx',
  die:     'dying.fbx',
};

// Combat kits — the red blade guardian borrows the Architect's
// great-sword set; the blue fist guardian borrows the Enforcer's
// strike set. Clips are authored for the Dreyar/Jones rigs, so each
// is remapped onto the grunt skeleton at load (remapClip below —
// same technique architect.js and enforcer.js use).
const GUARDIAN_ATTACK_KITS = {
  blade: {
    base: './assets/models/enemy/',
    files: {
      attack1: 'architect_stable_sword_inward_slash.fbx',
      attack2: 'architect_stable_sword_outward_slash.fbx',
      attack3: 'architect_hurricane_kick.fbx',
      attack4: 'architect_great_sword_attack.fbx',
    },
  },
  fist: {
    base: './assets/models/enemy/',
    files: {
      attack1: 'enforcer_left_punch.fbx',
      attack2: 'enforcer_right_punch.fbx',
      attack3: 'enforcer_cross_punch.fbx',
      attack4: 'enforcer_elbow_punch.fbx',
      attack5: 'enforcer_roundhouse_kick.fbx',
    },
  },
};

let _guardianAssetsPromise = null;

function loadFbx(loader, path) {
  return new Promise((resolve) => {
    loader.load(
      path,
      (fbx) => resolve(fbx),
      undefined,
      (err) => { console.warn('[Guardian] load failed:', path, err); resolve(null); }
    );
  });
}

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

// Bone-name remap — matches clip track names to the model's actual
// bone names so clips authored for other rigs (Dreyar/Jones) drive
// the grunt skeleton. Shared idiom with architect.js / enforcer.js.
function normalizeBoneName(n) {
  return n.replace(/^mixamorig:?/i, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function remapClip(clip, model) {
  if (!clip || !model) return clip;
  const exact = new Map();
  const norm  = new Map();
  model.traverse((o) => {
    if (!o.name) return;
    if (!exact.has(o.name)) exact.set(o.name, o.name);
    const n = normalizeBoneName(o.name);
    if (!norm.has(n)) norm.set(n, o.name);
  });
  const kept = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const nodeName = track.name.slice(0, dot);
    const prop = track.name.slice(dot);
    const target = exact.get(nodeName) || norm.get(normalizeBoneName(nodeName));
    if (target) {
      track.name = target + prop;
      kept.push(track);
    }
  }
  clip.tracks = kept;
  return clip;
}

function getGuardianAssets() {
  if (_guardianAssetsPromise) return _guardianAssetsPromise;
  _guardianAssetsPromise = (async () => {
    const loader = new FBXLoader();

    const baseFbx = await loadFbx(loader, GUARDIAN_BASE + 'grunt.fbx');
    if (!baseFbx) return null;

    const clips = {};
    await Promise.all(
      Object.entries(GUARDIAN_CLIP_FILES).map(async ([key, file]) => {
        const fbx = await loadFbx(loader, GUARDIAN_BASE + file);
        if (fbx?.animations?.[0]) {
          clips[key] = stripRootMotion(fbx.animations[0]);
        }
      })
    );

    const attackKits = {};
    await Promise.all(
      Object.entries(GUARDIAN_ATTACK_KITS).map(async ([kind, kit]) => {
        const kitClips = {};
        await Promise.all(
          Object.entries(kit.files).map(async ([key, file]) => {
            const fbx = await loadFbx(loader, kit.base + file);
            if (fbx?.animations?.[0]) {
              kitClips[key] = stripRootMotion(fbx.animations[0]);
            }
          })
        );
        attackKits[kind] = kitClips;
      })
    );

    return { baseFbx, clips, attackKits };
  })();
  return _guardianAssetsPromise;
}

// ─────────────────────────────────────────────────────────────
// WEAPONS
// ─────────────────────────────────────────────────────────────
function makeBlade() {
  const group = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 1.4),
    new THREE.MeshStandardMaterial({
      color: 0xff2233, emissive: 0xff2233,
      emissiveIntensity: 3.5, metalness: 0.3, roughness: 0.2,
    })
  );
  blade.position.set(0, 0, 0.7);
  group.add(blade);
  const hilt = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.14, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })
  );
  group.add(hilt);
  group.add(new THREE.PointLight(0xff2233, 4, 6, 2));
  return group;
}

function makeGauntlets() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x00ddff, emissive: 0x00ddff,
    emissiveIntensity: 3, metalness: 0.4, roughness: 0.25,
  });
  const left = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), mat);
  left.position.set(-0.5, 1.0, 0.2);
  group.add(left);
  const right = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), mat);
  right.position.set(0.5, 1.0, 0.2);
  group.add(right);
  const light = new THREE.PointLight(0x00ddff, 4, 6, 2);
  light.position.set(0, 1.0, 0.2);
  group.add(light);
  return group;
}

// ─────────────────────────────────────────────────────────────
// GUARDIAN
// ─────────────────────────────────────────────────────────────
export class Guardian extends Enemy {
  constructor(parent, position, kind = 'blade', attackGate = null, level = null) {
    super(parent, position, 'human', attackGate);

    // Set by the time _doLoadModel actually runs (next tick).
    this.kind    = kind;
    this.level   = level;
    this.spawnY  = position.y;
    this.vel     = new THREE.Vector3();
    this._chasing = false;

    const stats = GUARDIAN_STATS[kind];
    this.health              = stats.health;
    this.maxHealth           = stats.health;
    this.moveSpeed           = stats.speed;
    this.guardianDamage      = stats.damage;
    this.guardianAttackRange = stats.attackRange;
    this.guardianWindup      = stats.windup;
    this.guardianTail        = stats.tail;
    this.guardianCooldown    = stats.cooldown;

    const side = kind === 'blade' ? -1 : 1;
    // Flank slot INSIDE attack range — a slot the guardian can stand
    // on while still short of swing distance deadlocks the approach.
    this.attackOffset.set(side * stats.slot, 0, 0);

    this.isGuardian = true;
    this.dead = false;
  }

  // ── Defer actual load by one tick ──
  // Enemy's constructor calls this BEFORE our constructor body runs,
  // so this.kind isn't set yet. Deferring lets us read GUARDIAN_STATS
  // safely and prevents the silent async-catch crash that was leaving
  // the guardian invisible.
  _loadModel() {
    setTimeout(() => this._doLoadModel(), 0);
  }

  // Parent Enemy also tries to load anims — we do it ourselves.
  _loadAnims() { /* no-op */ }

  async _doLoadModel() {
    const stats = GUARDIAN_STATS[this.kind];
    if (!stats) {
      console.warn('[Guardian] unknown kind:', this.kind);
      return;
    }

    const assets = await getGuardianAssets();
    if (!assets || this._disposed) return;

    // skeletonClone — the crucial part. Plain .clone(true) shares
    // the original bone hierarchy, so the SkinnedMesh renders a
    // static/wrong pose no matter what the mixer does.
    const fbx = skeletonClone(assets.baseFbx);
    fbx.scale.setScalar(0.013 * stats.scale);
    // Feet sit at local y≈0 (Mixamo origin) and update() snaps the group to
    // the hall floor — keep the model un-offset (a previous -0.13 here sank
    // every guardian 13 cm into the floor).
    fbx.position.y = 0;

    fbx.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) {
          o.material = Array.isArray(o.material)
            ? o.material.map((m) => m.clone())
            : o.material.clone();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            if (m.color) m.color.setHex(stats.tint);
            if (m.emissive) {
              m.emissive.setHex(stats.tint);
              m.emissiveIntensity = 0.3;
            }
          });
        }
      }
    });

    this.group.add(fbx);
    this.fbx   = fbx;
    this.mixer = new THREE.AnimationMixer(fbx);

    for (const [key, clip] of Object.entries(assets.clips)) {
      if (!clip) continue;
      this.actions[key] = this.mixer.clipAction(clip);
    }

    // Kind-specific combat kit — remapped onto THIS clone so the
    // Architect/Enforcer-authored clips bind to the grunt skeleton.
    this._attackNames = [];
    const kit = assets.attackKits[this.kind] || {};
    for (const [key, clip] of Object.entries(kit)) {
      if (!clip) continue;
      this.actions[key] = this.mixer.clipAction(remapClip(clip, fbx));
      this._attackNames.push(key);
    }

    if (this.state === STATE.IDLE) this._playAction('idle');
    this._attachWeapon();
  }

  _attachWeapon() {
    if (this.weaponMesh) return;
    const weapon = this.kind === 'blade' ? makeBlade() : makeGauntlets();
    weapon.position.set(0.6, 1.1, 0.3);
    this.group.add(weapon);
    this.weaponMesh = weapon;
  }

  // ── Smooth transitions — loops don't reset, one-shots do ──
  _playAction(name, loop = true) {
    this._desiredAction = { name, loop };
    let next = this.actions[name];
    if (!next && /^attack/.test(name)) {
      next = this.actions[this._attackNames?.[0]]
          || this.actions.attack1 || this.actions.attack2;
    }
    if (!next) return;

    if (next === this.currentAction) {
      if (loop || next.isRunning()) return;
      next.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.1).play();
      return;
    }

    if (this.currentAction) this.currentAction.fadeOut(0.18);
    if (!loop) next.reset();
    next
      .setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
      .fadeIn(0.18)
      .play();
    if (!loop) next.clampWhenFinished = true;
    this.currentAction = next;
  }

  alert() {
    if (this.alerted || this.state === STATE.DEAD || this._disposed) return;
    this.alerted = true;
    this.state   = STATE.ALERTED;
    this._playAction('idle');

    const delay = 400 + Math.random() * 700;
    setTimeout(() => {
      if (this._disposed || this.state === STATE.DEAD) return;
      this.state = STATE.WALKING;
      this._chasing = true;
      this._playAction('move');
    }, delay);
  }

  _startSwing() {
    // Rotate through the guardian's combat kit so the fight never
    // loops one move (Architect slashes for blade, Enforcer jabs
    // and kicks for fist).
    const names = (this._attackNames && this._attackNames.length)
      ? this._attackNames : ['attack1', 'attack2'];
    const idx  = names.indexOf(this._lastAttack);
    const pick = names[(idx + 1) % names.length];
    this._lastAttack = pick;
    this._playAction(pick, false);

    this.swingTimer   = this.guardianWindup;
    this.swingLanded  = false;
    this.recoverTimer = this.guardianWindup + this.guardianTail + 0.35
                      + Math.random() * 0.35;

    if (this.weaponMesh) {
      this.weaponMesh.traverse((o) => {
        if (o.isMesh && o.material && o.material.emissiveIntensity !== undefined)
          o.material.emissiveIntensity = 6;
        if (o.isLight) o.intensity = 12;
      });
      setTimeout(() => {
        if (this._disposed || !this.weaponMesh) return;
        this.weaponMesh.traverse((o) => {
          if (o.isMesh && o.material && o.material.emissiveIntensity !== undefined)
            o.material.emissiveIntensity = 3.5;
          if (o.isLight) o.intensity = 4;
        });
      }, this.guardianWindup * 1000);
    }
  }

  takeDamage(amount = 1) {
    if (this.state === STATE.DEAD || this._disposed) return false;
    this._releaseSlot();
    this.swingLanded = false;
    if (this.vel) this.vel.set(0, 0, 0);
    this.health -= amount;

    if (this.health <= 0) { this._die(); this.dead = true; return true; }

    this.state = STATE.HIT;
    this._playAction('hit', false);
    setTimeout(() => {
      if (this._disposed || this.state === STATE.DEAD) return;
      this.state = STATE.WALKING;
      this._chasing = true;
      this._playAction('move');
    }, 500);
    return false;
  }

  update(dt, playerPos) {
    if (this._disposed) return;

    if (this.mixer) this.mixer.update(dt);
    if (this.state === STATE.DEAD) return;

    // ── Combat distances ──
    // Attack decisions key on distance to the PLAYER. The flank slot
    // (playerPos + attackOffset) only steers movement: slot points
    // can sit on the far side of the player, where pushOutOfCircle
    // used to trap a chasing guardian at the barrier — running in
    // place forever, never reaching swing range (the "invisible
    // wall" bug where neither side could land a hit).
    const pdx = playerPos.x - this.group.position.x;
    const pdz = playerPos.z - this.group.position.z;
    const playerDist = Math.hypot(pdx, pdz);
    const stopDist  = this.guardianAttackRange * 0.8;
    const abortDist = this.guardianAttackRange + 1.5;

    const dx = playerPos.x + this.attackOffset.x - this.group.position.x;
    const dz = playerPos.z + this.attackOffset.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);

    // Face the player once in combat range; the flank slot while closing.
    const fx = playerDist <= abortDist ? pdx : dx;
    const fz = playerDist <= abortDist ? pdz : dz;
    if (Math.abs(fx) > 0.1 || Math.abs(fz) > 0.1) {
      this.group.rotation.y = Math.atan2(fx, fz);
    }

    if (this.state === STATE.WALKING) {
      if (playerDist > stopDist) {
        // Close in — head for the flank slot, but beeline the player
        // when the slot is behind them or already reached: a slot
        // outside stop range must never leave us parked short.
        const stuck  = playerDist < dist - 0.5;
        const atSlot = dist < 0.35;
        const mx = (stuck || atSlot) ? pdx : dx;
        const mz = (stuck || atSlot) ? pdz : dz;
        const len = Math.hypot(mx, mz) || 1;
        this.group.position.x += (mx / len) * this.moveSpeed * dt;
        this.group.position.z += (mz / len) * this.moveSpeed * dt;
        this._playAction('move');
      } else if (this.recoverTimer > 0) {
        this.recoverTimer -= dt;
        this._playAction('idle');
      } else if (this.gate && this.gate.current >= this.gate.max) {
        this._playAction('idle');
      } else {
        if (this.gate) { this.gate.current++; this._holdsSlot = true; }
        this.state = STATE.ATTACKING;
        this._startSwing();
      }
    } else if (this.state === STATE.ATTACKING) {
      if (playerDist > abortDist) {
        // Player broke away — cancel the swing and give the slot back
        this._releaseSlot();
        this.swingLanded = false;
        this.state = STATE.WALKING;
        this._playAction('move');
      } else {
        this.swingTimer -= dt;
        if (this.swingTimer <= 0 && !this.swingLanded) this.swingLanded = true;
        this.recoverTimer -= dt;
        if (this.recoverTimer <= 0) {
          this._releaseSlot();
          if (playerDist <= this.guardianAttackRange &&
              (!this.gate || this.gate.current < this.gate.max)) {
            if (this.gate) { this.gate.current++; this._holdsSlot = true; }
            this._startSwing();
          } else {
            this.state = STATE.WALKING;
            this._playAction('move');
          }
        }
      }
    }

    // ── Gravity + ground snap ──
    this.vel.y -= GRAV * dt;
    this.group.position.y += this.vel.y * dt;

    let ground = this.spawnY;
    if (this.level && typeof this.level.getSurfaceHeight === 'function') {
      try {
        ground = this.level.getSurfaceHeight(
          this.group.position.x,
          this.group.position.z,
          this.group.position.y
        );
      } catch (e) { /* fall back to spawnY */ }
    }
    if (this.group.position.y <= ground) {
      this.group.position.y = ground;
      this.vel.y = 0;
    }

    resolveEntity(this.group.position, worldColliders, 0.45, 2.0);
    pushOutOfCircle(this.group.position, playerPos, 0.85);

    if (this.level && Array.isArray(this.level.guardians)) {
      for (const other of this.level.guardians) {
        if (other === this || other._disposed) continue;
        if (other.state === STATE.DEAD) continue;
        pushOutOfCircle(this.group.position, other.group.position, 1.4);
      }
    }
  }
}
