'use client';
// Export cards of Activity & integrations › Import / export (chapter 4):
// - "Export — MS Project XML": a project's schedule with its displayed baseline (GET /api/interchange/mspdi/<code>);
// - "Export — Excel" / "Export — PDF": the tables / report of a screen (the same files as the screen's own Export menu,
//   GET /api/export/<screen>), chosen here among the screens of the viewer's workspace that have one.
// The routes re-check every right (a client exports only their organisation's projects); the dialog only builds the link.
import { DownloadSimple, Info } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useId, useState } from 'react';
import { Callout } from '@/components/app/Callout';
import { Button } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Select } from '@/components/ds/Field';
import { useI18n } from '@/i18n/client';
import { exportHref } from '@/lib/export-href';
import { exportSetupAction, type ExportSetup } from './interchange-actions';
import s from './interchange.module.css';

export type ExportCardFormat = 'xml' | 'xlsx' | 'pdf';

export function ExportDialog({ format, title, onClose }: { format: ExportCardFormat; title: string; onClose: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const [setup, setSetup] = useState<ExportSetup | null>(null);
  const [screen, setScreen] = useState('');
  const [project, setProject] = useState('');
  useEffect(() => {
    let alive = true;
    exportSetupAction(format)
      .then((r) => {
        if (!alive) return;
        setSetup(r);
        setScreen(r.targets[0]?.screen ?? '');
        setProject(r.projects[0]?.code ?? '');
      })
      .catch(() => alive && setSetup({ targets: [], projects: [] }));
    return () => {
      alive = false;
    };
  }, [format]);

  const target = setup?.targets.find((x) => x.screen === screen) ?? null;
  const needsProject = format === 'xml' || !!target?.project;
  const href = !setup
    ? null
    : format === 'xml'
      ? project
        ? `/api/interchange/mspdi/${encodeURIComponent(project)}`
        : null
      : target
        ? exportHref(target.screen, { format, code: target.project ? project : null })
        : null;
  const ready = !!href && (!needsProject || !!project);

  return (
    <Dialog open onClose={onClose} title={title} subtitle={t(format === 'xml' ? 'Current project schedule with baseline' : 'The same file as the Export menu of the screen')} subtitleSize={12} width={560}>
      <div className={s.body}>
        {!setup ? (
          <span className={s.hint}>{t('Loading…')}</span>
        ) : (
          <div className={s.grid}>
            {format !== 'xml' && (
              <Field label={t('Screen')} htmlFor={`${id}-screen`} span="full">
                {setup.targets.length ? (
                  <Select id={`${id}-screen`} value={screen} onChange={(e) => setScreen(e.target.value)} options={setup.targets.map((x) => ({ value: x.screen, label: t(x.title) }))} />
                ) : (
                  <span className={s.hint}>{t('No export available for your workspace')}</span>
                )}
              </Field>
            )}
            {needsProject && (
              <Field label={t('Project')} htmlFor={`${id}-project`} span="full">
                <Select id={`${id}-project`} value={project} onChange={(e) => setProject(e.target.value)} options={setup.projects.map((p) => ({ value: p.code, label: t(p.label) }))} />
              </Field>
            )}
            {format === 'xml' && (
              <Callout variant="info" icon={Info} className={s.full}>
                {t('MS Project XML (MSPDI) with the WBS, activities and their Activity ID, logic and lags, calendars and holidays, constraints, % complete, resources — the baseline shown on the Plan becomes Baseline 0.')}
              </Callout>
            )}
          </div>
        )}
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            {t('Cancel')}
          </Button>
          {ready ? (
            <a href={href!} download className={cx('btn', 'btn-primary')} onClick={() => setTimeout(onClose, 0)}>
              <DownloadSimple aria-hidden />
              {t('Download')}
            </a>
          ) : (
            <Button variant="primary" icon={DownloadSimple} disabled>
              {t('Download')}
            </Button>
          )}
        </DialogActions>
      </div>
    </Dialog>
  );
}
