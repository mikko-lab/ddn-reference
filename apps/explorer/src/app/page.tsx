// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link';
import type { JSX } from 'react';

export default function HomePage(): JSX.Element {
  return (
    <main>
      <h1>DDN Explorer</h1>
      <p>Public tools for independently verifying Deterministic Decision Network decisions.</p>
      <ul>
        <li>
          <Link href="/verify">Verify a receipt</Link>
        </li>
      </ul>
    </main>
  );
}
