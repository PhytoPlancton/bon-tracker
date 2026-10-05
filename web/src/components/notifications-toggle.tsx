'use client';

import { useCallback, useEffect, useState } from 'react';

type State =
  | 'loading'
  | 'unsupported'
  /** iPhone dans Safari : les notifications n'existent que pour l'app ajoutée à l'écran d'accueil. */
  | 'install-first'
  | 'denied'
  | 'off'
  | 'on';

/**
 * Activer les notifications sur cet appareil. Le navigateur exige que la
 * demande parte d'un geste de la personne : d'où un bouton, jamais une
 * demande à l'ouverture de la page.
 */
export function NotificationsToggle({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState(await currentState());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const { publicKey } = (await (await fetch('/api/push', { cache: 'no-store' })).json()) as { publicKey: string };
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: fromBase64Url(publicKey),
        }));
      const response = await fetch('/api/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error(`Erreur ${response.status}`);
      setState('on');
      await fetch('/api/push/test', { method: 'POST' });
      setMessage('Une notification d’essai vient de partir.');
    } catch (error) {
      setMessage(`Activation impossible : ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState('off');
      setMessage(null);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const result = (await (await fetch('/api/push/test', { method: 'POST' })).json()) as { sent: number };
    setMessage(result.sent ? 'Notification d’essai envoyée.' : 'Aucun appareil n’a reçu l’essai : réactive les notifications.');
    setBusy(false);
  }

  if (state === 'loading') return null;

  return (
    <div className={compact ? '' : 'rounded-2xl border border-ink-line bg-ink-soft p-4'}>
      {!compact && <div className="text-[15px] font-medium text-zinc-100">Notifications</div>}

      {state === 'unsupported' && (
        <p className="mt-1 text-[12px] text-zinc-500">
          Ce navigateur ne reçoit pas de notifications. Les alertes restent visibles dans cet onglet.
        </p>
      )}

      {state === 'install-first' && (
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
          Sur iPhone, les notifications ne marchent que dans l’app installée : touche{' '}
          <span className="text-zinc-200">Partager</span> puis{' '}
          <span className="text-zinc-200">Sur l’écran d’accueil</span>, ouvre Bon Tracker depuis l’icône, et
          reviens ici.
        </p>
      )}

      {state === 'denied' && (
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
          Les notifications ont été refusées pour cette app. Sur iPhone : Réglages → Notifications → Bon Tracker →
          Autoriser.
        </p>
      )}

      {state === 'off' && (
        <>
          {!compact && (
            <p className="mt-1 text-[12px] text-zinc-500">
              Être prévenu sur cet appareil dès qu’une voiture sort sous le marché.
            </p>
          )}
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="mt-3 w-full rounded-xl bg-accent py-2.5 text-[14px] font-semibold text-black disabled:opacity-50"
          >
            {busy ? 'Activation…' : 'Activer les notifications'}
          </button>
        </>
      )}

      {state === 'on' && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[13px] text-down">Activées sur cet appareil</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={test}
              disabled={busy}
              className="rounded-lg border border-ink-line px-3 py-1.5 text-[12px] text-zinc-300"
            >
              Essayer
            </button>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              className="rounded-lg border border-ink-line px-3 py-1.5 text-[12px] text-zinc-500"
            >
              Couper
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-2 text-[12px] text-zinc-400">{message}</p>}
    </div>
  );
}

async function currentState(): Promise<State> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!('PushManager' in window) || !('Notification' in window)) return ios && !standalone ? 'install-first' : 'unsupported';
  if (ios && !standalone) return 'install-first';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) ? 'on' : 'off';
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}
