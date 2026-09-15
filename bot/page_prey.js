async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const events = [];

  const revealTab = (id) => {
    const tab = document.getElementById(id);
    if (!tab) return null;
    const sub = tab.closest(".tab-submenu");
    if (sub) sub.hidden = false;
    const group = tab.closest(".tab-group");
    if (group) {
      group.classList.add("open");
      const trg = group.querySelector(".tab-group-trigger");
      if (trg) trg.setAttribute("aria-expanded", "true");
    }
    return tab;
  };

  const closePrey = () => {
    const modal = document.getElementById("prey-modal");
    if (!modal || modal.classList.contains("hidden")) return;
    const c = document.getElementById("prey-modal-close");
    if (c) c.click();
    else modal.classList.add("hidden");
  };

  const tab = revealTab("tab-prey");
  if (!tab) return { ok: false, skip: "sem tab-prey", events };
  tab.click();
  events.push("abriu Prey");
  await sleep(450);

  const modal = document.getElementById("prey-modal");
  if (!modal || modal.classList.contains("hidden")) {
    return { ok: false, skip: "prey-modal nao abriu", events };
  }

  const goldish = /reroll da lista|get prey cards|procurar criatura|trocar o bônus|trocar o bonus|lock prey|auto bonus/i;
  const unsafe = Array.from(modal.querySelectorAll("button")).filter((b) => goldish.test(b.textContent || "") || goldish.test(b.className || ""));
  unsafe.forEach(() => {});

  const cells = Array.from(modal.querySelectorAll(".prey-cell")).filter((c) => vis(c) && !c.disabled && !c.classList.contains("blocked"));
  const selected = cells.find((c) => c.classList.contains("sel")) || cells[0];
  if (selected && !selected.classList.contains("sel")) {
    selected.click();
    events.push("destacou criatura gratis");
    await sleep(220);
  }

  const selectBtn = Array.from(modal.querySelectorAll("button.prey-selectbtn, button")).find((b) => {
    if (!vis(b) || b.disabled) return false;
    const t = (b.textContent || "").trim();
    return /selecionar/i.test(t) && !/card|gold|reroll/i.test(t);
  });
  if (selectBtn) {
    selectBtn.click();
    events.push("Selecionar criatura (gratis)");
    await sleep(300);
  } else {
    events.push("sem acao gratis (slot ativo ou lista vazia)");
  }

  closePrey();
  return { ok: true, action: events[events.length - 1], events };
}
