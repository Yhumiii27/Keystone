// NCR drawer (docs/spec/07 §2.3.a, template 1912–1924, ncrVals 4624), opened by `?ncr=NCR-029` and closed (×, scrim, Esc)
// to the log URL. Vigie owns the NCR: the drawer shows what Vigie reports — step indicator, severity, root cause,
// containment & corrective action, the record — with "Open in Vigie"; the severity the prototype edited and the 8D
// report are managed in Vigie ("Manage in Vigie", "8D report" open Vigie). The viewer's own step decision stays: "Move
// to <next step>", or for the quality manager the verification ("Move to Closed" / "Back to corrective action"), sent
// to Vigie ("Pending sync with Vigie" until Vigie takes it). Links: activity (plan), part record (PLM), the open ECO of
// the part, the project's purchase orders carrying the part, the impacted deliverable. Server Component; the progress
// buttons are client islands.
import { ArrowsClockwise, Cube, FilePdf, GitBranch, Info, ShoppingCart, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Eyebrow } from '@/components/app/Eyebrow';
import { KeyValueList } from '@/components/app/KeyValueList';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import { VigieLink } from '@/features/eco/vigie-link';
import type { T } from '@/i18n/translate';
import type { NcrDrawerView, RecordRow } from './model';
import { NcrStepButton, NcrVerifyButtons } from './quality-buttons';
import { QualityStepper } from './stepper';
import s from './quality.module.css';

/** Record value: plain text, one link (impacted deliverable) or several (linked NCRs). */
export function RecordValue({ r }: { r: RecordRow }) {
  if (r.links?.length)
    return (
      <span className={s.recordLinks}>
        {r.links.map((l, i) => (
          <Link key={l.href} href={l.href} className={s.recordLink} scroll={false}>
            {l.label}
            {i < r.links!.length - 1 ? ',' : ''}
          </Link>
        ))}
      </span>
    );
  if (r.href)
    return (
      <Link href={r.href} className={s.recordLink} scroll={false}>
        {r.v}
      </Link>
    );
  return <>{r.v}</>;
}

export function NcrDrawer({ code, view: d, t }: { code: string; view: NcrDrawerView; t: T }) {
  return (
    <Drawer
      open
      closeHref={d.closeHref}
      id={d.head}
      title={d.title}
      meta={
        <>
          <span className={d.severityClass}>{d.severity}</span>
          <span className={d.statusClass}>{d.status}</span>
        </>
      }
    >
      {d.vigieUrl && (
        <>
          <div className={s.drawerActions}>
            <VigieLink href={d.vigieUrl} label={`${t('Open in Vigie')} ${d.number}`}>
              {t('Open in Vigie')}
            </VigieLink>
            {d.sync && (
              <span className={cx('tag tag-outline', s.syncTag)}>
                {d.sync}
              </span>
            )}
          </div>
          <span className={s.mirrorNote}>
            <Info aria-hidden />
            {t('Managed in Vigie — Keystone records your step decisions and sends them to Vigie')}
          </span>
        </>
      )}
      {!d.vigieUrl && d.sync && (
        <span className={s.mirrorNote}>
          <ArrowsClockwise aria-hidden />
          {d.sync}
        </span>
      )}

      <QualityStepper steps={d.steps} label={t('Progress')} />

      <div className={s.field}>
        <span className={s.fieldLabel}>{t('Severity')}</span>
        <div className={s.fieldRow}>
          <div className={s.seg} role="group" aria-label={t('Severity')}>
            {d.severities.map((o) => (
              <span key={o.label} className={cx(s.segOpt, o.on && s.segOn)} aria-current={o.on ? 'true' : undefined}>
                {o.label}
              </span>
            ))}
          </div>
          {d.vigieUrl && (
            <VigieLink href={d.vigieUrl} variant="ghost" size="compact" label={`${t('Manage in Vigie')} · ${t('Severity')}`}>
              {t('Manage in Vigie')}
            </VigieLink>
          )}
        </div>
      </div>

      <div className={s.section}>
        <Eyebrow>{t('Root cause')}</Eyebrow>
        <span className={s.text}>{d.rootCause}</span>
      </div>
      <div className={s.section}>
        <Eyebrow>{t('Containment & corrective action')}</Eyebrow>
        <span className={s.text}>{d.action}</span>
      </div>

      <KeyValueList title={t('Record')} items={d.record.map((r) => ({ id: r.k, k: r.k, v: <RecordValue r={r} />, color: 'var(--color-text)' }))} />

      {d.verifyHint && <span className={s.hint}>{d.verifyHint}</span>}

      <div className={s.drawerActions}>
        {d.move && <NcrStepButton code={code} number={d.number} step={d.move.target} label={d.move.label} place="drawer" />}
        {d.verify && <NcrVerifyButtons code={code} number={d.number} closeLabel={d.verify.closeLabel} backLabel={d.verify.backLabel} place="drawer" />}
        {d.activityHref && (
          <ButtonLink variant="secondary" size="sm" icon={TreeStructure} href={d.activityHref}>
            {t('Open activity')}
          </ButtonLink>
        )}
        {d.partHref && (
          <ButtonLink variant="secondary" size="sm" icon={Cube} href={d.partHref}>
            {t('Part record')}
          </ButtonLink>
        )}
        {d.eco && (
          <ButtonLink variant="secondary" size="sm" icon={GitBranch} href={d.eco.href}>
            {d.eco.number}
          </ButtonLink>
        )}
        {d.orders.map((po) => (
          <ButtonLink key={po.number} variant="secondary" size="sm" icon={ShoppingCart} href={po.href} aria-label={`${t('Purchase order')} ${po.number}`}>
            {po.number}
          </ButtonLink>
        ))}
        {d.vigieUrl && (
          <VigieLink href={d.vigieUrl} variant="ghost" label={`${t('8D report')} · ${t('Open in Vigie')} ${d.number}`}>
            <FilePdf aria-hidden />
            {t('8D report')}
          </VigieLink>
        )}
      </div>
    </Drawer>
  );
}
