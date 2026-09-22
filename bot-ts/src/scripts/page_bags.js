async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const events = [];

  const findBags = () => Array.from(document.querySelectorAll(
    '#backpack-grid img[alt="glooth bag"], #inv-grid img[alt="glooth bag"], img[alt="glooth bag" i]'
  )).filter((img) => vis(img) || vis(img.parentElement));

  const clickOpen = (root) => {
    const nodes = Array.from((root || document).querySelectorAll("button, .btn, [role='button'], .ctx-menu button, .ctx-menu div"));
    const all = nodes.find((b) => vis(b) && !b.disabled && /abrir tudo|open all/i.test(b.textContent || ""));
    if (all) {
      all.click();
      return "abrir_tudo";
    }
    const one = nodes.find((b) => vis(b) && !b.disabled && /^(abrir|open)$/i.test((b.textContent || "").trim()));
    if (one) {
      one.click();
      return "abrir";
    }
    return null;
  };

  const closeItem = () => {
    const modal = document.getElementById("item-modal");
    if (modal && !modal.classList.contains("hidden")) {
      const c = document.getElementById("item-modal-close");
      if (c) c.click();
      else modal.classList.add("hidden");
    }
    document.querySelectorAll(".ctx-menu").forEach((m) => m.remove());
  };

  let opened = 0;
  try {
    for (let n = 0; n < 2; n++) {
      const bags = findBags();
      if (!bags.length) break;
      const img = bags[0];
      const cell = img.closest(".cell, [class*='cell'], #backpack-grid > *, #inv-grid > *") || img;
      cell.click();
      await sleep(100);
      let how = clickOpen(document.getElementById("item-modal")) || clickOpen(document.querySelector(".ctx-menu")) || clickOpen(document);
      if (!how) {
        cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        await sleep(100);
        how = clickOpen(document.querySelector(".ctx-menu")) || clickOpen(document);
      }
      if (!how) {
        events.push("bag visivel mas sem Abrir");
        break;
      }
      opened += 1;
      events.push(how + " glooth bag");
      await sleep(150);
      closeItem();
      await sleep(80);
    }
  } finally {
    closeItem();
  }

  if (!opened && !findBags().length) {
    return { ok: true, action: "sem_bags", events };
  }
  return { ok: opened > 0, action: opened ? ("abriu_" + opened) : "falhou", opened, events };
}
