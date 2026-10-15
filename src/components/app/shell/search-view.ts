// Global search hit as displayed (docs/spec/01 §5.4). R-148 (NEW-D1-2, X-12b): the hit title (ids, names, titles typed
// in Keystone or received) is shown as typed; the sub-line keeps its data segments (a PM, a manufacturer, a job title)
// as typed and translates Keystone's own labels (stage, status, category, dates).
import { dataText } from '@/i18n/data-text';
import type { Lang, T } from '@/i18n/translate';
import type { SearchHit } from '@/server/dal/shell';
import type { SearchHitView } from './types';

export function searchHitView(h: SearchHit, t: T, lang: Lang): SearchHitView {
  const data = new Set(h.subData ?? []);
  const sub = data.size ? h.sub.split(' · ').map((seg) => (data.has(seg) ? dataText(seg, lang) : t(seg))).join(' · ') : t(h.sub);
  return { kind: t(h.kind), title: dataText(h.title, lang), sub, href: h.href };
}
