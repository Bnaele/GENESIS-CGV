// src/utils/stats.js
// Session kill counter — feeds the level-complete summary card.

export const gameStats = { kos: 0, deaths: 0 };

export function recordKO() {
  gameStats.kos++;
}

export function recordDeath() {
  gameStats.deaths++;
}

export function resetStats() {
  gameStats.kos = 0;
  gameStats.deaths = 0;
}
