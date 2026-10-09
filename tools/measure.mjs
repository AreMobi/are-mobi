// Dev-only: served by tools/serve.mjs at /__measure.mjs for breakpoint checks.
export default async function measure() {
  const fx = { pairs: [
    { chainId: 'solana', dexId: 'raydium', pairAddress: 'PAIRaaa1', baseToken: { address: 'jX6565vyY3WJAVmwsXFNMVaxM9vQaD9SvbRGsD3pooL', name: 'A Rather Long Token Name Indeed', symbol: 'RARE' }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.000009509', priceChange: { h24: -18.49 }, volume: { h24: 734.77 }, info: { imageUrl: 'https://cdn.dexscreener.com/cms/images/sZvwHymwmabUMAw3?width=800&height=800&quality=95&format=auto' } },
    { chainId: 'solana', dexId: 'pumpswap', pairAddress: 'PAIRbbb2', baseToken: { address: 'J97QTGSBWPqZzaUyHaMVBLVKNn4RXse9kZgtycoVpump', name: 'Pokecraft', symbol: 'POKECRAFT' }, quoteToken: { symbol: 'SOL' }, priceUsd: null, priceChange: {}, volume: { h24: 0 } },
    { chainId: 'solana', dexId: 'orca', pairAddress: 'PAIRccc3', baseToken: { address: 'x', name: 'Big One', symbol: 'BIG' }, quoteToken: { symbol: 'USDC' }, priceUsd: '12.3456', priceChange: { h24: 5.2 }, volume: { h24: 2345678901 } }] };
  try { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); } catch {}
  if (!window.__fx) { window.__fx = 1; const of = window.fetch; window.fetch = (u, o) => String(u).includes('dexscreener') ? Promise.resolve(new Response(JSON.stringify(fx))) : of(u, o); const m = await import('/assets/feeds.js?m=1'); m.startFeeds(); }
  await new Promise(r => setTimeout(r, 1800));
  document.querySelectorAll('.rv').forEach(e => e.classList.add('is-in'));
  const vw = document.documentElement.clientWidth;
  const out = { vw, innerWidth, docScrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, overflowX: [], clipped: [], small: [] };
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  for (const e of document.body.querySelectorAll('*')) {
    if (!vis(e) || e.closest('svg') && e.tagName !== 'svg' || e.closest('.hero-art') || e.closest('.marquee') || e.closest('.skip-link')) continue;
    const r = e.getBoundingClientRect();
    if (r.right > vw + 0.5 || r.left < -0.5) out.overflowX.push(e.tagName + '.' + e.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    const cs = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && !['HTML', 'BODY'].includes(e.tagName) && cs.display !== 'inline' && !(cs.textOverflow === 'ellipsis')) out.clipped.push(e.tagName + '.' + e.className + ' sw' + e.scrollWidth + ' cw' + e.clientWidth);
  }
  for (const e of document.querySelectorAll('a[href], button, summary, [role=link]')) {
    if (!vis(e) || e.closest('.marquee') || e.matches('.skip-link')) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) out.small.push((e.className || e.tagName) + '[' + (e.textContent||'').trim().slice(0,12) + '] ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  const q = (s) => document.querySelector(s); const rc = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  out.social = rc('.social'); out.xlink = rc('[data-record=x]'); out.gh = rc('[data-record=github]'); out.ca = rc('.ca'); out.topbarH = q('.topbar').offsetHeight;
  out.caText = q('[data-ca-value]').textContent.slice(0, 60); out.caFontPx = getComputedStyle(q('[data-ca-value]')).fontSize;
  const cv = q('[data-ca-value]'); out.caLines = Math.round(cv.getBoundingClientRect().height / parseFloat(getComputedStyle(cv).lineHeight));
  out.rows = document.querySelectorAll('.pair[data-addr]').length;
  return JSON.stringify(out);
}
