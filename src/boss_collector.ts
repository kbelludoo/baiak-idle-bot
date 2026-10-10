import type { Page } from 'puppeteer-core';
import type { BotConfig } from './types';
import { roomSendDetail } from './room_send';

export const BOSS_TOKEN_PRICES: Record<string, number> = {
  'eldritch quiver': 16,
  'fabulous legs': 16,
  'gnome helmet': 16,
  'gnome armor': 16,
  'gnome legs': 16,
  'soulful legs': 16,
  'dark whispers': 16,
  'terra helmet': 16,
  'toga mortis': 16,
  'galea mortis': 16,
  'ghost chestplate': 12,
  'winged boots': 12,
  'depth calcei': 12,
  'pair of nightmare boots': 12,
  'deepling fork': 12,
  'bear skin': 8,
  'dream shroud': 8,
  'embrace of nature': 8,
  'dwarven legs': 8,
  'umbral katar': 8,
  'drachaku': 8,
  'death oyoroi': 8,
  'dark vision bandana': 8,
  'jade legs': 8,
  'gnomish footwraps': 8,
  'zaoan helmet': 4,
  'zaoan legs': 4,
  'shiny blade': 4,
  'crystalline axe': 4,
  'blessed sceptre': 4,
  'rift bow': 4,
  'rift crossbow': 4,
  'rift lance': 4,
  'rift shield': 4,
};

let lastCheckTime = 0;

export async function checkAndBuyBossGear(
  page: Page | null,
  config: BotConfig,
  now: number
): Promise<{ bought: string | null; tokensRemaining: number } | null> {
  if (!page || !config.autoBoss || now - lastCheckTime < 60_000) return null;
  lastCheckTime = now;

  const targetItems = config.autoBuyBossItems || [];
  if (targetItems.length === 0) return null;

  try {
    const state = await page.evaluate(() => {
      const w = window as any;
      const m = w?.m;
      if (!m) return null;
      const bt = Number(m.lastBossTokens || 0);
      const owned = new Set<string>();

      // Verifica equipamentos de todos os jogadores ativos e no banco
      const players = Array.isArray(m.lastPlayers) ? m.lastPlayers : [];
      for (const p of players) {
        if (p?.equip && typeof p.equip === 'object') {
          for (const item of Object.values(p.equip as Record<string, any>)) {
            if (item?.name) owned.add(String(item.name).trim().toLowerCase());
          }
        }
      }
      // Verifica na mochila/backpack
      const bp = Array.isArray(m.lastBackpack) ? m.lastBackpack : [];
      for (const item of bp) {
        if (item?.name) owned.add(String(item.name).trim().toLowerCase());
      }
      return { tokens: bt, owned: Array.from(owned) };
    }).catch(() => null);

    if (!state || state.tokens < 4) return null;

    const ownedSet = new Set(state.owned);
    for (const itemName of targetItems) {
      const cleanName = itemName.trim().toLowerCase();
      if (ownedSet.has(cleanName)) continue;
      const price = BOSS_TOKEN_PRICES[cleanName];
      if (!price || state.tokens < price) continue;

      // Executa a compra do item via protocolo da sala buymercart
      console.log(`[${new Date().toLocaleTimeString()}] 👑 [BOSS COLLECTOR] Saldo de ${state.tokens} Boss Tokens. Comprando "${cleanName}" (${price} tokens)...`);
      const sent = await roomSendDetail(page, 'buymercart', {
        items: [{ id: `boss:${cleanName}`, qty: 1 }],
      }).catch(() => null);

      if (sent?.sent && sent.sent > 0) {
        console.log(`[${new Date().toLocaleTimeString()}] ✅ [BOSS COLLECTOR] "${cleanName}" adquirido com sucesso! O item chegará na Caixa de Entrada.`);
        return { bought: cleanName, tokensRemaining: state.tokens - price };
      }
    }
  } catch (err: any) {
    console.warn(`[BOSS COLLECTOR AVISO] Falha ao verificar/comprar equipamentos de boss: ${err?.message || err}`);
  }

  return null;
}
