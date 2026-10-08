// ECO drawer (docs/spec/09 §4.8, template 1346–1373, ecoVals 4352–4369), opened by `?eco=ECO-2026-015` and closed
// (×, scrim, Esc) to the register URL. Vigie owns the ECO: the drawer shows what Vigie reports — step indicator, impact
// analysis, parts concerned (→ part record), effectivity and dispositions per project BOM (→ project BOM) and machine,
// the release lock, the approvals — with "Open in Vigie". The controls the prototype had for interchangeability and
// dispositions are "Manage in Vigie" links; the viewer's own approval key keeps Reject / Approve (sent to Vigie,
// "Pending sync with Vigie" until Vigie takes it). Server Component; the decision buttons are client islands.
import { ArrowRight, ArrowsClockwise, Info, LockSimple, Package, Wrench } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { FlowStepper } from '@/components/app/Stepper';
import { KeyValueList } from '@/components/app/KeyValueList';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import type { T } from '@/i18n/translate';
import type { EcoDrawerView, TargetView } from './model';
import { ApprovalButtons } from './progress-buttons';
import { VigieLink } from './vigie-link';
import s from './eco.module.css';

export interface EcoDrawerProps {
  view: EcoDrawerView;
  /** Decisions allowed (Change orders inside the viewer's workspace). */
  canEdit: boolean;
  t: T;
}

function Target({ d, vigieUrl, t }: { d: TargetView; vigieUrl: string; t: T }) {
  return (
    <div className={s.target}>
      <div className={s.targetTop}>
        <Link href={d.href} className={s.targetLink}>
          <span className={s.targetName}>{d.name}</span>
          <span className={s.targetSub}>{d.sub}</span>
        </Link>
        <span className={s.targetRev}>{d.revText}</span>
        <span className={cx(d.tagClass, s.nowrap)}>{d.label}</span>
      </div>
      <div className={s.targetBottom}>
        <span className={s.decided}>{d.decidedBy}</span>
        {d.manage && (
          <VigieLink href={vigieUrl} variant="ghost" size="compact" label={`${t('Manage in Vigie')} · ${d.name}`}>
            {t('Manage in Vigie')}
          </VigieLink>
        )}
      </div>
    </div>
  );
}

export function EcoDrawer({ view: d, canEdit, t }: EcoDrawerProps) {
  return (
    <Drawer
      open
      closeHref={d.closeHref}
      id={d.number}
      title={d.title}
      meta={
        <>
          <span className="tag tag-neutral">{d.type}</span>
          <span className={d.statusClass}>{d.status}</span>
        </>
      }
    >
      <div className={s.drawerActions}>
        <VigieLink href={d.vigieUrl} label={`${t('Open in Vigie')} ${d.number}`}>
          {t('Open in Vigie')}
        </VigieLink>
        {d.sync && <span className={cx('tag tag-outline', s.syncTag)}>{d.sync}</span>}
      </div>
      <span className={s.mirrorNote}>
        <Info aria-hidden />
        {t('Managed in Vigie — Keystone records your approval and step requests and sends them to Vigie')}
      </span>

      <FlowStepper steps={d.steps.map((x) => ({ label: x.label, reached: x.reached }))} rejected={d.rejected} meta={d.raisedBy} />

      <div className={s.sections}>
        <KeyValueList title={t('Impact analysis')} items={d.impact.map((x) => ({ k: x.k, v: x.v, color: x.color }))} />

        <div className={s.section}>
          <span className={s.eyebrow}>{t('Parts concerned')}</span>
          {d.parts.map((p) => (
            <Link key={p.ref} href={p.href} className={s.partRow}>
              <span className={s.partText}>
                <span className={s.num}>{p.ref}</span>
                <span className={s.partSub}>{p.name}</span>
              </span>
              <span className={cx(p.statusClass, s.nowrap)}>{p.status}</span>
            </Link>
          ))}
        </div>

        <div className={s.section6}>
          <div className={s.effHead}>
            <span className={s.effTitle}>{t('Effectivity & dispositions')}</span>
            <span className={s.revText}>{d.revText}</span>
            <span className={cx(d.pending.tagClass, s.nowrap)}>{d.pending.text}</span>
          </div>
          <div className={s.interRow}>
            {d.interch.manage && (
              <VigieLink href={d.vigieUrl} variant="ghost" size="compact" label={`${t('Manage in Vigie')} · ${t('Set interchangeability')}`}>
                {t('Manage in Vigie')}
              </VigieLink>
            )}
            <span className={cx(d.interch.tagClass, s.nowrap)}>{d.interch.label}</span>
            <span className={s.interHint}>{d.interch.hint}</span>
          </div>
          {d.locked && (
            <div className={cx(s.banner, s.bannerLock)} role="status">
              <LockSimple className={s.bannerIcon} aria-hidden />
              <span className={s.bannerText}>{t('Release locked until interchangeability and every disposition are set.')}</span>
            </div>
          )}
          <div className={s.groupLabel}>{d.projectsTitle}</div>
          {d.projects.map((x) => (
            <Target key={x.key} d={x} vigieUrl={d.vigieUrl} t={t} />
          ))}
          <div className={s.groupLabelM}>{d.machinesTitle}</div>
          {d.machines.map((x) => (
            <Target key={x.key} d={x} vigieUrl={d.vigieUrl} t={t} />
          ))}
          {d.noMachines && <span className={s.noMachines}>{d.noMachines}</span>}
          {d.retrofit && (
            <div className={cx(s.banner, s.bannerNeutral)}>
              <Wrench className={s.bannerIcon} aria-hidden />
              <span className={s.bannerTextPush}>{d.retrofit.text}</span>
              <ButtonLink variant="ghost" size="compact" nowrap iconRight={ArrowRight} href={d.retrofit.href}>
                {d.retrofit.action}
              </ButtonLink>
            </div>
          )}
          {d.pinned && (
            <div className={cx(s.banner, s.bannerNeutral, s.bannerTop)}>
              <Package className={s.bannerIconTop} aria-hidden />
              <span className={s.bannerText}>{d.pinned}</span>
            </div>
          )}
        </div>

        <div className={s.section6}>
          <span className={s.eyebrow2}>{t('Approvals')}</span>
          {d.approvals.map((a) => (
            <div key={a.key} className={s.apprRow}>
              <span className={s.apprText}>
                <span className={s.apprLabel}>{a.label}</span>
                <span className={s.apprWho}>{a.who}</span>
              </span>
              <div className={s.apprRight}>
                {canEdit && a.canAct && <ApprovalButtons number={d.number} approvalKey={a.key} />}
                {a.sync && (
                  <span className={s.apprSync}>
                    <ArrowsClockwise className={s.syncIcon} aria-hidden />
                    <span>{a.sync}</span>
                  </span>
                )}
                <span className={a.tagClass}>{a.state}</span>
              </div>
            </div>
          ))}
          {d.hint && <span className={s.hint}>{d.hint}</span>}
        </div>
      </div>
    </Drawer>
  );
}
