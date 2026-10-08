// URLs of the requests feature: Approvals per department (`/resources/approvals/[dept]`, docs/spec/00 §4, §8.3) and the
// Resource requests status filter (`?status=`).
import { screenHref } from '@/config/screens';
import { deptSlug, type RequestFilter } from '@/domain/requests';

/** "/resources/approvals/controls-planning". */
export const approvalsHref = (dept: string) => `${screenHref('approvals')}/${deptSlug(dept)}`;

/** "/resources/requests?status=pending" (null = All). */
export const requestsHref = (status: RequestFilter | null = null) => screenHref('requests') + (status ? `?status=${status}` : '');
