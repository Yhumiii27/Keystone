// "Page not found" outside the shell (R-176): addresses no route matches and notFound() outside the app screens. HTTP 404.
// Translated, French by default.
import { NotFoundPage } from '@/features/errors/not-found-page';

export default function RootNotFound() {
  return <NotFoundPage layout="page" />;
}
