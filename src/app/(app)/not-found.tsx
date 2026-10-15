// "Page not found" inside the shell (R-176): unknown screens and paths (the catch-all routes call notFound()), unknown
// projects, tasks or records of a screen. HTTP 404. Translated, French by default.
import { NotFoundPage } from '@/features/errors/not-found-page';

export default function AppNotFound() {
  return <NotFoundPage layout="shell" />;
}
