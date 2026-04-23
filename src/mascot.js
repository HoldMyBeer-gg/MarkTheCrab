// MarkTheCrab mascot layer.
// Wraps inline SVGs with expression swaps + idle animations (breathe, blink).
// Vanilla — no framework. Import from app.js:
//
//   import { Mascot } from "./mascot.js";
//   Mascot.show("#editor-mascot", "sleepy", { size: 180 });
//   Mascot.set("#editor-mascot", "happy");
//   Mascot.hide("#editor-mascot");
//   Mascot.flash("#save-mascot-slot", "celebrating", 1200);
//
// Every expression = one <svg>. We keep them authored as flat strings so
// there's zero build-step magic; CI can regenerate from mascot/*.svg if
// you ever repaint the character.

const PALETTE = {
  shell:  "#F46623",
  belly:  "#FFD9B8",
  ink:    "#1a1410",
  cheek:  "#FF5577",
  mouth:  "#FF7799",
  teal:   "#4FB8C9",
  yellow: "#F4C842",
};

// The six expression SVGs, minified. Generated from the production mascot
// canvas; if you repaint, regenerate with: `npm run mascot:build`.
const EXPRESSIONS = {
  happy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><ellipse cx="160" cy="288" rx="80" ry="7" fill="#1a1410" opacity=".15"/><g stroke="#1a1410" stroke-width="11" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g stroke="#F46623" stroke-width="7" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g transform="translate(70 188)rotate(-20)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/><path d="M-14 2q-8-4-12-12" stroke="#1a1410" stroke-width="3" fill="none" stroke-linecap="round"/></g><g transform="translate(250 188)rotate(20)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/><path d="M14 2q8-4 12-12" stroke="#1a1410" stroke-width="3" fill="none" stroke-linecap="round"/></g><circle cx="160" cy="170" r="88" fill="#F46623" stroke="#1a1410" stroke-width="3.5"/><ellipse cx="120" cy="115" rx="22" ry="14" fill="#fff" opacity=".3"/><ellipse cx="160" cy="198" rx="60" ry="34" fill="#FFD9B8" stroke="#1a1410" stroke-width="2.5"/><g class="eye eye-l"><ellipse cx="128" cy="145" rx="26" ry="26" fill="#fff" stroke="#1a1410" stroke-width="3"/><ellipse class="pupil" cx="128.4" cy="145.8" rx="14.3" ry="14.3" fill="#1a1410"/></g><g class="eye eye-r"><ellipse cx="192" cy="145" rx="26" ry="26" fill="#fff" stroke="#1a1410" stroke-width="3"/><ellipse class="pupil" cx="192.4" cy="145.8" rx="14.3" ry="14.3" fill="#1a1410"/></g><path d="M96 104q32-12 60 4" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M164 108q28-16 60-4" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M118 168q42 50 84 0q-42 32-84 0z" fill="#1a1410"/><rect x="144" y="170" width="11" height="16" fill="#fff"/><rect x="165" y="170" width="11" height="16" fill="#fff"/><path d="M148 192q12 12 24 0q-2 8-12 9q-10-1-12-9z" fill="#FF7799"/><circle cx="94" cy="172" r="11" fill="#FF5577" opacity=".6"/><circle cx="226" cy="172" r="11" fill="#FF5577" opacity=".6"/></svg>`,

  thinking: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><ellipse cx="160" cy="288" rx="80" ry="7" fill="#1a1410" opacity=".15"/><g stroke="#1a1410" stroke-width="11" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g stroke="#F46623" stroke-width="7" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g transform="translate(70 188)rotate(-20)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/></g><g transform="translate(250 188)rotate(20)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/></g><circle cx="160" cy="170" r="88" fill="#F46623" stroke="#1a1410" stroke-width="3.5"/><ellipse cx="160" cy="198" rx="60" ry="34" fill="#FFD9B8" stroke="#1a1410" stroke-width="2.5"/><g class="eye eye-l"><ellipse cx="128" cy="145" rx="26" ry="26" fill="#fff" stroke="#1a1410" stroke-width="3"/><ellipse class="pupil" cx="133.7" cy="143.4" rx="14.3" ry="14.3" fill="#1a1410"/></g><g class="eye eye-r"><ellipse cx="192" cy="145" rx="26" ry="26" fill="#fff" stroke="#1a1410" stroke-width="3"/><ellipse class="pupil" cx="197.7" cy="143.4" rx="14.3" ry="14.3" fill="#1a1410"/></g><path d="M96 106q32 12 60-2" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M164 104q28-16 60-4" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M135 182q25-10 50 2" stroke="#1a1410" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="185" cy="184" r="3" fill="#1a1410"/></svg>`,

  excited: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><ellipse cx="160" cy="288" rx="80" ry="7" fill="#1a1410" opacity=".15"/><g stroke="#1a1410" stroke-width="11" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g stroke="#F46623" stroke-width="7" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g transform="translate(70 188)rotate(-35)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/></g><g transform="translate(250 188)rotate(35)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/></g><circle cx="160" cy="170" r="88" fill="#F46623" stroke="#1a1410" stroke-width="3.5"/><ellipse cx="160" cy="198" rx="60" ry="34" fill="#FFD9B8" stroke="#1a1410" stroke-width="2.5"/><g class="eye eye-l"><ellipse cx="128" cy="145" rx="26" ry="10.4" fill="#fff" stroke="#1a1410" stroke-width="3"/><ellipse class="pupil" cx="128" cy="145" rx="14.3" ry="5.7" fill="#1a1410"/></g><g class="eye eye-r"><ellipse cx="192" cy="145" rx="26" ry="10.4" fill="#fff" stroke="#1a1410" stroke-width="3"/><ellipse class="pupil" cx="192" cy="145" rx="14.3" ry="5.7" fill="#1a1410"/></g><path d="M96 96q32-18 60 4" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M164 100q28-22 60-4" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><ellipse cx="160" cy="178" rx="30" ry="24" fill="#1a1410"/><ellipse cx="160" cy="188" rx="22" ry="14" fill="#FF7799"/><rect x="141" y="155" width="9" height="10" fill="#fff"/><rect x="170" y="155" width="9" height="10" fill="#fff"/><circle cx="94" cy="172" r="11" fill="#FF5577" opacity=".7"/><circle cx="226" cy="172" r="11" fill="#FF5577" opacity=".7"/></svg>`,

  sleepy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><ellipse cx="160" cy="288" rx="80" ry="7" fill="#1a1410" opacity=".15"/><g stroke="#1a1410" stroke-width="11" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g stroke="#F46623" stroke-width="7" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g transform="translate(70 188)rotate(-20)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/></g><g transform="translate(250 188)rotate(20)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/></g><circle cx="160" cy="170" r="88" fill="#F46623" stroke="#1a1410" stroke-width="3.5"/><ellipse cx="160" cy="198" rx="60" ry="34" fill="#FFD9B8" stroke="#1a1410" stroke-width="2.5"/><path d="M102 145q26-13 52 0" stroke="#1a1410" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M166 145q26-13 52 0" stroke="#1a1410" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M96 112q32 6 60 0" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M164 112q28 6 60 0" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M140 180q20 6 40 0" stroke="#1a1410" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`,

  error: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><ellipse cx="160" cy="288" rx="80" ry="7" fill="#1a1410" opacity=".15"/><g stroke="#1a1410" stroke-width="11" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g stroke="#F46623" stroke-width="7" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g transform="translate(70 188)rotate(-20)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/></g><g transform="translate(250 188)rotate(20)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/></g><circle cx="160" cy="170" r="88" fill="#F46623" stroke="#1a1410" stroke-width="3.5"/><ellipse cx="160" cy="198" rx="60" ry="34" fill="#FFD9B8" stroke="#1a1410" stroke-width="2.5"/><g class="eye eye-l"><ellipse cx="128" cy="145" rx="26" ry="26" fill="#fff" stroke="#1a1410" stroke-width="3"/><ellipse class="pupil" cx="128" cy="145.4" rx="14.3" ry="14.3" fill="#1a1410"/></g><g class="eye eye-r"><ellipse cx="192" cy="145" rx="26" ry="26" fill="#fff" stroke="#1a1410" stroke-width="3"/><ellipse class="pupil" cx="192" cy="145.4" rx="14.3" ry="14.3" fill="#1a1410"/></g><path d="M96 104q32 18 60 8" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M164 112q28 10 60-8" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M135 195q25-17 50 0" stroke="#1a1410" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M238 100q-6 14 4 18q8-4 6-18q-3-6-10 0z" fill="#7bb3d9" stroke="#1a1410" stroke-width="2"/></svg>`,

  celebrating: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><rect x="40" y="50" width="10" height="5" fill="#4FB8C9" transform="rotate(20 45 52)"/><rect x="260" y="40" width="10" height="5" fill="#F4C842" transform="rotate(-30 265 42)"/><circle cx="70" cy="90" r="4" fill="#FF5577"/><circle cx="255" cy="85" r="3" fill="#4FB8C9"/><ellipse cx="160" cy="288" rx="80" ry="7" fill="#1a1410" opacity=".15"/><g stroke="#1a1410" stroke-width="11" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g stroke="#F46623" stroke-width="7" stroke-linecap="round" fill="none"><path d="M110 232L96 278"/><path d="M210 232l14 46"/><path d="M138 240l-8 42"/><path d="M182 240l8 42"/></g><g transform="translate(70 188)rotate(-65)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/></g><g transform="translate(250 188)rotate(65)"><ellipse cx="0" cy="8" rx="24" ry="17" fill="#F46623" stroke="#1a1410" stroke-width="3"/></g><circle cx="160" cy="170" r="88" fill="#F46623" stroke="#1a1410" stroke-width="3.5"/><ellipse cx="160" cy="198" rx="60" ry="34" fill="#FFD9B8" stroke="#1a1410" stroke-width="2.5"/><g class="eye eye-l"><ellipse cx="128" cy="145" rx="26" ry="11.7" fill="#fff" stroke="#1a1410" stroke-width="3"/><ellipse class="pupil" cx="128" cy="144.6" rx="14.3" ry="6.4" fill="#1a1410"/></g><g class="eye eye-r"><ellipse cx="192" cy="145" rx="26" ry="11.7" fill="#fff" stroke="#1a1410" stroke-width="3"/><ellipse class="pupil" cx="192" cy="144.6" rx="14.3" ry="6.4" fill="#1a1410"/></g><path d="M96 96q32-18 60 4" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M164 100q28-22 60-4" stroke="#1a1410" stroke-width="5.5" stroke-linecap="round" fill="none"/><path d="M115 165q45 67 90 0q-45 45-90 0z" fill="#1a1410"/><rect x="141" y="167" width="12" height="18" fill="#fff"/><rect x="168" y="167" width="12" height="18" fill="#fff"/><circle cx="94" cy="172" r="11" fill="#FF5577" opacity=".8"/><circle cx="226" cy="172" r="11" fill="#FF5577" opacity=".8"/></svg>`,
};

// Inject shared keyframes once.
function injectStyles() {
  if (document.getElementById("mascot-styles")) return;
  const style = document.createElement("style");
  style.id = "mascot-styles";
  style.textContent = `
    .mascot {
      display: inline-block; line-height: 0; user-select: none; -webkit-user-select: none;
      cursor: pointer;
      /* Re-enable clicks even when mounted in a pointer-events:none overlay */
      pointer-events: auto;
    }
    .mascot svg { width: 100%; height: 100%; overflow: visible; }
    .mascot-breathe { animation: mascot-breathe 3.5s ease-in-out infinite; transform-origin: center 80%; }
    @keyframes mascot-breathe {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.025); }
    }
    .mascot-bounce { animation: mascot-bounce 900ms cubic-bezier(.3,.7,.4,1); transform-origin: center 80%; }
    @keyframes mascot-bounce {
      0%   { transform: scale(1); }
      18%  { transform: translateY(-5px) scale(1.18); }
      35%  { transform: translateY(0)    scale(0.92); }
      55%  { transform: translateY(0)    scale(1.06); }
      100% { transform: scale(1); }
    }
    .mascot .eye .pupil { transition: transform 200ms ease-out; transform-origin: center; transform-box: fill-box; }
    .mascot.blink .eye .pupil { transform: scaleY(0.08); }
    .mascot-flash {
      animation: mascot-flash 1200ms ease-out forwards;
      transform-origin: center bottom;
    }
    @keyframes mascot-flash {
      0%   { opacity: 0; transform: translateY(6px) scale(0.6); }
      18%  { opacity: 1; transform: translateY(0)   scale(1.12); }
      35%  {             transform: translateY(0)   scale(1);    }
      75%  { opacity: 1; transform: translateY(0)   scale(1);    }
      100% { opacity: 0; transform: translateY(-6px) scale(0.95); }
    }
    .mascot-fade-enter { opacity: 0; }
    .mascot-fade-enter.mascot-fade-active { opacity: 1; transition: opacity 300ms ease-out; }
    .mascot-fade-exit  { opacity: 1; }
    .mascot-fade-exit.mascot-fade-active { opacity: 0; transition: opacity 300ms ease-out; }
  `;
  document.head.appendChild(style);
}

function resolveTarget(target) {
  if (typeof target === "string") return document.querySelector(target);
  return target;
}

function buildMascot(expression, size) {
  injectStyles();
  const el = document.createElement("div");
  el.className = "mascot";
  if (size) { el.style.width = size + "px"; el.style.height = size + "px"; }
  el.innerHTML = EXPRESSIONS[expression] || EXPRESSIONS.happy;
  el.dataset.expression = expression;
  el.addEventListener("click", handleMascotClick);
  return el;
}

// Easter-egg: tap/click Mark to briefly celebrate, then revert. Skip on the
// error face (celebrating his own failure would be tasteless) and on the
// save-flash one-shot (it's already animating away).
function handleMascotClick(e) {
  const el = e.currentTarget;
  if (el.dataset.expression === "error") return;
  if (el.classList.contains("mascot-flash")) return;
  if (el.dataset.celebrating === "true") return;

  const prior = el.dataset.expression;
  const wasBreathing = el.classList.contains("mascot-breathe");
  el.dataset.celebrating = "true";
  if (wasBreathing) el.classList.remove("mascot-breathe");
  el.innerHTML = EXPRESSIONS.celebrating;
  el.classList.add("mascot-bounce");
  setTimeout(() => {
    // Bail if something else changed the expression while we were bouncing
    if (el.dataset.celebrating !== "true") return;
    el.classList.remove("mascot-bounce");
    el.innerHTML = EXPRESSIONS[prior] || EXPRESSIONS.happy;
    if (wasBreathing) el.classList.add("mascot-breathe");
    delete el.dataset.celebrating;
  }, 900);
}

// Blink controller — schedules random blinks on all registered mascots.
const blinkers = new Set();
function startBlinkLoop() {
  if (startBlinkLoop._started) return;
  startBlinkLoop._started = true;
  const tick = () => {
    blinkers.forEach((el) => {
      if (!document.contains(el)) { blinkers.delete(el); return; }
      // random per-element: ~8% chance to blink on each tick (600ms cadence)
      if (!el.classList.contains("blink") && Math.random() < 0.08) {
        el.classList.add("blink");
        setTimeout(() => el.classList.remove("blink"), 140);
      }
    });
    setTimeout(tick, 600);
  };
  tick();
}

export const Mascot = {
  /**
   * Mount/replace a mascot inside `target`.
   *   size:      px (required for non-flex containers)
   *   breathe:   true | false — slow breathing idle (default true)
   *   blink:     true | false — random blinks (default true)
   */
  show(target, expression, opts = {}) {
    const host = resolveTarget(target);
    if (!host) return null;
    const size = opts.size ?? null;
    const breathe = opts.breathe !== false;
    const blink = opts.blink !== false;

    host.innerHTML = "";
    const el = buildMascot(expression, size);
    if (breathe) el.classList.add("mascot-breathe");
    host.appendChild(el);
    if (blink) {
      blinkers.add(el);
      startBlinkLoop();
    }
    return el;
  },

  /** Swap expression without remounting (preserves animation state). */
  set(target, expression) {
    const host = resolveTarget(target);
    if (!host) return;
    const el = host.querySelector(".mascot");
    if (!el) return this.show(host, expression);
    if (el.dataset.expression === expression) return;
    // If a celebration is in flight, cancel its pending revert.
    delete el.dataset.celebrating;
    el.classList.remove("mascot-bounce");
    el.innerHTML = EXPRESSIONS[expression] || EXPRESSIONS.happy;
    el.dataset.expression = expression;
  },

  hide(target) {
    const host = resolveTarget(target);
    if (!host) return;
    const el = host.querySelector(".mascot");
    if (!el) return;
    el.classList.add("mascot-fade-exit");
    requestAnimationFrame(() => el.classList.add("mascot-fade-active"));
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
  },

  /** One-shot celebration flash (e.g. save success). */
  flash(target, expression, duration = 1200, size = 48) {
    const host = resolveTarget(target);
    if (!host) return;
    const el = buildMascot(expression, size);
    el.classList.add("mascot-flash");
    host.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, duration);
  },

  /** Inline mascot for contexts where you need the raw node (error cards). */
  build(expression, size = 48) {
    return buildMascot(expression, size);
  },

  palette: PALETTE,
};

export default Mascot;
