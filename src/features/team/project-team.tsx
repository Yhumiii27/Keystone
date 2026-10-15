// Project resources › "Project team" (R-041, P-2): the project's named team — the project manager of record, co-PMs, deputies,
// referents and members — whose people edit the project (the others read it). The director and the project's PMs add people,
// change their team role and remove them (client islands in project-team-client.tsx); the PM of record is changed in the
// Projects register. Server Component: strings arrive translated.
import { UsersFour } from '@phosphor-icons/react/dist/ssr';
import type { FormDef } from '@/components/app/form-def';
import { Avatar } from '@/components/app/Badges';
import { SectionCard } from '@/components/app/SectionCard';
import { PROJECT_TEAM_ROLES, PROJECT_TEAM_ROLE_LABEL } from '@/domain/rights';
import type { T } from '@/i18n/translate';
import type { TeamCardMember } from '@/server/dal/project-team';
import { AddTeamMemberButton, MemberControls } from './project-team-client';
import s from './project-team.module.css';

export interface ProjectTeamCardProps {
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" (dialog sub-line). */
  context: string;
  members: TeamCardMember[];
  /** People who can join (EPC2i staff not on the team), by name; null when the viewer does not manage the team. */
  candidates: { personId: string; name: string; jobTitle: string | null }[] | null;
  t: T;
}

/** "Add to team" dialog (translated). */
export function addTeamMemberForm(candidates: NonNullable<ProjectTeamCardProps['candidates']>, t: T): FormDef {
  return {
    title: t('Add to the project team'),
    submit: t('Add'),
    fields: [
      { id: 'person', label: t('Person'), type: 'select', required: true, options: candidates.map((c) => ({ value: c.personId, label: c.jobTitle ? `${c.name} · ${t(c.jobTitle)}` : c.name })) },
      { id: 'role', label: t('Team role'), type: 'select', required: true, defaultValue: 'team', options: PROJECT_TEAM_ROLES.map((r) => ({ value: r, label: t(PROJECT_TEAM_ROLE_LABEL[r]) })) },
    ],
  };
}

export function ProjectTeamCard({ code, context, members, candidates, t }: ProjectTeamCardProps) {
  const manage = candidates != null;
  const roles = PROJECT_TEAM_ROLES.map((r) => ({ value: r, label: t(PROJECT_TEAM_ROLE_LABEL[r]) }));
  return (
    <SectionCard
      title={t('Project team')}
      subtitle={t('The named team edits the project — the project managers and deputies also move its stage, plan structure and minutes; the others read it')}
      icon={UsersFour}
      actions={manage && candidates.length ? <AddTeamMemberButton code={code} context={context} form={addTeamMemberForm(candidates, t)} /> : undefined}
      gap={10}
    >
      {members.length ? (
        <div className={s.list}>
          {members.map((m) => (
            <div key={m.personId} className={s.row}>
              <Avatar name={m.name} size={28} />
              <span className={s.who}>
                <span className={s.name}>{m.name}</span>
                <span className={s.sub}>{[m.jobTitle ? t(m.jobTitle) : null, m.department ? t(m.department) : null].filter(Boolean).join(' · ') || '—'}</span>
              </span>
              {manage && !m.primary ? (
                <MemberControls code={code} personId={m.personId} name={m.name} role={m.role} roles={roles} />
              ) : (
                <>
                  <span className={m.role === 'pm' || m.role === 'deputy' ? 'tag tag-accent' : 'tag tag-neutral'}>{t(PROJECT_TEAM_ROLE_LABEL[m.role])}</span>
                  <span className={s.spacer} />
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <span className={s.empty}>{t('No named team for this project yet')}</span>
      )}
      {manage && <span className={s.note}>{t('The project manager of record is changed in the Projects register')}</span>}
    </SectionCard>
  );
}
