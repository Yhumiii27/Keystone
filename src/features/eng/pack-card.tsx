// R-191 (Arche K-08): the card "Engineering pack · EPC2i share" of the Engineering synthesis — the weighted % completeness of
// the project's pack against the standard list of its machine type(s), the per-family breakdown (expected, validated, weight)
// with the documents counted, and the DIG-PRODI G2 target (above 80 %). The same numbers are published to the CAPEX
// application by pub_pack_ingenierie. Server Component; rules in src/domain/engineering-pack.ts.
import { cx } from '@/components/ds/cx';
import { PACK_FAMILY_LABELS, PACK_TARGET_PCT, type PackFamily } from '@/domain/engineering-pack';
import { dataText } from '@/i18n/data-text';
import { intlLocale, type Lang, type T } from '@/i18n/translate';
import { documentStatus } from '@/server/db/codes';
import type { EngineeringPack } from '@/server/dal/engineering-pack';
import s from './eng.module.css';

export interface PackFamilyView {
  family: PackFamily;
  label: string;
  /** "1 / 2" validated / expected. */
  count: string;
  weight: string;
  /** Bar width "50%". */
  bar: string;
  /** "BOM-MEC-026 rev D · Frozen" — the documents counted, or "No document indexed yet". */
  docs: string[];
}

export interface PackCardView {
  pct: string;
  /** Bar width of the overall %. */
  bar: string;
  target: string;
  status: { text: string; cls: string };
  sub: string;
  families: PackFamilyView[];
}

/** View model of the card (null pack → no card: the project has no machine type). */
export function packCardView(pack: EngineeringPack, t: T, lang: Lang): PackCardView {
  const num = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const pctText = (v: number) => `${num.format(v)} %`;
  return {
    pct: pctText(pack.pct),
    bar: `${Math.min(100, Math.max(0, pack.pct))}%`,
    target: `${t('G2 target')} > ${pctText(PACK_TARGET_PCT)}`,
    status: !pack.measured
      ? { text: t('Nothing expected'), cls: 'tag tag-outline' }
      : pack.meetsTarget
        ? { text: t('Target reached'), cls: 'tag tag-neutral' }
        : { text: t('Below target'), cls: 'tag tag-accent' },
    sub: `${t('Standard list')} · ${pack.types.join(' · ')} · ${t('provisional')}`,
    families: pack.families.map((f) => ({
      family: f.family,
      label: t(PACK_FAMILY_LABELS[f.family]),
      count: `${f.validated} / ${f.expected}`,
      weight: pctText(f.weight),
      bar: `${Math.round(f.ratio * 100)}%`,
      docs: (pack.documents[f.family] ?? []).length
        ? pack.documents[f.family].map((d) => `${d.number} ${t('rev')} ${d.revision} · ${dataText(d.title, lang)} · ${t(documentStatus.label(d.status))}`)
        : [t('No document indexed yet')],
    })),
  };
}

export function EngineeringPackCard({ view, t }: { view: PackCardView; t: T }) {
  return (
    <div className={cx('card', 'elev-sm', s.card)}>
      <div className={s.head}>
        <div className={s.titleCol}>
          <div className="card-title">{t('Engineering pack · EPC2i share')}</div>
          <span className={s.sub}>{view.sub}</span>
        </div>
        <span className={cx(view.status.cls, s.push, s.nowrap)}>{view.status.text}</span>
      </div>
      <div className={s.packTotal}>
        <span className={s.packPct}>{view.pct}</span>
        <span className={s.packTarget}>{view.target}</span>
      </div>
      <span className={s.bar} role="img" aria-label={`${t('Completeness')} ${view.pct}`}>
        <span className={s.barFill} style={{ width: view.bar }} />
      </span>
      <div role="table" aria-label={t('Engineering pack · EPC2i share')}>
        <div role="row" className={cx(s.packRow, s.packHead)}>
          <span role="columnheader">{t('Family')}</span>
          <span role="columnheader" className={s.right}>{t('Validated / expected')}</span>
          <span role="columnheader" className={s.right}>{t('Weight')}</span>
        </div>
        {view.families.map((f) => (
          <div key={f.family} role="row" className={s.packRow}>
            <span role="cell" className={s.packFam}>
              <span>{f.label}</span>
              <span className={s.bar}>
                <span className={s.barFill} style={{ width: f.bar }} />
              </span>
              {f.docs.map((d) => (
                <span key={d} className={s.packDoc}>
                  {d}
                </span>
              ))}
            </span>
            <span role="cell" className={cx(s.right, s.tab)}>
              {f.count}
            </span>
            <span role="cell" className={cx(s.right, s.tab)}>
              {f.weight}
            </span>
          </div>
        ))}
      </div>
      <span className={s.sub}>{t('A document counts in its family through its type and is validated once released (BPE)')}</span>
    </div>
  );
}
