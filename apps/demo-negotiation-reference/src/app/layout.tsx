// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'DDN Negotiation Reference Demo',
  description: 'A self-contained, synthetic demo of the Deterministic Decision Network offer flow.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '1.5rem', maxWidth: '48rem', marginInline: 'auto' }}>
        {children}
      </body>
    </html>
  );
}
