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
      // O modo "economia de bateria" desta build coloca a sala em um
      // overlay idle (a wave pode ficar parada em 1/10). Reduza efeitos e
      // áudio, mas mantenha o loop de combate ativo.
      localStorage.setItem("bs-enabled", "0");
      const raw = JSON.parse(localStorage.getItem("baiakidle.settings") || "{}");
      raw.fxOpacity = 0;
      raw.music = 0;
      raw.batterySave = false;
      localStorage.setItem("baiakidle.settings", JSON.stringify(raw));
    } catch (e) {}
    const bs = document.getElementById("bs-toggle");
    if (bs && bs.classList.contains("on")) {
      bs.click();
      events.push("battery-save OFF (combate ativo)");
    }
    // Nesta build o overlay pode continuar aberto mesmo depois de desligar
    // o toggle (o timer de inatividade já entrou em modo economia). O jogo
    // só encerra esse estado quando o slider chega ao limiar de saída.
    const bsOverlay = document.getElementById("battery-save-overlay");
    const bsRange = document.getElementById("bs-range");
    if (bsOverlay && !bsOverlay.classList.contains("hidden") && bsRange) {
      bsRange.value = "100";
      bsRange.dispatchEvent(new Event("input", { bubbles: true }));
      bsRange.dispatchEvent(new Event("change", { bubbles: true }));
      events.push("battery-save overlay fechado pelo slider");
    }
    document.documentElement.classList.remove("battery-save");
    return { ok: true, action: "reduce_vfx_sem_idle", events };
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
    // Guarda SOMENTE épico (3) / lendário (4) / mítico (5). Raro (2) ou menor fica na pouch p/ vender.
    let moved = 0;
    const cells = Array.from(document.querySelectorAll("#inv-grid .cell[data-tier], #inv-grid [data-tier]"));
    for (const cell of cells) {
      const tier = Number(cell.dataset.tier);
      if (!Number.isFinite(tier) || tier < 3) continue;
      const name = (cell.querySelector("img")?.alt || "").toLowerCase();
      if (/gold coin|platinum|crystal coin/.test(name)) continue;
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
      moved += 1;
      events.push("transfer epic+ tier" + tier);
      if (moved >= 8) break;
      await sleep(180);
    }
    if (!moved) events.push("sem loot épico/lendário p/ backpack (sem bid/compra)");
    return { ok: true, action: "transfer_" + moved, events };
  }

  if (job === "lootfilter") {
    // Varredura anti-encher: vende/descarta tudo abaixo de épico (tier 0-2) na backpack + pouch.
    // Épico(3)/Lendário(4)/Mítico(5) nunca são tocados.
    const KEEP = 3;
    const closeItem = () => {
      const modal = document.getElementById("item-modal");
      if (modal && !modal.classList.contains("hidden")) {
        const c = document.getElementById("item-modal-close");
        if (c) c.click();
        else modal.classList.add("hidden");
      }
      document.querySelectorAll(".ctx-menu").forEach((m) => m.remove());
    };
    const cells = Array.from(document.querySelectorAll(
      "#backpack-grid .cell, #backpack-grid [data-tier], #backpack-grid [data-cmpitem], " +
      "#inv-grid .cell, #inv-grid [data-tier], #inv-grid [data-cmpitem]"
    ));
    let sold = 0, kept = 0, skipped = 0;
    for (const cell of cells.slice(0, 24)) {
      const tierRaw = cell.dataset?.tier;
      const tier = tierRaw !== undefined && tierRaw !== "" ? Number(tierRaw) : NaN;
      const img = cell.querySelector?.("img");
      const name = ((img?.alt || cell.title || "") + "").trim();
      if (/gold coin|platinum|crystal coin|glooth bag|backpack/i.test(name)) { skipped++; continue; }
      if (Number.isFinite(tier) && tier >= KEEP) { kept++; continue; }
      // Sem tier legível: checa tooltip/raridade no nome antes de vender
      if (!Number.isFinite(tier)) {
        const tip = String(cell.dataset?.tiphtml || cell.dataset?.tip || name).toLowerCase();
        if (/epic|legendary|mythical|mythic|épico|epico|lend[aá]rio|m[ií]tico/.test(tip)) { kept++; continue; }
        // Item sem raridade e sem slot (material/stack/consumível) não é lixo vendável aqui
        if (!cell.dataset?.cmpitem && !cell.dataset?.tiphtml && !cell.dataset?.tier) { skipped++; continue; }
      }
      cell.click();
      await sleep(200);
      const modal = document.getElementById("item-modal");
      if (!modal || modal.classList.contains("hidden")) { skipped++; continue; }
      const body = (document.getElementById("item-modal-body")?.textContent || modal.textContent || "");
      // Revalida raridade dentro do modal (fonte mais completa)
      const tipFull = String(cell.dataset?.tiphtml || "") + " " + body;
      if (/epic|legendary|mythical|mythic|épico|epico|lend[aá]rio|m[ií]tico/i.test(tipFull) && /tt-rarity/i.test(String(cell.dataset?.tiphtml || ""))) {
        kept++;
        closeItem();
        await sleep(80);
        continue;
      }
      const sellBtn = Array.from(modal.querySelectorAll("button, .ghost-btn, .mini-btn"))
        .find((b) => vis(b) && !b.disabled && /^(vender|sell|descartar|descart|delete|drop|jogar fora)$/i.test((b.textContent || "").trim()));
      if (sellBtn) {
        sellBtn.click();
        sold += 1;
        events.push("vendeu lixo: " + name.slice(0, 36) + " T" + (Number.isFinite(tier) ? tier : "?"));
        await sleep(300);
        const confirm = document.getElementById("confirm-modal");
        if (confirm && !confirm.classList.contains("hidden")) {
          const bodyC = (document.getElementById("confirm-modal-body")?.textContent || "").toLowerCase();
          if (/vender|sell|descartar|descart/i.test(bodyC)) {
            const yes = document.getElementById("confirm-yes") || confirm.querySelector("button.btn-yes, .btn-yes");
            if (yes && !yes.disabled) yes.click();
            else { const no = document.getElementById("confirm-no"); if (no) no.click(); }
          } else {
            const no = document.getElementById("confirm-no");
            if (no) no.click();
          }
          await sleep(150);
        }
      } else {
        skipped++;
      }
      closeItem();
      await sleep(120);
      if (sold >= 10) break;
    }
    return { ok: true, action: "lootfilter_sold_" + sold, sold, kept, skipped, events };
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
    const parseRemainingMinutes = (text) => {
      const clock = text.match(/(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?/);
      if (clock) {
        const h = parseInt(clock[1], 10) || 0;
        const m = parseInt(clock[2], 10) || 0;
        return (h * 60) + m;
      }
      const mMin = text.match(/(\d+)\s*(?:m|min|minutos)/i);
      if (mMin) return parseInt(mMin[1], 10);
      const mH = text.match(/(\d+)\s*(?:h|horas)/i);
      if (mH) return parseInt(mH[1], 10) * 60;
      return null;
    };

    // 1. Obtenção autoritativa via tRPC (mais rápido, preciso e não depende de classes DOM)
    let listings = [];
    try {
      const browseRes = await fetch("/api/trpc/auction.browse?batch=1&input=%7B%220%22%3A%7B%22page%22%3A1%2C%22perPage%22%3A100%2C%22type%22%3A%22gold%22%7D%7D")
        .then((r) => r.json())
        .catch(() => null);
      const rows = browseRes?.[0]?.result?.data?.rows || browseRes?.[0]?.result?.data?.json?.rows || [];
      const now = Date.now();
      listings = rows
        .filter((r) => r.type === "gold" && r.goldAmount > 0 && r.currentPrice > 0 && !r.isOwn && !r.isLeading)
        .map((r) => ({
          id: r.id,
          name: `${(r.goldAmount / 1000000).toFixed(0)}kk Gold`,
          price: r.currentPrice,
          goldAmount: r.goldAmount,
          bids: r.bidCount,
          minutesRemaining: Math.max(0, Math.round((r.endsAt - now) / 60000)),
          isOwn: !!r.isOwn,
          isLeading: !!r.isLeading,
          trpc: true
        }));
    } catch (_) {}

    // Fallback DOM se o tRPC falhar
    if (!listings.length) {
      const rows = Array.from(root.querySelectorAll("[data-auction-id], [data-id].auction-row, .auction-row, .auction-card, .auction-item, .leilao-row"))
        .filter(vis);
      listings = rows.map((row) => {
        const text = textOf(row);
        const name = row.dataset.name || row.querySelector("[data-item-name], .item-name, .name, img[alt]")?.getAttribute("data-item-name") || row.querySelector("img[alt]")?.alt || text.slice(0, 80);
        const price = number(row.dataset.price || row.querySelector("[data-price], .price, .auction-price, .coin-price")?.textContent || text);
        const goldAmount = isGold(row, text) ? goldAmountOf(row, text) : null;
        const id = row.dataset.auctionId || row.dataset.id || null;
        const buy = Array.from(row.querySelectorAll("button, .btn")).find((b) => vis(b) && !b.disabled && /comprar|buy|lance|bid/i.test(textOf(b)));
        const minutesRemaining = parseRemainingMinutes(text);
        return { row, name: String(name).toLowerCase().replace(/\s+/g, " ").trim(), price, goldAmount, id, buy, minutesRemaining, trpc: false };
      }).filter((x) => x.price !== null && x.price > 0 && x.goldAmount !== null && x.goldAmount > 0);
    }
    let historyRates = [];
    try {
      const histRes = await fetch("/api/trpc/auction.history?batch=1&input=%7B%220%22%3A%7B%22page%22%3A1%2C%22perPage%22%3A30%7D%7D")
        .then((r) => r.json())
        .catch(() => null);
      const histRows = histRes?.[0]?.result?.data?.rows || histRes?.[0]?.result?.data?.json?.rows || [];
      historyRates = histRows
        .filter((r) => r.type === "gold" && r.goldAmount > 0 && r.currentPrice > 0)
        .map((r) => r.goldAmount / r.currentPrice);
    } catch (_) {}

    const rates = listings.map((item) => item.goldAmount / item.price).concat(historyRates).sort((a, b) => a - b);
    const reference = rates.length ? rates[Math.floor(rates.length / 2)] : 5500000;
    
    // Sniping: Prioriza lotes com maior gold por coin que estão estritamente terminando (<= maxMinutesRemaining, default 5m)
    const maxMins = cfg.maxMinutesRemaining ?? 5;
    const opportunities = listings.map((item) => {
      const nextPrice = item.bids > 0 ? item.price + 1 : item.price;
      const goldPerCoin = item.goldAmount / nextPrice;
      const marginPct = reference > 0 ? ((goldPerCoin - reference) / reference) * 100 : 0;
      const mins = item.minutesRemaining !== null ? item.minutesRemaining : 360;
      const isEnding = mins <= maxMins;
      return { ...item, nextPrice, reference, goldPerCoin, marginPct, isEnding, mins };
    }).filter((x) => x.isEnding && x.nextPrice <= cfg.budget && x.marginPct >= cfg.minMarginPct)
      .sort((a, b) => b.goldPerCoin - a.goldPerCoin);
    if (!opportunities.length) {
      events.push(`sem pacote de gold vantajoso terminando em <=${maxMins}m (gold=${listings.length}, mediana=${reference.toFixed(2)} gold/coin)`);
      return { ok: true, action: "scan", events };
    }
    const finalOpportunities = cfg.targetId
      ? opportunities.filter((o) => o.id === cfg.targetId || !cfg.targetId)
      : opportunities;
    for (const opportunity of finalOpportunities.slice(0, cfg.maxItems)) {
      const msg = `Lote #${opportunity.id}: ${(opportunity.goldAmount / 1000000).toFixed(0)}kk por ${opportunity.nextPrice}c (${opportunity.goldPerCoin.toFixed(0)} gold/c, +${opportunity.marginPct.toFixed(0)}%, restam ${opportunity.mins}m)`;
      if (!cfg.live) {
        events.push("DRY-RUN " + msg);
        continue;
      }
      if (opportunity.trpc) {
        try {
          const bidRes = await fetch("/api/trpc/auction.bid?batch=1", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              "0": {
                listingId: opportunity.id,
                maxAmount: opportunity.nextPrice,
                currency: "normal"
              }
            })
          }).then((r) => r.json());
          if (bidRes?.[0]?.result?.data) {
            events.push("LANCE REGISTRADO: " + msg);
          } else {
            const err = bidRes?.[0]?.error?.message || "falha";
            events.push(`LANCE RECUSADO (${err}): ` + msg);
          }
        } catch (e) {
          events.push(`ERRO LANCE (${String(e)}): ` + msg);
        }
      } else if (opportunity.buy) {
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

  if (job === "arena") {
    const miss = await openThen("tab-arena", "arena-modal", async (root) => {
      // 1. Coleta recompensa diária/resgate se houver
      const claimBtn = Array.from(root.querySelectorAll("button, .arena-btn, .mini-btn")).find((b) => vis(b) && !b.disabled && /coletar|recompensa|claim/i.test(txt(b)));
      if (claimBtn) {
        claimBtn.click();
        events.push("ARENA_CLAIM: " + txt(claimBtn));
        await sleep(300);
      }
      // 2. Entra na fila diária de Arena se ainda houver tentativas livres
      const queueBtn = root.querySelector("button.arena-btn.primary") || Array.from(root.querySelectorAll("button.arena-btn, button")).find((b) => vis(b) && !b.disabled && /entrar na fila|queue/i.test(txt(b)));
      if (queueBtn && !queueBtn.disabled) {
        queueBtn.click();
        events.push("ARENA_FILA_ENTROU");
      } else {
        events.push("arena fila indisponivel / limite atingido");
      }
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "event") {
    const miss = await openThen("tab-event", "event-modal", async (root) => {
      let claimed = 0;
      for (let i = 0; i < 8; i++) {
        const giveBtn = root.querySelector("button.cx-give.ready") || Array.from(root.querySelectorAll("button.cx-give, button")).find((b) => vis(b) && !b.disabled && /entregar|coletar|claim/i.test(txt(b)));
        if (!giveBtn) break;
        giveBtn.click();
        claimed += 1;
        events.push("EVENT_ENTREGOU_MISSAO #" + claimed);
        await sleep(350);
      }
      if (!claimed) events.push("sem missoes de evento prontas");
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "cyclopedia") {
    const miss = await openThen("tab-cyclopedia", "cyclopedia-modal", async (root) => {
      // Abre aba Bestiário e coleta criaturas concluídas se houver
      const bstTab = Array.from(root.querySelectorAll("#cyc-tabbar .cyc-tabbtn, button")).find((b) => /besti[aá]rio|bestiary/i.test(txt(b)));
      if (bstTab) {
        bstTab.click();
        await sleep(300);
        let collected = 0;
        for (let i = 0; i < 5; i++) {
          const claimBtn = Array.from(root.querySelectorAll("button, .mini-btn, .btn")).find((b) => vis(b) && !b.disabled && /resgatar|coletar|desbloquear|claim/i.test(txt(b)));
          if (!claimBtn) break;
          claimBtn.click();
          collected += 1;
          events.push("BESTIARIO_CLAIM #" + collected);
          await sleep(300);
        }
        if (!collected) events.push("bestiario verificado (sem resgate pendente)");
      }
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "manageloot") {
    const miss = await openThen(null, "manageloot-modal", async (root) => {
      // Ativa filtros de itens seguros para auto-sell
      const toggles = Array.from(root.querySelectorAll(".set-toggle, button.set-btn")).filter((b) => vis(b) && !b.classList.contains("on"));
      let activated = 0;
      for (const t of toggles.slice(0, 4)) {
        if (!buyish.test(txt(t.parentElement))) {
          t.click();
          activated++;
          await sleep(150);
        }
      }
      events.push(activated ? `manageloot: ativou ${activated} filtros` : "manageloot: filtros ja configurados");
    });
    closeId("manageloot-modal");
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "forge" || job === "imbue") {
    const tabId = job === "forge" ? "tab-forge" : "tab-imbue";
    const modalId = job === "forge" ? "forge-modal" : "imbue-modal";
    const miss = await openThen(tabId, modalId, async (root) => {
      // 1. Tenta fusão ou ação gratuita se disponível
      const freeBtn = Array.from(root.querySelectorAll("button.forge-bigbtn, button.btn, button")).find((b) => {
        if (!vis(b) || b.disabled) return false;
        const row = (b.closest("div")?.textContent || "") + txt(b);
        if (buyish.test(row) && !/gr[aá]tis|free|0 gold|custo:\s*0/i.test(row)) return false;
        return /aplicar|aplicar gr[aá]tis|free apply|confirmar|fundir|fuse/i.test(txt(b));
      });
      if (freeBtn) {
        freeBtn.click();
        events.push("FORGE_IMBUE_EXEC: " + txt(freeBtn));
        await sleep(350);
      } else {
        // 2. Se for forja de tier, clica no auto-conversor de dust gratuito
        const autoConv = root.querySelector("button.ft-btn-auto, .forge-auto") || Array.from(root.querySelectorAll("button")).find((b) => vis(b) && !b.disabled && /converter dust|auto tier/i.test(txt(b)));
        if (autoConv) {
          autoConv.click();
          events.push("FORGE_TIER_CONV: " + txt(autoConv));
        } else {
          events.push("forja/imbue verificados (sem custo excessivo)");
        }
      }
    });
    return { ok: true, skip: miss?.skip, events };
  }

  if (job === "house") {
    // Verifica treino em dummy de casa se o jogador tiver casa alugada
    const tabHouse = revealTab("tab-house") || document.querySelector("[data-tab='house'], button[title*='Casa' i]");
    if (tabHouse) {
      tabHouse.click();
      await sleep(350);
      const modal = document.getElementById("house-modal");
      if (modal && !modal.classList.contains("hidden")) {
        const dummy = Array.from(modal.querySelectorAll("button, .house-cell")).find((b) => vis(b) && !b.disabled && /dummy|treinar|train/i.test(txt(b)));
        if (dummy) {
          dummy.click();
          events.push("HOUSE_DUMMY_TREINO");
        } else {
          events.push("house: sem dummy ativo");
        }
        closeId("house-modal");
      }
    } else {
      events.push("house: aba nao disponivel");
    }
    return { ok: true, events };
  }

  return { ok: false, skip: "job desconhecido: " + job, events };
}
