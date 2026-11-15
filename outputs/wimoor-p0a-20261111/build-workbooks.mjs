// Run with the bundled document runtime in a task directory containing its
// node_modules symlink. Reads source evidence JSON only; never imports ERP code.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
if (!options.input || !options.output) throw new Error('--input and --output are required');
const read = async key => JSON.parse(await fs.readFile(path.join(options.input, `${key}.json`), 'utf8'));
const definitions = [
  ['wimoor-table-inventory', [['Tables','table_review'], ['Table references','table_references'], ['Duplicates','duplicates'], ['Conflicts','conflicts']]],
  ['wimoor-column-inventory', [['Columns','columns'], ['Entity fields','entity_fields']]],
  ['wimoor-index-constraint-inventory', [['Constraints','constraints']]],
  ['wimoor-service-method-inventory', [['Services','services'], ['Methods','methods'], ['Duplicate files','service_duplicates']]],
  ['wimoor-business-rules', [['Rules','rules']]],
  ['wimoor-service-call-graph', [['Calls','calls'], ['Mapper SQL','mapper_statements']]],
  ['wimoor-scheduler-inventory', [['Schedulers','schedulers']]],
  ['wimoor-api-inventory', [['Source methods','apis'], ['ERP methods','erp_operations']]],
  ['wimoor-module-dependency', [['Module counts','module_counts'], ['Module membership','module_membership'], ['Imports','dependencies'], ['Entities','entities'], ['Pages','pages']]],
  ['erp-existing-capability-matrix', [['Capabilities','capabilities'], ['ERP fingerprints','erp_evidence']]],
  ['sp-api-modernization-matrix', [['Operations','sp_modernization']]],
  ['ads-api-modernization-matrix', [['Operations','ads_modernization']]],
  ['prisma-model-mapping', [['WMS fields','model_mapping']]],
];
await fs.mkdir(options.output, { recursive: true });
const previewDir = path.join(options.output, 'previews');
await fs.mkdir(previewDir, { recursive: true });
if (!options.only) {
  for (const [name] of definitions) {
    const child = spawnSync(process.execPath, [process.argv[1], '--input', options.input, '--output', options.output, '--only', name], { stdio: 'inherit', env: process.env });
    if (child.status !== 0) throw new Error(`Workbook failed: ${name}`);
  }
  process.exit(0);
}
const definition = definitions.find(([name]) => name === options.only);
if (!definition) throw new Error('Unknown workbook');
const workbook = Workbook.create();
const manifest = [];
const col = index => {
  let value = index + 1, label = '';
  while (value) { label = String.fromCharCode(65 + (value - 1) % 26) + label; value = Math.floor((value - 1) / 26); }
  return label;
};
for (const [sheetName, key] of definition[1]) {
  const rows = await read(key);
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const sheet = workbook.worksheets.add(sheetName);
  sheet.showGridLines = false;
  if (!rows.length) {
    sheet.getRange('A1:B2').values = [['Dataset','Result'],[key,'No records detected; not a semantic completeness claim']];
    sheet.getRange('A1:B2').format.columnWidth = 45;
    sheet.getRange('A1:B2').format.wrapText = true;
    sheet.getRange('A1:B2').format.rowHeight = 40;
    manifest.push({sheet:sheetName, dataset:key, rows:0});
  } else {
    const last = col(columns.length-1);
    sheet.getRange(`A1:${last}1`).values = [columns];
    for (let start = 0; start < rows.length; start += 1500) {
      const block = rows.slice(start, start+1500).map(row => columns.map(key => {
        const value = row[key];
        const text = Array.isArray(value) ? value.join('\n') : typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
        if (typeof text === 'string' && text.length > 32767) throw new Error(`Excel cell too long: ${key}`);
        return text ?? null;
      }));
      sheet.getRange(`A${start+2}:${last}${start+block.length+1}`).values = block;
    }
    const used = sheet.getRange(`A1:${last}${rows.length+1}`);
    used.format.font.name = 'Arial';
    used.format.font.size = 10;
    used.format.columnWidth = 30;
    used.format.rowHeight = 62;
    used.format.wrapText = true;
    used.format.verticalAlignment = 'top';
    columns.forEach((key, index) => {
      const range = sheet.getRange(`${col(index)}1:${col(index)}${rows.length+1}`);
      if (/^(?:line|end_line|bytes|methods|total_lines|effective_lines|candidate_tables|sequence)$/.test(key)) {
        range.format.columnWidth = 18;
        range.setNumberFormat('0');
      } else if (/path|source|evidence|erp_files|signature|rule|target|decision|dependency|gap|acceptance|semantics|resolution|mapping|definition/.test(key)) {
        range.format.columnWidth = 76;
      }
    });
    const header = sheet.getRange(`A1:${last}1`);
    header.format.fill = '#20364D';
    header.format.font.color = '#FFFFFF';
    header.format.font.bold = true;
    header.format.rowHeight = 32;
    header.format.horizontalAlignment = 'center';
    const table = sheet.tables.add(`A1:${last}${rows.length+1}`, true, key.replace(/_/g,'')+'Table');
    table.showFilterButton = true;
    sheet.freezePanes.freezeRows(1);
    sheet.freezePanes.freezeColumns(1);
    manifest.push({sheet:sheetName, dataset:key, rows:rows.length, columns:columns.length});
  }
  const previewRange = rows.length ? `A1:${col(Math.min(4,columns.length-1))}${Math.min(rows.length+1,4)}` : 'A1:B2';
  const preview = await workbook.render({sheetName, range:previewRange, scale:1.5, format:'png'});
  await fs.writeFile(path.join(previewDir, `${options.only}-${key}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const result = await SpreadsheetFile.exportXlsx(workbook);
await result.save(path.join(options.output, options.only+'.xlsx'));
await fs.writeFile(path.join(previewDir, options.only+'.json'), JSON.stringify(manifest,null,2));
console.log(JSON.stringify({workbook:options.only,sheets:manifest}));
