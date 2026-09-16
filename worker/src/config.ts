function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

/**
 * Secret possiblement porteur de caractères que Docker Compose interprète.
 * Il est transmis encodé en base64 ; la variable en clair reste acceptée pour
 * un lancement hors Docker.
 */
function requiredSecret(name: string): string {
  const encoded = process.env[`${name}_B64`]?.trim();
  if (encoded) {
    const value = Buffer.from(encoded, 'base64').toString('utf8').trim();
    if (value) return value;
  }
  return required(name);
}

export const config = {
  /** URL publique de l'app web, à laquelle le worker parle. */
  apiBaseUrl: required('API_BASE_URL').replace(/\/$/, ''),
  workerToken: required('WORKER_TOKEN'),
  lbcEmail: required('LBC_EMAIL'),
  lbcPassword: requiredSecret('LBC_PASSWORD'),
  /** Toutes les 6 h par défaut, décalé pour éviter les heures rondes. */
  schedule: process.env.CRON_SCHEDULE || '17 */6 * * *',
  /** Relevé immédiat au démarrage : à n'activer que délibérément. */
  runOnStart: process.env.RUN_ON_START === 'true',
  headless: process.env.HEADLESS !== 'false',
  /** Pause entre deux pages, pour ne pas marteler le site. */
  pageDelayMs: Number(process.env.PAGE_DELAY_MS || 4000),
  maxSearchPages: Number(process.env.MAX_SEARCH_PAGES || 2),
};

export const LBC_ORIGIN = 'https://www.leboncoin.fr';
