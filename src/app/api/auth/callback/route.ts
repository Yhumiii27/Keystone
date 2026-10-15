// GET /api/auth/callback — the redirect URI registered in Entra ID: completes the sign-in (R-038; 404 in demo mode).
import type { NextRequest } from 'next/server';
import { handleCallback } from '@/server/auth/routes';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): Promise<Response> {
  return handleCallback(request);
}
