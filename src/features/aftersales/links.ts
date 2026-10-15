// URLs of the Warranty & after-sales screens and of the screens they open (docs/spec/00 §8.3: view state in search
// params). Keystone routes come from the screen registry; Vigie URLs from src/server/integrations/vigie/links.ts.
// The zone filter is the shell's zone bar (preference cookie), not a search param.
import { screenHref } from '@/config/screens';
import type { SavView } from '@/domain/aftersales';

/** `/after-sales/fleet`. */
export const fleetHref = () => screenHref('fleet');

/** `/after-sales/claims` (Claims) · `?view=interventions` · `?view=costs`. */
export const savHref = (view: SavView = 'claims') => (view === 'claims' ? screenHref('sav') : `${screenHref('sav')}?view=${view}`);

/** An ECO on Keystone's Change orders screen (`/reference/eco?eco=ECO-2026-015`) — the configuration tags' target. */
export const ecoHref = (eco: string) => `${screenHref('eco')}?eco=${encodeURIComponent(eco)}`;

/** A claim's drawer on the Claims view (`/after-sales/claims?claim=WC-014`); null closes it (R-143). */
export const claimHref = (claim: string | null) => (claim ? `${screenHref('sav')}?claim=${encodeURIComponent(claim)}` : screenHref('sav'));
