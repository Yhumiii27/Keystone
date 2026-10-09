'use client';
// Budget › Structure & changes link to the Change control form. "Add category" and the category pencil, which announced
// "coming soon" here before chapter 4, are real now (./category-buttons.tsx, A-14).
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname } from 'next/navigation';
import { codeFromPath } from '@/components/app/shell/nav-model';
import { ButtonLink } from '@/components/ds/Button';
import { screenHref } from '@/config/screens';
import { useI18n } from '@/i18n/client';

/** "New change request" (primary, 12.5px, plus): Change control of the current project with the form open (`?new=1`). */
export function NewChangeRequestLink() {
  const { t } = useI18n();
  const code = codeFromPath(usePathname() ?? '') ?? undefined;
  return (
    <ButtonLink variant="primary" size="sm" icon={Plus} href={`${screenHref('changes', { code })}?new=1`}>
      {t('New change request')}
    </ButtonLink>
  );
}
