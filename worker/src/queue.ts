/**
 * File d'attente unique pour tout ce qui pilote le navigateur.
 *
 * Un relevé planifié et une estimation demandée depuis l'application ne
 * doivent jamais naviguer en même temps : deux onglets actifs depuis une même
 * connexion se remarquent, et se disputeraient le même navigateur.
 */
let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;

export function exclusive<T>(task: () => Promise<T>): Promise<T> {
  waiting += 1;
  const next = chain.then(
    () => {
      waiting -= 1;
      return task();
    },
    () => {
      waiting -= 1;
      return task();
    },
  );
  chain = next.catch(() => undefined);
  return next;
}

/** Tâches en attente derrière celle qui s'exécute. */
export function queued(): number {
  return waiting;
}
