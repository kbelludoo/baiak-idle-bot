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

  // IDs completos normalizados (SEM strip de -lair/-cave).
  // NUNCA use substring/includes aqui: "dragon" é substring de "undeadragon"
  // e de "megadragon", então includes() clicava na hunt errada.
  // Comparação é sempre EXATA sobre o id/nome completo.
  const wantIdNorm = wantIdRaw ? normalizeToken(wantIdRaw) : "";
  const wantNameNorm = wantNameRaw ? normalizeToken(wantNameRaw) : "";

  const isMatch = (str) => {
    if (!str) return false;
    const normStr = normalizeToken(str);
    if (!normStr) return false;
    // Exato: cobre "Dragon Lair" == dragon-lair (ambos viram "dragonlair")
    // e "Undead Dragon" == undeadragon-lair? Não — display não tem "lair",
    // então esse caso cai para a checagem via pick-current + wave abaixo,
    // nunca para um includes() genérico que confundiria dragon/undead.
    if (wantIdNorm && normStr === wantIdNorm) return true;
    if (wantNameNorm && normStr === wantNameNorm) return true;
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

  // Se o seletor já estiver aberto, aproveita direto sem re-abrir teleporte
  const pickerDirect = document.getElementById("picker-modal");
  const pickerAlreadyOpen = !!(pickerDirect && !pickerDirect.classList.contains("hidden") && visible(pickerDirect));

  if (!pickerAlreadyOpen) {
    // Localiza gatilho de teleporte: wave-title ou botão com title/aria de teleporte
    // Fallbacks genéricos quando a build renomeia IDs (bs-hunt/stage-name).
    const waveTitle = document.getElementById("wave-title")
      || document.querySelector(".bs-hunt, .stage-name, .stage-name-line, [class*='wave-title' i], [class*='hunt-title' i]")
      || document.querySelector("[title*='Teleporte' i], [aria-label*='Teleporte' i]");
    if (!waveTitle) return { success: false, reason: "no-wave-title", dbg };

    waveTitle.click();
    let tpMenu = null;
    tpMenu = await waitFor(() => {
      const menu = document.getElementById("teleport-menu")
        || document.querySelector("[class*='teleport-menu' i], [id*='teleport' i]");
      return menu && !menu.classList.contains("hidden") && visible(menu) ? menu : null;
    }, 2500, 150);
    dbg.hasTp = !!(tpMenu && !tpMenu.classList.contains("hidden"));

    const tpScope = tpMenu || document;
    const tpBtn = document.querySelector('#teleport-menu .tp-opt[data-tp="hunts"]')
      || (tpScope.querySelector ? tpScope.querySelector('.tp-opt[data-tp="hunts"]') : null)
      || Array.from(tpScope.querySelectorAll('#teleport-menu .tp-opt, button, .tp-opt, [class*="tp-opt" i]'))
        .find((b) => /hunts|fases/i.test((b.textContent || "").trim()))
      || Array.from(document.querySelectorAll("button, [role='button']"))
        .find((b) => /^(hunts|fases|caçar)$/i.test((b.textContent || "").trim()));
    if (!tpBtn) return { success: false, reason: "no-hunts-btn", dbg, rows: 0, unlocked: [] };
    tpBtn.click();
  }

  let rows = [];
  for (let i = 0; i < 8; i++) {
    await sleep(100);
    await revealRows();
    const picker = document.getElementById("picker-modal");
    dbg.pickerTitle = (picker?.querySelector(".im-title")?.textContent || "").trim();

    // Garante categoria 'Todas' para listar todas as hunts (sem filtro residual de categoria)
    const catAll = Array.from(document.querySelectorAll("#picker-modal button.sp-cat, .sp-cat, .pick-lean button, button"))
      .find((b) => /^(todas|all)$/i.test((b.textContent || "").trim()));
    if (catAll && !catAll.classList.contains("active") && !catAll.classList.contains("on") && !catAll.classList.contains("sp-cat-on") && i <= 2) {
      catAll.click();
      await sleep(100);
    }

    rows = Array.from(document.querySelectorAll(
      "#picker-modal .hunt-grid .stage-row, #picker-modal .stage-row, .hunt-grid .stage-row, #picker-modal [class*='stage-row' i], #picker-modal [class*='hunt-row' i], #picker-modal [data-hunt]"
    ));
    if (rows.length === 0) {
      // Fallback: qualquer linha clicável dentro do picker com data-hunt ou texto de hunt.
      const fallback = Array.from(document.querySelectorAll("#picker-modal [data-hunt], #picker-modal .im-card, #picker-modal button"));
      if (fallback.length > 5) rows = fallback;
    }
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

  // 2. Busca normalizada EXATA por ID completo (tolerando case/acentos/
  // variante undead-dragon vs undeadragon via normalizeToken).
  // SEM includes(): "dragon" ⊂ "undeadragon"/"megadragon" clicava errado.
  if (!row && wantIdRaw) {
    row = rows.find((r) => {
      const hIdNorm = normalizeToken(r.dataset.hunt || "");
      return hIdNorm && wantIdNorm && hIdNorm === wantIdNorm;
    });
  }

  // 2b. Busca exata por nome completo (ex: "Dragon Lair" === "Dragon Lair").
  // SEM includes(): evita "Dragon" casar dentro de "Undead Dragon"/"Mega Dragon".
  if (!row && wantNameNorm) {
    row = rows.find((r) => {
      const rNameNorm = normalizeToken(text(r.querySelector("b, .stage-name-line b")));
      return rNameNorm && wantNameNorm && rNameNorm === wantNameNorm;
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

  const findGo = () => row.querySelector("button.stage-go, [class*='stage-go' i], [class*='go-btn' i]")
    || Array.from(row.querySelectorAll("button, [role='button'], .btn")).find((b) => /caçar|cacar|hunt|ir|escolher|jogar|entrar/i.test(b.textContent || ""));

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
    await sleep(250);
    goBtn = await waitFor(findGo, 2500, 150);
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
