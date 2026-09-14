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
  const lvlEls = document.querySelectorAll(".cyc-char-lvl, .pm-pc-meta, .pm-char-meta");
  for (const el of lvlEls) {
    const m = (el.textContent || "").match(lvlRe);
    const n = m ? parseInt(m[1], 10) : 0;
    if (n > maxLvl && n < 2000) maxLvl = n;
  }
  if (maxLvl > 0) res.level = maxLvl;

  const goldEl = document.querySelector(".hud-money") || document.querySelector(".mk-goldamt") || document.querySelector(".ac-wallet-val");
  if (goldEl) {
    const g = nums(goldEl.textContent);
    if (g != null) res.gold = g;
  }
  if (res.gold == null) {
    const gm = document.getElementById("gold-count");
    if (gm) res.gold = nums(gm.textContent);
  }

  const stamEl = document.getElementById("stamina-time");
  if (stamEl) res.stamina = stamEl.textContent.trim();

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
    const autoRe = /cura autom[aá]tica|exura|healing/i;
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
  return res;
}
