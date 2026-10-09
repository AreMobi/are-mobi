import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const X_PATH = "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";
const GH_PATH = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z";
const XSVG = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${X_PATH}"/></svg>`;
const GHSVG = `<svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="${GH_PATH}"/></svg>`;

/** link rule: store the URL, derive the handle */
export const handleOf = (url) => "@" + new URL(url).pathname.split("/").filter(Boolean)[0];

export function readTokens() {
  const css = fs.readFileSync(path.join(SRC, "tokens.css"), "utf8");
  const t = {};
  for (const m of css.matchAll(/(--c-[a-z]+):\s*(#[0-9a-fA-F]{6})/g)) t[m[1]] = m[2].toLowerCase();
  return t;
}

export function validateRegister(reg) {
  const errs = [];
  for (const [id, r] of Object.entries(reg.records)) {
    if (!["stated", "absent", "unconfirmed"].includes(r.state)) errs.push(`${id}: bad state ${r.state}`);
    if (r.state !== "stated" && (r.value !== null || r.url !== null)) errs.push(`${id}: inert record carries value or url`);
    if (r.state === "stated" && r.value == null && r.url == null) errs.push(`${id}: stated record has neither value nor url`);
  }
  return errs;
}

function socialHtml(r) {
  const one = (id, label, svg, rec) =>
    rec.state === "stated"
      ? `<a class="social-link" data-record="${id}" data-spot href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${label}: ${esc(handleOf(rec.url))}" title="${label} ${esc(handleOf(rec.url))}">${svg}</a>`
      : `<span class="social-link" data-record="${id}" role="link" aria-disabled="true" aria-label="${label}, not announced yet" title="${label}, not announced yet">${svg}</span>`;
  return one("x", "X", XSVG, r.x) + one("github", "GitHub", GHSVG, r.github);
}

function caHtml(rec) {
  if (rec.state === "stated") {
    return `<div class="ca" data-record="ca" data-state="stated"><div class="container ca-inner" data-ca-click><span class="ca-label">Contract address</span><code class="ca-value" data-ca-value>${esc(rec.value)}</code><button class="ca-btn" data-spot data-copy-ca type="button" aria-label="Copy contract address">Copy</button></div></div>`;
  }
  return `<div class="ca" data-record="ca" data-state="${rec.state}"><div class="container ca-inner"><span class="ca-label">Contract address</span><p class="ca-value" data-ca-value style="margin:0">Not announced yet. This slot unlocks the instant the team names one.</p><button class="ca-btn" data-copy-ca type="button" disabled aria-disabled="true" aria-label="Copy contract address, unavailable">Copy</button></div></div>`;
}

function faqCa(r) {
  return r.ca.state === "stated"
    ? `<p>Yes. The complete address occupies the bar pinned above; a press copies it. Verify it versus the team’s post on X${r.x.state === "stated" ? ` (${esc(handleOf(r.x.url))})` : ""} before sending funds anywhere.</p>`
    : `<p>Not yet. The pinned bar stays locked until the team states one; nothing here is guessed or scraped from search results. Treat any address found elsewhere as unverified.</p>`;
}

function footerLinks(r) {
  const x = r.x.state === "stated"
    ? `<a href="${esc(r.x.url)}" target="_blank" rel="noopener noreferrer">X ${esc(handleOf(r.x.url))}</a>`
    : `<span aria-disabled="true">X, not announced yet</span>`;
  const g = r.github.state === "stated"
    ? `<a href="${esc(r.github.url)}" target="_blank" rel="noopener noreferrer">GitHub</a>`
    : `<span aria-disabled="true">GitHub, not announced yet</span>`;
  return x + g;
}

function faviconSvg(tokens) {
  const g = JSON.parse(fs.readFileSync(path.join(SRC, "assets/favicon-grid.json"), "utf8"));
  const s = 26 / g.cols, ox = 3, oy = (32 - g.rows * s) / 2;
  const f = (n) => +n.toFixed(3);
  const d = g.rects.map(([x, y, w, h]) => `M${f(ox + x * s)} ${f(oy + y * s)}h${f(w * s)}v${f(h * s)}h${f(-w * s)}z`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${tokens["--c-ink"]}"/><path fill="${tokens["--c-cyan"]}" d="${d}"/></svg>\n`;
}

export function build({ register, outDir }) {
  const reg = register ?? JSON.parse(fs.readFileSync(path.join(SRC, "register.json"), "utf8"));
  const errs = validateRegister(reg);
  if (errs.length) throw new Error("register invalid: " + errs.join("; "));
  const r = reg.records;
  const tokens = readTokens();
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });

  let html = fs.readFileSync(path.join(SRC, "index.template.html"), "utf8");
  const sub = {
    theme_color: tokens["--c-ink"],
    canonical: r.domain.url,
    register_json: JSON.stringify(reg).replace(/</g, "\\u003c"),
    social: socialHtml(r),
    ca_slot: caHtml(r.ca),
    faq_ca: faqCa(r),
    footer_links: footerLinks(r),
    domain: esc(r.domain.value),
  };
  html = html.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in sub)) throw new Error("unfilled placeholder " + k);
    return sub[k];
  });
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  fs.writeFileSync(path.join(outDir, "favicon.svg"), faviconSvg(tokens));

  for (const f of ["tokens.css", "styles.css"]) fs.copyFileSync(path.join(SRC, f), path.join(outDir, "assets", f));
  for (const f of fs.readdirSync(path.join(SRC, "js"))) fs.copyFileSync(path.join(SRC, "js", f), path.join(outDir, "assets", f));
  for (const f of ["logo.png", "og.png"]) fs.copyFileSync(path.join(SRC, "assets", f), path.join(outDir, "assets", f));

  const origin = (u) => new URL(u).origin;
  fs.writeFileSync(path.join(outDir, "_headers"),
`/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdn.dexscreener.com data:; connect-src ${origin(r.rpc.url)} ${origin(r.dex.url)}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/assets/*
  Cache-Control: public, max-age=3600
`);
  return outDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build({ outDir: path.join(ROOT, "dist") });
  console.log("built dist/");
}
