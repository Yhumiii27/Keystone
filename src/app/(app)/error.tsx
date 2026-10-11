'use client';
// Error boundary of the app's screens (R-176): an error in a screen (or a project layout) shows the error card inside the
// shell, so the sidebar stays usable. Incident identifier, Try again, Back to Home: src/features/errors/route-error.tsx.
import { RouteError } from '@/features/errors/route-error';

export default function ScreenError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} layout="shell" />;
}
