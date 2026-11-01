// "Suggested rebalancing" of the portfolio (Resources, R-3 / S-7), streamed (R-017): the ranked levers come from the what-if of
// every project with a plan (getRebalancingSuggestions), the costliest read of the page on a large portfolio. The page renders
// this async Server Component inside a <Suspense> boundary, so the heatmap, the KPIs and the capacity bars are sent first and
// the card follows when the levers are computed (cached while the database is unchanged, src/server/cache/read-cache.ts).
import type { Lang, T } from '@/i18n/translate';
import { getRebalancingSuggestions } from '@/server/dal/resources';
import { suggestionViews } from './model';
import { SuggestionsCard } from './resources-view';
import { suggestionInputs } from './suggestions';

export interface PortfolioSuggestionsProps {
  /** Edit controls ("Apply") allowed on the screen. */
  canEdit: boolean;
  /** The project is read-only for the viewer (no "Apply" on its levers). */
  readOnly: (code: string) => boolean;
  t: T;
  lang: Lang;
}

export async function PortfolioSuggestions({ canEdit, readOnly, t, lang }: PortfolioSuggestionsProps) {
  const rows = await getRebalancingSuggestions();
  const views = suggestionViews(suggestionInputs(rows, { portfolio: true, canEdit, readOnly }), t, lang);
  return views ? <SuggestionsCard suggestions={views} canEdit={canEdit} t={t} /> : null;
}
