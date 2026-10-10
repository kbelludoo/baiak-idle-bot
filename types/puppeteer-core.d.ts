/**
 * Declarations mínimas para o typecheck do driver TERMINAL.
 *
 * O driver terminal nunca executa o Puppeteer: `boss_runner`, `extras`,
 * `room_send` e `auto_restore` importam só o tipo (`import type { Page }`),
 * que é apagado em tempo de execução. O package.json do terminal não
 * instala `puppeteer-core` de propósito (sem Chromium na VPS), então
 * declarar o módulo aqui evita depender de um pacote que não é usado.
 *
 * Só é incluído por tsconfig.term.json — o tsconfig raiz (modo navegador)
 * continua apontando para o pacote real quando ele existir.
 */
declare module 'puppeteer-core' {
  export type Page = any;
  export type CDPSession = any;
  export type Browser = any;
}
