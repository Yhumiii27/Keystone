// Document types register (Codex) — screen body (docs/spec/10 §5.3, template 2375–2383): "Synced from Codex" banner
// with "Edit in Codex", then the register card: one row per Codex type (DOC_TYPES order) with its family, approval
// circuit, retention rule, ISO process, client-deliverable flag and the number of vault records of the type, all
// projects. Read-only mirror; "Edit in Codex" (Delivery 8, R-033: a link to Codex, new tab) is hidden outside the viewer's
// workspace.
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { Table, Td, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import { CodexBanner } from './codex-banner';
import { OpenCodexButton } from './codex-buttons';
import type { DocTypeRowView } from './model';
import s from './docs.module.css';

export interface DocTypesRegisterProps {
  rows: DocTypeRowView[];
  /** "Edit in Codex": Codex's register (new tab); null hides the button (outside the workspace). */
  editHref: string | null;
  t: T;
}

export function DocTypesRegister({ rows, editHref, t }: DocTypesRegisterProps) {
  return (
    <Stack>
      <CodexBanner
        title={t('Synced from Codex')}
        text={t('This register is owned by Codex — numbering, circuits, retention and ISO processes are edited there. Keystone reads it to tag deliverables and link records.')}
      >
        {editHref && <OpenCodexButton label={t('Edit in Codex')} href={editHref} />}
      </CodexBanner>
      <SectionCard scroll>
        <div className={s.cardTitleCol}>
          <div className="card-title">{t('Document types register')}</div>
          <span className={s.cardSub}>
            {t('One circuit, one retention rule and one ISO process per type · numbering TYPE-CLIENT-SEQ, revisions in letters, working versions A.1, A.2…')}
          </span>
        </div>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Code')}</Th>
              <Th>{t('Kind')}</Th>
              <Th>{t('Family')}</Th>
              <Th>{t('Approval circuit')}</Th>
              <Th>{t('Retention')}</Th>
              <Th>{t('ISO process')}</Th>
              <Th>{t('Client deliverable')}</Th>
              <Th>{t('In Codex')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td className={s.codeCell}>{r.code}</td>
                <td>{r.label}</td>
                <Td tone="secondary">{r.family}</Td>
                <Td tone="secondary">{r.circuit}</Td>
                <td className={s.small}>{r.retention}</td>
                <Td tone="secondary">{r.iso}</Td>
                <td className={s.small}>{r.client}</td>
                <td className={s.num}>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>
    </Stack>
  );
}
