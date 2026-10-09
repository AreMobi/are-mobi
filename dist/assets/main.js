import { $, $$, copyText, feedback, initReveal, initScrollEffects, initSpotlight, readRegister, reduced } from "./core.js";
import { startFeeds } from "./feeds.js";

const reg = readRegister();

/* contract slot: inert until the register says stated */
function initCa() {
  const slot = $('.ca[data-record="ca"]');
  if (!slot || reg.ca.state !== "stated" || !reg.ca.value) return;
  const btn = $("[data-copy-ca]", slot);
  const inner = $("[data-ca-click]", slot);
  inner.style.cursor = "pointer";
  const go = async () => {
    if (await copyText(reg.ca.value, "Contract address copied")) feedback(btn, "Copied");
  };
  inner.addEventListener("click", go);
}

/* on-this-page menu */
function initPageNav() {
  const menu = $("[data-home-nav]");
  if (!menu) return;
  const label = $("[data-home-nav-current]", menu);
  const wide = matchMedia("(min-width: 1440px)");
  const entries = $$('a[href^="#"]', menu)
    .map((link) => ({ link, target: document.getElementById(link.getAttribute("href").slice(1)) }))
    .filter((e) => e.target);
  const topbar = $(".topbar");
  const update = () => {
    const offset = (topbar ? topbar.offsetHeight : 120) + 40;
    let cur = entries[0];
    entries.forEach((e) => { if (e.target.getBoundingClientRect().top <= offset) cur = e; });
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) cur = entries[entries.length - 1];
    entries.forEach((e) => (e === cur ? e.link.setAttribute("aria-current", "location") : e.link.removeAttribute("aria-current")));
    label.textContent = cur.link.textContent;
  };
  const layout = () => { menu.open = wide.matches; update(); };
  let q = false;
  const queue = () => { if (!q) { q = true; requestAnimationFrame(() => { q = false; update(); }); } };
  entries.forEach(({ link }) => link.addEventListener("click", () => { if (!wide.matches) menu.open = false; }));
  wide.addEventListener("change", layout);
  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue, { passive: true });
  layout();
}

/* keep topbar height available to scroll-margin rules */
function syncTopbar() {
  const topbar = $(".topbar");
  if (!topbar) return;
  const set = () => document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
  set();
  if ("ResizeObserver" in window) new ResizeObserver(set).observe(topbar);
}

initCa();
syncTopbar();
initPageNav();
initSpotlight();
initScrollEffects();
initReveal();
startFeeds();
if (reduced()) document.documentElement.dataset.motion = "reduced";
