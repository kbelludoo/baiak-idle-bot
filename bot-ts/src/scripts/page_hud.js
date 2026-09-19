() => {
  const res = {
    level: null,
    gold: null,
    stamina: null,
    vocs: [],
    spells: [],
    helpers: [],
    helperOpen: false,
    pickerOpen: false,
    pickerTitle: "",
    pickerKind: null
  };

  const nums = (s) => {
    const m = String(s || "").match(/(\d[\d.,]*)/);
    if (!m) return null;
    return parseInt(m[1].replace(/[.,]/g, ""), 10);
  };

  let maxLvl = 0;
  const lvlRe = /(?:lvl|n[ií]vel|level)\s*[:·.]?\s*(\d{1,4})/i;
  // Busca nível apenas em seletores específicos de personagem/HUD (evita pegar requisitos de hunt como 1500)
  const lvlEls = document.querySelectorAll(
    "#bar-shooters .bar-member, .cyc-char-lvl, .pm-pc-meta, .pm-char-meta, .hd-lvl, .hud-lvl, .bar-char-lvl"
  );
  for (const el of lvlEls) {
    const t = (el.textContent || "").trim();
    const m = t.match(lvlRe);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxLvl && n <= 500) maxLvl = n;
    }
  }
  if (maxLvl === 0) {
    const allEls = document.querySelectorAll("#header *, #m-dock *, .hud-top *, .player-info *");
    for (const el of allEls) {
      if (el.children.length === 0) {
        const m = (el.textContent || "").match(lvlRe);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxLvl && n <= 500) maxLvl = n;
        }
      }
    }
  }
  res.level = maxLvl > 0 ? maxLvl : null;

  const goldEl = document.getElementById("hud-gold") || document.querySelector(".hud-money") || document.querySelector(".mk-goldamt") || document.querySelector(".ac-wallet-val");
  if (goldEl) {
    const g = nums(goldEl.textContent);
    if (g != null) res.gold = g;
  }
  if (res.gold == null) {
    const gm = document.getElementById("gold-count");
    if (gm) res.gold = nums(gm.textContent);
  }

  // --- EXTRAÇÃO ROBUSTA DE STAMINA ---
  let staminaFound = null;
  const stamDirect = document.querySelector("#stamina-time, .stamina-time, .stamina-val, #stamina-val, [data-stamina]");
  if (stamDirect) {
    const st = (stamDirect.textContent || "").trim();
    if (/\d{1,2}:\d{2}/.test(st)) staminaFound = st;
  }
  if (!staminaFound) {
    const batteryEls = document.querySelectorAll(
      "button[title*='stamina' i], [data-tip*='stamina' i], [data-tooltip*='stamina' i], [aria-label*='stamina' i], .hud-stamina, .top-stamina, #btn-stamina, #stamina-btn"
    );
    for (const b of batteryEls) {
      const tip = b.getAttribute("title") || b.getAttribute("data-tip") || b.getAttribute("data-tooltip") || b.getAttribute("aria-label") || b.textContent || "";
      const m = tip.match(/(\d{1,2}:\d{2})/);
      if (m) {
        staminaFound = m[1];
        break;
      }
    }
  }
  if (!staminaFound) {
    const headerClocks = document.querySelectorAll("#header *, header *, .hud-top *, .top-bar *, nav *");
    for (const el of headerClocks) {
      if (el.children.length === 0 && !el.closest("#wave-title, .wave-box, .stage-info")) {
        const m = (el.textContent || "").trim().match(/^(\d{1,2}:\d{2})$/);
        if (m) {
          staminaFound = m[1];
          break;
        }
      }
    }
  }
  const pctEl = document.getElementById("stamina-pct") || document.querySelector(".stamina-pct");
  if (pctEl) {
    const pt = (pctEl.textContent || "").trim();
    if (pt) res.stamina_pct = pt;
  }
  res.stamina = staminaFound || "42:00";

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
        if (roleRegex.test(cardText) || card.querySelectorAll("[class*='bar'], [class*='hp'], [class*='mp'], [class*='xp']").length > 0) {
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
        if (parsed >= 10 && parsed <= 5000) mLvl = parsed;
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

  // 1. Screensaver / Economy stats bar (.bs-stats)
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
