// Document types register (Codex) — /admin/document-types (docs/spec/10 §5, template 2375–2383, `docTypesRows`).
// Read-only mirror of the Codex register; no primary action. Roles: director, pm, quality — other roles get the
// "Outside my workspace · Read-only" banner (PageHeader) and no "Edit in Codex" button. Delivery 8 (R-033): "Edit in Codex"
// opens Codex's register in a new tab (TODO(codex) D-1: Codex's home until its deep links exist).
import { PageHeader } from '@/components/app/shell/page-header';
import { DocTypesRegister } from '@/features/docs/doc-types';
import { docTypesView } from '@/features/docs/model';
import { listDocumentTypes } from '@/server/dal/documents';
import { codexTypeRegisterUrl } from '@/server/integrations/codex/links';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function DocumentTypesPage() {
  const [{ t, lang }, access, rows] = await Promise.all([getI18n(), getScreenAccess('doctypes'), listDocumentTypes()]);
  return (
    <>
      <PageHeader screen="doctypes" />
      <DocTypesRegister rows={docTypesView(rows, t, lang)} editHref={access.canEdit ? codexTypeRegisterUrl() : null} t={t} />
    </>
  );
}
