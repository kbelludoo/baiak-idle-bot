({ metaAoe, metaStrike, healWords, manaWords, need, job, slot }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const txt = (el) => (el?.innerText || el?.textContent || "").toLowerCase();
  const events = [];

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
        if (!txt(row).includes(word)) continue;
        const btn = useOf(row);
        if (btn && vis(btn) && (btn.textContent || "").trim().toLowerCase() !== "em uso") {
          btn.click();
          return { ok: true, picked: word, method, events };
        }
      }
    }
    return null;
  };

  const pickFirstUse = (method) => {
    const anyUse = Array.from(picker.querySelectorAll("button")).find((b) => {
      const t = (b.textContent || "").trim().toLowerCase();
      return (t === "usar" || t === "use") && !b.disabled && vis(b);
    });
    if (anyUse) {
      anyUse.click();
      return { ok: true, picked: (anyUse.closest("div")?.innerText || "").slice(0, 48), method, events };
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
      clickTab(/^(cura|heal|magia)$/i);
      const hit = pickByWords(
        ["cura automática", ...(healWords || []), "exura", "light healing", "wound cleansing"],
        "heal"
      ) || pickFirstUse("first-heal");
      if (hit) return hit;
    } else if (kind === "mana") {
      const hit = pickByWords(
        [...(manaWords || []), "great mana", "strong mana", "mana potion", "ultimate mana"],
        "mana"
      ) || pickFirstUse("first-mana");
      if (hit) return hit;
    } else if (kind === "hp") {
      const hit = pickByWords(["great health", "strong health", "health potion", "ultimate health"], "hp")
        || pickFirstUse("first-hp");
      if (hit) return hit;
    }
    closePicker();
    return { ok: false, reason: "no-use", kind, events };
  }

  const wantSlot = Number.isFinite(Number(slot)) ? Number(slot) : null;
  if (job === "fill" || job === "open-slot" || (!job && !pickerOpen)) {
    const slots = wantSlot != null ? [wantSlot] : [0, 1];
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
    const helper = document.getElementById("helper-modal");
    const tab = document.getElementById("tab-helper");
    if (helper && helper.classList.contains("hidden") && tab) {
      tab.click();
      events.push("ABRIU_HELPER");
      return { ok: true, method: "open-helper", events };
    }
    if (helper && !helper.classList.contains("hidden")) {
      const curaTab = Array.from(helper.querySelectorAll(".helper-menubtn, button"))
        .find((b) => /^(cura|healing)$/i.test((b.textContent || "").replace(/[^\wáàâãéêíóôõúç ]/gi, "").trim()));
      if (curaTab && !curaTab.classList.contains("on")) {
        curaTab.click();
        events.push("HELPER_TAB_CURA");
        return { ok: true, method: "helper-tab", events };
      }
      const chars = Array.from(helper.querySelectorAll("button.bar-char")).filter((b) => !b.classList.contains("benched"));
      if (wantSlot != null && chars[wantSlot] && !chars[wantSlot].classList.contains("active")) {
        chars[wantSlot].click();
        events.push(`HELPER_CHAR_SLOT_${wantSlot}`);
        return { ok: true, method: "helper-char", slot: wantSlot, events };
      }
      const labels = Array.from(helper.querySelectorAll(".helper-flabel, .helper-check"));
      const clickNear = (re, missingRe) => {
        for (const lab of labels) {
          if (!re.test(lab.textContent || "")) continue;
          const row = lab.parentElement || lab;
          const btn = row.querySelector(".helper-spellbtn") || lab.nextElementSibling;
          const t = (btn?.textContent || "").toLowerCase();
          if (btn && vis(btn) && (!missingRe || missingRe.test(t))) {
            btn.click();
            return t.slice(0, 40);
          }
        }
        return null;
      };
      if (need === "heal") {
        const magiaBtn = Array.from(helper.querySelectorAll(".helper-spellbtn")).find((b) => vis(b) && /cura|exura|nenhuma|autom[aá]tica/i.test(b.textContent || ""));
        if (magiaBtn) {
          magiaBtn.click();
          events.push("CLICOU_CURA_HELPER");
          return { ok: true, method: "open-heal", events };
        }
      }
      if (need === "mana") {
        const hit = clickNear(/po[cç][aã]o mp|mana/i, /nenhuma|none/);
        if (hit != null) {
          events.push("CLICOU_MANA_HELPER: " + hit);
          return { ok: true, method: "open-mana", events };
        }
      }
      if (need === "hp") {
        const hit = clickNear(/po[cç][aã]o hp|vida/i, /nenhuma|none/);
        if (hit != null) {
          events.push("CLICOU_HP_HELPER: " + hit);
          return { ok: true, method: "open-hp", events };
        }
      }
      return { ok: false, reason: "helper-nothing", events };
    }
  }

  return { ok: false, reason: "idle", events };
}
