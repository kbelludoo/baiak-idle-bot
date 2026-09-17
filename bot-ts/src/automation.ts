import type { Page } from 'puppeteer-core';
import type { BotConfig, TelemetryState } from './types';
import { evalLegacy, loadLegacyScripts, type LegacyScriptName } from './legacyScripts';

export interface AutomationResult {
  patch: Partial<TelemetryState>;
  logs: string[];
  inTreino: boolean;
}

const EXTRA_JOBS: Array<[string, number, LegacyScriptName, unknown, (c: BotConfig) => boolean]> = [
  ['vfx', 45_000, 'page_extra.js', { job: 'vfx' }, c => c.reduceVfx],
  ['bags', 18_000, 'page_bags.js', null, c => c.autoBags],
  ['boss', 90_000, 'page_boss.js', null, c => c.autoBoss],
  ['prey', 180_000, 'page_prey.js', null, c => c.autoPrey],
  ['chest', 15_000, 'page_extra.js', { job: 'chest' }, c => c.autoExtras],
  ['codex', 55_000, 'page_extra.js', { job: 'codex' }, c => c.autoExtras],
  ['tree', 180_000, 'page_extra.js', { job: 'tree' }, c => c.autoExtras],
  ['charms', 240_000, 'page_extra.js', { job: 'charms' }, c => c.autoExtras],
  ['battlepass', 180_000, 'page_extra.js', { job: 'battlepass' }, c => c.autoExtras],
  ['guild', 180_000, 'page_extra.js', { job: 'guild' }, c => c.autoExtras],
  ['merchant', 240_000, 'page_extra.js', { job: 'merchant' }, c => c.autoExtras],
  ['boosts', 180_000, 'page_extra.js', { job: 'boosts' }, c => c.autoExtras],
  ['market', 200_000, 'page_extra.js', { job: 'market' }, c => c.autoExtras],
  ['supply', 300_000, 'page_extra.js', { job: 'supply' }, c => c.autoExtras],
  ['loopcfg', 600_000, 'page_extra.js', { job: 'loopcfg' }, c => c.autoExtras],
  ['manageloot', 600_000, 'page_extra.js', { job: 'manageloot' }, c => c.autoExtras],
  ['forge', 600_000, 'page_extra.js', { job: 'forge' }, c => c.autoExtras],
  ['imbue', 600_000, 'page_extra.js', { job: 'imbue' }, c => c.autoExtras],
  ['modals', 40_000, 'page_extra.js', { job: 'close_modals' }, c => c.autoExtras],
];

function parseStaminaMinutes(text: string | undefined | null): number | null {
  if (!text) return null;
  const raw = String(text).trim().toLowerCase();
  const clock = raw.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const pct = raw.match(/(\d+)\s*%/);
  if (pct) return Number(pct[1]);
  if (['0', '—', '–', '-', 'empty', 'vazia'].includes(raw)) return 0;
  return null;
}

export function staminaIsEmpty(text: string | undefined | null, thresholdPct = 15): boolean {
  if (!text) return false;
  const raw = String(text).trim().toLowerCase();
  const pct = raw.match(/(\d+)\s*%/);
  if (pct) return Number(pct[1]) <= thresholdPct;
  const mins = parseStaminaMinutes(text);
  if (mins == null) return false;
  return mins <= Math.floor(2520 * thresholdPct / 100);
}

export function staminaHasRecovered(text: string | undefined | null, recoveryPct = 85): boolean {
  if (!text) return false;
  const raw = String(text).trim().toLowerCase();
  const pct = raw.match(/(\d+)\s*%/);
  if (pct) return Number(pct[1]) >= recoveryPct;
  const mins = parseStaminaMinutes(text);
  if (mins == null) return false;
  return mins >= Math.floor(2520 * recoveryPct / 100);
}

function isTreinoLabel(text: string | undefined | null): boolean {
  return /treino\s*online|online\s*training/i.test(text || '');
}

function isCityLabel(text: string | undefined | null): boolean {
  return /templo|temple|cidade|city|town|depot/i.test(text || '');
}

function collectEvents(label: string, value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value.events)) return value.events.map((x: unknown) => `[${label}] ${String(x)}`);
  if (value.action) return [`[${label}] ${String(value.action)}`];
  if (value.skip) return [`[${label}] skip: ${String(value.skip)}`];
  return [];
}

export class AutomationController {
  private readonly scriptsPromise = loadLegacyScripts();
  private readonly last = new Map<string, number>();
  private inTreino = false;
  private lastPartySlots = 1;
  private needPotionCheck = true;

  private due(key: string, now: number, cooldownMs: number): boolean {
    return now - (this.last.get(key) || 0) >= cooldownMs;
  }

  private mark(key: string, now: number) {
    this.last.set(key, now);
  }

  async tick(page: Page, config: BotConfig, state: TelemetryState): Promise<AutomationResult> {
    const now = Date.now();
    const scripts = await this.scriptsPromise;
    const logs: string[] = [];

    const core = await page.evaluate((arg: { autoHunt: boolean; autoSell: boolean; sellThresholdPct: number; configureAutoSell: boolean; checkDaily: boolean; checkPromote: boolean }) => {
      const res: any = {
        wave: (document.getElementById('wave-title')?.textContent || '').trim(),
        stamina: (document.getElementById('stamina-time')?.textContent || '').trim(),
        inv: (document.getElementById('inv-count')?.textContent || '').trim(),
        level: 0,
        gold: 0,
        loopOn: false,
        shooters: [] as any[],
        events: [] as string[],
      };

      const visible = (el: Element | null) => !!(el && (el as HTMLElement).offsetParent !== null);
      const click = (el: Element | null, event: string) => {
        if (visible(el) && !(el as HTMLButtonElement).disabled) {
          (el as HTMLElement).click();
          if (event) res.events.push(event);
          return true;
        }
        return false;
      };

      const shooters = Array.from(document.querySelectorAll('#bar-shooters .bar-member'));
      res.shooters = shooters.map((el, slot) => ({
        slot,
        text: (el.textContent || '').trim().replace(/\s+/g, ' '),
        classes: (el as HTMLElement).className || '',
      }));

      const levelEl = document.querySelector('.hd-lvl, .player-level, #player-level, [data-player-level], .pm-lvl, .char-lvl');
      const levelMatch = (levelEl?.textContent || '').match(/\d+/);
      if (levelMatch) res.level = Number(levelMatch[0]);

      const goldEl = document.getElementById('gold-count') || document.querySelector('.mk-goldamt, .ac-wallet-val, .wallet, .bp-wallet b, .gold, [data-gold]');
      const goldText = (goldEl?.textContent || '').replace(/[^0-9]/g, '');
      if (goldText) res.gold = Number(goldText);

      const offline = document.getElementById('offline-modal');
      if (offline && !offline.classList.contains('hidden')) {
        const close = document.getElementById('offline-modal-close') || offline.querySelector('button');
        click(close, 'FECHOU_OFFLINE_MODAL');
        offline.classList.add('hidden');
      }
      const collect = Array.from(document.querySelectorAll('button, .btn, [role="button"]')).find((b) =>
        visible(b) && /coletar/i.test((b.textContent || '').trim()) && !(b as HTMLElement).id.includes('daily'));
      if (collect) click(collect, 'CLICOU_BOTAO_COLETAR');

      const conn = document.getElementById('conn-overlay');
      if (conn && !conn.classList.contains('hidden')) click(document.getElementById('conn-retry'), 'CLICOU_RECONECTAR');

      if (arg.autoSell && arg.configureAutoSell) {
        const cfgBtn = document.getElementById('autosell-cfg');
        if (cfgBtn) {
          (cfgBtn as HTMLElement).click();
          const modal = document.getElementById('autosell-modal');
          if (modal && !modal.classList.contains('hidden')) {
            for (const row of Array.from(modal.querySelectorAll('.set-row'))) {
              const label = (row.querySelector('span.muted')?.textContent || '').toLowerCase();
              if (/auto-venda|auto-sell/.test(label) || /ordenar|order/.test(label)) {
                const on = Array.from(row.querySelectorAll('.set-seg button')).find((b) => /ligado|on/i.test((b.textContent || '').trim()));
                if (on && !on.classList.contains('on')) (on as HTMLElement).click();
              } else if (/vender em|sell at/.test(label)) {
                const range = row.querySelector('input[type="range"]') as HTMLInputElement | null;
                if (range && range.value !== String(arg.sellThresholdPct)) {
                  range.value = String(arg.sellThresholdPct);
                  range.dispatchEvent(new Event('input', { bubbles: true }));
                  range.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }
            }
            click(document.getElementById('autosell-modal-close'), 'CONFIGUROU_AUTOSELL_NATIVO');
          }
        }
      }

      if (arg.checkDaily) {
        const dailyTab = document.getElementById('tab-daily');
        const notice = document.getElementById('daily-notice');
        const hasBadge = !!dailyTab?.querySelector('.daily-badge');
        if ((notice && !notice.classList.contains('hidden')) || hasBadge) {
          (notice || dailyTab as HTMLElement | null)?.click();
          const modal = document.getElementById('daily-modal');
          if (modal && !modal.classList.contains('hidden')) {
            const claim = document.getElementById('daily-claim-btn');
            if (claim && /coletar|claim/i.test(claim.textContent || '')) click(claim, 'DAILY_REWARD_COLETADA');
            click(document.getElementById('daily-modal-close'), 'FECHOU_DAILY_MODAL');
          }
        }
      }

      const unlock = Array.from(document.querySelectorAll('button, .btn, [data-mode="unlock"], [data-mode="recruit"], #recruit-btn')).find((b) => {
        if (!visible(b) || (b as HTMLButtonElement).disabled) return false;
        const text = (b.textContent || '').toLowerCase();
        if (/store|coin/.test(text)) return false;
        return /desbloquear por gold|recrutar/.test(text) || (b as HTMLElement).id === 'recruit-btn';
      });
      if (unlock) click(unlock, 'CLICOU_SLOT_CAMPEAO');

      const voc = document.getElementById('voc-overlay');
      if (voc && !voc.classList.contains('hidden')) {
        const options = Array.from(document.querySelectorAll('.voc-opt:not([disabled])')) as HTMLElement[];
        const preferred = options.find(v => /sorcerer|druid|paladin/i.test(v.dataset.voc || v.textContent || '')) || options[0];
        if (preferred) preferred.click();
        const name = document.getElementById('voc-name') as HTMLInputElement | null;
        if (name && !name.value) {
          name.value = `TS${Date.now().toString().slice(-6)}`;
          name.dispatchEvent(new Event('input', { bubbles: true }));
        }
        click(document.getElementById('voc-create'), 'RECRUTOU_CAMPEAO');
      }

      if (arg.checkPromote) {
        const memberButtons = Array.from(document.querySelectorAll('#skills-members .sk-mem')) as HTMLElement[];
        if (memberButtons.length) {
          memberButtons.forEach((member, idx) => {
            member.click();
            const promote = document.querySelector('#skills-panel-body .sk-promote');
            if (promote && !(promote as HTMLButtonElement).disabled) click(promote, `PROMOVEU_CAMPEAO_SLOT_${idx}`);
          });
        } else {
          const promote = document.querySelector('.sk-promote, .cyc-char-promote');
          if (promote && !(promote as HTMLButtonElement).disabled) click(promote, 'PROMOVEU_CAMPEAO_GENERICO');
        }
      }

      const loop = document.getElementById('loop-toggle') || document.getElementById('hunt-loop-btn');
      if (loop) {
        res.loopOn = loop.classList.contains('on') || loop.classList.contains('active');
        if (!res.loopOn && arg.autoHunt) {
          (loop as HTMLElement).click();
          res.loopOn = true;
          res.events.push('ATIVOU_MODO_LOOP');
        }
      }
      return res;
    }, {
      autoHunt: config.autoHunt,
      autoSell: config.autoSell,
      sellThresholdPct: config.sellThresholdPct,
      configureAutoSell: this.due('autosell-config', now, 600_000),
      checkDaily: this.due('daily', now, 60_000),
      checkPromote: this.due('promote', now, 30_000),
    }).catch((err: unknown) => ({ events: [`CORE_DOM_ERRO:${String(err)}`], wave: '', stamina: '', inv: '', level: 0, gold: 0, loopOn: false, shooters: [] }));

    if (this.due('autosell-config', now, 600_000)) this.mark('autosell-config', now);
    if (this.due('daily', now, 60_000)) this.mark('daily', now);
    if (this.due('promote', now, 30_000)) this.mark('promote', now);
    logs.push(...(core.events || []).map((e: string) => `[CORE] ${e}`));

    let hud: any = {};
    try { hud = await evalLegacy(page, scripts['page_hud.js']); } catch (err) { logs.push(`[HUD] erro: ${String(err)}`); }

    const stamina = hud?.stamina || core.stamina || state.stamina;
    const wave = hud?.wave || core.wave || state.hunt;
    const partySlots = Math.max(1, Number(core.shooters?.length || hud?.partyMembers?.length || state.party_slots || 1));
    if (partySlots > this.lastPartySlots) this.needPotionCheck = true;
    this.lastPartySlots = Math.max(this.lastPartySlots, partySlots);

    if (isTreinoLabel(wave)) this.inTreino = true;
    const empty = staminaIsEmpty(stamina);
    const recovered = staminaHasRecovered(stamina);

    if (config.autoTreino && empty && !this.inTreino && this.due('treino-enter', now, 8_000)) {
      this.mark('treino-enter', now);
      try {
        const r = await evalLegacy<any>(page, scripts['page_treino.js'], { want: 'train' });
        logs.push(...collectEvents('TREINO', r));
        if (r?.inTreino || r?.action) this.inTreino = true;
      } catch (err) { logs.push(`[TREINO] erro: ${String(err)}`); }
    } else if (this.inTreino && (!config.autoTreino || recovered)) {
      this.inTreino = false;
      logs.push('[TREINO] stamina recuperou — voltando às hunts');
    }

    const pickerOpen = !!hud?.pickerOpen;
    if (config.autoHeal && !pickerOpen && (this.needPotionCheck || this.due('potion', now, 60_000))) {
      this.mark('potion', now);
      this.needPotionCheck = false;
      try {
        const r = await evalLegacy<any>(page, scripts['page_potion.js'], {
          autoHeal: config.autoHeal,
          healBelowPct: config.healBelowPct,
          hpPotionBelowPct: config.hpPotionBelowPct,
          manaPotionBelowPct: config.manaPotionBelowPct,
        });
        logs.push(...collectEvents('POTION/CURA', r));
      } catch (err) { logs.push(`[POTION/CURA] erro: ${String(err)}`); }
    }

    if (config.autoEquip && !this.inTreino && !pickerOpen && this.due('equip-fast', now, 30_000)) {
      this.mark('equip-fast', now);
      try { const r = await evalLegacy<any>(page, scripts['page_equip.js']); logs.push(...collectEvents('AUTO-EQUIP', r)); }
      catch (err) { logs.push(`[AUTO-EQUIP] erro: ${String(err)}`); }
    }

    if (!pickerOpen) {
      for (const [key, cooldown, scriptName, arg, enabled] of EXTRA_JOBS) {
        if (!enabled(config) || !this.due(`extra:${key}`, now, cooldown)) continue;
        if (key === 'boss' && this.inTreino) continue;
        if (key === 'bags' || key === 'vfx' || key === 'boss' || key === 'prey' || key === 'chest' || key === 'codex' || key === 'modals') {
          this.mark(`extra:${key}`, now);
          try { const r = await evalLegacy<any>(page, scripts[scriptName], arg); logs.push(...collectEvents(key.toUpperCase(), r)); }
          catch (err) { logs.push(`[${key.toUpperCase()}] erro: ${String(err)}`); }
          break;
        }
      }
    }

    const huntTarget = config.forceHunt && config.huntId ? { id: config.huntId, name: config.huntId } : { resumeLast: true, mode: 'last' };
    const wrongForcedHunt = config.forceHunt && config.huntId && !String(wave).toLowerCase().includes(config.huntId.toLowerCase());
    const shouldHunt = config.autoHunt && !this.inTreino && !empty && (isCityLabel(wave) || wrongForcedHunt);
    if (shouldHunt && this.due('hunt-resume', now, 10_000)) {
      this.mark('hunt-resume', now);
      try {
        const r = await evalLegacy<any>(page, scripts['page_hunt.js'], huntTarget, 15_000);
        logs.push(...collectEvents('HUNT', r));
        if (r?.success) logs.push(`[HUNT] ${r.alreadyThere ? 'já na hunt' : 'teleporte'}: ${r.hunt || config.huntId || 'última'}`);
      } catch (err) { logs.push(`[HUNT] erro: ${String(err)}`); }
    }

    const patch: Partial<TelemetryState> = {
      hunt: wave,
      stamina,
      bag_slots: core.inv || state.bag_slots,
      party_slots: partySlots,
      level: Number(hud?.level || core.level || state.level || 0),
      gold: Number(hud?.gold ?? core.gold ?? state.gold ?? 0),
      shooters: core.shooters?.length ? core.shooters : state.shooters,
      loop_mode: !!core.loopOn,
      treino: this.inTreino,
      analyzers: hud?.analyzers || state.analyzers,
      last_events: logs.slice(-20),
      last_update: new Date().toLocaleTimeString('pt-BR'),
    };

    return { patch, logs, inTreino: this.inTreino };
  }
}
