import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { parseConfig, describeFlags } from "./config";
import { launchBrowser } from "./browser";
import { Watchdog } from "./watchdog";
import { Profiler } from "./profiler";
import { HuntMatrix, HUNTS_TABLE, classifyMagic, matchHunt, idsFromPickerRows, inferLevel, AOE_WORDS, STRIKE_WORDS, HEAL_WORDS, MANA_WORDS, getOptimalSpellRotation, HUNT_ELEMENT_PROFILES } from "./hunts";
import { startServer } from "./server";
import { decodeFrame } from "./protocol";
import { safeEval } from "./scripts";
import { DefaultExtrasScheduler, looksLikeTreino } from "./extras";
import { TelemetryStore, parseHuntStage } from "./telemetry";
import { ProtocolMapper } from "./protocol_mapper";
import { chooseExplorationTarget } from "./exploration";
import { helperTrigger } from "./helper_triggers";
import { ActionQueue, evaluateStaminaTransition } from "./state_machine";
import { createTrpcClient, normalizeChars } from "./trpc";
import { roomSend, roomSendDetail, roomDrainEvents, sendStage, sendAutosellFull, sendAutosellPct, sendAutoBoss } from "./room_send";
import { getJevEngine } from "./jev";
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
  const normStam = (s, allowFull = false) => {
    const t = String(s || "").trim();
    if (!t) return null;
    if (allowFull && /(?:^|\\D)(?:42\\s*:\\s*00(?:\\s*:\\s*00)?|2520(?:\\s*min)?|100\\s*%)(?=\\D|$)/i.test(t)) return "100%";
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
  // A conta pode retomar em Treino Online após uma sessão anterior. O
  // overlay de treino é a fonte autoritativa; o seletor bs-hunt da camada oculta
  // de economia pode conservar a última hunt e não deve mascarar esse estado.
  const trainingOverlay = document.getElementById("training-overlay");
  const inTraining = !!(trainingOverlay && !trainingOverlay.classList.contains("hidden"));
  const visible = (el) => {
    if (!el || el.classList?.contains("hidden")) return false;
    try {
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
    } catch (_) { return true; }
  };

  // Hunt / Wave
  let wave = inTraining ? "Treino Online" :
             text(Array.from(document.querySelectorAll(".bs-hunt")).find(visible)) ||
             text(Array.from(document.querySelectorAll("#wave-title, .stage-name, .stage-name-line")).find(visible));
  if (!wave || wave === "—" || wave === "-") {
    const tm = (document.title || "").match(/·\\s*(.*?)\\s*—/);
    if (tm && tm[1]) wave = tm[1].trim();
  }
  const trainingView = inTraining || /treino|online training|exercise|dummy/i.test(String(wave || ""));

  // Party e Nível — seletores tolerantes a rename de build + espelhos do kernel
  let shooters = Array.from(document.querySelectorAll("#bar-shooters .bar-member")).map((el, slot) => ({
    slot,
    text: text(el),
    classes: el.className || "",
  }));
  if (shooters.length === 0) {
    const alt = document.querySelectorAll(".bs-party-name, .party-member, .pm-pc-meta, .pm-char-meta, [class*='bar-member'], [class*='party'][class*='member']");
    if (alt.length > 0 && alt.length <= 12) {
      shooters = Array.from(alt).slice(0, 12).map((el, slot) => ({ slot, text: text(el), classes: el.className || "" }));
    }
  }
  if (shooters.length === 0) {
    try {
      const w = window;
      const mirror = w.__baiak_state?.players || w.__baiak_state?.party || w.__baiak_telemetry?.partyMembers || w.__baiak_engine?.party || [];
      if (Array.isArray(mirror) && mirror.length > 0) {
        shooters = mirror.slice(0, 12).map((p, slot) => ({
          slot: (p && p.slot) ?? slot,
          text: [p?.name, p?.vocation || p?.voc, p?.level ? ("lvl " + p.level) : ""].filter(Boolean).join(" "),
          classes: "mirror",
          name: p?.name || undefined,
          level: p?.level || undefined,
          vocation: p?.vocation || p?.voc || undefined,
        }));
      } else if (w.__baiak_state?.bsParty && Array.isArray(w.__baiak_state.bsParty) && w.__baiak_state.bsParty.length > 0) {
        shooters = w.__baiak_state.bsParty.slice(0, 12).map((t, slot) => ({ slot, text: String(t || ""), classes: "mirror-bs" }));
      }
    } catch (_) {}
  }
  const vocLvlRe = /(?:paladin|knight|monk|sorcerer|druid)\\s*[·•\\-–]\\s*(?:lvl|m|level|n[ií]vel)?\\s*(\\d+)/i;
  const partyLvls = [];
  for (const s of shooters) {
    const m = s.text.match(vocLvlRe);
    if (m) {
      const lvl = parseInt(m[1], 10);
      if (lvl > 0 && lvl <= 5000) partyLvls.push(lvl);
    } else if (s.level && s.level > 0 && s.level <= 800) {
      partyLvls.push(s.level);
    }
  }
  let level = partyLvls.length > 0 ? Math.max(...partyLvls) : 0;
  if (!level) {
    const lvlEl = document.querySelector(".hd-lvl, .hud-lvl, .cyc-char-lvl, .bar-char-lvl, .player-level, #player-level, [data-player-level], .pm-lvl, .char-lvl");
    if (lvlEl) {
      const m = (lvlEl.textContent || "").match(/\\d+/);
      if (m) level = parseInt(m[0], 10);
    }
  }
  if (!level) {
    try {
      const w = window;
      const ml = w.__baiak_telemetry?.level || w.__baiak_engine?.state?.level || w.__baiak_state?.level;
      if (typeof ml === "number" && ml > 0 && ml <= 800) level = Math.floor(ml);
    } catch (_) {}
  }

  // Gold — robusto a k/kk/m, pt-BR e data-gold; null quando ilegível (nunca 0 fantasma)
  // Ordem: IDs conhecidos -> espelhos kernel -> varredura genérica gold/wallet/coin.
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
  if (gold == null) {
    try {
      const w = window;
      const mg = w.__baiak_telemetry?.gold ?? w.__baiak_engine?.state?.gold ?? w.__baiak_state?.gold;
      if (typeof mg === "number" && Number.isFinite(mg) && mg >= 0) gold = Math.floor(mg);
    } catch (_) {}
  }
  if (gold == null) {
    const generic = document.querySelectorAll("[class*='gold' i], [id*='gold' i], [class*='wallet' i], [id*='wallet' i], [class*='coin' i], [class*='money' i]");
    for (const gEl of Array.from(generic).slice(0, 20)) {
      if (gEl.closest && gEl.closest("#picker-modal, #confirm-modal, .modal")) continue;
      const t = text(gEl).slice(0, 40);
      if (!t || t.length > 30) continue;
      const cand = parseGold(t);
      if (cand != null && cand >= 0) { gold = cand; break; }
    }
  }

  // Coins (Saldo de Moedas Loja / Mercado)
  let coins = null;
  const coinDirect = document.querySelector("#hud-coins, .coin.coins b, .coin.coins, [data-i18n-title*='Coins' i] b");
  if (coinDirect) {
    const parsed = parseInt((coinDirect.textContent || "").replace(/\\D/g, ""), 10);
    if (!isNaN(parsed) && parsed >= 0) coins = parsed;
  }
  if (coins == null) {
    try {
      const w = window;
      const b = w.__baiak_balances || w.ie?.balances || w.__coin_balances;
      if (b && typeof b.coins === "number") coins = Math.floor(b.coins);
    } catch (_) {}
  }

  // Stamina — relógio, Xh Ym, % e tooltip; placeholder 42:00 = desconhecido
  // Ordem: IDs conhecidos -> espelhos kernel -> varredura genérica stamina.
  let stamina = normStam(text(document.getElementById("stamina-time") || document.querySelector(".stamina-time, .stamina-val, #stamina-val, [data-stamina], .hud-stamina, #stamina-panel, .stamina-panel")), trainingView);
  if (!stamina) {
    const panel = document.getElementById("stamina-panel");
    stamina = normStam(panel?.textContent || "", trainingView) || normStam(panel?.getAttribute("title") || "", trainingView);
  }
  if (!stamina) {
    try {
      const w = window;
      const ms = w.__baiak_telemetry?.stamina || w.__baiak_engine?.state?.stamina || w.__baiak_state?.stamina;
      stamina = normStam(ms || "", trainingView);
    } catch (_) {}
  }
  if (!stamina) {
    const genericS = document.querySelectorAll("[class*='stamina' i], [id*='stamina' i]");
    for (const sEl of Array.from(genericS).slice(0, 10)) {
      const cand = normStam(text(sEl), trainingView) || normStam(sEl.getAttribute && (sEl.getAttribute("title") || sEl.getAttribute("data-tip") || ""), trainingView);
      if (cand) { stamina = cand; break; }
    }
  }
  let staminaPct = normStam(text(document.getElementById("stamina-pct") || document.querySelector(".stamina-pct")), trainingView);
  if (!staminaPct) {
    const bTip = document.querySelector("button[title*='stamina' i], [data-tip*='stamina' i], [aria-label*='stamina' i]");
    if (bTip) {
      const tip = bTip.getAttribute("title") || bTip.getAttribute("data-tip") || bTip.getAttribute("aria-label") || bTip.textContent || "";
      const cand = normStam(tip, trainingView);
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

  // Rotação de magias e analisadores são dados leves e estáveis; lê-los no
  // mesmo Runtime.evaluate do estado rápido evita depender de uma segunda
  // avaliação Puppeteer quando o renderer está ocupado com o canvas.
  const spells = Array.from(document.querySelectorAll('[id^="rot-"]')).map((el) => ({
    slot: parseInt((el.id.match(/^rot-(\\d+)-/) || ["", "0"])[1], 10) || 0,
    u: parseInt((el.id.match(/^rot-\\d+-(\\d+)/) || ["", "0"])[1], 10) || 0,
    empty: !!el.querySelector('small') || /escolher magia|choose spell|slot \\d+ \\+/i.test(el.getAttribute('title') || ''),
    name: String(el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent || '').trim(),
  }));
  const helpers = [];
  const helper = document.getElementById('helper-modal');
  if (helper && !helper.classList.contains('hidden')) {
    const btns = Array.from(helper.querySelectorAll('.helper-healgrid .helper-spellbtn, .helper-spellbtn'));
    const val = (el) => String(el?.textContent || '').replace(/\\s+/g, ' ').trim();
    helpers.push({
      slot: Array.from(document.querySelectorAll('#bar-shooters .bar-member')).findIndex((el) => el.classList.contains('bar-member-active')),
      heal: val(btns[0]), hpPotion: val(btns[1]), manaPotion: val(btns[2]),
      autoHeal: /exura|cura|healing|mend|cleansing|san|ico/i.test(val(btns[0])),
      healEnabled: !Array.from(helper.querySelectorAll('input[type="checkbox"]')).some((c) => /magia/i.test(c.parentElement?.textContent || '') && !c.checked),
    });
  }
  const analyzers = {};
  const xpEl = document.getElementById('an-xph');
  const lootEl = document.getElementById('an-loot');
  const killsEl = document.getElementById('an-kills');
  const rawXpEl = document.getElementById('an-raw');
  if (xpEl) analyzers.xp_per_hour = text(xpEl);
  if (lootEl) analyzers.loot_value = text(lootEl);
  if (killsEl) analyzers.hunt_kills = parseGold(text(killsEl));
  if (rawXpEl) analyzers.session_xp = parseGold(text(rawXpEl));
  const stats = document.querySelector('.bs-stats');
  if (stats) for (const item of stats.querySelectorAll('.bs-stat')) {
    const label = text(item.querySelector('.bs-stat-lb')).toLowerCase();
    const value = text(item.querySelector('.bs-stat-v'));
    if (/xp\\s*\\/\\s*h/.test(label)) analyzers.xp_per_hour = value;
    if (/loot\\s*\\/\\s*h/.test(label)) analyzers.loot_per_hour = value;
  }
  const picker = document.getElementById('picker-modal');
  const pickerOpen = !!(picker && !picker.classList.contains('hidden'));
  const pickerTitle = pickerOpen ? text(picker.querySelector('.im-title')) : '';
  const pickerKind = /cura pr[oó]pria|heal/i.test(pickerTitle) ? 'heal'
    : /potion de mana|p[oó]ção mp/i.test(pickerTitle) ? 'mana'
    : /potion de vida|p[oó]ção hp/i.test(pickerTitle) ? 'hp'
    : /rota|magia|spell/i.test(pickerTitle) ? 'spell' : null;
  try {
    const dbg = window.__baiak_fast_debug || (window.__baiak_fast_debug = {});
    const sig = String(spells.length) + '|' + Object.keys(analyzers).sort().join(',');
    if (dbg.sig !== sig) { events.push('FAST_HUD=' + sig); dbg.sig = sig; }
  } catch (_) {}

  return {
    loading: false,
    wave,
    level,
    partySlotsCount: shooters.length || 3,
    party: shooters,
    gold,
    coins,
    stamina,
    loopOn,
    invText,
    connExpired,
    inBatterySaver,
    inTraining,
    events,
    spells,
    helpers,
    analyzers,
    pickerOpen,
    pickerTitle,
    pickerKind,
  };
}`;

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
  // A escolha feita pelo painel sobrevive ao restart e tem precedência sobre
  // um FORCE_HUNT antigo deixado no ambiente da VPS.
  let persistedManualHuntId: string | null = null;
  try {
    const saved = JSON.parse(readFileSync(join(dataDir, 'manual_hunt.json'), 'utf-8'));
    if (saved?.hunt_id && matchHunt(String(saved.hunt_id))) persistedManualHuntId = String(saved.hunt_id);
  } catch (_) {}

  const watchdog = new Watchdog();
  const profiler = new Profiler(dataDir);
  profiler.clearDeathPenalties();
  const huntMatrix = new HuntMatrix(dataDir);
  let magicState: Record<string, any> = classifyMagic([]);
  let lastSpellList: any[] = [];
  // Leituras DOM da rotação são frequentes e `classifyMagic` devolve apenas
  // os slots. Preserve as observações de combate/resistência anexadas pelo
  // engine; sem este merge elas desapareciam do status a cada tick do HUD.
  const classifyMagicPreservingFacts = (spells: any[], helpers: any[]): Record<string, any> => {
    if (Array.isArray(spells) && spells.length > 0) lastSpellList = spells;
    const previous = magicState || {};
    const next = classifyMagic(spells, helpers);
    return {
      ...next,
      ...(previous.damageProfile ? { damageProfile: previous.damageProfile } : {}),
      ...(previous.observed_element ? { observed_element: previous.observed_element } : {}),
      ...(previous.element_source ? { element_source: previous.element_source } : {}),
      ...(previous.recommended_element ? { recommended_element: previous.recommended_element } : {}),
    };
  };
  let helperBySlot: Record<number, any> = {};
  let latestAnalyzers: Record<string, any> = {};
  let lastGearSlot: number | null = null;
  let cachedAccountChars: Record<string, any> = {};
  let cachedAccountCharsList: any[] = [];
  let cachedPartyConfig: any = null;
  let lastAccountCharsSync = 0;
  let lastAccountCharsAttempt = 0;
  // Última hunt confirmada pelo servidor (joined/toHunt/resume). Não use o
  // retorno de WebSocket.send como confirmação: ele só prova que o pacote
  // entrou no socket e pode ser seguido por um `joined` antigo.
  let authoritativeHuntId: string | null = null;
  const ACCOUNT_SYNC_MS = 60_000;
  let lastAutoSellConfig = 0;

  const syncAccountChars = async (): Promise<Record<string, any>> => {
    const now = Date.now();
    if (Object.keys(cachedAccountChars).length > 0 && now - lastAccountCharsSync < ACCOUNT_SYNC_MS) return cachedAccountChars;
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
        cachedAccountCharsList = chars;
        const mapping: Record<string, any> = {};
        for (const c of chars) {
          const v = String(c?.vocation || "").toLowerCase();
          const info = {
            id: c?.id,
            name: c?.name,
            vocation: v,
            level: c?.level || 1,
            gold: c?.gold,
            stamina: c?.stamina,
          };
          if (v) mapping[v] = info;
          if (c?.name) mapping[String(c.name).toLowerCase()] = info;
          if (c?.id) mapping[String(c.id)] = info;
        }
        cachedAccountChars = mapping;
        lastAccountCharsSync = now;
        console.log(`[*] [TRPC] characters.list OK (${chars.length} chars)`);
      } else {
        console.warn(`[TRPC AVISO] characters.list vazio — mantendo cache (${Object.keys(cachedAccountChars).length})`);
      }
      // Party real quando disponível (slots/HP/MP autoritativos no status).
      try {
        const partyCfg: any = await trpc.query('characters.partyConfig').catch(() => null);
        if (partyCfg) cachedPartyConfig = partyCfg;
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
    jev_decision_engine: {
      status: config.jevEnabled ? "FUNCIONAL" : "AGUARDANDO",
      detail: config.jevEnabled ? (config.jevApiKey ? "JEV System One (API Conectada)" : "JEV System One (Fallback Determinístico Local)") : "Desativado",
    },
  };

  const jev = getJevEngine();
  let jevRecommendation: any = null;
  let lastJevRecommendationTs = 0;
  let lastJevBuildTs = 0;

  const telemetry = new TelemetryStore();
  const protocolMapper = new ProtocolMapper(dataDir);
  const actionQueue = new ActionQueue();
  // Alvo manual autoritativo. O valor do ambiente vale apenas como alvo
  // inicial; uma escolha do painel invalida ações antigas da fila.
  let manualHuntId: string | null = persistedManualHuntId
    || (config.forceHunt && config.huntId ? config.huntId : null);
  if (manualHuntId) {
    config.forceHunt = true;
    config.huntId = manualHuntId;
  }
  let huntSelectionRevision = 0;
  (telemetry as any).partyMembersRaw = [];

  // Métricas da execução atual. O analyzer visual do jogo pode reiniciar a
  // própria janela ao trocar de hunt; por isso o total de XP do bot é
  // acumulado aqui, desde o primeiro frame desta execução, e não copiado
  // diretamente do valor atual do HUD.
  let hudXpLast: number | null = null;
  let hudXpAccumulated = 0;
  let sessionStartLevel: number | null = null;

  const parseMetricValue = (value: any): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!raw) return 0;
    const match = raw.match(/(-?[\d.,]+)\s*(kk|milh(?:ões|oes|ao)?|mi\b|m\b|mil\b|k\b)?/i);
    if (!match) return 0;
    const numberText = match[1];
    const unit = String(match[2] || '').toLowerCase();
    const dots = (numberText.match(/\./g) || []).length;
    const commas = (numberText.match(/,/g) || []).length;
    let n = 0;
    if (dots > 1 && commas === 0) n = Number(numberText.replace(/\./g, ''));
    else if (dots === 1 && commas === 1) n = Number(numberText.replace(/\./g, '').replace(',', '.'));
    else if (commas === 1) n = Number(numberText.replace(',', '.'));
    else if (dots === 1) n = unit ? Number(numberText) : Number(numberText.replace('.', ''));
    else n = Number(numberText);
    if (!Number.isFinite(n)) return 0;
    if (unit === 'kk' || unit === 'm' || unit === 'mi' || unit.startsWith('milh')) n *= 1_000_000;
    else if (unit === 'k' || unit === 'mil') n *= 1_000;
    return n;
  };

  const observeHudSessionXp = (value: any): void => {
    const current = parseMetricValue(value);
    if (current <= 0) return;
    if (hudXpLast === null) {
      hudXpLast = current;
      return;
    }
    if (current >= hudXpLast) hudXpAccumulated += current - hudXpLast;
    else hudXpAccumulated += current; // o Hunt Analyzer reiniciou a janela
    hudXpLast = current;
  };

  const runtimeMetrics = () => {
    const elapsedSeconds = Math.max(1, telemetry.elapsedSeconds());
    if (sessionStartLevel === null && telemetry.level > 0) sessionStartLevel = telemetry.level;

    const activeText = telemetry.hunt && telemetry.hunt !== 'Conectando...' && telemetry.hunt !== '—'
      ? telemetry.hunt : '';
    const activeMatch = matchHunt(activeText);
    const selectedHuntId = activeMatch?.id
      || manualHuntId
      || authoritativeHuntId
      || (profiler as any).activeHuntId
      || null;
    const selectedHunt = selectedHuntId
      ? HUNTS_TABLE.find((h: any) => h.id === selectedHuntId) || null
      : activeMatch;
    const mapSnapshot = protocolMapper.snapshot();
    const selectedScore: any = selectedHuntId ? (mapSnapshot.scores as any)?.[selectedHuntId] || {} : {};
    const selectedMatrix: any = selectedHuntId ? ((huntMatrix as any).matrix?.[selectedHuntId] || {}) : {};
    const analyzerBelongsToSelected = !!selectedHuntId && activeMatch?.id === selectedHuntId;
    const analyzer = analyzerBelongsToSelected ? latestAnalyzers : {};
    const scoreSampleReady = selectedScore.sampleReady === true;
    const profilerActive = !!selectedHuntId && String((profiler as any).activeHuntId || '') === selectedHuntId;
    const profilerElapsed = profilerActive && typeof (profiler as any).measureElapsed === 'function'
      ? Math.max(0, Number((profiler as any).measureElapsed()) || 0) : 0;
    let profilerSampleReady = false;
    try {
      profilerSampleReady = profilerActive && typeof (profiler as any).visitReady === 'function'
        ? Boolean((profiler as any).visitReady()) : false;
    } catch (_) {}
    const profilerHasGold = profilerActive
      && (profiler as any).huntStartGold !== null && (profiler as any).huntStartGold !== undefined
      && (profiler as any).lastGold !== null && (profiler as any).lastGold !== undefined;
    const profilerGoldReady = profilerSampleReady && profilerHasGold;
    // Enquanto a janela atual não está pronta, nunca consuma a taxa salva no
    // mapper/matriz: ela pode ser de uma execução anterior do mesmo VPS.
    const currentScore = scoreSampleReady ? selectedScore : {};
    const currentAnalyzer = scoreSampleReady && analyzerBelongsToSelected ? analyzer : {};
    const currentHuntIsActive = analyzerBelongsToSelected || profilerActive;
    // A janela ao vivo precisa amadurecer antes de ser publicada, mas não
    // devemos mostrar XP/h = 0 enquanto o personagem está claramente matando.
    // Quando há uma matriz observada robusta (>=30 amostras, sem mortes), ela
    // funciona como taxa provisória até a primeira amostra desta execução.
    const matrixObserved = Number(selectedMatrix?.samples || 0) >= 30
      && Number(selectedMatrix?.deaths || 0) <= 0;
    const historicalMatrix = currentHuntIsActive
      ? (matrixObserved ? selectedMatrix : {})
      : selectedMatrix;
    const firstPositive = (...values: any[]): number => {
      for (const value of values) {
        const n = parseMetricValue(value);
        if (n > 0) return n;
      }
      return 0;
    };
    const xpPerHour = firstPositive(
      currentAnalyzer.xp_per_hour,
      currentScore.xpPerHour,
      historicalMatrix.xp_h_display,
      historicalMatrix.avg_xp_h,
    );
    const lootPerHour = firstPositive(
      currentAnalyzer.loot_per_hour,
      currentScore.lootGoldPerHour,
      historicalMatrix.loot_h_display,
      historicalMatrix.avg_loot_h,
    );
    // Gold/h é a variação real do saldo da conta. Loot/h continua separado;
    // nunca transforme loot bruto em gold/h só porque faltou o saldo. Se o
    // saldo não estiver disponível, o painel aguarda a próxima amostra.
    const goldPerHour = profilerGoldReady
      ? Math.max(0, Number((profiler as any).sessGoldH) || 0) : 0;
    const goldSampleReady = profilerGoldReady;
    const sessionKillsPerHour = Math.round((telemetry.kills / elapsedSeconds) * 3600 * 10) / 10;
    const sessionWavesPerHour = Math.round((telemetry.waves / elapsedSeconds) * 3600 * 10) / 10;
    const levelPerHour = sessionStartLevel !== null
      ? Math.max(0, Math.round(((telemetry.level - sessionStartLevel) / elapsedSeconds) * 3600 * 10) / 10)
      : 0;
    const mappedSessionXp = typeof (protocolMapper as any).sessionXp === 'function'
      ? Number((protocolMapper as any).sessionXp()) || 0 : 0;
    const sessionXp = Math.floor(Math.max(mappedSessionXp, hudXpAccumulated));
    return {
      elapsedSeconds,
      selectedHuntId,
      selectedHuntName: selectedHunt?.name || activeText || selectedHuntId || null,
      selectedHuntMetrics: {
        xp_per_hour: xpPerHour,
        loot_per_hour: lootPerHour,
        gold_per_hour: goldPerHour,
        sample_ready: scoreSampleReady,
        gold_sample_ready: goldSampleReady,
        source: profilerGoldReady
          ? 'profiler-live'
          : (scoreSampleReady && analyzerBelongsToSelected && parseMetricValue(currentAnalyzer.xp_per_hour) > 0
            ? 'hunt-analyzer' : (scoreSampleReady ? 'selected-hunt-live'
              : (matrixObserved ? 'matrix-observed' : 'selected-hunt-measuring'))),
        window_seconds: Math.max(Number(selectedScore.sampleSeconds || 0) || 0, profilerElapsed),
        historical_gold_per_hour: Number((selectedHuntId ? ((profiler as any).benchmarks || {})[selectedHuntId] : {})?.gold_per_hour || 0) || 0,
      },
      sessionKillsPerHour,
      sessionWavesPerHour,
      levelPerHour,
      sessionXp,
    };
  };

  // Fecha picker/modal preso. Toda ação DOM roda dentro de try/finally com
  // este fechamento: sem ele um timeout de 12-15s deixa o picker aberto e a
  // próxima ação falha em cascata.
  const closeStuckModals = async (): Promise<void> => {
    try {
      const closeCall = pageRef?.evaluate(() => {
        try {
          const picker = document.getElementById("picker-modal");
          if (picker && !picker.classList.contains("hidden")) {
            const c = picker.querySelector("#picker-modal-close, .im-close, .close-btn, .modal-close, [data-close]");
            if (c) (c as HTMLElement).click();
            else picker.classList.add("hidden");
          }
          // A configuração de cura/poção abre o Helper. Se o renderer ou
          // uma ação de seleção expirar, a janela fica sobre a arena e a
          // sala continua conectada, mas nenhuma wave avança. Fechar aqui é
          // seguro: a próxima rodada reabre o Helper apenas se ainda faltar
          // algum slot para configurar.
          const helper = document.getElementById("helper-modal");
          if (helper && !helper.classList.contains("hidden")) {
            const c = helper.querySelector("#helper-modal-close, .im-close, .close-btn, .modal-close, [data-close]");
            if (c) (c as HTMLElement).click();
            else helper.classList.add("hidden");
          }
          const confirm = document.getElementById("confirm-modal");
          if (confirm && !confirm.classList.contains("hidden") && !/comprar|buy|lance|bid|leil|loja|store|pix|vip|premium|donate/i.test(confirm.textContent || "")) {
            const yes = Array.from(confirm.querySelectorAll("button, .btn")).find((b) =>
              /^(ok|yes|sim|confirmar|confirm)$/i.test((b.textContent || "").trim()));
            if (yes) (yes as HTMLElement).click();
          }
        } catch (_) {}
      }).catch(() => null);
      // Se o renderer estiver ocupado, não deixe o finally de uma ação
      // prender a fila (nem a sonda de magias) indefinidamente.
      await Promise.race([
        closeCall,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (_) {}
  };

  // Pre-Teleport Guard: Silencia tarefas pesadas de CDP por 5 segundos
  // durante a migração de sala do Colyseus, garantindo 100% de CPU na VPS
  // para o handshake e eliminando seat reservation expired / 1006.
  let preTeleportSilencedUntil = 0;

  // Entrada em hunt: DIRETO primeiro (1 pacote `stage`), DOM só como fallback.
  // `lMe=N=>l.send("stage",{huntId:N})` é o que o botão `.stage-go` chama.
  let directStageMissTarget = '';
  let directStageMisses = 0;
  const enterHuntDirectOrDom = async (target: { id?: string; name?: string; resumeLast?: boolean }): Promise<any> => {
    preTeleportSilencedUntil = Date.now() + 5000;
    const targetId = String(target?.id || '').toLowerCase();
    const normalizeHuntId = (value: string): string => String(value || '')
      .toLowerCase()
      .replace(/-lair|-cave|-dungeon|-camp|-ground/g, '');
    const isTargetVisible = (): boolean => {
      if (!targetId) return false;
      const normTarget = normalizeHuntId(targetId);
      const normAuth = normalizeHuntId(authoritativeHuntId || '');
      if (authoritativeHuntId === targetId || (normAuth && normTarget && normAuth === normTarget)) return true;
      // Não use uma atualização otimista feita depois do envio como confirmação
      // do servidor. O HUD só é uma confirmação válida quando ele próprio já
      // refletiu o alvo; frames websocket precisam passar por authoritativeHuntId.
      const huntSource = telemetry.getSources().hunt;
      if (huntSource !== 'dom' && huntSource !== 'battery-save') return false;
      const live = matchHunt(telemetry.hunt)?.id || telemetry.hunt || '';
      const normLive = normalizeHuntId(live);
      return matchHunt(telemetry.hunt)?.id === targetId || Boolean(normLive && normTarget && normLive === normTarget);
    };
    const waitForTarget = async (timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (isTargetVisible()) return true;
        await new Promise(r => setTimeout(r, 250));
      }
      return isTargetVisible();
    };
    if (target?.id) {
      try {
        preTeleportSilencedUntil = Date.now() + 6000;
        const ok = await sendStage(pageRef, target.id);
        if (ok) {
          console.log(`[${new Date().toLocaleTimeString()}] 🏹 [STAGE-DIRECT] send("stage",{huntId:${target.id}}) aceito (1 pacote)`);
          // Um segundo clique enquanto a reserva ainda está pendente causa
          // `seat reservation expired`/1006. Aguarde a confirmação do socket
          // ou do HUD e, se ela não vier, deixe a próxima tentativa repetir o
          // pacote direto sem abrir um segundo seletor sobre a mesma reserva.
          if (await waitForTarget(8000)) {
            directStageMissTarget = '';
            directStageMisses = 0;
            return { success: true, hunt: target.id, method: "room-send" };
          }
          if (directStageMissTarget !== targetId) {
            directStageMissTarget = targetId;
            directStageMisses = 0;
          }
          directStageMisses += 1;
          // A primeira ausência de confirmação é comum quando a sala está
          // trocando o socket. Só na segunda tentativa, já após o cooldown da
          // fila, usamos o fluxo visual oficial; isso evita duas reservas
          // simultâneas sem bloquear a rotação para sempre.
          if (directStageMisses < 2) {
            console.warn(`[${new Date().toLocaleTimeString()}] [STAGE-DIRECT] sem confirmação de ${target.id}; aguardando próxima tentativa antes do DOM`);
            return { success: false, reason: "stage-unconfirmed", method: "room-send", hunt: target.id };
          }
          console.warn(`[${new Date().toLocaleTimeString()}] [STAGE-DIRECT] segunda falha para ${target.id}; usando fallback DOM após cooldown`);
        }
      } catch (_) {}
    }
    try {
      const result = await safeEval<any>(pageRef, "hunt", target, 12000);
      if (result?.success || result?.alreadyThere) {
        // O script DOM pode clicar no botão e expirar antes de o servidor
        // publicar o novo estado. Não reporte sucesso nem atualize o painel
        // como se estivesse na hunt errada; confirme o alvo por alguns ticks.
        if (await waitForTarget(6000)) {
          directStageMissTarget = '';
          directStageMisses = 0;
          return result;
        }
        return { ...result, success: false, alreadyThere: false, reason: "dom-unconfirmed", requested: target.id };
      }
      return result;
    } finally {
      await closeStuckModals();
    }
  };

  // Status file completo — paridade com bot.py update_status_file()
  // Contrato monitor/server.ts publicStatus(): emite online_uptime_*, session_xp*,
  // elapsed_minutes, last_update_ts, force_hunt_*, party_slots real, analyzers.
  const writeStatusFile = () => {
    try {
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
      const accChars = cachedAccountChars;
      const accList: any[] = cachedAccountCharsList.length > 0 ? cachedAccountCharsList : Object.values(accChars);
      const partyLeaderId = cachedPartyConfig?.leader || (telemetry as any).partyLeaderId;
      // Seleciona o personagem principal: líder configurado ou char ativo de maior nível
      const primaryChar: any = (partyLeaderId ? accList.find((c: any) => c.id === partyLeaderId) : null)
        || [...accList].sort((a: any, b: any) => (Number(b.level) || 0) - (Number(a.level) || 0))[0]
        || (accChars as any).knight
        || Object.values(accChars)[0];

      if (primaryChar) {
        if (Number(primaryChar.level) > 0) telemetry.updateLevel(Number(primaryChar.level), 'trpc');
        // Só aplica gold/stamina por alguns segundos após uma resposta nova;
        // assim o tRPC não congela valores antigos por cima do HUD vivo.
        const trpcFresh = lastAccountCharsSync > 0 && Date.now() - lastAccountCharsSync < 10_000;
        if (trpcFresh && primaryChar.gold !== undefined) telemetry.updateGold(primaryChar.gold, 'trpc');
        if (trpcFresh && primaryChar.stamina !== undefined) telemetry.updateStamina(primaryChar.stamina, 'trpc');
      }
      // Prioriza players autoritativos da sala; depois usa HUD/shooters como
      // fallback. `observed` representa presença real; `ready` representa
      // configuração de combate e não deve ser usado como conexão.
      const parseVocFromText = (t: string): string | null => {
        const low = String(t || '').toLowerCase();
        if (/knight|\bek\b/.test(low)) return 'Knight (EK)';
        if (/druid|\bed\b/.test(low)) return 'Druid (ED)';
        if (/sorcerer|\bms\b/.test(low)) return 'Sorcerer (MS)';
        if (/paladin|\brp\b/.test(low)) return 'Paladin (RP)';
        if (/monk|\bmk\b/.test(low)) return 'Monk (MK)';
        return null;
      };
      const parseLvlFromText = (t: string): number | null => {
        const m = String(t || '').match(/(?:lvl|level|n[ií]vel)?\s*[:·•\-–]?\s*(\d{2,4})/i);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        return n >= 10 && n <= 800 ? n : null;
      };
      const hudMembers: any[] = Array.isArray((telemetry as any).partyMembersRaw) ? (telemetry as any).partyMembersRaw : [];
      let rawMembers: any[] = Array.isArray(telemetry.roomPlayers) && telemetry.roomPlayers.length > 0
        ? telemetry.roomPlayers : hudMembers;
      if (rawMembers.length === 0 && Array.isArray(telemetry.shooters) && telemetry.shooters.length > 0) {
        rawMembers = (telemetry.shooters as any[]).map((s: any) => ({
          slot: s.slot,
          name: s.name || null,
          voc: (s as any).vocation || parseVocFromText(s.text || ''),
          level: (s as any).level || parseLvlFromText(s.text || ''),
          text: s.text || '',
        }));
      }

      // Personagens ativos da conta ordenados (líder primeiro se houver)
      const disabledIds = Array.isArray(cachedPartyConfig?.disabled) ? cachedPartyConfig.disabled : [];
      const activeAccountChars = accList.filter((c: any) => !disabledIds.includes(c?.id));

      const slotsMap: Record<string, any> = (magicState?.slots || {}) as any;
      const hasMagic = Object.keys(slotsMap).length > 0;
      // Uma conta pode ter mais personagens disponíveis que slots ativos. A
      // party do jogo é limitada a 3; não publique um quarto membro por causa
      // de uma duplicata entre room/characters.list.
      const totalSlots = Math.min(3, Math.max(rawMembers.length || 0, activeAccountChars.length || 0, telemetry.partySlots || 3));
      const memberLevels: number[] = [];
      const partyMembersOut: any[] = [];
      for (let sid = 0; sid < totalSlots; sid++) {
        const found = rawMembers.find((m: any) => Number(m?.slot) === sid) || rawMembers[sid];
        const vocFromText = found?.text ? parseVocFromText(found.text) : null;
        const fallbackChar = activeAccountChars[sid];
        const voc = (found?.voc) || vocFromText || (fallbackChar ? `${fallbackChar.vocation.toUpperCase()}` : (sid === 0 ? "Knight (EK)" : (sid === 1 ? "Druid (ED)" : "Sorcerer (MS)")));
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
        if (!charInfo && fallbackChar) charInfo = fallbackChar;

        const extractedName = found?.name && !String(found.name).startsWith("Slot") ? found.name : null;
        const lvlFromText = found?.text ? parseLvlFromText(found.text) : null;
        const extractedLvl = (found?.level && Number(found.level) >= 10) ? Number(found.level) : (lvlFromText || null);
        const defaultName = `Slot ${sid + 1}`;
        const defaultLvl = Number(telemetry.level) || 0;
        const charNameVal = extractedName || charInfo?.name || defaultName;
        const lvl = extractedLvl || charInfo?.level || defaultLvl;
        memberLevels.push(Number(lvl) || 0);
        const sInfo = slotsMap[String(sid)] || {};
        const hInfo = helperBySlot[sid] || {};
        // Presença não é configuração. Sem scan/helper confirmado, o membro
        // não pode aparecer como READY só porque foi encontrado no room.
        const ready = hasMagic
          ? !!(sInfo.ready || (sInfo.heal && sInfo.mana))
          : !!(hInfo.heal && hInfo.manaPotion);
        partyMembersOut.push({
          slot: sid, name: charNameVal, voc, level: lvl,
          heal: hInfo.heal || (sInfo.heal ? "Configurada (<75%)" : "Nenhuma"),
          mana: hInfo.manaPotion || "mana potion",
          attack: !!sInfo.attack !== false ? (sInfo.attack ?? true) : true,
          ready,
          observed: Boolean(found || fallbackChar),
        });
      }
      const topLevel = memberLevels.length > 0 ? Math.max(...memberLevels) : Number(telemetry.level) || 0;
      const partyConnected = Math.min(3, new Set(rawMembers.map((m: any) => Number(m?.slot)).filter((s: number) => Number.isFinite(s))).size || Math.min(3, rawMembers.length));
      const partyConfigReady = partyMembersOut.filter((member: any) => member.ready).length;
      const activeHunt = telemetry.hunt && telemetry.hunt !== "Conectando..." && telemetry.hunt !== "—" ? telemetry.hunt : "—";
      const mapSnapshot = protocolMapper.snapshot();
      const metrics = runtimeMetrics();
      const bossState = (telemetry as any).autoBossState;
      if (config.autoBoss && bossState && typeof bossState === 'object') {
        const until = Number(bossState.until || 0);
        const playlist = Array.isArray(bossState.list) ? bossState.list : [];
        const running = bossState.running === true;
        if (until <= Date.now() || playlist.length === 0) {
          subsystems.auto_boss = {
            status: "AGUARDANDO_REQUISITO",
            detail: "Auto Boss sem playlist/liberação no servidor; nenhuma rotação executada",
          };
        } else {
          subsystems.auto_boss = {
            status: "FUNCIONAL",
            detail: running ? `Rotação Auto Boss em andamento (${playlist.length} chefes)` : `Playlist Auto Boss pronta (${playlist.length} chefes)`,
          };
        }
      }
      // O analyzer visual pode faltar em headless, mas as taxas abaixo sempre
      // são resolvidas pela hunt atualmente selecionada (live ou histórico da
      // própria hunt), nunca por uma hunt anterior.
      const analyzerOut: any = { ...(latestAnalyzers || {}) };
      analyzerOut.xp_per_hour = metrics.selectedHuntMetrics.xp_per_hour;
      analyzerOut.loot_per_hour = metrics.selectedHuntMetrics.loot_per_hour;
      analyzerOut.net_gold_per_hour = metrics.selectedHuntMetrics.gold_per_hour;
      analyzerOut.goldPerHour = metrics.selectedHuntMetrics.gold_per_hour;
      analyzerOut.killsPerHour = metrics.sessionKillsPerHour;
      analyzerOut.wavesPerHour = metrics.sessionWavesPerHour;
      const sessionXpNum = metrics.sessionXp;
      analyzerOut.session_xp = sessionXpNum;
      analyzerOut.raw_xp = sessionXpNum;
      const fmtXp = (n: number): string => {
        if (n <= 0) return '0 XP';
        if (n >= 1_000_000_000) return `+${(n / 1_000_000_000).toFixed(2)}B XP`;
        if (n >= 1_000_000) return `+${(n / 1_000_000).toFixed(2)}kk XP`;
        if (n >= 1_000) return `+${(n / 1_000).toFixed(1)}k XP`;
        return `+${n} XP`;
      };
      const snap = telemetry.snapshot({
        character: primaryChar?.name || partyMembersOut[0]?.name || null,
        subsystems,
        analyzers: analyzerOut,
        hunt_decision: (profiler as any).lastDecision || {},
        session_xp: sessionXpNum,
        session_xp_str: fmtXp(sessionXpNum),
        elapsed_minutes: telemetry.elapsedMinutes(),
        elapsed_seconds: telemetry.elapsedSeconds(),
        force_hunt: Boolean(manualHuntId),
        force_hunt_id: manualHuntId || null,
        hunt_control: 'manual',
        jev_recommendation: jevRecommendation,
      });
      const statusData = {
        ...snap,
        character: primaryChar?.name || partyMembersOut[0]?.name || null,
        connected: !!snap.online,
        hunt: activeHunt,
        level: Math.max(snap.level, topLevel),
        party_slots: totalSlots,
        party_connected: partyConnected,
        party_config_ready: partyConfigReady,
        // Compatibilidade: o campo antigo agora representa presença, não
        // configuração de magia. A configuração fica em party_config_ready.
        party_ready: partyConnected,
        party_members: partyMembersOut,
        selected_hunt_id: metrics.selectedHuntId,
        selected_hunt_name: metrics.selectedHuntName,
        selected_hunt_metrics: metrics.selectedHuntMetrics,
        session_metrics: {
          kills_per_hour: metrics.sessionKillsPerHour,
          waves_per_hour: metrics.sessionWavesPerHour,
        },
        level_per_hour: metrics.levelPerHour,
        last_hunt: metrics.selectedHuntName || (profiler as any).lastPlayedName || activeHunt,
        last_hunt_id: metrics.selectedHuntId || (profiler as any).lastPlayedId || null,
        force_hunt: Boolean(manualHuntId),
        force_hunt_id: manualHuntId || null,
        hunt_control: 'manual',
        pending_hunt_id: pendingHuntChange?.id || null,
        pending_hunt_name: pendingHuntChange?.name || null,
        pending_hunt_requested_at: pendingHuntChange?.requestedAt || null,
        benchmarks: (profiler as any).benchmarks,
        hunt_decision: (profiler as any).lastDecision || {},
        magic: magicState,
        analyzers: analyzerOut,
        hunt_matrix: (huntMatrix as any).matrix,
        protocol_map: mapSnapshot,
        hunt_metrics: mapSnapshot.scores,
        unlocked_hunts: mapSnapshot.unlockedHunts,
        // Lista usada pelo engine depois de combinar offlineInfo, servidor e
        // seletor DOM (a lista acima é apenas o mapa protocolar histórico).
        engine_unlocked_hunts: (profiler as any).unlockedIds || [],
        skills: telemetry.skills,
        magic_level: telemetry.magicLevel,
        skills_summary: telemetry.skillsSummary,
        coins: telemetry.coins,
        market_coins: telemetry.marketCoins,
        jev_recommendation: jevRecommendation,
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
      notePouchSignal(typ, pay);

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
          authoritativeHuntId = hid;
          telemetry.updateHunt(hid, 'websocket');
          protocolMapper.setActiveHunt(hid);
          if (manualHuntId && hid !== manualHuntId) {
            console.warn(`[${new Date().toLocaleTimeString()}] 🛡️ [TRAVA HUNT] Sala conectada (${hid}) diverge da hunt manual (${manualHuntId}) — agendando re-entrada`);
            needsHuntEntry = true;
          }
        }
        (telemetry as any).lastJoined = pay;
        console.log(`[${new Date().toLocaleTimeString()}] 🏹 [JOINED] hunt=${hid || '?'} wave=${pay?.wave ?? '?'}`);
        writeStatusFile();
      } else if (typ === "toHunt" || typ === "resume" || typ === "reconnectOk") {
        if (typ === "reconnectOk") (telemetry as any).reconnectOk = true;
        const hid = pay && typeof pay === 'object' ? (pay.huntId || pay.hunt?.id || null) : (typeof pay === 'string' ? pay : null);
        if (typeof hid === 'string') {
          authoritativeHuntId = hid;
          telemetry.updateHunt(hid, 'websocket');
          if (manualHuntId && hid !== manualHuntId) {
            console.warn(`[${new Date().toLocaleTimeString()}] 🛡️ [TRAVA HUNT] Servidor retomou (${hid}) mas hunt manual é (${manualHuntId}) — agendando re-entrada`);
            needsHuntEntry = true;
          }
        }
        console.log(`[${new Date().toLocaleTimeString()}] 🔄 [${typ.toUpperCase()}] ${typeof hid === 'string' ? hid : ''}`);
        writeStatusFile();
      } else if (typ === "toCity") {
        authoritativeHuntId = null;
        (telemetry as any).lastToCityAt = Date.now();
        console.log(`[${new Date().toLocaleTimeString()}] 🏙️ [TOCITY] servidor mandou para cidade`);
        writeStatusFile();
      } else if (typ === "takeover" || typ === "serverdrop") {
        console.log(`[${new Date().toLocaleTimeString()}] ⚠️ [${typ.toUpperCase()}] ${JSON.stringify(pay)?.slice(0, 200)}`);
        (telemetry as any)[typ] = pay;
      } else if (typ === "autobossstate") {
        // Estado autoritativo da feature: `until=0`/playlist vazia significa
        // que a conta ainda não tem o Auto Boss liberado, não que a rotação
        // foi executada com sucesso.
        (telemetry as any).autoBossState = pay;
        writeStatusFile();
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

  let needsHuntEntry = false;
  let lastHuntAttempt = 0;
  let lastSpellGear = 0;
  let needsSpellSync = true;
  let lastSpellSyncHunt = "";
  let lastSpellSyncAttempt = 0;
  const spellSlotCooldown = new Map<number, number>();
  type PendingHuntChange = {
    id: string;
    name: string;
    requestedAt: string;
  };
  let pendingHuntChange: PendingHuntChange | null = null;
  let lastLoggedSkillsSig = "";

  const huntFinishedForSwitch = (): boolean => {
    const current = String(telemetry.hunt || '').toLowerCase();
    if (!telemetry.online || telemetry.inTreino) return true;
    if (/cidade|city|templo|temple/.test(current)) return true;
    if (telemetry.huntStage !== null && telemetry.huntStageTotal !== null) {
      return telemetry.huntStage === 1;
    }
    if (telemetry.huntStageLabel) {
      const m = telemetry.huntStageLabel.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) {
        const c = Number(m[1]);
        if (Number.isFinite(c)) return c === 1;
      }
    }
    const stage = parseHuntStage(telemetry.hunt);
    if (stage.current !== null && stage.total !== null) {
      return stage.current === 1;
    }
    // Hunts sem estágio (farm infinito) liberam na cidade; sem 1/10 não deve interromper wave no meio
    const activeId = authoritativeHuntId || matchHunt(telemetry.hunt)?.id || (profiler as any).activeHuntId;
    return !activeId && !current.includes('conectando');
  };

  const activateManualHunt = (target: PendingHuntChange): void => {
    pendingHuntChange = null;
    manualHuntId = target.id;
    config.forceHunt = true;
    config.huntId = target.id;
    config.huntMode = 'force';
    try {
      writeFileSync(join(dataDir, 'manual_hunt.json'), JSON.stringify({ hunt_id: target.id, hunt_name: target.name, updated_at: new Date().toISOString() }, null, 2), 'utf-8');
    } catch (_) {}
    needsHuntEntry = true;
    lastHuntAttempt = 0;
    if (telemetry.inTreino) {
      telemetry.inTreino = false;
      subsystems.auto_treino = { status: "FUNCIONAL", detail: "Comando manual do operador — saindo do treino" };
      sendStage(pageRef, target.id).catch(() => null);
    }
    spellSlotCooldown.clear();
    lastSpellGear = 0;
    needsSpellSync = true;
    lastSpellSyncHunt = target.id;
    const optimal = getOptimalSpellRotation(target.id);
    (magicState as any).recommended_element = optimal.preferredElement;
    (magicState as any).hunt_weaknesses = optimal.weaknesses;
    (magicState as any).hunt_resistances = optimal.resistances;
    console.log(`[${new Date().toLocaleTimeString()}] 🎮 [HUNT MANUAL] ${target.name} (${target.id}) ativada com prioridade`);
    console.log(`[${new Date().toLocaleTimeString()}] ⚡ [BUILD FRAQUEZAS] Elemento recomendado: ${optimal.preferredElement.toUpperCase()} | Fraquezas: ${optimal.weaknesses.join(', ')} | Resistências a evitar: ${optimal.resistances.join(', ') || 'nenhuma'}`);
  };

  // Inicia Servidor Web Bun — getState usa o mesmo contrato do status.json
  // (fallback quando o disco ainda não tem status.json no boot).
  startServer(config.port, config.host, {
    getState: () => {
      const metrics = runtimeMetrics();
      const analyzerOut: any = { ...(latestAnalyzers || {}) };
      analyzerOut.xp_per_hour = metrics.selectedHuntMetrics.xp_per_hour;
      analyzerOut.loot_per_hour = metrics.selectedHuntMetrics.loot_per_hour;
      analyzerOut.net_gold_per_hour = metrics.selectedHuntMetrics.gold_per_hour;
      analyzerOut.goldPerHour = metrics.selectedHuntMetrics.gold_per_hour;
      analyzerOut.killsPerHour = metrics.sessionKillsPerHour;
      analyzerOut.wavesPerHour = metrics.sessionWavesPerHour;
      analyzerOut.session_xp = metrics.sessionXp;
      analyzerOut.raw_xp = metrics.sessionXp;
      return {
        ...telemetry.snapshot({
          subsystems,
          analyzers: analyzerOut,
          hunt_decision: (profiler as any).lastDecision || {},
          session_xp: metrics.sessionXp,
          elapsed_minutes: telemetry.elapsedMinutes(),
          elapsed_seconds: telemetry.elapsedSeconds(),
          force_hunt: Boolean(manualHuntId),
          force_hunt_id: manualHuntId || null,
          hunt_control: 'manual',
          pending_hunt_id: pendingHuntChange?.id || null,
          pending_hunt_name: pendingHuntChange?.name || null,
          pending_hunt_requested_at: pendingHuntChange?.requestedAt || null,
          jev_recommendation: jevRecommendation,
        }),
        selected_hunt_id: metrics.selectedHuntId,
        selected_hunt_name: metrics.selectedHuntName,
        selected_hunt_metrics: metrics.selectedHuntMetrics,
        session_metrics: { kills_per_hour: metrics.sessionKillsPerHour, waves_per_hour: metrics.sessionWavesPerHour },
        level_per_hour: metrics.levelPerHour,
        party_connected: telemetry.shooters.length,
        party_config_ready: telemetry.shooters.filter((member: any) => member.ready).length,
        party_ready: telemetry.shooters.length,
      } as any;
    },
    getPage: () => pageRef,
    getCdp: () => cdpRef,
    getLatestFrame: () => getFrameRef(),
    onSetHunt: async (huntId: string, auto: boolean) => {
      if (auto || !huntId || huntId === 'auto') {
        return { ok: false, error: 'Modo automático desativado. Escolha uma hunt manualmente.' };
      }

      const matched = matchHunt(huntId);
      if (!matched) return { ok: false, error: `Hunt não encontrada: ${huntId}` };
      const targetId = matched?.id || huntId;
      const targetName = matched?.name || huntId;
      const activeId = matchHunt(telemetry.hunt)?.id || authoritativeHuntId || manualHuntId || (profiler as any).activeHuntId || null;
      const alreadyPending = pendingHuntChange?.id === targetId;
      if (activeId === targetId && !pendingHuntChange && !telemetry.inTreino) {
        return { ok: true, message: `${targetName} já é a hunt ativa.` };
      }

      // Cancela decisões automáticas/antigas que ainda não começaram. Uma
      // ação já em voo recebe a revisão abaixo e não poderá atualizar o
      // status como sucesso quando voltar com um alvo obsoleto.
      huntSelectionRevision += 1;
      actionQueue.clearQueuedLane('hunt');

      const request: PendingHuntChange = {
        id: targetId,
        name: targetName,
        requestedAt: new Date().toISOString(),
      };

      // Quando o operador escolhe uma hunt no painel web, o comando tem prioridade máxima.
      // Ativa imediatamente e encerra qualquer estado de treino bloqueante.
      telemetry.inTreino = false;
      pendingHuntChange = null;
      activateManualHunt(request);
      writeStatusFile();
      return { ok: true, message: `Hunt ${targetName} iniciada com sucesso.`, pending: false };
    },
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
    clearInterval(spellProbeTimer);
    console.log("\n[*] Encerrando bot com segurança...");
    await browserCtx.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // --- Estado interno de cadências ---
  const t0Loop = Date.now();
  let lastPrint = Date.now();
  lastHuntAttempt = 0;
  let huntRetryDelayMs = 14000;
  let lastSellTime = 0;
  let lastDailyCheck = 0;
  let lastPromoteCheck = 0;
  let lastEquipCheck = 0;
  let lastPotionCheck = 0;
  let lastTreinoCheck = 0;
  let lastStatusWrite = 0;
  let fastStateBusy = false;
  let lastTreinoTime = 0;
  let lastBossNativeAttempt = 0;
  lastSpellGear = 0;
  let spellProbeBusy = false;
  let lastSpellProbe = 0;
  let spellProbeFailures = 0;
  let lastPickerOpen = false;
  let trainingFalseStreak = 0;
  let lastWatchdogCheck = 0;
  let lastForceDebug = 0;
  let lastHudCheck = 0;
  // O perfil de dano vem do combatlog acumulado e pode mudar quando a
  // rotação/equipamento troca. Não o congele no primeiro frame: atualize em
  // uma cadência moderada para que a recomendação de magia acompanhe a hunt
  // sem transformar cada tick em uma nova mutação de estado.
  let cachedHud: any = {};
  let previousHelperLevel = 0;
  let previousPartySignature = '';
  let previousMagicSignature = '';
  let lastHelperTrigger = 0;
  let needPotionCheck = true;
  let cityStreak = 0;
  // Heartbeat anti-stall: se a hunt não progride (kills/waves/gold parados),
  // força re-entrada em vez de ficar parado até o watchdog recarregar.
  let lastProgressKills = 0;
  let lastProgressWaves = 0;
  let lastProgressGold = 0;
  let lastProgressTime = Date.now();
  let lastStallCheck = 0;
  // Algumas builds avisam "Loot Pouch cheia" pelo notify/log, mas deixam o
  // contador DOM em 0/8. Guarda esse sinal curto para o auto-sell não depender
  // de uma leitura visual incorreta da pouch.
  let pouchFullUntil = 0;
  // Dreno de eventos do kernel hook (cobre Blob/fragmentado que o CDP perde).
  let lastRoomDrain = 0;
  let lastReadySend = 0;
  // Espelho de estado do kernel (ROOM_DATA + battery-save NWe indireto).
  let lastRoomStatePull = 0;

  // Venda autoritativa: o cliente oficial não clica em um botão de HTML para
  // esvaziar a Loot Pouch; ele envia `sellall` à sala com `protected=false`.
  // O comando preserva os itens protegidos pelo servidor (raridade/classe/boss)
  // e também inclui materiais. O DOM fica somente como fallback para builds
  // antigas que ainda não expõem o socket no kernel.
  const nativeSellPouch = async (reason: string): Promise<boolean> => {
    const detail = await roomSendDetail(pageRef, 'sellall', { protected: false }).catch(() => null);
    if (detail?.sent && detail.sent > 0) {
      lastSellTime = Date.now();
      console.log(`[${new Date().toLocaleTimeString()}] 💰 [AUTO-SELL] sellall aceito pelo servidor (protegidos mantidos; motivo=${reason})`);
      // Dá tempo para o PATCH de inventário chegar antes da próxima decisão.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return true;
    }
    return false;
  };

  const notePouchSignal = (type: unknown, payload: any): void => {
    const kind = String(type || '').toLowerCase();
    if (!['log', 'notify', 'autosellfull', 'bpstatus'].includes(kind)) return;
    let raw = '';
    try { raw = typeof payload === 'string' ? payload : JSON.stringify(payload); } catch (_) { raw = ''; }
    if (/loot\s*pouch.*(cheia|full)|pouch.*(cheia|full)|invent[aá]rio.*(cheio|full)/i.test(raw)) {
      pouchFullUntil = Date.now() + 180_000;
    }
  };

  // Leitura independente da fila de ações. O renderer pode manter uma ação
  // lenta de inventário/equipamento em voo; nesse caso o loop principal ainda
  // precisa conseguir abrir a rotação e descobrir os slots reais.
  const probeSpellSlots = async (): Promise<void> => {
    const nowProbe = Date.now();
    // O HUD pode montar os slots somente depois do `joined`; um backoff de
    // cinco minutos deixava a conta caçando com p0 mesmo quando a rotação já
    // estava visível. Após duas falhas, tente novamente em 60 s.
    const probeCooldown = spellProbeFailures >= 2 ? 60000 : 30000;
    const hasEmptySlot = Object.values(magicState.slots as Record<string, any> || {}).some((s: any) => (s.empty || 0) > 0) || (magicState as any).empty > 0;
    if (!pageRef || spellProbeBusy || nowProbe < preTeleportSilencedUntil || (magicState.power > 0 && !hasEmptySlot) || nowProbe - lastSpellProbe < probeCooldown) return;
    spellProbeBusy = true;
    lastSpellProbe = nowProbe;
    try {
      const currentHuntTarget = authoritativeHuntId || manualHuntId || telemetry.hunt;
      const optimal = getOptimalSpellRotation(currentHuntTarget);
      (magicState as any).recommended_element = optimal.preferredElement;
      (magicState as any).hunt_weaknesses = optimal.weaknesses;
      (magicState as any).hunt_resistances = optimal.resistances;
      // Em SwiftShader a leitura dos slots pode esperar o renderer por mais
      // de uma janela normal de HUD. A sonda é somente leitura e roda no
      // máximo a cada 30/60s; dê tempo para ela capturar rot-* já montados,
      // sem abrir outro modal ou repetir cliques de configuração.
      const scan = await safeEval<any>(pageRef, 'spell', {
        metaAoe: optimal.metaAoe,
        metaStrike: optimal.metaStrike,
        healWords: optimal.healWords,
        manaWords: optimal.manaWords,
        job: 'open',
      }, 25000);
      if (Array.isArray(scan?.spells) && scan.spells.length > 0) {
        magicState = classifyMagicPreservingFacts(scan.spells, Object.keys(helperBySlot).sort().map((k) => helperBySlot[Number(k)]));
        spellProbeFailures = 0;
        console.log(`[${new Date().toLocaleTimeString()}] 🔮 [SPELL SCAN] ${JSON.stringify({ power: magicState.power, names: magicState.names, slots: magicState.slots })}`);
      } else {
        spellProbeFailures++;
        if (scan?.reason && spellProbeFailures <= 2) {
          console.log(`[${new Date().toLocaleTimeString()}] 🔮 [SPELL SCAN] ${JSON.stringify({ reason: scan.reason, candidates: scan.candidates || [] }).slice(0, 3000)}`);
        }
      }
    } catch (_) {
      spellProbeFailures++;
    } finally {
      await closeStuckModals();
      spellProbeBusy = false;
    }
  };
  const spellProbeTimer = setInterval(() => { void probeSpellSlots(); }, 30000);

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

      // characters.list é barato e devolve o saldo/stamina autoritários; uma
      // atualização por minuto evita que a leitura fique congelada no boot.
      if (now - lastAccountCharsAttempt >= ACCOUNT_SYNC_MS) {
        lastAccountCharsAttempt = now;
        syncAccountChars().catch(() => null);
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
              notePouchSignal(ev.type, ev.payload);
              if (ev.type === 'go' && ev.payload && typeof ev.payload === 'object' && ev.payload.token) {
                queueFlow.admitToken = String(ev.payload.token);
                queueFlow.lastGoAt = Date.now();
              } else if (ev.type === 'pos') {
                queueFlow.pos = (ev.payload && ev.payload.position !== undefined) ? ev.payload.position : ev.payload;
              } else if (ev.type === 'joined' && ev.payload?.huntId) {
                const hid = String(ev.payload.huntId);
                authoritativeHuntId = hid;
                telemetry.updateHunt(hid, 'websocket');
                if (manualHuntId && hid !== manualHuntId) {
                  console.warn(`[${new Date().toLocaleTimeString()}] 🛡️ [TRAVA HUNT] Drain: Sala (${hid}) != hunt manual (${manualHuntId}) — agendando re-entrada`);
                  needsHuntEntry = true;
                }
              } else if ((ev.type === 'toHunt' || ev.type === 'resume') && ev.payload) {
                const hid = typeof ev.payload === 'string' ? ev.payload : (ev.payload.huntId || null);
                if (typeof hid === 'string') {
                  authoritativeHuntId = hid;
                  telemetry.updateHunt(hid, 'websocket');
                  if (manualHuntId && hid !== manualHuntId) {
                    console.warn(`[${new Date().toLocaleTimeString()}] 🛡️ [TRAVA HUNT] Drain: Retomou (${hid}) != hunt manual (${manualHuntId}) — agendando re-entrada`);
                    needsHuntEntry = true;
                  }
                }
              } else if (ev.type === 'toCity') {
                authoritativeHuntId = null;
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
                const roomHuntId = typeof rs.huntId === 'string' && rs.huntId
                  ? rs.huntId
                  : (typeof rs.hunt === 'string' && rs.hunt && rs.hunt !== 'Conectando...' ? rs.hunt : null);
                if (roomHuntId) {
                  authoritativeHuntId = roomHuntId;
                  telemetry.updateHunt(roomHuntId, 'websocket');
                  if (manualHuntId && roomHuntId !== manualHuntId) {
                    console.warn(`[${new Date().toLocaleTimeString()}] 🛡️ [TRAVA HUNT] Estado da sala (${roomHuntId}) diverge da hunt manual (${manualHuntId}) — agendando re-entrada`);
                    needsHuntEntry = true;
                  }
                }
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

      // O servidor mantém a reserva da sala enquanto recebe o heartbeat do
      // cliente real. Em VPS com renderer lento o bundle pode ficar ocupado e
      // deixar esse envio atrasar; o hook TS replica o pacote `ready` sem
      // input sintético e evita `seat reservation expired`/código 1006.
      if (telemetry.online && now - lastReadySend >= 20000) {
        lastReadySend = now;
        roomSend(pageRef, 'ready', {}).catch(() => null);
      }

      // O servidor oferece o mesmo auto-sell usado pelo painel do jogo. A
      // configuração nativa continua válida mesmo quando a avaliação DOM
      // está ocupada e evita que a pouch permaneça 32/32 após um sell-all
      // visual que não encontrou o botão correto.
      if (telemetry.online && now - lastAutoSellConfig >= 300_000) {
        lastAutoSellConfig = now;
        sendAutosellFull(pageRef, true).catch(() => null);
        sendAutosellPct(pageRef, config.sellThresholdPct).catch(() => null);
      }

      // 2. Cooldowns e flags de verificação periódica
      const sellAllowed = (now - lastSellTime) >= 125000;
      const shouldCheckDaily = (now - lastDailyCheck) >= 60000;
      const shouldCheckPromote = (now - lastPromoteCheck) >= 30000;

      // 3. Tick de telemetria ultra-leve (não percorre o body, responde em < 20ms)
      let domState: any = null;
      if (!fastStateBusy && now >= preTeleportSilencedUntil) {
        fastStateBusy = true;
        let pendingFastEval: Promise<any> | null = null;
        try {
          const cdpEval = cdpRef.send("Runtime.evaluate", {
            expression: "(" + FAST_STATE_JS + ")()",
            returnByValue: true,
            awaitPromise: false,
          });
          pendingFastEval = cdpEval;
          const evalRes: any = await Promise.race([
            cdpEval,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          if (evalRes?.exceptionDetails) {
            const detail = evalRes.exceptionDetails?.exception?.description || evalRes.exceptionDetails?.text || 'Runtime.evaluate exception';
            console.log(`[${new Date().toLocaleTimeString()}] ⚠️ [FAST_STATE EXCEPTION]: ${String(detail).slice(0, 240)}`);
          }
          domState = evalRes?.result?.value || null;
        } catch (_) {
          domState = null;
        } finally {
          // Em caso de timeout do race, mantenha o lock até o comando CDP
          // antigo terminar; caso contrário os evaluate expirados se acumulam.
          if (pendingFastEval) pendingFastEval.finally(() => { fastStateBusy = false; }).catch(() => { fastStateBusy = false; });
          else fastStateBusy = false;
        }
      }

      if (shouldCheckDaily) lastDailyCheck = now;
      if (shouldCheckPromote) lastPromoteCheck = now;

      // O renderer pode atrasar/expirar o FAST_STATE enquanto o WebSocket
      // continua saudável. Não pare a engine nesse caso: um objeto vazio
      // preserva os defaults DOM e deixa profiler, stamina e rotação usarem a
      // telemetria autoritativa já ingerida do servidor.
      if (!domState) domState = {};
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
        if (domState.inTraining === true) {
          trainingFalseStreak = 0;
          telemetry.inTreino = true;
          subsystems.auto_treino = { status: "TREINANDO", detail: "Treino Online confirmado pela UI" };
        } else if (domState.inTraining === false && telemetry.inTreino && !looksLikeTreino(domState.wave)) {
          // O overlay pode sumir por um frame durante a troca de sala. Exija
          // três leituras consecutivas fora do treino antes de liberar a hunt.
          trainingFalseStreak += 1;
          if (trainingFalseStreak >= 3) {
            telemetry.inTreino = false;
            trainingFalseStreak = 0;
          }
        }
        if (domState.wave) telemetry.updateHunt(domState.wave, source);
        if (domState.level) telemetry.updateLevel(domState.level, source);
        if (domState.gold !== undefined && domState.gold !== null) telemetry.updateGold(domState.gold, source);
        if (domState.coins !== undefined && domState.coins !== null) telemetry.updateCoins(domState.coins, source);
        if (domState.stamina) telemetry.updateStamina(domState.stamina, source);
        telemetry.updateLoopMode(domState.loopOn, source);
        telemetry.updateBagSlots(domState.invText, source);
        telemetry.updateParty(domState.party, source);

        // O estado rápido também carrega a rotação/analyzer. Isso é um
        // fallback determinístico quando safeEval('hud') perde uma janela por
        // pressão do renderer; sem ele o bot publicava magia p0 e XP/h vazio.
        if (Array.isArray(domState.spells) && domState.spells.length > 0) {
          for (const hlp of domState.helpers || []) {
            if (hlp && hlp.slot !== undefined && hlp.slot !== null) helperBySlot[Number(hlp.slot)] = hlp;
          }
          magicState = classifyMagicPreservingFacts(domState.spells, Object.keys(helperBySlot).sort().map((k) => helperBySlot[Number(k)]));
        }
        if (domState.analyzers && typeof domState.analyzers === 'object') {
          latestAnalyzers = { ...latestAnalyzers, ...domState.analyzers };
          observeHudSessionXp((latestAnalyzers as any).session_xp ?? (latestAnalyzers as any).raw_xp);
          const analyzerHunt = matchHunt(telemetry.hunt)?.id;
          if (analyzerHunt) protocolMapper.recordAnalyzer(analyzerHunt, latestAnalyzers);
        }

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

        // HUD completo (spells/helpers/analyzers) — cadência suave (45s) sem travar o loop
        let hud: any = cachedHud;
        if (now >= preTeleportSilencedUntil && now - lastHudCheck >= (magicState.power > 0 ? 45000 : 75000)) {
          lastHudCheck = now;
          try {
            cachedHud = await safeEval<any>(pageRef, "hud", null, 15000) || cachedHud;
            hud = cachedHud;
            if (hud.level) telemetry.updateLevel(hud.level, "dom");
            if (hud.gold !== undefined && hud.gold !== null) telemetry.updateGold(hud.gold, "dom");
            if (hud.coins !== undefined && hud.coins !== null) telemetry.updateCoins(hud.coins, "dom");
            if (hud.market_coins !== undefined && hud.market_coins !== null) telemetry.updateMarketCoins(hud.market_coins, "dom");
            if (hud.skills && Object.keys(hud.skills).length > 0) telemetry.updateSkills(hud.skills, "dom");
            const curSkillsSig = `${telemetry.magicLevel}_${JSON.stringify(telemetry.skills)}_${telemetry.coins}_${telemetry.marketCoins}`;
            if (curSkillsSig !== lastLoggedSkillsSig && (telemetry.magicLevel > 0 || Object.keys(telemetry.skills).length > 0 || telemetry.coins > 0)) {
              lastLoggedSkillsSig = curSkillsSig;
              console.log(`[${new Date().toLocaleTimeString()}] 🧙 [STATUS PERSONAGEM] Nível: ${telemetry.level} | ML: ${telemetry.magicLevel || '—'} | Skills: ${telemetry.skillsSummary || '—'} | Coins: ${telemetry.coins || 0}${telemetry.marketCoins ? ` (+${telemetry.marketCoins} mkt)` : ''} | Gold: ${Number(telemetry.gold || 0).toLocaleString()}`);
            }
            if (hud.stamina) telemetry.updateStamina(hud.stamina, "dom");
            if (hud.analyzers) {
              latestAnalyzers = hud.analyzers;
              observeHudSessionXp((latestAnalyzers as any).session_xp ?? (latestAnalyzers as any).raw_xp);
              // Hunt Analyzer do jogo é autoritativo p/ kills/sessão: se o WS
              // perdeu combatlog fragmentado, o painel não fica zerado.
              const hudKills = Number((hud.analyzers as any)?.hunt_kills ?? 0) || 0;
              if (hudKills > telemetry.kills) telemetry.kills = Math.floor(hudKills);
            }
            for (const hlp of hud.helpers || []) {
              if (hlp && typeof hlp === "object" && hlp.slot !== undefined && hlp.slot !== null) {
                helperBySlot[Number(hlp.slot)] = hlp;
              }
            }
            // Não apague uma leitura válida do FAST_STATE com um HUD vazio:
            // em alguns frames o picker/modal faz safeEval retornar `{}` ou
            // uma lista sem slots enquanto a rotação continua visível.
            if (Array.isArray(hud.spells) && hud.spells.length > 0) {
              magicState = classifyMagicPreservingFacts(hud.spells, Object.keys(helperBySlot).sort().map((k) => helperBySlot[Number(k)]));
            }
            if (Array.isArray(hud.partyMembers) && hud.partyMembers.length > 0) (telemetry as any).partyMembersRaw = hud.partyMembers;
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
        // A barra de party/rotação pode montar alguns segundos depois do
        // primeiro join. Adie automações DOM pesadas enquanto ela não foi
        // lida; após 3 minutos há fallback para contas sem slots configurados.
        const domAutomationReady = magicState.power > 0 || now - t0Loop >= 180_000;
        const looksCity = wave === "Cidade" || wave === "City" || wave === "Templo" || wave === "Temple"
          || ["cidade", "city", "templo", "temple"].some((w) => waveLow.includes(w));
        // O HUD é cacheado e pode conservar `pickerOpen=true` depois que o
        // modal já fechou. Priorize o FAST_STATE atual; só use o HUD como
        // fallback quando ele for a única fonte disponível.
        const pickerOpen = domState.pickerOpen !== undefined
          ? !!domState.pickerOpen
          : !!hud.pickerOpen;
        lastPickerOpen = pickerOpen;
        if (looksCity && !pickerOpen) cityStreak++;
        else cityStreak = 0;
        const isCity = cityStreak >= 3;

        // Troca manual fica pendente durante a hunt atual. Só libera o novo
        // alvo quando a etapa chegou ao fim ou o jogo saiu para cidade/treino.
        if (pendingHuntChange && huntFinishedForSwitch()) {
          activateManualHunt(pendingHuntChange);
          writeStatusFile();
        }

        // Quando a conta possui Auto Boss liberado, use o mesmo comando nativo
        // do painel. Só inicia a playlist em cidade/templo, nunca no meio de
        // uma wave, para não sacrificar a reserva da sala de hunt.
        const bossState = (telemetry as any).autoBossState;
        if (config.autoBoss && isCity && bossState && typeof bossState === 'object' &&
            Number(bossState.until || 0) > Date.now() && Array.isArray(bossState.list) &&
            bossState.list.length > 0 && bossState.running !== true && now - lastBossNativeAttempt >= 90000) {
          lastBossNativeAttempt = now;
          const bossSend = await sendAutoBoss(pageRef, 'start').catch(() => null);
          if (bossSend?.sent && bossSend.sent > 0) {
            console.log(`[${new Date().toLocaleTimeString()}] 👑 [AUTO-BOSS] playlist nativa iniciada (${bossState.list.length} chefes)`);
          } else {
            console.log(`[${new Date().toLocaleTimeString()}] ⚠️ [AUTO-BOSS] servidor não aceitou o início da playlist`);
          }
        }

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
              const observedScore = (protocolMapper.snapshot().scores as any)?.[hId] || {};
              let profilerReady = false;
              try { profilerReady = Boolean((profiler as any).visitReady?.()); } catch (_) {}
              const hasProfilerGold = (profiler as any).huntStartGold !== null && (profiler as any).huntStartGold !== undefined
                && (profiler as any).lastGold !== null && (profiler as any).lastGold !== undefined;
              const metricReady = profilerReady && hasProfilerGold;
              // A matriz só aprende com uma janela válida. Antes disso, o
              // score persistido de um processo anterior contaminava o gold/h
              // da hunt atual a cada tick.
              if (metricReady) {
                const matrixGold = Math.max(0, Number((profiler as any).sessGoldH) || 0);
                const matrixXp = observedScore.sampleReady === true
                  ? ((latestAnalyzers as any).xp_per_hour ?? observedScore.xpPerHour)
                  : 0;
                const matrixLoot = observedScore.sampleReady === true
                  ? ((latestAnalyzers as any).loot_per_hour ?? observedScore.lootGoldPerHour)
                  : 0;
                huntMatrix.recordTick(hId, hName, telemetry.level,
                  matrixGold, Number(b.kills_per_hour || observedScore.kills || 0),
                  Math.round((telemetry.waves / elapsedS) * 3600 * 10) / 10,
                  Number(b.deaths || 0), matrixXp, matrixLoot);
              }
            } catch (_) {}
          }
        } else if (isCity && (profiler as any).activeHuntId) {
          try { (profiler as any).recordDeath(telemetry.gold, telemetry.kills); } catch (_) {}
          console.log(`[${new Date().toLocaleTimeString()}] ⚠️ [BENCHMARK] Morte/templo confirmado. Retornando à última hunt.`);
        }

        // Decisão de Hunt manual. O profiler continua coletando telemetria,
        // mas nunca escolhe/retoma uma hunt sozinho.
        const forceId = manualHuntId || "";
        const liveId = !isCity ? ((profiler as any).activeHuntId || null) : null;
        const gameReady = watchdog.isConnected() || matchHunt(wave) !== null || telemetry.kills > 0;
        // Em alguns frames do VPS o overlay do treino some antes de a
        // telemetria atualizar `inTreino`. O nome da wave ainda é a fonte
        // correta nesse intervalo; não deixe esse frame bloquear a retomada.
        const trainingActive = telemetry.inTreino || looksLikeTreino(wave);
        let shouldEnter = false;
        let reason = forceId ? `FORCE_HUNT=${forceId}` : 'Escolha manual aguardando alvo';
        const stamTransition = evaluateStaminaTransition(telemetry.stamina, trainingActive, config.autoTreino);
        if (!gameReady) shouldEnter = false;
        if ((trainingActive && stamTransition.action !== "resume_hunt") || !config.autoHunt) shouldEnter = false;

        // FORCE_HUNT é ordem explícita do operador. Se forceId estiver definido,
        // ele tem prioridade sobre o treino para garantir que comandos manuais da Web sejam atendidos.
        let forceNeedsEntry = false;
        if (forceId) {
          const current = String(wave || '').toLowerCase().replace(/[-\s]/g, '');
          const target = String(forceId).toLowerCase().replace(/[-\s]/g, '');
          const currentHunt = matchHunt(wave) || matchHunt(telemetry.hunt);
          // Comparação EXATA: includes() confundia "dragon-lair" com
          // "undeadragon-lair"/"megadragon-cave" ("dragon" ⊂ "undeadragon").
          // matchHunt (longest-first) já resolve títulos com sufixo de wave.
          const atTarget = !isCity && !trainingActive && ((current && target && current === target) || currentHunt?.id === forceId);
          if (!atTarget || trainingActive) {
            shouldEnter = true;
            needsHuntEntry = true;
            forceNeedsEntry = true;
            reason = isCity ? `cidade/templo → FORCE_HUNT=${forceId}` : (trainingActive ? `treino → FORCE_HUNT=${forceId}` : `FORCE_HUNT=${forceId}`);
          }
        }
        if (forceId && now - lastForceDebug > 30000) {
          lastForceDebug = now;
          console.log(`[${new Date().toLocaleTimeString()}] [FORCE DEBUG] current=${wave} target=${forceId} gameReady=${gameReady} city=${isCity} treino=${trainingActive} enter=${shouldEnter} needs=${needsHuntEntry} queue=${actionQueue.pendingCount} currentAction=${actionQueue.currentAction || '-'}`);
        }

        // JEV: Recomendação Analítica de Hunt (Apenas Telemetria / Advisory)
        // Conforme especificado, hunt quem escolhe é o jogador. JEV apenas avalia e sugere.
        if (config.jevEnabled && (now - lastJevRecommendationTs >= 60000) && telemetry.level > 0) {
          lastJevRecommendationTs = now;
          const mapSnap = protocolMapper.snapshot();
          const currentMetrics = runtimeMetrics();
          const currentHId = currentMetrics.selectedHuntId
            || matchHunt(wave)?.id
            || matchHunt(telemetry.hunt)?.id
            || manualHuntId
            || 'glooth-cave';
          const profilerUnlocked = Array.isArray((profiler as any).unlockedIds)
            ? (profiler as any).unlockedIds : [];
          // A lista protocolar/DOM é a lista real liberada pela conta. Só usa
          // o catálogo inteiro quando nenhuma fonte do jogo respondeu ainda;
          // nesse caso as opções ficam sem evidência e não ganham por level.
          const rawUnlocked = mapSnap.unlockedHunts?.length
            ? mapSnap.unlockedHunts
            : (profilerUnlocked.length ? profilerUnlocked : HUNTS_TABLE);
          const unlockedList = rawUnlocked.map((item: any) => {
            if (typeof item === 'string') {
              const matched = matchHunt(item);
              return {
                id: matched?.id || item,
                name: matched?.name || item,
                minLevel: matched?.min || 1,
              };
            }
            const matched = matchHunt(item.id) || matchHunt(item.name);
            return {
              id: item.id || matched?.id || 'unknown',
              name: item.name || matched?.name || item.id,
              minLevel: item.minLevel ?? item.min ?? matched?.min ?? 1,
            };
          });
          const canonical = (value: any) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const previews = new Map<string, any>();
          for (const preview of Array.isArray(mapSnap.lastOfflineInfo?.previews) ? mapSnap.lastOfflineInfo.previews : []) {
            if (preview?.huntId) previews.set(canonical(preview.huntId), preview);
          }
          const candidates = unlockedList.map((hunt: any) => {
            const key = canonical(hunt.id);
            const preview = previews.get(key) || null;
            const score = (mapSnap.scores as any)?.[hunt.id]
              || Object.entries(mapSnap.scores || {}).find(([id]) => canonical(id) === key)?.[1]
              || {};
            const benchmark = ((profiler as any).benchmarks || {})[hunt.id]
              || Object.entries((profiler as any).benchmarks || {}).find(([id]) => canonical(id) === key)?.[1]
              || {};
            const matrix: any = (huntMatrix as any).matrix?.[hunt.id]
              || Object.entries((huntMatrix as any).matrix || {}).find(([id]) => canonical(id) === key)?.[1]
              || {};
            const matrixSamples = Number(matrix.samples || 0) || 0;
            const matrixDeaths = Number(matrix.deaths || 0) || 0;
            const matrixReliable = matrixSamples >= 30 && matrixDeaths <= 0;
            const scoreUsable = score.sampleReady === true || score.source === 'server-preview';
            const isCurrent = key === canonical(currentHId);
            const selected: any = isCurrent ? (currentMetrics.selectedHuntMetrics || {}) : {};
            const has = (obj: any, field: string) => obj && Object.prototype.hasOwnProperty.call(obj, field);
            const firstPresent = (...pairs: Array<[any, string]>) => {
              for (const [obj, field] of pairs) if (has(obj, field)) return Number(obj[field]) || 0;
              return 0;
            };
            const xp = firstPresent(
              [preview, 'xpPerHour'], ...(scoreUsable ? [[score, 'xpPerHour'] as [any, string]] : []),
              ...(matrixReliable ? [[matrix, 'avg_xp_h'] as [any, string]] : []),
              ...(isCurrent && selected.sample_ready === true ? [[selected, 'xp_per_hour'] as [any, string]] : []),
            );
            const loot = firstPresent(
              [preview, 'lootGoldPerHour'], ...(scoreUsable ? [[score, 'lootGoldPerHour'] as [any, string]] : []),
              ...(matrixReliable ? [[matrix, 'avg_loot_h'] as [any, string]] : []),
              ...(isCurrent && selected.sample_ready === true ? [[selected, 'loot_per_hour'] as [any, string]] : []),
            );
            const supply = firstPresent([preview, 'supplyGoldPerHour'], [score, 'supplyGoldPerHour']);
            const previewHasNet = has(preview, 'netGoldPerHour');
            const scoreHasNet = scoreUsable && has(score, 'netGoldPerHour');
            const net = previewHasNet ? Number(preview.netGoldPerHour) || 0
              : (scoreHasNet ? Number(score.netGoldPerHour) || 0
                : (isCurrent && selected.gold_sample_ready === true
                  ? Number(selected.gold_per_hour) || 0
                  : (matrixReliable && Number(matrix.avg_gold_h) > 0
                    ? Number(matrix.avg_gold_h) || 0
                    : (Number(benchmark.gold_per_hour) || 0))));
            const source = preview ? 'server-preview'
              : scoreUsable ? 'live-observed'
                : (matrixReliable ? 'matrix-observed'
                  : (isCurrent && selected.gold_sample_ready === true ? 'live-observed'
                    : (Number(benchmark.gold_per_hour) > 0 ? 'historical-observed' : 'unknown')));
            return {
              id: hunt.id,
              name: hunt.name,
              minLevel: hunt.minLevel,
              xpPerHour: xp,
              lootGoldPerHour: loot,
              supplyGoldPerHour: supply,
              netGoldPerHour: net,
              risk: preview?.risk || '',
              wipeMs: Number(preview?.msToWipe || score.wipeMs || 0) || 0,
              sampleReady: Boolean(preview || scoreUsable || matrixReliable || (isCurrent && (selected.sample_ready === true || selected.gold_sample_ready === true))),
              source,
            };
          });
          jev.evaluateHuntRecommendation({
            level: telemetry.level,
            vocation: (telemetry as any).vocation || 'Knight',
            currentHuntId: currentHId,
            unlockedHunts: unlockedList,
            recentDeaths: 0,
            candidates,
          }).then((rec) => {
            jevRecommendation = rec;
            if (rec?.recommendedHuntName) {
              console.log(`[${new Date().toLocaleTimeString()}] 🧠 [JEV ADVISORY] Sugestão analítica: ${rec.recommendedHuntName} (confiança: ${Math.round(rec.confidence * 100)}%) | [Operador no controle manual]`);
            }
          }).catch(() => null);
        }

        // Transição de Stamina e Treino
        // O tRPC pode entregar a stamina baixa antes de o WebSocket/teleporte
        // estar pronto. Não tente abrir o menu nesse intervalo: o botão de
        // Treino Online ainda não existe e a ação expira inutilmente.
        if (stamTransition.action === "enter_treino" && gameReady && (now - lastTreinoTime >= 8000)) {
          lastTreinoTime = now;
          subsystems.auto_treino = {
            status: "VERIFICANDO",
            detail: `Stamina <= 15% (${telemetry.stamina}) — aguardando confirmação do Treino Online`,
          };
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
                const trainingConfirmed = tr?.inTreino === true || tr?.action === "entrou_treino" || tr?.action === "ja_treino_tp" || tr?.action === "ja_treino";
                if (trainingConfirmed) {
                  telemetry.inTreino = true;
                  telemetry.updateHunt("Treino Online", "dom");
                  subsystems.auto_treino = { status: "TREINANDO", detail: "Stamina <= 15% — Treino online ativo" };
                } else if (!tr) {
                  console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ [TREINO] sem confirmação do Treino Online; a hunt permanecerá bloqueada e haverá nova tentativa`);
                } else {
                  console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ [TREINO] comando não confirmado: ${JSON.stringify(tr).slice(0, 500)}`);
                }
              } finally {
                await closeStuckModals();
              }
            }
          });
          if (!queuedHunt) console.log(`[${new Date().toLocaleTimeString()}] [HUNT] ação já estava na fila: ${forceId || 'resume'}`);
        } else if (stamTransition.action === "resume_hunt" && trainingActive) {
          lastTreinoTime = now;
          // Se a seleção manual ainda não foi persistida, retome a última
          // hunt realmente jogada pelo profiler, em vez de cair sempre em
          // Asura Lair.
          const resumeTargetId = forceId || matchHunt(telemetry.hunt)?.id || (profiler as any).lastPlayedId || "asura-lair";
          actionQueue.enqueue({
            id: "resume-treino",
            name: "treino",
            priority: 10,
            timeoutMs: 15000,
            run: async () => {
              try {
                console.log(`[${new Date().toLocaleTimeString()}] 🧘 [TREINO] Stamina recuperou (${telemetry.stamina}) — saindo do treino para ${resumeTargetId}...`);
                let entered = false;
                if (resumeTargetId) {
                  const sent = await sendStage(pageRef, resumeTargetId);
                  if (sent) {
                    console.log(`[${new Date().toLocaleTimeString()}] 🏹 [STAGE-RESUME] send("stage",{huntId:${resumeTargetId}}) aceito`);
                    entered = true;
                  }
                }
                if (!entered) {
                  const tr = await safeEval<any>(pageRef, "treino", { want: "resume" }, 10000);
                  if (tr?.events?.length) for (const ev of tr.events) console.log(`[${new Date().toLocaleTimeString()}] 🧘 [TREINO] ${ev}`);
                }
                telemetry.inTreino = false;
                needsHuntEntry = true;
                subsystems.auto_treino = { status: "FUNCIONAL", detail: "Stamina recuperou — retornando às hunts" };
              } finally {
                await closeStuckModals();
              }
            },
          });
        }

        // Fila de Ação: Seleção / Retorno de Hunt (Prioridade 10).
        if (pendingHuntChange) {
          activateManualHunt(pendingHuntChange);
          pendingHuntChange = null;
          writeStatusFile();
        }
        const huntActionPending = actionQueue.pendingByLane.hunt > 0;
        const waitingManualHunt = false;
        // Stamina baixa só bloqueia rotação automática, NUNCA a escolha direta do operador (forceNeedsEntry)
        const staminaBlocksHunt = !forceNeedsEntry && (telemetry.stamina === "—" || stamTransition.action === "enter_treino" || (trainingActive && stamTransition.action !== "resume_hunt"));
        if (forceId && (shouldEnter || needsHuntEntry || forceNeedsEntry) && !staminaBlocksHunt && !waitingManualHunt &&
            (!trainingActive || stamTransition.action === "resume_hunt" || forceNeedsEntry) &&
            !huntActionPending && (now - lastHuntAttempt >= huntRetryDelayMs)) {
          lastHuntAttempt = now;
          const queuedTargetId = forceId;
          const queuedRevision = huntSelectionRevision;
          actionQueue.enqueue({
            id: "hunt",
            name: "hunt",
            priority: 10,
            // sendStage + confirmação autoritativa + fallback do seletor DOM
            // podem atravessar 15s em renderer de VPS. Se a fila expirar
            // antes do fallback terminar, a Promise antiga continua viva e
            // uma nova tentativa pode disputar a mesma reserva de sala.
            timeoutMs: 30000,
            run: async () => {
              if (queuedRevision !== huntSelectionRevision || queuedTargetId !== manualHuntId) {
                console.log(`[${new Date().toLocaleTimeString()}] 🏹 [HUNT IGNORADA] alvo antigo ${queuedTargetId}`);
                return;
              }
              try { (profiler as any).markSwitch(); } catch (_) {}
              const target = (profiler as any).resumeTarget(queuedTargetId);
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
              if ((huntRes?.success || huntRes?.alreadyThere) && queuedRevision === huntSelectionRevision && queuedTargetId === manualHuntId) {
                needsHuntEntry = false;
                telemetry.inTreino = false;
                subsystems.auto_treino = { status: "FUNCIONAL", detail: "Caçando normalmente" };
                // O caminho room-send já foi confirmado por authoritativeHuntId;
                // não escreva o alvo localmente, pois isso mascararia uma troca
                // que o servidor ainda não aplicou.
                if (huntRes.method !== 'room-send') {
                  telemetry.updateHunt(huntRes.hunt || target.name || target.id, 'dom');
                }
                huntRetryDelayMs = 8000 + Math.random() * 6000;
              } else if (queuedRevision === huntSelectionRevision && queuedTargetId === manualHuntId) {
                huntRetryDelayMs = 14000 + Math.random() * 12000;
              }
            }
          });
        }

        const isKnownHunt = wave && wave !== "—" && wave !== "-" && wave !== "Conectando...";
        // FORCE_HUNT must be allowed to replace an already-known hunt. The
        // previous unconditional reset cancelled the decision immediately.
        const forceTarget = manualHuntId;
        const normalizedWave = String(wave || '').toLowerCase().replace(/[-\s]/g, '');
        const normalizedTarget = String(manualHuntId || '').toLowerCase().replace(/[-\s]/g, '');
        const currentHuntForCheck = matchHunt(wave) || matchHunt(telemetry.hunt);
        // EXATO: includes() marcava "já estou no alvo" errado para
        // pares como dragon-lair/undeadragon-lair. matchHunt cobre sufixos.
        const alreadyAtForcedHunt = !trainingActive && !isCity && !!forceTarget && (
          (currentHuntForCheck?.id === forceTarget) ||
          (normalizedWave && normalizedTarget && normalizedWave === normalizedTarget)
        );
        if (isKnownHunt && !isCity && !trainingActive && (!forceTarget || alreadyAtForcedHunt)) {
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
          } else if (now - lastProgressTime >= 150000 && telemetry.online && !pendingHuntChange) {
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
        const pouchFullSignal = now < pouchFullUntil;
        if (config.autoSell && (telemetry.bagSlots || pouchFullSignal)) {
          const m = telemetry.bagSlots.match(/(\d+)\s*\/\s*(\d+)/);
          if (m || pouchFullSignal) {
            const cur = m ? parseInt(m[1], 10) : 0;
            const max = m ? parseInt(m[2], 10) : 0;
            const pct = max > 0 ? (cur / max) * 100 : (pouchFullSignal ? 100 : 0);
            // 1) Varredura precoce: vende lixo individual (mantém épico+) a partir de 50%
            const lastSellSecAgo = Math.floor((now - lastSellTime) / 1000);
            let jevAgreedSell = pct >= 50;
            if (config.jevEnabled && max > 0 && pct >= 40) {
              jev.decideSellAndPouch({
                usedSlots: cur,
                maxSlots: max,
                thresholdPct: config.sellThresholdPct,
                lastSellSecAgo,
              }).then((dec) => {
                if (dec && dec.shouldSell) jevAgreedSell = true;
              }).catch(() => null);
            }

            const sellCooldownReady = (now - lastSellTime) >= 60000;
            const emergencySell = ((max > 0 && pct >= config.sellThresholdPct) || pouchFullSignal) && sellAllowed;
            const earlySell = !emergencySell && ((max > 0 && (pct >= 50 || jevAgreedSell)) || (pouchFullSignal && sellCooldownReady));
            if (earlySell) {
              actionQueue.enqueue({
                id: "lootfilter",
                name: "lootfilter",
                priority: 6,
                timeoutMs: 25000,
                run: async () => {
                  try {
                    // A movimentação por shift-clique/DOM não é a operação de
                    // venda da build atual. Use o mesmo frame que o botão
                    // oficial usa; o servidor decide o que é protegido.
                    const accepted = await nativeSellPouch("pouch>=50%");
                    if (!accepted) {
                      // Fallback compatível com builds antigas sem hook de
                      // socket. Ele nunca força confirmação de compra.
                      const mv = await safeEval<any>(pageRef, "extra", { job: "market" }, 8000).catch(() => null);
                      const lf = await safeEval<any>(pageRef, "extra", { job: "lootfilter" }, 20000).catch(() => null);
                      if (lf?.sold > 0 || (mv as any)?.action) {
                        console.log(`[${new Date().toLocaleTimeString()}] 🗑️ [LOOTFILTER-FALLBACK] vendeu=${lf?.sold ?? 0} manteve=${lf?.kept ?? 0} pouch=${telemetry.bagSlots} ${JSON.stringify((lf?.events || []).slice(0, 3))}`);
                        lastSellTime = Date.now();
                      } else {
                        console.log(`[${new Date().toLocaleTimeString()}] ⚠️ [AUTO-SELL] socket sem confirmação; fallback não vendeu (pouch=${telemetry.bagSlots})`);
                      }
                    }
                  } finally {
                    await closeStuckModals();
                  }
                }
              });
            }
            // 2) Sell-all de emergência no limiar configurado (após proteger épicos)
            if (emergencySell) {
              actionQueue.enqueue({
                id: "autosell",
                name: "autosell",
                priority: 5,
                timeoutMs: 20000,
                run: async () => {
                  try {
                    const accepted = await nativeSellPouch(`pouch>=${config.sellThresholdPct}%`);
                    if (!accepted) {
                      // O botão visível é apenas o fallback de uma build sem
                      // socket capturado; não o use como caminho principal.
                      await safeEval<any>(pageRef, "extra", { job: "market" }, 8000).catch(() => null);
                      await pageRef.evaluate(() => {
                        const sellBtn = document.getElementById("sell-all") as HTMLButtonElement | null;
                        if (sellBtn && !sellBtn.classList.contains("cd") && !sellBtn.disabled) sellBtn.click();
                      }).catch(() => null);
                      lastSellTime = Date.now();
                      console.log(`[${new Date().toLocaleTimeString()}] ⚠️ [AUTO-SELL-FALLBACK] clique DOM (Pouch: ${telemetry.bagSlots})`);
                    }
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
        const currentHuntTarget = authoritativeHuntId || manualHuntId || telemetry.hunt;
        const normTarget = matchHunt(currentHuntTarget)?.id || currentHuntTarget || '';
        if (normTarget && normTarget !== 'Conectando...' && normTarget !== '—' && normTarget !== lastSpellSyncHunt) {
          needsSpellSync = true;
          lastSpellSyncHunt = normTarget;
        }
        const optimal = getOptimalSpellRotation(currentHuntTarget);

        // JEV: Decisão de elemento e estilo de rotação por IA System One
        if (config.jevEnabled && (now - lastJevBuildTs >= 30000) && telemetry.level > 0) {
          lastJevBuildTs = now;
          jev.decideBuildAndSpells({
            vocation: (telemetry as any).vocation || 'Knight',
            level: telemetry.level,
            huntId: String(currentHuntTarget || ''),
            huntName: matchHunt(currentHuntTarget)?.name,
            weaknesses: optimal.weaknesses,
            resistances: optimal.resistances,
            availableElements: ['physical', 'fire', 'ice', 'earth', 'energy', 'holy', 'death'],
          }).then((decision) => {
            if (decision?.primaryElement) {
              (magicState as any).recommended_element = decision.primaryElement;
              (magicState as any).rotation_style = decision.rotationStyle;
              (magicState as any).jev_source = decision.source;
            }
          }).catch(() => null);
        } else if (!(magicState as any).recommended_element) {
          (magicState as any).recommended_element = optimal.preferredElement;
        }

        (magicState as any).hunt_weaknesses = optimal.weaknesses;
        (magicState as any).hunt_resistances = optimal.resistances;
        const spellArgs = {
          metaAoe: optimal.metaAoe,
          metaStrike: optimal.metaStrike,
          healWords: optimal.healWords,
          manaWords: optimal.manaWords,
        };
        const applyHelperSnap = (res: any) => {
          for (const row of (Array.isArray(res?.helpers) ? res.helpers : [])) {
            if (row && row.slot !== undefined && row.slot !== null) {
              const sid = Number(row.slot);
              helperBySlot[sid] = { ...(helperBySlot[sid] || {}), ...row };
            }
          }
          const snap = res?.helper;
          if (snap && typeof snap === "object" && snap.slot !== undefined && snap.slot !== null) {
            const sid = Number(snap.slot);
            helperBySlot[sid] = { ...(helperBySlot[sid] || {}), ...snap };
          }
          if (lastSpellList.length > 0 && (res?.helpers || res?.helper)) {
            magicState = classifyMagicPreservingFacts(lastSpellList, Object.keys(helperBySlot).sort().map((k) => helperBySlot[Number(k)]));
          }
        };

        // Fila de Ação: Sincronização Elemental de Magias conforme a Hunt
        if (needsSpellSync && domAutomationReady && !telemetry.inTreino && !pickerOpen && !pickerOpenEv &&
            actionQueue.pendingByLane.gear === 0 && now - lastSpellSyncAttempt >= 8000) {
          lastSpellSyncAttempt = now;
          actionQueue.enqueue({
            id: "spell_element_sync",
            name: "spell",
            priority: 4,
            timeoutMs: 30000,
            run: async () => {
              try {
                console.log(`[${new Date().toLocaleTimeString()}] 🔮 [SPELL SYNC] Sincronizando magias para elemento ${optimal.preferredElement.toUpperCase()} (Hunt: ${currentHuntTarget})`);
                const partySlots = [0, 1, 2];
                let anyChanged = false;
                for (const sid of partySlots) {
                  const res = await safeEval<any>(pageRef, "spell", {
                    metaAoe: optimal.metaAoe,
                    metaStrike: optimal.metaStrike,
                    weaknesses: optimal.weaknesses,
                    resistances: optimal.resistances,
                    preferredElement: optimal.preferredElement,
                    job: "sync-element",
                    slot: sid,
                  }, 15000);
                  if (res?.changed > 0) anyChanged = true;
                  if (res?.events?.length) {
                    console.log(`[${new Date().toLocaleTimeString()}] 🔮 [SPELL SYNC slot${sid}] ${JSON.stringify(res.events)}`);
                  }
                  if (Array.isArray(res?.spells) && res.spells.length > 0) {
                    magicState = classifyMagicPreservingFacts(res.spells, Object.keys(helperBySlot).sort().map((k) => helperBySlot[Number(k)]));
                  }
                  await new Promise(r => setTimeout(r, 200));
                }
                needsSpellSync = false;
                console.log(`[${new Date().toLocaleTimeString()}] 🔮 [SPELL SYNC] Concluído. Alterações realizadas: ${anyChanged ? 'sim' : 'nenhuma necessária'}`);
              } finally {
                lastSpellGear = Date.now();
                await closeStuckModals();
              }
            }
          });
        }
        // O jogo só cria os elementos rot-* enquanto a janela de rotação está
        // aberta. A sonda independente também roda quando a fila de ações está
        // ocupada, evitando que equip/potion impeçam a leitura da magia.
        if (magicState.power <= 0 && !pickerOpen && now - lastSpellGear >= 30000) {
          lastSpellGear = now;
          void probeSpellSlots();
        } else if ((pickerOpen || pickerOpenEv) &&
          // Helper/party incompleto tem prioridade; um picker cacheado não
          // pode impedir a configuração dos três personagens.
          !(magicState.power > 0 && magicState.party_ready !== true) &&
          (pickerKind === "spell" || pickerKind === "heal" || pickerKind === "mana" || pickerKind === "hp" || pickerOpenEv) &&
          now - lastSpellGear >= 15000) {
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
        } else if (magicState.power > 0 &&
          (magicState.party_ready !== true || (telemetry as any).helperTriggerState?.run) &&
          now - lastSpellGear >= 180000) {
          lastSpellGear = now;
          lastHelperTrigger = now;
          actionQueue.enqueue({
            id: "spell_party",
            name: "spell",
            priority: 2,
            timeoutMs: 20000,
            run: async () => {
              try {
                let slots = magicState.slots || {};
                let present = Object.keys(slots).filter((k) => /^\d+$/.test(k)).map(Number);
                if (!present.length) present = [0, 1];
                const helperMissing = present.some((sid) => {
                  if (sid > 2) return false;
                  const kit = slots[String(sid)] || {};
                  return !kit.heal || !kit.mana;
                });
                if (helperMissing) {
                  const helperRes = await safeEval<any>(pageRef, "potion", {
                    autoHeal: config.autoHeal,
                    healBelowPct: config.healBelowPct,
                    hpPotionBelowPct: config.hpPotionBelowPct,
                    manaPotionBelowPct: config.manaPotionBelowPct,
                  }, 12000);
                  applyHelperSnap(helperRes);
                  if (helperRes?.events?.length) console.log(`[${new Date().toLocaleTimeString()}] 🧪 [SPELL PARTY] ${JSON.stringify(helperRes.events)}`);
                  slots = magicState.slots || slots;
                }
                for (const sid of present) {
                  if (sid > 2) continue;
                  const last = spellSlotCooldown.get(sid) || 0;
                  if (now - last < 600000) continue;
                  const kit = slots[String(sid)] || {};
                  if (kit.ready || (kit.empty || 0) <= 0) continue;
                  const spellRes = await safeEval<any>(pageRef, "spell", { ...spellArgs, need: "aoe", job: "fill", slot: sid }, 12000);
                  lastGearSlot = sid;
                  applyHelperSnap(spellRes);
                  if (spellRes && (spellRes.ok || spellRes.events)) {
                    const configured = spellRes.ok && !["open-rot", "picker-not-open", "no-use"].includes(String(spellRes.method || spellRes.reason || ""));
                    if (configured) spellSlotCooldown.set(sid, Date.now());
                    console.log(`[${new Date().toLocaleTimeString()}] 🔮 [GEAR slot${sid}] ${JSON.stringify(spellRes.events || spellRes)}`);
                    if (configured) break;
                  }
                }
              } finally {
                lastSpellGear = Date.now();
                await closeStuckModals();
              }
            }
          });
        }

        // Fila de Ação: Auto-Potion (Prioridade 2)
        if (config.autoHeal && domAutomationReady && !telemetry.inTreino && !lastPickerOpen && (now - lastPotionCheck >= 240000 || needPotionCheck)) {
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
                lastPotionCheck = Date.now();
                await closeStuckModals();
              }
            }
          });
        }

        // Fila de Ação: Auto-Equip (Prioridade 1)
        if (config.autoEquip && domAutomationReady && !telemetry.inTreino && !lastPickerOpen && (now - lastEquipCheck >= 75000)) {
          lastEquipCheck = now;
          actionQueue.enqueue({
            id: "equip",
            name: "equip",
            priority: 1,
            timeoutMs: 20000,
            run: async () => {
              try {
                const combatElements = Object.entries(protocolMapper.snapshot().combat?.byElement || {})
                  .filter(([el, row]: any) => el !== 'unknown' && Number(row?.damage || 0) > 0)
                  .sort((a: any, b: any) => Number(b[1]?.damage || 0) - Number(a[1]?.damage || 0));
                const observedElement = String((magicState as any).observed_element || combatElements[0]?.[0] || '').toLowerCase();
                const eqRes = await safeEval<any>(pageRef, "equip", {
                  preferredElement: observedElement,
                  preferredProtection: observedElement,
                }, 16000);
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
                lastEquipCheck = Date.now();
                await closeStuckModals();
              }
            }
          });
        }

        // Fila de Ação: Extras (Prioridade 2)
        if (domAutomationReady && now - lastTreinoCheck >= 20000) {
          lastTreinoCheck = now;
          actionQueue.enqueue({
            id: "extras",
            name: "extras",
            priority: 2,
            timeoutMs: 50000,
            run: async () => {
              try {
                const extraLogs = await extrasScheduler.tick(
                  pageRef,
                  config,
                  Date.now(),
                  telemetry.inTreino,
                  jev,
                  telemetry.gold,
                  telemetry.coins
                );
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
        const skillStr = telemetry.skillsSummary ? ` | Skills: ${telemetry.skillsSummary}` : (telemetry.magicLevel ? ` | ML: ${telemetry.magicLevel}` : "");
        const coinStr = ` | Coins: ${telemetry.coins || 0}` + (telemetry.marketCoins ? ` (+${telemetry.marketCoins} mkt)` : "");
        console.log(
          `[${new Date().toLocaleTimeString()}] 📊 [METRICAS REAIS] Waves: ${telemetry.waves} (${wavesH}/h) | Kills: ${telemetry.kills} (${killsH}/h)` +
          (curGoldH ? ` | Gold/h: ${curGoldH.toLocaleString()}` : "") +
          (telemetry.level ? ` | Lvl: ${telemetry.level}` : "") +
          (telemetry.gold ? ` | Gold: ${Number(telemetry.gold).toLocaleString()}` : "") +
          coinStr +
          skillStr +
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
