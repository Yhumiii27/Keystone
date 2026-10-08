'use client';
// Records the last project used (cookie ks-project, read by getLastProject()) when a project page mounts.
import { useEffect } from 'react';

const YEAR = 60 * 60 * 24 * 365;

export function RememberProject({ code }: { code: string }) {
  useEffect(() => {
    document.cookie = `ks-project=${encodeURIComponent(code)}; path=/; max-age=${YEAR}; samesite=lax`;
  }, [code]);
  return null;
}
