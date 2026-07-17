import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Distributed RAG Scraper',
  description: 'Search and ask questions over crawled content.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
