'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Ouvre la fiche de négociation d'une annonce, en la créant au besoin. */
export function NegotiateButton({
  lbcId,
  className = '',
  label = 'Négocier',
}: {
  lbcId: string;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(event: React.MouseEvent) {
    // Souvent posé dans une ligne cliquable : ce bouton-ci ne l'ouvre pas.
    event.preventDefault();
    event.stopPropagation();
    setBusy(true);
    setError(null);
    const response = await fetch('/api/negociations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ annonce: lbcId }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? `Erreur ${response.status}`);
      return;
    }
    router.push(`/negocier/${body.id}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={`rounded-lg border border-accent/50 px-2.5 py-1 text-[12px] font-medium text-accent disabled:opacity-50 ${className}`}
      >
        {busy ? '…' : label}
      </button>
      {error && <span className="block text-[11px] text-up">{error}</span>}
    </>
  );
}
