import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().includes('baiakidle.com/jogar')) || pages.find((p) => p.url().includes('baiakidle.com'));
if (!page) { console.log('BRID no jogar'); process.exit(1); }
const shell = async (exp) => await page.evaluate(`(${exp})()`).catch((e) => 'ERR: ' + e.message);
// Navegar até o lote #374731 e abrir o form de lance
const r = await shell(`async () => {
  const vis = (el) => !!el && !el.disabled && (el.offsetParent !== null || (getComputedStyle(el).position === 'fixed' && el.getClientRects().length > 0));
  const txt = (el) => (el?.textContent || '').replace(/\\s+/g,' ').trim();
  const out = {};
  const tab = document.querySelector('[data-tab="auction"], #tab-auction, .tab-item') ;
  // abre aba leilao
  document.querySelectorAll('[class*=tab]').forEach((el)=>{ if(/leil|auction|mercado/i.test(txt(el))) { el.click() } });
  await new Promise(r=>setTimeout(r,600));
  const bodyTxt = document.body.innerText.slice(0,200);
  out.top = bodyTxt.replace(/\\n+/g,' | ');
  return JSON.stringify(out);
}`);
console.log('TAB:', r);
await browser.disconnect();
