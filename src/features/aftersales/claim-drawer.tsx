// Warranty claim drawer (R-143), opened by `?claim=WC-014` on the Claims view and closed (×, scrim, Esc) to the register:
// status steps, the facts, the design ECO or "Raise ECO in Vigie", the machine's as-maintained configuration (R-144), the
// claim's interventions with "Mark done", and the after-sales steps (Edit claim, Mark diagnosed, Plan intervention,
// Close claim) for editors. Server Component; the buttons are client islands.
import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Eyebrow } from '@/components/app/Eyebrow';
import { KeyValueList } from '@/components/app/KeyValueList';
import { FlowStepper } from '@/components/app/Stepper';
import { Drawer } from '@/components/ds/Drawer';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import { VIGIE_LINK_ATTRS } from '@/server/integrations/vigie/links';
import type { ClaimDrawerView } from './claim-drawer-model';
import { CloseClaimButton, FollowupFormButton } from './followup-buttons';
import s from './aftersales.module.css';

export function ClaimDrawer({ view: d, t }: { view: ClaimDrawerView; t: T }) {
  const context = `${d.number} · ${d.title}`;
  return (
    <Drawer open closeHref={d.closeHref} id={d.number} title={d.title} meta={<span className={d.statusClass}>{d.status}</span>}>
      <FlowStepper steps={d.steps} />

      <KeyValueList title={t('Claim')} items={d.facts.map((f) => ({ id: f.k, k: f.k, v: f.v, color: f.color }))} />

      <div className={s.section}>
        <Eyebrow>{t('Design ECO')}</Eyebrow>
        <div className={s.row}>
          {d.eco ? (
            d.eco.href ? (
              d.eco.external ? (
                <a href={d.eco.href} {...VIGIE_LINK_ATTRS} className={cx('tag tag-outline', s.ecoTag)} aria-label={d.eco.label} title={d.eco.label}>
                  {d.eco.text}
                  <ArrowSquareOut aria-hidden />
                </a>
              ) : (
                <Link href={d.eco.href} className={cx('tag tag-outline', s.ecoTag)} title={d.eco.label}>
                  {d.eco.text}
                </Link>
              )
            ) : (
              <span className={cx('tag tag-outline', s.ecoTag)}>{d.eco.text}</span>
            )
          ) : (
            <span className={s.muted}>{t('No design ECO linked')}</span>
          )}
          {d.raiseEco && (
            <a href={d.raiseEco.href} {...VIGIE_LINK_ATTRS} className={cx('btn btn-ghost', s.inlineLink)}>
              {d.raiseEco.label}
              <ArrowSquareOut aria-hidden />
            </a>
          )}
        </div>
      </div>

      <div className={s.section}>
        <Eyebrow>{t('Interventions')}</Eyebrow>
        {d.interventions.map((i) => (
          <div key={i.number} className={s.ivRow}>
            <div className={s.stack}>
              <span>
                <span className={s.id}>{i.number}</span> {i.line}
              </span>
              {i.doneLine && <span className={s.sub}>{i.doneLine}</span>}
            </div>
            <span className={i.statusClass}>{i.status}</span>
            {i.done && <FollowupFormButton kind="done" target={i.number} label={i.done.label} ariaLabel={i.done.ariaLabel} context={`${i.number} · ${context}`} form={i.done.form} size="row" />}
          </div>
        ))}
        {!d.interventions.length && <span className={s.muted}>{t('No intervention yet')}</span>}
      </div>

      {d.config.length > 0 && (
        <div className={s.section}>
          <Eyebrow>{t('As-maintained configuration')}</Eyebrow>
          <div className={s.config}>
            {d.config.map((c) => (
              <span key={c.ref} className={cx('tag tag-neutral', s.tag105)}>
                {c.ref} · {t('rev')} {c.revision}
              </span>
            ))}
          </div>
        </div>
      )}

      {d.actions && (
        <>
          {d.actions.closeHint && <span className={s.hint}>{d.actions.closeHint}</span>}
          <div className={s.drawerActions}>
            {d.actions.diagnose && (
              <FollowupFormButton kind="diagnose" target={d.number} from={d.actions.from} label={d.actions.diagnose.label} context={context} form={d.actions.diagnose.form} variant="primary" />
            )}
            {d.actions.close && <CloseClaimButton number={d.number} from={d.actions.from} label={d.actions.close.label} />}
            <FollowupFormButton kind="plan" target={d.number} label={d.actions.plan.label} context={context} form={d.actions.plan.form} />
            <FollowupFormButton kind="edit" target={d.number} label={d.actions.edit.label} context={context} form={d.actions.edit.form} variant="ghost" />
          </div>
        </>
      )}
    </Drawer>
  );
}
