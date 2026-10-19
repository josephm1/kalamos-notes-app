import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [bundle, source, output, widthArg = '500', heightArg = '623'] = process.argv.slice(2);
const width = Number(widthArg), height = Number(heightArg);
if (!output || !Number.isFinite(width) || !Number.isFinite(height) || width < 120 || height < 120) {
  throw Error('Supply editor preview bundle, saved source/sidecar JSON, output prefix and optional page width/height.');
}
const browser = await chromium.launch({ headless: true,
  ...(process.env.NOTES_HOST_CHROMIUM ? { executablePath: process.env.NOTES_HOST_CHROMIUM } : {}) });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.setContent('<html><body style="margin:0"></body></html>');
  await page.addScriptTag({ content: fs.readFileSync(bundle, 'utf8') });
  const svg = await page.evaluate(({ sheet, height }) => {
    const workspace = HostElements.openHostPage({ ...sheet, pageId: 'first' });
    try { return workspace.exportSvgPages({ pageHeight: height, singlePage: true })[0]; }
    finally { workspace.destroy(); }
  }, { sheet: JSON.parse(fs.readFileSync(source, 'utf8')), height });
  fs.writeFileSync(output + '.svg', svg);
  await page.setContent(svg);
  await page.locator('svg').screenshot({ path: output + '.jpg', type: 'jpeg', quality: 90 });
  process.stdout.write(JSON.stringify({ width, height, pixelWidth: width * 2, pixelHeight: height * 2 }) + '\n');
} finally { await browser.close(); }
