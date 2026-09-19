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
  level?: number;
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
    if (num <= 0) return false;
    // Se o bot já conhece um nível alto (ex: 305), ignora sentinela de nível 50 padrão do DOM
    if (num === 50 && this._level.value > 50) return false;
    // O nível de um jogador nunca diminui
    if (num < this._level.value) return false;
    this._level = { value: num, source, updatedAt: Date.now() };
    return true;
  }

  updateGold(val?: number | null, source: TelemetrySource = 'dom'): boolean {
    if (val === undefined || val === null || isNaN(val)) return false;
    const g = Math.floor(val);
    if (g < 0) return false;
    // Não zera saldo grande por leitura de DOM em branco
    if (g === 0 && this._gold.value > 1000) return false;
    this._gold = { value: g, source, updatedAt: Date.now() };
    return true;
  }

  updateStamina(val?: string | null, source: TelemetrySource = 'dom'): boolean {
    if (!val) return false;
    const st = val.trim();
    if (!st || st === '—' || st === '-') return false;

    // Converte HH:MM ou XX%
    const isClock = /^\d{1,2}:\d{2}$/.test(st);
    const isPct = /^\d{1,3}\s*%$/.test(st);

    if (!isClock && !isPct) {
      const match = st.match(/(\d{1,2}:\d{2})/);
      if (match) {
        this._stamina = { value: match[1], source, updatedAt: Date.now() };
        return true;
      }
      return false;
    }

    this._stamina = { value: st, source, updatedAt: Date.now() };
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
   * Ingestão direta de pacotes WebSocket (paridade com bot.py)
   */
  ingestWebSocketFrame(typ: string, pay: any): void {
    if (!pay || typeof pay !== 'object') return;

    if (typ === 'combatlog') {
      if (Array.isArray(pay)) {
        const newKills = pay.filter((e: any) => e && e.killed).length;
        this.kills += newKills;
      } else if (pay.killed) {
        this.kills += 1;
      }
    } else if (typ === 'log' || typ === 'notify') {
      this.waves += 1;
    } else if (['state', 'init', 'sync', 'player', 'snapshot'].includes(typ)) {
      // Level
      const dugLevel = pay.level ?? pay.player?.level ?? (Array.isArray(pay.party) ? Math.max(...pay.party.map((p: any) => p?.level || 0)) : null);
      if (typeof dugLevel === 'number') this.updateLevel(dugLevel, 'websocket');

      // Gold
      const g = pay.gold ?? pay.player?.gold;
      if (typeof g === 'number') this.updateGold(g, 'websocket');

      // Stamina
      const sVal = pay.stamina ?? pay.staminaMinutes ?? pay.player?.stamina ?? pay.player?.staminaMinutes;
      if (typeof sVal === 'number') {
        const sMins = sVal <= 1.0 ? Math.floor(sVal * 2520) : Math.floor(sVal);
        const h = Math.floor(sMins / 60);
        const m = sMins % 60;
        this.updateStamina(`${h}:${m.toString().padStart(2, '0')}`, 'websocket');
      } else if (typeof sVal === 'string') {
        this.updateStamina(sVal, 'websocket');
      }

      // Hunt
      const h = pay.hunt ?? pay.currentHunt ?? pay.stage;
      if (typeof h === 'string') this.updateHunt(h, 'websocket');
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
