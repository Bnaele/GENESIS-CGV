// src/ui/DebriefScreen.js
// LEVEL CLEAR debrief — the blocking reward screen between levels, and
// the campaign summary that closes out the Level 3 endings.
//
// Mirrors FailScreen: the world freezes (main.js gates tick() on
// isDebriefVisible), the pointer unlocks, and the player decides when
// to move on. Numbers count up rather than appearing at once so the
// screen reads as a result being tallied, not a table dumped on screen.

import { attackAccuracy, attacksThrown } from '../utils/stats.js';

let _el = null;
let _onContinue = null;
let _keyHandler = null;
let _rafId = 0;

export function isDebriefVisible() {
  return !!_el;
}

export function hideDebrief() {
  cancelAnimationFrame(_rafId);
  if (_keyHandler) {
    window.removeEventListener('keydown', _keyHandler);
    _keyHandler = null;
  }
  if (_el) {
    _el.remove();
    _el = null;
  }
  _onContinue = null;
}

// ── number formatting ─────────────────────────────────────────
const fmtInt = (v) => Math.round(v).toString();
const fmtPct = (v) => `${Math.round(v * 100)}%`;
const fmtSec1 = (v) => `${v.toFixed(1)}s`;
const fmtClock = (v) => {
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

function buildRows({ stats, rank, timeSec, health, maxHealth }) {
  const acc = attackAccuracy(stats);
  return {
    left: [
      { label: 'DAMAGE DEALT', value: stats.damageDealt, fmt: fmtInt },
      { label: 'DAMAGE TAKEN', value: stats.damageTaken, fmt: fmtInt },
      { label: 'HITS TAKEN', value: stats.hitsTaken, fmt: fmtInt },
      { label: 'HITS ABSORBED', value: stats.hitsAbsorbed, fmt: fmtInt },
      { label: 'KOs', value: stats.kos, fmt: fmtInt },
      { label: 'DEATHS', value: stats.deaths, fmt: fmtInt },
    ],
    right: [
      { label: 'PUNCHES', value: stats.attacks.punch, fmt: fmtInt },
      { label: 'KICKS', value: stats.attacks.kick, fmt: fmtInt },
      { label: 'HOOKS', value: stats.attacks.hook, fmt: fmtInt },
      { label: 'ACCURACY', value: acc, fmt: fmtPct, sub: `${stats.attacksLanded}/${attacksThrown(stats)} LANDED` },
      { label: 'AXIOM DASHES', value: stats.dashes, fmt: fmtInt },
      { label: 'TIME MERGED', value: stats.trueFormSeconds, fmt: fmtSec1 },
    ],
    foot: [
      { label: 'TIME', value: timeSec, fmt: fmtClock },
      { label: 'HP REMAINING', value: maxHealth ? health / maxHealth : 0, fmt: fmtPct },
    ],
    rank,
  };
}

// Rows are rendered with their final text hidden behind a count-up: each
// cell animates 0 → value over COUNT_MS with an ease-out, staggered by
// column so the eye follows the tally.
const COUNT_MS = 950;

function columnHTML(rows) {
  return rows.map((r, i) => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;
                gap:18px;padding:5px 0;border-bottom:1px solid rgba(0,255,255,0.09);
                opacity:0;animation:rowIn 0.4s ease forwards;animation-delay:${i * 60}ms;">
      <span style="font-size:11px;letter-spacing:2px;color:#7fb9c9;white-space:nowrap;">${r.label}</span>
      <span style="text-align:right;">
        <span class="stat-value" data-final="${r.value}" style="font-size:15px;letter-spacing:1px;color:#d9f6ff;">0</span>
        ${r.sub ? `<span style="display:block;font-size:9px;letter-spacing:1px;color:#5d8a99;">${r.sub}</span>` : ''}
      </span>
    </div>`).join('');
}

function startCountUp(root) {
  const cells = Array.from(root.querySelectorAll('.stat-value'));
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / COUNT_MS);
    const eased = 1 - Math.pow(1 - p, 3);
    for (const c of cells) {
      const final = parseFloat(c.dataset.final || '0');
      c.textContent = formatFor(c, final * eased);
    }
    if (p < 1) _rafId = requestAnimationFrame(tick);
  };
  _rafId = requestAnimationFrame(tick);
}

// The formatter is carried on the cell so the count-up can render each
// value in its own unit without a parallel array of closures.
function formatFor(cell, value) {
  const kind = cell.dataset.kind;
  if (kind === 'pct') return fmtPct(value);
  if (kind === 'sec') return fmtSec1(value);
  if (kind === 'clock') return fmtClock(value);
  return fmtInt(value);
}

function annotate(root, rows) {
  const cells = root.querySelectorAll('.stat-value');
  let i = 0;
  for (const group of [rows.left, rows.right, rows.foot]) {
    for (const r of group) {
      const cell = cells[i++];
      if (!cell) continue;
      cell.dataset.kind = r.fmt === fmtPct ? 'pct' : r.fmt === fmtSec1 ? 'sec' : r.fmt === fmtClock ? 'clock' : 'int';
      cell.textContent = r.fmt(0);
    }
  }
}

function rankBadgeHTML(rank, theme) {
  if (theme === 'ending') {
    return `
      <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin:6px 0 20px;">
        <span style="font-size:44px;line-height:1;color:#8fd0ff;text-shadow:0 0 24px rgba(143,208,255,.5);">${rank.grade}</span>
        <span style="font-size:13px;letter-spacing:4px;color:#c8e8ff;">${rank.title}</span>
      </div>`;
  }
  const color = rank.grade === 'S' ? '#ffd76a' : rank.grade === 'A' ? '#00ff9d' : rank.grade === 'B' ? '#00e5ff' : '#ff7a8a';
  return `
    <div style="display:flex;align-items:center;justify-content:center;gap:18px;margin:4px 0 20px;">
      <div style="width:74px;height:74px;display:flex;align-items:center;justify-content:center;
                  border:2px solid ${color};border-radius:10px;
                  background:rgba(0,255,255,0.06);box-shadow:0 0 30px ${color}44;">
        <span style="font-size:40px;line-height:1;color:${color};text-shadow:0 0 20px ${color}99;">${rank.grade}</span>
      </div>
      <div style="text-align:left;">
        <div style="font-size:15px;letter-spacing:4px;color:${color};">${rank.title}</div>
        <div style="font-size:11px;letter-spacing:2px;color:#6fa5b5;margin-top:6px;">SCORE ${rank.score}/100</div>
      </div>
    </div>`;
}

// ── per-level debrief ─────────────────────────────────────────
export function showLevelClear({ levelName, stats, rank, timeSec, health, maxHealth, nextLabel, onContinue }) {
  hideDebrief();

  const rows = buildRows({ stats, rank, timeSec, health, maxHealth });

  const el = document.createElement('div');
  el.id = 'debrief-screen';
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:340',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(0,10,18,0.86)', 'backdrop-filter:blur(4px)',
    'font-family:\'Courier New\', monospace',
    'animation:debriefIn 0.5s ease-out',
  ].join(';');

  el.innerHTML = `
    <style>
      @keyframes debriefIn { from { opacity:0; } to { opacity:1; } }
      @keyframes rowIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
      #debrief-screen button:hover { background:rgba(0,255,255,0.28); color:#ffffff; }
    </style>
    <div style="text-align:center;width:min(680px,92vw);padding:26px 30px;
                border:1px solid rgba(0,255,255,0.35);border-radius:14px;
                background:rgba(2,14,24,0.92);box-shadow:0 0 60px rgba(0,255,255,0.14);">
      <div style="font-size:11px;letter-spacing:7px;color:#00ff9d;opacity:.9;">LEVEL CLEAR</div>
      <h1 style="margin:12px 0 2px;font-size:30px;letter-spacing:5px;color:#00ffff;
                 text-shadow:0 0 26px rgba(0,255,255,.45);">${levelName}</h1>
      <div style="width:200px;height:1px;margin:16px auto 18px;
                  background:linear-gradient(90deg,transparent,rgba(0,255,255,.7),transparent);"></div>

      ${rankBadgeHTML(rank, 'debrief')}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 34px;text-align:left;">
        <div>${columnHTML(rows.left)}</div>
        <div>${columnHTML(rows.right)}</div>
      </div>

      <div style="display:flex;justify-content:center;gap:40px;margin-top:16px;padding-top:14px;
                  border-top:1px solid rgba(0,255,255,0.15);">
        ${rows.foot.map((r, i) => `
          <div style="text-align:center;opacity:0;animation:rowIn 0.4s ease forwards;animation-delay:${(i + 6) * 60}ms;">
            <div style="font-size:10px;letter-spacing:3px;color:#7fb9c9;">${r.label}</div>
            <div class="stat-value" data-final="${r.value}" style="font-size:19px;letter-spacing:2px;color:#d9f6ff;margin-top:4px;">0</div>
          </div>`).join('')}
      </div>

      <button id="debrief-continue" style="
        display:block;width:360px;margin:24px auto 0;padding:14px 0;
        background:rgba(0,255,255,0.14);border:1px solid #00ffff;border-radius:8px;
        color:#d9f6ff;cursor:pointer;font-family:'Courier New', monospace;
        font-size:14px;letter-spacing:3px;">${nextLabel}</button>
      <div style="margin-top:10px;font-size:10px;letter-spacing:2px;color:#5d8a99;">SPACE OR ENTER</div>
    </div>`;

  document.body.appendChild(el);
  _el = el;

  annotate(el, rows);
  startCountUp(el);

  _onContinue = () => {
    if (!_el) return;
    hideDebrief();
    if (onContinue) onContinue();
  };

  el.querySelector('#debrief-continue').addEventListener('click', _onContinue);

  _keyHandler = (e) => {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      _onContinue();
    }
  };
  window.addEventListener('keydown', _keyHandler);
}

// ── campaign summary ──────────────────────────────────────────
// Returns a node for endings.js to drop into #endOverlay above the
// RESTART button. Styled to match the ending's serif epilogue rather
// than the in-game HUD, so it reads as the closing card of the story.
export function buildCampaignSummary({ stats, rank, timeSec, levelsCleared }) {
  const acc = attackAccuracy(stats);
  const rows = [
    ['LEVELS CLEARED', `${levelsCleared}`],
    ['TOTAL TIME', fmtClock(timeSec)],
    ['KOs', fmtInt(stats.kos)],
    ['DAMAGE DEALT', fmtInt(stats.damageDealt)],
    ['DAMAGE TAKEN', fmtInt(stats.damageTaken)],
    ['ACCURACY', `${fmtPct(acc)}  (${stats.attacksLanded}/${attacksThrown(stats)})`],
    ['AXIOM MERGE', fmtSec1(stats.trueFormSeconds)],
    ['DEATHS', fmtInt(stats.deaths)],
  ];

  const wrap = document.createElement('div');
  wrap.style.cssText = 'max-width:520px;margin:0 auto 8px;text-align:center;opacity:0;transition:opacity 1.2s;';
  wrap.innerHTML = `
    <div style="font-size:11px;letter-spacing:6px;color:#8fd0ff;opacity:.8;">CAMPAIGN COMPLETE</div>
    <div style="width:120px;height:1px;margin:14px auto;
                background:linear-gradient(90deg,transparent,rgba(143,208,255,.7),transparent);"></div>
    ${rankBadgeHTML(rank, 'ending')}
    <div style="text-align:left;font-family:'Courier New', monospace;">
      ${rows.map(([label, value]) => `
        <div style="display:flex;justify-content:space-between;gap:20px;padding:5px 0;
                    border-bottom:1px solid rgba(143,208,255,0.12);">
          <span style="font-size:11px;letter-spacing:2px;color:#7fa8c8;">${label}</span>
          <span style="font-size:13px;letter-spacing:1px;color:#dff0ff;">${value}</span>
        </div>`).join('')}
    </div>`;

  requestAnimationFrame(() => { wrap.style.opacity = '1'; });
  return wrap;
}
