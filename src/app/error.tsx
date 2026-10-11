'use client';
// Error boundary of the root segment (R-176): the shell itself failed (sidebar, navigation badges), so the error card fills
// the page. The root layout (fonts, Nocturne styles, language) is still rendered. Errors of a screen are caught closer,
// inside the shell, by src/app/(app)/error.tsx; errors of the root layout by src/app/global-error.tsx.
import { RouteError } from '@/features/errors/route-error';

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} layout="page" />;
}
