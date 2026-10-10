/**
 * `vitest` só existe como alias do runner do Bun (bun test resolve o import),
 * mas o pacote não está no package.json — então o typecheck não o enxerga.
 * Delegamos para o módulo real usado em runtime, `bun:test`.
 */
declare module 'vitest' {
  export * from 'bun:test';
}
