// Export provider registry (chapter 4): screen id → provider. Providers live in src/server/export/providers/ and register
// themselves through providers/index.ts (one import line per provider file).
import type { ScreenId } from '@/config/screens';
import type { ExportFormat } from '@/server/db/codes';
import type { ExportProvider } from './types';

const g = globalThis as unknown as { __ksExportProviders?: Map<ScreenId, ExportProvider> };
const providers = (g.__ksExportProviders ??= new Map<ScreenId, ExportProvider>());

/** Registers (or replaces) the provider of a screen. */
export function registerExportProvider(p: ExportProvider): void {
  providers.set(p.screen, p);
}

export function getExportProvider(screen: ScreenId): ExportProvider | null {
  return providers.get(screen) ?? null;
}

export function listExportProviders(): ExportProvider[] {
  return [...providers.values()];
}

/** Formats a provider offers for the screen itself (header Export menu): CSV / Excel with tables, PDF with a report. */
export function formatsOf(p: ExportProvider | null): ExportFormat[] {
  if (!p) return [];
  return [...(p.table ? (['csv', 'xlsx'] as const) : []), ...(p.pdf ? (['pdf'] as const) : [])];
}
