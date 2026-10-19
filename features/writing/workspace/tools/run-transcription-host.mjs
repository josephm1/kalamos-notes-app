import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [bundlePath, snapshotPath, resultsPath, outputPath] = process.argv.slice(2);
if (!outputPath || !outputPath.endsWith('/materialized-pages.json')) {
  throw Error('Supply browser bundle, native snapshot, tool results and .../materialized-pages.json.');
}
const browser = await chromium.launch({ headless: true, ...(process.env.NOTES_HOST_CHROMIUM ? { executablePath: process.env.NOTES_HOST_CHROMIUM } : {}) });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: fs.readFileSync(bundlePath, 'utf8') });
  const result = await page.evaluate(({ snapshot, results }) =>
    HostTranscription.materializeHostResult(snapshot, results), {
      snapshot: JSON.parse(fs.readFileSync(snapshotPath, 'utf8')),
      results: JSON.parse(fs.readFileSync(resultsPath, 'utf8')),
    });
  fs.writeFileSync(outputPath, JSON.stringify(result.sheets, null, 2));
  fs.writeFileSync(outputPath.replace(/materialized-pages\.json$/, 'proposal.json'), JSON.stringify(result.proposal, null, 2));
  process.stdout.write(JSON.stringify(result.summary) + '\n');
} finally {
  await browser.close();
}
