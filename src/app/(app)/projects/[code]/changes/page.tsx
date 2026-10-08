// Change control & baselines — /projects/[code]/changes (docs/spec/07 §2.2, template 1833–1882, logic 4591–4610).
// URL state (docs/spec/00 §8.3): `?filter=budget|scope|schedule` (type chips), `?cr=CR-008` opens the CR drawer,
// `?new=1` opens the New change request form on arrival (Budget › "New change request").
// Primary action "New change request" (AF `changes`) for viewers who may edit the project; Submit for review and
// the approval-step decisions are hidden when the screen is outside the workspace or the project is read-only.
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app/shell/page-header';
import { screenHref } from '@/config/screens';
import { parseCrFilter, withDerivedStatus, type CrFilter } from '@/domain/change-control';
import { NewChangeRequestButton } from '@/features/changes/change-buttons';
import { ChangesView } from '@/features/changes/changes-view';
import { CR_DEFAULT_WBS } from '@/features/changes/forms';
import { changesT } from '@/features/changes/i18n';
import { getChangeControl } from '@/server/dal/changes';
import { getBaselineRegister } from '@/server/dal/changes-baselines';
import { getWbs } from '@/server/dal/planning';
import { projectLabel } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ChangesPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'changes');
  const projectCode = ctx.project.code;
  const [i18n, cc, wbs, baselines] = await Promise.all([getI18n(), getChangeControl(projectCode), getWbs(projectCode), getBaselineRegister(projectCode)]);
  if (!cc) notFound();
  const { lang } = i18n;
  const t = changesT(i18n.t, lang);
  const canEdit = ctx.canEdit('changes');

  const crs = withDerivedStatus(cc.changeRequests);
  const filter = parseCrFilter(first(sp.filter));
  const crParam = first(sp.cr)?.toUpperCase();
  const selected = crParam && crs.some((c) => c.id === crParam) ? crParam : null;

  const base = screenHref('changes', { code: projectCode });
  const href = (q: { filter?: CrFilter; cr?: string | null }) => {
    const u = new URLSearchParams();
    if (q.filter && q.filter !== 'all') u.set('filter', q.filter);
    if (q.cr) u.set('cr', q.cr);
    const qs = u.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const primary = canEdit ? (
    <NewChangeRequestButton
      code={projectCode}
      context={i18n.t(projectLabel(ctx.project))}
      defaultWbs={wbs.some((w) => w.code === CR_DEFAULT_WBS) ? CR_DEFAULT_WBS : '1'}
      autoOpen={first(sp.new) === '1'}
      closeHref={href({ filter, cr: selected })}
    />
  ) : undefined;

  return (
    <>
      <PageHeader screen="changes" projectCode={projectCode} primary={primary} />
      <ChangesView
        code={projectCode}
        data={{ crs, baselines, originalBudget: cc.originalBudget, bac: cc.bac, contingency: cc.contingency }}
        filter={filter}
        selected={selected}
        role={ctx.viewer.role}
        canEdit={canEdit}
        href={href}
        planHref={screenHref('plan', { code: projectCode })}
        budgetHref={screenHref('budget', { code: projectCode })}
        lang={lang}
        t={t}
      />
    </>
  );
}
