// R-090 (P-8c a): a withdrawn resource request can be re-requested by its sender, like a rejected one — view model flag and
// the PM row actions of the Requests grid (seeded in-memory database; the rows are read, never written).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/resources/requests', useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listResourceRequests, type ResourceRequestRow } from '@/server/dal/requests';
import { reqT } from './i18n';
import { requestRowView, requestsScreenModel } from './model';
import { RequestsScreen } from './requests-screen';

const EN = makeT('en');
const PM = PERSONA_BY_ROLE.pm;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

const withdrawn = (r: ResourceRequestRow): ResourceRequestRow => ({ ...r, status: 'withdrawn', response: 'Withdrawn by PM · Fri 25 Sep' });

describe('R-090 — re-request a withdrawn request (P-8c a)', () => {
  it('canReRequest: rejected or withdrawn; never pending, reschedule or approved', async () => {
    const rows = await listResourceRequests({ requestedBy: PM.short });
    const byId = (id: string) => rows.find((r) => r.id === id)!;
    expect(requestRowView(byId('RQ-037'), EN, 'en', PM)).toMatchObject({ isRejected: true, canReRequest: true, mine: true });
    expect(requestRowView(withdrawn(byId('RQ-044')), EN, 'en', PM)).toMatchObject({ isRejected: false, canReRequest: true, mine: true });
    for (const id of ['RQ-044', 'RQ-038', 'RQ-040']) expect(requestRowView(byId(id), EN, 'en', PM).canReRequest).toBe(false);
  });

  it('the sender sees "Re-request" on their withdrawn request; another viewer (director) does not', async () => {
    const rows = (await listResourceRequests({ requestedBy: PM.short })).map((r) => (r.id === 'RQ-044' ? withdrawn(r) : r));
    const tt = reqT(EN, 'en');
    const mine = renderToStaticMarkup(createElement(RequestsScreen, { model: requestsScreenModel(rows, 'rejected', EN, 'en', PM), filter: 'rejected', canAct: true, t: tt }));
    // Rejected / withdrawn chip: RQ-044 (withdrawn) and RQ-037 (rejected), each with its "Re-request" (client islands in FR, the default).
    expect(mine.match(/>Redemander</g)?.length).toBe(2);
    const director = renderToStaticMarkup(
      createElement(RequestsScreen, { model: requestsScreenModel(rows, 'rejected', EN, 'en', PERSONA_BY_ROLE.director), filter: 'rejected', canAct: true, t: tt }),
    );
    expect(director).not.toContain('Redemander');
  });
});
