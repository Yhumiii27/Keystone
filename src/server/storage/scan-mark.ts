// The verdict mark of the antivirus check (R-175): ./scan.ts `scanUpload` marks the Uint8Array it returns, ./files.ts
// `storeFile` reads the mark to record the verdict and, while scanning is on, refuses bytes that carry none. A WeakMap on
// that very Uint8Array: a mark on an ArrayBuffer would be lost, since storeFile wraps one in a new view. Its own module so
// both import it without a cycle.
import type { FileScanStatus } from '@/domain/file-scan';

export interface ScanMark {
  /** 'unscanned' when the antivirus is off. */
  status: Exclude<FileScanStatus, 'infected'>;
  /** When clamd answered OK (null when off). */
  at: Date | null;
}

const marks = new WeakMap<Uint8Array, ScanMark>();

export function markScanned(bytes: Uint8Array, mark: ScanMark): Uint8Array {
  marks.set(bytes, mark);
  return bytes;
}

/** The verdict recorded on bytes returned by `scanUpload` (null: not checked). */
export const scanMarkOf = (data: Uint8Array): ScanMark | null => marks.get(data) ?? null;
