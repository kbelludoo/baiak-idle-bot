async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const events = [];
  const junk = /potion|rune|gold coin|platinum|crystal coin|bag|backpack|ammo|bolt|arrow|spear|throwing|food|meat|ham/i;

  const closeItem = () => {
    const modal = document.getElementById("item-modal");
    if (modal && !modal.classList.contains("hidden")) {
      const c = document.getElementById("item-modal-close");
      if (c) c.click();
      else modal.classList.add("hidden");
    }
  };

  const equipBtn = (root) => Array.from((root || document).querySelectorAll("button, .ghost-btn"))
    .find((b) => vis(b) && !b.disabled && /^(equipar|equip)$/i.test((b.textContent || "").trim()));

  const cells = Array.from(document.querySelectorAll(
    "#backpack-grid .cell, #backpack-grid [data-tier], #inv-grid .cell, #inv-grid [data-tier], .sk-gear .cell"
  ));
  let equipped = 0;
  const seen = new Set();

  for (const cell of cells) {
    if (equipped >= 4) break;
    if (!vis(cell) && !vis(cell.querySelector("img"))) continue;
    const img = cell.querySelector("img");
    const name = (img?.alt || cell.title || cell.dataset.tiphtml || "").slice(0, 80);
    if (junk.test(name)) continue;
    const tier = Number(cell.dataset.tier);
    if (Number.isFinite(tier) && tier < 2) continue;
    const key = name + ":" + (cell.dataset.hash || cell.dataset.tier || "");
    if (seen.has(key)) continue;
    seen.add(key);

    cell.click();
    await sleep(260);
    const modal = document.getElementById("item-modal");
    if (!modal || modal.classList.contains("hidden")) continue;
    const body = (document.getElementById("item-modal-body")?.innerText || modal.innerText || "");
    if (/n[aã]o pode usar|cannot use|vocação\/level/i.test(body)) {
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
    events.push("Equipar: " + (name || "item").slice(0, 48));
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
  if (!equipped) return { ok: true, action: "nada_para_equipar", events };
  return { ok: true, action: "equipou_" + equipped, events };
}
