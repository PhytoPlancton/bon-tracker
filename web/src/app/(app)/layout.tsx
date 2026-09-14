import { BottomNav } from '@/components/bottom-nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pt-safe">
      <main className="mb-safe-nav">{children}</main>
      <BottomNav />
    </div>
  );
}
