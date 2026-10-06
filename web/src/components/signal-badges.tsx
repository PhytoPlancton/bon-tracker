import type { Signal } from '@/lib/signals';

const TONE = {
  danger: 'bg-up/15 text-up',
  attention: 'bg-amber-400/15 text-amber-300',
  positive: 'bg-down/15 text-down',
} as const;

/** Badges courts ; le détail s'affiche au survol, et en entier dans une fiche. */
export function SignalBadges({ signals, max = 3 }: { signals: Signal[] | undefined; max?: number }) {
  if (!signals?.length) return null;
  // Ce qui inquiète d'abord, ce qui rassure ensuite.
  const order = { danger: 0, attention: 1, positive: 2 };
  const shown = [...signals].sort((a, b) => order[a.level] - order[b.level]).slice(0, max);
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {shown.map((signal) => (
        <span key={signal.label} title={signal.detail} className={`rounded px-1.5 py-0.5 text-[10px] ${TONE[signal.level]}`}>
          {signal.level === 'positive' ? '✓ ' : '! '}
          {signal.label}
        </span>
      ))}
      {signals.length > max && <span className="px-1 text-[10px] text-zinc-500">+{signals.length - max}</span>}
    </span>
  );
}

/** Liste complète, pour une fiche d'annonce. */
export function SignalList({ signals }: { signals: Signal[] }) {
  const order = { danger: 0, attention: 1, positive: 2 };
  return (
    <ul className="space-y-2">
      {[...signals]
        .sort((a, b) => order[a.level] - order[b.level])
        .map((signal) => (
          <li key={signal.label} className="flex gap-2 text-[13px] leading-snug">
            <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] ${TONE[signal.level]}`}>
              {signal.level === 'positive' ? '✓' : '!'} {signal.label}
            </span>
            <span className="text-zinc-300">{signal.detail}</span>
          </li>
        ))}
    </ul>
  );
}
