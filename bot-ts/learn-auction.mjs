import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().includes('baiakidle.com/jogar')) || pages.find((p) => p.url().includes('baiakidle.com'));
const shell = async (exp) => await page.evaluate(`(${exp})()`).catch((e) => 'ERR: ' + e.message);
const r = await shell(`async () => {
  const vis = (el) => !!(el && !el.disabled && ((el.offsetParent !== null) || (getComputedStyle(el).position === 'fixed' && el.getClientRects().length > 0)));
  const txt = (el) => (el?.textContent || '').replace(/\\s+/g,' ').trim();
  const toasts = Array.from(document.querySelectorAll('.store-msg, .mk-msg, [class*=toast], [class*=notif]')).filter(vis).map((e)=>txt(e).slice(0,90));
  const ov = document.querySelector('.mk-modal-overlay');
  const ovBtns = Array.from(document.querySelectorAll('.mk-modal-overlay button, .mk-modal-box button')).filter((b)=>vis(b)&&txt(b)).map((b)=>txt(b).slice(0,24));
  let mine = 'nao-conseguiu';
  try {
    const resp = await fetch('https://baiakidle.com/api/trpc/auction.mine?batch=1&input=%7B%7D', { headers: { authorization: localStorage.getItem('token') ? 'Bearer ' + localStorage.getItem('token') : '' } });
    const j = await resp.json(); const d = j?.[0]?.result?.data;
    const arr = Array.isArray(d)?d:(d?.items||[]);
    mine = arr.slice(0,6).map((x)=>({ id:x.id, status:x.status, gold:x.goldAmount, price:x.priceCoins, ends:x.endsAt }));
  } catch(e){ mine = 'err: '+e.message; }
  return JSON.stringify({ overlayAberto: !!ov, botoes: ovBtns, toasts, mine });
}`);
console.log(r);
await browser.disconnect();
