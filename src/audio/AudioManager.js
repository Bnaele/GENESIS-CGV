// src/audio/AudioManager.js
// Central audio controller — handles music and SFX via Howler.js

import { Howl } from 'howler';
import * as THREE from 'three';

export class AudioManager {
  constructor() {
    this.sounds = {};
    this.currentMusic = null;
    this.currentMusicKey = null;
    this.musicVolume = 0.6;
    this.sfxVolume = 0.8;
    this.isMuted = false;
    // Positional audio — main.js registers the listener (player + camera)
    this._getListenerPos = null;
    this._listenerCamera = null;
    this._v = new THREE.Vector3();
  }

  loadSound(key, config) {
    if (this.sounds[key]) return;
    const sound = new Howl({
      src: [config.src],
      loop: config.loop || false,
      volume: config.volume || 1.0,
      preload: true,
      onloaderror: (id, err) => console.warn(`Audio "${key}" failed:`, err),
    });
    this.sounds[key] = sound;
  }

  // ── SFX ──
  playSfx(key) {
    if (this.isMuted) return;
    const s = this.sounds[key];
    if (!s) { console.warn(`SFX "${key}" not loaded`); return; }
    s.stop();
    const id = s.play();
    s.volume(this.sfxVolume, id);
    return id;
  }

  stopSound(key) {
    const s = this.sounds[key];
    if (s) s.stop();
  }

  // ── Positional SFX ──
  // Volume falls off linearly with distance from the listener; stereo pan
  // follows the source's bearing relative to the camera (Howler stereo()).
  setListener(getPos, camera) {
    this._getListenerPos = getPos;
    this._listenerCamera = camera;
  }

  playSfxAt(key, srcPos) {
    if (this.isMuted) return null;
    const s = this.sounds[key];
    if (!s) { console.warn(`SFX "${key}" not loaded`); return null; }

    let lp = null, cam = null;
    try {
      lp = this._getListenerPos && this._getListenerPos();
      cam = this._listenerCamera;
    } catch (e) { /* listener not ready yet — play flat */ }
    if (!srcPos || !lp || !cam) return this.playSfx(key);

    const dx = srcPos.x - lp.x, dy = srcPos.y - lp.y, dz = srcPos.z - lp.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const MAX_DIST = 45;
    const vol = this.sfxVolume * Math.max(0, 1 - dist / MAX_DIST);
    if (vol <= 0.01) return null;   // too far away to hear

    // Camera space: +x right, -z forward. sin(bearing) pans full L/R.
    let pan = 0;
    try {
      this._v.set(dx, dy, dz).applyMatrix4(cam.matrixWorldInverse);
      pan = Math.sin(Math.atan2(this._v.x, -this._v.z)) * 0.8;
    } catch (e) { /* mono fallback */ }

    s.stop();
    const id = s.play();
    s.volume(Math.min(1, vol), id);
    s.stereo(Math.max(-1, Math.min(1, pan)), id);
    return id;
  }

  // ── Music ──
  playMusic(key) {
    if (this.isMuted) return;
    const s = this.sounds[key];
    if (!s) { console.warn(`Music "${key}" not loaded`); return; }
    if (this.currentMusic) this.currentMusic.stop();
    s.loop(true);
    s.volume(this.musicVolume);
    s.play();
    this.currentMusic = s;
    this.currentMusicKey = key;
  }

  stopMusic() {
    if (this.currentMusic) {
      this.currentMusic.stop();
      this.currentMusic = null;
      this.currentMusicKey = null;
    }
  }

  pauseMusic() {
    if (this.currentMusic) {
      this.currentMusic.pause(this.currentMusicId);
    }
  }

  resumeMusic() {
    if (this.currentMusic) {
      this.currentMusic.play(this.currentMusicId);
    }
  }

  setMusicVolume(v) {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.currentMusic) this.currentMusic.volume(this.musicVolume);
  }

  setSfxVolume(v) {
    this.sfxVolume = Math.max(0, Math.min(1, v));
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stopMusic();
    } else if (this.currentMusicKey) {
      // Unmuting must bring the level music back, not just clear the flag
      this.playMusic(this.currentMusicKey);
    }
    return this.isMuted;
  }

  reset() {
    this.stopMusic();
    Object.values(this.sounds).forEach(s => s.stop());
  }
}
