// Approvals without a department (sidebar entry, notifications with `?dept=`): redirects to the department given in
// `?dept=` (name or slug), else the viewer's department (the one they head or belong to), else Engineering.
import { redirect } from 'next/navigation';
import { defaultDepartment, deptSlug } from '@/domain/requests';
import { approvalsHref } from '@/features/requests/routes';
import { listApprovalDepartments } from '@/server/dal/requests';
import { departmentOfPerson } from '@/server/dal/requests-screens';
import { getViewer } from '@/server/session';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ApprovalsIndexPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, depts, viewer] = await Promise.all([searchParams, listApprovalDepartments(), getViewer()]);
  const want = one(sp.dept);
  const asked = want ? depts.find((d) => d.name === want || deptSlug(d.name) === deptSlug(want)) : undefined;
  const name = asked?.name ?? defaultDepartment(depts, { name: viewer.name, department: await departmentOfPerson(viewer.name) });
  redirect(approvalsHref(name));
}
