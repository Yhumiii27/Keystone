'use client';
// Budget › Structure & changes controls that have no behaviour in the prototype ("Add category", the category pencil
// — docs/spec/04 §1.7, open question Q4). They keep the prototype's look and announce "<action> — coming soon" in a
// toast, like the header's Export button. "New change request" opens the Change control form (delivery 2).
import { PencilSimple, Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname } from 'next/navigation';
import { codeFromPath } from '@/components/app/shell/nav-model';
import { Button, ButtonLink, IconButton } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { screenHref } from '@/config/screens';
import { useI18n } from '@/i18n/client';

/** Text button ("Add category" ghost, "New change request" primary), 12.5px with a leading plus. */
export function SoonButton({ label, variant }: { label: string; variant: 'ghost' | 'primary' }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <Button variant={variant} size="sm" icon={Plus} onClick={() => toast.show(t(`${label} — coming soon`))}>
      {t(label)}
    </Button>
  );
}

/** Row pencil (28×28 ghost icon button, neutral-400). */
export function SoonEditButton() {
  const { t } = useI18n();
  const toast = useToast();
  return <IconButton icon={PencilSimple} size={28} muted label={t('Edit category')} onClick={() => toast.show(t('Edit category — coming soon'))} />;
}

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
