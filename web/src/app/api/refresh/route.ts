import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Demande un relevé immédiat au collecteur.
 *
 * Le collecteur écoute sur le réseau interne de Docker, jamais exposé au
 * dehors : cette route est le seul chemin pour lui parler, et elle est
 * protégée par la session de l'application.
 */
export async function POST() {
  try {
    const response = await fetch(`${env.workerUrl}/run`, {
      method: 'POST',
      headers: { 'x-worker-token': env.workerToken },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 409) {
      return NextResponse.json({ error: 'Un relevé est déjà en cours.' }, { status: 409 });
    }
    if (!response.ok) {
      return NextResponse.json({ error: `Le collecteur a refusé (${response.status}).` }, { status: 502 });
    }

    return NextResponse.json({ started: true });
  } catch {
    return NextResponse.json(
      { error: 'Collecteur injoignable. Vérifie qu’il tourne (docker compose ps).' },
      { status: 502 },
    );
  }
}
