import { NextResponse } from 'next/server';
import { z } from 'zod';
import { collections } from '@/lib/mongo';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ cookieHeader: z.string().min(10).max(20_000) });

/**
 * Porte de secours : quand le login automatique se heurte à une vérification
 * (nouvel appareil, challenge anti-bot), on colle l'en-tête `Cookie` relevé
 * dans un navigateur déjà connecté. Converti au format storageState Playwright,
 * puis chiffré avant stockage.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

  const cookies = parseCookieHeader(parsed.data.cookieHeader);
  if (!cookies.length) {
    return NextResponse.json({ error: 'Aucun cookie exploitable trouvé' }, { status: 400 });
  }

  const storageState = { cookies, origins: [] };
  const { secrets } = await collections();
  await secrets.updateOne(
    { key: 'lbc_session' },
    { $set: { ...encrypt(JSON.stringify(storageState)), updatedAt: new Date() } },
    { upsert: true },
  );

  return NextResponse.json({ ok: true, cookies: cookies.length });
}

function parseCookieHeader(header: string) {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90;
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      if (index <= 0) return null;
      return {
        name: part.slice(0, index).trim(),
        value: part.slice(index + 1).trim(),
        domain: '.leboncoin.fr',
        path: '/',
        expires,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax' as const,
      };
    })
    .filter((cookie): cookie is NonNullable<typeof cookie> => cookie !== null);
}
