async ({ job, ...auctionCfg }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!(el && el.offsetParent !== null);
  const events = [];
  const txt = (el) => (el?.textContent || "").trim();

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

  const closeId = (id) => {
    const el = document.getElementById(id);
    if (!el || el.classList.contains("hidden")) return;
    const c = document.getElementById(id + "-close") || el.querySelector(".im-close, .close-btn, .modal-close");
    if (c) c.click();
    else el.classList.add("hidden");
  };

  const clickRe = (root, re, skipRe) => {
    const b = Array.from((root || document).querySelectorAll("button, .btn, .mini-btn, .ghost-btn, .forge-bigbtn, .bp-btn"))
      .find((x) => vis(x) && !x.disabled && re.test(txt(x)) && (!skipRe || !skipRe.test(txt(x))));
    if (b) { b.click(); return txt(b).slice(0, 48); }
    return null;
  };

  const openThen = async (tabId, modalId, work) => {
    const tab = revealTab(tabId);
    if (!tab) return { skip: "sem " + tabId };
    tab.click();
    await sleep(400);
    const modal = modalId ? document.getElementById(modalId) : null;
    const root = (modal && !modal.classList.contains("hidden")) ? modal : document;
    await work(root);
    if (modalId) closeId(modalId);
    return null;
  };

  const buyish = /comprar|buy |assinar|premium|gold|kk|coins?|pix|vip|doar|lance|bid/i;

  if (job === "vfx") {
    try {
      localStorage.setItem("bs-enabled", "1");
      const raw = JSON.parse(localStorage.getItem("baiakidle.settings") || "{}");
      raw.fxOpacity = 0;
      raw.music = 0;
      raw.batterySave = true;
      localStorage.setItem("baiakidle.settings", JSON.stringify(raw));
    } catch (e) {}
    const bs = document.getElementById("bs-toggle");
    if (bs && !bs.classList.contains("on")) {
      bs.click();
      events.push("battery-save ON");
    }
    document.documentElement.classList.add("battery-save");
    return { ok: true, action: "reduce_vfx", events };
  }

  if (job === "close_modals") {
    const keep = /picker-modal|confirm-modal|conn-overlay|training-overlay|autoboss-overlay|voc-overlay/;
    const ids = [
      "prey-modal", "tree-modal", "chest-modal", "charms-modal", "codex-modal",
      "forge-modal", "imbue-modal", "merchant-modal", "market-modal", "auction-modal",
      "loopcfg-modal", "manageloot-modal", "house-modal", "bp-modal", "boosts-overlay"
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains("hidden") && vis(el) && !keep.test(id)) {
        closeId(id);
        events.push("fechou " + id);
      }
    }
    return { ok: true, events };
  }

  if (job === "chest") {
    const miss = await openThen("tab-chest", "chest-modal", async (root) => {
      const inbox = Array.from(root.querySelectorAll("button.store-sidebtn, button")).find((b) => /caixa de entrada|inbox/i.test(txt(b)));
      if (inbox) {
        inbox.click();
        await sleep(350);
        // Saque de Gold da Caixa de Entrada / Leilão:
        const goldClaimBtn = root.querySelector("button.gi-claim, .mini-btn.gi-claim") || Array.from(root.querySelectorAll("button, .btn, .mini-btn")).find((b) => vis(b) && !b.disabled && /sacar/i.test(txt(b)));
        if (goldClaimBtn) {
          goldClaimBtn.click();
          events.push("SACOU_GOLD_INBOX: " + txt(goldClaimBtn));
          await sleep(400);
        }
      }
      let n = 0;
      for (let i = 0; i < 4; i++) {
        const hit = clickRe(root, /coletar tudo|coletar|claim|retirar/i, /deletar|descartar|comprar|loja/);
        if (!hit) break;
        n += 1;
        events.push(hit);
        await sleep(280);
      }
      const reward = Array.from(root.querySelectorAll("button")).find((b) => /reward chest/i.test(txt(b)));
      if (reward) {
        reward.click();
        await sleep(250);
        const hit = clickRe(root, /coletar tudo|coletar/i, /deletar|descartar/);
        if (hit) events.push("reward " + hit);
      }
      if (!n && !events.length) events.push("chest vazio");
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "codex") {
    const miss = await openThen("tab-codex", "codex-modal", async (root) => {
      let n = 0;
      for (let i = 0; i < 10; i++) {
        const btns = Array.from(root.querySelectorAll("button")).filter((b) => vis(b) && !b.disabled && /^entregar$/i.test(txt(b)));
        if (!btns.length) break;
        btns[0].click();
        n += 1;
        events.push("Entregar #" + n);
        await sleep(320);
      }
      if (!n) events.push("nenhuma entrega");
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "tree") {
    const miss = await openThen("tab-tree", "tree-modal", async (root) => {
      const pts = txt(root.querySelector(".tree-chip.pts"));
      const nPts = parseInt((pts.match(/\d+/) || ["0"])[0], 10);
      if (!nPts) {
        events.push("sem pontos");
        return;
      }
      const nodes = Array.from(root.querySelectorAll("button.tree-node.available")).filter((b) => vis(b) && !b.disabled);
      let clicked = 0;
      for (const node of nodes.slice(0, 6)) {
        if (node.classList.contains("locked") || node.classList.contains("maxed")) continue;
        node.click();
        clicked += 1;
        await sleep(120);
      }
      const ok = root.querySelector("button.tree-confirm-ok");
      if (ok && vis(ok) && !ok.disabled) {
        ok.click();
        events.push("confirmou " + clicked + " nos");
      } else if (clicked) events.push("alocou " + clicked + " sem confirmar (botao off)");
      else events.push("nos locked / sem available");
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "charms") {
    const miss = await openThen("tab-charms", "charms-modal", async (root) => {
      const cards = Array.from(root.querySelectorAll(".charm-card, .forge-row.pickable")).filter(vis);
      if (cards[0]) { cards[0].click(); await sleep(250); }
      const btn = Array.from(root.querySelectorAll("button.forge-bigbtn, button")).find((b) => {
        if (!vis(b) || b.disabled) return false;
        return /^(desbloquear|melhorar|unlock|upgrade)$/i.test(txt(b));
      });
      if (btn) {
        btn.click();
        events.push(txt(btn));
      } else events.push("sem CP / botao off");
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "battlepass") {
    const miss = await openThen("tab-battlepass", "bp-modal", async (root) => {
      let n = 0;
      for (let i = 0; i < 8; i++) {
        const hit = clickRe(root, /retirar|coletar|claim/i, buyish);
        if (!hit) break;
        n += 1;
        events.push(hit);
        await sleep(280);
      }
      const free = clickRe(root, /gr[aá]tis|free reward/i, buyish);
      if (free) events.push(free);
      if (!n && !free) events.push("nada gratis pra coletar");
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "guild") {
    const overlay = document.getElementById("guildtask-overlay");
    if (overlay && !overlay.classList.contains("hidden")) {
      const hit = clickRe(overlay, /coletar|completar|entregar|claim|finalizar/i, buyish);
      if (hit) events.push("overlay " + hit);
    }
    const miss = await openThen("tab-guild", "guild-overlay", async (root) => {
      let n = 0;
      for (let i = 0; i < 5; i++) {
        const hit = clickRe(root, /coletar|completar|entregar|reivindicar|claim/i, buyish);
        if (!hit) break;
        n += 1;
        events.push(hit);
        await sleep(250);
      }
      if (!n && !events.length) events.push("sem claim one-click");
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "merchant") {
    const miss = await openThen("tab-merchant", "merchant-modal", async (root) => {
      const hit = clickRe(root, /coletar|resgatar|claim|retirar/i, buyish);
      if (hit) events.push(hit);
      else events.push("sem coleta gratis (compras ignoradas)");
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "boosts") {
    const roots = [document.getElementById("boosts-overlay"), document.getElementById("panel-boosts"), document.getElementById("boosts-panel-body")].filter(Boolean);
    let used = 0;
    for (const root of roots) {
      const btns = Array.from(root.querySelectorAll("button")).filter((b) => vis(b) && !b.disabled && /^usar 1x$/i.test(txt(b)));
      for (const b of btns.slice(0, 3)) {
        if (buyish.test(txt(b.parentElement))) continue;
        b.click();
        used += 1;
        events.push("Usar 1x");
        await sleep(250);
      }
    }
    if (!used) events.push("sem boost owned com Usar 1x");
    return { ok: true, events };
  }

  if (job === "market") {
    let moved = 0;
    const cells = Array.from(document.querySelectorAll("#inv-grid .cell[data-tier], #inv-grid [data-tier]"));
    for (const cell of cells) {
      const tier = Number(cell.dataset.tier);
      if (!Number.isFinite(tier) || tier < 2) continue;
      const name = (cell.querySelector("img")?.alt || "").toLowerCase();
      if (/gold coin|platinum|crystal coin/.test(name)) continue;
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
      moved += 1;
      events.push("transfer rare+ tier" + tier);
      if (moved >= 8) break;
      await sleep(180);
    }
    if (!moved) events.push("sem loot raro p/ backpack (sem bid/compra)");
    return { ok: true, action: "transfer_" + moved, events };
  }

  if (job === "auction") {
    // Gold is the only auction target: compare packages by gold received per coin.
    const cfg = { enabled: true, live: false, budget: 100, minMarginPct: 25, maxItems: 2, ...auctionCfg };
    if (!cfg.enabled) return { ok: true, skip: "leilao desativado", events };
    const tab = revealTab("tab-auction") || revealTab("tab-leilao");
    if (tab) { tab.click(); await sleep(450); }
    const modal = document.getElementById("auction-modal") || document.getElementById("leilao-modal");
    const root = modal && !modal.classList.contains("hidden") ? modal : document;
    const number = (value) => {
      const s = String(value || "").replace(/\s/g, "");
      const m = s.match(/\d[\d.,]*/);
      if (!m) return null;
      const raw = m[0];
      return raw.includes(",") && raw.includes(".")
        ? parseInt(raw.replace(/\./g, "").replace(",", "."), 10)
        : parseInt(raw.replace(/[.,]/g, ""), 10);
    };
    const textOf = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
    const isGold = (row, text) => {
      const type = String(row.dataset.type || row.dataset.auctionType || "").toLowerCase();
      return type === "gold" || /\bgold\b|ouro|kk\b/i.test(text);
    };
    const goldAmountOf = (row, text) => {
      const value = row.dataset.goldAmount || row.dataset.gold ||
        row.querySelector("[data-gold-amount], [data-gold], .gold-amount, .auction-gold")?.textContent;
      const parsed = number(value);
      if (parsed !== null) return parsed;
      const match = text.match(/([\d.,]+)\s*(kk|k|m|mil(?:h(?:ões|oes)?)?)/i);
      if (!match) return null;
      const amount = number(match[1]);
      const unit = match[2].toLowerCase();
      return amount === null ? null : amount * (unit === "k" ? 1000 : 1000000);
    };
    const rows = Array.from(root.querySelectorAll("[data-auction-id], [data-id].auction-row, .auction-row, .auction-card, .auction-item, .leilao-row"))
      .filter(vis);
    const listings = rows.map((row) => {
      const text = textOf(row);
      const name = row.dataset.name || row.querySelector("[data-item-name], .item-name, .name, img[alt]")?.getAttribute("data-item-name") || row.querySelector("img[alt]")?.alt || text.slice(0, 80);
      const price = number(row.dataset.price || row.querySelector("[data-price], .price, .auction-price, .coin-price")?.textContent || text);
      const goldAmount = isGold(row, text) ? goldAmountOf(row, text) : null;
      const id = row.dataset.auctionId || row.dataset.id || null;
      const buy = Array.from(row.querySelectorAll("button, .btn")).find((b) => vis(b) && !b.disabled && /comprar|buy|lance|bid/i.test(textOf(b)));
      return { row, name: String(name).toLowerCase().replace(/\s+/g, " ").trim(), price, goldAmount, id, buy };
    }).filter((x) => x.price !== null && x.price > 0 && x.goldAmount !== null && x.goldAmount > 0);
    const rates = listings.map((item) => item.goldAmount / item.price).sort((a, b) => a - b);
    const reference = rates.length ? rates[Math.floor(rates.length / 2)] : 0;
    const opportunities = listings.map((item) => {
      const goldPerCoin = item.goldAmount / item.price;
      const marginPct = reference > 0 ? ((goldPerCoin - reference) / reference) * 100 : 0;
      return { ...item, reference, goldPerCoin, marginPct };
    }).filter((x) => x.price <= cfg.budget && x.marginPct >= cfg.minMarginPct)
      .sort((a, b) => b.goldPerCoin - a.goldPerCoin);
    if (!opportunities.length) {
      events.push(`sem pacote de gold vantajoso (gold=${listings.length}, mediana=${reference.toFixed(2)} gold/coin)`);
      return { ok: true, action: "scan", events };
    }
    for (const opportunity of opportunities.slice(0, cfg.maxItems)) {
      const msg = `${(opportunity.goldAmount / 1000000).toFixed(2)}kk por ${opportunity.price}c -> ${opportunity.goldPerCoin.toFixed(0)} gold/coin (+${opportunity.marginPct.toFixed(0)}%)`;
      if (!cfg.live) {
        events.push("DRY-RUN " + msg);
        continue;
      }
      if (opportunity.buy) {
        opportunity.buy.click();
        events.push("COMPROU " + msg);
        await sleep(350);
        const confirm = document.getElementById("confirm-yes");
        const body = textOf(document.getElementById("confirm-modal"));
        if (confirm && vis(confirm) && !confirm.disabled && /comprar|buy|lance|bid/i.test(body)) confirm.click();
      }
    }
    return { ok: true, action: cfg.live ? "live" : "dry-run", events };
  }

  if (job === "supply") {
    const cfg = document.getElementById("supply-cfg");
    if (cfg && vis(cfg)) {
      cfg.click();
      await sleep(350);
      const modal = document.getElementById("supplyconfig-modal");
      const root = modal && !modal.classList.contains("hidden") ? modal : document;
      const onBtn = Array.from(root.querySelectorAll(".set-seg button, button")).find((b) => vis(b) && /^ligado$/i.test(txt(b)) && !b.classList.contains("on"));
      if (onBtn && !buyish.test(txt(onBtn.closest(".set-row")))) {
        onBtn.click();
        events.push("supply auto Ligado");
      } else events.push("sem restock one-toggle claro");
      closeId("supplyconfig-modal");
    } else events.push("sem supply-cfg");
    return { ok: true, events };
  }

  if (job === "loopcfg") {
    closeId("loopcfg-modal");
    events.push("nao altera sequencia de hunts (profiler cuida; evita brick)");
    return { ok: true, skip: "sequence skip", events };
  }

  if (job === "manageloot") {
    events.push("skip: gerenciar loot nao e one-toggle seguro");
    closeId("manageloot-modal");
    return { ok: true, skip: "unclear", events };
  }

  if (job === "forge" || job === "imbue") {
    const tabId = job === "forge" ? "tab-forge" : "tab-imbue";
    const modalId = job === "forge" ? "forge-modal" : "imbue-modal";
    const miss = await openThen(tabId, modalId, async (root) => {
      const free = Array.from(root.querySelectorAll("button.forge-bigbtn, button")).find((b) => {
        if (!vis(b) || b.disabled) return false;
        const row = (b.closest("div")?.textContent || "") + txt(b);
        if (buyish.test(row) && !/gr[aá]tis|free|0 gold|custo:\s*0/i.test(row)) return false;
        return /aplicar|aplicar gr[aá]tis|free apply|confirmar/i.test(txt(b));
      });
      if (free) {
        free.click();
        events.push("acao barata: " + txt(free));
      } else events.push("skip forja/imbue (gastaria gold sem cap)");
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "house") {
    return { ok: true, skip: "house dummies: stamina/treino ja coberto; seletores de dummy pouco claros", events };
  }

  return { ok: false, skip: "job desconhecido: " + job, events };
}
