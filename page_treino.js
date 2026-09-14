async ({ want }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const events = [];
  const wave = (document.getElementById("wave-title")?.textContent || "").trim();
  const overlay = document.getElementById("training-overlay");
  const overlayOn = !!(overlay && !overlay.classList.contains("hidden") && vis(overlay));
  const inTreino = /treino\s*online|online\s*training/i.test(wave) || overlayOn;
  const stam = (document.getElementById("stamina-time")?.textContent || "").trim();
  const pctTxt = (document.getElementById("stamina-pct")?.textContent || "").trim();

  const closePickerIfNotTrain = async () => {
    const picker = document.getElementById("picker-modal");
    if (!picker || picker.classList.contains("hidden")) return;
    const title = (picker.querySelector(".im-title")?.textContent || "").toLowerCase();
    if (/treino|exercise|dummy/.test(title)) return;
    const closeBtn = picker.querySelector("#picker-modal-close, .im-close, .close-btn, .modal-close, [data-close]");
    if (closeBtn) closeBtn.click();
    else picker.classList.add("hidden");
    events.push("fechou picker bloqueante");
    await sleep(300);
  };

  if (want !== "train") {
    return { ok: true, inTreino, wave, stamina: stam, pct: pctTxt, events };
  }
  if (inTreino) {
    return { ok: true, action: "ja_treino", inTreino: true, wave, stamina: stam, events };
  }

  await closePickerIfNotTrain();
  const waveTitle = document.getElementById("wave-title");
  if (!waveTitle) return { ok: false, reason: "no-wave-title", inTreino, events };

  waveTitle.click();
  let tpMenu = null;
  for (let i = 0; i < 14; i++) {
    await sleep(120);
    tpMenu = document.getElementById("teleport-menu");
    if (tpMenu && !tpMenu.classList.contains("hidden")) break;
  }
  const exBtn = document.querySelector('#teleport-menu .tp-opt[data-tp="exercise"]')
    || Array.from(document.querySelectorAll("#teleport-menu .tp-opt, button.tp-opt, [data-tp]"))
      .find((b) => /treino\s*online|online\s*training/i.test((b.textContent || "").trim()));
  if (!exBtn) {
    return { ok: false, reason: "no-exercise-btn", inTreino: false, events };
  }
  if (exBtn.disabled || exBtn.classList.contains("tp-cur")) {
    events.push("treino ja atual ou bloqueado");
    return { ok: true, action: "ja_treino_tp", inTreino: true, events };
  }
  exBtn.click();
  events.push("clicou Treino online");
  await sleep(500);
  const wave2 = (document.getElementById("wave-title")?.textContent || "").trim();
  return {
    ok: true,
    action: "entrou_treino",
    inTreino: /treino\s*online|online\s*training/i.test(wave2),
    wave: wave2,
    events
  };
}
