// src/ui/DamageFlash.js
// Directional damage vignette — the screen bleeds red from the side
// the hit came from. Falls back to an even edge vignette when the
// source position is unknown (e.g. hazard tiles) or behind the camera.

import * as THREE from 'three';

let _el = null;
const _v = new THREE.Vector3();

export function createDamageFlash() {
  if (_el) return;
  _el = document.createElement('div');
  Object.assign(_el.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '60',
    opacity: '0',
  });
  document.body.appendChild(_el);
}

export function flashDamageFrom(srcPos, playerPos, camera) {
  if (!_el) return;

  let bg = 'radial-gradient(ellipse at center, transparent 52%, rgba(255,20,20,0.5) 100%)';
  if (srcPos && playerPos && camera) {
    // World offset -> camera space (-z forward, +x right, +y up)
    _v.copy(srcPos).sub(playerPos).applyMatrix4(camera.matrixWorldInverse);
    if (_v.z < 0) {
      // Attacker in front — bleed in from their screen direction.
      // CSS gradient angle: 0deg = top, 90deg = right, clockwise.
      const deg = 90 - Math.atan2(_v.y, _v.x) * 180 / Math.PI;
      bg = `linear-gradient(${deg}deg, rgba(255,30,30,0.55) 0%, rgba(255,0,0,0.18) 32%, transparent 60%)`;
    }
    // Behind the camera -> keep the even edge vignette
  }

  _el.style.transition = 'none';
  _el.style.background = bg;
  _el.style.opacity = '0.9';
  // Reflow so back-to-back hits restart the fade instead of skipping it
  void _el.offsetWidth;
  _el.style.transition = 'opacity 0.55s ease-out';
  _el.style.opacity = '0';
}
