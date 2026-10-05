'use client';

import { createContext, useContext } from 'react';
import type { Mode } from '@/lib/mode';

const ModeContext = createContext<Mode>('auto');

/** Rend le mode du compte, lu côté serveur, à tous les écrans. */
export function ModeProvider({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  return <ModeContext.Provider value={mode}>{children}</ModeContext.Provider>;
}

export function useMode(): Mode {
  return useContext(ModeContext);
}

/** Une maison : la marque de Bon Tracker Immo, dans la barre comme en tête. */
export function HouseIcon({ className = 'h-6 w-6', strokeWidth = 1.8 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" strokeWidth={strokeWidth}>
      <path
        d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Une voiture vue de profil : la marque de Bon Tracker. */
export function CarIcon({ className = 'h-6 w-6', strokeWidth = 1.8 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" strokeWidth={strokeWidth}>
      <path
        d="M3.5 15.5v-2.8a2 2 0 0 1 1.1-1.8L6.5 10l1.8-3.2A2 2 0 0 1 10 5.8h4.3a2 2 0 0 1 1.6.8l2.6 3.4 1.6.6a2 2 0 0 1 1.4 1.9v3"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      <path d="M6.5 10h12" stroke="currentColor" strokeLinecap="round" />
      <path d="M9.5 16.5h5" stroke="currentColor" strokeLinecap="round" />
      <circle cx="7" cy="16.5" r="1.9" stroke="currentColor" />
      <circle cx="17" cy="16.5" r="1.9" stroke="currentColor" />
    </svg>
  );
}
