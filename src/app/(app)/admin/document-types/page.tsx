// Document types register (Codex) — /admin/document-types (docs/spec/10 §5, template 2375–2383, `docTypesRows`).
// Read-only mirror of the Codex register; no primary action. Roles: director, pm, quality — other roles get the
// "Outside my workspace · Read-only" banner (PageHeader) and no "Edit in Codex" button.
import { PageHeader } from '@/components/app/shell/page-header';
import { openingCodexProjectText } from '@/features/docs/i18n';
import { DocTypesRegister } from '@/features/docs/doc-types';
import { docTypesView } from '@/features/docs/model';
import { listDocumentTypes } from '@/server/dal/documents';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';

export default async function DocumentTypesPage() {
  const [{ t, lang }, access, rows, project] = await Promise.all([getI18n(), getScreenAccess('doctypes'), listDocumentTypes(), getLastProject()]);
  return (
    <>
      <PageHeader screen="doctypes" />
      <DocTypesRegister rows={docTypesView(rows, t, lang)} editToast={access.canEdit ? openingCodexProjectText(project, lang) : null} t={t} />
    </>
  );
}
