// "Delivered projects" card of the Installed base (R-144, E-8 "a": the machines and their as-built configuration are created
// at the project's delivery, from its bill of materials, then kept by after-sales): each delivered project (stage Expédition
// or later) with a BOM carrying revisions — its stage, the parts recorded as built, the machines already registered — and,
// for editors, "Register machines" with the project's defaults (assembly roots, name, site, the business date `today` —
// R-013 —, the contract's warranty).
// Server Component (view model + markup); the button is a client island.
import { SectionCard } from '@/components/app/SectionCard';
import type { FormDef } from '@/components/app/form-def';
import { warrantyEndOf } from '@/domain/claims';
import type { Lang, T } from '@/i18n/translate';
import { displayOfIso, stage as stageCodec, type StageCode } from '@/server/db/codes';
import type { DeliveryCandidate } from '@/server/dal/fleet';
import { FollowupFormButton } from './followup-buttons';
import { localizeForm, registerMachinesFormDef } from './forms';
import { dataText } from './i18n';
import s from './aftersales.module.css';

export interface DeliveredRowView {
  projectCode: string;
  label: string;
  /** "Chantier · 5 parts as built · 1 machine registered". */
  sub: string;
  register: { label: string; ariaLabel: string; form: FormDef } | null;
}

export function deliveredView(
  candidates: readonly (DeliveryCandidate & { stage: StageCode })[], opts: { canRegister: (projectCode: string) => boolean; today: string }, t: T, lang: Lang,
): DeliveredRowView[] {
  return candidates.map((c) => {
    // Singular for 1 (and 0 in French).
    const one = (n: number) => n === 1 || (lang === 'fr' && n === 0);
    const parts = `${c.trackedParts} ${t(one(c.trackedParts) ? 'part as built' : 'parts as built')}`;
    const machines = `${c.registered} ${t(one(c.registered) ? 'machine registered' : 'machines registered')}`;
    const label = t('Register machines');
    return {
      projectCode: c.projectCode,
      label: `${c.projectCode} · ${dataText(c.label, lang)}`,
      sub: [stageCodec.label(c.stage), parts, machines].join(' · '),
      register: opts.canRegister(c.projectCode)
        ? {
            label, ariaLabel: `${label} · ${c.projectCode}`,
            form: localizeForm(registerMachinesFormDef({
              project: c.projectCode, count: c.defaultCount, name: c.defaultName, site: c.site, delivered: displayOfIso(opts.today),
              warrantyEnd: displayOfIso(warrantyEndOf(opts.today, c.warrantyMonths)), equipments: c.equipments,
            }), t, lang),
          }
        : null,
    };
  });
}

export function DeliveredCard({ rows, t }: { rows: DeliveredRowView[]; t: T }) {
  if (!rows.length) return null;
  return (
    <SectionCard title={t('Delivered projects')} hint={t('Machines and their as-built configuration come from the project’s bill of materials')}>
      {rows.map((r) => (
        <div key={r.projectCode} className={s.delivered}>
          <div className={s.stack}>
            <span>{r.label}</span>
            <span className={s.sub}>{r.sub}</span>
          </div>
          {r.register && <FollowupFormButton kind="register" target={r.projectCode} label={r.register.label} ariaLabel={r.register.ariaLabel} context={r.label} form={r.register.form} size="row" />}
        </div>
      ))}
    </SectionCard>
  );
}
