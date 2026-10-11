// Discipline screen body — Process / Mechanical / Electrical / Automation engineering (docs/spec/09 §8, template
// 2418–2451, one shared template): header line (icon, discipline lead, tools), KPI row, Inputs | Deliverables, then
// Generated outputs | Consistency checks (chips `?status=`). Row actions are client islands; they are absent when the
// viewer may not edit (outside the workspace, read-only project). Document ids open their Codex record.
import { UploadSimple, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { FilterChips, FilterGroup, FilterLabel } from '@/components/app/Filter';
import { ButtonLink } from '@/components/ds/Button';
import { Table } from '@/components/ds/Table';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import type { DisciplineScreenView } from './model';
import { CheckActions, ConfirmInputButton, DeliverableStepButton, GenerateOutputButton } from './row-actions';
import { DisciplineIcon, EngKpis } from './synthesis-view';
import s from './eng.module.css';

function DocId({ id, href }: { id: string; href: string | null }) {
  return href ? (
    <Link href={href} className={s.docId}>
      {id}
    </Link>
  ) : (
    <span className={s.docId}>{id}</span>
  );
}

export function DisciplineBody({ code, view, t }: { code: string; view: DisciplineScreenView; t: T }) {
  const disc = view.disc;
  return (
    <div className={s.page}>
      <div className={s.discHead}>
        <DisciplineIcon icon={view.head.icon} className={s.discHeadIcon} />
        <span>
          <span className={s.muted5}>{t('Discipline lead')}</span> <span className={s.textColor}>{view.head.lead}</span>
        </span>
        <span>
          <span className={s.muted5}>{t('Tools')}</span> <span className={s.textColor}>{view.head.tools}</span>
        </span>
        <span className={s.push}>{t('Referent proposes · project manager validates BPE releases')}</span>
      </div>

      <EngKpis kpis={view.kpis} />

      <div className={s.wideCols}>
        <div className={cx('card', 'elev-sm', s.cardScroll)}>
          <div className={s.head}>
            <div className={s.titleCol}>
              <div className="card-title">{t('Inputs')}</div>
              <span className={s.sub}>{t('Documents received from other disciplines · revision in use vs latest released')}</span>
            </div>
            {view.importHref && (
              <ButtonLink variant="secondary" size="sm" push icon={UploadSimple} href={view.importHref} scroll={false}>
                {t('Import a list')}
              </ButtonLink>
            )}
          </div>
          <Table size={12.5}>
            <thead>
              <tr>
                <th>{t('Document')}</th>
                <th>{t('Issued by')}</th>
                <th>{t('Rev in use')}</th>
                <th>{t('Latest')}</th>
                <th>{t('State')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.inputs.map((r) => (
                <tr key={r.doc}>
                  <td>
                    <div className={s.docCell}>
                      <DocId id={r.doc} href={r.docHref} />
                      <span className={s.docSub}>{r.title}</span>
                    </div>
                  </td>
                  <td className={s.issuer}>{r.from}</td>
                  <td className={s.tab} style={{ color: r.revColor }}>
                    {r.revText}
                  </td>
                  <td className={s.tab}>{r.latestText}</td>
                  <td>
                    <span className={cx(r.stClass, s.nowrap)}>{r.state}</span>
                  </td>
                  <td className={s.actionsCell}>
                    {r.canConfirm && <ConfirmInputButton code={code} disc={disc} doc={r.doc} />}
                    {r.importHref && (
                      <ButtonLink variant="primary" size="xs" nowrap href={r.importHref} scroll={false} aria-label={`${t('Import new rev')} ${r.doc}`}>
                        {t('Import new rev')}
                      </ButtonLink>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div className={cx('card', 'elev-sm', s.cardScroll)}>
          <div className={s.titleCol}>
            <div className="card-title">{t('Deliverables')}</div>
            <span className={s.sub}>{t('Own documents · files stay in the business tool, Keystone holds revision and status')}</span>
          </div>
          <Table size={12.5}>
            <thead>
              <tr>
                <th>{t('Document')}</th>
                <th>{t('Rev')}</th>
                <th>{t('Status')}</th>
                <th>{t('Recipients')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className={s.docCell}>
                      <DocId id={d.id} href={d.docHref} />
                      <span className={s.docSub}>{d.sub}</span>
                    </div>
                  </td>
                  <td className={s.tab}>{d.rev}</td>
                  <td>
                    <span className={cx(d.stClass, s.nowrap)}>{d.status}</span>
                    {d.codexNote && <span className={s.codexNote}>{d.codexNote}</span>}
                  </td>
                  <td className={s.recipients}>
                    <span className={s.recipientsText}>{d.toText}</span>
                  </td>
                  <td className={s.actionsCell}>
                    {d.canFreeze && <DeliverableStepButton code={code} disc={disc} number={d.id} step="freeze" />}
                    {d.canPropose && <DeliverableStepButton code={code} disc={disc} number={d.id} step="propose" />}
                    {d.proposeBlocked && (
                      <span className={s.blocked}>
                        <Warning aria-hidden />
                        {t('Release blocked ·')} {d.blockedText}
                      </span>
                    )}
                    {d.canValidate && <DeliverableStepButton code={code} disc={disc} number={d.id} step="validate" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>

      <div className={s.wideCols}>
        <div className={cx('card', 'elev-sm', s.cardList)}>
          <div className={s.titleCol}>
            <div className="card-title">{t('Generated outputs')}</div>
            <span className={s.sub}>{t('Lists Keystone produces from imported data for the next service')}</span>
          </div>
          {view.outputs.map((o) => (
            <div key={o.id} className={s.out}>
              <div className={s.outMid}>
                <span className={s.outName}>
                  {o.name} <span className={s.outTo}>→ {o.toText}</span>
                </span>
                <span className={s.outSource}>
                  {t('Source')} · {o.source}
                </span>
                {o.genText && <span className={s.outGen}>{o.genText}</span>}
              </div>
              <div className={s.outRight}>
                <span className={cx(o.stClass, s.nowrap)}>{o.stateText}</span>
                {o.canGen && <GenerateOutputButton code={code} disc={disc} number={o.id} />}
              </div>
            </div>
          ))}
        </div>

        <div className={cx('card', 'elev-sm', s.cardList)}>
          <div className={s.headTop}>
            <div className={s.titleCol}>
              <div className="card-title">{t('Consistency checks')}</div>
              <span className={s.sub}>{t('Run at each import · resolve here or send back to the business tool')}</span>
            </div>
          </div>
          <div className={s.chipsRow}>
            <FilterGroup>
              <FilterLabel>{t('Status')}</FilterLabel>
              <FilterChips
                label={t('Status')}
                value={view.filter}
                options={view.chips.map((c) => ({ value: c.value, label: c.label, count: c.count, href: c.href }))}
              />
            </FilterGroup>
          </div>
          {view.checks.map((c) => (
            <div key={c.id} className={s.check}>
              <span className={s.checkDot} style={{ background: c.sevDot }} />
              <div className={s.checkMid}>
                <span className={s.checkTitle} style={{ color: c.color }}>
                  {c.title}
                </span>
                <span className={s.checkDetail}>{c.detail}</span>
                <span className={s.checkMeta}>{c.meta}</span>
                {c.note && <span className={s.checkNote}>{c.note}</span>}
                {c.canAct && (
                  <div className={s.checkActions}>
                    <CheckActions code={code} disc={disc} number={c.id} />
                  </div>
                )}
              </div>
              <div className={s.checkTags}>
                <span className={cx(c.sevClass, s.nowrap)}>{c.sevLabel}</span>
                <span className={cx(c.stClass, s.nowrap)}>{c.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
