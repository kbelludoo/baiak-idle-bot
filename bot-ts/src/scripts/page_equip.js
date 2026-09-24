async (args) => {
  const { preferredElement = "", preferredProtection = "", job = "equip", approvedHashes = [] } = args || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const events = [];

  // --- Formato real do jogo (extraído do bundle /jogar/assets/index-*.js) ---
  // Item instância: { name, tier (raridade 0-5), ftier (forja 0-10), upLevel (0-12), attrs[], hash, uid }
  //   dn = {0:"Common",1:"Uncommon",2:"Rare",3:"Epic",4:"Legendary",5:"Mythical"}
  //   Sk = Uncommon(a1,max4) Rare(a2,max6) Epic(a3,max8) Legendary(a4,max10) Mythical(a5,max12)
  // DOM cell: dataset.tier = String(raridade 0-5), borda via On(tier),
  //   dataset.cmpitem = JSON da instância (quando equipável),
  //   dataset.tiphtml = tooltip na(): tt-rarity / tt-name / rows Classification|Tier|Upgrade|Type|Hands|Range
  //   X6(): .item-tier-label (forja) + .item-upgrade-label (+N)
  // Modal #item-modal repete o tooltip + colunas de comparação DXe() ("Este item" vs equipado,
  //   "Nada equipado" quando slot vazio, "Segure Shift p/ comparar com o equipado").
  // Slots (we[].slot via XCe()): helmet/armor/legs/boots/shield/amulet/ring/trinket/ammo/weapon.

  const RARITY_ORDER = {
    common: 0, comum: 0, normal: 0,
    uncommon: 1, incomum: 1,
    rare: 2, raro: 2, rara: 2,
    epic: 3, epico: 3, "épico": 3, epica: 3, "épica": 3,
    legendary: 4, legendario: 4, "lendário": 4, legendaria: 4, "lendária": 4, unique: 4,
    mythical: 5, mythic: 5, mitico: 5, "mítico": 5, mitica: 5, "mítica": 5,
  };
  const RARITY_NAME = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythical"];
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const rarityFromName = (s) => {
    const n = norm(s);
    for (const k of Object.keys(RARITY_ORDER)) {
      if (n.includes(norm(k))) return RARITY_ORDER[k];
    }
    return null;
  };

  // Type (XCe) -> slot canônico. Cobre EN + PT.
  const slotFromTypeText = (t) => {
    const n = norm(t || "");
    if (!n) return null;
    if (/helmet|elmo/.test(n)) return "helmet";
    if (/amulet|amuleto|necklace|colar/.test(n)) return "amulet";
    if (/armor|armadura|robe|toga/.test(n)) return "armor";
    if (/\blegs?\b|pernas|pants|calca/.test(n)) return "legs";
    if (/boots|botas|shoes|sapato/.test(n)) return "boots";
    if (/shield|escudo/.test(n)) return "shield";
    if (/\bring\b|anel/.test(n)) return "ring";
    if (/trinket|berloque/.test(n)) return "trinket";
    if (/crossbow|besta/.test(n)) return "weapon";
    if (/\bbow\b|arco/.test(n)) return "weapon";
    if (/throwing|arremesso/.test(n)) return "weapon";
    if (/fist|punho/.test(n)) return "weapon";
    if (/wand|varinha/.test(n)) return "weapon";
    if (/\brod\b|cajado/.test(n)) return "weapon";
    if (/axe|machado/.test(n)) return "weapon";
    if (/club|clava|martelo|hammer|mace/.test(n)) return "weapon";
    if (/sword|espada|blade|lamina|dagger|adaga|sabre|katana/.test(n)) return "weapon";
    if (/spear|lanaca|lanca|pike/.test(n)) return "weapon";
    if (/staff|staffs/.test(n)) return "weapon";
    if (/weapon|arma/.test(n)) return "weapon";
    if (/ammo|municao|bolt|arrow|quiver/.test(n)) return "ammo";
    if (/backpack|mochila/.test(n)) return "backpack";
    return null;
  };

  const slotFromName = (name) => {
    const n = norm(name || "");
    if (/elmo|helm|helmet|capuz|hood|mascara|mask|chapel|hood/.test(n)) return "helmet";
    if (/amuleto|amulet|colar|necklace|pendant/.test(n)) return "amulet";
    if (/armadura|armor|robe|toga|colete|breastplate|cuirass/.test(n)) return "armor";
    if (/pernas|legs|calca|pants|greaves|cuisse/.test(n)) return "legs";
    if (/botas|boots|sapatos|shoes|sandalias|greave/.test(n)) return "boots";
    if (/escudo|shield|buckler/.test(n)) return "shield";
    if (/(^| )anel( |$)|ring/.test(n)) return "ring";
    if (/berloque|trinket/.test(n)) return "trinket";
    if (/espada|sword|machado|axe|clava|club|martelo|hammer|adaga|dagger|lanca|spear|arco|bow|besta|crossbow|varinha|wand|cajado|rod|staff|fist|punho|sai|blade|lamina/.test(n)) return "weapon";
    return null;
  };

  const parseCmpItem = (cell) => {
    const raw = cell?.dataset?.cmpitem;
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      const rarity = Number.isFinite(Number(o.tier)) ? Math.max(0, Math.min(5, Number(o.tier))) : null;
      const ftier = Number.isFinite(Number(o.ftier)) ? Math.max(0, Math.min(10, Number(o.ftier))) : 0;
      const up = Number.isFinite(Number(o.upLevel)) ? Math.max(0, Number(o.upLevel)) : 0;
      return {
        rarity, ftier, up, name: o.name || null, hash: o.hash || null,
        attrs: o.attrs || o.attributes || o.stats || o.bonuses || null,
      };
    } catch (_) { return null; }
  };

  const parseTipHtml = (tiphtml) => {
    const out = { rarity: null, rarityName: null, ftier: null, up: null, slot: null, typeText: null };
    if (!tiphtml) return out;
    const s = String(tiphtml);
    let m = s.match(/tt-rarity[^>]*>([^<]+)</i);
    if (m) {
      out.rarityName = m[1].trim();
      const r = rarityFromName(m[1]);
      if (r != null) out.rarity = r;
    }
    // Linha Tier (forja, via Nee/EY: "3 (12.5% ...)" ou "0")
    m = s.match(/Tier\s*[:\-]?\s*(\d{1,2})/i);
    if (m) out.ftier = Math.max(0, Math.min(10, parseInt(m[1], 10)));
    // Linha Upgrade +N
    m = s.match(/Upgrade\s*[:+]?\s*\+?(\d{1,2})/i);
    if (m) out.up = Math.max(0, parseInt(m[1], 10));
    // tt-name "Nome +N"
    if (out.up == null) {
      m = s.match(/tt-name[^>]*>([^<]+)</i);
      if (m) {
        const u = m[1].match(/\+(\d{1,2})/);
        if (u) out.up = Math.max(0, parseInt(u[1], 10));
      }
    }
    // Linha Type (XCe)
    m = s.match(/Type\s*<\/span>\s*<span[^>]*>([^<]+)</i);
    if (m) {
      out.typeText = m[1].trim();
      out.slot = slotFromTypeText(m[1]);
    } else {
      // fallback genérico: procura qualquer texto de tipo conhecido dentro do tooltip
      const txt = s.replace(/<[^>]+>/g, " ");
      const sl = slotFromTypeText(txt);
      if (sl) { out.slot = sl; out.typeText = txt.slice(0, 60); }
    }
    return out;
  };

  const cellForgeLabel = (cell) => {
    const el = cell.querySelector?.(".item-tier-label");
    if (!el) return null;
    const n = parseInt((el.textContent || "").trim(), 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : null;
  };
  const cellUpLabel = (cell) => {
    const el = cell.querySelector?.(".item-upgrade-label");
    if (!el) return null;
    const m = (el.textContent || "").match(/(\d{1,2})/);
    return m ? Math.max(0, parseInt(m[1], 10)) : null;
  };

  // Extrai {rarity, ftier, up, slot, name} de uma célula (sem abrir modal).
  const describeCell = (cell) => {
    const img = cell.querySelector?.("img");
    const name = (img?.alt || cell.title || cell.dataset?.tip || "").trim();
    const cmp = parseCmpItem(cell);
    const tip = parseTipHtml(cell.dataset?.tiphtml || "");
    let rarity = null;
    const dt = Number(cell.dataset?.tier);
    if (Number.isFinite(dt) && dt >= 0 && dt <= 5) rarity = dt;
    if (rarity == null && tip.rarity != null) rarity = tip.rarity;
    if (rarity == null && cmp?.rarity != null) rarity = cmp.rarity;
    if (rarity == null) {
      const fromName = rarityFromName(name);
      if (fromName != null) rarity = fromName;
    }
    let ftier = cellForgeLabel(cell);
    if (ftier == null && tip.ftier != null) ftier = tip.ftier;
    if (ftier == null && cmp) ftier = cmp.ftier || 0;
    if (ftier == null) ftier = 0;
    let up = cellUpLabel(cell);
    if (up == null && tip.up != null) up = tip.up;
    if (up == null && cmp) up = cmp.up || 0;
    if (up == null) up = 0;
    let slot = tip.slot || null;
    if (!slot && name) slot = slotFromName(name);
    return { name, rarity, ftier, up, slot, tip, cmp };
  };

  const profileElement = norm(preferredElement);
  const profileProtection = norm(preferredProtection || preferredElement);
  const buildBonus = (d) => {
    const blob = norm([
      d?.name || "", d?.tip?.typeText || "", d?.cmp?.attrs || "",
      d?.cmp?.name || "", d?.cmp?.stats || "",
    ].join(" "));
    let bonus = 0;
    // Usa o elemento observado apenas como preferência de desempate: não
    // inventa uma resistência que o servidor não forneceu.
    if (profileElement && blob.includes(profileElement)) bonus += 60;
    if (profileProtection && blob.includes(profileProtection)) bonus += 30;
    if (/resist|resistencia|defense|defesa|armor|armadura|health|hp/.test(blob)) bonus += 12;
    return bonus;
  };
  const scoreOf = (d) => (d.rarity ?? -1) * 1000 + (d.ftier || 0) * 10 + (d.up || 0) + buildBonus(d);
  const fmtItem = (d) => {
    const r = d.rarity != null ? `${RARITY_NAME[d.rarity] ?? "R" + d.rarity}` : "?";
    return `${(d.name || "item").slice(0, 40)} [${r} R${d.rarity ?? "?"} T${d.ftier ?? 0}+${d.up ?? 0} ${d.slot || "?"}]`;
  };

  const junk = /potion|rune|gold coin|platinum|crystal coin|bag|backpack|glooth bag|food|meat|ham|mushroom|berry|fish|bread|cheese|cake|pie|cookie|stamina|exercise|training|dummy|deco|furniture|plant|seed|key|map|letter|scroll|contract|ticket|token|charm|prey card|boss pass|houserent|house|mount|outfit|aura/i;
  // Consumíveis de combate nunca são equipamento (ammo não tem raridade e não é consumida por tiro — vai no quiver).
  const neverEquip = /ammo|bolt|arrow|quiver|throwing|spear|blast|burst|healing rune|mana rune|antidote|lifefluid|flask|vial/i;

  const closeItem = () => {
    const modal = document.getElementById("item-modal");
    if (modal && !modal.classList.contains("hidden")) {
      const c = document.getElementById("item-modal-close");
      if (c) c.click();
      else modal.classList.add("hidden");
    }
    document.querySelectorAll(".ctx-menu").forEach((m) => m.remove());
  };

  const equipBtn = (root) => Array.from((root || document).querySelectorAll("button, .ghost-btn"))
    .find((b) => vis(b) && !b.disabled && /^(equipar|equip)$/i.test((b.textContent || "").trim()));

  // --- Snapshot do equipado atual (células fora de backpack/inv = gear do char exibido) ---
  const allCells = Array.from(document.querySelectorAll(".cell, [data-tier], [data-cmpitem]"));
  const isBagCell = (cell) => !!cell.closest?.("#backpack-grid, #inv-grid, #supplypouch-grid");
  const equippedBySlot = {}; // slot -> {score, desc}
  for (const cell of allCells) {
    if (isBagCell(cell)) continue;
    if (!cell.dataset?.cmpitem && !cell.dataset?.tiphtml) continue;
    // gear costuma viver em #skills-panel-body / .sk-gear / .equip-* — exige ancestral plausível
    const gearRoot = cell.closest?.("#skills-panel-body, .sk-gear, [id*='gear'], [class*='gear'], [id*='equip'], [class*='equip'], #party-modal, #char-modal");
    if (!gearRoot) continue;
    const d = describeCell(cell);
    if (d.slot == null || d.rarity == null) continue;
    if (d.slot === "ammo" || d.slot === "backpack") continue;
    const s = scoreOf(d);
    if (!equippedBySlot[d.slot] || s > equippedBySlot[d.slot].score) {
      equippedBySlot[d.slot] = { score: s, desc: fmtItem(d) };
    }
  }

  // --- Candidatos: backpack + loot pouch (inv-grid) ---
  const bagCells = Array.from(document.querySelectorAll(
    "#backpack-grid .cell, #backpack-grid [data-tier], #backpack-grid [data-cmpitem], " +
    "#inv-grid .cell, #inv-grid [data-tier], #inv-grid [data-cmpitem]"
  ));
  const cands = [];
  const seen = new Set();
  for (const cell of bagCells) {
    if (!vis(cell) && !vis(cell.querySelector?.("img"))) continue;
    const d = describeCell(cell);
    if (!d.name) continue;
    if (junk.test(d.name) || neverEquip.test(d.name)) continue;
    if (d.slot == null) continue; // sem slot = não equipável (Item genérico, material, stack)
    if (d.slot === "ammo" || d.slot === "backpack") continue;
    if (d.rarity == null) continue; // sem raridade não dá p/ comparar
    if (d.rarity < 3) continue; // guarda SOMENTE épico(3)/lendário(4)/mítico(5); resto vai p/ lootfilter+venda
    const key = (d.cmp?.hash) || (d.name + "|R" + d.rarity + "|T" + d.ftier + "|U" + d.up + "|" + d.slot);
    if (seen.has(key)) continue;
    seen.add(key);
    const s = scoreOf(d);
    const cur = equippedBySlot[d.slot];
    cands.push({ cell, d, score: s, cur });
  }
  cands.sort((a, b) => b.score - a.score);

  if (job === "inspect") {
    return {
      ok: true,
      candidates: cands.slice(0, 12).map((c) => ({
        hash: c.d.cmp?.hash || null,
        name: c.d.name,
        slot: c.d.slot,
        rarity: c.d.rarity,
        tier: c.d.ftier,
        up: c.d.up,
        score: c.score,
        equippedScore: c.cur?.score || 0,
        attrs: c.d.cmp?.attrs || "",
      })),
      equippedSlots: equippedBySlot,
    };
  }

  const approved = new Set((Array.isArray(approvedHashes) ? approvedHashes : []).map(String));
  if (approved.size > 0) {
    for (let i = cands.length - 1; i >= 0; i--) {
      if (!approved.has(String(cands[i].d.cmp?.hash || ""))) cands.splice(i, 1);
    }
  }

  if (!cands.length) {
    closeItem();
    return { ok: true, action: "nada_para_equipar", equipped: [], equippedSlots: equippedBySlot, events };
  }

  let equipped = 0;
  const equippedItems = [];
  const filledThisRun = new Set();
  const cannotUseRe = /n[aã]o pode usar|cannot use|n[aã]o [eé] us[aá]vel|requ?er level|requires level|level \d+|voca[cç][aã]o|vocation|requer .*level/i;

  for (const cand of cands.slice(0, 8)) {
    if (equipped >= 4) break;
    const { cell, d, score } = cand;
    if (filledThisRun.has(d.slot)) continue; // já equipamos o melhor deste slot nesta passada
    const cur = equippedBySlot[d.slot];
    if (cur && score <= cur.score) continue; // não é upgrade — pula sem nem abrir modal

    cell.click();
    await sleep(180);
    const modal = document.getElementById("item-modal");
    if (!modal || modal.classList.contains("hidden")) continue;
    const bodyEl = document.getElementById("item-modal-body");
    const body = (bodyEl?.textContent || modal.textContent || "");
    const tiphtml = cell.dataset?.tiphtml || bodyEl?.innerHTML || "";
    // Revalida com o conteúdo do modal (tooltip completo + linha Type).
    const mtip = parseTipHtml(tiphtml);
    let mRarity = d.rarity, mFtier = d.ftier, mUp = d.up, mSlot = d.slot, mName = d.name;
    const modalCmpRaw = modal.querySelector?.("[data-cmpitem]")?.dataset?.cmpitem;
    let mCmp = null;
    if (modalCmpRaw) {
      try {
        const o = JSON.parse(modalCmpRaw);
        if (Number.isFinite(Number(o.tier))) mRarity = Math.max(0, Math.min(5, Number(o.tier)));
        if (Number.isFinite(Number(o.ftier))) mFtier = Math.max(0, Math.min(10, Number(o.ftier)));
        if (Number.isFinite(Number(o.upLevel))) mUp = Math.max(0, Number(o.upLevel));
        mCmp = o;
      } catch (_) {}
    }
    if (mtip.rarity != null) mRarity = mtip.rarity;
    if (mtip.ftier != null) mFtier = mtip.ftier;
    if (mtip.up != null) mUp = mtip.up;
    if (mtip.slot) mSlot = mtip.slot;
    // Nome no modal: "{count}x {name}{rarity} — vale {value}g" (stack) ou tt-name do equipamento.
    const titleM = body.match(/(\d+)\s*x\s+(.+?)(?:\s*[—–-]\s*vale|\n|$)/i);
    if (titleM && titleM[2] && !/vale/i.test(titleM[2])) {
      const nm = titleM[2].replace(/\s*\(.*?\)\s*/g, "").trim();
      if (nm && nm.length >= 3 && nm.length <= 60) mName = nm;
    }
    const mScore = scoreOf({
      name: mName, rarity: mRarity, ftier: mFtier, up: mUp,
      cmp: mCmp, tip: mtip,
    });
    const curNow = equippedBySlot[mSlot];
    if (cannotUseRe.test(body)) {
      events.push(`skip sem req: ${(mName || d.name).slice(0, 40)}`);
      closeItem();
      await sleep(80);
      continue;
    }
    if (mSlot == null || mSlot === "ammo" || mSlot === "backpack") {
      closeItem();
      await sleep(80);
      continue;
    }
    if (mRarity == null) {
      closeItem();
      await sleep(80);
      continue;
    }
    if (curNow && mScore <= curNow.score) {
      closeItem();
      await sleep(80);
      continue;
    }
    const btn = equipBtn(modal);
    if (!btn) {
      closeItem();
      await sleep(80);
      continue;
    }
    btn.click();
    equipped += 1;
    filledThisRun.add(mSlot);
    const prevTxt = curNow ? ` > ${curNow.desc.slice(0, 40)}` : " (slot vazio)";
    events.push(`Equipar: ${(mName || d.name).slice(0, 40)} [${RARITY_NAME[mRarity] ?? mRarity} R${mRarity} T${mFtier}+${mUp} ${mSlot}]${prevTxt}`);
    equippedItems.push({
      name: (mName || d.name).slice(0, 48),
      rarity: RARITY_NAME[mRarity] ?? String(mRarity),
      tier: mFtier,
      up: mUp,
      slot: mSlot,
      score: mScore,
    });
    equippedBySlot[mSlot] = { score: mScore, desc: `${mName} [R${mRarity} T${mFtier}+${mUp}]`, name: mName, rarity: RARITY_NAME[mRarity] ?? String(mRarity), tier: mFtier };
    await sleep(280);
    const confirm = document.getElementById("confirm-modal");
    if (confirm && !confirm.classList.contains("hidden")) {
      const yes = document.getElementById("confirm-yes");
      const txt = (document.getElementById("confirm-modal-body")?.textContent || "").toLowerCase();
      if (yes && !yes.disabled && /equipar|equip/.test(txt)) yes.click();
      else {
        const no = document.getElementById("confirm-no");
        if (no) no.click();
      }
    }
    closeItem();
    await sleep(150);
  }

  closeItem();
  if (!equipped) {
    const best = cands.slice(0, 3).map((c) => fmtItem(c.d)).join(" | ");
    if (best) events.push("sem upgrade: " + best.slice(0, 160));
    return { ok: true, action: "nada_para_equipar", equipped: equippedItems, equippedSlots: equippedBySlot, events };
  }
  return { ok: true, action: "equipou_" + equipped, equipped: equippedItems, equippedSlots: equippedBySlot, events };
}
