// Sign-in page (R-038) — public, outside the app shell. Entra mode: the landing page of refused sign-ins
// (?error=<code>), of the Microsoft sign-out (?signedOut=1) and of misconfigurations, with the "Sign in with Microsoft"
// button (a plain link to the sign-in route, which redirects to Microsoft). Demo mode: there is nothing to sign in to,
// so it goes Home. A signed-in visitor without an error or sign-out notice goes Home too.
import { CheckCircle, Polygon, SignIn, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardTitle, cx } from '@/components/ds';
import { AUTH_PATHS, SIGN_IN_ERROR, isSignInError, safeReturnTo } from '@/domain/auth';
import s from '@/features/auth/sign-in.module.css';
import { authMode } from '@/server/auth/config';
import { getI18n } from '@/server/session';

export const metadata: Metadata = { title: 'Keystone PM' };

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SignInPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (authMode() !== 'entra') redirect('/');
  const error = first(sp.error);
  const signedOut = first(sp.signedOut) === '1';
  if (!error && !signedOut) {
    const { entraViewer } = await import('@/server/auth/viewer');
    if (await entraViewer().catch(() => null)) redirect('/');
  }
  const { t } = await getI18n();
  const returnTo = safeReturnTo(first(sp.returnTo));
  const href = returnTo === '/' ? AUTH_PATHS.signIn : `${AUTH_PATHS.signIn}?returnTo=${encodeURIComponent(returnTo)}`;
  const message = error ? SIGN_IN_ERROR[isSignInError(error) ? error : 'failed'] : null;
  return (
    <main className={s.page}>
      <Card elev="lg" className={s.card}>
        <div className={s.brand}>
          <div className={s.logo}>
            <Polygon size={15} />
          </div>
          <div className={s.wordmark}>{t('Keystone')}</div>
        </div>
        <CardTitle as="span">{t('Sign in to Keystone')}</CardTitle>
        <p className={s.lead}>{t('Use your EPC2i Microsoft account.')}</p>
        {message && (
          <p className={cx(s.notice, s.alert)} role="alert">
            <WarningCircle size={16} className={s.noticeIcon} aria-hidden />
            {t(message)}
          </p>
        )}
        {!message && signedOut && (
          <p className={s.notice} role="status">
            <CheckCircle size={16} className={s.noticeIcon} aria-hidden />
            {t('You are signed out.')}
          </p>
        )}
        {/* A plain link, not <Link>: the sign-in route redirects to Microsoft, which a client-side navigation cannot follow. */}
        <a href={href} className={cx('btn', 'btn-primary', 'btn-block', s.action)}>
          <SignIn aria-hidden />
          {t('Sign in with Microsoft')}
        </a>
      </Card>
    </main>
  );
}
