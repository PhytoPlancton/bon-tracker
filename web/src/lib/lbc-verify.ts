import { env } from './env';

export type Verification = { outcome: string; detail?: string; storageState?: unknown };

/**
 * Demande au collecteur d'ouvrir une vraie session leboncoin avec ces
 * identifiants. Null quand il est injoignable — ou occupé trop longtemps
 * par une collecte : il ne mène qu'une chose à la fois.
 */
export async function verifyWithLeboncoin(email: string, password: string): Promise<Verification | null> {
  try {
    const response = await fetch(`${env.workerUrl}/verify-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-token': env.workerToken },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(120_000),
    });
    return (await response.json()) as Verification;
  } catch {
    return null;
  }
}

export function explainRefusal(outcome: string): string {
  switch (outcome) {
    case 'bad_credentials':
      return 'leboncoin a refusé ces identifiants. Vérifie-les sur leboncoin.fr.';
    case 'verification_required':
      return 'leboncoin demande un code de vérification par e-mail. Connecte-toi une fois sur leboncoin.fr, puis réessaie.';
    case 'blocked':
      return 'leboncoin a opposé une vérification anti-robot. Réessaie dans quelques minutes.';
    default:
      return 'La connexion à leboncoin n’a pas abouti. Réessaie plus tard.';
  }
}

/**
 * Adresse du visiteur, pour le limiteur de tentatives. Derrière le tunnel,
 * Cloudflare la donne lui-même ; sans elle, tous les visiteurs partageraient
 * le même compteur, et les erreurs d'un seul bloqueraient tout le monde.
 */
export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
