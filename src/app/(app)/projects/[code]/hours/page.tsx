// Hours — Lucca reconciliation — /projects/[code]/hours?view=resource|wp|unassigned (docs/spec/06 §5; template 932–947,
// logic 5008–5018). Hours declared in Lucca on the project's analytic code vs planned hours per resource × work
// package, and hours declared without a planned task. Primary action "Import Lucca" (AF `hours`).
import { EmptyState } from '@/components/app/EmptyState';
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { screenHref } from '@/config/screens';
import { parseHoursView } from '@/domain/hr';
import { HoursBody } from '@/features/hr/hours-view';
import { hrT } from '@/features/hr/i18n';
import { ImportHoursButton } from '@/features/hr/primary-buttons';
import { getHoursReconciliation } from '@/server/dal/hr';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

export default async function HoursPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'hours');
  const projectCode = ctx.project.code;
  const [i18n, data] = await Promise.all([getI18n(), getHoursReconciliation(projectCode)]);
  const t = hrT(i18n.t, i18n.lang);
  const canEdit = ctx.canEdit('hours');

  // "Import Lucca" shows on every project the viewer may edit, with or without an import (prototype `hasPrimary`).
  // TODO(db): the Lucca connector is not modelled, so an import cannot create a project's first import — the action
  // answers "No hours declared in Lucca for this period" there instead of the prototype's constant toast.
  const primary = canEdit ? <ImportHoursButton code={projectCode} analytic={ctx.project.analytic} context={projectLabelText(ctx.project, i18n.lang)} /> : undefined;

  return (
    <>
      <PageHeader screen="hours" projectCode={projectCode} primary={primary} />
      <Stack>
        {data ? (
          <HoursBody
            data={data}
            view={parseHoursView(sp.view)}
            base={screenHref('hours', { code: projectCode })}
            code={projectCode}
            canEdit={canEdit}
            lang={i18n.lang}
            t={t}
          />
        ) : (
          <EmptyState variant="boxed">{t('No Lucca import for this project yet')}</EmptyState>
        )}
      </Stack>
    </>
  );
}
