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
      const rwModal = document.getElementById('reward-modal') || document.querySelector('.reward-modal, .collect-modal');
      if (rwModal && !rwModal.classList.contains('hidden')) {
        const btn = rwModal.querySelector('button');
        if (btn) btn.click();
      }
    } catch (_) {}
  }

  const parseGoldK = (s) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (!t) return null;
    const m = t.match(/([\d.,]+)\s*(kk|milh(?:oes|oes|ao)?|mi\b|m\b|mil\b|k\b)?/i);
    if (!m) return null;
    const raw = m[1]; const unit = (m[2] || "").toLowerCase();
    const hasDot = raw.includes("."), hasComma = raw.includes(",");
    let num;
    if (hasDot && hasComma) num = parseFloat(raw.replace(/\./g, "").replace(",", "."));
    else if (hasComma && !hasDot) num = parseFloat(raw.replace(",", "."));
    else if (hasDot && !hasComma) num = unit ? parseFloat(raw) : parseInt(raw.replace(/\./g, ""), 10);
    else num = parseInt(raw, 10);
    if (!Number.isFinite(num)) return null;
    if (unit === "kk" || unit === "m" || (unit && unit.startsWith("milh")) || unit === "mi") num *= 1000000;
    else if (unit === "k" || unit === "mil") num *= 1000;
    return Math.round(num);
  };
  const normStamK = (s) => {
    const t = String(s || "").trim();
    if (!t) return null;
    const pct = t.match(/(\d{1,3})\s*%/);
    if (pct) return pct[1] + "%";
    const c = t.match(/(\d{1,2})\s*:\s*(\d{2})/);
    if (c) {
      const h = parseInt(c[1], 10), mi = parseInt(c[2], 10);
      if (h === 42 && mi === 0) return null;
      if (h <= 42 && mi <= 59) return h + ":" + String(mi).padStart(2, "0");
    }
    const mH = t.match(/(\d{1,2})\s*h/i); const mM = t.match(/(\d{1,3})\s*m/i);
    if (mH || mM) {
      const h = mH ? parseInt(mH[1], 10) : 0; const mi = mM ? parseInt(mM[1], 10) : 0;
      if (h === 42 && mi === 0) return null;
      if (h <= 42 && mi <= 59) return h + ":" + String(mi).padStart(2, "0");
    }
    return null;
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
        if (m) { const n = parseInt(m[1], 10); if (n > maxLvl && n <= 800) maxLvl = n; }
      }
      if (maxLvl > 0) state.level = maxLvl;
      const goldEl = document.querySelector(".hud-money") || document.querySelector(".mk-goldamt") || document.querySelector(".ac-wallet-val") || document.getElementById("hud-gold") || document.getElementById("gold-count") || document.querySelector("[data-gold]");
      if (goldEl) {
        const g = parseGoldK(goldEl.getAttribute("data-gold") || goldEl.textContent);
        if (g != null && g > 0) state.gold = g;
      }
      if (!state.gold) {
        try {
          const generic = document.querySelectorAll("[class*='gold' i], [id*='gold' i], [class*='wallet' i], [class*='coin' i]");
          for (const ge of Array.from(generic).slice(0, 10)) {
            if (ge.closest && ge.closest("#picker-modal, #confirm-modal")) continue;
            const g2 = parseGoldK((ge.textContent || "").slice(0, 40));
            if (g2 != null && g2 > 0) { state.gold = g2; break; }
          }
        } catch (_) {}
      }
      const stamDirect = document.querySelector("#stamina-time, .stamina-time, .stamina-val, #stamina-val, [data-stamina], #stamina-panel, .hud-stamina");
      if (stamDirect) {
        const st = normStamK(stamDirect.textContent || stamDirect.getAttribute("title") || "");
        if (st) state.stamina = st;
      }
      if (!normStamK(state.stamina)) {
        const pctEl = document.getElementById("stamina-pct");
        const pct = normStamK(pctEl?.textContent || "");
        if (pct) state.stamina = pct;
      }
      if (!normStamK(state.stamina)) {
        try {
          const genericS = document.querySelectorAll("[class*='stamina' i], [id*='stamina' i]");
          for (const se of Array.from(genericS).slice(0, 10)) {
            const cand = normStamK(se.textContent || se.getAttribute("title") || "");
            if (cand) { state.stamina = cand; break; }
          }
        } catch (_) {}
      }
      let memberEls = Array.from(document.querySelectorAll("#bar-shooters .bar-member"));
      if (memberEls.length === 0) {
        memberEls = Array.from(document.querySelectorAll(".bs-party-name, .party-member, [class*='bar-member']")).slice(0, 12);
      }
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
      // Via número real quando o overlay battery-save expõe cur/max (NWe).
      // CSS width% é fallback — nunca a única fonte.
      const hpTexts = document.querySelectorAll(".bs-party-hp");
      for (const el of hpTexts) {
        const t = (el.textContent || "").replace(/\\s+/g, "");
        const m = t.match(/([\\d.,]+)\\/([\\d.,]+)/);
        if (m) {
          const cur = parseFloat(m[1].replace(/\\./g, "").replace(",", "."));
          const max = parseFloat(m[2].replace(/\\./g, "").replace(",", "."));
          if (Number.isFinite(cur) && Number.isFinite(max) && max > 0 && (cur / max) * 100 < 70) {
            const healSlot = document.querySelector("#rot-0-0, #rot-1-0, #rot-2-0");
            if (healSlot) { healSlot.click(); log("Auto-Heal emergencial (HP " + Math.round(cur / max * 100) + "% via numero)"); }
            return;
          }
        }
      }
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
    if (window.__baiak_helper_configured) return;
    const now = Date.now();
    if (now - lastHelperCheck < 60000) return;
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
      if (magiaBox) {
        if (!magiaBox.checked) { magiaBox.click(); log("Ativou checkbox Magia no Helper"); }
        window.__baiak_helper_configured = true;
      }
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
    stateDefense: null,
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
        defense: engine.stateDefense ?? engine.state.player?.defense,
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
        // Extrai defesa/armor do player se disponível no payload
        const def = payload.defense !== undefined ? payload.defense :
                    payload.armor !== undefined ? payload.armor :
                    payload.playerDefense !== undefined ? payload.playerDefense :
                    null;
        if (def !== null) engine.stateDefense = def;
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

  setInterval(() => { dismissModals(); updateTelemetry(); instantAutoHeal(); }, 1000);
  setInterval(() => { ensurePartyReady(); }, 15000);
})();

// ============================================================================
// ROOM DIRECT HOOK — send("stage"/"helper"/...) de 1 pacote + espelho de estado.
// O bundle nunca expõe o l (Room hunt) para fora do closure, então este hook
// captura o transporte: todo WebSocket do jogo é rastreado e o envio usa o
// frame Colyseus real [0x0D][msgpack(type)][msgpack(payload)] — byte-idêntico
// ao que o botão .stage-go produz via l.send("stage",{huntId}).
// Expõe: window.__room.send, window.__baiak_send, window.__baiak_state,
// window.__baiak_events (+drain), window.__baiak_queue.
// ============================================================================
(function() {
  if (window.__baiak_send) return;
  var sockets = new Set();
  var events = [];
  var MAX_EVENTS = 300;
  var state = {
    frames: 0, roomData: 0, roomState: 0, lastFrame: 0, lastType: null,
    huntId: null, hunt: null, wave: null, inCity: null, dead: false,
    lootGold: 0, lootElapsedMs: 0, rawXp: null, exercise: false,
    players: [], party: [], hpPct: null, manaPct: null,
    queue: { pos: null, admitToken: null },
    joined: null, toHunt: null, toCity: false, takeover: false, serverdrop: null,
    deaths: [], dailystatus: null, event: null, eventmeta: null,
    reconnectOk: false, resume: null, ready: false,
    lastUpdate: 0,
  };

  function pushEvent(type, payload, dir) {
    try {
      events.push({ t: Date.now(), dir: dir || 'IN', type: String(type), payload: payload });
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    } catch (_) {}
  }

  // --- msgpack encode (outbound), paridade com baiak-mitm buildDataFrame ---
  function mpEncode(v, out) {
    if (v === null || v === undefined) { out.push(0xc0); return; }
    if (v === true) { out.push(0xc3); return; }
    if (v === false) { out.push(0xc2); return; }
    if (typeof v === 'number') {
      if (Number.isInteger(v)) {
        if (v >= 0) {
          if (v < 128) { out.push(v); return; }
          if (v < 256) { out.push(0xcc, v); return; }
          if (v < 65536) { out.push(0xcd, (v >>> 8) & 255, v & 255); return; }
          if (v < 4294967296) { out.push(0xce, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return; }
          var hi = Math.floor(v / 4294967296), lo = v % 4294967296;
          out.push(0xcf, (hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
            (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
          return;
        }
        if (v >= -32) { out.push(256 + v); return; }
        if (v >= -128) { out.push(0xd0, v & 255); return; }
        if (v >= -32768) { out.push(0xd1, (v >> 8) & 255, v & 255); return; }
        out.push(0xd2, (v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
        return;
      }
      out.push(0xcb);
      var b = new ArrayBuffer(8);
      new DataView(b).setFloat64(0, v, false);
      var u = new Uint8Array(b);
      for (var i = 0; i < 8; i++) out.push(u[i]);
      return;
    }
    if (typeof v === 'string') {
      var e = new TextEncoder().encode(v), l = e.length;
      if (l < 32) out.push(0xa0 | l);
      else if (l < 256) out.push(0xd9, l);
      else if (l < 65536) out.push(0xda, (l >> 8) & 255, l & 255);
      else out.push(0xdb, (l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255);
      for (var j = 0; j < l; j++) out.push(e[j]);
      return;
    }
    if (Array.isArray(v)) {
      var n = v.length;
      if (n < 16) out.push(0x90 | n);
      else if (n < 65536) out.push(0xdc, (n >> 8) & 255, n & 255);
      else out.push(0xdd, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      for (var k = 0; k < n; k++) mpEncode(v[k], out);
      return;
    }
    if (typeof v === 'object') {
      var keys = Object.keys(v), m = keys.length;
      if (m < 16) out.push(0x80 | m);
      else if (m < 65536) out.push(0xde, (m >> 8) & 255, m & 255);
      else out.push(0xdf, (m >>> 24) & 255, (m >>> 16) & 255, (m >>> 8) & 255, m & 255);
      for (var q = 0; q < m; q++) { mpEncode(keys[q], out); mpEncode(v[keys[q]], out); }
      return;
    }
    out.push(0xc0);
  }

  function buildFrame(type, payload) {
    var out = [0x0d];
    mpEncode(type, out);
    mpEncode(payload === undefined ? null : payload, out);
    return new Uint8Array(out);
  }

  // --- espelho de estado a partir de ROOM_DATA (tipos conhecidos do bundle) ---
  function ingest(type, payload) {
    state.frames++;
    state.lastFrame = Date.now();
    state.lastType = type;
    state.lastUpdate = Date.now();
    pushEvent(type, payload, 'IN');
    try {
      if (type === 'joined' && payload && typeof payload === 'object') {
        state.joined = payload;
        if (typeof payload.huntId === 'string') { state.huntId = payload.huntId; state.hunt = payload.huntId; }
        if (payload.wave !== undefined) state.wave = payload.wave;
      } else if (type === 'pos') {
        state.queue.pos = (payload && payload.position !== undefined) ? payload.position : payload;
      } else if (type === 'go' && payload && typeof payload === 'object') {
        state.queue.admitToken = payload.token || null;
      } else if (type === 'toHunt') {
        state.toHunt = payload;
        state.toCity = false;
        if (payload && typeof payload === 'object' && payload.huntId) { state.huntId = payload.huntId; state.hunt = payload.huntId; }
        else if (typeof payload === 'string') { state.huntId = payload; state.hunt = payload; }
      } else if (type === 'toCity') {
        state.toCity = true;
      } else if (type === 'takeover') {
        state.takeover = true;
      } else if (type === 'serverdrop') {
        state.serverdrop = payload;
      } else if (type === 'resume') {
        state.resume = payload;
      } else if (type === 'reconnectOk') {
        state.reconnectOk = true;
      } else if (type === 'deaths') {
        state.deaths = (payload && payload.rows) || payload || [];
      } else if (type === 'dailystatus') {
        state.dailystatus = payload;
      } else if (type === 'event') {
        state.event = payload;
      } else if (type === 'eventmeta') {
        state.eventmeta = payload;
      } else if (type === 'party' || type === 'partystate' || type === 'partyApplied' || type === 'partyhunt') {
        state.party = payload;
        var plist = payload && (payload.players || payload.members || payload.party);
        if (Array.isArray(plist)) state.players = plist.slice(0, 12);
      } else if (type === 'mine' && payload && typeof payload === 'object') {
        if (typeof payload.gold === 'number') state.lootGold = payload.gold;
      }
    } catch (_) {}
  }

  function toU8(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return new Uint8Array(data);
    return null;
  }

  // Reusa o msgpackRead do kernel principal quando disponível; senão decodifica inline.
  function mpRead(bytes, st) {
    if (st.o >= bytes.length) throw new Error('eof');
    var x = bytes[st.o++];
    var u16 = function() { var v = (bytes[st.o] << 8) | bytes[st.o + 1]; st.o += 2; return v; };
    var u32 = function() { var v = (((bytes[st.o] * 0x1000000) >>> 0) | (bytes[st.o + 1] << 16) | (bytes[st.o + 2] << 8) | bytes[st.o + 3]) >>> 0; st.o += 4; return v; };
    if (x < 0x80) return x;
    if (x >= 0xe0) return x - 256;
    if (x >= 0xa0 && x <= 0xbf) { var l0 = x & 31; return new TextDecoder().decode(bytes.subarray(st.o, st.o += l0)); }
    if (x >= 0x90 && x <= 0x9f) { var a0 = []; for (var i0 = 0; i0 < (x & 15); i0++) a0.push(mpRead(bytes, st)); return a0; }
    if (x >= 0x80 && x <= 0x8f) { var m0 = {}; for (var j0 = 0; j0 < (x & 15); j0++) m0[String(mpRead(bytes, st))] = mpRead(bytes, st); return m0; }
    if (x === 0xc0) return null;
    if (x === 0xc2) return false;
    if (x === 0xc3) return true;
    if (x === 0xcc) return bytes[st.o++];
    if (x === 0xcd) return u16();
    if (x === 0xce) return u32();
    if (x === 0xd0) return (bytes[st.o++] << 24) >> 24;
    if (x === 0xd1) { var v1 = new DataView(bytes.buffer, bytes.byteOffset + st.o, 2).getInt16(0); st.o += 2; return v1; }
    if (x === 0xd2) { var v2 = new DataView(bytes.buffer, bytes.byteOffset + st.o, 4).getInt32(0); st.o += 4; return v2; }
    if (x === 0xca) { var f1 = new DataView(bytes.buffer, bytes.byteOffset + st.o, 4).getFloat32(0); st.o += 4; return f1; }
    if (x === 0xcb) { var f2 = new DataView(bytes.buffer, bytes.byteOffset + st.o, 8).getFloat64(0); st.o += 8; return f2; }
    if (x === 0xd9) { var l1 = bytes[st.o++]; return new TextDecoder().decode(bytes.subarray(st.o, st.o += l1)); }
    if (x === 0xda) { var l2 = u16(); return new TextDecoder().decode(bytes.subarray(st.o, st.o += l2)); }
    if (x === 0xdb) { var l3 = u32(); return new TextDecoder().decode(bytes.subarray(st.o, st.o += l3)); }
    if (x === 0xdc) { var a1 = []; for (var i1 = 0, n1 = u16(); i1 < n1; i1++) a1.push(mpRead(bytes, st)); return a1; }
    if (x === 0xdd) { var a2 = []; for (var i2 = 0, n2 = u32(); i2 < n2; i2++) a2.push(mpRead(bytes, st)); return a2; }
    if (x === 0xde) { var m1 = {}; for (var j1 = 0, c1 = u16(); j1 < c1; j1++) m1[String(mpRead(bytes, st))] = mpRead(bytes, st); return m1; }
    if (x === 0xdf) { var m2 = {}; for (var j2 = 0, c2 = u32(); j2 < c2; j2++) m2[String(mpRead(bytes, st))] = mpRead(bytes, st); return m2; }
    if (x === 0xc4) { var lb1 = bytes[st.o++]; st.o += lb1; return null; }
    if (x === 0xc5) { var lb2 = u16(); st.o += lb2; return null; }
    if (x === 0xc6) { var lb3 = u32(); st.o += lb3; return null; }
    if (x >= 0xd4 && x <= 0xd8) { st.o += (1 << (x - 0xd4)) + 1; return null; }
    if (x >= 0xc7 && x <= 0xc9) { var le = x === 0xc7 ? bytes[st.o++] : x === 0xc8 ? u16() : u32(); st.o += le + 1; return null; }
    throw new Error('unsupported 0x' + x.toString(16));
  }

  function decodeRoomData(bytes) {
    try {
      if (!bytes || !bytes.length || bytes[0] !== 13) return null;
      var st = { o: 1 };
      var type = mpRead(bytes, st);
      var payload = st.o < bytes.length ? mpRead(bytes, st) : null;
      return { type: type, payload: payload };
    } catch (_) { return null; }
  }

  function observe(data) {
    try {
      var u8 = toU8(data);
      if (!u8 || !u8.length) return;
      if (u8[0] === 14 || u8[0] === 15) { state.roomState++; state.frames++; state.lastFrame = Date.now(); return; }
      if (u8[0] !== 13) return;
      state.roomData++;
      var d = decodeRoomData(u8);
      if (d && d.type !== undefined) ingest(d.type, d.payload);
    } catch (_) {}
  }

  try {
    var NativeWS = window.WebSocket;
    if (NativeWS && NativeWS.prototype && !NativeWS.prototype.__baiakRoomHooked) {
      Object.defineProperty(NativeWS.prototype, '__baiakRoomHooked', { value: true });
      var nativeSend = NativeWS.prototype.send;
      NativeWS.prototype.send = function(data) {
        try {
          // Registra o socket para o send direto (cobre sockets criados antes
          // e depois da injeção — o SDK chama ws.send via prototype).
          try { sockets.add(this); } catch (_) {}
          var u8 = toU8(data);
          if (u8 && u8.length && u8[0] === 13) {
            var d = decodeRoomData(u8);
            if (d && d.type !== undefined) pushEvent(d.type, d.payload, 'OUT');
          }
        } catch (_) {}
        return nativeSend.call(this, data);
      };
      var nativeAdd = NativeWS.prototype.addEventListener;
      NativeWS.prototype.addEventListener = function(evType, fn, opts) {
        if (evType === 'message' && typeof fn === 'function' && !fn.__baiakRoomWrapped) {
          var wrapped = function(ev) {
            try {
              if (ev && ev.data instanceof ArrayBuffer) observe(ev.data);
              else if (ev && ev.data instanceof Blob) { ev.data.arrayBuffer().then(observe).catch(function(){}); }
              else if (ev && toU8(ev.data)) observe(ev.data);
            } catch (_) {}
            return fn.call(this, ev);
          };
          wrapped.__baiakRoomWrapped = true;
          try { Object.defineProperty(fn, '__baiakRoomWrappedFn', { value: wrapped }); } catch (_) {}
          return nativeAdd.call(this, evType, wrapped, opts);
        }
        return nativeAdd.call(this, evType, fn, opts);
      };
      // onmessage setter: encadeia sem quebrar o SDK
      try {
        var desc = Object.getOwnPropertyDescriptor(NativeWS.prototype, 'onmessage');
        if (desc && (desc.get || desc.set)) {
          var ng = desc.get, ns = desc.set;
          Object.defineProperty(NativeWS.prototype, 'onmessage', {
            configurable: true, enumerable: desc.enumerable,
            get: function() { try { return ng.call(this); } catch (_) { return null; } },
            set: function(fn) {
              if (typeof fn === 'function' && !fn.__baiakRoomWrapped) {
                var self = this;
                var wrapped = function(ev) {
                  try {
                    if (ev && ev.data instanceof ArrayBuffer) observe(ev.data);
                    else if (ev && ev.data instanceof Blob) { ev.data.arrayBuffer().then(observe).catch(function(){}); }
                    else if (ev && toU8(ev.data)) observe(ev.data);
                  } catch (_) {}
                  return fn.call(self, ev);
                };
                wrapped.__baiakRoomWrapped = true;
                return ns.call(this, wrapped);
              }
              return ns.call(this, fn);
            },
          });
        }
      } catch (_) {}
    }
    // Captura sockets também no addEventListener/close (cobre listeners já
    // registrados antes da injeção tardia).
    try {
      var nativeClose = NativeWS.prototype.close;
      if (nativeClose && !nativeClose.__baiakRoomPatched) {
        var patchedClose = function() {
          try { sockets.delete(this); } catch (_) {}
          return nativeClose.apply(this, arguments);
        };
        try { Object.defineProperty(patchedClose, '__baiakRoomPatched', { value: true }); } catch (_) {}
        NativeWS.prototype.close = patchedClose;
      }
    } catch (_) {}
  } catch (_) {}

  // Envio direto: 1 pacote ROOM_DATA para a sala (hunt/partyhunt/queue/chat).
  // O servidor filtra por sala — enviar stage no socket errado é no-op.
  function directSend(type, payload) {
    var bytes;
    try { bytes = buildFrame(type, payload === undefined ? {} : payload); }
    catch (e) { return { sent: 0, error: String((e && e.message) || e) }; }
    var n = 0;
    sockets.forEach(function(ws) {
      try { if (ws.readyState === 1) { ws.send(bytes); n++; } } catch (_) {}
    });
    pushEvent(type, payload, 'OUT-direct');
    return { sent: n, bytes: bytes.length };
  }

  // Lê NWe() indiretamente: o jogo renderiza players/hp/huntId/wave no overlay
  // battery-save a partir do ROOM_STATE. Espelha para leitura O(1) sem DOM walk.
  function snapshotBatterySave() {
    try {
      var bsHunt = document.querySelector('.bs-hunt');
      if (bsHunt && bsHunt.textContent && bsHunt.textContent.trim() && bsHunt.textContent.trim() !== '—') {
        var t = bsHunt.textContent.trim();
        if (!state.hunt || state.hunt === 'Conectando...') state.hunt = t;
      }
      var party = [];
      var nodes = document.querySelectorAll('.bs-party-name, #bar-shooters .bar-member');
      for (var i = 0; i < nodes.length && i < 12; i++) {
        var el = nodes[i];
        var txt = (el.textContent || '').trim();
        if (txt) party.push(txt.slice(0, 80));
      }
      if (party.length) state.bsParty = party;
      var hpNodes = document.querySelectorAll('.bs-party-hp');
      var hps = [];
      for (var j = 0; j < hpNodes.length && j < 12; j++) {
        var ht = (hpNodes[j].textContent || '').trim();
        var m = ht.match(/([\\d.,]+)\\s*\\/\\s*([\\d.,]+)/);
        if (m) hps.push({ raw: ht.slice(0, 40) });
      }
      if (hps.length) state.bsHp = hps;
    } catch (_) {}
    return state;
  }

  setInterval(snapshotBatterySave, 2000);

  try { Object.defineProperty(window, '__baiak_send', { value: directSend, configurable: true }); } catch (_) { window.__baiak_send = directSend; }
  try { Object.defineProperty(window, '__room', { value: { send: directSend }, configurable: true }); } catch (_) { window.__room = { send: directSend }; }
  try { Object.defineProperty(window, '__baiak_state', { value: state, configurable: true }); } catch (_) { window.__baiak_state = state; }
  try { Object.defineProperty(window, '__baiak_events', { value: events, configurable: true }); } catch (_) { window.__baiak_events = events; }
  var drain = function() { var out = events.splice(0, events.length); return out.slice(-300); };
  try { Object.defineProperty(window, '__baiak_drain', { value: drain, configurable: true }); } catch (_) { window.__baiak_drain = drain; }
})();
`;
