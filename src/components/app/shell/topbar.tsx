'use client';
// Top bar of the compact layout (≤ 1024 px, R-146, X-4; Norma 2.0's MobileTopBar, norma/charte/COQUE.md § 8): the "Menu"
// button opening the sidebar as a drawer · the tool's name · the bell · the language / display pair, last. A Client
// Component so that the logo is not passed from the server. The brand is the tool's logo (Norma 2.3, COQUE.md § 8 bis). Hidden above 1024 px (coque.css).
import type { ReactNode } from 'react';
import { MobileTopBar } from '@norma/charte/ds/AppShell';
import { ToolLogo } from '@norma/charte/ds/ToolLogo';

export function KeystoneTopBar({ bell, prefs }: { bell?: ReactNode; prefs: ReactNode }) {
  return <MobileTopBar name="Keystone" logo={<ToolLogo code="keystone" size={20} />} tools={bell} prefs={prefs} />;
}
