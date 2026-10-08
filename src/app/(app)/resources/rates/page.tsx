// Rate cards — /resources/rates (docs/spec/06 §2; template 1420–1449, logic 4381–4389).
// Hourly cost rate per role and premium multipliers. Values are visible to directors and project managers only
// (`canSeeRates`): other viewers get "•••" and the lock banner — the values are not even sent to their browser.
// Primary action "Add role" (AF `rates`).
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { canSeeRates } from '@/domain/hr';
import { AddRoleButton } from '@/features/hr/primary-buttons';
import { RatesView } from '@/features/hr/rates-view';
import { getRateCard } from '@/server/dal/hr';
import { getScreenAccess } from '@/server/project-context';

export default async function RatesPage() {
  const [{ viewer, outside }, card] = await Promise.all([getScreenAccess('rates'), getRateCard()]);
  const canSee = canSeeRates(viewer.role);
  const canEdit = canSee && !outside;
  const roles = card.roles.map((r) => ({ role: r.role, baseRateEur: canSee ? r.baseRateEur : 0 }));
  const multipliers = card.multipliers.map((m) => ({ key: m.key, label: m.label, factor: m.factor }));
  return (
    <>
      <PageHeader screen="rates" primary={canEdit ? <AddRoleButton /> : undefined} />
      <Stack>
        <RatesView roles={roles} multipliers={multipliers} canSee={canSee} canEdit={canEdit} />
      </Stack>
    </>
  );
}
