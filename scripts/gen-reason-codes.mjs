#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Regenerates packages/schemas/json/reason-codes-v1.json from
// @ddn/schemas' NEGOTIATION_REASON_CODES_V1 constant (the single source of
// truth), so the policy package's reason-codes.json can never drift from
// the TypeScript registry. Run after `pnpm --filter @ddn/schemas run build`.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NEGOTIATION_REASON_CODES_V1 } from '../packages/schemas/dist/index.js';

const outPath = fileURLToPath(new URL('../packages/schemas/json/reason-codes-v1.json', import.meta.url));
writeFileSync(outPath, JSON.stringify({ reasonCodes: NEGOTIATION_REASON_CODES_V1 }, null, 2) + '\n');
console.log(`wrote ${NEGOTIATION_REASON_CODES_V1.length} reason codes to ${outPath}`);
