import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Valiant Prospector',
  description: 'Sistema premium de automacao comercial B2B',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
