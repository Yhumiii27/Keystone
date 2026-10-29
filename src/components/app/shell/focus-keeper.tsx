'use client';
// R-183 / R-157 (WCAG 2.4.3 focus order): when an action removes the control that had the keyboard focus — a row action
// ("Mark paid", "Confirm", "Freeze"…) that disappears once done — the browser drops the focus on <body> and the keyboard
// user starts again from the top of the page. The keeper remembers where the focus was (its row and the row's place) and,
// once that control has left the page with nothing focused, moves the focus back to the same row (its first control, else
// the row itself), else the row now in its place, else the main region. Dialogs and drawers restore their own focus first.
import { useEffect } from 'react';
import { focusReturnTarget, type FocusAnchor } from './focus-return';

export function FocusKeeper({ fallbackId }: { fallbackId: string }) {
  useEffect(() => {
    let anchor: FocusAnchor | null = null;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el === document.body) return;
      const row = el.closest<HTMLElement>('tr, [role="row"], li, [data-focus-row]');
      const parent = row?.parentElement ?? null;
      anchor = { el, row, parent, index: row && parent ? Array.prototype.indexOf.call(parent.children, row) : -1 };
    };
    const restore = () => {
      const a = anchor;
      if (!a || a.el.isConnected) return;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      anchor = null;
      const target = focusReturnTarget(a, document.getElementById(fallbackId));
      if (!target) return;
      if (!target.matches('a[href], button, input, select, textarea, [tabindex]')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: false });
    };
    // React removes the control when the action's new render commits; check after each batch of DOM changes.
    const observer = new MutationObserver(() => {
      if (anchor && !anchor.el.isConnected) requestAnimationFrame(restore);
    });
    document.addEventListener('focusin', onFocusIn);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      observer.disconnect();
    };
  }, [fallbackId]);
  return null;
}
