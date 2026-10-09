// Parameterised texts of the "Create spares purchase order" dialog (chapter 4). Pure.
import type { Lang } from '@/i18n/translate';

/** "3 lines · 2 draft purchase orders · €12,400" / « 3 lignes · 2 commandes brouillon · 12 400 € ». */
export function sparesOrderSummaryText(lines: number, orders: number, value: string, lang: Lang): string {
  if (lang === 'fr') return `${lines} ligne${lines > 1 ? 's' : ''} · ${orders} commande${orders > 1 ? 's' : ''} brouillon · ${value}`;
  return `${lines} line${lines === 1 ? '' : 's'} · ${orders} draft purchase order${orders === 1 ? '' : 's'} · ${value}`;
}
