import { NextResponse } from 'next/server';
import { z } from 'zod';
import { collections } from '@/lib/mongo';
import type { ListingSource } from '@/lib/types';
import { currentUid } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ tracked: z.boolean() });

/** Active ou coupe le suivi d'une recherche sauvegardée. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

  const { searches, listings } = await collections();
  const result = await searches.updateOne(
    { uid, lbcSearchId: id },
    { $set: { tracked: parsed.data.tracked } },
  );
  if (!result.matchedCount) return NextResponse.json({ error: 'Recherche inconnue' }, { status: 404 });

  // En coupant le suivi, les annonces qui ne venaient que de cette recherche
  // sortent du tableau de bord ; leur historique reste en base.
  if (!parsed.data.tracked) {
    const source: ListingSource = `search:${id}`;
    await listings.updateMany({ uid, sources: source }, { $pull: { sources: source } });
    await listings.updateMany({ uid, sources: { $size: 0 } }, { $set: { isActive: false } });
  }

  return NextResponse.json({ ok: true });
}
