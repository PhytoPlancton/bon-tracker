function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

/**
 * Lu paresseusement : au build Next évalue les modules sans que les secrets
 * soient injectés, on ne doit donc jamais valider à l'import.
 */
export const env = {
  get mongoUri() {
    return required('MONGODB_URI');
  },
  get mongoDb() {
    return process.env.MONGODB_DB || 'bon_tracker';
  },
  /** Clé AES-256 (32 octets en base64) pour chiffrer la session leboncoin. */
  get encryptionKey() {
    return required('ENCRYPTION_KEY');
  },
  /** Secret de signature des cookies de session applicative. */
  get sessionSecret() {
    return required('SESSION_SECRET');
  },
  /** Jeton partagé avec le worker pour /api/internal/*. */
  get workerToken() {
    return required('WORKER_TOKEN');
  },
  /** Serveur de commandes du collecteur, sur le réseau interne de Docker. */
  get workerUrl() {
    return (process.env.WORKER_URL || 'http://worker:3001').replace(/\/$/, '');
  },
};
