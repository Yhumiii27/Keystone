// Shared part record drawer (docs/spec/09 §2, template 2582–2613, logic 4293–4304 + 5062), opened with `?part=<ref>`
// on the PLM catalogue and on every screen that renders it (BOM, stock, deliveries, NCR, P&ID…). Server Component:
//   <PartDrawer partRef="EL-VFD-200" projectCode="HLT-026" closeHref="/projects/HLT-026/bom" />
// - `closeHref`: the page URL without `?part=` (×, scrim and Esc go there; selecting another part keeps it);
// - `projectCode`: the project of a project-scoped screen (prefills Raise ECO and the Codex deposit; optional).
// The reference is matched case-insensitively; an unknown one renders nothing. Header: ref · status tag · "Open in
// PLM" · ×; title; status banner; Documents (Codex records citing the part — the prototype's «Freeze» label, 09 OQ3 —
// "Propose release" → Codex deposit); then Identification, Commercial & export (HS code,
// export restriction), Equivalent parts (+ Register equivalent), Spare parts list, Stock by location (Σ on hand —
// STOCK_BY_REF fixed), Projects equipped (where-used in project BOMs), Used in (assembly chains), Installed base
// (the installed base and its as-maintained configuration), Revisions (REV_DIFF), Drawings, Engineering changes (Vigie ECOs,
// "Open in Vigie", "Raise ECO" → Vigie's new-ECO form prefilled with the part; nothing is created in Keystone).
import { ArrowRight, ArrowSquareOut, ArrowsClockwise, Database, GitBranch, ListChecks, UploadSimple, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { FormDef } from '@/components/app/form-def';
import { KeyValueList } from '@/components/app/KeyValueList';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import { canSee } from '@/config/screens';
import { getPartDrawer, listEquivalentCandidates } from '@/server/dal/plm';
import { VIGIE_LINK_ATTRS } from '@/server/integrations/vigie/links';
import { getI18n, getLastProject, getViewer } from '@/server/session';
import { localizePlmForm, registerEquivalentFormDef } from './forms';
import { partDrawerView, type DrawerRow, type EcoRowView, type PartDrawerView } from './model';
import { RegisterEquivalentButton } from './plm-buttons';
import s from './plm.module.css';

export interface PartDrawerProps {
  partRef: string;
  projectCode?: string;
  closeHref: string;
}

export async function PartDrawer({ partRef, projectCode, closeHref }: PartDrawerProps) {
  const ref = partRef.trim();
  if (!ref) return null;
  const [found, { t, lang }, viewer, lastProject] = await Promise.all([getPartDrawer(ref), getI18n(), getViewer(), getLastProject()]);
  // Catalogue references are upper case: `?part=el-vfd-200` opens EL-VFD-200.
  const data = found ?? (ref !== ref.toUpperCase() ? await getPartDrawer(ref.toUpperCase()) : null);
  if (!data) return null;
  // "Register equivalent" for the viewers whose workspace holds the parts catalogue (the writers check it again).
  const candidates = canSee(viewer.role, 'plm') ? await listEquivalentCandidates(data.record.ref) : null;
  const view = partDrawerView(data, { role: viewer.role, closeHref, projectCode: projectCode ?? null, fallbackProject: lastProject, equivalentCandidates: candidates }, t, lang);
  const register = view.equivalents.register
    ? { form: localizePlmForm(registerEquivalentFormDef(view.equivalents.register.candidates), t, lang), context: `${view.ref} · ${view.name}` }
    : null;
  return <PartDrawerPanel key={view.ref} view={view} register={register} />;
}

function RowBody({ r }: { r: DrawerRow }) {
  return (
    <>
      <span className={s.rowMain}>
        <span className={cx(s.rowTitle, s.rowTitleText)}>{r.title}</span>
        {r.sub && <span className={s.rowSub}>{r.sub}</span>}
      </span>
      {r.aside != null && <span className={s.asideNum}>{r.aside}</span>}
      {r.tagLabel != null && <span className={cx(r.tagClass, s.rowTag)}>{r.tagLabel}</span>}
      {r.arrow && <ArrowRight className={s.arrow} aria-hidden />}
    </>
  );
}

const columns = (r: DrawerRow) => 1 + (r.aside != null ? 1 : 0) + (r.tagLabel != null ? 1 : 0) + (r.arrow ? 1 : 0);

function Row({ r, className }: { r: DrawerRow; className?: string }) {
  const n = columns(r);
  return (
    <Link href={r.href} scroll={r.samePage ? false : undefined} className={cx(s.row, n === 3 && s.row3, n >= 4 && s.row4, className)}>
      <RowBody r={r} />
    </Link>
  );
}

function EcoRow({ r }: { r: EcoRowView }) {
  return (
    <div className={s.ecoLine}>
      <Link href={r.href} className={cx(s.row, s.row3)}>
        <span className={s.rowMain}>
          <span className={s.rowTitle}>{r.title}</span>
          <span className={s.rowSub}>{r.sub}</span>
          {r.syncNote && (
            <span className={s.syncNote}>
              <ArrowsClockwise aria-hidden />
              {r.syncNote}
            </span>
          )}
        </span>
        <span className={cx(r.tagClass, s.rowTag)}>{r.tagLabel}</span>
        <ArrowRight className={s.arrow} aria-hidden />
      </Link>
      <a href={r.vigieHref} {...VIGIE_LINK_ATTRS} className={s.vigieLink} aria-label={`${r.vigieLabel} · ${r.title}`} title={r.vigieLabel}>
        <ArrowSquareOut aria-hidden />
      </a>
    </div>
  );
}

function Label({ children, gap = true }: { children: string; gap?: boolean }) {
  return <span className={cx(s.label, gap && s.labelGap)}>{children}</span>;
}

function Empty({ text }: { text: string | null }) {
  return text ? <span className={s.empty}>{text}</span> : null;
}

export interface PartDrawerPanelProps {
  view: PartDrawerView;
  /** "Register equivalent" dialog (translated definition), when the viewer may edit the catalogue. */
  register: { form: FormDef; context: string } | null;
}

export function PartDrawerPanel({ view: v, register }: PartDrawerPanelProps) {
  return (
    <Drawer
      open
      closeHref={v.closeHref}
      id={v.ref}
      title={v.name}
      meta={
        <>
          <span className={v.statusClass}>{v.status}</span>
          <ButtonLink variant="secondary" icon={Database} href={v.openPlm.href} scroll={v.openPlm.samePage ? false : undefined} className={s.headBtn}>
            {v.openPlm.label}
          </ButtonLink>
        </>
      }
    >
      {v.warn && (
        <div className={s.warn} role="note">
          <Warning className={s.warnIcon} aria-hidden />
          <span className={s.warnText}>{v.warn}</span>
        </div>
      )}

      <div className={s.section}>
        <div className={s.sectionHead}>
          <Label gap={false}>{v.documents.label}</Label>
          <ButtonLink variant="ghost" icon={UploadSimple} href={v.documents.deposit.href} className={s.ghost}>
            {v.documents.deposit.label}
          </ButtonLink>
        </div>
        {v.documents.rows.map((r) => (
          <Link key={r.key} href={r.href} className={cx(s.row, s.row3, s.docRow)}>
            <span className={s.rowMain}>
              <span className={s.rowTitle}>{r.title}</span>
              <span className={s.rowSub}>{r.sub}</span>
            </span>
            <span className={s.aside}>{r.aside}</span>
            <span className={cx(r.tagClass, s.rowTag)}>{r.tagLabel}</span>
          </Link>
        ))}
      </div>

      <div className={s.grid}>
        <KeyValueList title={v.identification.label} items={v.identification.items} />
        <KeyValueList title={v.commercial.label} items={v.commercial.items} />

        <div className={s.section}>
          <Label>{v.equivalents.label}</Label>
          {v.equivalents.rows.map((r) => (
            <Row key={r.key} r={r} />
          ))}
          <Empty text={v.equivalents.empty} />
          {v.equivalents.register && register && <RegisterEquivalentButton partRef={v.ref} label={v.equivalents.register.label} form={register.form} context={register.context} />}
        </div>

        {v.spares && (
          <div className={s.section}>
            <Label>{v.spares.label}</Label>
            {v.spares.rows.map((r) => (
              <Row key={r.key} r={r} className={s.gap8} />
            ))}
            <ButtonLink variant="ghost" href={v.spares.open.href} icon={ListChecks} className={s.ghostBlock}>
              {v.spares.open.label}
            </ButtonLink>
          </div>
        )}

        <div className={s.section}>
          <Label>{v.stock.label}</Label>
          {v.stock.rows.map((r) => (
            <Row key={r.key} r={r} />
          ))}
          <Empty text={v.stock.empty} />
          {v.stock.totals.length > 0 && <KeyValueList items={v.stock.totals} />}
        </div>

        <div className={s.section}>
          <Label>{v.projects.label}</Label>
          {v.projects.rows.map((r) => (
            <Row key={r.key} r={r} />
          ))}
          <Empty text={v.projects.empty} />
        </div>

        {v.usedIn && (
          <div className={s.section}>
            <Label>{v.usedIn.label}</Label>
            {v.usedIn.chains.map((c) => (
              <span key={c} className={s.chain}>
                {c}
              </span>
            ))}
          </div>
        )}

        <div className={s.section}>
          <Label>{v.machines.label}</Label>
          {v.machines.rows.map((r) => (
            <Row key={r.key} r={r} />
          ))}
          <Empty text={v.machines.empty} />
        </div>

        <div className={s.section}>
          <Label>{v.revisions.label}</Label>
          <KeyValueList items={[v.revisions.current]} />
          {v.revisions.events.map((e) => (
            <div key={e.key} className={s.revEvent}>
              <span className={s.revTitle}>{e.title}</span>
              <span className={s.revSub}>
                {e.ecoHref ? (
                  <Link href={e.ecoHref} className={s.revSubLink}>
                    {e.sub}
                  </Link>
                ) : (
                  e.sub
                )}
              </span>
              {e.lines.map((l) => (
                <div key={l.key} className={s.revLine}>
                  <span className={s.revPath}>
                    <span className={s.revPathRef}>{l.path}</span>
                    <span className={s.rowSub}>{l.name}</span>
                  </span>
                  <span className={s.revChange}>{l.change}</span>
                  <span className={cx(l.kindClass, s.rowTag)}>{l.kind}</span>
                </div>
              ))}
            </div>
          ))}
          <Empty text={v.revisions.empty} />
        </div>

        <div className={s.section}>
          <Label>{v.drawings.label}</Label>
          {v.drawings.rows.map((r) => (
            <Row key={r.key} r={r} />
          ))}
          <Empty text={v.drawings.empty} />
        </div>

        {v.ecos && (
          <div className={s.section}>
            <div className={cx(s.sectionHead, s.labelGap)}>
              <Label gap={false}>{v.ecos.label}</Label>
              {v.ecos.raise && (
                <a href={v.ecos.raise.href} {...VIGIE_LINK_ATTRS} title={v.ecos.raise.title} className={cx('btn btn-ghost', s.ghost)}>
                  <GitBranch aria-hidden />
                  {v.ecos.raise.label}
                  <ArrowSquareOut aria-hidden />
                </a>
              )}
            </div>
            {v.ecos.rows.map((r) => (
              <EcoRow key={r.key} r={r} />
            ))}
            <Empty text={v.ecos.empty} />
          </div>
        )}
      </div>
    </Drawer>
  );
}
