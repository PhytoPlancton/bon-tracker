'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (response.ok) {
      router.replace(params.get('next') || '/');
      router.refresh();
      return;
    }

    const body = await response.json().catch(() => ({}));
    setError(body.error ?? 'Connexion impossible');
    setPending(false);
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="h-16 w-16 rounded-2xl" />
          <h1 className="text-xl font-semibold tracking-tight">Bon Tracker</h1>
          <p className="text-sm text-zinc-500">Historique de prix des annonces suivies</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Adresse e-mail"
            className="w-full rounded-xl border border-ink-line bg-ink-soft px-4 py-3.5 text-base outline-none placeholder:text-zinc-600 focus:border-accent"
          />
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Mot de passe"
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
            {pending ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
