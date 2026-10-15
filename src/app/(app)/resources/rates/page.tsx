// Rate cards — /resources/rates?on=YYYY-MM-DD (docs/spec/06 §2; template 1420–1449, logic 4381–4389).
// Hourly cost rate per role and premium multipliers. Values are visible to the director, the PMs and Finance (`canSeeRates`,
// P-12 c, R-044): other viewers get "•••" and the lock banner — the values are not even sent to their browser. Edited by the
// director and Finance (`canEditRates`); the PMs read. Primary action "Add role" (AF `rates`).
// R-083 (A-10, R-4a): the grid is dated — the card shows the rates in force on `?on=` (default the business date STATUS_ISO
// until R-013), with each rate's "since" date and its other versions; edits and "Add role" take effect from that date.
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { screenHref } from '@/config/screens';
import { canEditRates, canSeeRates, parseEffectiveDate, type DatedValue } from '@/domain/hr';
import { AddRoleButton } from '@/features/hr/primary-buttons';
import { RatesView, type VersionView } from '@/features/hr/rates-view';
import { STATUS_ISO, displayOfIso } from '@/server/db/codes';
import { getRateCard } from '@/server/dal/hr';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The versions other than the one in force, as shown ("70 € from 1 Jan 2025"). */
const othersOf = (versions: DatedValue[], since: string | null): VersionView[] =>
  versions.filter((v) => v.effectiveFrom !== since).map((v) => ({ value: v.value, from: displayOfIso(v.effectiveFrom) }));

export default async function RatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const on = parseEffectiveDate(first(sp.on)) ?? STATUS_ISO;
  const [{ viewer, outside }, card, { t }] = await Promise.all([getScreenAccess('rates'), getRateCard(on), getI18n()]);
  const canSee = canSeeRates(viewer.role);
  const canEdit = canEditRates(viewer.role) && !outside;
  // R-046: a viewer who may not see rates gets neither the values nor their history.
  const roles = card.roles.map((r) => ({
    role: r.role,
    baseRateEur: canSee ? r.baseRateEur : null,
    since: canSee && r.effectiveFrom ? displayOfIso(r.effectiveFrom) : null,
    others: canSee ? othersOf(r.versions, r.effectiveFrom) : [],
  }));
  const multipliers = card.multipliers.map((m) => ({
    key: m.key, label: m.label, factor: m.factor, since: m.effectiveFrom ? displayOfIso(m.effectiveFrom) : null, others: othersOf(m.versions, m.effectiveFrom),
  }));
  return (
    <>
      <PageHeader screen="rates" primary={canEdit ? <AddRoleButton effectiveFrom={t(displayOfIso(on))} /> : undefined} />
      <Stack>
        <RatesView key={on} on={on} base={screenHref('rates')} roles={roles} multipliers={multipliers} canSee={canSee} canEdit={canEdit} />
      </Stack>
    </>
  );
}
