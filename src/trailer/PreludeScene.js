// ============================================================
// src/trailer/PreludeScene.js
// GENESIS trailer prologue — the "flipping pictures" storybook.
//
// A self-contained night-time world the TrailerDirector cuts
// between as if turning pages:
//
//   HOME     — Sorini asleep in her small house, moonlight
//              through the window
//   THE FALL — an artifact streaks down and crashes in the
//              field outside
//   VISITOR  — the artifact drifts in through the window and
//              docks in her chest
//   TAKING   — it takes her: she rises out of the bed, chest
//              blazing
//   INVASION — the same night, Japan: Mount Fuji under a blood
//              moon, ships overhead, the war already begun
//              (no fighting — she is not there yet)
//
// Everything reuses the game's real assets — sorini.fbx, the
// chest reactor from chestArtifact.js and Spaceship.fbx — so
// the prologue footage is indistinguishable from the game it
// advertises.
// ============================================================
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { attachChestArtifact } from '../player/chestArtifact.js';

// ── Room layout (world metres) ──
const ROOM_W = 6, ROOM_D = 5, ROOM_H = 3.2;
const WINDOW_X = 0;
const WIN_SILL = 1.0, WIN_W = 1.7, WIN_H = 1.3;

// ── Bed (against the -X wall, headboard at -Z) ──
const BED_X = -0.5;
const BED_Z_MIN = -2.35, BED_Z_MAX = 0.85;
const BED_W = 1.3;
const FRAME_H = 0.32, MATT_H = 0.22;
const MATT_TOP = FRAME_H + MATT_H;

// ── Sorini poses ──
// Lying: her FBX origin sits at her FEET (Mixamo), so after the
// -90° X rotation her body stretches toward -Z — head lands on
// the pillow, feet near the window side of the bed.
const LIE_POS = new THREE.Vector3(BED_X, MATT_TOP + 0.16, -0.1);
const STAND_POS = new THREE.Vector3(-0.35, 0, -0.6);

// ── The crash site, just outside the window ──
const CRATER = new THREE.Vector3(1.2, 0, 8.5);
const METEOR_FROM = new THREE.Vector3(-26, 15, 24);

// ── Invasion vista ──
const SHIP_SPOTS = [
  { pos: [-8, 10, 16],  phase: 0.0 },
  { pos: [7, 13, 22],   phase: 2.1 },
  { pos: [15, 8.5, 12], phase: 4.2 },
];

function smooth(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

export class PreludeScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070f);
    this.scene.fog = new THREE.FogExp2(0x05070f, 0.045);

    // Cinematic lens — tighter than the gameplay 75° FOV
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 400);

    // State the build steps below push into — must exist first
    this._meteorT = -1;          // <0 = not launched
    this._meteorVel = new THREE.Vector3();
    this._trail = [];
    this._fireLights = [];

    this._buildLights();
    this._buildSky();
    this._buildRoom();
    this._buildBed();
    this._buildExterior();
    this._buildFlyer();
    this._buildInvasion();

    // ── Sorini + her chest reactor ──
    this._soriniReady = false;
    this._loadSorini();

    this._time = 0;

    // Resolved once sorini.fbx (and her reactor) are in the scene —
    // the director awaits this before rolling the first card.
    this.ready = new Promise((resolve) => { this._resolveReady = resolve; });
  }

  // ======================================================
  // WORLD BUILDING
  // ======================================================
  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x24304d, 0x0a0c14, 0.5);
    this.scene.add(hemi);
    this.hemi = hemi;

    // Cool moonlight raking in through the window
    const moon = new THREE.DirectionalLight(0x9db8ff, 1.15);
    moon.position.set(2, 9, 14);
    moon.target.position.set(BED_X, 0, -1);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -8; moon.shadow.camera.right = 8;
    moon.shadow.camera.top = 8; moon.shadow.camera.bottom = -8;
    this.scene.add(moon);
    this.scene.add(moon.target);
    this.moonLight = moon;

    // Warm bedside lamp — the only "home" light in the dark
    const lamp = new THREE.PointLight(0xffb066, 1.1, 7, 2);
    lamp.position.set(1.05, 1.05, -1.9);
    this.scene.add(lamp);
    this.lampLight = lamp;

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc98a }));
    bulb.position.copy(lamp.position);
    this.scene.add(bulb);
  }

  _buildSky() {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(160, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x05070f, side: THREE.BackSide, fog: false }));
    this.scene.add(dome);

    // Stars — scattered over the upper hemisphere only
    const starCount = 450;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;   // keep them up high
      const r = 95 + Math.random() * 40;
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi) + 4;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xbfd4ff, size: 1.1, sizeAttenuation: true,
      transparent: true, opacity: 0.85, fog: false,
    }));
    this.scene.add(this.stars);
  }

  _buildRoom() {
    const g = new THREE.Group();
    this.bedroomGroup = g;
    this.scene.add(g);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2536, roughness: 0.95 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c1826, roughness: 0.9 });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, 0.1, ROOM_D), floorMat);
    floor.position.y = -0.05;
    floor.receiveShadow = true;
    g.add(floor);

    // Back / side walls (solid)
    const wallBack = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, ROOM_H, 0.15), wallMat);
    wallBack.position.set(0, ROOM_H / 2, -ROOM_D / 2 - 0.075);
    wallBack.receiveShadow = true;
    g.add(wallBack);

    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.15, ROOM_H, ROOM_D), wallMat);
      wall.position.set(sx * (ROOM_W / 2 + 0.075), ROOM_H / 2, 0);
      wall.receiveShadow = true;
      g.add(wall);
    }

    // Front wall (+Z) — built AROUND the window opening
    const fw = ROOM_W, fz = 0.15;
    const wallMatF = wallMat;
    const segW = (fw - WIN_W) / 2;
    for (const sx of [-1, 1]) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(segW, ROOM_H, fz), wallMatF);
      seg.position.set(sx * (fw / 2 - segW / 2), ROOM_H / 2, ROOM_D / 2 + fz / 2);
      seg.receiveShadow = true;
      g.add(seg);
    }
    const belowH = WIN_SILL;
    const below = new THREE.Mesh(new THREE.BoxGeometry(WIN_W, belowH, fz), wallMatF);
    below.position.set(WINDOW_X, belowH / 2, ROOM_D / 2 + fz / 2);
    g.add(below);
    const aboveH = ROOM_H - (WIN_SILL + WIN_H);
    const above = new THREE.Mesh(new THREE.BoxGeometry(WIN_W, aboveH, fz), wallMatF);
    above.position.set(WINDOW_X, WIN_SILL + WIN_H + aboveH / 2, ROOM_D / 2 + fz / 2);
    g.add(above);

    // Window frame + faint glass
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3348, roughness: 0.7 });
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(WIN_W + 0.12, WIN_H + 0.12, 0.08), frameMat);
    frame.position.set(WINDOW_X, WIN_SILL + WIN_H / 2, ROOM_D / 2 + 0.02);
    g.add(frame);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(WIN_W, WIN_H),
      new THREE.MeshBasicMaterial({ color: 0x16233d, transparent: true, opacity: 0.35 }));
    glass.position.set(WINDOW_X, WIN_SILL + WIN_H / 2, ROOM_D / 2 + 0.06);
    g.add(glass);

    // Cross bars so the window reads on camera
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, WIN_H, 0.1), frameMat);
    bar.position.set(WINDOW_X, WIN_SILL + WIN_H / 2, ROOM_D / 2 + 0.03);
    g.add(bar);
    const barH = new THREE.Mesh(new THREE.BoxGeometry(WIN_W, 0.05, 0.1), frameMat);
    barH.position.set(WINDOW_X, WIN_SILL + WIN_H / 2, ROOM_D / 2 + 0.03);
    g.add(barH);
  }

  _buildBed() {
    const g = this.bedroomGroup;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3b2b20, roughness: 0.8 });
    const mattMat = new THREE.MeshStandardMaterial({ color: 0x6a6478, roughness: 0.95 });
    const sheetMat = new THREE.MeshStandardMaterial({ color: 0x46415a, roughness: 1 });
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0x8a8496, roughness: 0.95 });

    const bedLen = BED_Z_MAX - BED_Z_MIN;

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(BED_W, FRAME_H, bedLen), woodMat);
    frame.position.set(BED_X, FRAME_H / 2, (BED_Z_MIN + BED_Z_MAX) / 2);
    frame.castShadow = true; frame.receiveShadow = true;
    g.add(frame);

    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(BED_W - 0.1, MATT_H, bedLen - 0.1), mattMat);
    mattress.position.set(BED_X, FRAME_H + MATT_H / 2, (BED_Z_MIN + BED_Z_MAX) / 2);
    mattress.castShadow = true; mattress.receiveShadow = true;
    g.add(mattress);

    const headboard = new THREE.Mesh(
      new THREE.BoxGeometry(BED_W + 0.1, 0.9, 0.12), woodMat);
    headboard.position.set(BED_X, FRAME_H + 0.45, BED_Z_MIN - 0.06);
    headboard.castShadow = true;
    g.add(headboard);

    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.14, 0.45), pillowMat);
    pillow.position.set(BED_X, MATT_TOP + 0.07, BED_Z_MIN + 0.42);
    pillow.receiveShadow = true;
    g.add(pillow);
    this.pillow = pillow;

    // Blanket over her legs — covers the mixamo T-pose below the waist
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(BED_W - 0.06, 0.16, 1.5), sheetMat);
    blanket.position.set(BED_X, MATT_TOP + 0.18, -0.15);
    blanket.castShadow = true;
    g.add(blanket);

    // Nightstand
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.55), woodMat);
    stand.position.set(1.05, 0.325, -1.9);
    stand.castShadow = true;
    g.add(stand);
  }

  _buildExterior() {
    const g = this.bedroomGroup;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(120, 40),
      new THREE.MeshStandardMaterial({ color: 0x0a0e18, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Impact crater — dark scar + glowing rim, revealed on impact
    const scar = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 24),
      new THREE.MeshStandardMaterial({ color: 0x090c13, roughness: 1 }));
    scar.rotation.x = -Math.PI / 2;
    scar.position.set(CRATER.x, 0.01, CRATER.z);
    g.add(scar);
    scar.visible = false;
    this.craterScar = scar;

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.09, 10, 40),
      new THREE.MeshStandardMaterial({
        color: 0x04222c, emissive: 0x00d9f2, emissiveIntensity: 1.4,
        metalness: 0.2, roughness: 0.5,
      }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(CRATER.x, 0.05, CRATER.z);
    g.add(rim);
    rim.visible = false;
    this.craterRim = rim;

    const light = new THREE.PointLight(0x66e0ff, 0, 14, 2);
    light.position.set(CRATER.x, 1.5, CRATER.z);
    g.add(light);
    this.craterLight = light;

    // Meteor — a white-hot stone with a fading trail
    const meteor = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xd8ecff, fog: false }));
    meteor.visible = false;
    this.scene.add(meteor);
    this.meteor = meteor;

    const glow = new THREE.PointLight(0xbfe4ff, 0, 30, 2);
    this.scene.add(glow);
    this.meteorGlow = glow;
  }

  _buildFlyer() {
    // The free-flying artifact — mirrors the chest reactor's look
    // (dark housing is dropped; in flight it is pure light).
    const g = new THREE.Group();

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x04222c, emissive: 0x00d9f2, emissiveIntensity: 2.0,
      metalness: 0.25, roughness: 0.4,
    });
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x0a2630, emissive: 0x9ff2ff, emissiveIntensity: 3.0,
    });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 12, 36), ringMat);
    g.add(ring);

    const coreSpin = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), coreMat);
    core.scale.z = 0.55;
    coreSpin.add(core);
    g.add(coreSpin);

    const light = new THREE.PointLight(0x77e6ff, 2.4, 6, 2);
    g.add(light);

    g.visible = false;
    this.scene.add(g);
    this.flyer = g;
    this.flyerRing = ring;
    this.flyerCore = core;
    this.flyerCoreSpin = coreSpin;
    this.flyerLight = light;
  }

  _buildInvasion() {
    const g = new THREE.Group();
    this.invasionGroup = g;
    g.visible = false;
    this.scene.add(g);

    // Night ground — a coastal Japanese town
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(140, 40),
      new THREE.MeshStandardMaterial({ color: 0x0b0d15, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    g.add(ground);

    // ── Mount Fuji — wide cone + snow cap, far -X background ──
    const fujiMat = new THREE.MeshStandardMaterial({
      color: 0x11141f, roughness: 1,
      emissive: 0x0c1220, emissiveIntensity: 0.5,   // silhouette separation
    });
    const fuji = new THREE.Mesh(new THREE.ConeGeometry(18, 13, 48), fujiMat);
    fuji.position.set(-16, 6.5, 38);
    g.add(fuji);
    const snowMat = new THREE.MeshStandardMaterial({
      color: 0xb9c4d8, roughness: 0.9,
      emissive: 0x33455e, emissiveIntensity: 0.55,
    });
    const snowCap = new THREE.Mesh(new THREE.ConeGeometry(5.2, 4.6, 48), snowMat);
    snowCap.position.set(-16, 11.5, 38);
    g.add(snowCap);

    // Blood moon rising behind Fuji — the iconic silhouette shot.
    // fog:false so it stays bright through the haze.
    const moonDisc = new THREE.Mesh(
      new THREE.CircleGeometry(4.4, 40),
      new THREE.MeshBasicMaterial({ color: 0xd8402e, fog: false }));
    moonDisc.position.set(-13.5, 11.8, 52);
    moonDisc.lookAt(1.2, 0.6, -3.6);   // face the invasion camera
    g.add(moonDisc);

    // ── Vermilion torii gate, centre mid-ground ──
    const toriiMat = new THREE.MeshStandardMaterial({
      color: 0xc23327, roughness: 0.6,
      emissive: 0x521008, emissiveIntensity: 0.35,
    });
    const torii = new THREE.Group();
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 3.4, 10), toriiMat);
      pillar.position.set(sx * 1.15, 1.7, 0);
      torii.add(pillar);
    }
    const beamMid = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.16, 0.2), toriiMat);
    beamMid.position.y = 2.8;
    torii.add(beamMid);
    const beamTop = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.22, 0.26), toriiMat);
    beamTop.position.y = 3.5;
    torii.add(beamTop);
    const beamCap = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.16, 0.3), toriiMat);
    beamCap.position.y = 3.72;
    torii.add(beamCap);
    torii.position.set(3, 0, 9);
    torii.rotation.y = -0.25;
    g.add(torii);

    // ── Five-storey pagoda silhouette, left mid-ground ──
    const pagodaMat = new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 1 });
    const pagoda = new THREE.Group();
    let py = 0;
    for (let i = 0; i < 5; i++) {
      const w = 2.4 - i * 0.32;
      const storey = new THREE.Mesh(new THREE.BoxGeometry(w, 0.72, w), pagodaMat);
      storey.position.y = py + 0.36;
      pagoda.add(storey);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.92, 0.5, 4), pagodaMat);
      roof.position.y = py + 0.97;
      roof.rotation.y = Math.PI / 4;
      pagoda.add(roof);
      py += 1.02;
    }
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), pagodaMat);
    spire.position.y = py + 0.45;
    pagoda.add(spire);
    pagoda.position.set(-6, 0, 15);
    g.add(pagoda);

    // ── Gabled town houses scattered through the mid-ground ──
    const houseMat = new THREE.MeshStandardMaterial({ color: 0x0a0d14, roughness: 1 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x141821, roughness: 0.9 });
    const addHouse = (x, z, w, d, h, ry) => {
      const house = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), houseMat);
      body.position.y = h / 2;
      house.add(body);
      // Triangular-prism gable: 3-sided cylinder laid along X
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.62, d * 0.62, w + 0.3, 3), roofMat);
      roof.rotation.z = Math.PI / 2;
      roof.position.y = h + d * 0.31;
      house.add(roof);
      house.position.set(x, 0, z);
      house.rotation.y = ry;
      g.add(house);
    };
    addHouse(-1.5, 12, 2.2, 1.8, 1.5, 0.2);
    addHouse(6.5, 13, 2.6, 2.0, 1.7, -0.35);
    addHouse(-10, 11, 2.0, 1.6, 1.4, 0.5);
    addHouse(10.5, 10, 2.2, 1.7, 1.5, -0.15);
    addHouse(1.5, 17, 2.8, 2.2, 1.8, 0.1);
    addHouse(-4, 20, 2.4, 1.9, 1.6, -0.3);

    // Distant fires burning
    for (const p of [[-6, 9], [5, 14]]) {
      const fire = new THREE.PointLight(0xff7733, 2.6, 16, 2);
      fire.position.set(p[0], 0.8, p[1]);
      g.add(fire);
      this._fireLights.push(fire);
    }

    // Invader ships — Spaceship.fbx is centimetre-scale, so normalise
    // by bounding box to a ~13 m wingspan, then clone per ship.
    new FBXLoader().load('./assets/models/Spaceship.fbx', (fbx) => {
      fbx.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(fbx);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const s = 13 / Math.max(size.x, size.y, size.z);

      const hullMat = new THREE.MeshStandardMaterial({
        color: 0x2b3038, roughness: 0.6, metalness: 0.35,
      });
      fbx.traverse((o) => {
        if (o.isMesh) { o.material = hullMat; o.castShadow = false; }
      });

      this.ships = SHIP_SPOTS.map((spot) => {
        const ship = fbx.clone(true);
        ship.scale.setScalar(s);
        ship.position.set(
          spot.pos[0] - center.x * s,
          spot.pos[1] - center.y * s,
          spot.pos[2] - center.z * s);
        ship.rotation.y = Math.PI + spot.phase;   // nose toward the village

        const light = new THREE.PointLight(0xff2a2a, 7, 30, 2);
        light.position.set(0, -2.5, 0);
        ship.add(light);

        const belly = new THREE.Mesh(
          new THREE.SphereGeometry(0.35, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xff4444 }));
        belly.position.set(0, -2.2, 0);
        ship.add(belly);

        g.add(ship);
        return { group: ship, baseY: spot.pos[1], phase: spot.phase };
      });
    }, undefined, (e) => console.warn('PreludeScene: Spaceship.fbx load failed:', e));
  }

  // Breathing idle so she never T-poses: slow and shallow while
  // asleep, ramping to normal speed as she rises. Same Mixamo
  // idle.fbx main.js uses; Hips X/Z pinned like stripRootMotion so
  // she can't drift off the bed.
  _loadIdleAnim(fbx) {
    new FBXLoader().load('./assets/models/player/idle.fbx', (animFbx) => {
      if (!animFbx.animations || !animFbx.animations.length) return;
      const clip = animFbx.animations[0].clone();
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
      this._mixer = new THREE.AnimationMixer(fbx);
      this._idleAction = this._mixer.clipAction(clip);
      this._idleAction.play();
      this._applyIdleRate();
    }, undefined, (e) => console.warn('PreludeScene: idle.fbx load failed:', e));
  }

  _applyIdleRate() {
    if (!this._idleAction) return;
    const k = this._riseK || 0;
    this._idleAction.timeScale = 0.35 + k * 0.7;   // 0.35 asleep -> 1.05 risen
  }

  _loadSorini() {
    new FBXLoader().load('./assets/models/player/sorini.fbx', (fbx) => {
      fbx.scale.setScalar(0.013);
      fbx.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        // Same Mixamo alphaMap quirk fix as main.js — without it her
        // boots vanish (specular PNG wired as an alphaMap).
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
      this.scene.add(fbx);
      this.sorini = fbx;
      this._loadIdleAnim(fbx);

      // The real chest reactor, riding Spine2 — hidden until the
      // flyer docks inside her.
      this.chestArtifact = attachChestArtifact(fbx);
      if (this.chestArtifact) {
        this.chestArtifact.group.visible = false;
      } else {
        console.warn('PreludeScene: chest bone not found — artifact skipped');
      }

      this.setRise(0);
      this._soriniReady = true;
      if (this._resolveReady) this._resolveReady();
    }, undefined, (e) => {
      console.warn('PreludeScene: sorini.fbx load failed:', e);
      if (this._resolveReady) this._resolveReady();   // fail soft — show the world anyway
    });
  }

  // ======================================================
  // DIRECTOR API
  // ======================================================
  // p: 0 = lying asleep, 1 = standing possessed. Smoothstep blend
  // between the two poses of the SAME model (no crossfade tricks).
  setRise(p) {
    if (!this.sorini) return;
    const k = smooth(p);
    this.sorini.rotation.x = -Math.PI / 2 * (1 - k);
    this.sorini.rotation.y = 0;
    this.sorini.position.lerpVectors(LIE_POS, STAND_POS, k);
    this._riseK = k;
    this._applyIdleRate();
  }

  // Extra float while possessed (0..1) — up to ~30 cm off the floor
  setLevitate(v) {
    if (!this.sorini) return;
    this._levitate = v;
  }

  // Scales the chest reactor glow (1 = baseline, 3+ = blazing takeover)
  setArtifactIntensity(v) {
    if (!this.chestArtifact) return;
    const a = this.chestArtifact;
    a.ring.material.emissiveIntensity = 1.8 * v;
    a.core.material.emissiveIntensity = 3.0 * v;
    a.light.intensity = 2.2 * v;
  }

  // Piecewise flight path: crater → outside the window → inside →
  // hover above her chest. t in [0,1].
  flightPoint(t, out) {
    const p0 = new THREE.Vector3(CRATER.x, 0.5, CRATER.z);
    const p1 = new THREE.Vector3(WINDOW_X, 1.75, ROOM_D / 2 + 0.9);
    const p2 = new THREE.Vector3(WINDOW_X, 1.6, ROOM_D / 2 - 0.5);
    const p3 = new THREE.Vector3(BED_X, 1.1, -1.15);
    if (t < 0.42)      out.lerpVectors(p0, p1, smooth(t / 0.42));
    else if (t < 0.62) out.lerpVectors(p1, p2, smooth((t - 0.42) / 0.2));
    else               out.lerpVectors(p2, p3, smooth((t - 0.62) / 0.38));
    return out;
  }

  // Where the flyer sinks to at the dock moment — the REAL chest
  // bone position, so entry and reactor land on the same spot.
  chestWorldPos(out) {
    if (this.chestArtifact) {
      return this.chestArtifact.bone.getWorldPosition(out);
    }
    return out.set(BED_X, 1.0, -1.1);
  }

  launchMeteor() {
    this.meteor.visible = true;
    this.meteor.position.copy(METEOR_FROM);
    this._meteorVel.copy(CRATER).sub(METEOR_FROM).normalize().multiplyScalar(34);
    this._meteorT = 0;
    this.meteorGlow.intensity = 4;
    this.meteorGlow.position.copy(METEOR_FROM);
  }

  impact() {
    this.meteor.visible = false;
    this.meteorGlow.intensity = 0;
    this._meteorT = -1;
    this.craterScar.visible = true;
    this.craterRim.visible = true;
    this.craterLight.intensity = 5;
    // Burst of fading embers — same idiom as main.js dash trail
    for (let i = 0; i < 14; i++) {
      const ember = new THREE.Mesh(
        new THREE.SphereGeometry(0.12 + Math.random() * 0.14, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9 }));
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      ember.position.set(CRATER.x, 0.4, CRATER.z);
      this.scene.add(ember);
      this._trail.push({
        mesh: ember, life: 0.9,
        vel: new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp),
      });
    }
  }

  showFlyer(v) { this.flyer.visible = v; }
  dockArtifact() {
    this.flyer.visible = false;
    if (this.chestArtifact) this.chestArtifact.group.visible = true;
  }

  setMode(mode) {
    const invasion = (mode === 'invasion');
    this.bedroomGroup.visible = !invasion;
    this.invasionGroup.visible = invasion;
    this.scene.fog.density = invasion ? 0.016 : 0.045;
    this.lampLight.intensity = invasion ? 0 : 1.1;
    this.moonLight.intensity = invasion ? 0.55 : 1.15;
    this.hemi.intensity = invasion ? 0.55 : 0.5;
    // Crater props live in the bedroom group — hide their lights too
    this.craterLight.intensity = invasion ? 0 : (this.craterScar.visible ? 5 : 0);
  }

  // ======================================================
  // PER-FRAME UPDATE
  // ======================================================
  update(dt, t) {
    this._time = t;

    if (this._mixer) this._mixer.update(dt);

    // Meteor flight + trail
    if (this._meteorT >= 0) {
      this.meteor.position.addScaledVector(this._meteorVel, dt);
      this.meteorGlow.position.copy(this.meteor.position);
      if (this._trail.length < 40 && Math.random() < 0.9) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(0.1 + Math.random() * 0.12, 6, 5),
          new THREE.MeshBasicMaterial({ color: 0x86c8ff, transparent: true, opacity: 0.7 }));
        puff.position.copy(this.meteor.position);
        this.scene.add(puff);
        this._trail.push({ mesh: puff, life: 0.7, vel: new THREE.Vector3() });
      }
      // Reached the crater?
      if (this.meteor.position.distanceTo(CRATER) < 1.2) this.impact();
    }

    // Fading embers / puffs
    for (let i = this._trail.length - 1; i >= 0; i--) {
      const p = this._trail[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.material.opacity = Math.max(0, p.life) * 0.9;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this._trail.splice(i, 1);
      }
    }

    // Crater glow pulse
    if (this.craterScar.visible) {
      const p = 0.6 + Math.sin(t * 2.2) * 0.4;
      this.craterRim.material.emissiveIntensity = 1.0 + p * 0.8;
      this.craterLight.intensity = 3.5 + p * 2.0;
    }

    // Flyer pulse — the living-light look from the menu scene
    if (this.flyer.visible) {
      const p = 0.6 + Math.sin(t * 2.4) * 0.4;
      this.flyerRing.material.emissiveIntensity = 1.8 + p * 1.2;
      this.flyerCore.material.emissiveIntensity = 3.0 + p * 1.3;
      this.flyerLight.intensity = 2.0 + p * 2.0;
      this.flyerCoreSpin.rotation.z += 0.03;
      this.flyerCoreSpin.rotation.y += 0.015;
    }

    // Chest reactor idle pulse once docked (baseline while dormant)
    if (this.chestArtifact && this.chestArtifact.group.visible) {
      this.chestArtifact.coreSpin.rotation.z += 0.02;
    }

    // Ships hover + drift
    if (this.ships) {
      for (const s of this.ships) {
        s.group.position.y = s.baseY + Math.sin(t * 0.5 + s.phase) * 0.5;
        s.group.rotation.y += dt * 0.04;
      }
    }

    // Fire flicker
    for (const f of this._fireLights) {
      f.intensity = 2.2 + Math.sin(t * 11 + f.position.x) * 0.7 + Math.random() * 0.3;
    }

    // Levitation offset (possession hold)
    if (this.sorini && this._riseK >= 1 && this._levitate) {
      this.sorini.position.y = STAND_POS.y + 0.3 * this._levitate;
    }

    // Stars wheel very slowly
    if (this.stars) this.stars.rotation.y = t * 0.004;
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.scene.clear();
  }
}
