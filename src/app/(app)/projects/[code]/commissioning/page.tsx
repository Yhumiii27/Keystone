// Commissioning & handover dossier — /projects/[code]/commissioning (docs/spec/07 §2.6, template 910–920, logic
// 4969–4977). Each system through Mechanical completion → Pre-commissioning → Commissioning → SAT → Handover, the open
// category-A punch items blocking it, and the completeness of the handover dossier (documents in Codex). Primary action
// "Plan SAT" (AF `commissioning`, a run form): recorded, it dates the system's SAT step; on a project without a
// commissioning plan it offers the inspection template's systems (the prototype's `ITPSYS`) and the plan is recorded
// while the screen keeps its empty panel. Hidden when the screen is outside the viewer's workspace or the project is
// read-only for them, and refused server-side.
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/app/shell/page-header';
import { defaultSatDate } from '@/domain/itpcom';
import { ItpFormButton } from '@/features/itpcom/add-buttons';
import { CommissioningBody } from '@/features/itpcom/commissioning-view';
import { localizeForm, planSatFormDef } from '@/features/itpcom/forms';
import { commissioningScreenView } from '@/features/itpcom/model';
import { shortName } from '@/lib/format';
import { getCommissioning } from '@/server/dal/commissioning';
import { listItpSystems, listPunchItems } from '@/server/dal/itp';
import { getStakeholderRegister } from '@/server/dal/stakeholders';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

export default async function CommissioningPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'commissioning');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data, punch] = await Promise.all([getI18n(), getCommissioning(projectCode), listPunchItems(projectCode, 'itp')]);
  const canEdit = ctx.canEdit('commissioning');

  let primary: ReactNode;
  if (canEdit) {
    // Client witnesses default to the project's client contacts ("N. Bensaïd, K. Doucouré"); the SAT date to the first
    // system's (none without a commissioning plan); the systems to the plan's, else the inspection template's.
    const [clients, systems] = await Promise.all([
      getStakeholderRegister(projectCode).then((r) => r.stakeholders.filter((x) => x.type === 'client').map((x) => shortName(x.name))),
      data ? data.systems.map((x) => x.name) : listItpSystems(projectCode),
    ]);
    const form = planSatFormDef(systems, { date: defaultSatDate(data?.systems[0]?.cells.find((c) => c.step === 'sat')?.dateOn ?? null), witnesses: clients.join(', ') });
    primary = <ItpFormButton kind="sat" code={projectCode} label={t('Plan SAT')} context={projectLabelText(ctx.project, lang)} form={localizeForm(form, t, lang)} />;
  }

  return (
    <>
      <PageHeader screen="commissioning" projectCode={projectCode} primary={primary} />
      <CommissioningBody view={commissioningScreenView(projectCode, data, punch, t, lang)} t={t} />
    </>
  );
}
