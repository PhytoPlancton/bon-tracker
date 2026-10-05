import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUid } from '@/lib/auth';
import { acceptableEndpoint, countSubscriptions, removeSubscription, saveSubscription, vapidKeys } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Clé publique à présenter au navigateur, et nombre d'appareils déjà abonnés. */
export async function GET() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const [{ publicKey }, devices] = await Promise.all([vapidKeys(), countSubscriptions(uid)]);
  return NextResponse.json({ publicKey, devices });
}

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
});

export async function POST(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !acceptableEndpoint(parsed.data.endpoint)) {
    return NextResponse.json({ error: 'Abonnement invalide' }, { status: 400 });
  }
  await saveSubscription(uid, parsed.data, request.headers.get('user-agent'));
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const parsed = z.object({ endpoint: z.string().max(1000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  await removeSubscription(uid, parsed.data.endpoint);
  return NextResponse.json({ ok: true });
}
