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
// Expression SVGs are generated from src/assets/mascot/mascot.*.svg by
// scripts/build-mascot.mjs (runs automatically before esbuild). Edit the
// source SVGs, not the generated file.
import { EXPRESSIONS } from "./mascot-expressions.js";

// Helper-layer gate. App code keeps calling Mascot.show()/flash() unconditionally;
// when `enabled` is false, those become no-ops and any already-mounted mascots
// are torn down. When `animations` is false, breathe/blink defaults flip off.
const config = { enabled: true, animations: true };

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
   * Update gating flags from settings. Disabling tears down any
   * already-rendered mascots so the call sites don't need to know.
   */
  configure(opts = {}) {
    if (typeof opts.enabled === "boolean") config.enabled = opts.enabled;
    if (typeof opts.animations === "boolean") config.animations = opts.animations;
    if (!config.enabled) {
      document.querySelectorAll(".mascot").forEach((el) => {
        blinkers.delete(el);
        el.parentNode && el.parentNode.removeChild(el);
      });
    }
  },

  /**
   * Mount/replace a mascot inside `target`.
   *   size:      px (required for non-flex containers)
   *   breathe:   true | false — slow breathing idle (default true)
   *   blink:     true | false — random blinks (default true)
   */
  show(target, expression, opts = {}) {
    if (!config.enabled) return null;
    const host = resolveTarget(target);
    if (!host) return null;
    const size = opts.size ?? null;
    const breathe = config.animations && opts.breathe !== false;
    const blink = config.animations && opts.blink !== false;

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
    if (!config.enabled) return;
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
};

export default Mascot;
