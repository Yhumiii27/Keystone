// Drawing drawer (docs/spec/09 §5.7, template 1405–1415, dwgVals 4378–4379), opened by `?dwg=DWG-AS-9000` and closed
// (×, scrim, Esc) to the register URL: "number · rev X", state tag, title, the PDM preview (DocumentPreview — the
// vault's PDF / PNG export when synced), the vault metadata, the revision history and the actions "Part record"
// (→ part drawer), "Open ECO" (→ Keystone's view of the Vigie ECO) and "Open in PDM". Server Component.
import { Cube, GitBranch } from '@phosphor-icons/react/dist/ssr';
import { DocumentPreview } from '@/components/app/DocumentPreview';
import { KeyValueList } from '@/components/app/KeyValueList';
import { ButtonLink } from '@/components/ds/Button';
import { Drawer } from '@/components/ds/Drawer';
import type { T } from '@/i18n/translate';
import type { DrawingDrawerView } from './model';
import { OpenInPdmButton } from './pdm-button';
import s from './drawings.module.css';

export function DrawingDrawer({ view: d, t }: { view: DrawingDrawerView; t: T }) {
  return (
    <Drawer open closeHref={d.closeHref} id={<span className={s.head}>{d.head}</span>} title={d.title} meta={<span className={d.stateClass}>{d.state}</span>}>
      <DocumentPreview src={d.previewSrc} alt={d.title} ratio="4/3" fit="contain" placeholder={t('Drop the PDM preview (PDF / PNG export)')} className={s.preview} />
      <KeyValueList items={d.meta.map((m) => ({ k: m.k, v: m.v }))} />
      <div className={s.section}>
        <span className={s.eyebrow}>{t('Revision history')}</span>
        {d.history.map((h) => (
          <div key={h.rev} className={s.histRow}>
            <span className={s.num}>
              {t('Rev')} {h.rev}
            </span>
            <span className={s.histMuted}>{h.label}</span>
            <span className={s.histEco}>{h.eco}</span>
          </div>
        ))}
      </div>
      <div className={s.buttons}>
        {d.partHref && (
          <ButtonLink variant="secondary" size="sm" icon={Cube} href={d.partHref}>
            {t('Part record')}
          </ButtonLink>
        )}
        {d.ecoHref && (
          <ButtonLink variant="secondary" size="sm" icon={GitBranch} href={d.ecoHref}>
            {t('Open ECO')}
          </ButtonLink>
        )}
        <OpenInPdmButton url={d.pdmUrl} />
      </div>
    </Drawer>
  );
}
