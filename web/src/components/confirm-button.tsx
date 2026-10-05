'use client';

import { useEffect, useState } from 'react';

/**
 * Action à confirmer d'un second appui, sans boîte de dialogue du navigateur.
 *
 * Une confirmation native restée ouverte dans un onglet bloque tout ce qui
 * pilote ce navigateur — le collecteur compris, quand l'app est ouverte dans
 * le Chrome dédié. Un second appui dit la même chose sans rien figer.
 */
export function ConfirmButton({
  onConfirm,
  label,
  confirmLabel,
  className,
}: {
  onConfirm: () => void | Promise<void>;
  label: string;
  confirmLabel: string;
  className: string;
}) {
  const [armed, setArmed] = useState(false);

  // Sans second appui, la demande retombe d'elle-même.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      onClick={() => {
        if (armed) void onConfirm();
        else setArmed(true);
      }}
      className={`${className} ${armed ? 'border-up/60 text-up' : ''}`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
