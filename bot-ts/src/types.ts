export type Vocation = 'RP' | 'EK' | 'MK' | 'MS' | 'ED' | 'UNKNOWN';

export interface Champion {
  slot: number;
  name: string;
  vocation: Vocation;
  level: number;
  active: boolean;
  text?: string;
  classes?: string;
  dps?: number;
  hpPct?: number;
  manaPct?: number;
}

export interface PartyMemberDOM {
  slot: number;
  text: string;
  classes: string;
}

export interface PartyState {
  shooters: PartyMemberDOM[];
  isOpen: boolean;
  formation: any[];
  available: any[];
}

export interface HuntArea {
  id: string;
  name: string;
  tier: 'LOOT' | 'XP' | 'BALANCED' | 'TREINO';
  minLevel: number;
  isUnlocked?: boolean;
  safety?: 'SEGURO' | 'MODERADO' | 'PERIGOSO';
}

export type SubsystemStatus = 'FUNCIONAL' | 'AGUARDANDO' | 'AGUARDANDO_REQUISITO' | 'TREINANDO' | 'VERIFICANDO' | 'FORCANDO';

export interface SubsystemInfo {
  status: SubsystemStatus;
  detail: string;
  last_equipped?: any[];
}

export interface BotConfig {
  headless: boolean;
  port: number;
  host: string;
  stream: boolean;
  streamFps: number;
  streamQuality: number;
  streamWidth: number;
  streamHeight: number;
  autoHunt: boolean;
  forceHunt: boolean;
  huntId: string;
  huntMode: 'last' | 'force';
  exploreSampleSec: number;
  exploreMaxDeaths: number;
  exploreMaxDamageTakenPct: number;
  exploreCooldownSec: number;
  autoHeal: boolean;
  healBelowPct: number;
  hpPotionBelowPct: number;
  manaPotionBelowPct: number;
  autoSell: boolean;
  sellThresholdPct: number;
  autoTreino: boolean;
  autoBoss: boolean;
  autoEquip: boolean;
  autoBags: boolean;
  autoPrey: boolean;
  autoExtras: boolean;
  screenshot: boolean;
  userDataDir: string;
  chromePath: string;
  targetUrl: string;
  token: string;
  reduceVfx: boolean;
  chromeGl: string;
  auctionEnabled: boolean;
  auctionLive: boolean;
  auctionBudget: number;
  auctionMinMarginPct: number;
  auctionMaxItems: number;
  auctionSniperMaxMinutes: number;
  auctionSellGoldAmount: number;
  auctionSellEnabled: boolean;
  auctionSellPassword: string;
  jevEnabled: boolean;
  jevApiKey: string;
  jevEndpoint: string;
  jevTimeoutMs: number;
  jevAutoHunt: boolean;
  huntGoal: 'level' | 'gold' | 'balanced';
  autoBossPlaylist: string[];
  autoBuyBossItems: string[];
}

export interface TelemetryState {
  online: boolean;
  hunt: string;
  kills: number;
  waves: number;
  loop_mode: boolean;
  stamina: string;
  bag_slots: string;
  party_slots: number;
  level: number;
  gold: number;
  shooters: PartyMemberDOM[];
  analyzer: {
    exp_hour?: number;
    loot_hour?: number;
    kills_hour?: number;
    deaths: number;
  };
  subsystems: Record<string, SubsystemInfo>;
  last_update: string;
}
