// src/utils/stats.js
// Run statistics — feeds the level-clear debrief and the campaign
// summary at the end of Level 3.
//
// gameStats covers the level currently being played and is cleared by
// resetStats() on every level rebuild. runStats accumulates across the
// whole run and is only cleared at the main menu, so the final summary
// still has every level in it after three resetStats() calls.

const FRESH = () => ({
  kos: 0,
  deaths: 0,
  damageDealt: 0,
  damageTaken: 0,
  hitsTaken: 0,
  hitsAbsorbed: 0,          // enemy hits swallowed by i-frames or the merge
  attacks: { punch: 0, kick: 0, hook: 0 },
  attacksLanded: 0,
  dashes: 0,
  trueFormSeconds: 0,
  playSeconds: 0,           // unpaused play time — the clock behind TIME
});

export const gameStats = FRESH();
export const runStats = FRESH();

// Every counter lands in both the level and the run totals — that is what
// keeps the campaign summary free of separate bookkeeping.
function bump(key, amount) {
  gameStats[key] += amount;
  runStats[key] += amount;
}

export function recordKO() { bump('kos', 1); }
export function recordDeath() { bump('deaths', 1); }
export function recordDamageDealt(amount) { bump('damageDealt', amount); }
export function recordDamageTaken(amount) { bump('damageTaken', amount); }
export function recordHitTaken() { bump('hitsTaken', 1); }
export function recordHitAbsorbed() { bump('hitsAbsorbed', 1); }
export function recordAttackLanded() { bump('attacksLanded', 1); }
export function recordDash() { bump('dashes', 1); }
export function recordTrueFormTime(dt) { bump('trueFormSeconds', dt); }
export function recordPlayTime(dt) { bump('playSeconds', dt); }

export function recordAttack(type) {
  if (gameStats.attacks[type] === undefined) return;
  gameStats.attacks[type]++;
  runStats.attacks[type]++;
}

export function attacksThrown(s = gameStats) {
  return s.attacks.punch + s.attacks.kick + s.attacks.hook;
}

export function attackAccuracy(s = gameStats) {
  const thrown = attacksThrown(s);
  return thrown ? s.attacksLanded / thrown : 0;
}

export function resetStats() { Object.assign(gameStats, FRESH()); }
export function resetRunStats() { Object.assign(runStats, FRESH()); }

// ── Rank ──────────────────────────────────────────────────────
// Composite grade: a clean, accurate, fast run scores highest. Deaths
// and damage taken are the big penalties; accuracy and time nudge the
// score either way. Pars are deliberately generous so only a slow run
// loses points on the clock.
const LEVEL_PAR_SECONDS = { 1: 300, 2: 360, 3: 480 };
export const CAMPAIGN_PAR_SECONDS = 1140;

export function parForLevel(n) {
  return LEVEL_PAR_SECONDS[n] || 360;
}

const TITLES = {
  S: 'FLAWLESS',
  A: 'STABLE',
  B: 'STRAINED',
  C: 'FRACTURED SYNCHRONIZATION',
};

export function computeRank({ deaths, damageTaken, accuracy, timeSec, parSec }) {
  let score = 100;
  score -= deaths * 20;
  score -= damageTaken * 0.4;
  score += Math.max(-15, Math.min(15, (accuracy - 0.5) * 30));
  score += Math.max(-10, Math.min(10, ((parSec - timeSec) / parSec) * 20));

  score = Math.round(Math.max(0, Math.min(100, score)));
  const grade = score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 55 ? 'B' : 'C';
  return { score, grade, title: TITLES[grade] };
}
