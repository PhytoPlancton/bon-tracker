'use client';

import { useEffect } from 'react';

/** Enregistre le service worker : condition nécessaire à l'installation iOS. */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Une PWA non installable ne doit pas casser la navigation.
    });
  }, []);

  return null;
}
