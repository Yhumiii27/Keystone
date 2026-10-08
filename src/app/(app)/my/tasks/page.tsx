// My work — /my/tasks (docs/spec/10 §6, template 2813–2901, logic 4058–4083).
// The person shown is the viewer (the prototype always showed Hélène Sauvage — 00 §7.16, 10 OQ17); roles that look
// at people's work (permissions.ts) may open someone else's with `?person=Full Name`, which turns the person chip
// into a switcher. URL state: `?view=board|calendar` (default list), `?week=n` (calendar window, 0 = 21 Sep – 2 Oct).
// Primary "Log time" opens the person's first open task. Outside the workspace (every role but director and
// member) the page renders read-only under the shell's banner.
import { CalendarBlank, Eye, Kanban, ListBullets, Plus } from '@phosphor-icons/react/dist/ssr';
import { FilterLabel } from '@/components/app/Filter';
import { PageHeader } from '@/components/app/shell/page-header';
import { ButtonLink } from '@/components/ds/Button';
import { Segmented } from '@/components/ds/Segmented';
import { logTimeTarget } from '@/domain/tasks';
import { MyWorkBody, type WorkView } from '@/features/mywork/my-work-body';
import { boardViewLabel, viewingNoteText } from '@/features/mywork/i18n';
import { myWorkHref, personProjects, taskHref, workItemData } from '@/features/mywork/model';
import { PersonChip } from '@/features/mywork/person-chip';
import { canEditTask, canPickPerson } from '@/features/mywork/permissions';
import s from '@/features/mywork/mywork.module.css';
import { getMyWorkPerson, listMyWorkPeople } from '@/server/dal/mywork-data';
import { listTasks } from '@/server/dal/tasks';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const VIEWS: readonly WorkView[] = ['list', 'board', 'calendar'];

export default async function MyWorkPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [sp, { t, lang }, access] = await Promise.all([searchParams, getI18n(), getScreenAccess('mywork')]);
  const { viewer, outside } = access;
  const picker = canPickPerson(viewer.role);

  // Person: `?person=` for the roles that may look at someone else's work, else the viewer.
  const asked = first(sp.person)?.trim();
  const other = picker && asked && asked !== viewer.name ? await getMyWorkPerson(asked) : null;
  const person = other ?? (await getMyWorkPerson(viewer.name)) ?? { name: viewer.name, initials: viewer.initials, jobTitle: viewer.title, loads: null };
  const personParam = person.name === viewer.name ? null : person.name;

  const viewParam = first(sp.view);
  const view: WorkView = VIEWS.includes(viewParam as WorkView) ? (viewParam as WorkView) : 'list';
  const weekRaw = parseInt(first(sp.week) ?? '0', 10);
  const week = Number.isFinite(weekRaw) ? Math.max(-52, Math.min(52, weekRaw)) : 0;

  const rows = await listTasks({ person: person.name });
  const items = rows.map((r) => workItemData(r, t, lang));
  const canEdit = canEditTask(viewer, person.name, outside);

  const projects = personProjects(rows, t);
  const sub = `${t(person.jobTitle ?? 'Team member')} · ${projects.length ? projects.join(' · ') : t('No projects')}`;
  let options: { name: string; jobTitle: string; href: string }[] | undefined;
  if (picker) {
    const people = await listMyWorkPeople();
    const self = people.some((p) => p.name === viewer.name) ? [] : [{ name: viewer.name, jobTitle: viewer.title }];
    options = [...self, ...people.map((p) => ({ name: p.name, jobTitle: p.jobTitle ?? 'Team member' }))].map((p) => ({
      name: p.name,
      jobTitle: t(p.jobTitle),
      href: myWorkHref({ person: p.name === viewer.name ? null : p.name, view }),
    }));
  }

  const target = logTimeTarget(rows);
  const primary = canEdit && target ? (
    <ButtonLink variant="primary" icon={Plus} href={taskHref(target.id)}>
      {t('Log time')}
    </ButtonLink>
  ) : undefined;

  const viewOptions = [
    { value: 'list' as const, label: t('List'), icon: ListBullets },
    { value: 'board' as const, label: boardViewLabel(lang), icon: Kanban },
    { value: 'calendar' as const, label: t('Calendar'), icon: CalendarBlank },
  ].map((o) => ({ ...o, href: myWorkHref({ person: personParam, view: o.value, week: o.value === 'calendar' ? week : null }) }));

  return (
    <>
      <PageHeader screen="mywork" crumbExtra={person.name} primary={primary} />
      <div className={s.page}>
        <div className={s.headRow}>
          <PersonChip name={person.name} initials={person.initials} sub={sub} options={options} menuTitle={t('People')} />
          {personParam && <span className={s.viewingNote}>{viewingNoteText(person.name.split(' ')[0], lang)}</span>}
          <div className={s.viewCtl}>
            <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
            <Segmented wrap options={viewOptions} value={view} label={t('Display')} />
          </div>
        </div>
        <MyWorkBody
          items={items}
          loads={person.loads}
          view={view}
          week={week}
          calendarHrefs={{
            prev: myWorkHref({ person: personParam, view: 'calendar', week: week - 1 }),
            next: myWorkHref({ person: personParam, view: 'calendar', week: week + 1 }),
          }}
          canEdit={canEdit}
        />
      </div>
    </>
  );
}
