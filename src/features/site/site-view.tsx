// Site (chantier) — screen body (docs/spec/10 §3, template 2268–2309): the "Display" segmented control and the three
// tabs — Readiness & go (KPIs, Go chantier card, site sheet, client prerequisites, equipment, the Cursus individual
// go / no go), Team & mobilisation (KPIs, rotation plan, collisions, mission costs) and Daily execution (KPIs, daily
// reports, site punch list, Vigie's HSE register) — or the empty state of a project without a site sheet.
// Server Component; the buttons that write are client islands (site-buttons.tsx), shown to editors only. Links to
// Cursus and Vigie open outside Keystone. R-117: the punch list is the project's single list — the items raised on site by
// default, "All" on demand — read-only here as in the prototype (Start / Close are on Inspections & punch list). R-118
// (D-3 'a'): the project's leads get "Prepare the site" on the empty state, "Edit site sheet" and the lines' Add / Edit /
// Remove (`view.entry`); every table has its empty message.
import {
  ArrowSquareOut, ArrowsClockwise, Chats, Check, CheckCircle, Eye, FirstAid, LockSimple, Warning, WarningCircle,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { ClickableRow } from '@/components/app/ClickableRow';
import { FilterBar, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { CardGrid, SectionCard, Stack } from '@/components/app/SectionCard';
import { ButtonLink } from '@/components/ds/Button';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Segmented } from '@/components/ds/Segmented';
import { Ellipsis, Table, Td, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import { CURSUS_LINK_ATTRS } from '@/server/integrations/cursus/links';
import { VIGIE_LINK_ATTRS } from '@/server/integrations/vigie/links';
import { PhotosButton, type PhotoView } from '@/features/photos/photo-gallery';
import { CURSUS_CARD_ID } from './links';
import type { ExecView, KpiView, LineEntry, ReadyView, SheetEntry, SiteView, TeamView } from './model';
import { clientDecisionsHref } from '@/features/meetings/model';
import type { SiteLineKind } from '@/domain/site-sheet';
import {
  AddLineButton, ArbitrateButton, ConfirmEquipmentButton, EditLineButton, EditSheetButton, PrepareSiteButton, PrerequisiteButton, RemindButton, RemoveLineButton,
  SyncCursusButton,
} from './site-buttons';
import { RaiseRiskButton } from './prerequisite-risk-button';
import s from './site.module.css';

export interface SiteBodyProps {
  code: string;
  view: SiteView;
  /** Edit controls (steps, Cursus reminder and sync): Site inside the viewer's workspace, project not read-only. */
  canEdit: boolean;
  /** D-5: the "Client communication log" link to the project's client decisions (when the viewer may see Meetings). Default shown. */
  showCommLog?: boolean;
  /** R-126: photos stored by Keystone of the daily reports and the site punch items (by number); none when not given. */
  photos?: SitePhotos;
  /** The project's label, the sub-line of the site sheet's dialogs (R-118). */
  context?: string;
  t: T;
}

export interface SitePhotos {
  /** Add / remove (the viewer may edit the Site screen of the project). */
  canEdit: boolean;
  /** R-117: the photos of the items raised by an inspection follow Inspections & punch list's rights (shown with "All"). */
  canEditItp?: boolean;
  reports: Record<string, PhotoView[]>;
  punch: Record<string, PhotoView[]>;
}

export function SiteBody({ code, view, canEdit, showCommLog = true, photos, context = code, t }: SiteBodyProps) {
  return (
    <Stack>
      {view.empty ? (
        <div className={s.empty}>
          <span>{view.empty}</span>
          {view.prepare && (
            <span className={s.emptyAction}>
              <PrepareSiteButton code={code} context={context} form={view.prepare.form} values={view.prepare.values} />
            </span>
          )}
        </div>
      ) : (
        <>
          <FilterBar>
            <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
            <Segmented wrap label={t('Display')} value={view.tab} options={view.segs.map((o) => ({ value: o.value, label: o.label, href: o.href }))} />
          </FilterBar>
          {view.tab === 'ready' && view.ready && <ReadyTab code={code} v={view.ready} canEdit={canEdit} entry={view.entry} context={context} t={t} />}
          {view.tab === 'team' && view.team && <TeamTab code={code} v={view.team} entry={view.entry} t={t} />}
          {view.tab === 'exec' && view.exec && <ExecTab code={code} v={view.exec} showCommLog={showCommLog} photos={photos} t={t} />}
        </>
      )}
    </Stack>
  );
}

function Kpis({ kpis }: { kpis: KpiView[] }) {
  return (
    <KpiGrid>
      {kpis.map((k) => (
        <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} className={s.pretty} />
      ))}
    </KpiGrid>
  );
}

/** R-118: "Add …" in a table's header for the leads (no form → nothing: the prerequisite's empty plan is explained). */
function AddLine({ code, kind, entry }: { code: string; kind: SiteLineKind; entry: SheetEntry | null }) {
  const form = entry?.add[kind];
  return form ? <AddLineButton code={code} kind={kind} label={form.title} form={form} /> : null;
}

/** R-118: "Edit" / "Remove" of a line for the leads (what the line allows). */
function LineButtons({ code, kind, position, label, line, entry }: { code: string; kind: SiteLineKind; position: number; label: string; line: LineEntry | null; entry: SheetEntry | null }) {
  const form = line?.form ?? entry?.edit[kind];
  if (!line || !entry) return null;
  return (
    <>
      {line.editable && form && <EditLineButton code={code} kind={kind} position={position} stamp={line.stamp} label={label} form={form} values={line.values} />}
      {line.removable && <RemoveLineButton code={code} kind={kind} position={position} stamp={line.stamp} label={label} />}
    </>
  );
}

// ── Readiness & go ───────────────────────────────────────────────────────────────────────────────────

function ReadyTab({ code, v, canEdit, entry, context, t }: { code: string; v: ReadyView; canEdit: boolean; entry: SheetEntry | null; context: string; t: T }) {
  return (
    <>
      <Kpis kpis={v.kpis} />
      <CardGrid min={380}>
        <SectionCard
          gap={10}
          title={t('Go chantier — five conditions')}
          subtitle={t('Green only when every condition is confirmed · checked daily from J-30')}
          actions={<span className={cx(v.go.tagClass, s.goTag)}>{v.go.tag}</span>}
        >
          <div className={s.goGrid}>
            {v.go.items.map((g) => (
              <div key={g.key} className={s.goItem}>
                {g.ok ? <CheckCircle className={s.goIcon} style={{ color: g.color }} aria-hidden /> : <WarningCircle className={s.goIcon} style={{ color: g.color }} aria-hidden />}
                <span className={s.goText}>
                  <span className={s.goLabel}>{g.label}</span>
                  <span className={s.goSub} style={{ color: g.color }}>
                    {g.sub}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard gap={4}>
          <div className={s.sheetHead}>
            <CardTitle className={s.sheetTitle}>{t('Site sheet')}</CardTitle>
            {entry && <EditSheetButton code={code} context={context} stamp={entry.sheet.stamp} form={entry.sheet.form} values={entry.sheet.values} />}
          </div>
          {v.meta.map((m) => (
            <div key={m.k} className={s.metaRow}>
              <span className={s.metaKey}>{m.k}</span>
              <span className={s.metaVal}>{m.v}</span>
            </div>
          ))}
        </SectionCard>
      </CardGrid>

      <SectionCard
        scroll
        title={t('Client prerequisites (readiness)')}
        subtitle={t('Dated and signed by the client · each one conditions a site activity · J-15 unconfirmed → alert, risk and client letter')}
        actions={<AddLine code={code} kind="prerequisite" entry={entry} />}
      >
        {entry?.noActivity && <span className={s.footnote}>{entry.noActivity}</span>}
        {v.noPrereq && <span className={s.footnote}>{v.noPrereq}</span>}
        <Table>
          <thead>
            <tr>
              <Th>{t('Prerequisite')}</Th>
              <Th>{t('Conditions activity')}</Th>
              <Th>{t('Needed by')}</Th>
              <Th>{t('Status')}</Th>
              <Th>{t('Evidence')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {v.prereqs.map((r) => (
              <tr key={r.position} id={`prereq-${r.position}`} className={r.focus ? s.prereqFocus : undefined}>
                <td className={s.pretty}>{r.title}</td>
                <Td tone="muted" maxWidth={220}>
                  <Ellipsis title={r.act}>{r.act}</Ellipsis>
                </Td>
                <td className={s.due} style={{ color: r.dueColor }}>
                  {r.due}
                </td>
                <td>
                  <span className={r.tagClass}>{r.status}</span>
                </td>
                <td className={s.note}>{r.note}</td>
                <td>
                  <div className={s.actions}>
                    {r.risk && (
                      <Link href={r.risk.href} className={s.riskLink} title={t('Risk raised from this prerequisite')}>
                        {r.risk.number}
                      </Link>
                    )}
                    {r.raise && v.raiseForm && (
                      <RaiseRiskButton code={code} position={r.position} stamp={r.stamp} title={r.title} form={v.raiseForm} values={r.raise} autoOpen={r.focus} />
                    )}
                    {canEdit && r.step && <PrerequisiteButton code={code} position={r.position} stamp={r.stamp} to={r.step.to} label={r.step.label} title={r.title} />}
                    <LineButtons code={code} kind="prerequisite" position={r.position} label={r.title} line={r.entry} entry={entry} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>

      <CardGrid min={540}>
        <SectionCard
          scroll
          title={t('Equipment on site')}
          subtitle={t('Shipped with the machine · rented locally · provided by the client')}
          actions={<AddLine code={code} kind="equipment" entry={entry} />}
        >
          {v.noEquip && <span className={s.footnote}>{v.noEquip}</span>}
          <Table size={12.5}>
            <thead>
              <tr>
                <Th>{t('Equipment')}</Th>
                <Th>{t('Source')}</Th>
                <Th>{t('Status')}</Th>
                <Th>{t('Note')}</Th>
                <Th aria-label={t('Actions')} />
              </tr>
            </thead>
            <tbody>
              {v.equip.map((r) => (
                <tr key={r.position}>
                  <td>{r.name}</td>
                  <td>
                    <span className={cx(r.srcClass, s.nowrap)}>{r.src}</span>
                  </td>
                  <td>
                    <span className={r.tagClass}>{r.status}</span>
                  </td>
                  <td className={s.note115}>{r.note}</td>
                  <td>
                    <div className={s.actions}>
                      {canEdit && r.canConfirm && <ConfirmEquipmentButton code={code} position={r.position} stamp={r.stamp} name={r.name} />}
                      <LineButtons code={code} kind="equipment" position={r.position} label={r.name} line={r.entry} entry={entry} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </SectionCard>
        <CursusCard code={code} v={v.cursus} canEdit={canEdit} t={t} />
      </CardGrid>
    </>
  );
}

/** "Individual go / no go — Cursus": Cursus's approvals (read-only), the reminder Keystone sends, links to Cursus. */
function CursusCard({ code, v, canEdit, t }: { code: string; v: ReadyView['cursus']; canEdit: boolean; t: T }) {
  return (
    <div id={CURSUS_CARD_ID} className={cx('card', 'elev-sm', s.cursusCard)}>
      <div className={s.cardHead}>
        <div className={s.headCol}>
          <CardTitle>{t('Individual go / no go — Cursus')}</CardTitle>
          <span className={s.headSub}>{t('Approvals received from Cursus · checked against the mission dates')}</span>
        </div>
        <div className={s.headBtns}>
          {canEdit && <SyncCursusButton code={code} />}
          <a href={v.openUrl} {...CURSUS_LINK_ATTRS} className={cx('btn', 'btn-secondary', s.headBtn)} title={t('Opens Cursus in a new window')}>
            <ArrowSquareOut aria-hidden />
            {t('Open Cursus')}
          </a>
        </div>
      </div>
      <div className={s.privacy}>
        <LockSimple className={s.privacyIcon} aria-hidden />
        <span className={s.pretty}>
          {t('Passports, visa files, vaccination records and medical data stay in Cursus. Keystone only receives the approval, the confirmation and its date — no personal data is imported or stored.')}
        </span>
      </div>
      <span className={s.mirror}>
        <ArrowsClockwise className={s.mirrorIcon} aria-hidden />
        {t('Mirrored from Cursus — verdicts are managed in Cursus')} · {v.lastSync}
      </span>
      {v.empty && <span className={s.footnote}>{v.empty}</span>}
      <Table size={12.5}>
        <thead>
          <tr>
            <Th>{t('Person')}</Th>
            <Th>{t('Visa')}</Th>
            <Th>{t('Vaccinations')}</Th>
            <Th>{t('Clearances & badges')}</Th>
            <Th>{t('Cursus verdict')}</Th>
            <Th>{t('Received')}</Th>
            <Th aria-label={t('Actions')} />
          </tr>
        </thead>
        <tbody>
          {v.rows.map((r) => (
            <tr key={r.person}>
              <td className={s.nowrap}>
                {/* R-032 (NEW-CURSUS-3 'a'): the person in Cursus when Cursus gave a matricule; plain text otherwise (the prototype). */}
                {r.personUrl ? (
                  <a href={r.personUrl} {...CURSUS_LINK_ATTRS} className={s.personLink} title={t('Opens Cursus in a new window')}>
                    {r.who}
                  </a>
                ) : (
                  r.who
                )}
              </td>
              <td>
                <span className={cx(r.visaClass, s.nowrap)}>{r.visa}</span>
              </td>
              <td>
                <span className={cx(r.vaccClass, s.nowrap)}>{r.vacc}</span>
              </td>
              <td>
                <div className={s.habCell}>
                  <span className={cx(r.habClass, s.habTag)}>{r.hab}</span>
                  <span className={s.habNote} style={{ color: r.habColor }}>
                    {r.habNote}
                  </span>
                </div>
              </td>
              <td>
                <span className={cx(r.tagClass, s.nowrap)}>{r.status}</span>
              </td>
              <td className={s.rec}>{r.rec}</td>
              <td>
                {canEdit && r.remindable && <RemindButton code={code} person={r.person} label={r.who} />}
                {r.reminded && (
                  <span className={s.reminded}>
                    <span className={s.mutedLine}>{t('Reminder sent')}</span>
                    {r.reminderSync && <span className={s.syncLine}>{r.reminderSync}</span>}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

// ── Team & mobilisation ───────────────────────────────────────────────────────────────────────────────

function TeamTab({ code, v, entry, t }: { code: string; v: TeamView; entry: SheetEntry | null; t: T }) {
  return (
    <>
      <Kpis kpis={v.kpis} />
      <SectionCard
        scroll
        title={t('Rotation plan')}
        subtitle={t('Who, when, where they sleep, how they travel · shown next to the site activities in the Gantt')}
        actions={<AddLine code={code} kind="rotation" entry={entry} />}
      >
        {v.noRotation && <span className={s.footnote}>{v.noRotation}</span>}
        <Table>
          <thead>
            <tr>
              <Th>{t('Person')}</Th>
              <Th>{t('Role on site')}</Th>
              {/* The prototype's headers read "Issued by" / "Recipients" over the mission dates (10 OQ8). */}
              <Th>{t('From')}</Th>
              <Th>{t('To')}</Th>
              <Th>{t('Rotation')}</Th>
              <Th>{t('Lodging')}</Th>
              <Th>{t('Travel')}</Th>
              <Th>{t('Collision')}</Th>
              {entry && <Th aria-label={t('Actions')} />}
            </tr>
          </thead>
          <tbody>
            {v.rotation.map((r) => (
              <tr key={r.position}>
                <td className={s.nowrap}>{r.who}</td>
                <Td tone="secondary">{r.role}</Td>
                <td className={s.due}>{r.from}</td>
                <td className={s.due}>{r.to}</td>
                <td className={s.rot}>{r.rot}</td>
                <Td tone="secondary">{r.lodging}</Td>
                <Td tone="secondary">{r.travel}</Td>
                <td>
                  {r.collision ? (
                    <Warning className={s.collideIcon} role="img" aria-label={r.collisionLabel} />
                  ) : (
                    <Check className={s.collideIcon} role="img" aria-label={r.collisionLabel} />
                  )}
                </td>
                {entry && (
                  <td>
                    <div className={s.actions}>
                      <LineButtons code={code} kind="rotation" position={r.position} label={`${r.who} · ${r.from} → ${r.to}`} line={r.entry} entry={entry} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>
      <CardGrid min={540}>
        {/* R-119 (D-6b 'a'): conflicts computed from the rotation plan (the subtitle no longer names Lucca — absences come from Cursus, R-031). */}
        <SectionCard gap={6} title={t('Collision detection')} subtitle={t('Same person on two sites · overload · leave and absences · clearance expiring · badge missing')}>
          {v.noCollision && <span className={s.footnote}>{v.noCollision}</span>}
          {v.collisions.map((c) => (
            <div key={c.key} className={s.collision}>
              <span className={s.collisionText}>
                <span className={s.collisionWho}>
                  {c.who}
                  <span className={cx(c.tagClass, s.kindTag)}>{c.kind}</span>
                </span>
                <span className={s.collisionWhat}>{c.what}</span>
                <span className={s.collisionFix}>→ {c.fix}</span>
              </span>
              <span className={s.collisionBtns}>
                <ButtonLink href={c.href} variant="secondary" size="row" aria-label={`${t('Resolve')} — ${c.who}`}>
                  {t('Resolve')}
                </ButtonLink>
                {c.canArbitrate && <ArbitrateButton code={code} conflictKey={c.key} label={`${c.who} · ${c.kind}`} form={v.arbitrationForm} />}
              </span>
            </div>
          ))}
          {v.arbitrated.map((c) => (
            <div key={c.key} className={cx(s.collision, s.arbitrated)}>
              <span className={s.collisionText}>
                <span className={s.collisionWho}>
                  {c.who}
                  <span className={cx('tag tag-neutral', s.kindTag)}>{c.kind}</span>
                  <span className={cx('tag tag-outline', s.kindTag)}>{t('Arbitrated')}</span>
                </span>
                <span className={s.collisionWhat}>{c.what}</span>
                <span className={s.collisionFix}>
                  {t('Arbitrated by')} {c.by} · {c.at} · {c.comment}
                </span>
              </span>
            </div>
          ))}
        </SectionCard>
        <SectionCard
          scroll
          title={t('Mission costs')}
          subtitle={t('Charged to the Site work package · planned vs actual')}
          actions={<AddLine code={code} kind="cost" entry={entry} />}
        >
          {v.noCost && <span className={s.footnote}>{v.noCost}</span>}
          <Table size={12.5}>
            <thead>
              <tr>
                <Th>{t('Line')}</Th>
                <Th align="right">{t('Budget')}</Th>
                <Th align="right">{t('Actual')}</Th>
                <Th width="26%" aria-label={t('Used')} />
                <Th align="right">{t('Remaining')}</Th>
                {entry && <Th aria-label={t('Actions')} />}
              </tr>
            </thead>
            <tbody>
              {v.missionCosts.map((r) => (
                <tr key={r.position}>
                  <td>{r.name}</td>
                  <Td align="right" numeric>
                    {r.budget}
                  </Td>
                  <Td align="right" numeric title={r.actualTitle ?? undefined}>
                    {r.actual}
                  </Td>
                  <td>
                    <div className={s.bar} role="img" aria-label={r.pct}>
                      <div className={s.barFill} style={{ '--w': r.pct } as CSSProperties} />
                    </div>
                  </td>
                  <Td align="right" numeric>
                    {r.left}
                  </Td>
                  {entry && (
                    <td>
                      <div className={s.actions}>
                        <LineButtons code={code} kind="cost" position={r.position} label={r.name} line={r.entry} entry={entry} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </SectionCard>
      </CardGrid>
    </>
  );
}

// ── Daily execution ───────────────────────────────────────────────────────────────────────────────────

function ExecTab({ code, v, showCommLog, photos, t }: { code: string; v: ExecView; showCommLog: boolean; photos?: SitePhotos; t: T }) {
  return (
    <>
      <Kpis kpis={v.kpis} />
      <SectionCard
        scroll
        title={t('Daily reports')}
        subtitle={t('Filled on mobile by the site lead · hours per activity, % complete, photos, weather, incidents, visitors')}
      >
        {v.noReport && <span className={s.footnote}>{v.noReport}</span>}
        <Table>
          <thead>
            <tr>
              <Th>{t('Date')}</Th>
              <Th>{t('Activity')}</Th>
              <Th align="right">%</Th>
              <Th>{t('Report')}</Th>
              <Th>{t('Link')}</Th>
              <Th>{t('By')}</Th>
              {photos && <Th>{t('Photos')}</Th>}
            </tr>
          </thead>
          <tbody>
            {v.reports.map((r) => {
              const cells = (
                <>
                  <td className={s.due}>{r.date}</td>
                  <Td tone="secondary">{r.act}</Td>
                  <Td align="right" numeric>
                    {r.pct}
                  </Td>
                  <td className={s.pretty}>
                    {r.txt}
                    {r.detail && <span className={s.reportDetail}>{r.detail}</span>}
                  </td>
                  <td>
                    {r.href ? (
                      <Link href={r.href} className={s.link}>
                        {r.link}
                      </Link>
                    ) : (
                      <span className={s.link}>{r.link}</span>
                    )}
                  </td>
                  <td className={s.due}>{r.by}</td>
                  {photos && (
                    <td>
                      <PhotosButton
                        title={`${r.number} · ${t('Photos')}`}
                        owner={{ kind: 'daily_report', code, ref: r.number }}
                        photos={photos.reports[r.number] ?? []}
                        canEdit={photos.canEdit}
                        empty={t('No photo yet')}
                      />
                    </td>
                  )}
                </>
              );
              return r.href ? (
                <ClickableRow key={r.number} href={r.href}>
                  {cells}
                </ClickableRow>
              ) : (
                <tr key={r.number}>{cells}</tr>
              );
            })}
          </tbody>
        </Table>
        {v.note && <span className={s.footnote}>{v.note}</span>}
      </SectionCard>
      <CardGrid min={540}>
        <SectionCard
          scroll
          title={t('Punch list & reserves')}
          subtitle={t('Linked to NCRs and to the SAT acceptance · signed off by the client')}
          actions={
            <Segmented
              label={v.punchFilter.label}
              value={v.punchFilter.value}
              options={v.punchFilter.options.map((o) => ({ value: o.value, label: o.label, href: o.href }))}
            />
          }
        >
          {v.punchFilter.empty && <span className={s.footnote}>{v.punchFilter.empty}</span>}
          <Table size={12.5}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>{t('Item')}</Th>
                {v.punchFilter.value === 'all' && <Th>{t('Origin')}</Th>}
                <Th>NCR</Th>
                <Th>{t('Owner')}</Th>
                <Th>{t('Due')}</Th>
                <Th>{t('Status')}</Th>
                {photos && <Th>{t('Photos')}</Th>}
              </tr>
            </thead>
            <tbody>
              {v.punch.map((r) => (
                <tr key={r.id}>
                  <td className={s.punchId}>{r.id}</td>
                  <td className={s.pretty}>{r.title}</td>
                  {v.punchFilter.value === 'all' && <Td tone="secondary">{r.origin}</Td>}
                  <td className={s.ncr}>{r.ncr}</td>
                  <td className={s.cell12}>{r.owner}</td>
                  <td className={s.due}>{r.due}</td>
                  <td>
                    <span className={r.tagClass}>{r.status}</span>
                  </td>
                  {photos && (
                    <td>
                      <PhotosButton
                        title={`${r.id} · ${t('Photos')}`}
                        owner={{ kind: 'punch_item', code, ref: r.id }}
                        photos={photos.punch[r.id] ?? []}
                        canEdit={r.siteOrigin ? photos.canEdit : !!photos.canEditItp}
                        empty={t('No photo yet')}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </SectionCard>
        <HseCard v={v.hse} commLog={showCommLog ? <ClientDecisionsLink code={code} t={t} /> : null} t={t} />
      </CardGrid>
    </>
  );
}

/**
 * "Client communication log" (template 2300). D-5 (owner's answer "a": use the project's meetings and decisions): it opens
 * the project's Meetings screen on the decisions taken with the client (`?view=decisions&decisions=client`); the dedicated
 * log built in chapter 4 is retired from the screen (its table, data and DAL are kept until the owner confirms deletion).
 */
function ClientDecisionsLink({ code, t }: { code: string; t: T }) {
  return (
    <Link href={clientDecisionsHref(code)} className={cx('btn', 'btn-ghost', s.hseBtn)} title={t('Client exchanges and decisions are recorded in the project meetings')}>
      <Chats aria-hidden />
      {t('Client communication log')}
    </Link>
  );
}

/** "HSE register": Vigie's site HSE items (read-only mirror), "Open in Vigie" per item, incidents declared in Vigie. */
function HseCard({ v, commLog, t }: { v: ExecView['hse']; commLog: ReactNode; t: T }) {
  return (
    <SectionCard gap={6} title={t('HSE register')} subtitle={t('Prevention plan, inductions, work & lifting permits, near misses')}>
      <span className={s.mirror}>
        <ArrowsClockwise className={s.mirrorIcon} aria-hidden />
        {t('Mirrored from Vigie — HSE is managed in Vigie')} · {v.lastSync}
      </span>
      {v.rows.map((r, i) => (
        <div key={`${r.title}-${i}`} className={s.hseRow}>
          <span>{r.title}</span>
          <span className={s.hseDate}>{r.date}</span>
          <span className={cx(r.tagClass, s.nowrap)}>{r.status}</span>
          <a href={r.vigieUrl} {...VIGIE_LINK_ATTRS} className={cx('btn', 'btn-icon', 'btn-ghost', s.iconLink)} aria-label={`${t('Open in Vigie')} — ${r.title}`} title={t('Open in Vigie')}>
            <ArrowSquareOut aria-hidden />
          </a>
        </div>
      ))}
      <div className={s.hseBtns}>
        <a href={v.reportUrl} {...VIGIE_LINK_ATTRS} className={cx('btn', 'btn-secondary', s.hseBtn)} title={t('Report in Vigie')}>
          <FirstAid aria-hidden />
          {t('Declare incident')}
          <ArrowSquareOut className={s.outIcon} aria-hidden />
        </a>
        {commLog}
        <a href={v.listUrl} {...VIGIE_LINK_ATTRS} className={cx('btn', 'btn-ghost', s.hseBtn)}>
          {t('Manage in Vigie')}
          <ArrowSquareOut className={s.outIcon} aria-hidden />
        </a>
      </div>
    </SectionCard>
  );
}
