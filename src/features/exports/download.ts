'use client';
// Client download of a file export (chapter 4): fetches GET /api/export/… (the route re-checks every right), saves the
// file under the name the server gives (Content-Disposition) and shows the server's refusal ("Clients export their own
// projects only", "Nothing to export"…, already translated) in a toast instead of navigating to an error page.
import { showToast } from '@/components/ds/Toast';

/** File name of a Content-Disposition header (RFC 5987 `filename*` first, then `filename`). */
export function fileNameOf(disposition: string | null, fallback = 'export'): string {
  if (!disposition) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition);
  return plain ? plain[1].trim() : fallback;
}

/**
 * Fetches `href` and hands the file to the browser. Resolves null on success, else the message to show (the server's
 * refusal, already translated, or `failed`).
 */
export async function fetchExport(href: string, failed: string): Promise<string | null> {
  try {
    const res = await fetch(href, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) {
      const msg = (await res.text().catch(() => '')).trim();
      return msg && msg.length < 200 ? msg : failed;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameOf(res.headers.get('Content-Disposition'));
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return null;
  } catch {
    return failed;
  }
}

/** Downloads `href` (an exportHref URL); a refusal or a network error shows in a toast. Resolves true when downloaded. */
export async function downloadExport(href: string, failed: string): Promise<boolean> {
  const error = await fetchExport(href, failed);
  if (error) showToast(error);
  return !error;
}
