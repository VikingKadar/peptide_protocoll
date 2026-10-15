/**
 * Builds knowledge-base.json from the extracts in peptider/ that the prompt uses.
 * The file ships to the server, where peptider/ does not exist.
 * Run it locally after updating the scraped data: npm run build:kb
 */
import fs from 'fs';
import { buildFromDataDir, CACHE_FILE, DATA_DIR } from './knowledge-base.js';

if (!fs.existsSync(DATA_DIR)) {
  console.error('❌ peptider/ not found — run this on the machine holding the scraped data.');
  process.exit(1);
}

const text = buildFromDataDir();
fs.writeFileSync(CACHE_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), text }));

console.log(`✅ knowledge-base.json built: ${Math.round(text.length / 1000)}k chars, ${Math.round(fs.statSync(CACHE_FILE).size / 1024)} kB`);
console.log('   Commit it so the data ships with the next deploy.');
