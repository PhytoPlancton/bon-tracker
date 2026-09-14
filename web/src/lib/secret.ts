/**
 * Lecture d'un secret transmis par l'environnement.
 *
 * Docker Compose interprète « $ » dans tout fichier d'environnement qu'il lit,
 * `env_file` compris : un hash bcrypt (« $2a$12$… ») y perd silencieusement une
 * partie de sa valeur. Les secrets susceptibles d'en contenir sont donc encodés
 * en base64, qui n'utilise aucun caractère interprété.
 *
 * La variable en clair reste acceptée pour un lancement hors Docker.
 */
export function readSecret(name: string): string | null {
  const encoded = process.env[`${name}_B64`]?.trim();
  if (encoded) {
    try {
      const value = Buffer.from(encoded, 'base64').toString('utf8').trim();
      if (value) return value;
    } catch {
      // Valeur illisible : on tente la variable en clair ci-dessous.
    }
  }
  return process.env[name]?.trim() || null;
}
