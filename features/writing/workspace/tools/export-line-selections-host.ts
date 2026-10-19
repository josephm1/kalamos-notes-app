import fs from 'node:fs';
import { buildLineSelections, buildRegionSelections } from './ink-selection-experiment';
const [input, output, mode = 'lines'] = process.argv.slice(2);
if (!input || !output) throw Error('Supply a native snapshot and selection output path.');
if (!['lines', 'regions'].includes(mode)) throw Error('Selection mode must be lines or regions.');
const selections = (mode === 'regions' ? buildRegionSelections : buildLineSelections)(JSON.parse(fs.readFileSync(input, 'utf8')));
fs.writeFileSync(output, JSON.stringify(selections, null, 2));
console.log(JSON.stringify({ lines: selections.selections.length,
  regions: selections.selections.reduce((count, line) => count + line.sourceInkRegionIds.length, 0) }));
