const DOWN = '#4ade80';
const UP = '#f87171';
const FLAT = '#6b7280';

/** Aperçu compact de la trajectoire de prix, en marches comme le graphe détaillé. */
export function Sparkline({
  prices,
  width = 64,
  height = 24,
}: {
  prices: number[];
  width?: number;
  height?: number;
}) {
  if (prices.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden="true">
        <line
          x1={2}
          x2={width - 2}
          y1={height / 2}
          y2={height / 2}
          stroke={FLAT}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const step = (width - 4) / (prices.length - 1);
  const y = (price: number) => height - 3 - ((price - min) / span) * (height - 6);

  let path = `M 2 ${y(prices[0])}`;
  prices.slice(1).forEach((price, index) => {
    const x = 2 + (index + 1) * step;
    path += ` L ${x} ${y(prices[index])} L ${x} ${y(price)}`;
  });

  const trend = prices[prices.length - 1] - prices[0];
  const color = trend < 0 ? DOWN : trend > 0 ? UP : FLAT;

  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
