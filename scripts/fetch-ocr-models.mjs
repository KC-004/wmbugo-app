#!/usr/bin/env node
// Fetches the two receipt-reading models into the Android assets (Story 10.10, decision S3).
//
//   node scripts/fetch-ocr-models.mjs            # download what is missing, verify every file
//   node scripts/fetch-ocr-models.mjs --check    # verify only (exit 1 if a file is missing or wrong); never touches the network
//
// The files are PaddleOCR PP-OCRv4 (Apache-2.0) as converted by the RapidOCR project. They are pinned by SHA-256, kept out of git
// (apps/mobile/android/app/src/main/assets/ocr is ignored) and packaged into the APK, so the app itself never downloads anything.
// A build made without them still works: receipt reading then says it is unavailable.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const OCR_DIR = resolve(here, '../apps/mobile/android/app/src/main/assets/ocr');
const BASE = 'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4';

export const MODELS = [
  { name: 'ch_PP-OCRv4_det_infer.onnx', bytes: 4_745_517, sha256: 'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9' },
  { name: 'ch_PP-OCRv4_rec_infer.onnx', bytes: 10_857_958, sha256: '48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b' },
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function verify(m) {
  const file = join(OCR_DIR, m.name);
  if (!existsSync(file)) return 'missing';
  const buf = readFileSync(file);
  return buf.length === m.bytes && sha(buf) === m.sha256 ? 'ok' : 'wrong';
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let bad = 0;
  for (const m of MODELS) {
    let state = verify(m);
    if (state !== 'ok' && !checkOnly) {
      mkdirSync(OCR_DIR, { recursive: true });
      const res = await fetch(`${BASE}/${m.name}`);
      if (!res.ok) throw new Error(`${m.name}: HTTP ${res.status}`);
      writeFileSync(join(OCR_DIR, m.name), Buffer.from(await res.arrayBuffer()));
      state = verify(m);
    }
    console.log(`${state === 'ok' ? 'ok ' : 'FAIL'} ${m.name} (${state})`);
    if (state !== 'ok') bad++;
  }
  if (bad > 0) {
    console.error('fetch-ocr-models: a model is missing or does not match its pinned hash.');
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
