async ({ autoHeal = true, healBelowPct = 75, hpPotionBelowPct = 60, manaPotionBelowPct = 65 }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const events = [];

  const closePicker = () => {
    const pm = document.getElementById("picker-modal");
    const c = document.getElementById("picker-modal-close") || pm?.querySelector(".close-btn, .im-close, .modal-close");
    if (c) c.click();
    else if (pm) pm.classList.add("hidden");
  };

  const closeHelper = () => {
    const hm = document.getElementById("helper-modal");
    const c = document.getElementById("helper-modal-close") || hm?.querySelector(".close-btn, .modal-close");
    if (c) c.click();
    else if (hm) hm.classList.add("hidden");
  };

  const configureOpenedPotionPicker = async (isHp) => {
    let pm = null;
    for (let w = 0; w < 8; w++) {
      await sleep(100);
      pm = document.getElementById("picker-modal");
      if (pm && !pm.classList.contains("hidden")) break;
    }
    if (!pm || pm.classList.contains("hidden")) {
      events.push(`PICKER_${isHp ? "HP" : "MANA"}_NAO_ABRIU`);
      return false;
    }

    const actionBtns = Array.from(pm.querySelectorAll("button")).filter((b) => {
      const t = (b.textContent || "").trim().toLowerCase();
      return (t === "usar" || t === "use" || t === "em uso" || t === "equipar");
    });

    const validBtns = actionBtns.filter((b) => {
      if (b.disabled || b.classList.contains("disabled")) return false;
      const row = b.closest(".im-row, .sp-book-row, div") || b.parentElement;
      if (row && row.querySelector(".lock, .bad, .pick-wieldwarn.bad")) return false;
      return true;
    });

    if (!validBtns.length) {
      events.push(`SEM_BOTOES_VALIDOS_${isHp ? "HP" : "MANA"}`);
      closePicker();
      await sleep(150);
      return false;
    }

    const bestBtn = validBtns[validBtns.length - 1];
    const bestRow = bestBtn.closest(".im-row, .sp-book-row, div") || bestBtn.parentElement;
    const potName = (bestRow?.querySelector("b, strong, .im-name")?.textContent || bestRow?.innerText || "Potion").split("\n")[0].trim();
    const btnText = (bestBtn.textContent || "").trim().toLowerCase();

    if (btnText === "em uso") {
      events.push(`${isHp ? "HP" : "MANA"}_JA_OTIMA: ${potName}`);
      closePicker();
      await sleep(150);
      return true;
    }

    bestBtn.click();
    events.push(`EQUIPOU_${isHp ? "HP" : "MANA"}_POTION: ${potName}`);
    await sleep(250);
    closePicker();
    await sleep(150);
    return true;
  };

  const configureOpenedHealPicker = async () => {
    let pm = null;
    for (let w = 0; w < 10; w++) {
      await sleep(100);
      pm = document.getElementById("picker-modal");
      if (pm && !pm.classList.contains("hidden")) break;
    }
    if (!pm || pm.classList.contains("hidden")) return false;

    // 1. Tenta botão "Automática" no footer do modal
    const autoFooterBtn = Array.from(pm.querySelectorAll(".sp-footer button, button")).find((b) =>
      /^(autom[aá]tica|auto heal|auto)$/i.test((b.textContent || "").trim())
    );
    if (autoFooterBtn && vis(autoFooterBtn)) {
      autoFooterBtn.click();
      events.push("EQUIPOU_CURA_AUTOMATICA");
      await sleep(250);
      closePicker();
      return true;
    }

    const btns = Array.from(pm.querySelectorAll("button")).filter((b) => {
      const t = (b.textContent || "").trim().toLowerCase();
      return (t === "usar" || t === "use" || t === "em uso" || t === "ativar");
    });

    const autoBtn = btns.find((b) => {
      const row = (b.closest(".sp-book-row, .im-row, div")?.innerText || "").toLowerCase();
      return /cura autom[aá]tica/i.test(row);
    }) || btns.find((b) => {
      const row = b.closest(".sp-book-row, .im-row");
      return row && !row.classList.contains("lock") && !b.disabled && vis(b);
    }) || btns[0];

    if (autoBtn) {
      const btnText = (autoBtn.textContent || "").trim().toLowerCase();
      if (btnText === "em uso") {
        events.push("CURA_MAGIA_JA_OTIMA");
      } else if (!autoBtn.disabled) {
        autoBtn.click();
        events.push("EQUIPOU_MAGIA_CURA: " + (autoBtn.closest(".sp-book-row, div")?.innerText || "").slice(0, 30));
        await sleep(250);
      }
    }
    closePicker();
    await sleep(150);
    return true;
  };

  try {
    let helperNow = document.getElementById("helper-modal");
    if (!helperNow || helperNow.classList.contains("hidden")) {
      const tabHelper = document.getElementById("tab-helper");
      if (tabHelper) {
        tabHelper.click();
        events.push("ABRIU_HELPER");
        for (let i = 0; i < 10; i++) {
          await sleep(100);
          helperNow = document.getElementById("helper-modal");
          if (helperNow && !helperNow.classList.contains("hidden")) break;
        }
      }
    }

    if (!helperNow || helperNow.classList.contains("hidden")) {
      return { ok: false, reason: "sem_helper_modal", events };
    }

    const curaTab = Array.from(helperNow.querySelectorAll(".helper-menubtn, button"))
      .find((b) => /^(cura|healing)$/i.test((b.textContent || "").replace(/[^\wáàâãéêíóôõúç ]/gi, "").trim()));
    if (curaTab && !curaTab.classList.contains("on")) {
      curaTab.click();
      events.push("ABA_CURA");
      await sleep(250);
      helperNow = document.getElementById("helper-modal") || helperNow;
    }

    const memberChips = Array.from(helperNow.querySelectorAll("button.bar-char")).filter(b => !b.classList.contains("benched"));
    const slotsCount = memberChips.length > 0 ? memberChips.length : 1;

    const setSelect = (sel, targetPct, label) => {
      if (sel && String(sel.value) !== String(targetPct)) {
        sel.value = String(targetPct);
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        events.push(`SETOU_PCT_${label}_${targetPct}%`);
      }
    };

    const getRow = (regex) => {
      const labels = Array.from(helperNow.querySelectorAll(".helper-flabel, .helper-check, label, b, span"));
      for (const lab of labels) {
        if (!regex.test(lab.textContent || "")) continue;
        let p = lab.parentElement;
        if (!p) continue;
        let btn = p.querySelector(".helper-spellbtn, button");
        let sel = p.querySelector("select.helper-sel, select");
        if (!btn || !sel) {
          let cur = lab.nextElementSibling;
          while (cur && (!btn || !sel)) {
            if (!btn && (cur.classList?.contains("helper-spellbtn") || cur.tagName === "BUTTON")) btn = cur;
            if (!sel && (cur.tagName === "SELECT" || cur.classList?.contains("helper-sel"))) sel = cur;
            cur = cur.nextElementSibling;
          }
        }
        if (btn || sel) return { lab, btn, sel };
      }
      return { lab: null, btn: null, sel: null };
    };

    for (let slotIdx = 0; slotIdx < slotsCount; slotIdx++) {
      if (memberChips[slotIdx] && !memberChips[slotIdx].classList.contains("active")) {
        memberChips[slotIdx].click();
        events.push(`SLOT_${slotIdx}_SELECIONADO`);
        await sleep(250);
        helperNow = document.getElementById("helper-modal") || helperNow;
      }

      const grid = helperNow.querySelector(".helper-healgrid") || helperNow;
      const allSelects = Array.from(grid.querySelectorAll("select.helper-sel, select"));
      const allSpellBtns = Array.from(grid.querySelectorAll(".helper-spellbtn, button:not(.helper-menubtn):not(.bar-char):not(.close-btn):not(.modal-close)"));

      const rowMagia = getRow(/magia/i);
      const rowHp = getRow(/po[cç][aã]o hp|hp pot/i);
      const rowMana = getRow(/po[cç][aã]o mp|mp pot/i);

      const healSel = rowMagia.sel || allSelects[0];
      const healBtn = rowMagia.btn || allSpellBtns[0];

      const hpSel = rowHp.sel || allSelects[1];
      const hpBtn = rowHp.btn || allSpellBtns[1];

      const manaSel = rowMana.sel || allSelects[2];
      const manaBtn = rowMana.btn || allSpellBtns[2];

      if (autoHeal) {
        const magiaCheck = grid.querySelector('input[type="checkbox"]');
        if (magiaCheck && !magiaCheck.checked) {
          magiaCheck.click();
          events.push(`SLOT_${slotIdx}: ATIVOU_MAGIA_CURA`);
          await sleep(100);
        }
      }

      setSelect(healSel, healBelowPct, `CURA_SLOT_${slotIdx}`);
      setSelect(hpSel, hpPotionBelowPct, `HP_SLOT_${slotIdx}`);
      setSelect(manaSel, manaPotionBelowPct, `MANA_SLOT_${slotIdx}`);

      if (healBtn && autoHeal) {
        const txtHeal = (healBtn.textContent || "").trim().toLowerCase();
        if (txtHeal === "nenhuma" || txtHeal === "none" || !txtHeal) {
          healBtn.click();
          await configureOpenedHealPicker();
        }
      }

      if (hpBtn) {
        hpBtn.click();
        await configureOpenedPotionPicker(true);
      }

      if (manaBtn) {
        manaBtn.click();
        await configureOpenedPotionPicker(false);
      }
    }

    closeHelper();
    return { ok: true, events };
  } catch (err) {
    closePicker();
    closeHelper();
    return { ok: false, error: String(err), events };
  }
};
