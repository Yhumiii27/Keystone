// Skills matrix — /resources/skills?filter=<skill index> (docs/spec/06 §3; template 1451–1475, logic 4390–4396).
// People × skill families (levels 1–5), certifications and single-expert coverage. Primary action "Add skill"
// (AF `skills`).
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { screenHref } from '@/config/screens';
import { parseSkillFilter } from '@/domain/hr';
import { hrT } from '@/features/hr/i18n';
import { AddSkillButton } from '@/features/hr/primary-buttons';
import { SkillsView } from '@/features/hr/skills-view';
import { getSkillsMatrix } from '@/server/dal/hr';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function SkillsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, i18n, { outside }, data] = await Promise.all([searchParams, getI18n(), getScreenAccess('skills'), getSkillsMatrix()]);
  const t = hrT(i18n.t, i18n.lang);
  const filter = parseSkillFilter(sp.filter, data.skills.length);
  return (
    <>
      <PageHeader screen="skills" primary={outside ? undefined : <AddSkillButton />} />
      <Stack>
        <SkillsView data={data} filter={filter} base={screenHref('skills')} t={t} />
      </Stack>
    </>
  );
}
