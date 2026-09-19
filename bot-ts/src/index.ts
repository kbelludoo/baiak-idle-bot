import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { parseConfig, describeFlags } from "./config";
import { launchBrowser } from "./browser";
import { Watchdog } from "./watchdog";
import { Profiler } from "./profiler";
import { HuntMatrix, HUNTS_TABLE, classifyMagic, matchHunt, idsFromPickerRows, inferLevel, AOE_WORDS, STRIKE_WORDS, HEAL_WORDS, MANA_WORDS } from "./hunts";
import { startServer } from "./server";
import { decodeFrame } from "./protocol";
import { safeEval } from "./scripts";
import { DefaultExtrasScheduler, looksLikeTreino } from "./extras";
import { TelemetryStore } from "./telemetry";
import { ProtocolMapper } from "./protocol_mapper";
import { chooseExplorationTarget } from "./exploration";
import { rankHuntsObserved } from "./hunt_sim";
import { helperTrigger } from "./helper_triggers";
import { ActionQueue, evaluateStaminaTransition } from "./state_machine";
import { createTrpcClient, normalizeChars } from "./trpc";
import { roomSend, roomDrainEvents, sendStage } from "./room_send";
import type { TelemetryState, SubsystemInfo } from "./types";

// ===================================================================
// Script JS injetado no browser para ler telemetria ultra-leve
// Zero TreeWalker no body, zero layout thrashing, compatível com VPS 1 core
// ===================================================================

const FAST_STATE_JS = `() => {
  const text = (el) => (el?.textContent || "").trim();
  const parseGold = (val) => {
    if (typeof val === 'number' && Number.isFinite(val)) return Math.floor(val);
    const s = String(val || "").replace(/\\s+/g, " ").trim();
    if (!s) return null;
    const m = s.match(/([\\d.,]+)\\s*(kk|milh(?:oes|oes|ao)?|mi\\b|m\\b|mil\\b|k\\b)?/i);
    if (!m) return null;
    const raw = m[1]; const unit = (m[2] || "").toLowerCase();
    const hasDot = raw.includes("."), hasComma = raw.includes(",");
    let num;
    if (hasDot && hasComma) num = parseFloat(raw.replace(/\\./g, "").replace(",", "."));
    else if (hasComma && !hasDot) num = parseFloat(raw.replace(",", "."));
    else if (hasDot && !hasComma) num = unit ? parseFloat(raw) : parseInt(raw.replace(/\\./g, ""), 10);
    else num = parseInt(raw, 10);
    if (!Number.isFinite(num)) return null;
    if (unit === "kk" || unit === "m" || unit.startsWith("milh") || unit === "mi") num *= 1000000;
    else if (unit === "k" || unit === "mil") num *= 1000;
    return Math.round(num);
  };
  const normStam = (s) => {
    const t = String(s || "").trim();
    if (!t) return null;
    const pct = t.match(/(\\d{1,3})\\s*%/);
    if (pct) return pct[1] + "%";
    const clock = t.match(/(\\d{1,2})\\s*:\\s*(\\d{2})/);
    if (clock) {
      const h = parseInt(clock[1], 10), mi = parseInt(clock[2], 10);
      if (h === 42 && mi === 0) return null;
      if (h <= 42 && mi <= 59) return h + ":" + String(mi).padStart(2, "0");
    }
    const mH = t.match(/(\\d{1,2})\\s*h/i); const mM = t.match(/(\\d{1,3})\\s*m/i);
    if (mH || mM) {
      const h = mH ? parseInt(mH[1], 10) : 0; const mi = mM ? parseInt(mM[1], 10) : 0;
      if (h === 42 && mi === 0) return null;
      if (h <= 42 && mi <= 59) return h + ":" + String(mi).padStart(2, "0");
    }
    return null;
  };
  const events = [];

  // Fechamento preventivo de modais bloqueantes
  const offline = document.getElementById("offline-modal");
  if (offline && !offline.classList.contains("hidden")) {
    (document.getElementById("offline-modal-close") || offline.querySelector("button"))?.click();
    events.push("FECHOU_OFFLINE_MODAL");
  }
  const conn = document.getElementById("conn-overlay");
  const connExpired = !!(conn && !conn.classList.contains("hidden"));
  if (connExpired) {
    document.getElementById("conn-retry")?.click();
    events.push("CLICOU_RECONECTAR");
  }

  // Detecta se o jogo está no modo economia de bateria
  const bsOverlay = document.getElementById("battery-save-overlay");
  const inBatterySaver = !!(bsOverlay && !bsOverlay.classList.contains("hidden"));

  // Hunt / Wave
  let wave = text(document.querySelector(".bs-hunt")) ||
             text(document.getElementById("wave-title")) ||
             text(document.querySelector(".stage-name, .stage-name-line"));
  if (!wave || wave === "—" || wave === "-") {
    const tm = (document.title || "").match(/·\s*(.*?)\s*—/);
    if (tm && tm[1]) wave = tm[1].trim();
  }

  // Party e Nível
  const shooters = Array.from(document.querySelectorAll("#bar-shooters .bar-member")).map((el, slot) => ({
    slot,
    text: text(el),
    classes: el.className || "",
  }));
  const vocLvlRe = /(?:paladin|knight|monk|sorcerer|druid)\s*[·•\-–]\s*(?:lvl|m|level|n[ií]vel)?\s*(\d+)/i;
  const partyLvls = [];
  for (const s of shooters) {
    const m = s.text.match(vocLvlRe);
    if (m) {
      const lvl = parseInt(m[1], 10);
      if (lvl > 0 && lvl <= 5000) partyLvls.push(lvl);
    }
  }
  let level = partyLvls.length > 0 ? Math.max(...partyLvls) : 0;
  if (!level) {
    const lvlEl = document.querySelector(".hd-lvl, .hud-lvl, .cyc-char-lvl, .bar-char-lvl, .player-level, #player-level, [data-player-level], .pm-lvl, .char-lvl");
    if (lvlEl) {
      const m = (lvlEl.textContent || "").match(/\d+/);
      if (m) level = parseInt(m[0], 10);
    }
  }

  // Gold — robusto a k/kk/m, pt-BR e data-gold; null quando ilegível (nunca 0 fantasma)
  let gold = null;
  const goldEls = [
    document.getElementById("hud-gold"),
    document.querySelector(".hud-money, .mk-goldamt, .ac-wallet-val, .wallet-gold, #gold-count, [data-gold]"),
    document.querySelector("[title*='Gold' i], [aria-label*='Gold' i]"),
  ].filter(Boolean);
  for (const gEl of goldEls) {
    const rawAttr = gEl.getAttribute("data-gold") || gEl.getAttribute("data-value") || gEl.getAttribute("title") || "";
    gold = parseGold(rawAttr);
    if (gold == null) gold = parseGold(text(gEl));
    if (gold != null) break;
  }

  // Stamina — relógio, Xh Ym, % e tooltip; placeholder 42:00 = desconhecido
  let stamina = normStam(text(document.getElementById("stamina-time") || document.querySelector(".stamina-time, .stamina-val, #stamina-val, [data-stamina]")));
  if (!stamina) {
    const panel = document.getElementById("stamina-panel");
    stamina = normStam(panel?.textContent || "") || normStam(panel?.getAttribute("title") || "");
  }
  let staminaPct = normStam(text(document.getElementById("stamina-pct") || document.querySelector(".stamina-pct")));
  if (!staminaPct) {
    const bTip = document.querySelector("button[title*='stamina' i], [data-tip*='stamina' i], [aria-label*='stamina' i]");
    if (bTip) {
      const tip = bTip.getAttribute("title") || bTip.getAttribute("data-tip") || bTip.getAttribute("aria-label") || bTip.textContent || "";
      const cand = normStam(tip);
      if (cand) { if (/%$/.test(cand)) staminaPct = cand; else if (!stamina) stamina = cand; }
    }
  }
  if (staminaPct && /%$/.test(staminaPct)) stamina = staminaPct;

  // Loop Toggle sempre ON
  const loop = document.getElementById("loop-toggle");
  let loopOn = !!loop?.classList.contains("on");
  if (loop && !loopOn) {
    loop.click();
    events.push("ATIVOU_MODO_LOOP");
    loopOn = true;
  }

  // Mochila/pouch — vários IDs do jogo + fallback por contagem de células
  let invText = text(document.getElementById("inv-count"))
    || text(document.getElementById("pouch-count") || document.querySelector(".pouch-count, #supplypouch-count, .supply-count, #bag-count, .bag-count"));
  if (!invText || !/\\d+\\s*\\/\\s*\\d+/.test(invText)) {
    const pouchCells = document.querySelectorAll("#inv-grid .cell, #supplypouch-grid .cell").length;
    const pouchCap = parseInt((document.getElementById("inv-grid")?.getAttribute("data-cap") || document.getElementById("supplypouch-grid")?.getAttribute("data-cap") || "0"), 10) || 0;
    if (pouchCells > 0 && pouchCap > 0) invText = pouchCells + "/" + pouchCap;
    else if (pouchCells > 0 && !invText) invText = String(pouchCells);
  }

  return {
    loading: false,
    wave,
    level,
    partySlotsCount: shooters.length || 3,
    party: shooters,
    gold,
    stamina,
    loopOn,
    invText,
    connExpired,
    inBatterySaver,
    events
  };
};`;

// ===================================================================
// MAIN
// ===================================================================

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log('Baiak Idle Bot TS — uso: bun run src/index.ts [opções] | BOT_ARGS="..."');
    console.log("  --no-headless | --stream | --no-hunt | --no-heal | --no-sell | --no-treino | --no-boss | --no-equip");
    console.log("  --force-hunt --hunt-id <id> | --port <n> --host <ip> | --token <tok>");
    console.log("  --sell-pct <n> --heal-pct <n> --hp-pot-pct <n> --mana-pot-pct <n> | --no-reduce-vfx");
    console.log("  --no-auction | --auction-live --auction-budget <coins> --auction-margin <pct> --auction-max-items <n>");
    console.log("  Env equivalentes: HEADLESS, STREAM, AUTO_HUNT, FORCE_HUNT, HUNT_ID, BAIAK_TOKEN, SELL_PCT, ...");
    return;
  }
  console.log("====================================================================");
  console.log(" ⚔️  BAIAK IDLE BOT v3 — 100% TYPESCRIPT COM BUN");
  console.log(" [*] Telemetria desacoplada + Fila serializada de ações");
  console.log(" [*] Execução direta em memória (Zero arquivos .js em disco)");
  console.log(" [*] Servidor nativo Bun.serve() de ultra-baixa latência");
  console.log("====================================================================");

  const config = parseConfig();
  console.log(`[*] Configurações: Headless=${config.headless} | Porta=${config.port} | Stream=${config.stream}`);
  console.log(`[*] Flags: ${describeFlags(config)}`);
  console.log(`[*] Leilão: ${config.auctionEnabled ? (config.auctionLive ? "LIVE" : "DRY-RUN") : "DESATIVADO"} | orçamento=${config.auctionBudget}c | margem>=${config.auctionMinMarginPct}%`);
  if (config.huntId) console.log(`[*] HUNT_ID=${config.huntId} | FORCE_HUNT=${config.forceHunt}`);

  const dataDir = dirname(config.userDataDir);
  try { if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true }); } catch (_) {}

  const watchdog = new Watchdog();
  const profiler = new Profiler(dataDir);
  profiler.clearDeathPenalties();
  const huntMatrix = new HuntMatrix(dataDir);
  let magicState: Record<string, any> = classifyMagic([]);
  let helperBySlot: Record<number, any> = {};
  let latestAnalyzers: Record<string, any> = {};
  let lastGearSlot: number | null = null;
  let cachedAccountChars: Record<string, any> = {};
  let lastAccountCharsSync = 0;

  const syncAccountChars = async (): Promise<Record<string, any>> => {
    const now = Date.now();
    if (Object.keys(cachedAccountChars).length > 0 && now - lastAccountCharsSync < 300000) return cachedAccountChars;
    const token = config.token || process.env.BAIAK_TOKEN || "";
    if (!token) return cachedAccountChars;
    try {
      // Cliente tRPC real (paridade com o bundle): batch=1 + input {json},
      // header `authorization: Bearer` (minúsculo). O GET puro antigo caía
      // em 400/401 e deixava `cachedAccountChars` vazio -> status.json com
      // "Slot 1/2/3" e vocações chutadas.
      const trpc = createTrpcClient(token);
      const raw: any = await trpc.query('characters.list').catch(() => null);
      const chars = normalizeChars(raw);
      if (chars.length > 0) {
        const mapping: Record<string, any> = {};
        for (const c of chars) {
          const v = String(c?.vocation || "").toLowerCase();
          if (v) mapping[v] = { id: c?.id, name: c?.name, vocation: v, level: c?.level || 1 };
        }
        cachedAccountChars = mapping;
        lastAccountCharsSync = now;
        console.log(`[*] [TRPC] characters.list OK (${chars.length} chars)`);
      } else {
        console.warn(`[TRPC AVISO] characters.list vazio — mantendo cache (${Object.keys(cachedAccountChars).length})`);
      }
      // Party real quando disponível (slots/HP/MP autoritativos no status).
      try {
        const party: any = await trpc.query('characters.myParty').catch(() => null);
        if (party) (telemetry as any).trpcParty = party;
      } catch (_) {}
    } catch (err: any) {
      console.warn(`[TRPC AVISO] characters.list falhou: ${err?.message || err}`);
    }
    return cachedAccountChars;
  };

  const extrasScheduler = new DefaultExtrasScheduler();

  const subsystems: Record<string, SubsystemInfo> = {
    anti_bot: { status: "FUNCIONAL", detail: "Modo leve: zero input sintético" },
    auto_sell: { status: config.autoSell ? "FUNCIONAL" : "AGUARDANDO", detail: config.autoSell ? `Auto-sell ativo (≥${config.sellThresholdPct}% da Pouch)` : "Desativado" },
    auto_heal: { status: config.autoHeal ? "FUNCIONAL" : "AGUARDANDO", detail: config.autoHeal ? `Cura (<${config.healBelowPct}%), HP (<${config.hpPotionBelowPct}%), MP (<${config.manaPotionBelowPct}%)` : "Desativado" },
    auto_equip: { status: config.autoEquip ? "FUNCIONAL" : "AGUARDANDO", detail: config.autoEquip ? "Auto-equip de itens superiores ativo" : "Desativado" },
    auto_treino: { status: config.autoTreino ? "FUNCIONAL" : "AGUARDANDO", detail: config.autoTreino ? "Ciclo automático de stamina e treino online" : "Desativado" },
    auto_boss: { status: config.autoBoss ? "FUNCIONAL" : "AGUARDANDO", detail: config.autoBoss ? "Desafio diário de chefes ativo" : "Desativado" },
    auto_extras: { status: "FUNCIONAL", detail: "Scheduler 24/7 de baús, codex, preys e passe ativo" },
    auto_arena: { status: "FUNCIONAL", detail: "Fila diária PvP e resgate de vitórias" },
    event_tracker: { status: "FUNCIONAL", detail: "Entrega automática de missões e cotas de evento" },
    cyclopedia_bestiary: { status: "FUNCIONAL", detail: "Auto-claim de bestiário e catálogo de monstros" },
    forge_imbue: { status: "FUNCIONAL", detail: "Auto-tier dust conv e imbuements seguros" },
    watchdog: { status: "FUNCIONAL", detail: "Auto-Reconnect + Hunt Resume ativo" },
    hunt_analyzer: { status: "FUNCIONAL", detail: "Coleta de telemetria contínua ativa" },
    daily_reward: { status: "VERIFICANDO", detail: "Monitorando recompensas diárias" },
    auto_promote: { status: "AGUARDANDO_REQUISITO", detail: "Aguardando nível 20 e 20.000 gold" },
  };

  const telemetry = new TelemetryStore();
  const protocolMapper = new ProtocolMapper(dataDir);
  const explorationPolicy = {
    sampleSec: config.exploreSampleSec,
    maxDeaths: config.exploreMaxDeaths,
    maxDamageTakenPct: config.exploreMaxDamageTakenPct,
    cooldownSec: config.exploreCooldownSec,
  };
  const actionQueue = new ActionQueue();
  (telemetry as any).partyMembersRaw = [];

  // Fecha picker/modal preso. Toda ação DOM roda dentro de try/finally com
  // este fechamento: sem ele um timeout de 12-15s deixa o picker aberto e a
  // próxima ação falha em cascata.
  const closeStuckModals = async (): Promise<void> => {
    try {
      await pageRef?.evaluate(() => {
        try {
          const picker = document.getElementById("picker-modal");
          if (picker && !picker.classList.contains("hidden")) {
            const c = picker.querySelector("#picker-modal-close, .im-close, .close-btn, .modal-close, [data-close]");
            if (c) (c as HTMLElement).click();
            else picker.classList.add("hidden");
          }
          const confirm = document.getElementById("confirm-modal");
          if (confirm && !confirm.classList.contains("hidden") && !/comprar|buy|lance|bid|leil|loja|store|pix|vip|premium|donate/i.test(confirm.textContent || "")) {
            const yes = Array.from(confirm.querySelectorAll("button, .btn")).find((b) =>
              /^(ok|yes|sim|confirmar|confirm)$/i.test((b.textContent || "").trim()));
            if (yes) (yes as HTMLElement).click();
          }
        } catch (_) {}
      }).catch(() => null);
    } catch (_) {}
  };

  // Entrada em hunt: DIRETO primeiro (1 pacote `stage`), DOM só como fallback.
  // `lMe=N=>l.send("stage",{huntId:N})` é o que o botão `.stage-go` chama.
  const enterHuntDirectOrDom = async (target: { id?: string; name?: string; resumeLast?: boolean }): Promise<any> => {
    if (target?.id) {
      try {
        const ok = await sendStage(pageRef, target.id);
        if (ok) {
          console.log(`[${new Date().toLocaleTimeString()}] 🏹 [STAGE-DIRECT] send("stage",{huntId:${target.id}}) aceito (1 pacote)`);
          return { success: true, hunt: target.id, method: "room-send" };
        }
      } catch (_) {}
    }
    try {
      return await safeEval<any>(pageRef, "hunt", target, 12000);
    } finally {
      await closeStuckModals();
    }
  };

  // Status file completo — paridade com bot.py update_status_file()
  const writeStatusFile = () => {
    try {
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
      const accChars = cachedAccountChars;
      const rawMembers: any[] = Array.isArray((telemetry as any).partyMembersRaw) ? (telemetry as any).partyMembersRaw : [];
      const slotsMap: Record<string, any> = (magicState?.slots || {}) as any;
      const totalSlots = Math.max(rawMembers.length || 3, telemetry.partySlots || 3);
      const memberLevels: number[] = [];
      const partyMembersOut: any[] = [];
      for (let sid = 0; sid < totalSlots; sid++) {
        const found = rawMembers.find((m: any) => m?.slot === sid);
        const voc = (found?.voc) || (sid === 0 ? "Knight (EK)" : (sid === 1 ? "Druid (ED)" : "Sorcerer (MS)"));
        let charInfo: any = null;
        const vocLow = String(voc).toLowerCase();
        for (const [vk, vi] of Object.entries(accChars)) {
          if (
            vocLow.includes(vk) ||
            (vk.includes("knight") && (vocLow.includes("knight") || vocLow.includes("ek"))) ||
            (vk.includes("druid") && (vocLow.includes("druid") || vocLow.includes("ed"))) ||
            (vk.includes("sorcerer") && (vocLow.includes("sorcerer") || vocLow.includes("ms"))) ||
            (vk.includes("paladin") && (vocLow.includes("paladin") || vocLow.includes("rp"))) ||
            (vk.includes("monk") && (vocLow.includes("monk") || vocLow.includes("mk")))
          ) {
            charInfo = vi;
            break;
          }
        }
        const extractedName = found?.name && !String(found.name).startsWith("Slot") && !["Secondpally", "sencodtank", "Sofisico"].includes(found.name) ? found.name : null;
        const extractedLvl = (found?.level && Number(found.level) >= 10) ? Number(found.level) : null;
        const defaultName = `Slot ${sid + 1}`;
        const defaultLvl = Number(telemetry.level) || 0;
        const charNameVal = extractedName || charInfo?.name || defaultName;
        const lvl = extractedLvl || charInfo?.level || defaultLvl;
        memberLevels.push(Number(lvl) || 0);
        const sInfo = slotsMap[String(sid)] || {};
        const hInfo = helperBySlot[sid] || {};
        partyMembersOut.push({
          slot: sid, name: charNameVal, voc, level: lvl,
          heal: hInfo.heal || (sInfo.heal ? "Configurada (<75%)" : "Nenhuma"),
          mana: hInfo.manaPotion || "mana potion",
          attack: !!sInfo.attack !== false ? (sInfo.attack ?? true) : true,
          ready: !!(sInfo.ready || (sInfo.heal && sInfo.mana)),
        });
      }
      const topLevel = memberLevels.length > 0 ? Math.max(...memberLevels) : Number(telemetry.level) || 0;
      const activeHunt = telemetry.hunt && telemetry.hunt !== "Conectando..." && telemetry.hunt !== "—" ? telemetry.hunt : "—";
      const snap = telemetry.snapshot({ character: partyMembersOut[0]?.name || null, subsystems });
      const statusData = {
        ...snap,
        character: partyMembersOut[0]?.name || null,
        connected: !!snap.online,
        hunt: activeHunt,
        level: Math.max(snap.level, topLevel),
        party_members: partyMembersOut,
        last_hunt: (profiler as any).lastPlayedName || activeHunt,
        last_hunt_id: (profiler as any).lastPlayedId || null,
        benchmarks: (profiler as any).benchmarks,
        hunt_decision: (profiler as any).lastDecision,
        magic: magicState,
        analyzers: latestAnalyzers,
        hunt_matrix: (huntMatrix as any).matrix,
        protocol_map: protocolMapper.snapshot(),
      };
      writeFileSync(join(dataDir, "status.json"), JSON.stringify(statusData, null, 2), "utf-8");
    } catch (_) {}
  };

  // Estado do fluxo queue -> hunt (admitToken/fp/ext) + reconnect token.
  // O jogo exige: joinOrCreate("queue",{token}) -> onMessage("pos"/"go") ->
  // leave() -> joinOrCreate("hunt",{...admitToken}). O bot só observava; agora
  // registra cada passo para diagnóstico e resume via reconnectionToken.
  const queueFlow: { pos: any; admitToken: string | null; lastGoAt: number } = {
    pos: null, admitToken: null, lastGoAt: 0,
  };

  const handleWsPayload = (buf: Uint8Array, meta?: { requestId: string; url: string; opcode: number }) => {
    try {
      const fr = decodeFrame(buf);
      if (!fr) return;
      // ROOM_STATE (14) / PATCH (15): estado autoritativo (HP, players, dead,
      // huntId, wave, lootGold). Sem o .schema da build não decodificamos os
      // campos aqui, mas o frame prova vida da sala: alimenta watchdog +
      // evita o reload de 45s no meio de farm estável. Os valores chegam via
      // kernel mirror (`window.__baiak_state`) + ROOM_DATA abaixo.
      if (fr.opcode === 0x0e || fr.opcode === 0x0f) {
        watchdog.onWsFrame();
        telemetry.setOnline(true);
        (telemetry as any).lastRoomStateAt = Date.now();
        return;
      }
      if (!fr.type) return;
      const typ = fr.type;
      const pay = fr.payload;

      protocolMapper.ingest(typ, pay, buf.byteLength);

      telemetry.ingestWebSocketFrame(typ, pay);
      const mappedHunt = pay && typeof pay === 'object'
        ? (pay.huntId || pay.hunt?.id || pay.currentHuntId)
        : null;
      if (typeof mappedHunt === 'string') protocolMapper.setActiveHunt(mappedHunt);

      if (typ === "combatlog") {
        let newKills = 0;
        if (Array.isArray(pay)) {
          newKills = pay.filter(e => e && typeof e === "object" && e.killed).length;
        } else if (pay && typeof pay === "object" && pay.killed) {
          newKills = 1;
        }
        if (newKills > 0) {
          profiler.recordKill(newKills);
          writeStatusFile();
        }
      } else if (typ === "log" || typ === "notify") {
        const msg = (pay && typeof pay === "object" ? (pay.text || pay.msg || "") : String(pay || ""));
        if (/drop|item|loot/i.test(msg)) {
          console.log(`[${new Date().toLocaleTimeString()}] 📦 [LOOT] ${msg}`);
        }
        writeStatusFile();
      } else if (["state", "init", "sync", "player", "snapshot"].includes(typ)) {
        writeStatusFile();
      } else if (typ === "pos") {
        // Fila de entrada: posição na queue.
        queueFlow.pos = (pay && typeof pay === 'object' && pay.position !== undefined) ? pay.position : pay;
        console.log(`[${new Date().toLocaleTimeString()}] ⏳ [QUEUE] pos=${JSON.stringify(queueFlow.pos)}`);
      } else if (typ === "go") {
        // Admissão: o servidor liberou a hunt — guarda admitToken.
        const tok = pay && typeof pay === 'object' ? (pay.token || pay.admitToken || null) : null;
        if (tok) { queueFlow.admitToken = String(tok); queueFlow.lastGoAt = Date.now(); }
        console.log(`[${new Date().toLocaleTimeString()}] ✅ [QUEUE] admitido (admitToken ${tok ? 'recebido' : 'ausente'})`);
      } else if (typ === "joined") {
        const hid = pay && typeof pay === 'object' ? (pay.huntId || null) : null;
        if (typeof hid === 'string') {
          telemetry.updateHunt(hid, 'websocket');
          protocolMapper.setActiveHunt(hid);
        }
        (telemetry as any).lastJoined = pay;
        console.log(`[${new Date().toLocaleTimeString()}] 🏹 [JOINED] hunt=${hid || '?'} wave=${pay?.wave ?? '?'}`);
        writeStatusFile();
      } else if (typ === "toHunt" || typ === "resume" || typ === "reconnectOk") {
        if (typ === "reconnectOk") (telemetry as any).reconnectOk = true;
        const hid = pay && typeof pay === 'object' ? (pay.huntId || pay.hunt?.id || null) : (typeof pay === 'string' ? pay : null);
        if (typeof hid === 'string') telemetry.updateHunt(hid, 'websocket');
        console.log(`[${new Date().toLocaleTimeString()}] 🔄 [${typ.toUpperCase()}] ${typeof hid === 'string' ? hid : ''}`);
        writeStatusFile();
      } else if (typ === "toCity") {
        (telemetry as any).lastToCityAt = Date.now();
        console.log(`[${new Date().toLocaleTimeString()}] 🏙️ [TOCITY] servidor mandou para cidade`);
        writeStatusFile();
      } else if (typ === "takeover" || typ === "serverdrop") {
        console.log(`[${new Date().toLocaleTimeString()}] ⚠️ [${typ.toUpperCase()}] ${JSON.stringify(pay)?.slice(0, 200)}`);
        (telemetry as any)[typ] = pay;
      } else if (typ === "deaths") {
        (telemetry as any).lastDeaths = (pay && (pay.rows || pay)) || [];
        console.log(`[${new Date().toLocaleTimeString()}] 💀 [DEATHS] ${(Array.isArray((telemetry as any).lastDeaths) ? (telemetry as any).lastDeaths.length : '?')} registros`);
      } else if (typ === "dailystatus" || typ === "event" || typ === "eventmeta" || typ === "huntgate" ||
                 typ === "expeditiongate" || typ === "codexgate" || typ === "charmsgate" || typ === "dungeongate") {
        (telemetry as any)[`last_${typ}`] = pay;
      } else if (typ === "party" || typ === "partystate" || typ === "partyApplied" || typ === "partyhunt" || typ === "mine") {
        // HP/MP/slots autoritativos — cai na digestão genérica da telemetria.
      }
    } catch (_) {}
  };

  let pageRef: any = null;
  let cdpRef: any = null;
  let getFrameRef: (() => Buffer | null) = () => null;

  // Inicia Servidor Web Bun
  startServer(config.port, config.host, {
    getState: () => telemetry.snapshot({ subsystems }),
    getPage: () => pageRef,
    getCdp: () => cdpRef,
    getLatestFrame: () => getFrameRef(),
    dataDir,
  });

  // Inicia o Navegador com hook de WebSocket
  const browserCtx = await launchBrowser(
    config,
    () => { watchdog.onWsOpen(); telemetry.setOnline(true); },
    () => watchdog.onWsFrame(),
    () => { watchdog.onWsClose(); telemetry.setOnline(false); },
    handleWsPayload
  );

  pageRef = browserCtx.page;
  cdpRef = browserCtx.cdp;
  getFrameRef = browserCtx.getLatestFrame;

  let running = true;
  const shutdown = async () => {
    if (!running) return;
    running = false;
    console.log("\n[*] Encerrando bot com segurança...");
    await browserCtx.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // --- Estado interno de cadências ---
  const t0Loop = Date.now();
  let lastPrint = Date.now();
  let lastHuntAttempt = 0;
  let huntRetryDelayMs = 14000;
  let lastSellTime = 0;
  let lastDailyCheck = 0;
  let lastPromoteCheck = 0;
  let lastEquipCheck = 0;
  let lastPotionCheck = 0;
  let lastTreinoCheck = 0;
  let lastStatusWrite = 0;
  let lastTreinoTime = 0;
  let lastSpellGear = 0;
  const spellSlotCooldown = new Map<number, number>();
  const spellSlotState = new Map<number, string>();
  let lastPickerOpen = false;
  let lastWatchdogCheck = 0;
  let lastForceDebug = 0;
  let lastForceAction = 0;
  let lastHuntScan = 0;
  let huntScanInFlight = false;
  let lastHudCheck = 0;
  let cachedHud: any = {};
  let previousHelperLevel = 0;
  let previousPartySignature = '';
  let previousMagicSignature = '';
  let lastHelperTrigger = 0;
  let needPotionCheck = true;
  let cityStreak = 0;
  let needsHuntEntry = false;
  // Heartbeat anti-stall: se a hunt não progride (kills/waves/gold parados),
  // força re-entrada em vez de ficar parado até o watchdog recarregar.
  let lastProgressKills = 0;
  let lastProgressWaves = 0;
  let lastProgressGold = 0;
  let lastProgressTime = Date.now();
  let lastStallCheck = 0;
  // Dreno de eventos do kernel hook (cobre Blob/fragmentado que o CDP perde).
  let lastRoomDrain = 0;
  // Espelho de estado do kernel (ROOM_DATA + battery-save NWe indireto).
  let lastRoomStatePull = 0;

  // Não bloqueie o processo aguardando o canvas/mapa por uma avaliação DOM.
  // Em uma VPS com renderer saturado essa chamada pode ficar pendente, embora
  // o WebSocket já consiga negociar em paralelo. O loop operacional e o
  // watchdog acompanham o boot de forma não bloqueante.
  console.log("[*] Aguardando handshake do jogo em segundo plano (até 120s)...");
  await new Promise(r => setTimeout(r, 8000));
  await syncAccountChars().catch(() => null);
  writeStatusFile();

  // =====================================================================
  // LOOP PRINCIPAL DE OPERAÇÃO (Telemetria Desacoplada e Fila de Ações)
  // =====================================================================
  while (running) {
    try {
      const now = Date.now();

      // Engine mode discovers unlocked hunts from the live picker before
      // making any recommendation. The scan closes the picker without moving
      // the character and refreshes periodically as levels unlock new hunts.
      if ((config.huntMode === 'engine' || config.huntMode === 'hybrid') &&
          !config.forceHunt && !huntScanInFlight &&
          (!Array.isArray((profiler as any).unlockedIds) || (profiler as any).unlockedIds.length === 0) &&
          telemetry.online && telemetry.level > 0 && now - lastHuntScan >= 15000) {
        lastHuntScan = now;
        // Candidate discovery is local and deterministic; do not wait for the
        // DOM action queue just to build the engine pool.
        const unlocked = HUNTS_TABLE.filter((h) => h.min <= telemetry.level).map((h) => h.id);
        (profiler as any).unlockedIds = unlocked;
        console.log(`[${new Date().toLocaleTimeString()}] [ENGINE SCAN] nível=${telemetry.level} candidatos=${unlocked.length}`);
      }

      // FORCE_HUNT must not depend on the expensive DOM telemetry tick. The
      // WebSocket already tells us the current hunt, so enqueue the operator's
      // target as soon as the session is online.
      if (config.forceHunt && config.huntId && telemetry.online && !telemetry.inTreino &&
          now - lastForceAction >= 15000) {
        const current = String(telemetry.hunt || '').toLowerCase().replace(/[-\s]/g, '');
        const target = String(config.huntId).toLowerCase().replace(/[-\s]/g, '');
        const currentHunt = matchHunt(telemetry.hunt);
        const atTarget = current && (
          current.includes(target) ||
          target.includes(current) ||
          currentHunt?.id === config.huntId
        );
        if (!atTarget) {
          lastForceAction = now;
          const queued = actionQueue.enqueue({
            id: 'force-hunt',
            name: 'force-hunt',
            priority: 20,
            timeoutMs: 60000,
            run: async () => {
              console.log(`[${new Date().toLocaleTimeString()}] [FORCE_HUNT] ${telemetry.hunt} -> ${config.huntId}`);
              // Direto primeiro (1 pacote), DOM como fallback com finally.
              const direct = await sendStage(pageRef, config.huntId);
              const result = direct
                ? { success: true, hunt: config.huntId, method: 'room-send' }
                : await (async () => {
                    try {
                      return await safeEval<any>(pageRef, 'hunt', { id: config.huntId, name: '', resumeLast: false }, 45000);
                    } finally {
                      await closeStuckModals();
                    }
                  })();
              console.log(`[${new Date().toLocaleTimeString()}] [FORCE_HUNT RESULT] ${JSON.stringify(result)}`);
              if (result?.success || result?.alreadyThere) {
                telemetry.updateHunt(result.hunt || config.huntId, direct ? 'websocket' : 'dom');
                needsHuntEntry = false;
              }
            },
          });
          if (!queued) lastForceAction = now - 12000;
        }
      }

      // 1. Checagem do Watchdog (Auto-Reconnect imediato se offline)
      const watchdogInterval = watchdog.isConnected() ? 30000 : 3000;
      if (now - lastWatchdogCheck >= watchdogInterval) {
        lastWatchdogCheck = now;
        const wResult = await watchdog.checkAndRecover(pageRef, cdpRef);
        if (wResult.reconnected) {
          console.log(`[WATCHDOG] 🔄 Sessão restaurada com sucesso! (${wResult.reason})`);
          needsHuntEntry = true;
          (profiler as any).unlockedIds = [];
          lastHuntScan = 0;
          // Re-anuncia presença na sala como o cliente real faz após join.
          try { await roomSend(pageRef, 'ready', {}); } catch (_) {}
        }
      }

      // 1b. Dreno de eventos do kernel hook (page-side). O CDP perde binário
      // fragmentado/Blob (opcode!=2 vira utf-8); o hook no page vê ArrayBuffer
      // e Blob corretamente. Ingere queue-flow (pos/go/joined/toHunt/resume/
      // reconnectOk/deaths/...) + party/partystate HP/MP sem DOM polling.
      if (telemetry.online && now - lastRoomDrain >= 3000) {
        lastRoomDrain = now;
        try {
          const evs = await roomDrainEvents(pageRef);
          for (const ev of evs.slice(-120)) {
            try {
              protocolMapper.ingest(ev.type, ev.payload, 0);
              telemetry.ingestWebSocketFrame(ev.type, ev.payload);
              if (ev.type === 'go' && ev.payload && typeof ev.payload === 'object' && ev.payload.token) {
                queueFlow.admitToken = String(ev.payload.token);
                queueFlow.lastGoAt = Date.now();
              } else if (ev.type === 'pos') {
                queueFlow.pos = (ev.payload && ev.payload.position !== undefined) ? ev.payload.position : ev.payload;
              } else if (ev.type === 'joined' && ev.payload?.huntId) {
                telemetry.updateHunt(String(ev.payload.huntId), 'websocket');
              } else if ((ev.type === 'toHunt' || ev.type === 'resume') && ev.payload) {
                const hid = typeof ev.payload === 'string' ? ev.payload : (ev.payload.huntId || null);
                if (typeof hid === 'string') telemetry.updateHunt(hid, 'websocket');
              } else if (ev.type === 'reconnectOk') {
                (telemetry as any).reconnectOk = true;
              }
            } catch (_) {}
          }
          // Espelho de estado (hunt/wave/queue/party) a cada 6s.
          if (now - lastRoomStatePull >= 6000) {
            lastRoomStatePull = now;
            try {
              const rs = await pageRef?.evaluate(() => {
                try {
                  const w = window as any;
                  return w.__baiak_state ? JSON.parse(JSON.stringify(w.__baiak_state)) : null;
                } catch { return null; }
              }).catch(() => null);
              if (rs) {
                if (typeof rs.huntId === 'string' && rs.huntId) telemetry.updateHunt(rs.huntId, 'websocket');
                else if (typeof rs.hunt === 'string' && rs.hunt && rs.hunt !== 'Conectando...') telemetry.updateHunt(rs.hunt, 'websocket');
                if (rs.queue?.admitToken) { queueFlow.admitToken = String(rs.queue.admitToken); }
                if (rs.queue?.pos !== null && rs.queue?.pos !== undefined) { queueFlow.pos = rs.queue.pos; }
                if (Array.isArray(rs.players) && rs.players.length > 0) {
                  (telemetry as any).roomPlayers = rs.players;
                }
                if (rs.lastFrame) watchdog.onWsFrame();
              }
            } catch (_) {}
          }
        } catch (_) {}
      }

      // 2. Cooldowns e flags de verificação periódica
      const sellAllowed = (now - lastSellTime) >= 125000;
      const shouldCheckDaily = (now - lastDailyCheck) >= 60000;
      const shouldCheckPromote = (now - lastPromoteCheck) >= 30000;

      // 3. Tick de telemetria ultra-leve (não percorre o body, responde em < 20ms)
      let domState: any = null;
      try {
        const cdpEval = cdpRef.send("Runtime.evaluate", {
          expression: "(" + FAST_STATE_JS + ")()",
          returnByValue: true,
          awaitPromise: false,
        });
        const evalRes: any = await Promise.race([
          cdpEval,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        domState = evalRes?.result?.value || null;
      } catch (_) {
        domState = null;
      }

      if (shouldCheckDaily) lastDailyCheck = now;
      if (shouldCheckPromote) lastPromoteCheck = now;

      if (domState) {
        if (domState.error) {
          console.log(`[${new Date().toLocaleTimeString()}] ⚠️ [FAST_STATE ERRO]: ${domState.error}`);
        }
        if (domState.loading) {
          watchdog.keepAlive();
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        const source = domState.inBatterySaver ? "battery-save" : "dom";
        if (domState.wave) telemetry.updateHunt(domState.wave, source);
        if (domState.level) telemetry.updateLevel(domState.level, source);
        if (domState.gold !== undefined && domState.gold !== null) telemetry.updateGold(domState.gold, source);
        if (domState.stamina) telemetry.updateStamina(domState.stamina, source);
        telemetry.updateLoopMode(domState.loopOn, source);
        telemetry.updateBagSlots(domState.invText, source);
        telemetry.updateParty(domState.party, source);

        if (domState.level > 0 || domState.partySlotsCount > 1 || domState.wave) {
          watchdog.keepAlive();
        }

        // Log de eventos do DOM
        for (const ev of (domState.events || [])) {
          console.log(`[${new Date().toLocaleTimeString()}] ⚡ [${ev}]`);
          if (ev.includes("AUTO_SELL_POUCH") || ev.includes("CONFIRMOU_MODAL_ACAO") || ev.includes("CONFIRMOU_VENDER_TUDO")) {
            lastSellTime = now;
          }
          if (ev.includes("DAILY_REWARD_COLETADA")) {
            subsystems.daily_reward = { status: "FUNCIONAL", detail: "Recompensa diária coletada com sucesso hoje" };
          }
          if (ev.includes("PROMOVEU_CAMPEAO")) {
            subsystems.auto_promote = { status: "FUNCIONAL", detail: `Campeão promovido com sucesso (${ev})` };
          }
        }

        // HUD completo (spells/helpers/analyzers) — cadência a cada 15s sem travar loop
        let hud: any = cachedHud;
        if (now - lastHudCheck >= 15000) {
          lastHudCheck = now;
          try {
            cachedHud = await safeEval<any>(pageRef, "hud", null, 8000) || cachedHud;
            hud = cachedHud;
            if (hud.level) telemetry.updateLevel(hud.level, "dom");
            if (hud.gold !== undefined && hud.gold !== null) telemetry.updateGold(hud.gold, "dom");
            if (hud.stamina) telemetry.updateStamina(hud.stamina, "dom");
            if (hud.analyzers) latestAnalyzers = hud.analyzers;
            for (const hlp of hud.helpers || []) {
              if (hlp && typeof hlp === "object" && hlp.slot !== undefined && hlp.slot !== null) {
                helperBySlot[Number(hlp.slot)] = hlp;
              }
            }
            magicState = classifyMagic(hud.spells || [], Object.keys(helperBySlot).sort().map((k) => helperBySlot[Number(k)]));
            if (!(telemetry as any).partyMembersRaw?.length) (telemetry as any).partyMembersRaw = hud.partyMembers || [];
            const partySignature = JSON.stringify((hud.partyMembers || []).map((m: any) => ({ name: m.name, voc: m.voc, level: m.level })));
            const magicSignature = JSON.stringify({ names: magicState.names, slots: magicState.slots });
            (telemetry as any).helperTriggerState = helperTrigger({
              level: telemetry.level,
              previousLevel: previousHelperLevel,
              partySignature,
              previousPartySignature,
              magic: magicState,
              magicSignature,
              previousMagicSignature,
              hpPct: Number(hud.hpPct || hud.hpPercent || 0) || undefined,
              manaPct: Number(hud.manaPct || hud.manaPercent || 0) || undefined,
              damageTakenPerSecond: Number(latestAnalyzers?.taken_per_second || 0) || undefined,
              maxHp: Number(hud.hpMax || 0) || undefined,
              now,
              lastRun: lastHelperTrigger,
            });
            (telemetry as any).helperTriggerReasons = (telemetry as any).helperTriggerState.reasons;
            previousHelperLevel = telemetry.level;
            previousPartySignature = partySignature;
            previousMagicSignature = magicSignature;
          } catch (_) {}
        }

        // Cidade / Templo
        const wave = telemetry.hunt;
        const waveLow = (wave || "").toLowerCase();
        const looksCity = wave === "Cidade" || wave === "City" || wave === "Templo" || wave === "Temple"
          || ["cidade", "city", "templo", "temple"].some((w) => waveLow.includes(w));
        const pickerOpen = !!hud.pickerOpen;
        lastPickerOpen = pickerOpen;
        if (looksCity && !pickerOpen) cityStreak++;
        else cityStreak = 0;
        const isCity = cityStreak >= 3;

        // Reconexão detectada
        if (domState.connExpired) needsHuntEntry = true;

        // Profiler
        if (looksLikeTreino(wave) || telemetry.inTreino) {
          if ((profiler as any).activeHuntId !== undefined && (profiler as any).activeHuntId !== null) {
            try { (profiler as any).commitSession(telemetry.gold, telemetry.kills, false); } catch (_) {}
            (profiler as any).activeHuntId = null;
            (profiler as any).huntStartTime = null;
          }
        } else if (!isCity && wave && wave !== "—" && wave !== "Conectando...") {
          const matched = matchHunt(wave);
          const hId = matched ? matched.id : "current_hunt";
          const hName = matched ? matched.name : wave;
          if ((profiler as any).activeHuntId !== hId) {
            try { (profiler as any).startSession(hId, hName, telemetry.gold, telemetry.kills); } catch (_) {}
            console.log(`[${new Date().toLocaleTimeString()}] 🏹 [SESSÃO INICIADA] Monitorando telemetria em ...`);
          } else {
            try {
              (profiler as any).updateTick(telemetry.gold, telemetry.kills);
              const b = ((profiler as any).benchmarks || {})[hId] || {};
              const elapsedS = Math.max(1, (Date.now() - t0Loop) / 1000);
              huntMatrix.recordTick(hId, hName, telemetry.level,
                Number(b.gold_per_hour || 0), Number(b.kills_per_hour || 0),
                Math.round((telemetry.waves / elapsedS) * 3600 * 10) / 10,
                Number(b.deaths || 0), (latestAnalyzers as any).xp_per_hour, (latestAnalyzers as any).loot_per_hour);
            } catch (_) {}
          }
        } else if (isCity && (profiler as any).activeHuntId) {
          try { (profiler as any).recordDeath(telemetry.gold, telemetry.kills); } catch (_) {}
          console.log(`[${new Date().toLocaleTimeString()}] ⚠️ [BENCHMARK] Morte/templo confirmado. Retornando à última hunt.`);
        }

        // Decisão de Hunt via Profiler
        const forceId = config.forceHunt ? config.huntId : "";
        const liveId = !isCity ? ((profiler as any).activeHuntId || null) : null;
        const gameReady = watchdog.isConnected() || matchHunt(wave) !== null || telemetry.kills > 0;
        let [shouldEnter, reason] = (profiler as any).shouldResumeLast(config.autoHunt, isCity, liveId, forceId);
        if (!gameReady) shouldEnter = false;
        if (telemetry.inTreino || !config.autoHunt) shouldEnter = false;

        // Engine/hybrid starts as an advisory mode. It can recommend a target
        // from observed/simulated data, but never overrides FORCE_HUNT or hops
        // before the controlled sample policy is integrated with rollback.
        if ((config.huntMode === 'engine' || config.huntMode === 'hybrid') && !config.forceHunt) {
          const unlocked = (profiler as any).unlockedIds || [];
          const observedRank = rankHuntsObserved(unlocked, telemetry.level, magicState, (profiler as any).simScale || 1, protocolMapper.snapshot());
          const bestObserved = observedRank[0];
          const best = bestObserved || (profiler as any).getBestHuntToFarm(telemetry.level, magicState, unlocked);
          const decision = (profiler as any).lastDecision || {};
          if (best) {
            const recommendation = chooseExplorationTarget(
              [{ id: best.id, can_tank: best.can_tank !== false, exp_h: best.exp_h || 0, gold_h: best.gold_h || 0 }],
              liveId,
              explorationPolicy,
            );
            (profiler as any).lastDecision = {
              ...decision,
              mode: recommendation ? 'advisory' : (decision.mode || 'stay'),
              reason: recommendation?.reason || decision.reason || `permanecer em ${best.name}`,
              recommended: recommendation?.id || best.id,
              explorePolicy: explorationPolicy,
            };
            if ((config.huntMode === 'engine' || config.huntMode === 'hybrid') && recommendation && decision.mode === 'sim') {
              shouldEnter = true;
              reason = (profiler as any).lastDecision.reason;
            }
          }
        }

        // FORCE_HUNT is an explicit operator command. Do not let an incomplete
        // profiler/session state suppress it after reconnect or initial boot.
        let forceNeedsEntry = false;
        if (config.forceHunt && config.huntId && !isCity) {
          const current = String(wave || '').toLowerCase().replace(/[-\s]/g, '');
          const target = String(config.huntId).toLowerCase().replace(/[-\s]/g, '');
          const atTarget = current.includes(target) || target.includes(current);
          if (!atTarget) {
            shouldEnter = true;
            needsHuntEntry = true;
            forceNeedsEntry = true;
            reason = `FORCE_HUNT=${config.huntId}`;
          }
        }
        if (config.forceHunt && config.huntId && now - lastForceDebug > 30000) {
          lastForceDebug = now;
          console.log(`[${new Date().toLocaleTimeString()}] [FORCE DEBUG] current=${wave} target=${config.huntId} gameReady=${gameReady} city=${isCity} treino=${telemetry.inTreino} enter=${shouldEnter} needs=${needsHuntEntry} queue=${actionQueue.pendingCount} currentAction=${actionQueue.currentAction || '-'}`);
        }

        // Transição de Stamina e Treino
        const stamTransition = evaluateStaminaTransition(telemetry.stamina, telemetry.inTreino, config.autoTreino);
        if (stamTransition.action === "enter_treino" && (now - lastTreinoTime >= 8000)) {
          lastTreinoTime = now;
          const queuedHunt = actionQueue.enqueue({
            id: "treino",
            name: "treino",
            priority: 10,
            timeoutMs: 12000,
            run: async () => {
              try {
                console.log(`[${new Date().toLocaleTimeString()}] 🧘 [TREINO] Stamina <= 15% (${telemetry.stamina}). Teleportando para Treino Online...`);
                const tr = await safeEval<any>(pageRef, "treino", { want: "train" }, 10000);
                if (tr?.events?.length) {
                  for (const ev of tr.events) console.log(`[${new Date().toLocaleTimeString()}] 🧘 [TREINO] ${ev}`);
                }
                if (tr?.inTreino || tr?.action) {
                  telemetry.inTreino = true;
                  telemetry.updateHunt("Treino Online", "dom");
                  subsystems.auto_treino = { status: "TREINANDO", detail: "Stamina <= 15% — Treino online ativo" };
                }
              } finally {
                await closeStuckModals();
              }
            }
          });
          if (!queuedHunt) console.log(`[${new Date().toLocaleTimeString()}] [HUNT] ação já estava na fila: ${forceId || 'resume'}`);
        } else if (stamTransition.action === "resume_hunt" && telemetry.inTreino) {
          console.log(`[${new Date().toLocaleTimeString()}] 🧘 [TREINO] Stamina recuperou (${telemetry.stamina}) — voltando às hunts`);
          telemetry.inTreino = false;
          needsHuntEntry = true;
          subsystems.auto_treino = { status: "FUNCIONAL", detail: "Stamina recuperou — voltando às hunts" };
        }

        // Fila de Ação: Seleção / Retorno de Hunt (Prioridade 10)
        if ((shouldEnter || needsHuntEntry || forceNeedsEntry) && !telemetry.inTreino && (now - lastHuntAttempt >= huntRetryDelayMs)) {
          lastHuntAttempt = now;
          actionQueue.enqueue({
            id: "hunt",
            name: "hunt",
            priority: 10,
            timeoutMs: 15000,
            run: async () => {
              try { (profiler as any).markSwitch(); } catch (_) {}
              const target = (profiler as any).resumeTarget(forceId);
              const label = target.id ? `${target.name} (${target.id})` : "última do jogo (pick-current)";
              console.log(`[${new Date().toLocaleTimeString()}] 🏹 [HUNT DECISÃO] ${reason || "Retomando"}. Alvo: ${label} | Lvl ${telemetry.level}`);

              const huntRes = await enterHuntDirectOrDom(target);
              const unlocked = idsFromPickerRows((huntRes || {}).unlocked || []);
              if (unlocked.length > 0) {
                (profiler as any).unlockedIds = unlocked;
                if (!telemetry.level) {
                  const inferred = inferLevel(null, unlocked);
                  if (inferred) telemetry.updateLevel(inferred, "dom");
                }
              }
              const went = (huntRes || {}).hunt || target.id;
              const wentName = target.name || went;
              if (huntRes && (huntRes.success || huntRes.alreadyThere) && went) {
                try { (profiler as any).rememberPlayed(went, wentName); } catch (_) {}
              }
              console.log(`[${new Date().toLocaleTimeString()}] 🏹 [RESULTADO TELEPORTE] ${JSON.stringify(huntRes)}`);
              if (huntRes?.success || huntRes?.alreadyThere) {
                needsHuntEntry = false;
                telemetry.updateHunt(huntRes.hunt || target.name || target.id, huntRes.method === 'room-send' ? 'websocket' : 'dom');
                huntRetryDelayMs = 8000 + Math.random() * 6000;
              } else {
                huntRetryDelayMs = 14000 + Math.random() * 12000;
              }
            }
          });
        }

        const isKnownHunt = wave && wave !== "—" && wave !== "-" && wave !== "Conectando...";
        // FORCE_HUNT must be allowed to replace an already-known hunt. The
        // previous unconditional reset cancelled the decision immediately.
        const forceTarget = config.forceHunt && config.huntId;
        const normalizedWave = String(wave || '').toLowerCase().replace(/[-\s]/g, '');
        const normalizedTarget = String(config.huntId || '').toLowerCase().replace(/[-\s]/g, '');
        const alreadyAtForcedHunt = !!forceTarget &&
          (normalizedWave.includes(normalizedTarget) || normalizedTarget.includes(normalizedWave));
        if (isKnownHunt && !isCity && (!forceTarget || alreadyAtForcedHunt)) {
          needsHuntEntry = false;
        }

        // Heartbeat anti-stall: hunt conhecida sem progresso (kills/waves/gold)
        // por 150s indica teleporte perdido / wave travada — força re-entrada.
        // State-aware: ROOM_STATE/PATCH recente prova sala viva (farm lento ou
        // boss longo gera poucos ROOM_DATA mas PATCH continua). Hunt de boss
        // nunca dispara stall por heurística de kills.
        if (isKnownHunt && !isCity && !telemetry.inTreino && now - lastStallCheck >= 15000) {
          lastStallCheck = now;
          const progressed = telemetry.kills !== lastProgressKills
            || telemetry.waves !== lastProgressWaves
            || telemetry.gold !== lastProgressGold;
          if (progressed) {
            lastProgressKills = telemetry.kills;
            lastProgressWaves = telemetry.waves;
            lastProgressGold = telemetry.gold;
            lastProgressTime = now;
          } else if (now - lastProgressTime >= 150000 && telemetry.online) {
            const roomAliveMs = (telemetry as any).lastRoomStateAt ? now - (telemetry as any).lastRoomStateAt : Infinity;
            const waveLow = String(wave || '').toLowerCase();
            const looksBoss = /boss|chefe|final|últim|ultim/.test(waveLow);
            if (roomAliveMs < 60000) {
              // Sala viva (PATCH < 60s): só rearma, não re-entra.
              lastProgressTime = now;
            } else if (looksBoss) {
              lastProgressTime = now;
              console.log(`[${new Date().toLocaleTimeString()}] ⏱️ [STALL] boss longo sem kills em ${wave} — sala viva, sem re-entrada`);
            } else {
              needsHuntEntry = true;
              lastProgressTime = now;
              console.log(`[${new Date().toLocaleTimeString()}] ⏱️ [STALL] 150s sem progresso em ${wave} (k=${telemetry.kills} w=${telemetry.waves} g=${telemetry.gold}) — forçando re-entrada`);
            }
          }
        } else if (!isKnownHunt || isCity) {
          // Fora de hunt: não conta stall, só rearma a base
          if (now - lastStallCheck >= 15000) {
            lastStallCheck = now;
            lastProgressKills = telemetry.kills;
            lastProgressWaves = telemetry.waves;
            lastProgressGold = telemetry.gold;
            lastProgressTime = now;
          }
        }

        // Fila de Ação: Anti-encher (lootfilter 50% + sell-all no limiar).
        // Política: guarda SOMENTE épico(3)/lendário(4)/mítico(5). Todo o resto é lixo vendável.
        if (config.autoSell && telemetry.bagSlots) {
          const m = telemetry.bagSlots.match(/(\d+)\s*\/\s*(\d+)/);
          if (m) {
            const cur = parseInt(m[1], 10);
            const max = parseInt(m[2], 10);
            const pct = max > 0 ? (cur / max) * 100 : 0;
            // 1) Varredura precoce: vende lixo individual (mantém épico+) a partir de 50%
            if (max > 0 && pct >= 50 && (now - lastSellTime) >= 60000) {
              actionQueue.enqueue({
                id: "lootfilter",
                name: "lootfilter",
                priority: 6,
                timeoutMs: 25000,
                run: async () => {
                  try {
                    // Garante épicos na backpack antes de qualquer venda em massa
                    const mv = await safeEval<any>(pageRef, "extra", { job: "market" }, 8000).catch(() => null);
                    const lf = await safeEval<any>(pageRef, "extra", { job: "lootfilter" }, 20000).catch(() => null);
                    if (lf?.sold > 0 || (mv as any)?.action) {
                      console.log(`[${new Date().toLocaleTimeString()}] 🗑️ [LOOTFILTER] vendeu=${lf?.sold ?? 0} manteve=${lf?.kept ?? 0} pouch=${telemetry.bagSlots} ${JSON.stringify((lf?.events || []).slice(0, 3))}`);
                      lastSellTime = Date.now();
                    }
                  } finally {
                    await closeStuckModals();
                  }
                }
              });
            }
            // 2) Sell-all de emergência no limiar configurado (após proteger épicos)
            if (max > 0 && pct >= config.sellThresholdPct && sellAllowed) {
              actionQueue.enqueue({
                id: "autosell",
                name: "autosell",
                priority: 5,
                timeoutMs: 20000,
                run: async () => {
                  try {
                    await safeEval<any>(pageRef, "extra", { job: "market" }, 8000).catch(() => null);
                    await pageRef.evaluate(() => {
                      const sellBtn = document.getElementById("sell-all") as HTMLButtonElement | null;
                      if (sellBtn && !sellBtn.classList.contains("cd") && !sellBtn.disabled) {
                        sellBtn.click();
                      }
                    }).catch(() => null);
                    lastSellTime = Date.now();
                    console.log(`[${new Date().toLocaleTimeString()}] 💰 [AUTO-SELL] Disparado sell-all (Pouch: ${telemetry.bagSlots}, só épico+ protegido)`);
                  } finally {
                    await closeStuckModals();
                  }
                }
              });
            }
          }
        }

        // Fila de Ação: Magias / Spells (Prioridade 3)
        const pickerKind = hud.pickerKind;
        const pickerOpenEv = (domState.events || []).some((e: string) => String(e).includes("PICKER_SPELL_ABERTO"));
        const spellArgs = { metaAoe: [...AOE_WORDS], metaStrike: [...STRIKE_WORDS], healWords: [...HEAL_WORDS], manaWords: [...MANA_WORDS] };
        const applyHelperSnap = (res: any) => {
          const snap = res?.helper;
          if (snap && typeof snap === "object" && snap.slot !== undefined && snap.slot !== null) {
            const sid = Number(snap.slot);
            helperBySlot[sid] = { ...(helperBySlot[sid] || {}), ...snap };
          }
        };
        if ((pickerKind === "spell" || pickerKind === "heal" || pickerKind === "mana" || pickerKind === "hp" || pickerOpenEv) && now - lastSpellGear >= 15000) {
          lastSpellGear = now;
          actionQueue.enqueue({
            id: "spell_picker",
            name: "spell",
            priority: 3,
            timeoutMs: 12000,
            run: async () => {
              try {
                const need = pickerKind === "heal" ? "heal" : pickerKind === "mana" ? "mana" : pickerKind === "hp" ? "hp" : "aoe";
                const spellRes = await safeEval<any>(pageRef, "spell", { ...spellArgs, need, job: "pick", slot: lastGearSlot }, 10000);
                applyHelperSnap(spellRes);
                if (spellRes?.events?.length) console.log(`[${new Date().toLocaleTimeString()}] 🔮 [SPELL] ${JSON.stringify(spellRes.events)}`);
              } finally {
                await closeStuckModals();
              }
            }
          });
        } else if ((telemetry as any).helperTriggerState?.run && now - lastSpellGear >= 30000) {
          lastSpellGear = now;
          lastHelperTrigger = now;
          actionQueue.enqueue({
            id: "spell_party",
            name: "spell",
            priority: 3,
            timeoutMs: 15000,
            run: async () => {
              try {
                const slots = magicState.slots || {};
                let present = Object.keys(slots).filter((k) => /^\d+$/.test(k)).map(Number);
                if (!present.length) present = [0, 1];
                for (const sid of present) {
                  if (sid > 2) continue;
                  const last = spellSlotCooldown.get(sid) || 0;
                  if (now - last < 600000) continue;
                  const kit = slots[String(sid)] || {};
                  if (kit.ready) continue;
                  spellSlotCooldown.set(sid, Date.now());
                  const jobNeed = !kit.heal ? "heal" : !kit.mana ? "mana" : "aoe";
                  const job = !kit.heal || !kit.mana ? "helper" : "fill";
                  const spellRes = await safeEval<any>(pageRef, "spell", { ...spellArgs, need: jobNeed, job, slot: sid }, 10000);
                  lastGearSlot = sid;
                  applyHelperSnap(spellRes);
                  const snap = spellRes?.helper;
                  if (snap) spellSlotState.set(sid, JSON.stringify(snap));
                  if (spellRes && (spellRes.ok || spellRes.events)) {
                    console.log(`[${new Date().toLocaleTimeString()}] 🔮 [GEAR slot${sid}] ${JSON.stringify(spellRes.events || spellRes)}`);
                    break;
                  }
                }
              } finally {
                await closeStuckModals();
              }
            }
          });
        }

        // Fila de Ação: Auto-Potion (Prioridade 2)
        if (config.autoHeal && !lastPickerOpen && (now - lastPotionCheck >= 60000 || needPotionCheck)) {
          needPotionCheck = false;
          lastPotionCheck = now;
          actionQueue.enqueue({
            id: "potion",
            name: "potion",
            priority: 2,
            timeoutMs: 12000,
            run: async () => {
              try {
                const potRes = await safeEval<any>(pageRef, "potion", {
                  autoHeal: config.autoHeal,
                  healBelowPct: config.healBelowPct,
                  hpPotionBelowPct: config.hpPotionBelowPct,
                  manaPotionBelowPct: config.manaPotionBelowPct,
                }, 10000);
                if (potRes?.events?.length) {
                  for (const ev of potRes.events) console.log(`[${new Date().toLocaleTimeString()}] 🧪 [POTION/CURA] ${ev}`);
                }
              } finally {
                await closeStuckModals();
              }
            }
          });
        }

        // Fila de Ação: Auto-Equip (Prioridade 1)
        if (config.autoEquip && !telemetry.inTreino && !lastPickerOpen && (now - lastEquipCheck >= 30000)) {
          lastEquipCheck = now;
          actionQueue.enqueue({
            id: "equip",
            name: "equip",
            priority: 1,
            timeoutMs: 15000,
            run: async () => {
              try {
                const eqRes = await safeEval<any>(pageRef, "equip", null, 12000);
                if (eqRes?.events?.length) {
                  for (const ev of eqRes.events) console.log(`[${new Date().toLocaleTimeString()}] 🛡️ [AUTO-EQUIP] ${ev}`);
                }
                const newItems = eqRes?.equipped || [];
                if (newItems.length > 0) {
                  subsystems.auto_equip = {
                    status: "FUNCIONAL",
                    detail: `Último: ${newItems[0].name} (T${newItems[0].tier ?? "?"})`,
                    last_equipped: newItems.slice(0, 10),
                  };
                }
              } finally {
                await closeStuckModals();
              }
            }
          });
        }

        // Fila de Ação: Extras (Prioridade 1)
        if (now - lastTreinoCheck >= 20000) {
          lastTreinoCheck = now;
          actionQueue.enqueue({
            id: "extras",
            name: "extras",
            priority: 1,
            timeoutMs: 12000,
            run: async () => {
              try {
                const extraLogs = await extrasScheduler.tick(pageRef, config, Date.now(), telemetry.inTreino);
                for (const log of extraLogs) console.log(`[${new Date().toLocaleTimeString()}] ⚡ ${log}`);
              } finally {
                await closeStuckModals();
              }
            }
          });
        }
      }

      // Sincronização de Telemetria e status.json (Ciclo rápido 1.5s)
      if (now - lastStatusWrite >= 1500) {
        lastStatusWrite = now;
        writeStatusFile();
      }

      // Relatório Periódico no Console (45s)
      if (Date.now() - lastPrint > 45000) {
        lastPrint = Date.now();
        const elapsed = (Date.now() - t0Loop) / 1000;
        const wavesH = elapsed > 0 ? Math.round((telemetry.waves / elapsed) * 3600 * 10) / 10 : 0;
        const killsH = elapsed > 0 ? Math.round((telemetry.kills / elapsed) * 3600 * 10) / 10 : 0;
        const curB = (((profiler as any).benchmarks || {})[(profiler as any).activeHuntId] || {}) as any;
        const curGoldH = Number(curB.gold_per_hour || 0);
        const s0 = (magicState.slots || {})["0"] || {};
        const s1 = (magicState.slots || {})["1"] || {};
        const dec = (profiler as any).lastDecision || {};
        console.log(
          `[${new Date().toLocaleTimeString()}] 📊 [METRICAS REAIS] Waves: ${telemetry.waves} (${wavesH}/h) | Kills: ${telemetry.kills} (${killsH}/h)` +
          (curGoldH ? ` | Gold/h: ${curGoldH.toLocaleString()}` : "") +
          (telemetry.level ? ` | Lvl: ${telemetry.level}` : "") +
          (telemetry.gold ? ` | Gold: ${Number(telemetry.gold).toLocaleString()}` : "") +
          (telemetry.hunt ? ` | Hunt: ${telemetry.hunt}` : "") +
          (telemetry.inTreino ? " | Treino: ON" : "") +
          ` | Champions: ${telemetry.partySlots} | Loop: ${telemetry.loopMode ? "ON" : "OFF"}` +
          (telemetry.bagSlots ? ` | Pouch: ${telemetry.bagSlots}` : "") +
          ` | Magia: p${magicState.power ?? 0} aoe=${magicState.aoe ?? 0} s0 h${s0.heal ?? 0}/m${s0.mana ?? 0} s1 h${s1.heal ?? 0}/m${s1.mana ?? 0} party=${magicState.party_ready}` +
          ` | Dec: ${dec.mode || "-"} ${(dec.reason || "").slice(0, 80)} | Online: ${Math.floor(elapsed / 60)}m`
        );
        const subLine = Object.entries(subsystems).map(([k, v]) => `${k}: ${(v as any).status}`).join(" | ");
        console.log(`[${new Date().toLocaleTimeString()}] 🛡️ [SUBSISTEMAS] ${subLine}`);
        const topP = huntMatrix.getRankings().by_profit || [];
        if (topP.length > 0) {
          const best = topP[0];
          console.log(`[${new Date().toLocaleTimeString()}] 🧠 [APRENDIZADO ANALYZER] Top Lucro: ${best.name} (${Number(best.avg_gold_h || 0).toLocaleString()} g/h | ${best.safety_rating}) | Hunts catalogadas: ${Object.keys((huntMatrix as any).matrix || {}).length}`);
        }
      }

    } catch (err: any) {
      if (err?.message && !err.message.includes("Execution context")) {
        console.log(`[${new Date().toLocaleTimeString()}] ⚠️ [LOOP ERRO] ${err.message}`);
      }
    }

    // Ciclo de telemetria leve a cada 1.5s
    await new Promise(r => setTimeout(r, 1500));
  }
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
