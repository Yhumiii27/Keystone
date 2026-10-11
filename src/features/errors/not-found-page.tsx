// "Page not found" (R-176), Server Component: an unknown address, an unknown project or record (notFound()), in the
// viewer's language (French by default). `shell`: inside the app shell (src/app/(app)/not-found.tsx); `page`: full page
// (src/app/not-found.tsx, outside the shell). Answered with HTTP 404 by Next.js.
import { getI18n } from '@/server/session';
import { ErrorView, HomeLink } from './error-view';

export const NOT_FOUND_TEXT = {
  overline: 'Error 404',
  title: 'Page not found',
  text: 'This address matches no Keystone page, or what it pointed to no longer exists.',
  home: 'Back to Home',
} as const;

export async function NotFoundPage({ layout }: { layout: 'page' | 'shell' }) {
  const { t } = await getI18n();
  return (
    <ErrorView
      kind="not-found"
      layout={layout}
      overline={t(NOT_FOUND_TEXT.overline)}
      title={t(NOT_FOUND_TEXT.title)}
      text={t(NOT_FOUND_TEXT.text)}
      actions={<HomeLink label={t(NOT_FOUND_TEXT.home)} />}
    />
  );
}
