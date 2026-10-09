// Quality — NCR & deliverables screen body (docs/spec/07 §2.3, template 1883–1971): the "Register" switch (NCR log |
// deliverables register, links `?tab=`), then the selected register and its drawer. Server Component.
import { Eye } from '@phosphor-icons/react/dist/ssr';
import { FilterBar, FilterGroup, FilterLabel } from '@/components/app/Filter';
import { Stack } from '@/components/app/SectionCard';
import { Segmented } from '@/components/ds/Segmented';
import type { QualityTab } from '@/domain/quality';
import type { T } from '@/i18n/translate';
import { DeliverableDrawer } from './dlv-drawer';
import { DeliverablesRegister } from './dlv-register';
import type { DlvDrawerView, DlvTabView, NcrDrawerView, NcrTabView, SegView } from './model';
import { NcrDrawer } from './ncr-drawer';
import { NcrLog } from './ncr-log';

export interface QualityViewProps {
  code: string;
  /** Translated project label ("#026 · Harbor Line Terminal Expansion"), the dialogs' sub-line. */
  context: string;
  tab: QualityTab;
  seg: SegView[];
  ncr: NcrTabView | null;
  ncrDrawer: NcrDrawerView | null;
  dlv: DlvTabView | null;
  dlvDrawer: DlvDrawerView | null;
  t: T;
}

export function QualityView({ code, context, tab, seg, ncr, ncrDrawer, dlv, dlvDrawer, t }: QualityViewProps) {
  return (
    <Stack>
      <FilterBar>
        <FilterGroup>
          <FilterLabel icon={Eye}>{t('Register')}</FilterLabel>
          <Segmented wrap label={t('Register')} value={tab} options={seg.map((o) => ({ value: o.value, label: o.label, href: o.href }))} />
        </FilterGroup>
      </FilterBar>
      {ncr && <NcrLog code={code} view={ncr} t={t} />}
      {ncrDrawer && <NcrDrawer code={code} view={ncrDrawer} t={t} />}
      {dlv && <DeliverablesRegister code={code} view={dlv} t={t} />}
      {dlvDrawer && <DeliverableDrawer code={code} view={dlvDrawer} context={context} t={t} />}
    </Stack>
  );
}
