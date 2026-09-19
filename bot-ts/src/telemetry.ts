/**
 * Telemetria Resiliente com Rastreamento de Procedência e Proteção contra Regressão.
 * 
 * Regra de Ouro: Um valor válido NUNCA pode ser sobrescrito por sentinelas vazios
 * ('—', 0, 50, 'Conectando...', null, undefined).
 */

export type TelemetrySource = 'websocket' | 'battery-save' | 'dom' | 'fallback';

export interface TelemetryField<T> {
  value: T;
  source: TelemetrySource;
  updatedAt: number;
}

export interface ShooterInfo {
  slot: number;
  text: string;
  classes?: string;
  name?: string;
  hp?: string;
  /** HP atual (0..maxHp) quando o payload/hook expõe número. */
  hpCur?: number | null;
  /** HP máximo quando exposto. */
  hpMax?: number | null;
  /** % HP 0..100 quando calculável. */
  hpPct?: number | null;
  manaCur?: number | null;
  manaMax?: number | null;
  manaPct?: number | null;
  alive?: boolean | null;
  level?: number;
  vocation?: string;
}

/** Nível máximo real do jogo (tabela vai a 800; placeholders acima são lixo). */
export const MAX_GAME_LEVEL = 800;

/**
 * Converte qualquer representação de gold do HUD em número inteiro.
 * Suporta: "1.234", "1,234", "1.234.567", "1.5k", "2,5kk", "1.2m",
 * "850k", "12kk", "3 mil", "1.5 milhão", data-gold numérico, etc.
 * Retorna null quando não há valor legível (nunca 0 por fallback).
 */
export function parseGoldAmount(val: unknown): number | null {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val < 0) return null;
    return Math.floor(val);
  }
  const s = String(val ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // data-gold puro ou número simples já resolve
  const m = s.match(/([\d.,]+)\s*(kk|milh(?:ões|oes|ao)?|mi\b|m\b|mil\b|k\b)?/i);
  if (!m) return null;
  const raw = m[1];
  const unit = (m[2] || '').toLowerCase();
  let num: number;
  const hasDot = raw.includes('.');
  const hasComma = raw.includes(',');
  const parseDecimalBR = (r: string): number => {
    // pt-BR: "1.234.567" (milhar) vs "1,5" (decimal) vs "1.5" (k-decimal "1.5k")
    if (hasDot && hasComma) return parseFloat(r.replace(/\./g, '').replace(',', '.'));
    if (hasComma && !hasDot) {
      // "2,5" com sufixo k/kk/m é decimal; sem sufixo pode ser milhar curto — trata como decimal
      return parseFloat(r.replace(',', '.'));
    }
    if (hasDot && !hasComma) {
      // Com sufixo (1.5k) o ponto é decimal; sem sufixo é separador de milhar
      if (unit) return parseFloat(r);
      return parseInt(r.replace(/\./g, ''), 10);
    }
    return parseInt(r, 10);
  };
  num = parseDecimalBR(raw);
  if (!Number.isFinite(num)) return null;
  if (unit === 'kk' || unit === 'm' || unit.startsWith('milh') || unit === 'mi') num *= 1_000_000;
  else if (unit === 'k' || unit === 'mil') num *= 1000;
  return Math.round(num);
}

/** Minutos máximos de stamina: 42h = 2520 min. */
export const STAMINA_MAX_MINUTES = 2520;

/**
 * Normaliza qualquer representação de stamina para o canônico "H:MM" ou "NN%".
 * Aceita: "41:15", "6:18", "41:15:00", "38h 15m", "38h15", "12h", "45m",
 * "2520 min", "85%", "0.85" (fração), "2520" (minutos).
 * Retorna null para placeholder "42:00" não confirmado e para sentinelas.
 */
export function normalizeStamina(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (val <= 1.05 && val > 0) {
      // fração 0..1 → minutos
      const mins = Math.floor(val * STAMINA_MAX_MINUTES);
      return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
    }
    if (val > 1 && val <= STAMINA_MAX_MINUTES) {
      const mins = Math.floor(val);
      return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
    }
    return null;
  }
  const s = String(val).trim();
  if (!s || s === '—' || s === '–' || s === '-' || /desconhecido|undefined/i.test(s)) return null;

  // Percentual tem prioridade (mais preciso que relógio arredondado)
  let mPct = s.match(/(\d{1,3})\s*%/);
  if (mPct) {
    const p = Math.max(0, Math.min(100, parseInt(mPct[1], 10)));
    return `${p}%`;
  }
  // HH:MM:SS → pega HH:MM
  let mClock = s.match(/(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*\d{2})?/);
  if (mClock) {
    const h = parseInt(mClock[1], 10);
    const mi = parseInt(mClock[2], 10);
    if (mi > 59 || h > 42) {
      // pode ser "2520 min" colado ou ruído — continua tentando outros formatos
    } else {
      if (h === 42 && mi === 0) return null; // placeholder pré-sync do HUD
      return `${h}:${String(mi).padStart(2, '0')}`;
    }
  }
  // "38h 15m" / "38h15" / "12h" / "45m" / "2520 min"
  const mH = s.match(/(\d{1,2})\s*h(?:oras?|rs?)?/i);
  const mM = s.match(/(\d{1,3})\s*m(?:in(?:utos?)?)?\b/i);
  if (mH || mM) {
    const h = mH ? parseInt(mH[1], 10) : 0;
    const mi = mM ? parseInt(mM[1], 10) : 0;
    if (h === 42 && mi === 0) return null;
    if (h <= 42 && mi <= 59) return `${h}:${String(mi).padStart(2, '0')}`;
  }
  // Número puro de minutos ("2520", "378")
  const mMin = s.match(/^(\d{2,4})\s*(?:min)?$/i);
  if (mMin) {
    const mins = parseInt(mMin[1], 10);
    if (mins >= 0 && mins <= STAMINA_MAX_MINUTES) {
      if (mins === STAMINA_MAX_MINUTES) return null; // 2520 == 42:00 placeholder
      return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
    }
  }
  if (/^(0|empty|vazia)$/i.test(s)) return '0:00';
  return null;
}

/** Busca recursiva (até 4 níveis) pela primeira chave encontrada. */
function digDeep(root: any, keys: string[], depth = 0, seen = new Set<any>()): any {
  if (root === null || root === undefined) return null;
  if (depth > 4 || typeof root !== 'object' || seen.has(root)) return null;
  seen.add(root);
  if (Array.isArray(root)) {
    for (const item of root.slice(0, 30)) {
      const got = digDeep(item, keys, depth + 1, seen);
      if (got !== null && got !== undefined) return got;
    }
    return null;
  }
  for (const k of keys) {
    if (root[k] !== undefined && root[k] !== null) return root[k];
  }
  // ninhos comuns primeiro
  for (const nest of ['player', 'account', 'me', 'leader', 'char', 'character', 'wallet', 'data', 'state']) {
    if (root[nest] && typeof root[nest] === 'object') {
      const got = digDeep(root[nest], keys, depth + 1, seen);
      if (got !== null && got !== undefined) return got;
    }
  }
  // party: usa o maior nível / soma? para gold pega o primeiro válido
  for (const arr of ['party', 'players', 'chars', 'members']) {
    if (Array.isArray(root[arr])) {
      for (const item of root[arr].slice(0, 12)) {
        const got = digDeep(item, keys, depth + 1, seen);
        if (got !== null && got !== undefined) {
          if (keys.includes('level')) {
            // para level continua procurando o máximo
            continue;
          }
          return got;
        }
      }
      if (keys.includes('level') && Array.isArray(root[arr])) {
        const lvls = root[arr].map((p: any) => Number(p?.level ?? p?.lvl ?? 0)).filter((n: number) => n > 0);
        if (lvls.length) return Math.max(...lvls);
      }
    }
  }
  for (const v of Object.values(root).slice(0, 60)) {
    if (v && typeof v === 'object') {
      const got = digDeep(v, keys, depth + 1, seen);
      if (got !== null && got !== undefined) return got;
    }
  }
  return null;
}

/** Converte stamina canônica ("H:MM" / "NN%") em minutos. */
export function staminaStringToMinutes(st: string): number | null {
  const mClock = st.match(/^(\d{1,2}):(\d{2})$/);
  if (mClock) return parseInt(mClock[1], 10) * 60 + parseInt(mClock[2], 10);
  const mPct = st.match(/^(\d{1,3})\s*%$/);
  if (mPct) return Math.floor((parseInt(mPct[1], 10) / 100) * STAMINA_MAX_MINUTES);
  return null;
}

export class TelemetryStore {
  private _hunt: TelemetryField<string> = { value: 'Conectando...', source: 'fallback', updatedAt: Date.now() };
  private _level: TelemetryField<number> = { value: 0, source: 'fallback', updatedAt: Date.now() };
  private _gold: TelemetryField<number> = { value: 0, source: 'fallback', updatedAt: Date.now() };
  private _stamina: TelemetryField<string> = { value: '—', source: 'fallback', updatedAt: Date.now() };
  private _loopMode: TelemetryField<boolean> = { value: true, source: 'fallback', updatedAt: Date.now() };
  private _bagSlots: TelemetryField<string> = { value: '', source: 'fallback', updatedAt: Date.now() };
  private _partySlots: TelemetryField<number> = { value: 1, source: 'fallback', updatedAt: Date.now() };
  private _shooters: TelemetryField<ShooterInfo[]> = { value: [], source: 'fallback', updatedAt: Date.now() };
  private _magic: TelemetryField<{ power: number; aoe: number; party_ready: boolean }> = {
    value: { power: 0, aoe: 0, party_ready: false },
    source: 'fallback',
    updatedAt: Date.now(),
  };

  public kills: number = 0;
  public waves: number = 0;
  public inTreino: boolean = false;
  public online = false;

  get hunt(): string { return this._hunt.value; }
  get level(): number { return this._level.value; }
  get gold(): number { return this._gold.value; }
  get stamina(): string { return this._stamina.value; }
  get loopMode(): boolean { return this._loopMode.value; }
  get bagSlots(): string { return this._bagSlots.value; }
  get partySlots(): number { return this._partySlots.value; }
  get shooters(): ShooterInfo[] { return this._shooters.value; }
  get magic() { return this._magic.value; }

  setOnline(value: boolean): void {
    this.online = value;
  }

  getSources(): Record<string, TelemetrySource> {
    return {
      hunt: this._hunt.source,
      level: this._level.source,
      gold: this._gold.source,
      stamina: this._stamina.source,
      loopMode: this._loopMode.source,
      bagSlots: this._bagSlots.source,
      partySlots: this._partySlots.source,
      shooters: this._shooters.source,
      magic: this._magic.source,
    };
  }

  updateHunt(val?: string | null, source: TelemetrySource = 'dom'): boolean {
    if (!val) return false;
    const clean = val.trim();
    if (!clean || clean === '—' || clean === '-') return false;
    // Não substitui hunt válida por "Conectando..."
    if (clean.toLowerCase().includes('conectando') && this._hunt.value !== 'Conectando...' && this._hunt.value !== '—') {
      return false;
    }
    this._hunt = { value: clean, source, updatedAt: Date.now() };
    return true;
  }

  updateLevel(val?: number | null, source: TelemetrySource = 'dom'): boolean {
    if (val === undefined || val === null || isNaN(val)) return false;
    const num = Math.floor(val);
    if (num <= 0 || num > MAX_GAME_LEVEL) return false;
    // Se o bot já conhece um nível alto (ex: 305), ignora sentinela de nível 50 padrão do DOM
    if (num === 50 && this._level.value > 50) return false;
    // O nível de um jogador nunca diminui
    if (num < this._level.value) return false;
    this._level = { value: num, source, updatedAt: Date.now() };
    return true;
  }

  updateGold(val?: number | string | null, source: TelemetrySource = 'dom'): boolean {
    if (val === undefined || val === null) return false;
    if (typeof val === 'string' && !val.trim()) return false;
    const g = typeof val === 'number' ? (Number.isFinite(val) ? Math.floor(val) : NaN) : parseGoldAmount(val);
    if (g === null || g === undefined || isNaN(g as number) || (g as number) < 0) return false;
    const n = g as number;
    // Leitura em branco/malformada nunca zera saldo conhecido.
    // Gold real 0 só é aceito quando nunca houve saldo (conta nova).
    if (n === 0 && this._gold.value > 0) return false;
    this._gold = { value: n, source, updatedAt: Date.now() };
    return true;
  }

  updateStamina(val?: string | number | null, source: TelemetrySource = 'dom'): boolean {
    const norm = normalizeStamina(val);
    if (!norm) return false;
    this._stamina = { value: norm, source, updatedAt: Date.now() };
    return true;
  }

  updateLoopMode(val?: boolean | null, source: TelemetrySource = 'dom'): void {
    if (typeof val === 'boolean') {
      this._loopMode = { value: val, source, updatedAt: Date.now() };
    }
  }

  updateBagSlots(val?: string | null, source: TelemetrySource = 'dom'): void {
    if (val && val.trim()) {
      this._bagSlots = { value: val.trim(), source, updatedAt: Date.now() };
    }
  }

  updateParty(shooters: ShooterInfo[], source: TelemetrySource = 'dom'): void {
    if (shooters && shooters.length > 0) {
      this._shooters = { value: shooters, source, updatedAt: Date.now() };
      this._partySlots = { value: Math.max(this._partySlots.value, shooters.length), source, updatedAt: Date.now() };
    }
  }

  updateMagic(magic: { power: number; aoe: number; party_ready: boolean }, source: TelemetrySource = 'dom'): void {
    if (magic) {
      this._magic = { value: magic, source, updatedAt: Date.now() };
    }
  }

  /**
   * Ingestão direta de pacotes WebSocket (paridade com bot.py).
   * Cobre o fluxo queue -> hunt (pos/go/joined/toHunt/resume/reconnectOk),
   * cidade/takeover/serverdrop, mortes, gates/eventos e party HP/MP por slot.
   */
  public queueFlow: { pos: any; admitToken: string | null; lastGoAt: number } = {
    pos: null, admitToken: null, lastGoAt: 0,
  };
  public roomPlayers: Array<{
    slot: number; name?: string | null; level?: number | null; vocation?: string | null;
    hp?: number | null; hpMax?: number | null; hpPct?: number | null;
    mana?: number | null; manaMax?: number | null; manaPct?: number | null;
    alive?: boolean | null; dead?: boolean | null;
  }> = [];
  public lastDeaths: any = [];
  public lastToCityAt = 0;
  public lastRoomStateAt = 0;

  ingestWebSocketFrame(typ: string, pay: any): void {
    // Fluxo de fila e eventos escalares (string/número) — sem objeto.
    if (typ === 'pos') {
      this.queueFlow.pos = (pay && typeof pay === 'object' && pay.position !== undefined) ? pay.position : pay;
    } else if (typ === 'go') {
      const tok = pay && typeof pay === 'object' ? (pay.token || pay.admitToken || null) : null;
      if (tok) { this.queueFlow.admitToken = String(tok); this.queueFlow.lastGoAt = Date.now(); }
    } else if (typ === 'joined') {
      if (pay && typeof pay === 'object' && typeof pay.huntId === 'string') this.updateHunt(pay.huntId, 'websocket');
    } else if (typ === 'toHunt' || typ === 'resume') {
      if (typeof pay === 'string') this.updateHunt(pay, 'websocket');
      else if (pay && typeof pay === 'object' && typeof pay.huntId === 'string') this.updateHunt(pay.huntId, 'websocket');
    } else if (typ === 'toCity') {
      this.lastToCityAt = Date.now();
    } else if (typ === 'deaths') {
      this.lastDeaths = (pay && (pay.rows || pay)) || [];
    }
    if (!pay || typeof pay !== 'object') return;

    if (typ === 'combatlog') {
      if (Array.isArray(pay)) {
        const newKills = pay.filter((e: any) => e && e.killed).length;
        this.kills += newKills;
      } else if (pay.killed) {
        this.kills += 1;
      }
      // combatlog também pode carregar loot/gold — cai para a digestão genérica abaixo
    } else if (typ === 'log' || typ === 'notify') {
      this.waves += 1;
      // log/notify também pode carregar hunt/gold — cai para a digestão genérica abaixo
    }
    // Party autoritativa: players[] com hp/maxHp/mana/level/vocation/slot.
    // É o que calibra wipeMs/dano recebido — nunca CSS width%.
    if (typ === 'party' || typ === 'partystate' || typ === 'partyApplied' || typ === 'partyhunt' || typ === 'joined') {
      const list = Array.isArray(pay)
        ? pay
        : Array.isArray((pay as any)?.players) ? (pay as any).players
        : Array.isArray((pay as any)?.members) ? (pay as any).members
        : Array.isArray((pay as any)?.party) ? (pay as any).party
        : null;
      if (list) this.ingestRoomPlayers(list);
    }
    // Digestão genérica: hunt/gold/level/stamina em QUALQUER tipo de frame objeto
    // (joined, room, hunt, stage, update, patch, state, ...). Sem isso a hunt
    // pisca no DOM e o bot perde o fio da meada.
    {
      // ignora tipos puramente de dano sem identidade (evita level 0 fantasma)
      // mas ainda extrai hunt/gold quando presentes
      // Level — varre player/account/me/leader/char + party
      const dugLevel = digDeep(pay, ['level', 'lvl', 'charLevel', 'characterLevel']);
      if (typeof dugLevel === 'number') this.updateLevel(dugLevel, 'websocket');
      else if (typeof dugLevel === 'string' && /^\d+$/.test(dugLevel.trim())) {
        this.updateLevel(parseInt(dugLevel.trim(), 10), 'websocket');
      }

      // Gold — varre wallet/balance/coins/money em qualquer ninho
      const g = digDeep(pay, ['gold', 'coins', 'wallet', 'balance', 'money', 'goldAmount', 'totalGold', 'coinBalance']);
      if (typeof g === 'number' || typeof g === 'string') this.updateGold(g as any, 'websocket');

      // Stamina — aceita número (fração 0..1 ou minutos), string ou objeto {minutes, pct}
      const sVal = digDeep(pay, ['stamina', 'staminaMinutes', 'staminaPct', 'staminaPercent', 'energy']);
      if (sVal !== null && sVal !== undefined) {
        if (typeof sVal === 'object') {
          const mins = (sVal as any).minutes ?? (sVal as any).mins ?? (sVal as any).value;
          const pct = (sVal as any).pct ?? (sVal as any).percent;
          if (pct !== undefined) this.updateStamina(`${pct}%`, 'websocket');
          else if (mins !== undefined) this.updateStamina(mins as any, 'websocket');
        } else {
          this.updateStamina(sVal as any, 'websocket');
        }
      }

      // Hunt — aceita string ou {id, name}
      const h = digDeep(pay, ['hunt', 'currentHunt', 'huntId', 'stage', 'currentStage', 'location']);
      if (typeof h === 'string') this.updateHunt(h, 'websocket');
      else if (h && typeof h === 'object') {
        const hn = (h as any).name ?? (h as any).id;
        if (typeof hn === 'string') this.updateHunt(hn, 'websocket');
      }
    }
  }

  /**
   * Ingere players[] autoritativos (ROOM_STATE via NWe/party/partystate).
   * Campos: slot, name, level/lvl, vocation/voc, hp/maxHp, mana/maxMana,
   * alive/dead. Também atualiza shooters/HP% para o heal por número real.
   */
  ingestRoomPlayers(list: any[]): void {
    if (!Array.isArray(list) || list.length === 0) return;
    const num = (v: any): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v.trim())) return Number(v);
      return null;
    };
    const out = list.slice(0, 12).map((p: any, i: number) => {
      if (!p || typeof p !== 'object') return null;
      const hp = num(p.hp ?? p.health ?? p.currentHp ?? p.hitpoints);
      const hpMax = num(p.hpMax ?? p.maxHp ?? p.maxHealth ?? p.maxHP);
      const mana = num(p.mana ?? p.mp ?? p.currentMana);
      const manaMax = num(p.manaMax ?? p.maxMana ?? p.maxMP);
      const level = num(p.level ?? p.lvl);
      const slot = num(p.slot ?? p.index ?? p.position) ?? i;
      const alive = p.alive !== undefined ? p.alive !== false : p.dead !== undefined ? p.dead !== true : null;
      return {
        slot,
        name: typeof p.name === 'string' ? p.name : (typeof p.charName === 'string' ? p.charName : null),
        level: level !== null && level > 0 && level <= MAX_GAME_LEVEL ? Math.floor(level) : null,
        vocation: typeof (p.vocation ?? p.voc) === 'string' ? (p.vocation ?? p.voc) : null,
        hp, hpMax,
        hpPct: hp !== null && hpMax !== null && hpMax > 0 ? Math.round((hp / hpMax) * 1000) / 10 : null,
        mana, manaMax,
        manaPct: mana !== null && manaMax !== null && manaMax > 0 ? Math.round((mana / manaMax) * 100) / 1 : null,
        alive, dead: p.dead === true ? true : alive === false ? true : false,
      };
    }).filter(Boolean) as TelemetryStore['roomPlayers'];
    if (out.length > 0) {
      this.roomPlayers = out;
      // Nível: usa o maior válido (nunca placeholder).
      const lvls = out.map((p) => p.level || 0).filter((n) => n > 0);
      if (lvls.length > 0) this.updateLevel(Math.max(...lvls), 'websocket');
      // Espelha nos shooters para o status.json e o heal por número.
      const shooters: ShooterInfo[] = out.map((p) => ({
        slot: p.slot,
        text: `${p.name || 'Slot ' + (p.slot + 1)} ${p.vocation || ''} ${p.level ? 'lvl ' + p.level : ''}`.trim(),
        name: p.name || undefined,
        hp: p.hp !== null && p.hpMax ? `${p.hp}/${p.hpMax}` : undefined,
        hpCur: p.hp, hpMax: p.hpMax, hpPct: p.hpPct,
        manaCur: p.mana, manaMax: p.manaMax, manaPct: p.manaPct,
        alive: p.alive, level: p.level || undefined, vocation: p.vocation || undefined,
      }));
      this.updateParty(shooters, 'websocket');
    }
  }

  /**
   * Gera snapshot completo com paridade de formato para /api/status e status.json
   */
  snapshot(extra: { character?: string; subsystems?: any; profiler?: any } = {}): any {
    return {
      online: this.online,
      character: extra.character || 'default',
      level: this.level,
      gold: this.gold,
      stamina: this.stamina,
      hunt: this.hunt,
      loop_mode: this.loopMode,
      treino: this.inTreino,
      party_slots: this.partySlots,
      party_members: this.shooters,
      room_players: this.roomPlayers,
      queue_flow: this.queueFlow,
      bag_slots: this.bagSlots,
      kills: this.kills,
      waves: this.waves,
      magic: this.magic,
      subsystems: extra.subsystems || {},
      sources: this.getSources(),
      last_update: new Date().toLocaleTimeString('pt-BR'),
    };
  }
}
