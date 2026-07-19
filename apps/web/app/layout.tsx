import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Nav } from '@/components/nav';
import { cn } from '@/lib/utils';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Scraper',
  description: 'Search and ask questions over crawled content.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(sans.variable, mono.variable, 'dark')}>
      <body className="min-h-screen bg-zinc-950 font-sans text-zinc-200 antialiased">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(255,255,255,0.06),transparent)]"
        />
        <Nav />
        <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
