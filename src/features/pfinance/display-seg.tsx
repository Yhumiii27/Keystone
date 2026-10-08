'use client';
// "Display" switch of Portfolio — prioritisation & capacity (template 2081, `pfSeg`): Prioritisation / Capacity what-if
// as links (`?tab=`). Client island so the links keep the live `?sel=` (rows are selected without a navigation) and
// the what-if candidate `?project=`. Selecting another zone (zone bar, cookie) drops both, as the prototype resets
// `pfSel` and `pfWhatif` (docs/spec/03 §0.5).
import { Eye } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { FilterBar, FilterLabel } from '@/components/app/Filter';
import { Segmented } from '@/components/ds/Segmented';
import { useI18n } from '@/i18n/client';
import { prioritisationHref, type PfTab } from './model';

export function DisplaySeg({ tab, zone = null }: { tab: PfTab; zone?: string | null }) {
  const { t } = useI18n();
  const sp = useSearchParams();
  const router = useRouter();
  const keep = { project: sp.get('project'), sel: sp.get('sel') };
  const shownZone = useRef(zone);
  useEffect(() => {
    if (shownZone.current === zone) return;
    shownZone.current = zone;
    if (sp.get('project') || sp.get('sel')) router.replace(prioritisationHref({ tab }), { scroll: false });
  }, [zone, tab, sp, router]);
  return (
    <FilterBar>
      <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
      <Segmented
        wrap
        value={tab}
        label={t('Display')}
        options={[
          { value: 'score', label: t('Prioritisation'), href: prioritisationHref({ tab: 'score', ...keep }) },
          { value: 'capacity', label: t('Capacity what-if'), href: prioritisationHref({ tab: 'capacity', ...keep }) },
        ]}
      />
    </FilterBar>
  );
}
