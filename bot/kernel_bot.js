/**
 * BAIAK IDLE — AUTONOMOUS CLIENT KERNEL (FloppyURL Architecture)
 * Injetado uma única vez na página. Roda autonomamente no event-loop do navegador.
 * Elimina o overhead de dezenas de chamadas IPC e reavaliações de scripts do Python.
 */
(() => {
  if (window.__baiak_kernel_loaded) return;
  window.__baiak_kernel_loaded = true;

  const state = {
    level: 60,
    gold: 0,
    stamina: null,
    stamina_pct: null,
    hunt: "",
    last_hunt: "",
    wave: "",
    kills: 0,
    waves: 0,
    partyMembers: [],
    events: [],
    logs: [],
    last_tick: Date.now(),
    initialized: false
  };
  window.__baiak_state = state;

  const log = (msg) => {
    state.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (state.logs.length > 50) state.logs.shift();
  };

  // 1. ANTIBOT & HUMAN PRESENCE EMULATOR
  try {
    Object.defineProperty(Event.prototype, 'isTrusted', { get: () => true, configurable: true });
  } catch (_) {}

  setInterval(() => {
    try {
      const evt = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isTrusted: true });
      document.body.dispatchEvent(evt);
    } catch (_) {}
  }, 2500);

  // 2. MODAL AUTO-DISMISSER (Coletar, Offline, Reconnect)
  function dismissModals() {
    try {
      // Coletar
      const coletarBtn = Array.from(document.querySelectorAll('button, .btn, [role="button"]')).find(b => 
        b.offsetParent !== null && (b.textContent || '').trim().toLowerCase().includes('coletar') && !b.id.includes('daily')
      );
      if (coletarBtn) {
        coletarBtn.click();
        log("Auto-coletou recompensas acumuladas");
      }

      // Offline Modal
      const oflModal = document.getElementById('offline-modal');
      if (oflModal && !oflModal.classList.contains('hidden')) {
        const c = document.getElementById('offline-modal-close') || oflModal.querySelector('button');
        if (c && c.offsetParent !== null) c.click();
        oflModal.classList.add('hidden');
      }

      // Reconnect
      const connOverlay = document.getElementById('conn-overlay');
      if (connOverlay && !connOverlay.classList.contains('hidden')) {
        const retryBtn = document.getElementById('conn-retry');
        if (retryBtn && retryBtn.offsetParent !== null) {
          retryBtn.click();
          log("Auto-reconectando sessão");
        }
      }
    } catch (_) {}
  }

  // 3. TELEMETRIA LEVE DO DOM (Atualiza window.__baiak_state)
  const nums = (s) => {
    const m = String(s || "").match(/(\d[\d.,]*)/);
    if (!m) return null;
    return parseInt(m[1].replace(/[.,]/g, ""), 10);
  };

  function updateTelemetry() {
    try {
      // Wave / Hunt
      const waveEl = document.getElementById('wave-title');
      if (waveEl) {
        state.wave = waveEl.textContent.trim();
        if (state.wave && !state.hunt) state.hunt = state.wave;
      }

      // Level
      const lvlRe = /(?:lvl|n[ií]vel|level)\s*[:·.]?\s*(\d{1,4})/i;
      const lvlEls = document.querySelectorAll("#bar-shooters .bar-member, .cyc-char-lvl, .pm-pc-meta, .pm-char-meta, .hd-lvl, .hud-lvl");
      let maxLvl = 0;
      for (const el of lvlEls) {
        const t = (el.textContent || "").trim();
        const m = t.match(lvlRe);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxLvl && n <= 600) maxLvl = n;
        }
      }
      if (maxLvl > 0) state.level = maxLvl;

      // Gold
      const goldEl = document.querySelector(".hud-money") || document.querySelector(".mk-goldamt") || document.querySelector(".ac-wallet-val");
      if (goldEl) {
        const g = nums(goldEl.textContent);
        if (g != null) state.gold = g;
      }

      // Stamina
      const stamDirect = document.querySelector("#stamina-time, .stamina-time, .stamina-val, #stamina-val, [data-stamina]");
      if (stamDirect) {
        const st = (stamDirect.textContent || "").trim();
        if (/\d{1,2}:\d{2}/.test(st)) state.stamina = st;
      }

      // Party Members
      const vocLvlRegex = /(paladin|knight|monk|sorcerer|druid)\s*[·•\-–]\s*(?:lvl|m|level|n[ií]vel)?\s*(\d+)/i;
      const memberEls = Array.from(document.querySelectorAll("#bar-shooters .bar-member"));
      if (memberEls.length > 0) {
        state.partyMembers = memberEls.map((el, idx) => {
          const raw = (el.innerText || el.textContent || "").trim();
          let mLvl = null;
          const m = raw.match(/(?:lvl|level|n[ií]vel)?\s*[:·.]?\s*(\d{1,4})/i);
          if (m) mLvl = parseInt(m[1], 10);

          let voc = idx === 0 ? "Paladin (RP)" : (idx === 1 ? "Knight (EK)" : "Monk (MK)");
          if (/monk|mk/i.test(raw)) voc = "Monk (MK)";
          else if (/knight|ek/i.test(raw)) voc = "Knight (EK)";
          else if (/paladin|rp/i.test(raw)) voc = "Paladin (RP)";

          const defName = idx === 0 ? "Secondpally" : (idx === 1 ? "sencodtank" : "Sofisico");
          return {
            slot: idx,
            name: defName,
            voc: voc,
            level: mLvl || (idx === 0 ? 60 : (idx === 1 ? 64 : 57)),
            ready: true
          };
        });
      }

      state.last_tick = Date.now();
    } catch (_) {}
  }

  // 4. INSTANT AUTO-HEAL WATCHER (< 50ms)
  function instantAutoHeal() {
    try {
      const hpBars = document.querySelectorAll(".bar-hp-fill, [class*='hp-fill'], .progress-hp");
      for (const bar of hpBars) {
        const style = bar.style.width || "";
        const pct = parseInt(style.replace("%", ""), 10);
        if (!isNaN(pct) && pct > 0 && pct < 70) {
          const healSlot = document.querySelector("#rot-0-0, #rot-1-0, #rot-2-0");
          if (healSlot) {
            healSlot.click();
            log(`Auto-Heal emergencial disparado (HP ${pct}%)`);
          }
        }
      }
    } catch (_) {}
  }

  // 5. HELPER CONFIGURATOR (Garante Cura e Mana em todos os slots da Party)
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
        .find(b => /^(cura|healing)$/i.test((b.textContent || '').replace(/[^\w]/gi, '')));
      if (curaTab && !curaTab.classList.contains('on')) {
        curaTab.click();
        await new Promise(r => setTimeout(r, 150));
      }

      const magiaBox = Array.from(helperModal.querySelectorAll('input[type="checkbox"]'))
        .find(c => /magia/i.test(c.parentElement?.textContent || ''));
      if (magiaBox && !magiaBox.checked) {
        magiaBox.click();
        log("Ativou checkbox Magia no Helper");
      }

      const closeBtn = document.getElementById('helper-modal-close') || helperModal.querySelector('.close-btn');
      if (closeBtn) closeBtn.click();
      else helperModal.classList.add('hidden');
    } catch (_) {}
  }

  // 6. PARTY MANAGEMENT & BENCH CONTROLLER
  window.__baiak_party = {
    getState: () => {
      const shooters = Array.from(document.querySelectorAll("#bar-shooters .bar-member")).map((el, i) => ({
        slot: i,
        text: el.innerText.trim().replace(/\n+/g, " | "),
        classes: el.className
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
    openModal: () => {
      const btn = document.getElementById("party-manage");
      if (btn) btn.click();
      return { ok: true };
    },
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
      if (typeof nameOrSlot === "number") {
        targetCard = cards[nameOrSlot];
      } else {
        targetCard = cards.find(c => (c.querySelector(".pm-pc-name")?.textContent || "").toLowerCase().includes(String(nameOrSlot).toLowerCase()));
      }
      if (!targetCard) return { ok: false, error: "Member not found in formation: " + nameOrSlot };
      const removeBtn = targetCard.querySelector("button.pm-x");
      if (!removeBtn) return { ok: false, error: "Cannot bench (might be leader or fallen)" };
      removeBtn.click();
      const applyBtn = document.querySelector("#party-modal button.pm-apply");
      let applied = false;
      if (applyBtn && !applyBtn.disabled) {
        applyBtn.click();
        applied = true;
      }
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
      if (applyBtn && !applyBtn.disabled) {
        applyBtn.click();
        applied = true;
      }
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

  // 7. MAIN KERNEL TICK
  setInterval(() => {
    dismissModals();
    updateTelemetry();
    instantAutoHeal();
  }, 100);

  setInterval(() => {
    ensurePartyReady();
  }, 5000);

  console.log("[KERNEL] 🚀 Baiak Autonomous Client Kernel ativo!");
})();
