'use client';

/** Choix exclusif entre quelques options, d'un seul geste. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col rounded-xl border border-ink-line bg-ink p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`rounded-lg py-2 text-[14px] font-medium outline-none transition-colors ${
              selected ? 'bg-accent text-black' : 'text-zinc-400'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
