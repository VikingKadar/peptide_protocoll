/**
 * Bygger knowledge-base.json av de utdrag ur peptider/ som prompten använder.
 * Filen följer med till servern i drift, där peptider/ inte finns.
 * Kör detta lokalt när du uppdaterat den skrapade datan: npm run build:kb
 */
import fs from 'fs';
import { buildFromDataDir, CACHE_FILE, DATA_DIR } from './knowledge-base.js';

if (!fs.existsSync(DATA_DIR)) {
  console.error('❌ Hittar inte peptider/ — kör skriptet på datorn där den skrapade datan ligger.');
  process.exit(1);
}

const text = buildFromDataDir();
fs.writeFileSync(CACHE_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), text }));

console.log(`✅ knowledge-base.json byggd: ${Math.round(text.length / 1000)} k tecken, ${Math.round(fs.statSync(CACHE_FILE).size / 1024)} kB`);
console.log('   Committa filen så följer datan med vid nästa deploy.');
