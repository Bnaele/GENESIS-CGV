// ============================================================
// src/trailer/TrailerOverlay.js
// Shared cinematic DOM overlay for trailer capture — letterbox
// bars, captions, title cards, page-flip transitions, REC timer
// and the white flash. Used by TrailerDirector (prologue) and by
// the level showcase runners (level2/level3 trailerRun).
//
// Purely presentational: skipping/ESC stays with the caller.
// ============================================================

export class TrailerOverlay {
  constructor({ skipHint = 'ESC — SKIP TRAILER', showPages = true } = {}) {
    const el = document.createElement('div');
    el.id = 'trailer-overlay';
    el.innerHTML = `
      <style>
        #trailer-overlay {
          position: fixed; inset: 0;
          z-index: 250;                 /* over HUD/menu, under pause menu */
          pointer-events: none;
          font-family: 'Courier New', monospace;
        }
        #trailer-overlay .bar {
          position: absolute; left: 0; right: 0; height: 12%;
          background: #000;
        }
        #trailer-overlay .bar.top { top: 0; }
        #trailer-overlay .bar.bottom { bottom: 0; }
        #trailer-overlay .caption {
          position: absolute; left: 50%; bottom: 17%;
          transform: translateX(-50%);
          max-width: 80%;
          text-align: center;
          color: #dffcff;
          font-size: clamp(1rem, 2.2vw, 1.5rem);
          letter-spacing: 3px;
          text-shadow: 0 0 18px rgba(0, 217, 242, 0.75), 0 2px 4px #000;
          opacity: 0;
          transition: opacity 0.45s ease;
          white-space: pre-line;
        }
        #trailer-overlay .title {
          position: absolute; left: 50%; top: 42%;
          transform: translate(-50%, -50%);
          text-align: center;
          opacity: 0;
          transition: opacity 0.6s ease;
        }
        #trailer-overlay .title .main {
          color: #eafcff;
          font-size: clamp(1.6rem, 4.6vw, 3.2rem);
          letter-spacing: 10px;
          text-shadow: 0 0 26px rgba(0, 217, 242, 0.85), 0 2px 6px #000;
        }
        #trailer-overlay .title .sub {
          margin-top: 0.7em;
          color: #7fd7e8;
          font-size: clamp(0.8rem, 1.6vw, 1.1rem);
          letter-spacing: 6px;
          text-shadow: 0 0 14px rgba(0, 217, 242, 0.5), 0 2px 4px #000;
        }
        #trailer-overlay .rec {
          position: absolute; top: calc(12% + 12px); left: 18px;
          color: #ff5555;
          font-size: 0.85rem;
          letter-spacing: 2px;
          opacity: 0.85;
          text-shadow: 0 0 8px rgba(255, 60, 60, 0.6);
        }
        #trailer-overlay .skip-hint {
          position: absolute; bottom: calc(12% + 12px); right: 18px;
          color: #5a6a7a;
          font-size: 0.75rem;
          letter-spacing: 2px;
          opacity: 0.8;
        }
        #trailer-overlay .flip {
          position: absolute; inset: 0;
          perspective: 1400px;
        }
        #trailer-overlay .page {
          position: absolute; top: 0; bottom: 0; width: 50.15%;
          background: #000;
          transition: transform 0.5s cubic-bezier(0.65, 0, 0.35, 1);
          backface-visibility: hidden;
          box-shadow: 0 0 40px rgba(0, 217, 242, 0.12);
        }
        #trailer-overlay .page.left  { left: 0;  transform-origin: left center; }
        #trailer-overlay .page.right { right: 0; transform-origin: right center; }
        #trailer-overlay.pages-open .page.left  { transform: rotateY(-92deg); }
        #trailer-overlay.pages-open .page.right { transform: rotateY(92deg); }
        #trailer-overlay .flash {
          position: absolute; inset: 0;
          background: #cfeeff;
          opacity: 0;
          transition: opacity 0.55s ease;
        }
      </style>
      <div class="bar top"></div>
      <div class="bar bottom"></div>
      <div class="flip">
        <div class="page left"></div>
        <div class="page right"></div>
      </div>
      <div class="caption"></div>
      <div class="title"><div class="main"></div><div class="sub"></div></div>
      <div class="flash"></div>
      <div class="rec">● REC 00:00</div>
      <div class="skip-hint"></div>
    `;
    document.body.appendChild(el);

    this.el = el;
    this._captionEl = el.querySelector('.caption');
    this._titleEl = el.querySelector('.title');
    this._titleMain = el.querySelector('.title .main');
    this._titleSub = el.querySelector('.title .sub');
    this._flashEl = el.querySelector('.flash');
    this._recEl = el.querySelector('.rec');
    this._skipEl = el.querySelector('.skip-hint');
    this._pages = el.querySelector('.flip');

    if (!showPages) this._pages.style.display = 'none';
    this._skipEl.textContent = skipHint;

    // Pages start CLOSED (the closed book) — caller opens them
    el.classList.remove('pages-open');

    // Fade the skip hint out after a few seconds — keep the frame clean
    setTimeout(() => {
      if (this._skipEl) {
        this._skipEl.style.transition = 'opacity 1s ease';
        this._skipEl.style.opacity = '0';
      }
    }, 5000);

    this._recLast = -1;
  }

  // ── captions ──
  showCaption(text) {
    if (!this._captionEl) return;
    this._captionEl.textContent = text;
    this._captionEl.style.opacity = '1';
  }

  hideCaption() {
    if (!this._captionEl) return;
    this._captionEl.style.opacity = '0';
  }

  // ── title card (LEVEL 2 — NEON DISTRICT etc.) ──
  async titleCard(main, sub = '', holdMs = 2400) {
    this._titleMain.textContent = main;
    this._titleSub.textContent = sub;
    this._titleEl.style.opacity = '1';
    await this._sleep(holdMs);
    this._titleEl.style.opacity = '0';
    await this._sleep(650);
  }

  // ── page flip ──
  setPagesOpen(open) {
    if (open) this.el.classList.add('pages-open');
    else this.el.classList.remove('pages-open');
  }

  async flipSwap(midFn) {
    this.setPagesOpen(false);
    await this._sleep(560);
    if (midFn) midFn();
    await this._sleep(120);
    this.setPagesOpen(true);
    await this._sleep(620);
  }

  // ── white flash ──
  flash(duration = 550) {
    if (!this._flashEl) return;
    this._flashEl.style.transition = 'none';
    this._flashEl.style.opacity = '0.95';
    void this._flashEl.offsetHeight;   // force a style flush
    this._flashEl.style.transition = `opacity ${duration}ms ease`;
    this._flashEl.style.opacity = '0';
  }

  // ── REC timer — call every frame with elapsed seconds ──
  tick(t) {
    if (!this._recEl || (t - this._recLast) <= 0.25) return;
    this._recLast = t;
    const s = Math.floor(t);
    this._recEl.textContent =
      `● REC ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // ── teardown ──
  fadeOut(removeAfter = 800) {
    this.el.style.transition = 'opacity 0.7s ease';
    this.el.style.opacity = '0';
    return new Promise((resolve) => {
      setTimeout(() => { this.destroy(); resolve(); }, removeAfter);
    });
  }

  destroy() {
    if (this.el && this.el.parentNode) this.el.remove();
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
