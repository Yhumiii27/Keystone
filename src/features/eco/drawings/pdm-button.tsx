'use client';
// "Open in PDM" of the drawing drawer (template 1415): opens the drawing in SolidWorks PDM when the vault sync provides
// a link; the prototype's button had no handler and the PDM deep link is OPEN QUESTION E-7 (09 OQ17), so without a
// link it announces "coming soon" (toast), like the other connectors' placeholders.
import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import s from './drawings.module.css';

export function OpenInPdmButton({ url }: { url: string | null }) {
  const { t } = useI18n();
  const toast = useToast();
  if (url)
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={`btn btn-ghost ${s.external}`}>
        <ArrowSquareOut aria-hidden />
        {t('Open in PDM')}
      </a>
    );
  return (
    <Button variant="ghost" size="sm" icon={ArrowSquareOut} onClick={() => toast.show(t('Open in PDM — coming soon'))}>
      {t('Open in PDM')}
    </Button>
  );
}
