// URLs of the Site screen and the screens it links to (routes from the registry, docs/spec/00 §8.3).
import { screenHref, type ScreenId } from '@/config/screens';
import type { SiteTab } from '@/domain/site';
import { ncrHref } from '@/features/quality/links';

/** `/projects/HLT-026/site`, `?tab=team|exec` (Readiness & go is the default, no param). `hash` jumps to a card. */
export function siteHref(code: string, tab: SiteTab = 'ready', hash?: string): string {
  return screenHref('site', { code }) + (tab === 'ready' ? '' : `?tab=${tab}`) + (hash ? `#${hash}` : '');
}

/** Quality screen with the NCR drawer open (`goTo('quality', {qTab:'ncr', ncr})`, 4759) — the Quality screen's own URL helper. */
export const qualityNcrHref = (code: string, ncr: string): string => ncrHref(code, ncr);

/** Collision "Resolve" targets: What-if levelling, Leave & calendar, Skills matrix (global screens). */
export const screenOf = (id: Extract<ScreenId, 'whatif' | 'leave' | 'skills'>) => screenHref(id);

/** Id of the Cursus card (the Document collision jumps to it). */
export const CURSUS_CARD_ID = 'cursus';
