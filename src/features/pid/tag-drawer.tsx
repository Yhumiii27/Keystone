// P&ID tag drawer (docs/spec/09 §6.10, template 2518–2529, pidTagVals 4781), opened by `?tag=LT-101` and closed (×,
// scrim, Esc) to the register URL. Header "tag · kind", scope and status tags; title = description; Tag record (the
// BOM reference opens the project BOM line, the activity opens the plan's activity drawer); "Map to a BOM reference"
// (candidates — editors only, saved); the client-equipment and missing-feedback notices; "Part record" (the shared
// part drawer over this screen), "Unlink", and "Add reference to project BOM" (status Not in BOM → the project BOM
// with the part open, where "Add article" adds it). Server Component; the mapping buttons are client islands.
// R-108 (E-6 = a): the candidates come from the whole catalogue (search field and type filter, the project BOM's articles
// first and marked "In the BOM"); picking an article outside the BOM asks "Link and add to the BOM" (with a quantity, for the
// BOM's editors) or "Link only". The drawer never offers to create a part (A-1b).
import { Cube, Info, Plus, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Eyebrow } from '@/components/app/Eyebrow';
import { KeyValueList } from '@/components/app/KeyValueList';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import type { T } from '@/i18n/translate';
import type { PidTagDrawerView } from './model';
import { CandidateButton, CandidateSearch, UnlinkButton } from './pid-buttons';
import s from './pid.module.css';

export interface PidTagDrawerProps {
  code: string;
  view: PidTagDrawerView;
  /** Mapping allowed (P&ID inside the viewer's workspace, project not read-only). */
  canEdit: boolean;
  /** R-108: "Link and add to the BOM" allowed (the project's BOM editable for the viewer). */
  canEditBom?: boolean;
  t: T;
}

export function PidTagDrawer({ code, view: d, canEdit, canEditBom = false, t }: PidTagDrawerProps) {
  return (
    <Drawer
      open
      closeHref={d.closeHref}
      id={d.head}
      title={d.title}
      meta={
        <>
          <span className={d.scopeClass}>{d.scope}</span>
          <span className={d.statusClass}>{d.status}</span>
        </>
      }
    >
      <KeyValueList
        title={t('Tag record')}
        items={d.record.map((r) => ({
          id: r.k,
          k: r.k,
          v: r.href ? (
            <Link href={r.href} className={s.kvLink}>
              {r.v}
            </Link>
          ) : (
            r.v
          ),
          color: 'var(--color-text)',
        }))}
      />

      {canEdit && d.candidates && (
        <div className={s.section}>
          <Eyebrow>{t('Map to a BOM reference')}</Eyebrow>
          {d.search && <CandidateSearch code={code} tag={d.tag} search={d.search} />}
          {d.candidates.map((c) => (
            <CandidateButton key={c.ref} code={code} tag={d.tag} c={c} current={c.ref === d.partRef} canAddToBom={canEditBom} />
          ))}
          {d.search?.empty && <span className={s.hint}>{d.search.empty}</span>}
          {d.search?.more && <span className={s.hint}>{d.search.more}</span>}
          <span className={s.hint}>{t('Search the whole catalogue · articles of the project BOM first · pick one to link the tag')}</span>
        </div>
      )}

      {d.isClient && (
        <div className={cx(s.callout, s.calloutInfo)}>
          <Info className={s.calloutIcon} aria-hidden />
          <span className={s.pretty}>{t('Client-supplied equipment: no BOM reference expected. Its overlay instruments are listed as separate tags in Keystone scope.')}</span>
        </div>
      )}
      {d.fbWarn && (
        <div className={cx(s.callout, s.calloutWarn)} role="note">
          <Warning className={s.calloutIconWarn} aria-hidden />
          <span className={s.pretty}>{t('Actuator wired to the PLC without state feedback — add a position or run-status sensor before release for construction.')}</span>
        </div>
      )}

      {(d.partHref || (canEdit && (d.canUnlink || d.bomHref))) && (
        <div className={s.actions}>
          {d.partHref && (
            <ButtonLink variant="secondary" icon={Cube} className={s.btn125} href={d.partHref} scroll={false}>
              {t('Part record')}
            </ButtonLink>
          )}
          {canEdit && d.canUnlink && <UnlinkButton code={code} tag={d.tag} />}
          {canEdit && d.bomHref && (
            <ButtonLink variant="primary" icon={Plus} className={s.btn125} href={d.bomHref}>
              {t('Add reference to project BOM')}
            </ButtonLink>
          )}
        </div>
      )}
    </Drawer>
  );
}
