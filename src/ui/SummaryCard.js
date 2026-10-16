// src/ui/SummaryCard.js
// Level-complete summary — time, KOs, health remaining. Non-blocking
// (pointer-events none), bottom-center, auto-hides after a few seconds.

let _el = null;
let _hideTimer = null;

function _ensure() {
  if (_el) return _el;
  _el = document.createElement('div');
  Object.assign(_el.style, {
    position: 'fixed',
    bottom: '48px',
    left: '50%',
    transform: 'translateX(-50%) translateY(20px)',
    background: 'rgba(2, 10, 20, 0.92)',
    border: '2px solid #00ffff',
    borderRadius: '12px',
    boxShadow: '0 0 40px rgba(0, 255, 255, 0.2)',
    padding: '18px 34px',
    textAlign: 'center',
    color: '#d8f4ff',
    fontFamily: "'Courier New', monospace",
    zIndex: '80',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.45s ease, transform 0.45s ease',
  });
  document.body.appendChild(_el);
  return _el;
}

export function showSummaryCard({ title, timeSec, kos, health, maxHealth }) {
  const el = _ensure();
  const mm = Math.floor(timeSec / 60);
  const ss = Math.floor(timeSec % 60).toString().padStart(2, '0');
  const hpPct = Math.max(0, Math.round((health / maxHealth) * 100));
  const hpColor = hpPct > 50 ? '#00ff88' : hpPct > 25 ? '#ffcc00' : '#ff5555';

  el.innerHTML = `
    <div style="font-size:0.72rem;letter-spacing:5px;color:#88dddd;margin-bottom:6px;">LEVEL COMPLETE</div>
    <div style="font-size:1.25rem;letter-spacing:3px;color:#00ffff;text-shadow:0 0 18px rgba(0,255,255,0.4);margin-bottom:12px;">${title}</div>
    <div style="display:flex;gap:26px;justify-content:center;font-size:0.85rem;letter-spacing:1px;">
      <span>TIME ${mm}:${ss}</span>
      <span>KOs ${kos}</span>
      <span style="color:${hpColor};">HP ${hpPct}%</span>
    </div>`;

  clearTimeout(_hideTimer);
  el.style.opacity = '0';
  void el.offsetWidth;   // reflow so a retrigger restarts the fade
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  _hideTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(20px)';
  }, 6500);
}

// Fade the card out — delayMs lets it linger across a level transition
// so the player can read the summary while the next level loads.
export function hideSummaryCard(delayMs = 0) {
  if (!_el) return;
  clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => {
    _el.style.opacity = '0';
    _el.style.transform = 'translateX(-50%) translateY(20px)';
  }, delayMs);
}
