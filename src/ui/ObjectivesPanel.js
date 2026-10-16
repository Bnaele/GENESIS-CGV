// src/ui/ObjectivesPanel.js
// OBJECTIVES PANEL — the level's goals, always visible, always honest.
// Each level exposes getObjectives() returning:
//   [{ text, note?, done, active }]
// updateObjectives() re-renders only when the state actually changes and
// flashes a banner the moment an objective is completed.

let _container = null;
let _list = null;
let _toast = null;
let _lastKey = null;
let _doneTexts = new Set();
let _activeTexts = new Set();

export function createObjectivesPanel() {
  if (_container) return _container;

  const style = document.createElement('style');
  style.textContent = `
    #objectives-panel { font-family: 'Courier New', monospace; }
    #objectives-panel .obj-row { transition: opacity .4s ease; }
    @keyframes objToastIn {
      0%   { opacity: 0; transform: translate(-50%, -12px); }
      12%  { opacity: 1; transform: translate(-50%, 0); }
      82%  { opacity: 1; }
      100% { opacity: 0; transform: translate(-50%, -6px); }
    }
    #obj-toast.run { animation: objToastIn 2.4s ease forwards; }
  `;
  document.head.appendChild(style);

  _container = document.createElement('div');
  _container.id = 'objectives-panel';
  _container.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 300px;
    z-index: 50;
    pointer-events: none;
    user-select: none;
    display: none;
  `;
  _container.innerHTML = `
    <div style="color:#7ef3ff; font-size:12px; letter-spacing:3px; text-transform:uppercase;
                text-shadow:0 0 8px rgba(0,170,255,.6); margin-bottom:8px; text-align:right;">
      &#9672; Objectives
    </div>
    <div id="obj-list"></div>
  `;
  _list = _container.querySelector('#obj-list');
  document.body.appendChild(_container);

  _toast = document.createElement('div');
  _toast.id = 'obj-toast';
  _toast.style.cssText = `
    position: fixed;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 28px;
    background: rgba(2,16,10,0.9);
    border: 1px solid rgba(0,255,170,0.6);
    border-radius: 8px;
    color: #7dffc9;
    font-size: 14px;
    letter-spacing: 2px;
    text-shadow: 0 0 12px rgba(0,255,170,.5);
    z-index: 120;
    opacity: 0;
    pointer-events: none;
    display: none;
    font-family: 'Courier New', monospace;
  `;
  document.body.appendChild(_toast);

  return _container;
}

function _row(item) {
  const done = !!item.done;
  const active = !!item.active && !done;
  const icon = done ? '&#10004;' : active ? '&#9656;' : '&#9675;';
  const color = done ? 'rgba(125,255,201,0.75)' : active ? '#ffffff' : 'rgba(150,160,175,0.55)';
  const textShadow = active ? '0 0 10px rgba(126,243,255,.45)' : 'none';
  const noteColor = done ? 'rgba(125,255,201,0.6)' : '#7ef3ff';
  const note = item.note
    ? `<span style="color:${noteColor}; font-size:11px; letter-spacing:1px; white-space:nowrap;">${item.note}</span>`
    : '<span></span>';
  return `
    <div class="obj-row" style="display:flex; justify-content:space-between; align-items:baseline; gap:10px;
         margin-bottom:7px; color:${color}; text-decoration:${done ? 'line-through' : 'none'};
         opacity:${done ? 0.8 : active ? 1 : 0.7}; font-size:14px; text-shadow:${textShadow};">
      <span>${icon}&nbsp;${item.text}</span>${note}
    </div>`;
}

export function updateObjectives(items) {
  if (!_container) createObjectivesPanel();

  if (!items || items.length === 0) {
    _container.style.display = 'none';
    _lastKey = null;
    _doneTexts = new Set();
    _activeTexts = new Set();
    return;
  }
  _container.style.display = '';

  const key = JSON.stringify(items.map(i => [i.text, i.note || '', !!i.done, !!i.active]));
  if (key === _lastKey) return;
  _lastKey = key;

  // Level changed (a whole new set of objective texts) — reset memory
  const texts = items.map(i => i.text);
  if ([..._doneTexts].some(t => !texts.includes(t))) {
    _doneTexts = new Set(items.filter(i => i.done).map(i => i.text));
    _activeTexts = new Set(items.filter(i => i.active && !i.done).map(i => i.text));
  }

  // Banner when an objective completes (green) or becomes active (cyan) —
  // the activation banner is how a new player learns what to do next.
  for (const i of items) {
    if (i.done && !_doneTexts.has(i.text)) {
      _doneTexts.add(i.text);
      _fireToast('\u2714 OBJECTIVE COMPLETE \u2014 ' + i.text.toUpperCase(), 'done');
    } else if (!i.done && i.active && !_activeTexts.has(i.text)) {
      _activeTexts.add(i.text);
      _fireToast('\u25B8 NEW OBJECTIVE \u2014 ' + i.text.toUpperCase(), 'active');
    }
  }

  _list.innerHTML = items.map(_row).join('');
}

function _fireToast(text, kind) {
  const done = kind === 'done';
  _toast.textContent = text;
  _toast.style.borderColor = done ? 'rgba(0,255,170,0.6)' : 'rgba(0,170,255,0.65)';
  _toast.style.color = done ? '#7dffc9' : '#a8ecff';
  _toast.style.textShadow = done
    ? '0 0 12px rgba(0,255,170,.5)'
    : '0 0 12px rgba(0,170,255,.55)';
  _toast.classList.remove('run');
  void _toast.offsetWidth;   // restart the CSS animation
  _toast.classList.add('run');
  _toast.style.display = 'block';
  clearTimeout(_toast._t);
  _toast._t = setTimeout(() => { _toast.style.display = 'none'; }, 2450);
}
