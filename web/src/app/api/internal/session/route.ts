import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerAuthorized } from '@/lib/auth';
import { collections } from '@/lib/mongo';
import { decrypt, encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SECRET_KEY = 'lbc_session';

function guard(request: Request) {
  return isWorkerAuthorized(request.headers.get('x-worker-token'));
}

/** Le worker récupère la session leboncoin persistée (storageState Playwright). */
export async function GET(request: Request) {
  if (!guard(request)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { secrets } = await collections();
  const doc = await secrets.findOne({ key: SECRET_KEY });
  if (!doc) return NextResponse.json({ storageState: null, updatedAt: null });

  try {
    return NextResponse.json({
      storageState: JSON.parse(decrypt(doc)),
      updatedAt: doc.updatedAt.toISOString(),
    });
  } catch {
    // Clé de chiffrement changée ou donnée corrompue : on repart d'un login propre.
    return NextResponse.json({ storageState: null, updatedAt: null });
  }
}

const putSchema = z.object({ storageState: z.record(z.unknown()) });

/** Le worker range la session fraîche après un login réussi. */
export async function PUT(request: Request) {
  if (!guard(request)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

  const { secrets } = await collections();
  const encrypted = encrypt(JSON.stringify(parsed.data.storageState));
  await secrets.updateOne(
    { key: SECRET_KEY },
    { $set: { ...encrypted, updatedAt: new Date() } },
    { upsert: true },
  );

  return NextResponse.json({ ok: true });
}
