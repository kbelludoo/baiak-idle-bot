async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const events = [];

  const abo = document.getElementById("autoboss-overlay");
  const aboOn = !!(abo && !abo.classList.contains("hidden"));
  const wave = (document.getElementById("wave-title")?.textContent || "").trim();
  const waveSub = (document.getElementById("wave-sub")?.textContent || "").trim();
  if (aboOn && /auto\s*boss|boss/i.test((abo.textContent || "") + wave)) {
    return { ok: true, action: "autoboss_ja_ativo", events: ["overlay visivel"] };
  }

  // Se estiver em combate ativo numa wave de hunt, NÃO interrompe abrindo menu de teleporte
  const isSafeZone = /cidade|city|templo|temple|treino|safe/i.test(wave + " " + waveSub);
  if (!isSafeZone && /wave\s*\d+/i.test(waveSub)) {
    return { ok: true, skip: "em_combate_hunt", events: [`hunt ativa (${wave} - ${waveSub}) - boss ignorado mid-wave`] };
  }

  const clickStart = (root) => {
    const btns = Array.from((root || document).querySelectorAll("button, .boss-fight"));
    const start = btns.find((b) => vis(b) && !b.disabled && /iniciar auto boss|start auto boss/i.test(b.textContent || ""));
    if (start) {
      start.click();
      events.push("Iniciar Auto Boss");
      return true;
    }
    const fight = btns.find((b) => {
      if (!vis(b) || b.disabled) return false;
      const cell = b.closest(".boss-cell, .boss-pane-list > *");
      if (cell && cell.classList.contains("locked")) return false;
      const t = (b.textContent || "").trim();
      return b.classList.contains("boss-fight") && !/parar|stop|cancelar|comprar|buy/i.test(t);
    });
    if (fight) {
      fight.click();
      events.push("boss-fight: " + (fight.textContent || "").trim().slice(0, 40));
      return true;
    }
    return false;
  };

  const modal0 = document.getElementById("boss-modal");
  if (modal0 && !modal0.classList.contains("hidden")) {
    if (clickStart(modal0)) {
      await sleep(400);
      return { ok: true, action: events[0], events };
    }
  }

  const picker = document.getElementById("picker-modal");
  if (picker && !picker.classList.contains("hidden")) {
    const title = (picker.querySelector(".im-title")?.textContent || "").toLowerCase();
    if (!/boss|chefe/.test(title)) {
      const closeBtn = picker.querySelector("#picker-modal-close, .im-close, .close-btn, .modal-close");
      if (closeBtn) closeBtn.click();
      await sleep(250);
    }
  }

  const waveTitle = document.getElementById("wave-title");
  if (!waveTitle) return { ok: false, reason: "no-wave-title", events };
  waveTitle.click();
  for (let i = 0; i < 14; i++) {
    await sleep(120);
    const tp = document.getElementById("teleport-menu");
    if (tp && !tp.classList.contains("hidden")) break;
  }
  const bossTp = document.querySelector('#teleport-menu .tp-opt[data-tp="boss"]')
    || Array.from(document.querySelectorAll("#teleport-menu .tp-opt, button.tp-opt"))
      .find((b) => /chefes|^bosses?$/i.test((b.textContent || "").trim()));
  if (!bossTp) {
    return { ok: false, reason: "no-boss-tp", events };
  }
  if (bossTp.disabled) {
    return { ok: false, skip: "chefe bloqueado (party/cargas?)", events };
  }
  bossTp.click();
  events.push("abriu Chefes");
  await sleep(450);

  let modal = document.getElementById("boss-modal");
  for (let i = 0; i < 10 && (!modal || modal.classList.contains("hidden")); i++) {
    await sleep(150);
    modal = document.getElementById("boss-modal");
  }
  if (modal && !modal.classList.contains("hidden")) {
    if (!clickStart(modal)) {
      events.push("playlist vazia ou sem fight livre");
    }
    await sleep(300);
    const closer = document.getElementById("boss-modal-close");
    if (closer && vis(closer)) closer.click();
  } else {
    events.push("boss-modal nao abriu");
  }
  return { ok: events.some((e) => /Iniciar|boss-fight/i.test(e)), action: events[0] || "noop", events };
}
