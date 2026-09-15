async (target) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!(el && el.offsetParent !== null);
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
  const dbg = {
    wave: (document.getElementById("wave-title")?.textContent || "").trim(),
    hasTp: !!document.getElementById("teleport-menu"),
    pickerTitle: ""
  };

  const picker0 = document.getElementById("picker-modal");
  const title0 = (picker0?.querySelector(".im-title")?.textContent || "").toLowerCase();
  const isStage = /fase|hunt|caçar|sequência|sequencia/.test(title0);
  if (picker0 && !picker0.classList.contains("hidden") && !isStage) {
    const closeBtn = picker0.querySelector("#picker-modal-close, .im-close, .close-btn, .modal-close, [data-close]");
    if (closeBtn) closeBtn.click();
    else picker0.classList.add("hidden");
    await sleep(400);
  }

  const waveTitle = document.getElementById("wave-title");
  if (!waveTitle) return { success: false, reason: "no-wave-title", dbg };

  waveTitle.click();
  let tpMenu = null;
  for (let i = 0; i < 12; i++) {
    await sleep(120);
    tpMenu = document.getElementById("teleport-menu");
    if (tpMenu && !tpMenu.classList.contains("hidden")) break;
  }
  dbg.hasTp = !!(tpMenu && !tpMenu.classList.contains("hidden"));

  const tpBtn = document.querySelector('#teleport-menu .tp-opt[data-tp="hunts"]')
    || Array.from(document.querySelectorAll("#teleport-menu .tp-opt, button, .tp-opt"))
      .find((b) => /hunts|fases/i.test((b.textContent || "").trim()));
  if (!tpBtn) return { success: false, reason: "no-hunts-btn", dbg, rows: 0, unlocked: [] };
  tpBtn.click();

  let rows = [];
  for (let i = 0; i < 15; i++) {
    await sleep(150);
    const picker = document.getElementById("picker-modal");
    dbg.pickerTitle = (picker?.querySelector(".im-title")?.textContent || "").trim();
    const catAll = Array.from(document.querySelectorAll("button.sp-cat, .pick-lean button, button"))
      .find((b) => /^(todas|all)$/i.test((b.textContent || "").trim()));
    if (catAll && i === 2) catAll.click();
    rows = Array.from(document.querySelectorAll(
      "#picker-modal .hunt-grid .stage-row, #picker-modal .stage-row, .hunt-grid .stage-row"
    ));
    if (rows.length > 1) break;
  }

  const unlocked = rows.map((r) => ({
    id: r.dataset.hunt || "",
    name: (r.querySelector("b, .stage-name-line b")?.textContent || "").trim(),
    locked: r.classList.contains("locked"),
    current: r.classList.contains("pick-current"),
    text: (r.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
    goDisabled: !!(r.querySelector("button.stage-go") && r.querySelector("button.stage-go").disabled)
  }));

  const resumeLast = !!(target && (target.resumeLast || target.mode === "last"));
  const wantId = String((target && target.id) || "").toLowerCase();
  const wantName = String((target && target.name) || "").toLowerCase();

  if (!wantId && !wantName && !resumeLast) {
    closePicker();
    return { success: false, scanOnly: true, rows: rows.length, unlocked, dbg };
  }

  let row = null;
  if (wantId) {
    row = rows.find((r) => (r.dataset.hunt || "").toLowerCase() === wantId);
  }
  if (!row && wantName) {
    row = rows.find((r) => (r.innerText || "").toLowerCase().includes(wantName));
  }
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
    || Array.from(row.querySelectorAll("button")).find((b) => /caçar|cacar|hunt|ir|escolher/i.test(b.innerText || ""));
  let goBtn = findGo();
  if (row.classList.contains("pick-current") && (!goBtn || goBtn.disabled)) {
    closePicker();
    return {
      success: true, alreadyThere: true, hunt: row.dataset.hunt || wantId,
      method: "already-current", unlocked, dbg
    };
  }
  if (!row.classList.contains("expanded")) {
    row.click();
    await sleep(300);
    goBtn = findGo();
  }
  if (goBtn && !goBtn.disabled && visible(goBtn)) {
    goBtn.click();
    return { success: true, hunt: row.dataset.hunt || wantId, method: "stage-go", unlocked, dbg };
  }
  if (row.classList.contains("pick-current")) {
    closePicker();
    return {
      success: true, alreadyThere: true, hunt: row.dataset.hunt || wantId,
      method: "already-current", unlocked, dbg
    };
  }
  closePicker();
  return { success: false, rows: rows.length, unlocked, reason: "go_disabled", dbg };
}
