import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorker } from '@/components/service-worker';

export const metadata: Metadata = {
  title: 'Bon Tracker',
  description: 'Historique de prix des annonces suivies',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Bon Tracker',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0b0c0e',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="font-sans antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
