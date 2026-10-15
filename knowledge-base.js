import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { PEPTIDE_CATALOG } from './catalog.js';

const DATA_DIR = path.join(__dirname, 'peptider');
const CACHE_FILE = path.join(__dirname, 'knowledge-base.json');

// Scraped pages that got blocked (429, captcha) hold no usable data
const JUNK_MARKERS = ['Security Checkpoint', 'Too Many Requests', 'error 429'];

function readSource(relPath, maxChars) {
  try {
    let text = fs.readFileSync(path.join(DATA_DIR, relPath), 'utf-8').replace(/^﻿/, '');
    if (JUNK_MARKERS.some(m => text.includes(m))) return '';
    const contentStart = text.indexOf('Markdown Content:');
    if (contentStart !== -1) text = text.slice(contentStart + 'Markdown Content:'.length);
    return text.replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
  } catch {
    return '';
  }
}

// Reads peptider/ and pulls out the extracts the prompt actually uses
function buildFromDataDir({ warn = true } = {}) {
  return PEPTIDE_CATALOG.map(p => {
    const text = p.sources
      .map((src, i) => readSource(src, i === 0 ? 2500 : 1200))
      .filter(Boolean)
      .join('\n\n');
    if (!text && warn) console.warn(`⚠️  No data found for ${p.name}`);
    return `### ${p.id} — ${p.name}\n${text || '(no local data)'}`;
  }).join('\n\n');
}

/**
 * A deployed server rarely has peptider/, so it falls back to the prebuilt
 * knowledge-base.json. Locally the folder is read directly, so new scraped data
 * takes effect without rebuilding the file.
 */
function loadKnowledgeBase() {
  if (fs.existsSync(DATA_DIR)) {
    return { text: buildFromDataDir(), source: 'peptider/' };
  }
  if (fs.existsSync(CACHE_FILE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    return { text: cached.text, source: `knowledge-base.json (built ${cached.generatedAt?.slice(0, 10)})` };
  }
  throw new Error('Neither peptider/ nor knowledge-base.json found — run "npm run build:kb" locally first.');
}

export { buildFromDataDir, loadKnowledgeBase, CACHE_FILE, DATA_DIR };
