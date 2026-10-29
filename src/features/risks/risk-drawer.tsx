// Risk drawer (docs/spec/07 §2.1 riskVals, template 1814–1828): opened by `?risk=R-03`, closed (×, scrim, Esc)
// to the register URL. Header "R-03 · Supplier / delivery" + level tag "Critical · 16"; title; Probability and
// Impact segments; Response strategy; (delivery 7, Q-1) the cost if it occurs, editable; Response plan; Assessment (owner,
// trigger, linked activity, EMV = cost × P / 5, contingency draw if it occurs); actions Open activity · What-if levelling ·
// Close risk / Reopen.
import { Scales, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import { Eyebrow } from '@/components/app/Eyebrow';
import { KeyValueList } from '@/components/app/KeyValueList';
import { ButtonLink } from '@/components/ds/Button';
import { Drawer } from '@/components/ds/Drawer';
import type { T } from '@/i18n/translate';
import type { RiskDrawerView } from './model';
import { RiskCostField, RiskScales, RiskStatusToggle } from './risk-controls';
import s from './risks.module.css';

export interface RiskDrawerProps {
  code: string;
  view: RiskDrawerView;
  /** P / I / response segments and the Close / Reopen toggle are editable. */
  canEdit: boolean;
  t: T;
}

export function RiskDrawer({ code, view, canEdit, t }: RiskDrawerProps) {
  return (
    <Drawer open closeHref={view.closeHref} id={view.head} title={view.title} meta={<span className={view.levelClass}>{view.levelText}</span>}>
      <RiskScales
        key={view.id}
        code={code}
        riskId={view.id}
        version={view.version}
        values={{ probability: view.probability, impact: view.impact, response: view.response, status: view.status }}
        canEdit={canEdit}
      />
      {canEdit && <RiskCostField key={`${view.id}:${view.cost}`} code={code} riskId={view.id} version={view.version} cost={view.cost} />}
      <div className={s.section}>
        <Eyebrow>{t('Response plan')}</Eyebrow>
        <span className={s.plan}>{view.plan}</span>
      </div>
      <KeyValueList title={t('Assessment')} items={view.meta.map((m) => ({ k: m.k, v: m.v, color: 'var(--color-text)' }))} />
      <div className={s.actions}>
        {view.activityHref && (
          <ButtonLink variant="secondary" size="sm" icon={TreeStructure} href={view.activityHref}>
            {t('Open activity')}
          </ButtonLink>
        )}
        <ButtonLink variant="secondary" size="sm" icon={Scales} href={view.whatifHref}>
          {t('What-if levelling')}
        </ButtonLink>
        {canEdit && <RiskStatusToggle code={code} riskId={view.id} version={view.version} label={view.toggleLabel} next={view.toggleNext} />}
      </div>
    </Drawer>
  );
}
