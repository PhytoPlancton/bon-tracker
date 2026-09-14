import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { collections } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function guard(request: Request) {
  return isWorkerAuthorized(request.headers.get('x-worker-token'));
}

/** Le worker demande la liste des recherches qu'il doit parcourir. */
export async function GET(request: Request) {
  if (!guard(request)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { searches } = await collections();
  const tracked = await searches
    .find({ tracked: true }, { projection: { _id: 0, lbcSearchId: 1, name: 1, url: 1 } })
    .toArray();

  return NextResponse.json({ searches: tracked });
}

const schema = z.object({
  searches: z
    .array(
      z.object({
        lbcSearchId: z.string().min(1),
        name: z.string().min(1),
        url: z.string().url(),
        category: z.string().nullable().optional(),
        itemCount: z.number().int().nonnegative().optional(),
      }),
    )
    .max(200),
});

/**
 * Le worker remonte les recherches sauvegardées trouvées sur le compte.
 * On ne touche jamais au drapeau `tracked` : c'est un choix de l'utilisateur.
 */
export async function POST(request: Request) {
  if (!guard(request)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  if (!parsed.data.searches.length) return NextResponse.json({ upserted: 0 });

  const { searches } = await collections();
  await searches.bulkWrite(
    parsed.data.searches.map((item) => ({
      updateOne: {
        filter: { lbcSearchId: item.lbcSearchId },
        update: {
          $set: {
            name: item.name,
            url: item.url,
            category: item.category ?? null,
            itemCount: item.itemCount ?? 0,
          },
          $setOnInsert: { lbcSearchId: item.lbcSearchId, tracked: false, lastRunAt: null },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return NextResponse.json({ upserted: parsed.data.searches.length });
}
