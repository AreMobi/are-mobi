// Shared plumbing: motion preference, spring reveal, spotlight, toast, copy, polling with backoff.

const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
export const reduced = () => mq.matches;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function readRegister() {
  return JSON.parse(document.getElementById("register").textContent).records;
}

/* ---------- spring physics ---------- */
// Damped spring, analytic solution, sampled into keyframes so WAAPI can play it.
export function springSamples({ stiffness = 180, damping = 14, mass = 1, steps = 48, seconds = 0.95 } = {}) {
  const w0 = Math.sqrt(stiffness / mass);
  const z = damping / (2 * Math.sqrt(stiffness * mass));
  const wd = w0 * Math.sqrt(Math.max(1 - z * z, 1e-6));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * seconds;
    out.push(1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t)));
  }
  return out;
}
const SPRING = springSamples();

export function initReveal() {
  const items = $$(".rv");
  if (reduced() || !("IntersectionObserver" in window) || !("animate" in Element.prototype)) {
    items.forEach((el) => el.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      let n = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const el = e.target;
        const frames = SPRING.map((p, i) => ({
          offset: i / (SPRING.length - 1),
          opacity: Math.min(1, Math.max(0, p * 1.25)),
          transform: `translate3d(0, ${(1 - p) * 30}px, 0) scale(${0.985 + 0.015 * p})`,
        }));
        el.classList.add("is-in");
        el.animate(frames, { duration: 950, delay: n * 80, easing: "linear", fill: "backwards" });
        n++;
      }
    },
    { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
  );
  items.forEach((el) => io.observe(el));
}

/* ---------- spotlight ---------- */
export function initSpotlight() {
  document.addEventListener(
    "pointermove",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest("[data-spot]") : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    },
    { passive: true },
  );
}

/* ---------- progress bar + parallax ---------- */
export function initScrollEffects() {
  const bar = $("#progress");
  const layers = $$(".layer");
  const hero = $("#overview");
  let px = 0, py = 0, queued = false;
  const frame = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
    if (!reduced() && hero) {
      for (const l of layers) {
        const d = parseFloat(l.dataset.depth || "0");
        l.style.setProperty("--px", `${(-px * innerWidth * d * 2).toFixed(2)}px`);
        l.style.setProperty("--py", `${(-py * innerHeight * d * 2 + scrollY * d * 3).toFixed(2)}px`);
      }
    }
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue, { passive: true });
  addEventListener("pointermove", (e) => { px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5; queue(); }, { passive: true });
  queue();
}

/* ---------- toast + copy ---------- */
let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-on"), 2200);
}

export async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    if (!ok) { toast("Copy blocked. Select the text and copy by hand."); return false; }
  }
  toast(label);
  return true;
}

export function feedback(btn, done = "Copied", idle) {
  if (!btn) return;
  const was = idle ?? btn.dataset.idle ?? btn.textContent;
  btn.dataset.idle = was;
  if (btn.dataset.glyph !== "icon") btn.textContent = done;
  btn.classList.add("is-done");
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    if (btn.dataset.glyph !== "icon") btn.textContent = was;
    btn.classList.remove("is-done");
  }, 1600);
}

/* ---------- number tweening + flash ---------- */
export function flash(el) {
  if (!el || reduced()) return;
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

export function tween(el, from, to, fmt, ms = 700) {
  cancelAnimationFrame(el._raf);
  clearTimeout(el._done);
  if (reduced() || from === to || !Number.isFinite(from)) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
  el._done = setTimeout(() => { cancelAnimationFrame(el._raf); el.textContent = fmt(to); }, ms + 80);
}

/* ---------- polling with exponential backoff ---------- */
export function poller({ run, interval, base = 1000, max = 60000, onOk, onFail }) {
  let fails = 0, timer = 0, stopped = false;
  const schedule = (ms) => { clearTimeout(timer); if (!stopped) timer = setTimeout(tick, ms); };
  async function tick() {
    if (document.hidden) { schedule(interval); return; }
    try {
      const data = await run();
      fails = 0;
      onOk(data);
      schedule(interval);
    } catch (err) {
      fails++;
      const d = Math.min(max, base * 2 ** (fails - 1));
      const wait = Math.round(d + d * 0.2 * Math.random());
      onFail(err, wait, fails);
      schedule(wait);
    }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !stopped) schedule(0); });
  schedule(0);
  return { stop() { stopped = true; clearTimeout(timer); } };
}

/* ---------- formatting ---------- */
export const DASH = "—";
const intFmt = new Intl.NumberFormat("en-US");
export const fmtInt = (n) => (Number.isFinite(n) ? intFmt.format(Math.round(n)) : DASH);
export function fmtUsd(n) {
  if (!Number.isFinite(n)) return DASH;
  if (n >= 1000) return "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtPrice(n) {
  if (!Number.isFinite(n)) return DASH;
  if (n >= 1) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (n === 0) return "$0";
  const digits = Math.min(12, Math.max(4, -Math.floor(Math.log10(n)) + 3));
  return "$" + n.toFixed(digits);
}
export function fmtChange(n) {
  if (!Number.isFinite(n)) return { text: DASH, cls: "" };
  const up = n >= 0;
  return { text: `${up ? "▲" : "▼"} ${Math.abs(n).toFixed(2)}%`, cls: up ? "up" : "down" };
}
