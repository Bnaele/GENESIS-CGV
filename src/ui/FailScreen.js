// src/ui/FailScreen.js
// MISSION FAILED overlay — shown the moment Sorini dies. Offers a retry
// from the last checkpoint, a full level restart, or quitting to menu.
// The Axiom quote rotates with the session death count so repeated
// failures read as him reacting, not as a canned loop.

const QUOTES = [
  'Get up. I did not cross the void to end in a ditch.',
  'Again. Their blades are slower than you think.',
  'Your heart stopped. Mine did not. Rise.',
  'Pain is information, Sorini. Keep what it taught you.',
  'I have rebuilt you. Do not make me regret the expense.',
  'Even he fell, once, before he learned to stand. Again.',
];

let _el = null;

export function isFailScreenVisible() {
  return !!_el;
}

export function hideFailScreen() {
  if (_el) {
    _el.remove();
    _el = null;
  }
}

export function showFailScreen({ checkpointLabel, deaths, onRetry, onRestart, onQuit }) {
  hideFailScreen();

  const quote = QUOTES[Math.min(deaths, QUOTES.length - 1) % QUOTES.length];

  const el = document.createElement('div');
  el.id = 'fail-screen';
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:320',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(20,0,6,0.82)', 'backdrop-filter:blur(3px)',
    'font-family:\'Courier New\', monospace',
    'animation:failIn 0.5s ease-out',
  ].join(';');

  const btn = (id, text, primary) => `
    <button id="${id}" style="
      display:block; width:340px; margin:10px auto; padding:13px 0;
      background:${primary ? 'rgba(0,255,255,0.14)' : 'transparent'};
      border:1px solid ${primary ? '#00ffff' : 'rgba(0,255,255,0.4)'};
      border-radius:8px; color:#d9f6ff; cursor:pointer;
      font-family:'Courier New', monospace; font-size:14px; letter-spacing:3px;
    ">${text}</button>`;

  el.innerHTML = `
    <style>
      @keyframes failIn { from { opacity:0; } to { opacity:1; } }
      #fail-screen button:hover { background:rgba(0,255,255,0.28); color:#ffffff; }
    </style>
    <div style="text-align:center;max-width:640px;padding:24px;">
      <div style="font-size:12px;letter-spacing:6px;color:#ff5566;opacity:.85;">SYNCHRONIZATION LOST</div>
      <h1 style="margin:14px 0 4px;font-size:42px;letter-spacing:6px;color:#ff3355;
                 text-shadow:0 0 26px rgba(255,51,85,.6);">MISSION FAILED</h1>
      <div style="width:180px;height:1px;margin:14px auto 18px;
                  background:linear-gradient(90deg,transparent,rgba(255,51,85,.8),transparent);"></div>
      <p style="margin:0 0 8px;font-style:italic;line-height:1.6;font-size:15px;color:#9ff2ff;">
        “${quote}”
      </p>
      <p style="margin:0 0 22px;font-size:12px;letter-spacing:2px;color:#7fa8b8;">— AXIOM</p>
      ${btn('fail-retry', `RETRY FROM CHECKPOINT — ${checkpointLabel}`, true)}
      ${btn('fail-restart', 'RESTART LEVEL', false)}
      ${btn('fail-quit', 'QUIT TO MENU', false)}
    </div>`;

  document.body.appendChild(el);
  _el = el;

  el.querySelector('#fail-retry').addEventListener('click', () => { hideFailScreen(); onRetry(); });
  el.querySelector('#fail-restart').addEventListener('click', () => { hideFailScreen(); onRestart(); });
  el.querySelector('#fail-quit').addEventListener('click', () => { hideFailScreen(); onQuit(); });
}
