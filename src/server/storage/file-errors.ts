// Refusals of the file store (./files.ts) and of the antivirus check (./scan.ts), in a module of their own so both import it
// without a cycle. No server-only import: the class carries no secret and tests construct it.

/** Why an upload was refused. `message` is an EN source sentence with a French entry (translate with t()); `acceptOf(purpose)` lists the types. */
export class FileRejectedError extends Error {
  /**
   * too_large / empty / type / content / name: the file itself (413, 415…); infected: the antivirus found a threat (422,
   * R-175); scan_unavailable: the antivirus could not check it (503, fail-closed).
   */
  readonly code: 'too_large' | 'empty' | 'type' | 'content' | 'name' | 'infected' | 'scan_unavailable';
  constructor(code: FileRejectedError['code'], message: string) {
    super(message);
    this.name = 'FileRejectedError';
    this.code = code;
  }
}

/** HTTP status of an upload refusal in the upload Route Handlers (tasks, photos). */
export function uploadRefusalStatus(e: FileRejectedError): 413 | 415 | 422 | 503 {
  if (e.code === 'too_large') return 413;
  if (e.code === 'infected') return 422;
  if (e.code === 'scan_unavailable') return 503;
  return 415;
}
