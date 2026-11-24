'use client';
// Top bar of the compact layout (≤ 1024 px, R-146, X-4; Norma 2.0's MobileTopBar, norma/charte/COQUE.md § 8): the "Menu"
// button opening the sidebar as a drawer · the tool's name · the bell · the language / display pair, last. A Client
// Component so that the logo glyph is not passed from the server. Hidden above 1024 px (coque.css).
import { Polygon } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { MobileTopBar } from '@norma/charte/ds/AppShell';

export function KeystoneTopBar({ bell, prefs }: { bell?: ReactNode; prefs: ReactNode }) {
  return <MobileTopBar name="Keystone" icon={Polygon} tools={bell} prefs={prefs} />;
}
