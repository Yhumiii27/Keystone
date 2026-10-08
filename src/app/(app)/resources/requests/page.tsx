// Resource requests (docs/spec/08 §5; template 2689–2730 + dialog 3071–3092; logic 4108–4157). The outbox of the viewer
// (the prototype hard-wires R. Aubert, 08 OQ18 / 00 §7.16): a PM, department head or engineering lead sees the
// requests they sent; the portfolio director and viewers outside the screen's workspace see every request, read-only
// except their own. Status chips in `?status=`; "New request" opens the New resource request dialog.
import { PageHeader } from '@/components/app/shell/page-header';
import { isRequestFilter } from '@/domain/requests';
import { reqT, requestsCrumb } from '@/features/requests/i18n';
import { requestsScreenModel } from '@/features/requests/model';
import { NewRequestButton } from '@/features/requests/new-request-button';
import { RequestsScreen } from '@/features/requests/requests-screen';
import { listResourceRequests } from '@/server/dal/requests';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, { t, lang }, access] = await Promise.all([searchParams, getI18n(), getScreenAccess('requests')]);
  const { viewer } = access;
  const all = viewer.role === 'director' || access.outside;
  const rows = await listResourceRequests(all ? {} : { requestedBy: viewer.short });
  const status = one(sp.status);
  const filter = isRequestFilter(status) ? status : null;
  const model = requestsScreenModel(rows, filter, t, lang, viewer);
  return (
    <>
      <PageHeader screen="requests" crumbExtra={requestsCrumb(viewer, all)} primary={<NewRequestButton label="New request" />} />
      <RequestsScreen model={model} filter={filter} canAct={access.canEdit} t={reqT(t, lang)} />
    </>
  );
}
