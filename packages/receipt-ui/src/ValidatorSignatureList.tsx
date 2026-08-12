// SPDX-License-Identifier: Apache-2.0
import type { JSX } from 'react';
import type { SignedValidatorResultV1 } from '@ddn/receipt-sdk';

export interface ValidatorSignatureListProps {
  readonly signedResults: readonly SignedValidatorResultV1[];
}

/** One row per signed validator result -- validatorId, execution status,
 * and outputHash. Never renders a signature or public key raw; those are
 * verified by @ddn/receipt-sdk, not displayed for a human to eyeball. */
export function ValidatorSignatureList({ signedResults }: ValidatorSignatureListProps): JSX.Element {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Validator</th>
          <th scope="col">Status</th>
          <th scope="col">Output hash</th>
        </tr>
      </thead>
      <tbody>
        {signedResults.map((signed) => (
          <tr key={signed.result.validatorId}>
            <td style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{signed.result.validatorId}</td>
            <td>{signed.result.status}</td>
            <td style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{signed.result.outputHash}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
