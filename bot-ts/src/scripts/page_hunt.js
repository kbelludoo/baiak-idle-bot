async (target) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el ? (el.textContent || "").trim() : "");
  const visible = (el) => !!(el && (el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0 || (el.getClientRects && el.getClientRects().length > 0)));
  const waitFor = async (get, timeout = 8000, step = 200) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = get();
      if (value) return value;
      await sleep(step);
    }
    return get();
  };

  const revealRows = async () => {
    const picker = document.getElementById("picker-modal");
    const scrollRoots = [
      picker,
      picker?.querySelector(".hunt-grid, .pick-lean, .modal-body, .im-body"),
    ].filter(Boolean);
    for (const root of scrollRoots) {
      try {
        root.scrollTop = root.scrollHeight;
        root.dispatchEvent(new Event("scroll", { bubbles: true }));
      } catch (_) {}
    }
    await sleep(250);
  };

  const closePicker = () => {
    const picker = document.getElementById("picker-modal");
    if (picker && !picker.classList.contains("hidden")) {
      const closeBtn = picker.querySelector(
        "#picker-modal-close, .im-close, .close-btn, .modal-close, [data-close]"
      );
      if (closeBtn) closeBtn.click();
      else picker.classList.add("hidden");
    }
    const tp = document.getElementById("teleport-menu");
    if (tp) tp.classList.add("hidden");
  };

  const curWave = (document.getElementById("wave-title")?.textContent || document.querySelector(".bs-hunt")?.textContent || "").trim();
  const docTitle = (document.title || "").trim();
  const wantIdRaw = String((target && target.id) || "").toLowerCase().trim();
  const wantNameRaw = String((target && target.name) || "").toLowerCase().trim();

  const normalizeToken = (s) => String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_'\s]+/g, "")
    .replace(/([a-z])\1+/g, "$1") // colapsa letras repetidas (ex: dd -> d para undead-dragon vs undeadragon)
    .replace(/(s|es)$/, ""); // singulariza

  const isMatch = (str) => {
    if (!str) return false;
    const normStr = normalizeToken(str);
    if (wantIdRaw) {
      const cleanTarget = normalizeToken(wantIdRaw.replace(/-lair|-cave|-dungeon|-camp|-ground/g, ""));
      if (normStr === cleanTarget || normStr.includes(cleanTarget) || cleanTarget.includes(normStr)) return true;
    }
    if (wantNameRaw) {
      const cleanName = normalizeToken(wantNameRaw);
      if (normStr === cleanName || normStr.includes(cleanName) || cleanName.includes(normStr)) return true;
    }
    return false;
  };

  const dbg = {
    wave: curWave,
    hasTp: !!document.getElementById("teleport-menu"),
    pickerTitle: ""
  };

  if (isMatch(curWave) || isMatch(docTitle)) {
    closePicker();
    return {
      success: true,
      alreadyThere: true,
      hunt: curWave || (docTitle.match(/·\s*(.*?)\s*—/) ? docTitle.match(/·\s*(.*?)\s*—/)[1].trim() : (wantNameRaw || wantIdRaw)),
      method: "already-detected",
      dbg
    };
  }

  // Fecha modais bloqueantes indesejados antes de abrir teleporte
  const picker0 = document.getElementById("picker-modal");
  const title0 = (picker0?.querySelector(".im-title")?.textContent || "").toLowerCase();
  const isStage = /fase|hunt|caçar|sequência|sequencia/.test(title0);
  if (picker0 && !picker0.classList.contains("hidden") && !isStage) {
    const closeBtn = picker0.querySelector("#picker-modal-close, .im-close, .close-btn, .modal-close, [data-close]");
    if (closeBtn) closeBtn.click();
    else picker0.classList.add("hidden");
    await sleep(300);
  }

  for (const b of document.querySelectorAll("button, .btn")) {
    const t = (b.textContent || "").trim().toLowerCase();
    if (t.includes("coletar") && !b.id.includes("daily")) {
      b.click();
      await sleep(250);
    }
  }

  // Localiza gatilho de teleporte: wave-title ou botão com title/aria de teleporte
  const waveTitle = document.getElementById("wave-title")
    || document.querySelector("[title*='Teleporte' i], [aria-label*='Teleporte' i]");
  if (!waveTitle) return { success: false, reason: "no-wave-title", dbg };

  waveTitle.click();
  let tpMenu = null;
  tpMenu = await waitFor(() => {
    const menu = document.getElementById("teleport-menu");
    return menu && !menu.classList.contains("hidden") && visible(menu) ? menu : null;
  });
  dbg.hasTp = !!(tpMenu && !tpMenu.classList.contains("hidden"));

  const tpBtn = document.querySelector('#teleport-menu .tp-opt[data-tp="hunts"]')
    || Array.from(document.querySelectorAll("#teleport-menu .tp-opt, button, .tp-opt"))
      .find((b) => /hunts|fases/i.test((b.textContent || "").trim()));
  if (!tpBtn) return { success: false, reason: "no-hunts-btn", dbg, rows: 0, unlocked: [] };
  tpBtn.click();

  let rows = [];
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    await revealRows();
    const picker = document.getElementById("picker-modal");
    dbg.pickerTitle = (picker?.querySelector(".im-title")?.textContent || "").trim();

    // Garante categoria 'Todas' para listar todas as hunts (sem filtro residual de categoria)
    const catAll = Array.from(document.querySelectorAll("#picker-modal button.sp-cat, .sp-cat, .pick-lean button, button"))
      .find((b) => /^(todas|all)$/i.test((b.textContent || "").trim()));
    if (catAll && !catAll.classList.contains("active") && !catAll.classList.contains("on") && !catAll.classList.contains("sp-cat-on") && i <= 2) {
      catAll.click();
      await sleep(150);
    }

    rows = Array.from(document.querySelectorAll(
      "#picker-modal .hunt-grid .stage-row, #picker-modal .stage-row, .hunt-grid .stage-row"
    ));
    if (rows.length > 5) break;
  }

  // Extrai hunts usando textContent (zero reflow de layout)
  const unlocked = rows.map((r) => ({
    id: r.dataset.hunt || "",
    name: text(r.querySelector("b, .stage-name-line b")),
    locked: r.classList.contains("locked"),
    current: r.classList.contains("pick-current"),
    text: text(r).replace(/\s+/g, " ").slice(0, 80),
    goDisabled: !!(r.querySelector("button.stage-go") && r.querySelector("button.stage-go").disabled)
  }));

  const resumeLast = !!(target && (target.resumeLast || target.mode === "last"));

  if (!wantIdRaw && !wantNameRaw && !resumeLast) {
    closePicker();
    return { success: false, scanOnly: true, rows: rows.length, unlocked, dbg };
  }

  let row = null;

  // 1. Busca exata por data-hunt
  if (wantIdRaw) {
    row = rows.find((r) => (r.dataset.hunt || "").toLowerCase() === wantIdRaw);
  }

  // 2. Busca normalizada por ID ou Nome
  if (!row && wantIdRaw) {
    const cleanWantId = normalizeToken(wantIdRaw.replace(/-lair|-cave|-dungeon|-camp|-ground/g, ""));
    row = rows.find((r) => {
      const hIdNorm = normalizeToken((r.dataset.hunt || "").replace(/-lair|-cave|-dungeon|-camp|-ground/g, ""));
      const rNameNorm = normalizeToken(text(r.querySelector("b, .stage-name-line b")));
      const matchId = hIdNorm && cleanWantId && (hIdNorm === cleanWantId || hIdNorm.includes(cleanWantId) || cleanWantId.includes(hIdNorm));
      const matchName = rNameNorm && cleanWantId && (rNameNorm === cleanWantId || rNameNorm.includes(cleanWantId) || cleanWantId.includes(rNameNorm));
      return matchId || matchName;
    });
  }

  if (!row && wantNameRaw) {
    const cleanWantName = normalizeToken(wantNameRaw);
    row = rows.find((r) => {
      const rNameNorm = normalizeToken(text(r.querySelector("b, .stage-name-line b")));
      const rTextNorm = normalizeToken(text(r));
      const matchName = rNameNorm && cleanWantName && (rNameNorm === cleanWantName || rNameNorm.includes(cleanWantName) || cleanWantName.includes(rNameNorm));
      const matchText = rTextNorm && cleanWantName && rTextNorm.includes(cleanWantName);
      return matchName || matchText;
    });
  }

  // 3. Fallback: Retorno à hunt atual marcada no jogo
  if (!row && resumeLast) {
    row = rows.find((r) => r.classList.contains("pick-current"));
  }

  if (!row) {
    closePicker();
    return { success: false, rows: rows.length, unlocked, reason: resumeLast ? "no_current" : "not_found", dbg };
  }

  if (row.classList.contains("locked")) {
    closePicker();
    return { success: false, rows: rows.length, unlocked, reason: "locked", dbg };
  }

  const findGo = () => row.querySelector("button.stage-go")
    || Array.from(row.querySelectorAll("button")).find((b) => /caçar|cacar|hunt|ir|escolher/i.test(b.textContent || ""));

  let goBtn = findGo();
  // Só considera "já está lá" se o wave-title ao vivo também bate com o alvo.
  // O jogo mantém pick-current na última hunt jogada mesmo se você estiver em outra.
  if (row.classList.contains("pick-current") && (!goBtn || goBtn.disabled) && isMatch(curWave)) {
    closePicker();
    return {
      success: true, alreadyThere: true, hunt: row.dataset.hunt || wantIdRaw,
      method: "already-current", unlocked, dbg
    };
  }

  if (!row.classList.contains("expanded")) {
    row.click();
    await sleep(400);
    goBtn = await waitFor(findGo, 5000, 200);
  }

  if (goBtn && !goBtn.disabled) {
    try { goBtn.scrollIntoView({ block: "center", inline: "nearest" }); } catch (_) {}
    await sleep(250);
    goBtn.click();
    // A second async confirmation exists in some builds; handle it only when
    // the modal explicitly describes a hunt/stage change.
    await sleep(500);
    const confirm = document.querySelector("#confirm-modal, .confirm-modal, [role='dialog']");
    if (confirm && visible(confirm) && /hunt|fase|caçar|teleport|cave|lair/i.test(text(confirm))) {
      const yes = Array.from(confirm.querySelectorAll("button, .btn")).find((b) =>
        visible(b) && !b.disabled && /^(ok|yes|sim|confirmar|confirm|caçar|hunt|ir)$/i.test(text(b))
      );
      if (yes) { yes.click(); await sleep(500); }
    }
    closePicker();
    return { success: true, hunt: row.dataset.hunt || wantIdRaw, method: "stage-go", unlocked, dbg };
  }

  if (row.classList.contains("pick-current") && isMatch(curWave)) {
    closePicker();
    return {
      success: true, alreadyThere: true, hunt: row.dataset.hunt || wantIdRaw,
      method: "already-current", unlocked, dbg
    };
  }

  closePicker();
  return { success: false, rows: rows.length, unlocked, reason: "go_disabled", dbg };
}
