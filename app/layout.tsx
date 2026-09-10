import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VaccEval | Infectious disease surveillance',
  description: 'Transparent regional surveillance and short-term forecasting of respiratory infections.',
  openGraph: {
    title: 'VaccEval',
    description: 'Transparent infectious disease surveillance',
    images: [{ url: '/og.png', width: 1536, height: 1024, alt: 'VaccEval surveillance dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VaccEval',
    description: 'Transparent infectious disease surveillance',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
