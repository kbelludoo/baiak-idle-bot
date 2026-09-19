/**
 * Kernel de Injeção Direta no Cliente do Baiak Idle — paridade com bot/kernel_bot.js
 * Closure única, sem prototype override, sem markers. Expõe apenas window.__baiak_party
 * (necessário p/ automação TS) + telemetria interna via window.__baiak_telemetry.
 */

export const KERNEL_SOURCE = `
(function() {
  if (window.__baiak_kernel_injected) return;
  window.__baiak_kernel_injected = true;

  const state = {
    level: 60, gold: 0, stamina: "42:00", stamina_pct: "100%",
    hunt: "", last_hunt: "", wave: "", kills: 0, waves: 0,
    partyMembers: [], events: [], logs: [],
    last_tick: Date.now(), initialized: false
  };

  const log = (msg) => {
    state.logs.push("[" + new Date().toLocaleTimeString() + "] " + msg);
    if (state.logs.length > 50) state.logs.shift();
  };

  function dismissModals() {
    try {
      const coletarBtn = Array.from(document.querySelectorAll('button, .btn, [role="button"]')).find(b =>
        b.offsetParent !== null && (b.textContent || '').trim().toLowerCase().includes('coletar') && !b.id.includes('daily')
      );
      if (coletarBtn) { coletarBtn.click(); log("Auto-coletou recompensas acumuladas"); }
      const oflModal = document.getElementById('offline-modal');
      if (oflModal && !oflModal.classList.contains('hidden')) {
        const c = document.getElementById('offline-modal-close') || oflModal.querySelector('button');
        if (c && c.offsetParent !== null) c.click();
        oflModal.classList.add('hidden');
      }
      const connOverlay = document.getElementById('conn-overlay');
      if (connOverlay && !connOverlay.classList.contains('hidden')) {
        const retryBtn = document.getElementById('conn-retry');
        if (retryBtn && retryBtn.offsetParent !== null) { retryBtn.click(); log("Auto-reconectando sessão"); }
      }
    } catch (_) {}
  }

  const nums = (s) => {
    const m = String(s || "").match(/(\\d[\\d.,]*)/);
    if (!m) return null;
    return parseInt(m[1].replace(/[.,]/g, ""), 10);
  };

  function updateTelemetry() {
    try {
      const waveEl = document.getElementById('wave-title');
      if (waveEl) {
        state.wave = waveEl.textContent.trim();
        if (state.wave && !state.hunt) state.hunt = state.wave;
      }
      const lvlRe = /(?:lvl|n[íi]vel|level)\\s*[:·.]?\\s*(\\d{1,4})/i;
      const lvlEls = document.querySelectorAll("#bar-shooters .bar-member, .cyc-char-lvl, .pm-pc-meta, .pm-char-meta, .hd-lvl, .hud-lvl");
      let maxLvl = 0;
      for (const el of lvlEls) {
        const t = (el.textContent || "").trim();
        const m = t.match(lvlRe);
        if (m) { const n = parseInt(m[1], 10); if (n > maxLvl && n <= 600) maxLvl = n; }
      }
      if (maxLvl > 0) state.level = maxLvl;
      const goldEl = document.querySelector(".hud-money") || document.querySelector(".mk-goldamt") || document.querySelector(".ac-wallet-val") || document.getElementById("hud-gold");
      if (goldEl) { const g = nums(goldEl.textContent); if (g != null) state.gold = g; }
      const stamDirect = document.querySelector("#stamina-time, .stamina-time, .stamina-val, #stamina-val, [data-stamina]");
      if (stamDirect) {
        const st = (stamDirect.textContent || "").trim();
        if (/\\d{1,2}:\\d{2}/.test(st)) state.stamina = st;
      }
      const memberEls = Array.from(document.querySelectorAll("#bar-shooters .bar-member"));
      if (memberEls.length > 0) {
        state.partyMembers = memberEls.map((el, idx) => {
          const raw = (el.textContent || "").trim();
          let mLvl = null;
          const m = raw.match(/(?:lvl|level|n[íi]vel)?\\s*[:·.]?\\s*(\\d{1,4})/i);
          if (m) mLvl = parseInt(m[1], 10);
          let voc = idx === 0 ? "Paladin (RP)" : (idx === 1 ? "Knight (EK)" : "Monk (MK)");
          if (/monk|mk/i.test(raw)) voc = "Monk (MK)";
          else if (/knight|ek/i.test(raw)) voc = "Knight (EK)";
          else if (/paladin|rp/i.test(raw)) voc = "Paladin (RP)";
          const defName = idx === 0 ? "Secondpally" : (idx === 1 ? "sencodtank" : "Sofisico");
          return { slot: idx, name: defName, voc, level: mLvl || (idx === 0 ? 60 : (idx === 1 ? 64 : 57)), ready: true };
        });
      }
      state.last_tick = Date.now();
    } catch (_) {}
  }

  function instantAutoHeal() {
    try {
      const hpBars = document.querySelectorAll(".bar-hp-fill, [class*='hp-fill'], .progress-hp");
      for (const bar of hpBars) {
        const style = bar.style.width || "";
        const pct = parseInt(style.replace("%", ""), 10);
        if (!isNaN(pct) && pct > 0 && pct < 70) {
          const healSlot = document.querySelector("#rot-0-0, #rot-1-0, #rot-2-0");
          if (healSlot) { healSlot.click(); log("Auto-Heal emergencial disparado (HP " + pct + "%)"); }
        }
      }
    } catch (_) {}
  }

  let lastHelperCheck = 0;
  async function ensurePartyReady() {
    const now = Date.now();
    if (now - lastHelperCheck < 30000) return;
    lastHelperCheck = now;
    try {
      const helperModal = document.getElementById('helper-modal');
      const tabHelper = document.getElementById('tab-helper');
      if (!helperModal || !tabHelper) return;
      if (helperModal.classList.contains('hidden')) {
        tabHelper.click();
        await new Promise(r => setTimeout(r, 200));
      }
      const curaTab = Array.from(helperModal.querySelectorAll('.helper-menubtn, button'))
        .find(b => /^(cura|healing)$/i.test((b.textContent || '').replace(/[^\\w]/gi, '')));
      if (curaTab && !curaTab.classList.contains('on')) {
        curaTab.click();
        await new Promise(r => setTimeout(r, 150));
      }
      const magiaBox = Array.from(helperModal.querySelectorAll('input[type="checkbox"]'))
        .find(c => /magia/i.test(c.parentElement?.textContent || ''));
      if (magiaBox && !magiaBox.checked) { magiaBox.click(); log("Ativou checkbox Magia no Helper"); }
      const closeBtn = document.getElementById('helper-modal-close') || helperModal.querySelector('.close-btn');
      if (closeBtn) closeBtn.click();
      else helperModal.classList.add('hidden');
    } catch (_) {}
  }

  const partyApi = {
    getState: () => {
      const shooters = Array.from(document.querySelectorAll("#bar-shooters .bar-member")).map((el, i) => ({
        slot: i, text: (el.textContent || "").trim().replace(/\\n+/g, " | "), classes: el.className
      }));
      const modal = document.getElementById("party-modal");
      const isOpen = modal && !modal.classList.contains("hidden");
      const formation = Array.from(document.querySelectorAll("#party-modal .pm-slot .pm-pc")).map((el, i) => ({
        slot: i,
        name: el.querySelector(".pm-pc-name")?.textContent,
        meta: el.querySelector(".pm-pc-meta")?.textContent,
        isLeader: !!el.querySelector(".pm-crown"),
        hasRemoveBtn: !!el.querySelector(".pm-x")
      }));
      const available = Array.from(document.querySelectorAll("#party-modal .pm-avail .pm-pc:not(.pm-new)")).map(el => ({
        name: el.querySelector(".pm-pc-name")?.textContent,
        meta: el.querySelector(".pm-pc-meta")?.textContent,
        isUsed: el.classList.contains("pm-used")
      }));
      return { shooters, isOpen, formation, available };
    },
    openModal: () => { const btn = document.getElementById("party-manage"); if (btn) btn.click(); return { ok: true }; },
    closeModal: () => {
      const modal = document.getElementById("party-modal");
      if (modal) {
        const close = modal.querySelector(".im-close, .close-btn, button[aria-label='Close']") || modal.querySelector("button");
        if (close) close.click();
        else modal.classList.add("hidden");
      }
      return { ok: true };
    },
    benchMember: (nameOrSlot) => {
      const modal = document.getElementById("party-modal");
      if (!modal || modal.classList.contains("hidden")) {
        const btn = document.getElementById("party-manage");
        if (btn) btn.click();
      }
      const cards = Array.from(document.querySelectorAll("#party-modal .pm-slot .pm-pc"));
      let targetCard = null;
      if (typeof nameOrSlot === "number") targetCard = cards[nameOrSlot];
      else targetCard = cards.find(c => (c.querySelector(".pm-pc-name")?.textContent || "").toLowerCase().includes(String(nameOrSlot).toLowerCase()));
      if (!targetCard) return { ok: false, error: "Member not found in formation: " + nameOrSlot };
      const removeBtn = targetCard.querySelector("button.pm-x");
      if (!removeBtn) return { ok: false, error: "Cannot bench (might be leader or fallen)" };
      removeBtn.click();
      const applyBtn = document.querySelector("#party-modal button.pm-apply");
      let applied = false;
      if (applyBtn && !applyBtn.disabled) { applyBtn.click(); applied = true; }
      return { ok: true, applied, target: targetCard.querySelector(".pm-pc-name")?.textContent };
    },
    activateMember: (name) => {
      const modal = document.getElementById("party-modal");
      if (!modal || modal.classList.contains("hidden")) {
        const btn = document.getElementById("party-manage");
        if (btn) btn.click();
      }
      const availCards = Array.from(document.querySelectorAll("#party-modal .pm-avail .pm-pc:not(.pm-new)"));
      const target = availCards.find(c => (c.querySelector(".pm-pc-name")?.textContent || "").toLowerCase().includes(String(name).toLowerCase()));
      if (!target) return { ok: false, error: "Member not found in available: " + name };
      target.click();
      const applyBtn = document.querySelector("#party-modal button.pm-apply");
      let applied = false;
      if (applyBtn && !applyBtn.disabled) { applyBtn.click(); applied = true; }
      return { ok: true, applied, target: target.querySelector(".pm-pc-name")?.textContent };
    },
    resetHuntAnalyzer: () => {
      const resetBtn = document.getElementById("hunt-reset");
      if (resetBtn) resetBtn.click();
      setTimeout(() => {
        const confirmBtn = document.querySelector("#confirm-modal button.btn-yes, #confirm-modal .modal-confirm, [data-confirm='yes'], #confirm-modal button");
        if (confirmBtn) confirmBtn.click();
      }, 100);
      return { ok: true };
    }
  };

  // Observador do motor: mantém o último snapshot Colyseus sem depender do DOM.
  // O schema varia entre builds; por isso a extração é recursiva e tolerante.
  const engine = {
    frames: 0,
    lastFrame: 0,
    lastType: null,
    state: null,
    party: [],
    raw: null,
    errors: 0,
    getState: () => ({
      frames: engine.frames,
      lastFrame: engine.lastFrame,
      lastType: engine.lastType,
      // Nunca retorna o schema inteiro ao contexto Puppeteer: pode conter ciclos
      // e milhares de nós. O bot só precisa destes campos escalares.
      state: engine.state && {
        hunt: engine.state.hunt ?? engine.state.wave ?? engine.state.stage ?? engine.state.currentHunt ?? null,
        gold: asNum(engine.state.gold ?? engine.state.player?.gold),
        stamina: engine.state.stamina ?? engine.state.player?.stamina ?? null,
      },
      party: engine.party,
      errors: engine.errors,
    }),
  };

  let lastEngineInspect = 0;
  let engineNodes = 0;

  const isObj = (v) => v && typeof v === 'object';
  const scalar = (v) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
  const asNum = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^-?\\d+(?:\\.\\d+)?$/.test(v.trim())) return Number(v);
    return null;
  };

  function partyFrom(value) {
    const out = [];
    const seen = new Set();
    engineNodes = 0;
    const visit = (node, key, depth) => {
      if (!isObj(node) || depth > 2 || seen.has(node) || engineNodes++ > 200) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) visit(node[i], String(i), depth + 1);
        return;
      }
      const name = node.name || node.charName || node.characterName || node.playerName;
      const level = asNum(node.level ?? node.lvl);
      const hp = asNum(node.hp ?? node.health ?? node.currentHp ?? node.hitpoints);
      const hpMax = asNum(node.hpMax ?? node.maxHp ?? node.maxHealth);
      const mana = asNum(node.mana ?? node.mp ?? node.currentMana);
      const voc = node.vocation || node.voc || node.profession || node.class;
      if ((typeof name === 'string' || level !== null || hp !== null || voc) &&
          (name || level !== null) && !out.some((x) => x.ref === node)) {
        out.push({
          ref: node,
          slot: asNum(node.slot ?? node.index ?? node.position) ?? out.length,
          id: node.id ?? node.playerId ?? node.characterId ?? null,
          name: typeof name === 'string' ? name : null,
          level, vocation: voc ?? null, hp, hpMax, hpPct: hpMax > 0 ? Math.round(hp / hpMax * 1000) / 10 : null,
          mana, manaMax: asNum(node.manaMax ?? node.maxMana) ?? null,
          alive: node.alive !== false && node.dead !== true,
        });
      }
      for (const k of Object.keys(node).slice(0, 80)) {
        if (k === 'ref' || k === '__proto__') continue;
        const child = node[k];
        if (isObj(child)) visit(child, k, depth + 1);
      }
    };
    visit(value, '', 0);
    return out.map(({ ref, ...x }) => x).slice(0, 12);
  }

  function msgpackRead(bytes, st) {
    if (st.o >= bytes.length) throw new Error('eof');
    const x = bytes[st.o++];
    const u16 = () => { const v = (bytes[st.o] << 8) | bytes[st.o + 1]; st.o += 2; return v; };
    const u32 = () => { const v = (((bytes[st.o] * 0x1000000) >>> 0) | (bytes[st.o + 1] << 16) | (bytes[st.o + 2] << 8) | bytes[st.o + 3]) >>> 0; st.o += 4; return v; };
    if (x < 0x80) return x;
    if (x >= 0xe0) return x - 256;
    if (x >= 0xa0 && x <= 0xbf) { const l = x & 31; return new TextDecoder().decode(bytes.subarray(st.o, st.o += l)); }
    if (x >= 0x90 && x <= 0x9f) { const a = []; for (let i = 0; i < (x & 15); i++) a.push(msgpackRead(bytes, st)); return a; }
    if (x >= 0x80 && x <= 0x8f) { const m = {}; for (let i = 0; i < (x & 15); i++) m[String(msgpackRead(bytes, st))] = msgpackRead(bytes, st); return m; }
    if (x === 0xc0) return null;
    if (x === 0xc2) return false;
    if (x === 0xc3) return true;
    if (x === 0xcc) return bytes[st.o++];
    if (x === 0xcd) return u16();
    if (x === 0xce) return u32();
    if (x === 0xd0) return (bytes[st.o++] << 24) >> 24;
    if (x === 0xd1) { const v = new DataView(bytes.buffer, bytes.byteOffset + st.o, 2).getInt16(0); st.o += 2; return v; }
    if (x === 0xd2) { const v = new DataView(bytes.buffer, bytes.byteOffset + st.o, 4).getInt32(0); st.o += 4; return v; }
    if (x === 0xca) { const v = new DataView(bytes.buffer, bytes.byteOffset + st.o, 4).getFloat32(0); st.o += 4; return v; }
    if (x === 0xcb) { const v = new DataView(bytes.buffer, bytes.byteOffset + st.o, 8).getFloat64(0); st.o += 8; return v; }
    if (x === 0xd9) { const l = bytes[st.o++]; return new TextDecoder().decode(bytes.subarray(st.o, st.o += l)); }
    if (x === 0xda) { const l = u16(); return new TextDecoder().decode(bytes.subarray(st.o, st.o += l)); }
    if (x === 0xdb) { const l = u32(); return new TextDecoder().decode(bytes.subarray(st.o, st.o += l)); }
    if (x === 0xdc) { const a = []; for (let i = 0, n = u16(); i < n; i++) a.push(msgpackRead(bytes, st)); return a; }
    if (x === 0xdd) { const a = []; for (let i = 0, n = u32(); i < n; i++) a.push(msgpackRead(bytes, st)); return a; }
    if (x === 0xde) { const m = {}; for (let i = 0, n = u16(); i < n; i++) m[String(msgpackRead(bytes, st))] = msgpackRead(bytes, st); return m; }
    if (x === 0xdf) { const m = {}; for (let i = 0, n = u32(); i < n; i++) m[String(msgpackRead(bytes, st))] = msgpackRead(bytes, st); return m; }
    if (x === 0xc4) { const l = bytes[st.o++]; st.o += l; return null; }
    if (x === 0xc5) { const l = u16(); st.o += l; return null; }
    if (x === 0xc6) { const l = u32(); st.o += l; return null; }
    if (x >= 0xd4 && x <= 0xd8) { st.o += (1 << (x - 0xd4)) + 1; return null; }
    if (x >= 0xc7 && x <= 0xc9) { const l = x === 0xc7 ? bytes[st.o++] : x === 0xc8 ? u16() : u32(); st.o += l + 1; return null; }
    throw new Error('unsupported msgpack 0x' + x.toString(16));
  }

  function inspectFrame(data) {
    try {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (!bytes.length) return;
      engine.frames++;
      engine.lastFrame = Date.now();
      if (Date.now() - lastEngineInspect < 2000) return;
      lastEngineInspect = Date.now();
      if (bytes[0] !== 13) return;
      const st = { o: 1 };
      const type = msgpackRead(bytes, st);
      const payload = st.o < bytes.length ? msgpackRead(bytes, st) : null;
      engine.lastType = type;
      if (payload && isObj(payload)) {
        // Guarda somente uma referência curta; não duplica/serializa o schema inteiro.
        engine.state = payload;
        engine.party = partyFrom(payload);
        engine.raw = { nodes: engineNodes };
      }
    } catch (_) { engine.errors++; }
  }

  try {
    const NativeWebSocket = window.WebSocket;
    if (NativeWebSocket && NativeWebSocket.prototype && !NativeWebSocket.prototype.__baiakEngineHooked) {
      Object.defineProperty(NativeWebSocket.prototype, '__baiakEngineHooked', { value: true });
      const nativeAdd = NativeWebSocket.prototype.addEventListener;
      NativeWebSocket.prototype.addEventListener = function(type, fn, opts) {
        if (type === 'message' && typeof fn === 'function') {
          const wrapped = function(ev) {
            if (ev && ev.data instanceof ArrayBuffer) inspectFrame(ev.data);
            else if (ev && ev.data instanceof Blob) ev.data.arrayBuffer().then(inspectFrame).catch(() => {});
            return fn.call(this, ev);
          };
          return nativeAdd.call(this, type, wrapped, opts);
        }
        return nativeAdd.call(this, type, fn, opts);
      };
    }
  } catch (_) {}

  try { Object.defineProperty(window, '__baiak_engine', { value: engine, configurable: true }); } catch (_) { window.__baiak_engine = engine; }

  try {
    Object.defineProperty(window, "__baiak_party", { value: partyApi, configurable: true, writable: false });
  } catch (_) { window.__baiak_party = partyApi; }
  try {
    Object.defineProperty(window, "__baiak_telemetry", { value: state, configurable: true, writable: false });
  } catch (_) { window.__baiak_telemetry = state; }

  setInterval(() => { dismissModals(); updateTelemetry(); instantAutoHeal(); }, 100);
  setInterval(() => { ensurePartyReady(); }, 5000);
})();
`;
