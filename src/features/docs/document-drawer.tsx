// Document record drawer (docs/spec/10 §4.5, template 2346–2362, logic 5040–5047): opened by `?doc=PID-HLT-026` over
// the vault, whatever its filters; closed (×, scrim, Esc) to the vault URL. Header "Document record · id · rev D" with
// the Codex, confidentiality and status tags; title; Open in Codex · Download PDF · New revision · Codex · Approve in
// Codex (named next approver / director); the mirror note; Delivery 7: the circuit note (decisions recorded in
// Keystone, pending sync with Codex — R-124); the withdrawal note after a release; Identity,
// Classification, Revisions, Approval proof, Distribution and Relations. Server Component; the buttons are client islands.
// Delivery 8: "Open in Codex" opens the record in Codex in a new tab (R-033); "Revisions" shows the current revision only,
// with a link to the earlier revisions and the download log in Codex, and the Download log section is gone (R-127, D-2 = a)
// — neither Codex link is shown to a client (no Codex access); deliverable, order and punch-item relations are links (R-128).
import { ArrowSquareOut, ArrowsClockwise, Books, CloudArrowUp, GitBranch, Info } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Callout } from '@/components/app/Callout';
import { Eyebrow } from '@/components/app/Eyebrow';
import { KeyValueList } from '@/components/app/KeyValueList';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import type { T } from '@/i18n/translate';
import { CODEX_LINK_ATTRS } from '@/server/integrations/codex/links';
import { ApproveButton, DownloadButton, OpenCodexButton } from './codex-buttons';
import type { DocDrawerView } from './model';
import s from './docs.module.css';

export interface DocumentDrawerProps {
  /** Vault page project (the drawer's actions are checked against it). */
  project: string;
  view: DocDrawerView;
  t: T;
}

export function DocumentDrawer({ project, view: d, t }: DocumentDrawerProps) {
  return (
    <Drawer
      open
      width={680}
      className={s.drawer}
      closeHref={d.closeHref}
      id={d.head}
      title={d.title}
      meta={
        <>
          <span className={cx('tag tag-outline', s.confTag, s.codexTag)}>
            <Books aria-hidden />
            Codex
          </span>
          <span className={cx(d.confClass, s.confTag)}>{d.conf}</span>
          <span className={d.statusClass}>{d.status}</span>
        </>
      }
    >
      <div className={s.actions}>
        {d.codexHref && <OpenCodexButton label={t('Open in Codex')} href={d.codexHref} size="sm" />}
        <DownloadButton project={project} number={d.number} label={t('Download PDF')} variant="secondary" />
        {d.newRevisionHref && (
          <ButtonLink variant="ghost" size="sm" icon={GitBranch} href={d.newRevisionHref} scroll={false}>
            {`${t('New revision')} · Codex`}
          </ButtonLink>
        )}
        {d.approveLabel && <ApproveButton project={project} number={d.number} label={d.approveLabel} />}
      </div>
      <span className={s.mirrorNote}>
        <ArrowsClockwise aria-hidden />
        {t('Record mirrored from Codex · revisions, approvals and distribution are read-only here')}
      </span>
      {d.circuitNote && (
        <Callout variant="emphasis" icon={CloudArrowUp} role="status">
          {d.circuitNote}
        </Callout>
      )}
      {d.withdrawal && (
        <Callout variant="emphasis" icon={Info} role="status">
          {d.withdrawal}
        </Callout>
      )}

      <KeyValueList title={t('Identity')} items={d.identity} />

      <div className={s.sectionWide}>
        <Eyebrow>{t('Classification')}</Eyebrow>
        <div className={s.pills}>
          {d.tags.map((x, i) => (
            <span key={`${x}-${i}`} className="tag tag-neutral">
              {x}
            </span>
          ))}
        </div>
      </div>

      <div className={s.section}>
        <Eyebrow>{t('Revisions')}</Eyebrow>
        {d.revisions.map((r) => (
          <div key={r.revision} className={cx(s.revRow, !r.current && s.revOld)}>
            <span className={s.revLetter}>rev {r.revision}</span>
            <span className={s.revNote}>
              <span>{r.note}</span>
              <span className={s.revSub}>{r.sub}</span>
            </span>
            <span className={cx(r.statusClass, s.nowrapTag)}>{r.status}</span>
            <span className={s.revBtns}>
              <DownloadButton project={project} number={d.number} label={t('Native')} format="Native" variant="mini" />
              <DownloadButton project={project} number={d.number} label="PDF" variant="mini" />
            </span>
          </div>
        ))}
        {d.historyHref && (
          <a href={d.historyHref} {...CODEX_LINK_ATTRS} className={s.historyLink}>
            {t('Earlier revisions and download log in Codex')}
            <ArrowSquareOut aria-hidden />
          </a>
        )}
      </div>

      <div className={s.section}>
        <Eyebrow>{t('Approval proof')}</Eyebrow>
        {d.approvals.map((a, i) => (
          <div key={i} className={cx(s.apprRow, !a.signed && !a.pendingSync && s.apprPending)}>
            <span className={cx(s.dot, !a.signed && (a.pendingSync ? s.dotSync : s.dotPending))} role="img" aria-label={a.state} />
            <span>{a.label}</span>
            <span className={s.apprState}>{a.state}</span>
          </div>
        ))}
      </div>

      {d.distribution.length > 0 && (
        <div className={s.section}>
          <Eyebrow>{t('Distribution')}</Eyebrow>
          {d.distribution.map((x, i) => (
            <div key={i} className={s.distRow}>
              <span>
                {x.to} <span className={s.muted}>{x.sub}</span>
              </span>
              <span className={cx(x.ackClass, s.nowrapTag)}>{x.ack}</span>
            </div>
          ))}
        </div>
      )}

      {d.links.length > 0 && (
        <div className={s.section}>
          <Eyebrow>{t('Relations')}</Eyebrow>
          <div className={s.pills}>
            {d.links.map((l, i) =>
              l.href ? (
                <Link key={i} href={l.href} className={s.relation}>
                  <span className={s.relationKind}>{l.kind}</span>
                  {l.ref}
                </Link>
              ) : (
                <span key={i} className={s.relation}>
                  <span className={s.relationKind}>{l.kind}</span>
                  {l.ref}
                </span>
              ),
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
