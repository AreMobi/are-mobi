// npm run gates: checks dist/ for the current register branch, rebuilds the opposite branch and checks it,
// then proves the gates bite by mutating copies of both builds. Exit 0 only if everything holds.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ROOT, build, handleOf, readTokens, validateRegister } from "./build.mjs";
import { bigramHashes, decodePng, segmentsOf, stringsOfJs } from "./text.mjs";

const DIST = path.join(ROOT, "dist");
const TMP = path.join(ROOT, ".gate-tmp");
const SRC = path.join(ROOT, "src");
const registerSrc = JSON.parse(fs.readFileSync(path.join(SRC, "register.json"), "utf8"));

const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
const walk = (dir, skip = []) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const f = path.join(dir, e.name);
  if (skip.includes(e.name)) return [];
  return e.isDirectory() ? walk(f, skip) : [f];
});
const TEXT = /\.(html|css|js|json|svg|txt|md|mjs)$|_headers$/;
const B58 = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;
const EVM = /0x[0-9a-fA-F]{40}/g;
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;

function b58(bytes) {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex")), s = "";
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  return s;
}
const randomAddress = () => b58(crypto.randomBytes(32));

/** Opposite branch: every record flips state. Anchors read the live record, nothing is hardcoded. */
function flipRegister(reg) {
  const out = structuredClone(reg);
  for (const [id, r] of Object.entries(out.records)) {
    if (!["x", "github", "ca"].includes(id)) continue;
    if (r.state === "stated") { r.state = "absent"; r.value = null; r.url = null; r.source = null; }
    else if (id === "ca") { r.state = "stated"; r.value = randomAddress(); r.source = "gate-fixture"; }
    else { r.state = "stated"; r.url = `https://${id === "x" ? "x.com" : "github.com"}/are-gate-fixture`; r.source = "gate-fixture"; }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* per-build gates: each returns {ok, detail}                           */
/* ------------------------------------------------------------------ */
const refBigrams = new Set(JSON.parse(read(ROOT, "tools/ref-bigrams.json")));
const palette = JSON.parse(read(ROOT, "tools/palette.json"));

function elementsWith(html, attr) {
  return [...html.matchAll(new RegExp(`<(a|span|div|button)\\b[^>]*\\s${attr}(?=[\\s>])[^>]*>`, "g"))].map((m) => ({ tag: m[1], open: m[0] }));
}
const attrOf = (open, name) => (open.match(new RegExp(`\\s${name}="([^"]*)"`)) ?? [])[1];
const hasAttr = (open, name) => new RegExp(`\\s${name}(=|\\s|>)`).test(open);

function gatesFor(dir, reg) {
  const r = reg.records;
  const html = read(dir, "index.html");
  const css = read(dir, "assets/styles.css");
  const tokensCss = read(dir, "assets/tokens.css");
  const jsFiles = fs.readdirSync(path.join(dir, "assets")).filter((f) => f.endsWith(".js"));
  const js = jsFiles.map((f) => read(dir, "assets", f)).join("\n");
  const favicon = read(dir, "favicon.svg");
  const headers = read(dir, "_headers");
  const textFiles = walk(dir).filter((f) => TEXT.test(f));
  const G = {};
  const gate = (name, fn) => { G[name] = fn; };

  gate("register-valid", () => {
    const e = validateRegister(reg);
    return { ok: !e.length, detail: e.join("; ") };
  });
  gate("register-embedded-matches", () => {
    const m = html.match(/<script type="application\/json" id="register">([\s\S]*?)<\/script>/);
    const emb = m ? JSON.parse(m[1]) : null;
    return { ok: !!emb && JSON.stringify(emb) === JSON.stringify(reg) && !validateRegister(emb).length, detail: "embedded register differs or invalid" };
  });
  gate("inert-records-null", () => {
    const bad = Object.entries(r).filter(([, v]) => v.state !== "stated" && (v.value !== null || v.url !== null)).map(([k]) => k);
    return { ok: !bad.length, detail: bad.join(",") };
  });
  gate("link-rule", () => {
    const bad = [];
    for (const id of ["x", "github"]) {
      const els = elementsWith(html, `data-record="${id}"`);
      if (!els.length) { bad.push(`${id}: missing`); continue; }
      for (const el of els) {
        if (r[id].state === "stated") { if (el.tag !== "a" || attrOf(el.open, "href") !== r[id].url) bad.push(`${id}: href mismatch`); }
        else if (hasAttr(el.open, "href") || el.tag === "a" || attrOf(el.open, "aria-disabled") !== "true") bad.push(`${id}: inert element is live`);
      }
    }
    return { ok: !bad.length, detail: bad.join("; ") };
  });
  gate("external-urls-stated-only", () => {
    const allowed = new Set(Object.values(r).filter((v) => v.state === "stated" && v.url).map((v) => v.url));
    const found = [...html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, "").matchAll(/\b(?:href|src)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    const bad = found.filter((u) => !allowed.has(u));
    return { ok: !bad.length, detail: bad.join(", ") };
  });
  gate("handle-derived-from-url", () => {
    const hits = (html.match(/@[A-Za-z0-9_-]+/g) ?? []);
    const wants = ["x", "github"].filter((k) => r[k].state === "stated").map((k) => handleOf(r[k].url));
    const bad = hits.filter((h) => !wants.includes(h));
    const present = wants.every((w) => hits.includes(w));
    return { ok: !bad.length && present, detail: `unexpected ${bad.join(",")} present=${present}` };
  });
  gate("address-scanner-registry-only", () => {
    const allowed = new Set(Object.values(r).filter((v) => v.state === "stated" && v.value).map((v) => v.value));
    const bad = [];
    for (const f of textFiles) {
      const t = fs.readFileSync(f, "utf8");
      for (const m of [...t.matchAll(B58), ...t.matchAll(EVM)]) if (!allowed.has(m[0])) bad.push(`${path.basename(f)}:${m[0].slice(0, 12)}`);
    }
    return { ok: !bad.length, detail: bad.join(", ") };
  });
  gate("ca-slot-branch", () => {
    const slot = html.match(/<div class="ca"[^>]*data-record="ca"[^>]*>[\s\S]*?<\/button><\/div><\/div>/);
    if (!slot) return { ok: false, detail: "slot missing" };
    const s = slot[0];
    const state = attrOf(s, "data-state");
    const btn = s.match(/<button[^>]*>/)[0];
    if (state !== r.ca.state) return { ok: false, detail: "state attr differs from record" };
    if (r.ca.state === "stated") {
      const val = (s.match(/<code class="ca-value" data-ca-value>([^<]*)<\/code>/) ?? [])[1];
      return { ok: val === r.ca.value && !hasAttr(btn, "disabled") && /data-ca-click/.test(s), detail: "stated slot not live" };
    }
    return { ok: hasAttr(btn, "disabled") && !new RegExp(B58.source).test(s) && !/data-ca-click/.test(s), detail: "absent slot not inert" };
  });
  gate("ca-slot-top-and-sticky", () => {
    const iTop = html.indexOf('class="topbar"'), iCa = html.indexOf('class="ca"'), iMain = html.indexOf("<main");
    return { ok: iTop > -1 && iCa > iTop && iCa < iMain && /\.topbar\s*{[^}]*position:\s*sticky/.test(css), detail: "slot not inside sticky topbar" };
  });
  gate("social-top-right-icon-only", () => {
    const m = html.match(/<div class="social"[^>]*>([\s\S]*?)<\/div>/);
    if (!m) return { ok: false, detail: "no social block" };
    const text = m[1].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim();
    const hdr = html.indexOf('class="header-inner"');
    const nav = html.indexOf('class="navigation"');
    const noHide = !/\.social[^{]*{[^}]*display:\s*none/.test(css);
    return { ok: (m[1].match(/<svg/g) ?? []).length === 2 && text === "" && html.indexOf('class="social"') > nav && nav > hdr && noHide, detail: "icons not two/icon-only/right" };
  });
  gate("official-icon-paths", () => {
    const x = "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231z";
    const g = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38";
    return { ok: html.includes(x) && html.includes(g), detail: "svg path mismatch" };
  });
  gate("palette-literals-in-tokens-only", () => {
    const bad = [];
    for (const f of textFiles) {
      if (path.basename(f) === "tokens.css" || path.basename(f) === "favicon.svg" || path.basename(f) === "register") continue;
      let t = fs.readFileSync(f, "utf8");
      if (f.endsWith("index.html")) t = t.replace(/\bhref="#[^"]*"/g, "").replace(/<meta name="theme-color"[^>]*>/, "");
      const hits = [...t.matchAll(HEX)].map((m) => m[0]).concat([...t.matchAll(/\b(?:rgba?|hsla?)\(/g)].map((m) => m[0]));
      if (hits.length) bad.push(`${path.basename(f)}:${hits.slice(0, 3)}`);
    }
    return { ok: !bad.length, detail: bad.join(" ") };
  });
  gate("palette-sampled-from-brand-pixels", () => {
    const tok = readTokens();
    const cache = {};
    const bad = [];
    const dist = {};
    for (const m of tokensCss.matchAll(/(--c-[a-z]+):\s*(#[0-9a-fA-F]{6})/g)) dist[m[1]] = m[2].toLowerCase();
    if (JSON.stringify(dist) !== JSON.stringify(tok) || Object.keys(dist).length !== palette.colours.length) bad.push("tokens.css differs from palette set");
    for (const c of palette.colours) {
      const png = (cache[c.file] ??= decodePng(fs.readFileSync(path.join(ROOT, c.file))));
      const [R, Gc, B, A] = png.px(c.x, c.y);
      const hex = "#" + [R, Gc, B].map((n) => n.toString(16).padStart(2, "0")).join("");
      if (hex !== c.hex || dist[c.token] !== hex || A !== 255) bad.push(`${c.token} ${c.hex} vs pixel ${hex}`);
    }
    return { ok: !bad.length, detail: bad.join("; ") };
  });
  gate("favicon-valid", () => {
    const tok = new Set(Object.values(readTokens()));
    const colours = [...favicon.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    const ok = /viewBox="0 0 32 32"/.test(favicon) && /width="32"/.test(favicon) && !favicon.includes("<!--") && !favicon.includes("--") &&
      colours.length >= 2 && colours.every((c) => tok.has(c)) && /<path[^>]* d="M[^"]{200,}"/.test(favicon);
    return { ok, detail: "favicon malformed, has comment/double hyphen, or off-palette" };
  });
  gate("no-ch-units", () => {
    const bad = [css, ...jsFiles.map((f) => read(dir, "assets", f)), html].filter((t) => /\b\d*\.?\d+ch\b/.test(t));
    return { ok: !bad.length, detail: "ch unit used" };
  });
  gate("reduced-motion-total", () => {
    const m = css.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*)}\s*$/);
    const ok = !!m && /animation:\s*none\s*!important/.test(m[1]) && /transition:\s*none\s*!important/.test(m[1]) && /reduced\s*=\s*\(\)\s*=>\s*mq\.matches/.test(js) &&
      /reduced\(\)/.test(js) && /\.layer\s*{\s*transform:\s*none/.test(m[1]);
    return { ok, detail: "reduce block incomplete or JS never consults it" };
  });
  gate("no-hardcoded-live-numbers", () => {
    const longNums = (js.match(/\b\d{7,}\b/g) ?? []);
    const htmlNoJson = html.replace(/<script[\s\S]*?<\/script>/g, "");
    const inHtml = htmlNoJson.match(/\b\d{1,3}(?:,\d{3}){2,}\b|\b\d{7,}\b/g) ?? [];
    return { ok: !longNums.length && !inHtml.length, detail: [...longNums, ...inHtml].join(",") };
  });
  gate("pollers-back-off", () => {
    const calls = [...js.matchAll(/poller\(\{ run:[^}]*\}\)/g)].map((m) => m[0]);
    const ok = calls.length === 2 && calls.every((c) => /interval:/.test(c) && /base:/.test(c) && /max:/.test(c) && /onFail:/.test(c)) && /2 \*\* \(fails - 1\)/.test(js) && /Math\.min\(max,/.test(js);
    return { ok, detail: `pollers=${calls.length}` };
  });
  gate("skeletons-and-error-dash", () => {
    const tiles = (html.match(/data-tile="/g) ?? []).length;
    const sk = (html.match(/data-skel/g) ?? []).length;
    const ok = tiles === 4 && sk === 4 && /class="skel/.test(html) && /aria-busy="true"/.test(html) && /DASH = "—"/.test(js) && /bad\(tiles\.block/.test(js) && /bad\(tiles\.pairs/.test(js) && /aria-live="polite"/.test(html);
    return { ok, detail: `tiles=${tiles} skel=${sk}` };
  });
  gate("data-sources-from-register", () => {
    const ok = /reg\.rpc\.url/.test(js) && /reg\.dex\.url/.test(js) && !/https?:\/\/(?!cdn\.dexscreener\.com)[a-z0-9.-]+\.[a-z]{2,}/i.test(js.replace(/\/\/ .*$/gm, "")) &&
      headers.includes(new URL(r.rpc.url).origin) && headers.includes(new URL(r.dex.url).origin);
    return { ok, detail: "source URL hardcoded in JS or missing from CSP" };
  });
  gate("tap-targets-declared-44", () => {
    const need = [".social-link", ".copy-addr", ".ca-btn"];
    const bad = need.filter((s) => {
      const b = css.match(new RegExp(`${s.replace(".", "\\.")}\\s*{([^}]*)}`));
      return !b || !(/(?:width:\s*44px|min-width:\s*44px)/.test(b[1]) && /(?:height:\s*44px|min-height:\s*44px)/.test(b[1]));
    });
    return { ok: !bad.length, detail: bad.join(",") };
  });
  gate("motion-features-present", () => {
    const ok = /springSamples/.test(js) && /\.animate\(/.test(js) && /data-depth/.test(html) && /id="progress"/.test(html) && /class="dot"/.test(html) && /data-spot/.test(html) && /id="toast"/.test(html) && /flash/.test(js) && /marquee/.test(js);
    return { ok, detail: "a premium feature is missing" };
  });
  gate("html-structure", () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
    const blank = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].filter((m) => !/rel="noopener noreferrer"/.test(m[0]));
    const ok = /<html lang="en"/.test(html) && (html.match(/<h1/g) ?? []).length === 1 && /<main id="main"/.test(html) && /class="skip-link"/.test(html) && !dup.length && !blank.length &&
      new RegExp(`<link rel="canonical" href="${r.domain.url}"`).test(html) && /<title>[^<]{3,}<\/title>/.test(html) && /name="description"/.test(html);
    return { ok, detail: `dup=${dup} blank=${blank.length}` };
  });
  gate("local-references-resolve", () => {
    const refs = [...html.matchAll(/\b(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith("./"));
    const mods = [...js.matchAll(/from "\.\/([^"]+)"/g)].map((m) => "assets/" + m[1]);
    const bad = [...refs, ...mods].filter((u) => !fs.existsSync(path.join(dir, u)));
    return { ok: !bad.length, detail: bad.join(",") };
  });
  gate("dist-contents-clean", () => {
    const files = walk(dir).map((f) => path.relative(dir, f).replace(/\\/g, "/"));
    const allowed = /^(index\.html|favicon\.svg|_headers|assets\/[a-z]+\.(css|js|png))$/;
    const bad = files.filter((f) => !allowed.test(f));
    const big = files.filter((f) => fs.statSync(path.join(dir, f)).size > 600_000);
    return { ok: !bad.length && !big.length, detail: [...bad, ...big].join(",") };
  });
  gate("js-parses", () => {
    const bad = jsFiles.filter((f) => {
      const t = path.join(TMP, "syntax-check.mjs");
      fs.mkdirSync(TMP, { recursive: true });
      fs.writeFileSync(t, read(dir, "assets", f));
      return spawnSync(process.execPath, ["--check", t]).status !== 0;
    });
    return { ok: !bad.length, detail: bad.join(",") };
  });
  gate("copy-shares-no-2grams-with-reference", () => {
    const own = [...segmentsOf(html), ...stringsOfJs(js)];
    const mine = bigramHashes(own);
    const shared = [...mine].filter((h) => refBigrams.has(h));
    let which = "";
    if (shared.length) {
      const set = new Set(shared);
      for (const seg of own) { const w = seg.match(/[a-z0-9']+/g) ?? []; for (let i = 0; i + 1 < w.length; i++) { const h = bigramHashes([w[i] + " " + w[i + 1]]); if ([...h].some((x) => set.has(x))) which += `[${w[i]} ${w[i + 1]}] `; } }
    }
    return { ok: !shared.length, detail: which };
  });
  return G;
}

/* repo-level gates (not per build) */
function repoGates() {
  const out = {};
  const frag = (...a) => a.join("");
  const bad = [new RegExp(frag("cla", "ude"), "i"), new RegExp(frag("anthro", "pic"), "i"), new RegExp(frag("co-", "authored"), "i"), new RegExp(frag("generated ", "with"), "i"), new RegExp(frag("chat", "gpt"), "i"), new RegExp(frag("open", "ai\\b"), "i"), new RegExp(frag("copi", "lot"), "i"), new RegExp(frag("AI-", "generated"), "i")];
  out["repo-hygiene"] = () => {
    const hits = [];
    const skip = ["node_modules", ".git", ".gate-tmp", "brand", "reference"];
    const all = walk(ROOT, skip);
    const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
    for (const f of all) if (new RegExp(frag("(^|/)(cla", "ude\\.md|\\.cla", "ude)(/|$)"), "i").test(rel(f))) hits.push("file " + rel(f));
    if (fs.existsSync(path.join(ROOT, frag(".cla", "ude"))) || fs.existsSync(path.join(ROOT, frag("CLA", "UDE.md")))) hits.push("assistant config at root");
    for (const f of all.filter((f) => TEXT.test(f) && !f.endsWith("ref-bigrams.json"))) {
      const t = fs.readFileSync(f, "utf8");
      for (const re of bad) if (re.test(t)) hits.push(`${rel(f)} ~ ${re.source.slice(0, 6)}`);
    }
    return { ok: !hits.length, detail: hits.join("; ") };
  };
  out["source-palette-literals"] = () => {
    const hits = [];
    for (const f of walk(SRC).filter((f) => TEXT.test(f) && !f.endsWith("tokens.css"))) {
      let t = fs.readFileSync(f, "utf8").replace(/\bhref="#[^"]*"/g, "");
      if (f.endsWith("favicon-grid.json")) continue;
      if ([...t.matchAll(HEX)].length || /\b(?:rgba?|hsla?)\(/.test(t)) hits.push(path.relative(ROOT, f));
    }
    const build = fs.readFileSync(path.join(ROOT, "tools/build.mjs"), "utf8");
    if (/#[0-9a-fA-F]{6}\b/.test(build.replace(/\(#\[0-9a-fA-F\]\{6\}\)/g, ""))) hits.push("tools/build.mjs");
    return { ok: !hits.length, detail: hits.join(",") };
  };
  return out;
}

/* ------------------------------------------------------------------ */
/* mutation harness: every anchor reads live state, none hardcodes it   */
/* ------------------------------------------------------------------ */
function mutations(reg) {
  const r = reg.records;
  const edit = (file, fn) => (dir) => { const p = path.join(dir, file); fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8"))); };
  const flipLink = (id) => edit("index.html", (h) => {
    const m = elementsWith(h, `data-record="${id}"`)[0];
    const flipped = hasAttr(m.open, "href") ? m.open.replace(/\shref="[^"]*"/, "") : m.open.replace(/^<(\w+)/, '<$1 href="https://example.invalid/x"');
    return h.replace(m.open, flipped);
  });
  return [
    { name: `link-rule bites on x (live state: ${r.x.state})`, gate: "link-rule", apply: flipLink("x") },
    { name: `link-rule bites on github (live state: ${r.github.state})`, gate: "link-rule", apply: flipLink("github") },
    { name: "address-scanner rejects a foreign address", gate: "address-scanner-registry-only", apply: edit("index.html", (h) => h.replace("</footer>", `<p>${randomAddress()}</p></footer>`)) },
    { name: "address-scanner rejects a foreign 0x address", gate: "address-scanner-registry-only", apply: edit("index.html", (h) => h.replace("</footer>", `<p>0x${crypto.randomBytes(20).toString("hex")}</p></footer>`)) },
    { name: "ca slot state must follow the record", gate: "ca-slot-branch", apply: edit("index.html", (h) => h.replace(/(<div class="ca"[^>]*data-state=")(\w+)(")/, (_, a, s, c) => a + (s === "stated" ? "absent" : "stated") + c)) },
    { name: "palette rejects a stray hex in css", gate: "palette-literals-in-tokens-only", apply: edit("assets/styles.css", (c) => c + "\n.x{color:#ff00aa}") },
    { name: "palette rejects a stray rgb() in js", gate: "palette-literals-in-tokens-only", apply: edit("assets/main.js", (c) => c + '\nconst z = "rgb(1,2,3)";') },
    { name: "tokens must match brand pixels", gate: "palette-sampled-from-brand-pixels", apply: edit("assets/tokens.css", (c) => c.replace(/(--c-cyan:\s*)#[0-9a-f]{6}/, "$1#01acfe")) },
    { name: "ch units rejected", gate: "no-ch-units", apply: edit("assets/styles.css", (c) => c + "\n.y{width:3ch}") },
    { name: "reduced-motion block required", gate: "reduced-motion-total", apply: edit("assets/styles.css", (c) => c.replace("prefers-reduced-motion: reduce", "prefers-reduced-motion: no-preference")) },
    { name: "hardcoded block height rejected", gate: "no-hardcoded-live-numbers", apply: edit("index.html", (h) => h.replace("block —", "block 454,853,214")) },
    { name: "backoff removal rejected", gate: "pollers-back-off", apply: edit("assets/core.js", (c) => c.replace("2 ** (fails - 1)", "1")) },
    { name: "skeleton removal rejected", gate: "skeletons-and-error-dash", apply: edit("index.html", (h) => h.replace(/<span class="skel" data-skel><\/span>/, "")) },
    { name: "inert record carrying a value rejected", gate: "register-embedded-matches", apply: edit("index.html", (h) => h.replace(/("state":"(?:absent|unconfirmed)","value":)null/, '$1"leak"')) },
    { name: "favicon double hyphen rejected", gate: "favicon-valid", apply: edit("favicon.svg", (s) => s.replace("<rect", "<!-- a -- b --><rect")) },
    { name: "reference sentence rejected (2-gram gate)", gate: "copy-shares-no-2grams-with-reference", apply: edit("index.html", (h) => h.replace("</footer>", "<p>Reverse engineer anything with your coding agent.</p></footer>")) },
    { name: "attribution text rejected", gate: "__repo__", skip: true, apply: () => {} },
    { name: "external link outside the register rejected", gate: "external-urls-stated-only", apply: edit("index.html", (h) => h.replace("</footer>", '<a href="https://example.invalid/">x</a></footer>')) },
    { name: "second icon removal rejected", gate: "social-top-right-icon-only", apply: edit("index.html", (h) => h.replace(/(<div class="social"[^>]*>[\s\S]*?)<svg[\s\S]*?<\/svg>/, "$1")) },
  ].filter((m) => !m.skip);
}

/* ------------------------------------------------------------------ */
function runSet(label, dir, reg, counters) {
  const G = gatesFor(dir, reg);
  let pass = 0;
  const fails = [];
  for (const [name, fn] of Object.entries(G)) {
    let res;
    try { res = fn(); } catch (e) { res = { ok: false, detail: "threw " + e.message }; }
    counters.total++;
    if (res.ok) { counters.pass++; pass++; } else { counters.fail++; fails.push(`${name}: ${res.detail}`); }
  }
  console.log(`  [${label}] ${pass}/${Object.keys(G).length} gates pass`);
  for (const f of fails) console.log("    FAIL " + f);
  return G;
}

function runMutations(label, dir, reg, counters) {
  let n = 0;
  for (const m of mutations(reg)) {
    const copy = path.join(TMP, "mut");
    fs.rmSync(copy, { recursive: true, force: true });
    fs.cpSync(dir, copy, { recursive: true });
    m.apply(copy);
    const G = gatesFor(copy, reg);
    let res;
    try { res = G[m.gate](); } catch { res = { ok: false }; }
    counters.total++;
    if (!res.ok) { counters.pass++; n++; } else { counters.fail++; console.log(`    FAIL mutation survived: ${m.name}`); }
  }
  console.log(`  [${label}] ${n} mutations killed`);
}

function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const counters = { total: 0, pass: 0, fail: 0 };

  console.log("repo gates");
  for (const [name, fn] of Object.entries(repoGates())) {
    const res = fn();
    counters.total++;
    if (res.ok) { counters.pass++; console.log(`  ok   ${name}`); } else { counters.fail++; console.log(`  FAIL ${name}: ${res.detail}`); }
  }

  const here = Object.fromEntries(Object.entries(registerSrc.records).map(([k, v]) => [k, v.state]));
  console.log(`\nbranch A: dist/ as built (x=${here.x} github=${here.github} ca=${here.ca})`);
  runSet("dist", DIST, registerSrc, counters);
  runMutations("dist", DIST, registerSrc, counters);

  const flipped = flipRegister(registerSrc);
  const flipDir = path.join(TMP, "flip");
  build({ register: flipped, outDir: flipDir });
  const fl = Object.fromEntries(Object.entries(flipped.records).map(([k, v]) => [k, v.state]));
  console.log(`\nbranch B: opposite register (x=${fl.x} github=${fl.github} ca=${fl.ca})`);
  runSet("flip", flipDir, flipped, counters);
  runMutations("flip", flipDir, flipped, counters);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nTOTAL ${counters.total} gates: ${counters.pass} passed, ${counters.fail} failed`);
  process.exit(counters.fail ? 1 : 0);
}
main();
