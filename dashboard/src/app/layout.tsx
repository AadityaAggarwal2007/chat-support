import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chat Support Dashboard',
  description: 'Manage your customer conversations',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
