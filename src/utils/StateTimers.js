// ============================================================
// StateTimers — a delta-timed callback queue for boss AI
// ============================================================
// setTimeout keeps running on wall-clock time, so a boss whose attack,
// charge or flinch resolves on a timer finishes that state while the
// pause menu has the world frozen — the player can pause through any
// combo and resume with the boss already reset. It also fires after
// level teardown. Ticking from update() makes the state machine stop
// with the world and clear with the boss.

export class StateTimers {
  constructor() {
    this._queued = [];
  }

  // Seconds (game time) from now, not wall clock.
  after(seconds, fn) {
    this._queued.push({ left: seconds, fn });
  }

  tick(delta) {
    if (this._queued.length === 0) return;

    const due = [];
    const waiting = [];
    for (const timer of this._queued) {
      timer.left -= delta;
      (timer.left <= 0 ? due : waiting).push(timer);
    }
    // Swapped before firing so a callback can schedule the next step.
    this._queued = waiting;
    due.forEach((timer) => timer.fn());
  }

  clear() {
    this._queued.length = 0;
  }
}
