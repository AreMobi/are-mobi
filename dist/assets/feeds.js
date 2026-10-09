// Live feeds: Solana block height (RPC) and DexScreener pairs. No numbers are hardcoded.
import { $, $$, DASH, copyText, feedback, flash, fmtChange, fmtInt, fmtPrice, fmtUsd, poller, readRegister, reduced, tween } from "./core.js";

const reg = readRegister();
const IMG_HOST = "https://cdn.dexscreener.com/";
const TOP = 10;

/* ---------- tile helpers ---------- */
const tileOf = (name) => {
  const t = $(`[data-tile="${name}"]`);
  return { t, skel: $("[data-skel]", t), val: $("[data-val]", t), note: $("[data-note]", t), idle: $("[data-note]", t).textContent };
};
const tiles = { block: tileOf("block"), pairs: tileOf("pairs"), volume: tileOf("volume"), sync: tileOf("sync") };

function ready(tile) {
  if (tile.skel) { tile.skel.remove(); tile.skel = null; }
  if (tile.val.hidden) { tile.val.hidden = false; tile.val.classList.add("fade-in"); }
}
function good(tile, note) {
  tile.t.dataset.error = "false";
  tile.note.textContent = note ?? tile.idle;
}
function bad(tile, message) {
  ready(tile);
  cancelAnimationFrame(tile.val._raf);
  clearTimeout(tile.val._done);
  tile.val.textContent = DASH;
  tile.t.dataset.error = "true";
  tile.note.textContent = message;
}
const secs = (ms) => `${Math.max(1, Math.round(ms / 1000))} s`;

let lastGood = 0;
const markGood = () => { lastGood = Date.now(); };

/* ---------- block height ---------- */
const pill = $("[data-live-pill]");
const pillBlock = $("[data-pill-block]");
let anchor = null; // { h, t } last real reading
let rate = 2.5;    // blocks per second, smoothed from real polls
let shown = NaN;
let ticking = false;

function paintBlock(n, doFlash) {
  if (n === shown) return;
  shown = n;
  tiles.block.val.textContent = fmtInt(n);
  pillBlock.textContent = "block " + fmtInt(n);
  if (doFlash) flash(tiles.block.val);
}

function tickFrame() {
  if (!anchor || reduced()) { ticking = false; return; }
  const dt = (performance.now() - anchor.t) / 1000;
  paintBlock(anchor.h + Math.floor(Math.min(dt, 10) * rate), false);
  requestAnimationFrame(tickFrame);
}

function blockOk(h) {
  const now = performance.now();
  if (anchor && h > anchor.h && now > anchor.t) {
    const inst = (h - anchor.h) / ((now - anchor.t) / 1000);
    if (inst > 0.5 && inst < 8) rate = rate * 0.6 + inst * 0.4;
  }
  anchor = { h, t: now };
  ready(tiles.block);
  good(tiles.block);
  pill.dataset.state = "up";
  const changed = h !== shown;
  shown = NaN;
  paintBlock(h, changed);
  markGood();
  if (!ticking && !reduced()) { ticking = true; requestAnimationFrame(tickFrame); }
}

function blockFail(err, wait) {
  anchor = null;
  shown = NaN;
  bad(tiles.block, `RPC node did not answer (${err.message}). Retrying in ${secs(wait)}.`);
  pill.dataset.state = "down";
  pillBlock.textContent = "block " + DASH;
}

async function fetchBlockHeight() {
  const res = await fetch(reg.rpc.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBlockHeight", params: [{ commitment: "confirmed" }] }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  if (!Number.isSafeInteger(j.result)) throw new Error("unexpected reply");
  return j.result;
}

/* ---------- pairs ---------- */
const list = $("[data-pairs]");
const note = $("[data-pairs-note]");
const marquee = $("[data-marquee]");
const track = $("[data-marquee-track]");
let prevPairs = NaN, prevVol = NaN;
let sig = "";

function logoEl(p, cls = "token-logo") {
  const url = p.info?.imageUrl;
  const sym = (p.baseToken?.symbol || "?").slice(0, 1).toUpperCase();
  if (typeof url === "string" && url.startsWith(IMG_HOST)) {
    const img = document.createElement("img");
    img.className = cls;
    img.src = url;
    img.alt = "";
    img.width = img.height = 36;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      const f = document.createElement("span");
      f.className = cls;
      f.textContent = sym;
      img.replaceWith(f);
    });
    return img;
  }
  const f = document.createElement("span");
  f.className = cls;
  f.textContent = sym;
  return f;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function numCell(label, text, cls = "") {
  const d = el("div", "num " + cls);
  d.append(el("small", null, label), document.createTextNode(text));
  return d;
}

function pairRow(p) {
  const li = el("li", "pair fade-in");
  li.dataset.spot = "";
  li.dataset.addr = p.pairAddress;
  const token = el("div", "token");
  token.append(logoEl(p));
  const name = el("div", "token-name");
  name.append(el("strong", null, p.baseToken?.name || p.baseToken?.symbol || DASH), el("span", null, `${p.baseToken?.symbol || "?"} / ${p.quoteToken?.symbol || "?"} · ${p.dexId || "dex"}`));
  token.append(name);
  const mini = el("div", "mini");
  const price = numCell("Price", fmtPrice(Number(p.priceUsd)));
  price.dataset.f = "price";
  const ch = fmtChange(p.priceChange?.h24);
  const chg = numCell("24 h", ch.text, ch.cls);
  chg.dataset.f = "chg";
  const vol = numCell("Volume", fmtUsd(p.volume?.h24));
  vol.dataset.f = "vol";
  mini.append(price, chg, vol);
  const btn = el("button", "copy-addr");
  btn.type = "button";
  btn.dataset.glyph = "icon";
  btn.dataset.spot = "";
  const addr = p.baseToken?.address;
  btn.setAttribute("aria-label", `Copy token address for ${p.baseToken?.symbol || "token"}`);
  btn.title = "Copy token address";
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path fill="currentColor" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';
  if (typeof addr !== "string" || !addr) btn.disabled = true;
  btn.addEventListener("click", async () => {
    if (await copyText(addr, `Copied ${p.baseToken?.symbol || "token"} address`)) feedback(btn, "Copied");
  });
  li.append(token, mini, btn);
  return li;
}

function updateRow(li, p) {
  const set = (f, text, cls) => {
    const d = $(`[data-f="${f}"]`, li);
    const node = d.lastChild;
    if (node.textContent !== text) { node.textContent = text; flash(d); }
    if (cls != null) d.className = "num " + cls;
  };
  set("price", fmtPrice(Number(p.priceUsd)));
  const ch = fmtChange(p.priceChange?.h24);
  set("chg", ch.text, ch.cls);
  set("vol", fmtUsd(p.volume?.h24));
}

function chipEl(p) {
  const c = el("span", "chip");
  c.dataset.addr = p.pairAddress;
  const ch = fmtChange(p.priceChange?.h24);
  c.append(logoEl(p, "token-logo"), el("span", null, p.baseToken?.symbol || "?"), el("span", "mono", fmtPrice(Number(p.priceUsd))), el("span", "chg " + ch.cls, ch.text));
  return c;
}

function buildMarquee(pairs) {
  track.replaceChildren();
  const mk = (hidden) => {
    const s = el("div", "marquee-set");
    if (hidden) s.setAttribute("aria-hidden", "true");
    return s;
  };
  const first = mk(false);
  track.append(first);
  const add = (set) => pairs.forEach((p) => set.append(chipEl(p)));
  add(first);
  const need = marquee.clientWidth || innerWidth;
  let guard = 0;
  while (first.scrollWidth < need && guard++ < 12) add(first);
  const clone = first.cloneNode(true);
  clone.setAttribute("aria-hidden", "true");
  clone.querySelectorAll("img").forEach((i) => i.setAttribute("alt", ""));
  track.append(clone);
  track.style.setProperty("--marquee-d", `${Math.max(14, Math.round(first.scrollWidth / 60))}s`);
}

function updateMarquee(pairs) {
  const byAddr = new Map(pairs.map((p) => [p.pairAddress, p]));
  $$(".chip[data-addr]", track).forEach((c) => {
    const p = byAddr.get(c.dataset.addr);
    if (!p) return;
    const [, , price, chg] = c.children;
    price.textContent = fmtPrice(Number(p.priceUsd));
    const ch = fmtChange(p.priceChange?.h24);
    chg.textContent = ch.text;
    chg.className = "chg " + ch.cls;
  });
}

function dexOk(pairs) {
  markGood();
  list.setAttribute("aria-busy", "false");
  good(tiles.pairs);
  good(tiles.volume);
  note.dataset.error = "false";
  note.textContent = `Updated ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. Ranked by 24 h volume; listing is not endorsement.`;

  ready(tiles.pairs);
  ready(tiles.volume);
  const total = pairs.reduce((s, p) => s + (Number(p.volume?.h24) || 0), 0);
  tween(tiles.pairs.val, Number.isFinite(prevPairs) ? prevPairs : 0, pairs.length, fmtInt);
  tween(tiles.volume.val, Number.isFinite(prevVol) ? prevVol : 0, total, fmtUsd);
  if (Number.isFinite(prevPairs) && (prevPairs !== pairs.length || prevVol !== total)) { flash(tiles.pairs.val); flash(tiles.volume.val); }
  prevPairs = pairs.length;
  prevVol = total;

  if (!pairs.length) {
    list.replaceChildren(el("li", "empty", "No Solana pairs came back right now."));
    track.replaceChildren();
    marquee.hidden = true;
    sig = "";
    return;
  }
  marquee.hidden = false;
  const nextSig = pairs.map((p) => p.pairAddress).join("|");
  if (nextSig !== sig) {
    list.replaceChildren(...pairs.map(pairRow));
    buildMarquee(pairs);
    sig = nextSig;
  } else {
    const rows = new Map($$(".pair[data-addr]", list).map((r) => [r.dataset.addr, r]));
    pairs.forEach((p) => rows.get(p.pairAddress) && updateRow(rows.get(p.pairAddress), p));
    updateMarquee(pairs);
  }
}

function dexFail(err, wait) {
  const msg = `Pair index did not answer (${err.message}). Retrying in ${secs(wait)}.`;
  bad(tiles.pairs, msg);
  bad(tiles.volume, msg);
  prevPairs = prevVol = NaN;
  sig = "";
  list.setAttribute("aria-busy", "false");
  const li = el("li", "empty", `${DASH}  No data. The pair index is unreachable.`);
  list.replaceChildren(li);
  track.replaceChildren();
  marquee.hidden = true;
  note.dataset.error = "true";
  note.textContent = msg;
}

async function fetchPairs() {
  const get = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  };
  const boosted = await get(reg.dex.url);
  if (!Array.isArray(boosted)) throw new Error("unexpected reply");
  const mints = [...new Set(boosted.filter((b) => b && b.chainId === reg.chain.value && typeof b.tokenAddress === "string").map((b) => b.tokenAddress))].slice(0, 30);
  if (!mints.length) return [];
  const all = await get(`${reg.dexTokens.url}/${mints.join(",")}`);
  if (!Array.isArray(all)) throw new Error("unexpected reply");
  // one row per token: keep its busiest pair
  const best = new Map();
  for (const p of all) {
    if (!p || p.chainId !== reg.chain.value || typeof p.pairAddress !== "string") continue;
    const k = p.baseToken?.address;
    const v = Number(p.volume?.h24) || 0;
    if (!best.has(k) || v > (Number(best.get(k).volume?.h24) || 0)) best.set(k, p);
  }
  return [...best.values()].sort((a, b) => (Number(b.volume?.h24) || 0) - (Number(a.volume?.h24) || 0)).slice(0, TOP);
}

/* ---------- sync age ---------- */
function syncAge() {
  const t = tiles.sync;
  if (!lastGood) return;
  ready(t);
  good(t);
  const s = Math.floor((Date.now() - lastGood) / 1000);
  t.val.textContent = `${s} s`;
}

export function startFeeds() {
  poller({ run: fetchBlockHeight, interval: 2000, base: 2000, max: 60000, onOk: blockOk, onFail: blockFail });
  poller({ run: fetchPairs, interval: 20000, base: 4000, max: 120000, onOk: dexOk, onFail: dexFail });
  setInterval(syncAge, 1000);
  setTimeout(() => { if (!lastGood) bad(tiles.sync, "No source has answered yet."); }, 9000);
}
