#!/usr/bin/env python3
"""Validate saved XLSX rows/cells against the evidence without Excel or services."""
import argparse
import json
import pathlib
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--evidence', type=pathlib.Path, required=True)
    args = parser.parse_args()
    results = []
    for manifest in sorted((args.output/'previews').glob('*.json')):
        file = args.output/(manifest.stem+'.xlsx')
        expected = json.loads(manifest.read_text())
        with zipfile.ZipFile(file) as archive:
            assert archive.testzip() is None, file.name
            shared = []
            if 'xl/sharedStrings.xml' in archive.namelist():
                root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
                shared = [''.join(node.itertext()) for node in root]
            sheets = ET.fromstring(archive.read('xl/workbook.xml')).find('s:sheets', NS)
            assert len(sheets) == len(expected), file.name
            for index, meta in enumerate(expected):
                data = json.loads((args.evidence/(meta['dataset']+'.json')).read_text())
                keys = list(dict.fromkeys(key for row in data for key in row))
                row_count = 0
                with archive.open(f'xl/worksheets/sheet{index+1}.xml') as xml:
                    for _, row in ET.iterparse(xml, events=('end',)):
                        if row.tag != '{'+NS['s']+'}row':
                            continue
                        row_count += 1
                        values = []
                        for cell in row:
                            if cell.tag != '{'+NS['s']+'}c':
                                continue
                            assert cell.find('s:f', NS) is None, 'Unexpected executable formula'
                            value = cell.find('s:v', NS)
                            if cell.get('t') == 's':
                                value = shared[int(value.text)]
                            elif cell.get('t') == 'inlineStr':
                                value = ''.join(cell.find('s:is', NS).itertext())
                            elif value is None:
                                value = None
                            elif cell.get('t') == 'b':
                                value = value.text == '1'
                            elif cell.get('t') == 'str':
                                value = value.text or ''
                            else:
                                value = float(value.text) if value.text else None
                            values.append(value)
                        if data and row_count in [1,2,len(data)+1]:
                            wanted = keys if row_count == 1 else [data[row_count-2].get(key) for key in keys]
                            wanted = ['\n'.join(str(v) for v in value) if isinstance(value,list) else json.dumps(value,ensure_ascii=False,separators=(',',':')) if isinstance(value,dict) else value for value in wanted]
                            # XLSX exports an empty string as a blank cell; original
                            # JSON preserves the distinction from source SQL NULL.
                            wanted = [None if value == '' else value for value in wanted]
                            assert values == wanted, (file.name,meta['sheet'],row_count,'first/last/header cell mismatch')
                        row.clear()
                assert row_count == (len(data)+1 if data else 2), (file.name, meta['sheet'], row_count)
                results.append(dict(workbook=file.name, sheet=meta['sheet'], dataset=meta['dataset'], rows=len(data), saved_row_count=row_count, header_first_last_cells='PASS'))
    assert len({row['workbook'] for row in results}) == 13
    (args.output/'saved-workbook-verification.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(workbooks=13,sheets=len(results),saved_data_rows=sum(row['rows'] for row in results),status='PASS')))


if __name__ == '__main__':
    main()
