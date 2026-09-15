async ({ metaAoe, metaStrike, healWords, manaWords, need, job, slot }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const txt = (el) => (el?.innerText || el?.textContent || "").toLowerCase();
  const events = [];
  const wantSlot = Number.isFinite(Number(slot)) ? Number(slot) : null;
  const noneRe = /^(nenhuma|none)$/i;
  const autoHealRe = /cura autom[aá]tica|exura|light healing|wound cleansing|spirit mend|mend|cleansing|san|ico|cura/i;

  const picker = document.getElementById("picker-modal");
  const pickerOpen = !!(picker && !picker.classList.contains("hidden"));
  const title = (picker?.querySelector(".im-title")?.textContent || "").toLowerCase();

  const detectNeed = () => {
    if (/cura pr[oó]pria|heal/.test(title)) return "heal";
    if (/potion de mana|po[cç][aã]o mp/.test(title)) return "mana";
    if (/potion de vida|po[cç][aã]o hp/.test(title)) return "hp";
    if (/rota|magia|spell/.test(title) || picker?.querySelector(".im-card.sp-mode")) return "aoe";
    return need || "aoe";
  };

  const useOf = (root) => Array.from(root.querySelectorAll("button")).find((b) => {
    const t = (b.textContent || "").trim().toLowerCase();
    return (t === "usar" || t === "use" || t === "em uso") && !b.disabled;
  });

  const clickTab = (re) => {
    const tab = Array.from(picker.querySelectorAll("button, .sp-tab, .sp-tabs button"))
      .find((b) => re.test((b.textContent || "").trim()));
    if (tab && !tab.classList.contains("on")) tab.click();
    return !!tab;
  };

  const pickByWords = (words, method) => {
    const rows = Array.from(picker.querySelectorAll(".sp-book-row, .im-row, .stage-row, [class*='sp-']"));
    const prefer = (words || []).map((s) => String(s).toLowerCase());
    for (const word of prefer) {
      for (const row of rows) {
        const blob = txt(row);
        if (!blob.includes(word) || /n[aã]o bebe|nenhuma \(/.test(blob)) continue;
        const btn = useOf(row);
        const bt = (btn?.textContent || "").trim().toLowerCase();
        if (btn && vis(btn) && bt !== "em uso" && bt !== "remover" && bt !== "ativar") {
          btn.click();
          return { ok: true, picked: word, method, slot: wantSlot, events };
        }
      }
    }
    return null;
  };

  const pickFirstUse = (method) => {
    const anyUse = Array.from(picker.querySelectorAll("button")).find((b) => {
      const t = (b.textContent || "").trim().toLowerCase();
      const row = (b.closest(".sp-book-row, .im-row")?.innerText || "").toLowerCase();
      return (t === "usar" || t === "use") && !b.disabled && vis(b) && !/n[aã]o bebe|nenhuma \(/.test(row);
    });
    if (anyUse) {
      anyUse.click();
      return { ok: true, picked: (anyUse.closest("div")?.innerText || "").slice(0, 48), method, slot: wantSlot, events };
    }
    return null;
  };

  const closePicker = () => {
    const closeBtn = picker?.querySelector("#picker-modal-close, .im-close, .close-btn, .modal-close");
    if (closeBtn) closeBtn.click();
    else if (picker) picker.classList.add("hidden");
  };

  if (pickerOpen && (job === "pick" || !job || /rota|magia|spell|cura|potion|po[cç][aã]o/.test(title) || picker.querySelector(".im-card.sp-mode"))) {
    const kind = detectNeed();
    if (kind === "aoe") {
      clickTab(/^(área|area)$/i);
      const hit = pickByWords([...(metaAoe || []), ...(metaStrike || [])], "meta-aoe")
        || pickFirstUse("first-aoe");
      if (hit) return hit;
    } else if (kind === "heal") {
      clickTab(/^(cura|heal|magia|todas)$/i);
      const autoBtn = Array.from(picker.querySelectorAll("button")).find((b) =>
        /^(autom[aá]tica|auto heal)$/i.test((b.textContent || "").trim()));
      const hit = pickByWords(
        ["cura automática", ...(healWords || []), "exura", "light healing", "wound cleansing"],
        "heal"
      ) || (autoBtn && vis(autoBtn) && (autoBtn.click(), { ok: true, picked: "auto", method: "heal-auto", slot: wantSlot, events }))
        || pickFirstUse("first-heal");
      if (hit) {
        events.push(`CONFIGUROU_CURA_SLOT_${wantSlot ?? "?"}`);
        return hit;
      }
    } else if (kind === "mana") {
      const hit = pickByWords(
        [...(manaWords || []), "great mana", "strong mana", "mana potion", "ultimate mana"],
        "mana"
      ) || pickFirstUse("first-mana");
      if (hit) {
        events.push(`CONFIGUROU_MANA_SLOT_${wantSlot ?? "?"}`);
        return hit;
      }
    } else if (kind === "hp") {
      const hit = pickByWords(["great health", "strong health", "health potion", "ultimate health"], "hp")
        || pickFirstUse("first-hp");
      if (hit) return hit;
    }
    closePicker();
    return { ok: false, reason: "no-use", kind, slot: wantSlot, events };
  }

  if (job === "fill" || job === "open-slot" || (!job && !pickerOpen)) {
    const slots = wantSlot != null ? [wantSlot] : [0, 1, 2];
    for (const s of slots) {
      for (let u = 0; u < 6; u++) {
        const el = document.getElementById(`rot-${s}-${u}`);
        if (el && el.querySelector("small")) {
          el.click();
          events.push(`CLICOU_SLOT_MAGIA_VAZIO: rot-${s}-${u}`);
          return { ok: true, method: "open-rot", slot: s, u, events };
        }
      }
    }
  }

  if (job === "helper" || job === "open-helper") {
    const openHelper = async () => {
      const tab = document.getElementById("tab-helper");
      const h = document.getElementById("helper-modal");
      if (h && h.classList.contains("hidden") && tab) {
        tab.click();
        events.push("ABRIU_HELPER");
        await sleep(280);
      }
    };
    await openHelper();

    const memberBtns = () => Array.from(document.querySelectorAll("#bar-shooters .bar-member button.bar-char"));
    const helperChips = (root) => Array.from((root || document).querySelectorAll("#helper-modal button.bar-char"))
      .filter((b) => !b.classList.contains("benched"));

    if (wantSlot != null) {
      const barBtn = memberBtns()[wantSlot];
      if (barBtn && !barBtn.classList.contains("active")) {
        barBtn.click();
        events.push(`BAR_CHAR_SLOT_${wantSlot}`);
        await sleep(360);
        await openHelper();
      }
    }

    let helperNow = document.getElementById("helper-modal");
    if (!helperNow || helperNow.classList.contains("hidden")) {
      await openHelper();
      helperNow = document.getElementById("helper-modal");
    }
    if (!helperNow || helperNow.classList.contains("hidden")) {
      return { ok: false, reason: "helper-closed", slot: wantSlot, events };
    }

    const curaTab = Array.from(helperNow.querySelectorAll(".helper-menubtn, button"))
      .find((b) => /^(cura|healing)$/i.test((b.textContent || "").replace(/[^\wáàâãéêíóôõúç ]/gi, "").trim()));
    if (curaTab && !curaTab.classList.contains("on")) {
      curaTab.click();
      events.push("HELPER_TAB_CURA");
      await sleep(220);
      helperNow = document.getElementById("helper-modal") || helperNow;
    }

    if (wantSlot != null) {
      const chips = helperChips(helperNow);
      const chip = chips[wantSlot];
      if (chip && !chip.classList.contains("active")) {
        chip.click();
        events.push(`HELPER_CHAR_SLOT_${wantSlot}`);
        await sleep(360);
        helperNow = document.getElementById("helper-modal") || helperNow;
      } else if (chip) {
        events.push(`HELPER_CHAR_JA_SLOT_${wantSlot}`);
      } else {
        events.push(`HELPER_SEM_CHIP_SLOT_${wantSlot}`);
      }
      const after = helperChips(helperNow)[wantSlot];
      const barAfter = memberBtns()[wantSlot];
      const active = (after && after.classList.contains("active")) || (barAfter && barAfter.classList.contains("active"));
      if (!active) {
        document.getElementById("bar-member-next")?.click();
        events.push(`BAR_NEXT_SLOT_${wantSlot}`);
        await sleep(360);
        helperNow = document.getElementById("helper-modal") || helperNow;
      }
    }

    const magiaBox = Array.from(helperNow.querySelectorAll('input[type="checkbox"]'))
      .find((c) => /magia/i.test((c.parentElement?.textContent || "")));
    if (magiaBox && !magiaBox.checked) {
      magiaBox.click();
      events.push("HELPER_MAGIA_ON");
      await sleep(180);
    }

    const gridBtns = () => Array.from((document.getElementById("helper-modal") || helperNow)
      .querySelectorAll(".helper-healgrid .helper-spellbtn"));
    const labelOf = (re) => {
      const h = document.getElementById("helper-modal") || helperNow;
      for (const lab of h.querySelectorAll(".helper-flabel, .helper-check")) {
        if (!re.test(lab.textContent || "")) continue;
        let n = lab.nextElementSibling;
        while (n && !(n.classList && n.classList.contains("helper-spellbtn"))) n = n.nextElementSibling;
        if (n && vis(n)) return n;
      }
      return null;
    };
    const snap = () => {
      const btns = gridBtns();
      const t = (b) => (b?.textContent || "").replace(/\s+/g, " ").trim();
      const heal = t(btns[0] || labelOf(/magia/i));
      const hp = t(btns[1] || labelOf(/po[cç][aã]o hp|hp pot/i));
      const mana = t(btns[2] || labelOf(/po[cç][aã]o mp|mp pot/i));
      return {
        slot: wantSlot,
        heal: noneRe.test(heal) ? "" : heal,
        hpPotion: noneRe.test(hp) ? "" : hp,
        manaPotion: noneRe.test(mana) ? "" : mana,
        autoHeal: autoHealRe.test(heal) && !noneRe.test(heal),
        healEnabled: !(magiaBox && !magiaBox.checked)
      };
    };

    const clickBtn = (btn, ev) => {
      if (!btn || !vis(btn) || btn.disabled) return false;
      btn.click();
      events.push(ev);
      return true;
    };

    const kit = snap();
    const healMissing = !kit.heal || noneRe.test(kit.heal);
    const manaMissing = !kit.manaPotion || noneRe.test(kit.manaPotion);
    const wantHeal = need === "heal" || need === "both" || !need;
    const wantMana = need === "mana" || need === "both" || need === "heal" || !need;

    if (wantHeal && healMissing) {
      const btn = gridBtns()[0] || labelOf(/magia/i);
      if (clickBtn(btn, `CONFIGUROU_CURA_SLOT_${wantSlot}`)) {
        return { ok: true, method: "open-heal", slot: wantSlot, helper: kit, events };
      }
    }
    if (wantMana && manaMissing) {
      const btn = gridBtns()[2] || labelOf(/po[cç][aã]o mp|mp pot/i);
      if (clickBtn(btn, `CONFIGUROU_MANA_SLOT_${wantSlot}`)) {
        return { ok: true, method: "open-mana", slot: wantSlot, helper: kit, events };
      }
    }
    if (!healMissing) events.push(`CURA_JA_OK_SLOT_${wantSlot}: ${(kit.heal || "").slice(0, 40)}`);
    if (!manaMissing) events.push(`MANA_JA_OK_SLOT_${wantSlot}: ${(kit.manaPotion || "").slice(0, 40)}`);
    const ready = !healMissing && !manaMissing;
    return {
      ok: ready, method: ready ? "helper-ready" : "helper-nothing",
      reason: ready ? undefined : "helper-nothing",
      slot: wantSlot, helper: kit, events
    };
  }

  return { ok: false, reason: "idle", slot: wantSlot, events };
}
