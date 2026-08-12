#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Regenerates or checks apps/api/openapi/ddn-api-v1.json, the committed
// OpenAPI document for DDN API v1. Deterministic: buildOpenApiDocument()
// depends only on the committed JSON Schema files under
// packages/schemas/json/api-v1/, so the same input always produces
// byte-identical output.
//
// --check: CI's mode. Fails loudly if the committed file doesn't match
// what the schemas currently produce -- CI never auto-updates this file,
// so a schema change that wasn't followed by `pnpm openapi:generate` is
// caught here instead of silently drifting.
// --confirm-update: the only way to (re)write the file. No argument-less
// default, matching this repo's convention for regenerating committed
// artifacts (see apps/coordinator's generate-golden-vectors).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildOpenApiDocument } from './build-openapi-document.js';

const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../openapi/ddn-api-v1.json');

function serialize(document: Record<string, unknown>): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean', default: false },
      'confirm-update': { type: 'boolean', default: false },
    },
  });

  if (values.check === values['confirm-update']) {
    throw new Error('pass exactly one of --check or --confirm-update');
  }

  const generated = serialize(buildOpenApiDocument());

  if (values['confirm-update']) {
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, generated);
    console.log(`wrote ${OUTPUT_PATH}`);
    return;
  }

  let committed: string;
  try {
    committed = await readFile(OUTPUT_PATH, 'utf8');
  } catch {
    throw new Error(`${OUTPUT_PATH} does not exist -- run \`pnpm --filter @ddn/api run openapi:generate\` and commit the result`);
  }

  if (committed !== generated) {
    throw new Error(
      `${OUTPUT_PATH} is out of date with the current JSON Schema files -- run \`pnpm --filter @ddn/api run openapi:generate\` and commit the result`
    );
  }
  console.log(`${OUTPUT_PATH} is up to date`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
