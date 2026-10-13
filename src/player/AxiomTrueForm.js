// src/player/AxiomTrueForm.js
// Axiom's True Form — the Level 3 payoff transformation.
//
// Pressing Q during the Architect fight merges Axiom with Sorini for
// 8 seconds. Her skin takes a cyan emissive tint, a backface
// rim-light silhouette wraps her, the chest reactor blooms into two
// nested counter-rotating octahedrons with radiating rays, hair
// sparks orbit her head, a pulse ring rolls out across the ground,
// motes stream toward her, and the whole fight feels like a power
// fantasy: double speed, triple damage, invincibility, faster
// attacks and a rebalanced Axiom Dash.
//
// Everything is code — no new FBX, no textures, no audio (yet).
// All tuning values live in CFG below.
import * as THREE from 'three';

const CFG = {
  // ── timing ──
  DURATION: 8,            // seconds of transformed combat
  COOLDOWN: 25,           // seconds before Q works again
  ACTIVATION: 0.5,        // activation sequence length
  DEACTIVATION: 1.0,      // power-down sequence length
  FREEZE: 0.1,            // world freeze at the start of activation
  SLOW_SCALE: 0.6,        // world speed for the rest of activation
  ORB_RELEASE: 0.3,       // deactivation moment the orb shrinks back

  // ── gameplay ──
  SPEED_MULT: 2,          // 4.5/9 walk/sprint -> 9/18
  DAMAGE_MULT: 3,         // punch 1->3, kick/hook 2->6
  ATTACK_RATE_MULT: 1 / 1.4, // multiplies attack cooldowns (1.4x faster)
  ANIM_RATE: 1.4,         // attack clips play 1.4x faster
  DASH_COOLDOWN: 0.5,     // Axiom Dash cooldown while transformed
  DASH_DISTANCE: 20,      // Axiom Dash length while transformed

  // ── visuals ──
  FOV_ZOOM: 0.95,         // 5% camera pull-in
  LIGHT_MIN: 10,          // reactor point-light pulse floor
  LIGHT_MAX: 18,          // reactor point-light pulse ceiling
  TINT_COLOR: 0x00c8e0,   // skin emissive tint
  TINT_INTENSITY: 0.45,
  AURA_RADIUS: 1.35,
  HAIR_COUNT: 18,
  RING_PERIOD: 1.5,       // ground ring loop, seconds
  TRAIL_INTERVAL: 0.08,   // afterimage emission while moving
};

const DASH_RESTORE = { maxCooldown: 1.5, distance: 12 };

export class AxiomTrueForm {
  constructor(opts = {}) {
    this.scene = opts.scene || null;
    this.player = opts.player || null;
    this.playerHealth = opts.playerHealth || null;
    this.dash = opts.dash || null;
    this.spawnTrail = opts.spawnTrail || (() => {});
    this.getSoriniRoot = opts.getSoriniRoot || (() => null);
    this.getSoriniGroup = opts.getSoriniGroup || (() => null);
    this.getChestArtifact = opts.getChestArtifact || (() => null);
    this.isFightActive = opts.isFightActive || (() => false);

    // ready | activating | active | deactivating | cooldown
    this._phase = 'ready';
    this._phaseT = 0;
    this._cooldownLeft = 0;
    this._flashed = false;
    this._explodeT = 1;     // >= 0.3 means the aura burst already played
    this._trailTimer = 0;
    this._footTimer = 0;
    this._pullTimer = 0;

    this._built = false;
    this._disposed = false;
    this._disposables = [];   // geometries/materials this module owns
    this._sceneObjects = [];  // meshes added to the scene
    this._tintRecords = [];
    this._outlineMeshes = [];
    this._orbRig = null;
    this._octaA = null;
    this._octaB = null;
    this._rays = null;
    this._aura = null;
    this._ring = null;
    this._hair = null;
    this._footPool = null;
    this._pullPool = null;
    this._overlayEl = null;
    this._flashEl = null;
    this._indicatorEl = null;
  }

  // =========================================================
  // Public state used by main.js every frame
  // =========================================================
  get phase() { return this._phase; }
  get active() { return this._phase === 'active'; }
  get timeScale() {
    if (this._phase === 'activating') {
      return this._phaseT < CFG.FREEZE ? 0 : CFG.SLOW_SCALE;
    }
    return 1;
  }
  get speedMult() { return this.active ? CFG.SPEED_MULT : 1; }
  get damageMult() { return this.active ? CFG.DAMAGE_MULT : 1; }
  get attackRateMult() { return this.active ? CFG.ATTACK_RATE_MULT : 1; }
  get fovScale() { return this.active ? CFG.FOV_ZOOM : 1; }

  // =========================================================
  // Activation
  // =========================================================
  tryActivate() {
    if (this._phase !== 'ready' || this._cooldownLeft > 0) return false;
    if (!this.isFightActive()) return false;
    const root = this.getSoriniRoot();
    if (!root) return false;
    if (!this._built && !this._buildVisuals(root)) return false;

    this._phase = 'activating';
    this._phaseT = 0;
    this._flashed = false;
    return true;
  }

  // Force everything off with no cooldown — death / level exit path.
  abort() {
    this._restoreBuffs();
    this._restoreVisuals();
    this._phase = 'ready';
    this._phaseT = 0;
    this._cooldownLeft = 0;
  }

  // Clean reset for level switches / quit-to-menu.
  reset() {
    this.abort();
    if (this._overlayEl) this._overlayEl.style.opacity = '0';
    if (this._flashEl) {
      this._flashEl.style.transition = 'none';
      this._flashEl.style.opacity = '0';
    }
  }

  // =========================================================
  // Phase machine — called from tick() with REAL dt (not slowed)
  // =========================================================
  updateState(dt) {
    if (this._disposed) return;
    if (this._phase === 'cooldown') {
      this._cooldownLeft -= dt;
      if (this._cooldownLeft <= 0) {
        this._cooldownLeft = 0;
        this._phase = 'ready';
      }
    } else if (this._phase === 'activating') {
      this._phaseT += dt;
      if (!this._flashed && this._phaseT >= CFG.FREEZE) {
        this._flashed = true;
        this._flash();
      }
      if (this._phaseT >= CFG.ACTIVATION) this._enterActive();
    } else if (this._phase === 'active') {
      this._phaseT += dt;
      if (this._phaseT >= CFG.DURATION) this._enterDeactivating();
    } else if (this._phase === 'deactivating') {
      this._phaseT += dt;
      if (this._phaseT >= CFG.DEACTIVATION) this._enterCooldown();
    }
  }

  _enterActive() {
    this._phase = 'active';
    this._phaseT = 0;
    this._explodeT = 0;

    // ── gameplay buffs ──
    if (this.playerHealth) this.playerHealth.invincible = true;
    if (this.dash) {
      this.dash.maxCooldown = CFG.DASH_COOLDOWN;
      this.dash.distance = CFG.DASH_DISTANCE;
    }

    // ── visuals on ──
    this._applyTint(true);
    this._setOrbForm(true);
    if (this._aura) {
      this._aura.visible = true;
      this._aura.material.opacity = 0.10;
    }
    if (this._ring) this._ring.visible = true;
    if (this._hair) this._hair.visible = true;
    if (this._overlayEl) {
      this._overlayEl.style.transition = 'opacity 0.25s ease';
      this._overlayEl.style.opacity = '0.8';
    }
  }

  _enterDeactivating() {
    this._phase = 'deactivating';
    this._phaseT = 0;

    // Buffs end the moment the 8 seconds are spent.
    this._restoreBuffs();
    this._applyTint(false);
    if (this._overlayEl) {
      this._overlayEl.style.transition = `opacity ${CFG.DEACTIVATION}s ease`;
      this._overlayEl.style.opacity = '0';
    }
    // One last bright pulse before the aura shrinks away.
    if (this._aura) this._aura.material.opacity = 0.3;
  }

  _enterCooldown() {
    this._phase = 'cooldown';
    this._phaseT = 0;
    this._cooldownLeft = CFG.COOLDOWN;
    this._restoreVisuals();
  }

  _restoreBuffs() {
    if (this.playerHealth) this.playerHealth.invincible = false;
    if (this.dash) {
      this.dash.maxCooldown = DASH_RESTORE.maxCooldown;
      this.dash.distance = DASH_RESTORE.distance;
    }
  }

  _restoreVisuals() {
    this._applyTint(false);
    this._setOrbForm(false);
    if (this._aura) this._aura.visible = false;
    if (this._ring) this._ring.visible = false;
    if (this._hair) this._hair.visible = false;
    this._hideMotes();
    if (this._overlayEl) this._overlayEl.style.opacity = '0';
  }

  // =========================================================
  // Per-frame visuals — called AFTER main.js positions soriniGroup
  // =========================================================
  updateVisuals(dtW, t) {
    if (!this._built || this._disposed) return;
    const p = this.player;
    if (!p) return;
    const px = p.pos.x, py = p.pos.y, pz = p.pos.z;

    // ── Aura ──
    if (this._aura && this._aura.visible) {
      this._aura.position.set(px, py + 0.95, pz);
      if (this._phase === 'active') {
        if (this._explodeT < 0.3) {
          this._explodeT += Math.max(dtW, 0.0001);
          const k = Math.min(1, this._explodeT / 0.3);
          this._aura.scale.setScalar(0.4 + k * 1.2);
          this._aura.material.opacity = 0.10 + (1 - k) * 0.22;
        } else {
          this._aura.scale.setScalar(1 + Math.sin(t * 5) * 0.05);
          this._aura.material.opacity = 0.10 + Math.sin(t * 5) * 0.03;
        }
      } else if (this._phase === 'deactivating') {
        const k = 1 - this._phaseT / CFG.DEACTIVATION;
        this._aura.scale.setScalar(0.6 + k * 0.5);
        this._aura.material.opacity = 0.3 * k;
      }
    }

    const inShow = this._phase === 'active';

    // ── Ground pulse ring ──
    if (this._ring && this._ring.visible) {
      this._ring.position.set(px, py + 0.03, pz);
      const cyc = (t % CFG.RING_PERIOD) / CFG.RING_PERIOD;
      this._ring.scale.setScalar(0.8 + cyc * 2.4);
      this._ring.material.opacity = (1 - cyc) * 0.5;
    }

    // ── Hair sparks ──
    if (this._hair && this._hair.visible) {
      const pos = this._hair.geometry.attributes.position;
      for (let i = 0; i < CFG.HAIR_COUNT; i++) {
        const a = t * this._hairSpeed[i] + this._hairPhase[i];
        const r = this._hairRadius[i];
        pos.array[i * 3]     = px + Math.cos(a) * r;
        pos.array[i * 3 + 1] = py + 1.58 + Math.sin(t * 0.9 + i) * 0.09;
        pos.array[i * 3 + 2] = pz + Math.sin(a) * r;
      }
      pos.needsUpdate = true;
    }

    // ── Afterimage trail while moving ──
    if (inShow && Math.hypot(p.vel.x, p.vel.z) > 0.6) {
      this._trailTimer -= dtW;
      if (this._trailTimer <= 0) {
        this._trailTimer = CFG.TRAIL_INTERVAL;
        this.spawnTrail(p.pos.clone());
      }
    } else {
      this._trailTimer = 0;
    }

    // ── Feet fire + magnetic motes ──
    if (inShow) {
      this._footTimer -= dtW;
      if (this._footTimer <= 0) {
        this._footTimer = 0.09;
        this._spawnFootMote(px, py, pz);
      }
      this._pullTimer -= dtW;
      if (this._pullTimer <= 0) {
        this._pullTimer = 0.18;
        this._spawnPullMote(px, py, pz);
      }
    }
    this._updateMotes(this._footPool, dtW);
    this._updateMotes(this._pullPool, dtW);

    // ── Floating idle — she hovers just off the ground ──
    const group = this.getSoriniGroup();
    if (group && this.active && p.grounded &&
        Math.hypot(p.vel.x, p.vel.z) < 0.6) {
      // main.js sets the group position every frame BEFORE this runs,
      // so a small additive offset reads as a hover, not a drift.
      group.position.y += 0.10 + Math.sin(t * 3) * 0.03;
    }

    // ── Overlay pulse ──
    if (this._overlayEl && inShow) {
      this._overlayEl.style.opacity = (0.72 + Math.sin(t * 2.1) * 0.28).toFixed(3);
    }

    this._updateHUDText();
  }

  // =========================================================
  // Chest reactor override — main.js calls this instead of the
  // legacy pulse when the form owns the artifact. Returns whether
  // it handled the frame.
  // =========================================================
  tickArtifact(artifact, t, dtW) {
    if (!artifact || this._disposed) return false;
    const override =
      this._phase === 'active' ||
      (this._phase === 'activating' && this._phaseT >= 0.3) ||
      (this._phase === 'deactivating' && this._phaseT < CFG.ORB_RELEASE);
    if (!override) return false;

    const p = 0.5 + Math.sin(t * 7) * 0.5;
    artifact.ring.material.emissiveIntensity = 6 + p * 4;
    artifact.core.material.emissiveIntensity = 8 + p * 6;
    artifact.light.intensity =
      CFG.LIGHT_MIN + p * (CFG.LIGHT_MAX - CFG.LIGHT_MIN);
    artifact.light.distance = 6;
    artifact.coreSpin.rotation.z += 0.12;

    if (this._orbRig && this._orbRig.visible) {
      this._octaA.rotation.y += 1.6 * dtW;
      this._octaB.rotation.y -= 2.4 * dtW;
      this._rays.rotation.y += 0.5 * dtW;
    }
    return true;
  }

  // =========================================================
  // Visual construction
  // =========================================================
  _track(obj) {
    this._disposables.push(obj);
    return obj;
  }

  _buildVisuals(root) {
    if (this._disposed) return false;

    // ── Rim-light silhouette: one outline shell per skinned mesh.
    // The shells SHARE geometry and skeleton with the originals, so
    // they follow every animation with zero extra skinning cost.
    const outlineMat = this._track(new THREE.MeshBasicMaterial({
      color: 0x00d9f2,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
      depthWrite: false,
    }));
    let shellCount = 0;
    root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const shell = new THREE.SkinnedMesh(o.geometry, outlineMat);
      shell.skeleton = o.skeleton;
      shell.bindMatrix.copy(o.bindMatrix);
      shell.bindMatrixInverse.copy(o.bindMatrixInverse);
      shell.scale.setScalar(1.045);
      shell.frustumCulled = false;
      shell.castShadow = false;
      shell.receiveShadow = false;
      shell.visible = false;
      o.parent.add(shell);
      this._outlineMeshes.push(shell);
      shellCount++;
    });

    // ── Skin tint capture — restore exact originals on power-down ──
    const seen = new Set();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || seen.has(m) || !m.emissive) continue;
        seen.add(m);
        this._tintRecords.push({
          mat: m,
          emissive: m.emissive.clone(),
          intensity: m.emissiveIntensity,
        });
      }
    });

    // Outline shells are shown/hidden with the form.
    this._showOutlines = (on) => {
      for (const s of this._outlineMeshes) s.visible = on;
    };

    if (shellCount === 0) console.warn('[TrueForm] no skinned meshes — rim light skipped');

    // ── Aura sphere ──
    const auraGeo = this._track(new THREE.SphereGeometry(CFG.AURA_RADIUS, 24, 16));
    const auraMat = this._track(new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.10,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this._aura = new THREE.Mesh(auraGeo, auraMat);
    this._aura.visible = false;
    this.scene.add(this._aura);
    this._sceneObjects.push(this._aura);

    // ── Ground pulse ring ──
    const ringGeo = this._track(new THREE.RingGeometry(0.55, 0.72, 40));
    const ringMat = this._track(new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this._ring = new THREE.Mesh(ringGeo, ringMat);
    this._ring.rotation.x = -Math.PI / 2;
    this._ring.visible = false;
    this.scene.add(this._ring);
    this._sceneObjects.push(this._ring);

    // ── Hair sparks — orbiting points around her head ──
    const hairGeo = this._track(new THREE.BufferGeometry());
    hairGeo.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(CFG.HAIR_COUNT * 3), 3));
    const hairMat = this._track(new THREE.PointsMaterial({
      color: 0x9ff2ff,
      size: 0.05,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this._hair = new THREE.Points(hairGeo, hairMat);
    this._hair.frustumCulled = false;
    this._hair.visible = false;
    this.scene.add(this._hair);
    this._sceneObjects.push(this._hair);
    this._hairSpeed = [];
    this._hairPhase = [];
    this._hairRadius = [];
    for (let i = 0; i < CFG.HAIR_COUNT; i++) {
      this._hairSpeed.push(0.6 + Math.random() * 1.1);
      this._hairPhase.push(Math.random() * Math.PI * 2);
      this._hairRadius.push(0.16 + Math.random() * 0.15);
    }

    // ── Mote pools (feet fire + magnetic pull) ──
    this._footPool = this._makeMotePool(10, 0.03, 0x7fe9ff);
    this._pullPool = this._makeMotePool(12, 0.025, 0x00e5ff);

    // ── DOM: vignette, flash, indicator ──
    this._ensureDom();

    this._built = true;
    return true;
  }

  _makeMotePool(count, size, color) {
    const geo = this._track(new THREE.SphereGeometry(size, 6, 5));
    const mat = this._track(new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const meshes = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.scene.add(m);
      this._sceneObjects.push(m);
      meshes.push(m);
    }
    return { meshes, live: [] };
  }

  _spawnFootMote(px, py, pz) {
    const pool = this._footPool;
    const m = pool.meshes.find((x) => !x.visible);
    if (!m) return;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.25;
    m.position.set(px + Math.cos(a) * r, py + 0.05, pz + Math.sin(a) * r);
    m.scale.setScalar(1);
    m.visible = true;
    pool.live.push({
      mesh: m,
      life: 0.65,
      max: 0.65,
      vel: new THREE.Vector3(0, 1.1 + Math.random() * 0.5, 0),
    });
  }

  _spawnPullMote(px, py, pz) {
    const pool = this._pullPool;
    const m = pool.meshes.find((x) => !x.visible);
    if (!m) return;
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.2,
      Math.random() - 0.5
    ).normalize();
    m.position.set(
      px + dir.x * (3 + Math.random() * 1.5),
      py + 0.9 + dir.y * 2,
      pz + dir.z * (3 + Math.random() * 1.5)
    );
    m.scale.setScalar(1);
    m.visible = true;
    pool.live.push({
      mesh: m,
      life: 2.0,
      max: 2.0,
      vel: new THREE.Vector3(px, py + 0.95, pz)
        .sub(m.position).normalize().multiplyScalar(3.2),
      home: new THREE.Vector3(px, py + 0.95, pz),
    });
  }

  _updateMotes(pool, dtW) {
    if (!pool) return;
    for (let i = pool.live.length - 1; i >= 0; i--) {
      const o = pool.live[i];
      o.life -= dtW;
      o.mesh.position.addScaledVector(o.vel, dtW);
      const k = Math.max(0, o.life / o.max);
      o.mesh.scale.setScalar(k);
      let kill = o.life <= 0;
      if (o.home && o.mesh.position.distanceTo(o.home) < 0.5) kill = true;
      if (kill) {
        o.mesh.visible = false;
        pool.live.splice(i, 1);
      }
    }
  }

  _hideMotes() {
    for (const pool of [this._footPool, this._pullPool]) {
      if (!pool) continue;
      for (const o of pool.live) o.mesh.visible = false;
      pool.live.length = 0;
    }
  }

  _applyTint(on) {
    for (const rec of this._tintRecords) {
      const m = rec.mat;
      if (on) {
        m.emissive.setHex(CFG.TINT_COLOR);
        m.emissiveIntensity = CFG.TINT_INTENSITY;
      } else {
        m.emissive.copy(rec.emissive);
        m.emissiveIntensity = rec.intensity;
      }
      m.needsUpdate = true;
    }
    if (this._showOutlines) this._showOutlines(on);
  }

  _setOrbForm(on) {
    const artifact = this.getChestArtifact();
    if (!artifact) return;
    if (on && !this._orbRig) this._buildOrbRig(artifact);
    if (this._orbRig) this._orbRig.visible = on;
    if (!on && artifact.light) {
      artifact.light.distance = 2.5;   // restore the default falloff
    }
  }

  _buildOrbRig(artifact) {
    // The legacy core octahedron's radius, in chest-bone units — the
    // rig is sized relative to it so the merged orb reads as "3x".
    let unit = 3;
    const params = artifact.core && artifact.core.geometry
      ? artifact.core.geometry.parameters
      : null;
    if (params && params.radius) unit = params.radius;

    const rig = new THREE.Group();

    const matA = this._track(new THREE.MeshBasicMaterial({
      color: 0x9ff2ff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    const matB = this._track(new THREE.MeshBasicMaterial({
      color: 0x00d9f2, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));

    this._octaA = new THREE.Mesh(
      this._track(new THREE.OctahedronGeometry(unit * 2.4)), matA);
    this._octaB = new THREE.Mesh(
      this._track(new THREE.OctahedronGeometry(unit * 1.7)), matB);
    this._octaB.rotation.x = Math.PI / 4;
    rig.add(this._octaA, this._octaB);

    this._rays = new THREE.Group();
    const rayGeo = this._track(
      new THREE.CylinderGeometry(unit * 0.16, unit * 0.16, unit * 5, 6));
    for (let i = 0; i < 6; i++) {
      const holder = new THREE.Group();
      holder.rotation.z = (i / 6) * Math.PI * 2;
      const ray = new THREE.Mesh(rayGeo, matB);
      ray.position.y = unit * 4.7;   // pivot at centre, extends outward
      holder.add(ray);
      this._rays.add(holder);
    }
    rig.add(this._rays);

    rig.visible = false;
    artifact.group.add(rig);
    this._orbRig = rig;
  }

  // =========================================================
  // DOM overlays
  // =========================================================
  _ensureDom() {
    if (this._overlayEl) return;

    this._overlayEl = document.createElement('div');
    this._overlayEl.id = 'trueform-overlay';
    this._overlayEl.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 150;
      opacity: 0;
      background: radial-gradient(ellipse at center,
        rgba(0,0,0,0) 52%,
        rgba(0,229,255,0.13) 80%,
        rgba(0,229,255,0.22) 100%);
      box-shadow: inset 0 0 140px rgba(0,229,255,0.32);
    `;
    document.body.appendChild(this._overlayEl);

    this._flashEl = document.createElement('div');
    this._flashEl.id = 'trueform-flash';
    this._flashEl.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 160;
      background: #eaffff;
      opacity: 0;
    `;
    document.body.appendChild(this._flashEl);

    this._indicatorEl = document.createElement('div');
    this._indicatorEl.id = 'trueform-indicator';
    this._indicatorEl.style.cssText = `
      position: fixed;
      top: 88px; left: 20px;
      z-index: 50;
      pointer-events: none;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #666;
      display: none;
    `;
    document.body.appendChild(this._indicatorEl);
    this._indicatorEl._txt = '';
  }

  _flash() {
    if (!this._flashEl) return;
    const el = this._flashEl;
    el.style.transition = 'none';
    el.style.opacity = '1';
    // Force a style flush so the fade transition actually runs.
    void el.offsetWidth;
    el.style.transition = 'opacity 0.4s ease';
    el.style.opacity = '0';
  }

  _updateHUDText() {
    const el = this._indicatorEl;
    if (!el) return;
    const fight = this.isFightActive();
    const inSequence =
      this._phase === 'activating' || this._phase === 'active' ||
      this._phase === 'deactivating';

    if (!fight && !inSequence && this._cooldownLeft <= 0) {
      if (el.style.display !== 'none') el.style.display = 'none';
      return;
    }
    if (el.style.display === 'none') el.style.display = 'block';

    let txt;
    let color = '#00e5ff';
    let glow = 'none';
    if (this._phase === 'active') {
      txt = '\u26A1 TRUE FORM \u2014 ' + Math.ceil(CFG.DURATION - this._phaseT) + 's';
    } else if (inSequence) {
      txt = '\u26A1 TRUE FORM';
    } else if (this._cooldownLeft > 0) {
      txt = '\u26A1 TRUE FORM \u2014 ' + Math.ceil(this._cooldownLeft) + 's';
      color = '#666';
    } else {
      txt = '\u26A1 TRUE FORM \u2014 READY';
      glow = '0 0 12px rgba(0,229,255,0.8)';
    }
    if (el._txt !== txt) {
      el._txt = txt;
      el.textContent = txt;
      el.style.color = color;
      el.style.textShadow = glow;
    }
  }

  // =========================================================
  // Teardown
  // =========================================================
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.abort();

    const artifact = this.getChestArtifact();
    if (artifact && this._orbRig && this._orbRig.parent === artifact.group) {
      artifact.group.remove(this._orbRig);
    }
    for (const o of this._sceneObjects) {
      if (o.parent) o.parent.remove(o);
    }
    this._sceneObjects.length = 0;
    for (const s of this._outlineMeshes) {
      if (s.parent) s.parent.remove(s);
    }
    this._outlineMeshes.length = 0;
    for (const d of this._disposables) d.dispose();
    this._disposables.length = 0;

    for (const id of ['trueform-overlay', 'trueform-flash', 'trueform-indicator']) {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    this._overlayEl = this._flashEl = this._indicatorEl = null;
    this._built = false;
  }
}
