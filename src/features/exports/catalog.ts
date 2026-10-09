// What the header Export menu offers per screen (chapter 4, exports): every screen exports its tables as CSV and Excel;
// these screens also have a PDF report. Pure (client and server); src/server/export/providers/providers.test.ts checks it
// matches the registered providers.
import type { ScreenId } from '@/config/screens';

export type ExportMenuFormat = 'xlsx' | 'csv' | 'pdf';

/** Screens whose provider has a PDF report (budget cost report, account statement, minutes, risk register, status reports, detailed plan and Gantt — S-9a). */
export const PDF_REPORT_SCREENS: readonly ScreenId[] = ['budget', 'billing', 'meetings', 'risks', 'trends', 'client', 'plan', 'schedule'];

export const exportFormatsOf = (screen: ScreenId): ExportMenuFormat[] => ['xlsx', 'csv', ...(PDF_REPORT_SCREENS.includes(screen) ? (['pdf'] as const) : [])];
