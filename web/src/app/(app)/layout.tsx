import type { Metadata } from 'next';
import { BottomNav } from '@/components/bottom-nav';
import { HouseIcon, ModeProvider } from '@/components/mode';
import { currentMode } from '@/lib/mode-server';

export async function generateMetadata(): Promise<Metadata> {
  return (await currentMode()) === 'immo' ? { title: 'Bon Tracker Immo' } : {};
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const mode = await currentMode();

  return (
    <ModeProvider mode={mode}>
      {/* L'attribut porte le thème : l'accent passe au bleu en mode immo. */}
      <div data-mode={mode} className="mx-auto min-h-dvh w-full max-w-2xl px-4 pt-safe">
        {mode === 'immo' && (
          <div className="flex items-center gap-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
            <HouseIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
            Bon Tracker Immo
          </div>
        )}
        <main className="mb-safe-nav">{children}</main>
        <BottomNav />
      </div>
    </ModeProvider>
  );
}
