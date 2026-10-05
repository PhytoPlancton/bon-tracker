import { NextResponse } from 'next/server';
import { currentUid } from '@/lib/auth';
import { sendToUser } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Notification d'essai, pour vérifier qu'un appareil reçoit bien. */
export async function POST() {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const result = await sendToUser(uid, {
    title: 'Notifications activées',
    body: 'Tu seras prévenu ici dès qu’une voiture sortira sous le marché.',
    url: '/alertes',
    tag: 'essai',
  });
  return NextResponse.json(result);
}
