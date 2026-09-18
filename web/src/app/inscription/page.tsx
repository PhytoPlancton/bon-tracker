'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (response.ok) {
      router.replace('/');
      router.refresh();
      return;
    }

    const body = await response.json().catch(() => ({}));
    setError(body.error ?? 'Inscription impossible');
    setPending(false);
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="h-16 w-16 rounded-2xl" />
          <h1 className="text-xl font-semibold tracking-tight">Créer un accès</h1>
          <p className="text-sm text-zinc-500">
            Utilise les identifiants de <strong className="text-zinc-400">ton compte leboncoin</strong>.
            Ils servent à retrouver tes favoris, et te connecteront ici.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Adresse e-mail leboncoin"
            className="w-full rounded-xl border border-ink-line bg-ink-soft px-4 py-3.5 text-base outline-none placeholder:text-zinc-600 focus:border-accent"
          />
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Mot de passe leboncoin"
            className="w-full rounded-xl border border-ink-line bg-ink-soft px-4 py-3.5 text-base outline-none placeholder:text-zinc-600 focus:border-accent"
          />

          {error && (
            <p className="rounded-xl border border-up/30 bg-up/10 px-4 py-2.5 text-sm text-up">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-ink disabled:opacity-50"
          >
            {pending ? 'Vérification auprès de leboncoin…' : 'Créer mon accès'}
          </button>

          {pending && (
            <p className="text-center text-[12px] text-zinc-500">
              Une vraie connexion est ouverte sur leboncoin pour vérifier tes identifiants.
              Compte une trentaine de secondes.
            </p>
          )}
        </form>

        <p className="mt-6 text-center text-[13px] text-zinc-500">
          Déjà un accès ?{' '}
          <Link href="/login" className="font-medium text-accent">
            Se connecter
          </Link>
        </p>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-600">
          Ton mot de passe est conservé chiffré : il permet de rouvrir ta session leboncoin
          quand elle expire, sans quoi le suivi s’arrêterait.
        </p>
      </div>
    </div>
  );
}
