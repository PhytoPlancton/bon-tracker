'use client';

import { useCallback, useEffect, useState } from 'react';

/** Petit client de lecture : le front ne parle à la base que via l’API. */
export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!response.ok) throw new Error(`Erreur ${response.status}`);
      setData((await response.json()) as T);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
