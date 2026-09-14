function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export const config = {
  /** URL publique de l'app web, à laquelle le worker parle. */
  apiBaseUrl: required('API_BASE_URL').replace(/\/$/, ''),
  workerToken: required('WORKER_TOKEN'),
  lbcEmail: required('LBC_EMAIL'),
  lbcPassword: required('LBC_PASSWORD'),
  /** Toutes les 6 h par défaut, décalé pour éviter les heures rondes. */
  schedule: process.env.CRON_SCHEDULE || '17 */6 * * *',
  runOnStart: process.env.RUN_ON_START !== 'false',
  headless: process.env.HEADLESS !== 'false',
  /** Pause entre deux pages, pour ne pas marteler le site. */
  pageDelayMs: Number(process.env.PAGE_DELAY_MS || 4000),
  maxSearchPages: Number(process.env.MAX_SEARCH_PAGES || 2),
};

export const LBC_ORIGIN = 'https://www.leboncoin.fr';
