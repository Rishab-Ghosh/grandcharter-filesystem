import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hosted Filesystem',
  description: 'Take-home assignment: hosted filesystem',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
