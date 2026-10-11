// GET /api/auth/sign-in?returnTo=/path — starts the Microsoft Entra ID sign-in (R-038; 404 in demo mode).
import type { NextRequest } from 'next/server';
import { handleSignIn } from '@/server/auth/routes';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): Promise<Response> {
  return handleSignIn(request);
}
