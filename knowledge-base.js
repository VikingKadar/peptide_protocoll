const fs = require('fs');
const path = require('path');
const { PEPTIDE_CATALOG } = require('./catalog');

const DATA_DIR = path.join(__dirname, 'peptider');
const CACHE_FILE = path.join(__dirname, 'knowledge-base.json');

// Skrapade sidor som blev blockerade (429, captcha) innehåller ingen användbar data
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

// Läser peptider/ och plockar ut de utdrag som faktiskt används i prompten
function buildFromDataDir({ warn = true } = {}) {
  return PEPTIDE_CATALOG.map(p => {
    const text = p.sources
      .map((src, i) => readSource(src, i === 0 ? 2500 : 1200))
      .filter(Boolean)
      .join('\n\n');
    if (!text && warn) console.warn(`⚠️  Ingen data hittades för ${p.name}`);
    return `### ${p.id} — ${p.name}\n${text || '(ingen lokal data)'}`;
  }).join('\n\n');
}

/**
 * I drift finns sällan peptider/ på servern — då används den förbyggda
 * knowledge-base.json. Lokalt läses mappen direkt så att ny skrapad data
 * slår igenom utan att filen behöver byggas om.
 */
function loadKnowledgeBase() {
  if (fs.existsSync(DATA_DIR)) {
    return { text: buildFromDataDir(), source: 'peptider/' };
  }
  if (fs.existsSync(CACHE_FILE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    return { text: cached.text, source: `knowledge-base.json (byggd ${cached.generatedAt?.slice(0, 10)})` };
  }
  throw new Error('Hittar varken peptider/ eller knowledge-base.json — kör "npm run build:kb" lokalt först.');
}

module.exports = { buildFromDataDir, loadKnowledgeBase, CACHE_FILE, DATA_DIR };
