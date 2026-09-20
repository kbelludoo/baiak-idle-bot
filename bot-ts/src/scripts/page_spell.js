async ({ metaAoe, metaStrike, healWords, manaWords, need, job, slot }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // offsetParent é nulo para controles position:fixed (justamente o dock
  // usado na viewport móvel/headless). Use a geometria/estilo real para não
  // descartar o botão de rotação como se estivesse invisível.
  const vis = (el) => {
    if (!el) return false;
    if (el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0) return true;
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      return cs.position === "fixed";
    } catch (_) {
      return false;
    }
  };
  const txt = (el) => (el?.textContent || "").toLowerCase();
  const events = [];
  const wantSlot = Number.isFinite(Number(slot)) ? Number(slot) : null;
  const noneRe = /^(nenhuma|none)$/i;
  const autoHealRe = /cura autom[aá]tica|exura|light healing|wound cleansing|spirit mend|mend|cleansing|san|ico|cura/i;

  let picker = document.getElementById("picker-modal");
  const pickerOpen = !!(picker && !picker.classList.contains("hidden"));
  const title = (picker?.querySelector(".im-title")?.textContent || "").toLowerCase();

  const readRotation = () => Array.from(document.querySelectorAll('[id^="rot-"]')).map((el) => ({
    slot: parseInt((el.id.match(/^rot-(\d+)-/) || ["", "0"])[1], 10) || 0,
    u: parseInt((el.id.match(/^rot-\d+-(\d+)/) || ["", "0"])[1], 10) || 0,
    empty: !!el.querySelector("small") || /escolher magia|choose spell|slot \d+ \+/i.test(el.getAttribute("title") || ""),
    name: String(el.getAttribute("title") || el.getAttribute("aria-label") || el.textContent || "").trim(),
  }));

  // A rotação só monta os elementos rot-* enquanto a janela está aberta.
  // Abre-a sob demanda para que o HUD possa ler as magias já equipadas antes
  // de escolher qualquer slot.
  if (job === "open" || job === "scan") {
    // Algumas builds mantêm os slots rot-* montados no HUD mesmo com o
    // picker fechado. Nesse caso não abra modal nem procure um botão de
    // rotação: os títulos dos próprios slots já são a fonte autoritativa.
    const existing = readRotation();
    if (existing.some((row) => !row.empty && row.name)) {
      return { ok: true, opened: false, method: "rotation-dom", spells: existing, events };
    }
    if (pickerOpen) return { ok: true, opened: true, method: "already-open", spells: readRotation(), events };
    const closeOptionSheets = () => {
      for (const close of Array.from(document.querySelectorAll(".m-sheet-x, .m-sheet-close"))) {
        if (vis(close)) close.click();
      }
    };
    const directRot = document.querySelector(".act.rot, [class*='rotation' i], [class*='spell-rotation' i], #btn-rotation, [data-action='rotation']");
    if (directRot && vis(directRot)) {
      directRot.click();
      await sleep(250);
      const opened = document.getElementById("picker-modal");
      if (opened && !opened.classList.contains("hidden")) {
        events.push("ABRIU_ROTACAO_SLOT");
        closeOptionSheets();
        return { ok: true, opened: true, method: "rotation-slot", spells: readRotation(), events };
      }
    }
    const collectCandidates = () => {
      const actArea = document.querySelector("#actions, .hud-actions, #hud-bar, #bar-actions, #dock-actions");
      if (actArea) {
        const btns = Array.from(actArea.querySelectorAll("button, [role='button'], .btn, [title], [aria-label]"));
        if (btns.length > 0) return btns;
      }
      return Array.from(document.querySelectorAll("button.act, .act.rot, [data-action='rotation'], #spell-rotation, [class*='rotation' i]"));
    };
    const findTrigger = (all) => all.find((b) => {
      if (!vis(b) || b.disabled) return false;
      const blob = `${b.id || ""} ${b.className || ""} ${b.getAttribute("title") || ""} ${b.getAttribute("aria-label") || ""} ${(b.textContent || "")}`.toLowerCase();
      return /rotacao|rotação|spell.?rotation|magias?|spells?|combate|attack|skill/.test(blob) && !/helper|cura automatica|cura automática/.test(blob);
    });
    let candidates = collectCandidates();
    let trigger = findTrigger(candidates);
    if (trigger) {
      trigger.click();
      await sleep(250);
      const opened = document.getElementById("picker-modal");
      if (opened && !opened.classList.contains("hidden")) {
        events.push("ABRIU_ROTACAO_MAGIAS");
        closeOptionSheets();
        return { ok: true, opened: true, method: "rotation-trigger", spells: readRotation(), events };
      }
    }
    closeOptionSheets();
    return { ok: false, reason: "rotation-trigger-not-found", candidates: [], events };
  }

  const closeHelper = () => {
    const hm = document.getElementById("helper-modal");
    const c = document.getElementById("helper-modal-close") || hm?.querySelector(".close-btn, .modal-close");
    if (c) c.click();
    else if (hm) hm.classList.add("hidden");
  };

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
    // Ordena por level/mana para garantir a melhor magia desbloqueada primeiro
    const levelOf = (row) => {
      const m = (row.textContent || "").match(/lvl\s*(\d+)/i);
      return m ? parseInt(m[1], 10) : 0;
    };
    const manaOf = (row) => {
      const m = (row.textContent || "").match(/(\d+)\s*mana/i);
      return m ? parseInt(m[1], 10) : 0;
    };
    rows.sort((a, b) => {
      const lv = levelOf(b) - levelOf(a);
      if (lv !== 0) return lv;
      return manaOf(b) - manaOf(a);
    });
    const prefer = (words || []).map((s) => String(s).toLowerCase());
    for (const word of prefer) {
      for (const row of rows) {
        if (row.classList.contains("lock")) continue;
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
    const rows = Array.from(picker.querySelectorAll(".sp-book-row, .im-row, .stage-row, [class*='sp-']"))
      .filter((row) => !row.classList.contains("lock") && !/n[aã]o bebe|nenhuma \(/.test((row.textContent || "").toLowerCase()));
    const levelOf = (row) => {
      const m = (row.textContent || "").match(/lvl\s*(\d+)/i);
      return m ? parseInt(m[1], 10) : 0;
    };
    rows.sort((a, b) => levelOf(b) - levelOf(a));
    for (const row of rows) {
      const btn = useOf(row);
      const t = (btn?.textContent || "").trim().toLowerCase();
      if (btn && !btn.disabled && vis(btn) && (t === "usar" || t === "use")) {
        btn.click();
        return { ok: true, picked: (row.textContent || "").slice(0, 48), method, slot: wantSlot, events };
      }
    }
    return null;
  };

  const closePicker = () => {
    const closeBtn = picker?.querySelector("#picker-modal-close, .im-close, .close-btn, .modal-close");
    if (closeBtn) closeBtn.click();
    else if (picker) picker.classList.add("hidden");
  };

  if (pickerOpen && (job === "pick" || !job || /rota|magia|spell|cura|potion|po[cç][aã]o/.test(title) || picker.querySelector(".im-card.sp-mode"))) {
    // 1. Tenta marcar checkbox 'Só liberadas' para filtrar magias de level alto
    const onlyUnlockedCheck = picker.querySelector("input[type='checkbox']");
    if (onlyUnlockedCheck && !onlyUnlockedCheck.checked) {
      onlyUnlockedCheck.click();
      await sleep(100);
    }

    const kind = detectNeed();
    if (kind === "aoe") {
      // Tenta 1: Aba Área
      clickTab(/^(área|area)$/i);
      await sleep(100);
      let hit = pickByWords(metaAoe || [], "meta-aoe") || pickFirstUse("first-aoe");

      // Tenta 2: Aba Ataque (Strike/Single-target) se Área não tiver nenhuma magia utilizável no level
      if (!hit) {
        clickTab(/^(ataque|strike)$/i);
        await sleep(120);
        hit = pickByWords(metaStrike || [], "meta-strike") || pickFirstUse("first-strike");
      }

      // Tenta 3: Aba Todas
      if (!hit) {
        clickTab(/^(todas|all)$/i);
        await sleep(120);
        hit = pickByWords([...(metaAoe || []), ...(metaStrike || [])], "meta-all") || pickFirstUse("first-all");
      }

      if (hit) {
        events.push(`CONFIGUROU_MAGIA_ATAQUE_SLOT_${wantSlot ?? "?"}: ${hit.picked}`);
        return hit;
      }
    } else if (kind === "heal") {
      // 1. Botão Automática no footer
      const autoFooterBtn = Array.from(picker.querySelectorAll(".sp-footer button, button")).find((b) =>
        /^(autom[aá]tica|auto heal|auto)$/i.test((b.textContent || "").trim())
      );
      if (autoFooterBtn && vis(autoFooterBtn)) {
        autoFooterBtn.click();
        events.push(`CONFIGUROU_CURA_AUTOMATICA_SLOT_${wantSlot ?? "?"}`);
        return { ok: true, picked: "auto", method: "heal-auto-footer", slot: wantSlot, events };
      }

      clickTab(/^(cura|heal|magias?|todas)$/i);
      await sleep(120);
      const hit = pickByWords(
        ["cura automática", ...(healWords || []), "exura", "divine healing", "spirit mend", "wound cleansing", "light healing"],
        "heal"
      ) || pickFirstUse("first-heal");
      if (hit) {
        events.push(`CONFIGUROU_CURA_SLOT_${wantSlot ?? "?"}: ${hit.picked}`);
        return hit;
      }
    } else if (kind === "mana") {
      const hit = pickByWords(
        [...(manaWords || []), "great mana", "strong mana", "mana potion", "ultimate mana"],
        "mana"
      ) || pickFirstUse("first-mana");
      if (hit) {
        events.push(`CONFIGUROU_MANA_SLOT_${wantSlot ?? "?"}: ${hit.picked}`);
        return hit;
      }
    } else if (kind === "hp") {
      const hit = pickByWords(["great health", "strong health", "health potion", "ultimate health"], "hp")
        || pickFirstUse("first-hp");
      if (hit) {
        events.push(`CONFIGUROU_HP_SLOT_${wantSlot ?? "?"}: ${hit.picked}`);
        return hit;
      }
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
          // O clique abre o picker.  Escolher em uma chamada posterior era
          // incorreto porque o finally do loop fecha o modal e o slot ficava
          // vazio por até 10 minutos. Continue na mesma execução.
          await sleep(180);
          picker = document.getElementById("picker-modal");
          if (picker && !picker.classList.contains("hidden")) {
            const onlyUnlockedCheck = picker.querySelector("input[type='checkbox']");
            if (onlyUnlockedCheck && !onlyUnlockedCheck.checked) {
              onlyUnlockedCheck.click();
              await sleep(100);
            }
            let hit = null;
            clickTab(/^(área|area)$/i);
            await sleep(100);
            hit = pickByWords(metaAoe || [], "meta-aoe") || pickFirstUse("first-aoe");
            if (!hit) {
              clickTab(/^(ataque|strike)$/i);
              await sleep(120);
              hit = pickByWords(metaStrike || [], "meta-strike") || pickFirstUse("first-strike");
            }
            if (!hit) {
              clickTab(/^(todas|all)$/i);
              await sleep(120);
              hit = pickByWords([...(metaAoe || []), ...(metaStrike || [])], "meta-all") || pickFirstUse("first-all");
            }
            if (hit) {
              events.push(`CONFIGUROU_MAGIA_ATAQUE_SLOT_${s}: ${hit.picked}`);
              return { ...hit, slot: s, u, events };
            }
            closePicker();
            return { ok: false, reason: "no-use", slot: s, u, events };
          }
          return { ok: false, reason: "picker-not-open", slot: s, u, events };
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
    if (ready) {
      closeHelper();
    }
    return {
      ok: ready, method: ready ? "helper-ready" : "helper-nothing",
      reason: ready ? undefined : "helper-nothing",
      slot: wantSlot, helper: kit, events
    };
  }

  return { ok: false, reason: "idle", slot: wantSlot, events };
}
