import { NextResponse } from 'next/server';
import { currentUid } from '@/lib/auth';
import { PlacesUnavailable, searchPlaces } from '@/lib/immo/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Communes proposées pendant la saisie : par nom, ou par code postal. */
export async function GET(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const query = new URL(request.url).searchParams.get('q') ?? '';
  try {
    return NextResponse.json({ places: await searchPlaces(query.slice(0, 80)) });
  } catch (cause) {
    const message =
      cause instanceof PlacesUnavailable
        ? `${cause.message} Saisis un code postal à 5 chiffres pour continuer.`
        : 'Recherche de commune impossible.';
    return NextResponse.json({ error: message, places: [] }, { status: 502 });
  }
}
