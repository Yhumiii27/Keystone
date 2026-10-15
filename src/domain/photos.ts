// Photos stored by Keystone (R-126, owner's answers X-15 "split" and SC-4a "a": goods-receipt, site and punch-item photos are
// kept in Keystone like task attachments; plans and PDF previews stay in Codex and the PDM). Pure rules: what a photo can
// belong to, the screen that governs it (who adds, who sees), the per-owner limit and the owner key sent by the upload form.
// Storage limits (20 MB, image types, content sniffing) are the file store's (src/server/storage/files.ts, purpose `photo`).
import type { ScreenId } from '@/config/screens';
import type { PunchRegister } from '@/server/db/codes';

/** What a photo belongs to: a goods receipt (BL-2026-0533), a site daily report (DR-003) or a punch item (P-04, ITP or Site register). */
export type PhotoOwnerKind = 'goods_receipt' | 'daily_report' | 'punch_item';
export const PHOTO_OWNER_KINDS: readonly PhotoOwnerKind[] = ['goods_receipt', 'daily_report', 'punch_item'];

/** At most this many photos per receipt, report or punch item. */
export const MAX_PHOTOS_PER_OWNER = 20;

export interface PhotoOwnerKey {
  kind: PhotoOwnerKind;
  /** Project code ("HLT-026"). */
  code: string;
  /** Receipt, report or punch item number. */
  ref: string;
  /**
   * Punch items: the item's origin (R-117: Inspection or Site). Only the stored origin counts for rights
   * (src/features/photos/access.ts resolves it); what a request sends is a hint at most.
   */
  register?: PunchRegister | null;
}

/**
 * The screen whose rights govern a photo: Deliveries (receipts), Site (daily reports, punch items raised on site),
 * Inspections & punch list (punch items raised by an inspection). Adding or removing needs the right to edit that screen on
 * the project; seeing it, the screen (internal viewers) — the client sees only the photos of the items raised by an
 * inspection, on their own project (P-10b hides purchasing and the site's internal records, X-15).
 */
export function photoScreenOf(o: Pick<PhotoOwnerKey, 'kind' | 'register'>): ScreenId {
  if (o.kind === 'goods_receipt') return 'deliveries';
  if (o.kind === 'daily_report') return 'site';
  return o.register === 'site' ? 'site' : 'itp';
}

/**
 * The client may see this kind of photo: a punch item raised by an inspection (stored origin 'itp'), on their own project —
 * checked by the caller. Never a Site item's (X-15 still open), never an item whose origin is unknown.
 */
export const clientSeesPhotos = (o: Pick<PhotoOwnerKey, 'kind' | 'register'>) => o.kind === 'punch_item' && o.register === 'itp';

const REF: Record<PhotoOwnerKind, RegExp> = {
  goods_receipt: /^BL-\d{4}-\d{3,6}$/,
  daily_report: /^DR-\d{2,5}$/,
  punch_item: /^P-\d{2,4}$/,
};

/** Validates the owner sent by an upload / remove request; null when malformed. */
export function parsePhotoOwner(v: { kind?: unknown; code?: unknown; ref?: unknown; register?: unknown }): PhotoOwnerKey | null {
  const kind = typeof v.kind === 'string' && (PHOTO_OWNER_KINDS as readonly string[]).includes(v.kind) ? (v.kind as PhotoOwnerKind) : null;
  if (!kind) return null;
  const code = typeof v.code === 'string' ? v.code.trim() : '';
  const ref = typeof v.ref === 'string' ? v.ref.trim().toUpperCase() : '';
  if (!/^[A-Z0-9-]{3,20}$/i.test(code) || !REF[kind].test(ref)) return null;
  // R-117: a punch item is found by its number; a register sent by an older form is accepted but not trusted (access.ts).
  let register: PunchRegister | null = null;
  if (kind === 'punch_item' && v.register != null && v.register !== '') {
    if (v.register !== 'itp' && v.register !== 'site') return null;
    register = v.register;
  }
  return { kind, code, ref, register };
}

/** "3 photos" / "1 photo" (EN; FR through the caller's dictionary). */
export const photoCountText = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`;
