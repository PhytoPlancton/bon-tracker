function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export const config = {
  /** URL publique de l'app web, à laquelle le worker parle. */
  apiBaseUrl: required('API_BASE_URL').replace(/\/$/, ''),
  workerToken: required('WORKER_TOKEN'),

  /**
   * Chrome à piloter. Le collecteur n'ouvre plus son propre navigateur : il se
   * rattache à un Chrome installé sur la machine, dont l'empreinte est celle
   * d'un vrai poste. Un navigateur lancé par Playwright se fait reconnaître au
   * premier coup d'œil par la protection anti-robot du site.
   */
  chromeHost: process.env.CHROME_HOST || 'host.docker.internal',
  chromePort: Number(process.env.CHROME_PORT || 9222),

  /** Toutes les 6 h par défaut, décalé pour éviter les heures rondes. */
  schedule: process.env.CRON_SCHEDULE || '17 */6 * * *',
  runOnStart: process.env.RUN_ON_START === 'true',
  /** Port du serveur de commandes, joignable seulement depuis le réseau Docker. */
  commandPort: Number(process.env.WORKER_PORT || 3001),
  /** Pause entre deux pages, pour ne pas marteler le site. */
  pageDelayMs: Number(process.env.PAGE_DELAY_MS || 4000),
};

export const LBC_ORIGIN = 'https://www.leboncoin.fr';
