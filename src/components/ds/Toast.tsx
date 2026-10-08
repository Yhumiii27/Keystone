'use client';
// Global toast (docs/spec/02 C-23, docs/spec/01 §9): one message at a time, a new one replaces the
// current one, auto-dismiss after 4000 ms (timer reset on each call), × closes it.
//
// Mount <ToastProvider> (or <ToastViewport/>) once, in the app shell. Trigger from client code with
// `useToast().show(message)` or the standalone `showToast(message)`.
import { CheckCircle, X } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import { IconButton } from './Button';
import { cx } from './cx';
import s from './Toast.module.css';

/** Auto-dismiss delay (prototype `showToast`, logic 5116). */
export const TOAST_MS = 4000;

interface ToastState {
  id: number;
  message: string;
}

let current: ToastState | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Shows `message` as-is (pass it already translated). Replaces any visible toast. No-op on the server. */
export function showToast(message: string) {
  if (typeof window === 'undefined' || !message) return;
  current = { id: ++seq, message };
  clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    emit();
  }, TOAST_MS);
  emit();
}

export function dismissToast() {
  clearTimeout(timer);
  current = null;
  emit();
}

export interface ToastApi {
  /** Show an already translated message. */
  show: (message: string) => void;
  /**
   * Show an English source message translated like the prototype: FR splits on " · " and translates
   * each segment ("R-21 · Risk registered" → "R-21 · Risque enregistré").
   */
  showEn: (englishMessage: string) => void;
  dismiss: () => void;
}

export function useToast(): ToastApi {
  const { t } = useI18n();
  return useMemo(() => ({ show: showToast, showEn: (m: string) => showToast(m.split(' · ').map(t).join(' · ')), dismiss: dismissToast }), [t]);
}

/** Renders the current toast (`card elev-lg`, fixed bottom-right, z 80). */
export function ToastViewport({ closeLabel }: { closeLabel?: string }) {
  const { t } = useI18n();
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return (
    <div role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={cx('card', 'elev-lg', s.toast)}>
          <CheckCircle className={s.icon} aria-hidden />
          <span className={s.text}>{toast.message}</span>
          <IconButton icon={X} muted label={closeLabel ?? t('Close')} onClick={dismissToast} className={s.close} />
        </div>
      )}
    </div>
  );
}

/** Wraps the app and renders the toast viewport after the children. */
export function ToastProvider({ children, closeLabel }: { children?: ReactNode; closeLabel?: string }) {
  return (
    <>
      {children}
      <ToastViewport closeLabel={closeLabel} />
    </>
  );
}
