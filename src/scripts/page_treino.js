async ({ want }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const events = [];

  const findWaveTitle = () =>
    document.getElementById("wave-title")
    || document.querySelector(".stage-name, .stage-name-line, #stage-name, .wave-title")
    || document.querySelector("[title*='Teleporte' i], [aria-label*='Teleporte' i]");

  const checkInTreino = () => {
    const w = (findWaveTitle()?.textContent || "").trim();
    const ov = document.getElementById("training-overlay")
      || document.querySelector(".training-overlay, #exercise-overlay, [class*='training' i]");
    const ovOn = !!(ov && !ov.classList.contains("hidden") && vis(ov));
    return /treino|online\s*training|exercise|dummy/i.test(w) || ovOn;
  };

  const inTreino = checkInTreino();
  const wave = (findWaveTitle()?.textContent || "").trim();
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

  const openTpMenu = async () => {
    await closePickerIfNotTrain();
    const waveTitle = findWaveTitle();
    if (!waveTitle) return null;
    waveTitle.click();
    let tpMenu = null;
    for (let i = 0; i < 15; i++) {
      await sleep(100);
      tpMenu = document.getElementById("teleport-menu")
        || document.querySelector("[class*='teleport-menu' i], [id*='teleport' i]");
      if (tpMenu && !tpMenu.classList.contains("hidden")) return tpMenu;
    }
    return null;
  };

  if (want === "resume" || want === "hunt") {
    if (!inTreino) return { ok: true, action: "ja_fora_treino", inTreino: false, wave, stamina: stam, events };
    const tpMenu = await openTpMenu();
    if (!tpMenu) return { ok: false, reason: "no-tp-menu", inTreino: true, events };

    const huntsBtn = tpMenu.querySelector('.tp-opt[data-tp="hunts"]')
      || Array.from(tpMenu.querySelectorAll(".tp-opt, button.tp-opt, button, [data-tp]"))
        .find((b) => /hunts|fases|caçar/i.test((b.textContent || "").trim()));
    if (!huntsBtn) return { ok: false, reason: "no-hunts-btn", inTreino: true, events };
    huntsBtn.click();
    events.push("abriu Hunts para retomar");
    await sleep(450);
    return { ok: true, action: "retomando_hunts", inTreino: false, wave: "Hunts", events };
  }

  if (want !== "train") {
    return { ok: true, inTreino, wave, stamina: stam, pct: pctTxt, events };
  }

  if (inTreino) {
    return { ok: true, action: "ja_treino", inTreino: true, wave, stamina: stam, events };
  }

  const tpMenu = await openTpMenu();
  if (!tpMenu) return { ok: false, reason: "no-tp-menu", inTreino, events };

  const exBtn = tpMenu.querySelector('.tp-opt[data-tp="exercise"], .tp-opt[data-tp="train"], .tp-opt[data-tp="treino"]')
    || Array.from(tpMenu.querySelectorAll(".tp-opt, button.tp-opt, button, [data-tp]"))
      .find((b) => /treino|exercise|training|dummy|treinar/i.test((b.textContent || "").trim()));
  if (!exBtn) {
    return { ok: false, reason: "no-exercise-btn", inTreino: false, events };
  }
  if (exBtn.disabled || exBtn.classList.contains("tp-cur")) {
    events.push("treino ja atual ou bloqueado");
    return { ok: true, action: "ja_treino_tp", inTreino: true, events };
  }

  exBtn.click();
  events.push("clicou Treino online");

  let inTreinoConfirmed = false;
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    if (checkInTreino()) {
      inTreinoConfirmed = true;
      break;
    }
  }

  const wave2 = (findWaveTitle()?.textContent || "").trim();
  return {
    ok: true,
    action: "entrou_treino",
    inTreino: inTreinoConfirmed || inTreino,
    wave: wave2 || "Treino Online",
    events
  };
}
