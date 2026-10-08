// <DocumentLink code="PID-HLT-026" /> — link from any screen to a Codex record: the Documents vault with the document
// record drawer open (`openDoc` / `openCtrDoc` of Meetings, Contract, ITP, Commissioning, the PLM part drawer;
// docs/spec/10 §4.9). Async Server Component: it finds the record's project in the index (company QMS records open in
// `project`, else the viewer's last project). An unknown number renders as plain text. Client Components use
// `docHref(number, project)` from ./links instead.
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { QMS } from '@/domain/documents';
import { listVaultDocuments } from '@/server/dal/documents';
import { getLastProject } from '@/server/session';
import { docHref } from './links';

export interface DocumentLinkProps {
  /** Document number ("PID-HLT-026", "MIN-HLT-023"). */
  code: string;
  /** Vault to open a company QMS record in (default: the viewer's last project); other records open in their own project. */
  project?: string;
  /** Link content; defaults to the number. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export async function DocumentLink({ code, project, children, className, style, title }: DocumentLinkProps) {
  const doc = (await listVaultDocuments()).find((d) => d.number === code);
  if (!doc)
    return (
      <span className={className} style={style} title={title}>
        {children ?? code}
      </span>
    );
  const vault = doc.project === QMS ? (project ?? (await getLastProject())) : doc.project;
  return (
    <Link href={docHref(doc.number, vault)} className={className} style={style} title={title} scroll={false}>
      {children ?? code}
    </Link>
  );
}
