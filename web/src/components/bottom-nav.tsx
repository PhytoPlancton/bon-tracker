'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Suivi', icon: ChartIcon },
  { href: '/recherches', label: 'Recherches', icon: SearchIcon },
  { href: '/reglages', label: 'Réglages', icon: GearIcon },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-line bg-ink/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-2xl items-stretch justify-around px-2 pt-2 pb-safe">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition-colors ${
                active ? 'text-accent' : 'text-zinc-500'
              }`}
            >
              <Icon active={active} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function ChartIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" strokeWidth={active ? 2.2 : 1.8}>
      <path d="M4 16.5 9 11l3.5 3L20 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="11" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="14" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" strokeWidth={active ? 2.2 : 1.8}>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" />
      <path d="m16 16 4 4" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" strokeWidth={active ? 2.2 : 1.8}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" />
      {/* Contour denté : sans les dents, l'icône se lit comme un soleil. */}
      <path
        d="M19.4 14.5a1.6 1.6 0 0 0 .33 1.77l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.05-.06a1.6 1.6 0 0 0-1.78-.33 1.6 1.6 0 0 0-.97 1.47v.17a1.9 1.9 0 0 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.33l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .33-1.77 1.6 1.6 0 0 0-1.47-.98h-.17a1.9 1.9 0 1 1 0-3.8h.09a1.6 1.6 0 0 0 1.47-1.04 1.6 1.6 0 0 0-.33-1.78l-.06-.05a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.77.33h.08a1.6 1.6 0 0 0 .97-1.47v-.17a1.9 1.9 0 1 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.78-.33l.05-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.33 1.77v.08a1.6 1.6 0 0 0 1.47.97h.17a1.9 1.9 0 0 1 0 3.8h-.09a1.6 1.6 0 0 0-1.47.97Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
