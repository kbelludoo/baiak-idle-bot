() => {
  const res = {
    level: null,
    gold: null,
    coins: null,
    market_coins: null,
    skills: {},
    stamina: null,
    vocs: [],
    spells: [],
    helpers: [],
    helperOpen: false,
    pickerOpen: false,
    pickerTitle: "",
    pickerKind: null
  };

  const parseGoldAmount = (val) => {
    if (typeof val === 'number') return Math.round(val);
    const s = String(val || "").replace(/\s/g, "").trim();
    if (!s) return null;
    const m = s.match(/([\d.,]+)\s*(kk|k|m|mil)?/i);
    if (!m) return null;
    let raw = m[1];
    const unit = (m[2] || "").toLowerCase();

    let num = 0;
    if (unit === "kk" || unit === "m") {
      num = parseFloat(raw.replace(/\./g, "").replace(",", ".")) * 1000000;
    } else if (unit === "k" || unit === "mil") {
      num = parseFloat(raw.replace(/\./g, "").replace(",", ".")) * 1000;
    } else {
      // Sem sufixo (ex: "1.500.000", "50.000", "1.234", "1234")
      // Padrão pt-BR do jogo: pontos são separadores de milhar
      if (raw.includes(".") && raw.includes(",")) {
        num = parseFloat(raw.replace(/\./g, "").replace(",", "."));
      } else if (raw.includes(".")) {
        num = parseInt(raw.replace(/\./g, ""), 10);
      } else if (raw.includes(",")) {
        num = parseFloat(raw.replace(",", "."));
      } else {
        num = parseInt(raw, 10);
      }
    }
    return isNaN(num) ? null : Math.round(num);
  };

  const nums = (s) => {
    const m = String(s || "").match(/(\d[\d.,]*)/);
    if (!m) return null;
    return parseInt(m[1].replace(/[.,]/g, ""), 10);
  };

  let maxLvl = 0;
  try {
    const ml = window.__baiak_telemetry?.level || window.__baiak_engine?.state?.level || window.__baiak_state?.level;
    if (typeof ml === "number" && ml > 0 && ml <= 800) maxLvl = Math.floor(ml);
  } catch (_) {}

  const lvlRe = /(?:lvl|n[ií]vel|level)\s*[:·.]?\s*(\d{1,4})/i;
  if (maxLvl === 0) {
    const lvlEls = document.querySelectorAll(
      "#bar-shooters .bar-member, .cyc-char-lvl, .pm-pc-meta, .pm-char-meta, .hd-lvl, .hud-lvl, .bar-char-lvl"
    );
    for (const el of lvlEls) {
      const t = (el.textContent || "").trim();
      const m = t.match(lvlRe);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxLvl && n <= 800) maxLvl = n;
      }
    }
  }
  if (maxLvl === 0) {
    const headerSpans = document.querySelectorAll("#header span, .hud-top span, .player-info span");
    for (const el of headerSpans) {
      const m = (el.textContent || "").match(lvlRe);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxLvl && n <= 800) maxLvl = n;
      }
    }
  }
  res.level = maxLvl > 0 ? maxLvl : null;

  // Gold do personagem
  try {
    const mg = window.__baiak_telemetry?.gold ?? window.__baiak_engine?.state?.gold ?? window.__baiak_state?.gold;
    if (typeof mg === "number" && Number.isFinite(mg) && mg >= 0) res.gold = Math.floor(mg);
  } catch (_) {}

  if (res.gold == null) {
    const goldCandidates = [
      document.getElementById("hud-gold"),
      document.querySelector(".hud-money, .mk-goldamt, .ac-wallet-val, .wallet-gold, #gold-count, [data-gold]"),
      document.getElementById("gold-count"),
      document.querySelector("[title*='Gold' i], [aria-label*='Gold' i], [title*='gold' i], [data-tip*='gold' i]"),
    ].filter(Boolean);
    for (const goldEl of goldCandidates) {
      const rawAttr = goldEl.getAttribute("data-gold") || goldEl.getAttribute("data-value") || goldEl.getAttribute("title") || "";
      const rawTxt = goldEl.textContent || "";
      const g = parseGoldAmount(rawAttr) ?? parseGoldAmount(rawTxt);
      if (g != null && g > 0) { res.gold = g; break; }
      if (g != null && res.gold == null) res.gold = g;
    }
  }
  if (res.gold == null) {
    const wallet = document.querySelector(".wallet, .hud-wallet, #wallet, .coins, .gold-wrap");
    if (wallet) {
      const g = parseGoldAmount(wallet.textContent);
      if (g != null) res.gold = g;
    }
  }

  // --- EXTRAÇÃO ROBUSTA DE COINS (Saldo de Moedas Premium / Mercado) ---
  try {
    const b = window.__baiak_balances || window.ie?.balances || window.__coin_balances;
    if (b && typeof b === "object") {
      if (typeof b.coins === "number") res.coins = Math.floor(b.coins);
      if (typeof b.marketCoins === "number") res.market_coins = Math.floor(b.marketCoins);
    }
  } catch (_) {}

  if (res.coins == null) {
    const coinDirect = document.querySelector("#hud-coins, .coin.coins b, .coin.coins, [data-i18n-title*='Coins' i] b");
    if (coinDirect) {
      const parsed = nums(coinDirect.textContent || "");
      if (parsed != null && parsed >= 0) res.coins = parsed;
    }
  }

  if (res.coins == null) {
    const coinEls = document.querySelectorAll(
      "#hud-coins, .ac-wallet-val, .wallet-coins, #coins-count, .coins-count, [data-coins], [title*='coins' i], [title*='Coins' i], .coins-amount"
    );
    for (const el of coinEls) {
      const raw = el.getAttribute("data-coins") || el.getAttribute("data-value") || el.textContent || "";
      const parsed = nums(raw);
      if (parsed != null && parsed >= 0) { res.coins = parsed; break; }
    }
  }

  // --- EXTRAÇÃO ROBUSTA DE SKILLS E ML (Magic Level) ---
  res.skills = {};
  try {
    const pList = window.__baiak_state?.players || window.__baiak_telemetry?.players || window.m?.lastPlayers || [];
    const p0 = Array.isArray(pList) ? (pList.find(p => p.slot === (window.m?.skillsSlot ?? 0)) || pList[0]) : null;
    if (p0 && p0.skills) {
      let rawSkills = p0.skills;
      if (typeof rawSkills === "string") {
        try { rawSkills = JSON.parse(rawSkills); } catch (_) {}
      }
      if (typeof rawSkills === "object" && rawSkills !== null) {
        for (const [key, val] of Object.entries(rawSkills)) {
          if (Array.isArray(val)) {
            res.skills[key] = { level: Number(val[0]) || 0, pct: Number(val[1]) || 0, bonus: Number(val[2]) || 0 };
          } else if (typeof val === "number") {
            res.skills[key] = { level: val, pct: 0, bonus: 0 };
          }
        }
      }
    }
  } catch (_) {}

  // Fallback DOM (#skills-panel-body ou .sk-skill)
  if (!Object.keys(res.skills).length) {
    try {
      const rows = document.querySelectorAll("#skills-panel-body .sk-skill, #panel-skills .sk-skill, .skills-panel .sk-skill");
      for (const row of rows) {
        const spans = row.querySelectorAll(".sk-row span, span");
        if (spans.length >= 2) {
          const name = (spans[0].textContent || "").trim().toLowerCase();
          const valText = (spans[1].textContent || "").trim();
          const mVal = valText.match(/^(\d+)(?:\s*\+\s*(\d+))?/);
          if (mVal) {
            const base = parseInt(mVal[1], 10);
            const bonus = mVal[2] ? parseInt(mVal[2], 10) : 0;
            res.skills[name] = { level: base, bonus };
          }
        }
      }
    } catch (_) {}
  }

  // --- EXTRAÇÃO ROBUSTA DE STAMINA ---
  const normStam = (s) => {
    const t = String(s || "").trim();
    if (!t) return null;
    const pct = t.match(/(\d{1,3})\s*%/);
    if (pct) return pct[1] + "%";
    const clock = t.match(/(\d{1,2})\s*:\s*(\d{2})/);
    if (clock) {
      const h = parseInt(clock[1], 10), mi = parseInt(clock[2], 10);
      if (h === 42 && mi === 0) return null;
      if (h <= 42 && mi <= 59) return h + ":" + String(mi).padStart(2, "0");
    }
    const mH = t.match(/(\d{1,2})\s*h/i);
    const mM = t.match(/(\d{1,3})\s*m/i);
    if (mH || mM) {
      const h = mH ? parseInt(mH[1], 10) : 0;
      const mi = mM ? parseInt(mM[1], 10) : 0;
      if (h === 42 && mi === 0) return null;
      if (h <= 42 && mi <= 59) return h + ":" + String(mi).padStart(2, "0");
    }
    return null;
  };
  let staminaFound = null;
  let staminaPctFound = null;

  try {
    const ms = window.__baiak_telemetry?.stamina || window.__baiak_engine?.state?.stamina;
    const cand = normStam(ms || "");
    if (cand) staminaFound = cand;
  } catch (_) {}

  const stamDirect = document.querySelector("#stamina-time, .stamina-time, .stamina-val, #stamina-val, [data-stamina], #stamina-panel, .stamina-panel");
  if (stamDirect) staminaFound = normStam(stamDirect.textContent) || normStam(stamDirect.getAttribute("title") || "") || staminaFound;

  if (!staminaFound) {
    const batteryEls = document.querySelectorAll(
      "button[title*='stamina' i], [data-tip*='stamina' i], [data-tooltip*='stamina' i], [aria-label*='stamina' i], .hud-stamina, .top-stamina, #btn-stamina, #stamina-btn"
    );
    for (const b of batteryEls) {
      const tip = b.getAttribute("title") || b.getAttribute("data-tip") || b.getAttribute("data-tooltip") || b.getAttribute("aria-label") || b.textContent || "";
      staminaFound = normStam(tip);
      const pct = String(tip).match(/(\d{1,3})\s*%/);
      if (pct) staminaPctFound = pct[1] + "%";
      if (staminaFound) break;
    }
  }

  const pctEl = document.getElementById("stamina-pct") || document.querySelector(".stamina-pct, .stamina-pct-val, [data-stamina-pct]");
  if (pctEl) {
    const pt = (pctEl.textContent || "").trim();
    const m = pt.match(/(\d{1,3})\s*%/);
    if (m) staminaPctFound = m[1] + "%";
    if (pt) res.stamina_pct = pt;
  }
  // Percentual tem prioridade sobre relógio (mais preciso). Placeholder 42:00 = null.
  res.stamina = staminaPctFound || staminaFound || null;

  // --- EXTRAÇÃO ROBUSTA DE PARTY MEMBERS ---
  res.partyMembers = [];
  const vocLvlRegex = /(paladin|knight|monk|sorcerer|druid)\s*[·•\-–]\s*(?:lvl|m|level|n[ií]vel)?\s*(\d+)/i;
  const roleRegex = /^(DPS|TANK|SUP|SUPPORT|HEALER)$/i;

  const foundCards = [];
  const hudNodes = document.querySelectorAll('#bar-shooters .bar-member, .pm-pc-meta, .pm-char-meta, .hd-lvl, .hud-lvl');
  for (const twNode of hudNodes) {
    const val = (twNode.textContent || "").trim();
    const match = val.match(vocLvlRegex);
    if (match) {
      const vocEl = twNode;
      if (!vocEl) continue;
      let card = vocEl;
      for (let up = 0; up < 4; up++) {
        if (!card.parentElement || card.parentElement === document.body) break;
        card = card.parentElement;
        const cardText = card.textContent || "";
        if (roleRegex.test(cardText) || card.querySelector("[class*='bar'], [class*='hp'], [class*='mp'], [class*='xp']")) {
          break;
        }
      }
      if (!foundCards.includes(card)) {
        foundCards.push(card);
      }
    }
  }

  foundCards.forEach((card, idx) => {
    const fullText = (card.textContent || "").trim();
    const vMatch = fullText.match(vocLvlRegex);
    let vocStr = "";
    let lvlNum = null;
    if (vMatch) {
      const vName = vMatch[1].toLowerCase();
      if (vName.includes("paladin")) vocStr = "Paladin (RP)";
      else if (vName.includes("knight")) vocStr = "Knight (EK)";
      else if (vName.includes("monk")) vocStr = "Monk (MK)";
      else if (vName.includes("sorcerer")) vocStr = "Sorcerer (MS)";
      else if (vName.includes("druid")) vocStr = "Druid (ED)";
      lvlNum = parseInt(vMatch[2], 10);
    }

    let charName = "";
    const nameEl = card.querySelector(".char-name, .member-name, .name, [class*='name'], h3, h4, h5, strong, b");
    if (nameEl) {
      const nt = (nameEl.textContent || "").trim();
      if (nt && !roleRegex.test(nt) && !vocLvlRegex.test(nt) && nt.length <= 25 && !/^\d+$/.test(nt)) {
        charName = nt;
      }
    }
    if (!charName) {
      const lines = fullText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (roleRegex.test(line)) continue;
        if (vocLvlRegex.test(line)) continue;
        if (/^(xp|hp|mp|party|config|backpack|slots)$/i.test(line)) continue;
        if (/^\d+(\s*\/\s*\d+)?$/.test(line)) continue;
        if (line.length >= 2 && line.length <= 25 && !line.includes("·")) {
          charName = line;
          break;
        }
      }
    }

    res.partyMembers.push({
      slot: idx,
      name: charName || null,
      voc: vocStr || (idx === 0 ? "Knight (EK)" : (idx === 1 ? "Druid (ED)" : "Sorcerer (MS)")),
      level: (lvlNum && lvlNum >= 10) ? lvlNum : null,
      active: true
    });
  });

  // Fallback 1: barra de atiradores (#bar-shooters .bar-member)
  if (res.partyMembers.length === 0) {
    const memberEls = Array.from(document.querySelectorAll("#bar-shooters .bar-member"));
    memberEls.forEach((el, idx) => {
      const raw = (el.textContent || "").trim();
      let mLvl = null;
      const m = raw.match(/(?:lvl|level|n[ií]vel)\s*[:·.]?\s*(\d{2,4})/i);
      if (m) {
        const parsed = parseInt(m[1], 10);
        if (parsed >= 10 && parsed <= 800) mLvl = parsed;
      }
      let voc = idx === 0 ? "Knight (EK)" : (idx === 1 ? "Druid (ED)" : "Sorcerer (MS)");
      const firstWord = raw.split(/\s+/)[0] || "";
      if (/^ek\b/i.test(firstWord) || /knight/i.test(raw)) voc = "Knight (EK)";
      else if (/^ed\b/i.test(firstWord) || /druid/i.test(raw)) voc = "Druid (ED)";
      else if (/^ms\b/i.test(firstWord) || /sorcerer/i.test(raw)) voc = "Sorcerer (MS)";
      else if (/^rp\b/i.test(firstWord) || /paladin/i.test(raw)) voc = "Paladin (RP)";
      else if (/^mk\b/i.test(firstWord) || /monk/i.test(raw)) voc = "Monk (MK)";

      res.partyMembers.push({
        slot: idx,
        name: null,
        voc: voc,
        level: mLvl,
        active: true
      });
    });
  }

  // Fallback 1b: espelhos do kernel (ROOM_DATA/party) quando o DOM mudou de classe.
  if (res.partyMembers.length === 0) {
    try {
      const mirror = window.__baiak_state?.players || window.__baiak_state?.party || window.__baiak_engine?.party || [];
      if (Array.isArray(mirror) && mirror.length > 0) {
        mirror.slice(0, 12).forEach((p, i) => {
          if (!p || typeof p !== "object") return;
          const lvl = Number(p.level ?? p.lvl) || null;
          const vocRaw = String(p.vocation || p.voc || "");
          let voc = i === 0 ? "Knight (EK)" : (i === 1 ? "Druid (ED)" : "Sorcerer (MS)");
          if (/knight|ek/i.test(vocRaw)) voc = "Knight (EK)";
          else if (/druid|ed/i.test(vocRaw)) voc = "Druid (ED)";
          else if (/sorcerer|ms/i.test(vocRaw)) voc = "Sorcerer (MS)";
          else if (/paladin|rp/i.test(vocRaw)) voc = "Paladin (RP)";
          else if (/monk|mk/i.test(vocRaw)) voc = "Monk (MK)";
          res.partyMembers.push({
            slot: Number(p.slot ?? i),
            name: typeof p.name === "string" ? p.name : null,
            voc,
            level: lvl && lvl >= 10 && lvl <= 800 ? lvl : null,
            active: true,
          });
        });
      } else if (window.__baiak_state?.bsParty && Array.isArray(window.__baiak_state.bsParty)) {
        window.__baiak_state.bsParty.slice(0, 12).forEach((t, idx) => {
          res.partyMembers.push({ slot: idx, name: null, voc: idx === 0 ? "Knight (EK)" : (idx === 1 ? "Druid (ED)" : "Sorcerer (MS)"), level: null, active: true });
        });
      }
    } catch (_) {}
  }

  // Fallback 2: slots padrão baseados nas vocações ativas
  if (res.partyMembers.length === 0) {
    res.partyMembers = [
      { slot: 0, name: null, voc: "Knight (EK)", level: null, active: true },
      { slot: 1, name: null, voc: "Druid (ED)", level: null, active: true },
      { slot: 2, name: null, voc: "Sorcerer (MS)", level: null, active: true }
    ];
  }

  document.querySelectorAll(".cyc-char-voc, .hd-voc").forEach((el) => {
    const t = (el.textContent || "").trim();
    if (t) res.vocs.push(t);
  });

  for (let slot = 0; slot < 3; slot++) {
    for (let u = 0; u < 6; u++) {
      const el = document.getElementById(`rot-${slot}-${u}`);
      if (!el) continue;
      const empty = !!el.querySelector("small");
      const img = el.querySelector("img");
      const name = (el.title || el.getAttribute("aria-label") || (img && img.alt) || "").trim();
      res.spells.push({ slot, u, empty, name });
    }
  }

  const helper = document.getElementById("helper-modal");
  res.helperOpen = !!(helper && !helper.classList.contains("hidden"));
  const members = Array.from(document.querySelectorAll("#bar-shooters .bar-member"));
  let activeSlot = members.findIndex((el) => el.classList.contains("bar-member-active"));
  if (res.helperOpen) {
    const chars = Array.from(helper.querySelectorAll("button.bar-char")).filter((b) => !b.classList.contains("benched"));
    chars.forEach((b, i) => { if (b.classList.contains("active")) activeSlot = i; });
    if (activeSlot < 0) activeSlot = 0;
    const noneRe = /^(nenhuma|none)$/i;
    const autoRe = /cura autom[aá]tica|exura|healing|mend|cleansing|san|ico|cura|infir/i;
    const gridBtns = Array.from(helper.querySelectorAll(".helper-healgrid .helper-spellbtn"));
    const btns = gridBtns.length ? gridBtns : Array.from(helper.querySelectorAll(".helper-spellbtn"));
    let heal = "", hp = "", mana = "";
    const flabels = Array.from(helper.querySelectorAll(".helper-flabel, .helper-check"));
    for (const lab of flabels) {
      const t = (lab.textContent || "").toLowerCase();
      let n = lab.nextElementSibling;
      while (n && !(n.classList && n.classList.contains("helper-spellbtn"))) n = n.nextElementSibling;
      const val = (n?.textContent || "").replace(/\s+/g, " ").trim();
      if (/^\s*magia/i.test(t) || (/magia/.test(t) && !/po[cç][aã]o/.test(t))) heal = val || heal;
      if (/po[cç][aã]o hp|hp pot/.test(t)) hp = val;
      if (/po[cç][aã]o mp|mp pot/.test(t)) mana = val;
    }
    if (!heal && btns[0]) heal = (btns[0].textContent || "").replace(/\s+/g, " ").trim();
    if (!hp && btns[1]) hp = (btns[1].textContent || "").replace(/\s+/g, " ").trim();
    if (!mana && btns[2]) mana = (btns[2].textContent || "").replace(/\s+/g, " ").trim();
    const autoHeal = autoRe.test(heal) || (heal && !noneRe.test(heal));
    res.helpers.push({
      slot: activeSlot,
      heal: noneRe.test(heal) ? "" : heal,
      hpPotion: noneRe.test(hp) ? "" : hp,
      manaPotion: noneRe.test(mana) ? "" : mana,
      autoHeal,
      healEnabled: !Array.from(helper.querySelectorAll('input[type="checkbox"]')).some((c) => /magia/i.test((c.parentElement?.textContent || "")) && !c.checked)
    });
  }

  const picker = document.getElementById("picker-modal");
  res.pickerOpen = !!(picker && !picker.classList.contains("hidden"));
  if (res.pickerOpen) {
    res.pickerTitle = (picker.querySelector(".im-title")?.textContent || "").trim();
    const t = res.pickerTitle.toLowerCase();
    if (/cura pr[oó]pria/.test(t)) res.pickerKind = "heal";
    else if (/potion de mana/.test(t)) res.pickerKind = "mana";
    else if (/potion de vida/.test(t)) res.pickerKind = "hp";
    else if (/rota/.test(t) || /magia|spell/.test(t)) res.pickerKind = "spell";
    else if (/fase|hunt|caçar|sequência|sequencia/.test(t)) res.pickerKind = "stage";
    else if (picker.querySelector(".im-card.sp-mode")) res.pickerKind = "spell";
    else res.pickerKind = "other";
  }

  // Extrai dados dos Analisadores do jogo (#panel-hunt, #panel-dmg, #panel-loot, #panel-supply, #panel-taken, .bs-stats)
  res.analyzers = {};

  // 1. Screensaver / Economy stats bar (.bs-stats) & Elementos nativos do Hunt Analyzer (#an-*)
  const anRaw = document.getElementById("an-raw");
  if (anRaw) {
    const rawVal = parseGoldAmount(anRaw.textContent);
    if (rawVal != null) {
      res.analyzers.session_xp = rawVal;
      res.analyzers.raw_xp = rawVal;
    }
  }
  const anXph = document.getElementById("an-xph");
  if (anXph) res.analyzers.xp_per_hour = (anXph.textContent || "").trim();
  const anSession = document.getElementById("an-session");
  if (anSession) res.analyzers.session_time = (anSession.textContent || "").trim();
  const anKills = document.getElementById("an-kills");
  if (anKills) {
    const kv = parseGoldAmount(anKills.textContent);
    if (kv != null) res.analyzers.hunt_kills = kv;
  }
  const anLoot = document.getElementById("an-loot");
  if (anLoot) {
    const lv = parseGoldAmount(anLoot.textContent);
    if (lv != null) res.analyzers.loot_value = lv;
  }
  const anBalance = document.getElementById("an-balance");
  if (anBalance) {
    const bv = parseGoldAmount(anBalance.textContent);
    if (bv != null) res.analyzers.balance = bv;
  }

  const bsStats = document.querySelector(".bs-stats");
  if (bsStats) {
    const items = bsStats.querySelectorAll(".bs-stat");
    for (const item of items) {
      const lb = (item.querySelector(".bs-stat-lb")?.textContent || "").trim();
      const val = (item.querySelector(".bs-stat-v")?.textContent || "").trim();
      if (/xp\/h/i.test(lb)) res.analyzers.xp_per_hour = val;
      if (/loot\/h/i.test(lb)) res.analyzers.loot_per_hour = val;
      if (/tempo/i.test(lb)) res.analyzers.session_time = val;
    }
  }

  // 2. Extrai dados de painéis dock/laterais
  const parsePanelRows = (panelId) => {
    const p = document.getElementById(panelId);
    if (!p) return null;
    const entries = {};
    const rows = p.querySelectorAll(".arow, .prow, tr, .bs-stat, .stat-row, li, [class*='row']");
    for (const r of rows) {
      const txt = (r.textContent || "").replace(/\s+/g, " ").trim();
      const parts = txt.split(/[:=·]/);
      if (parts.length >= 2) {
        const k = parts[0].trim().toLowerCase();
        const v = parts.slice(1).join(":").trim();
        entries[k] = v;
      }
    }
    entries._raw = (p.textContent || "").slice(0, 300).replace(/\s+/g, " ").trim();
    return entries;
  };

  const pHunt = parsePanelRows("panel-hunt");
  if (pHunt) res.analyzers.hunt = pHunt;

  const pDmg = parsePanelRows("panel-dmg");
  if (pDmg) res.analyzers.damage = pDmg;

  const pTaken = parsePanelRows("panel-taken");
  if (pTaken) res.analyzers.taken = pTaken;

  const pLoot = parsePanelRows("panel-loot");
  if (pLoot) res.analyzers.loot = pLoot;

  const pSupply = parsePanelRows("panel-supply");
  if (pSupply) res.analyzers.supply = pSupply;

  return res;
}
