#!/usr/bin/env python3
"""Offline source inventory. Never executes SQL, Java, build tools or .env.

Lexical extraction is deliberately distinct from semantic/manual verification.
Only DDL, signatures, identifiers and source locations are exported; INSERT
payloads and configuration values are never copied.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re
import subprocess

VERSION = 'p0a-1'


def mask(text, comments_only=False):
    # Preserve offsets/newlines for line evidence; Java/SQL quoted strings and comments.
    pattern = r'/\*[\s\S]*?\*/|//[^\n]*|--[^\n]*'
    if not comments_only:
        pattern += r'|"(?:\\.|[^"\\])*"|\'(?:\\.|\'\'|[^\'\\])*\''
    return re.sub(pattern, lambda m: re.sub(r'[^\n]', ' ', m[0]), text)


def split_top(text):
    masked = mask(text)
    depth = 0
    start = 0
    result = []
    for i, char in enumerate(masked):
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
        elif char == ',' and depth == 0:
            result.append((start, text[start:i]))
            start = i + 1
    result.append((start, text[start:]))
    return result


def closing(text, start):
    depth = 0
    for i in range(start, len(text)):
        if text[i] in '({':
            depth += 1
        elif text[i] in ')}':
            depth -= 1
            if depth == 0:
                return i
    raise ValueError('unclosed block')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=pathlib.Path)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    args = parser.parse_args()
    root = args.source.resolve()
    out = args.output.resolve()
    if out == root or root in out.parents:
        parser.error('output must be outside source checkout')
    files = subprocess.check_output(['rg', '--files', '--hidden', '-g', '!.git', '-g', '!node_modules', '-g', '!target', '-g', '!dist'], cwd=root, text=True).splitlines()
    files.sort()
    # Audit ignored files without reading their contents (especially configs).
    allfiles = subprocess.check_output(['rg', '--files', '--hidden', '--no-ignore', '-g', '!.git', '-g', '!node_modules', '-g', '!target', '-g', '!dist'], cwd=root, text=True).splitlines()
    seen = set(files)
    ignored = [path for path in allfiles if path not in seen]
    ignored_candidates = [path for path in ignored if pathlib.Path(path).suffix.lower() in ['.java', '.sql', '.xml', '.vue', '.tsx', '.jsx', '.html']]
    result = {key: [] for key in ['files', 'tables', 'columns', 'constraints', 'services', 'methods', 'calls', 'schedulers', 'apis', 'dependencies', 'entities', 'entity_fields', 'mapper_statements', 'exceptions', 'pages']}
    def exception(path, line, reason):
        result['exceptions'].append(dict(path=path, line=line, reason=reason, status='UNCERTAIN'))
    for path in files:
        file = root / path
        raw = file.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        suffix = file.suffix.lower()
        category = ('sql' if suffix == '.sql' else 'java' if suffix == '.java' else 'mapper' if suffix == '.xml' and 'mapper' in path.lower() else 'page' if suffix in ['.vue', '.tsx', '.jsx', '.html'] else 'other')
        result['files'].append(dict(path=path, sha256=digest, bytes=len(raw), category=category))
        if category == 'other':
            continue
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            exception(path, 1, 'UTF-8 decode failed; hash retained; file not parsed')
            continue
        line = lambda pos: text.count('\n', 0, pos) + 1
        module = path.split('/')[0]
        if category == 'page':
            result['pages'].append(dict(path=path, module=module, status='UNCERTAIN', review='indexed; route and interaction semantics not verified'))
        elif category == 'sql':
            clean = mask(text, True)
            creates = list(re.finditer(r'CREATE\s+(TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:`?\w+`?\.)?`?\w+`?)\s*\(', clean, re.I))
            db_hint = file.parent.name if file.parent.name.startswith('db_') or file.parent.name == 'seata' else 'UNRESOLVED'
            for m in creates:
                try:
                    end = closing(mask(text), m.end() - 1)
                except ValueError as err:
                    exception(path, line(m.start()), str(err))
                    continue
                names = m[2].replace('`', '').split('.')
                db, table = names if len(names) == 2 else (db_hint, names[0])
                preceding = clean[:m.start()]
                use = list(re.finditer(r'\bUSE\s+`?(\w+)`?\s*;', preceding, re.I))
                if len(names) == 1 and use:
                    db = use[-1][1]
                eid = f'{path}:{line(m.start())}'
                body = text[m.end():end]
                definition = hashlib.sha256(mask(body, True).strip().encode()).hexdigest()
                result['tables'].append(dict(evidence=eid, database=db, table=table, module=module, temporary=bool(m[1]), definition_sha256=definition, status='INFERRED', erp_mapping='pending domain review'))
                if db == 'UNRESOLVED':
                    exception(path, line(m.start()), 'database identity unresolved')
                for offset, entry in split_top(body):
                    entry = entry.strip()
                    pos = m.end() + offset
                    col = re.match(r'`([^`]+)`\s+([\w]+)(\([^)]*\))?(.*)', entry, re.S)
                    if col:
                        attrs = col[4]
                        default = re.search(r'\bDEFAULT\s+(NULL|\'(?:\'\'|[^\'])*\'|[^\s,]+)', attrs, re.I)
                        comment = re.search(r"\bCOMMENT\s+'((?:''|[^'])*)'", attrs, re.I)
                        result['columns'].append(dict(evidence=eid, path=path, line=line(pos + len(body[offset:]) - len(body[offset:].lstrip())), database=db, table=table, column=col[1], type=col[2] + (col[3] or ''), nullable=not bool(re.search(r'NOT\s+NULL', attrs, re.I)), default=default[1] if default else None, comment=comment[1] if comment else None, attributes=attrs.strip()))
                    elif re.match(r'(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|CHECK|FULLTEXT|SPATIAL)\b', entry, re.I):
                        result['constraints'].append(dict(evidence=eid, database=db, table=table, path=path, line=line(pos), definition=entry, status='VERIFIED'))
                    elif entry:
                        exception(path, line(pos), 'unparsed DDL body fragment: ' + entry[:160])
            for m in re.finditer(r'\b(CREATE\s+(?:OR\s+REPLACE\s+)?VIEW|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+TABLE[^;\n]*\b(?:LIKE|AS)\b)', clean, re.I):
                exception(path, line(m.start()), 'DDL outside CREATE TABLE body: ' + m[0][:100])
            if not creates:
                exception(path, 1, 'SQL without parsed table definition; data/routine script not executed or imported')
        elif category == 'java':
            clean = mask(text)
            kind = ('generated-sdk' if 'amazon-sp-api/' in path or re.search(r'@(?:javax\.annotation\.)?Generated', text) else 'test' if '/test/' in path else 'interface' if re.search(r'\binterface\s+', clean) else 'implementation')
            is_service = '/service/' in path or 'Service' in file.stem
            total = len(text.splitlines())
            effective = sum(bool(x.strip()) for x in mask(text, True).splitlines())
            matches = list(re.finditer(r'(?m)^\s*((?:(?:public|protected|private|static|final|abstract|default|synchronized|native)\s+)*(?:[\w<>\[\],.?]+\s+)+)(\w+)\s*\(([^;{}]*?)\)\s*(?:throws\s+[\w.,\s]+)?([;{])', clean))
            method_count = 0
            for m in matches:
                if m[2] in ['if', 'for', 'while', 'switch', 'catch', 'return', 'new']:
                    continue
                method_count += 1
                start = m.start() + len(m[0]) - len(m[0].lstrip())
                try:
                    end = closing(clean, m.end()-1) if m[4] == '{' else m.end()
                except ValueError:
                    exception(path, line(start), 'method block unresolved')
                    continue
                prefix = text[max(0, m.start()-600):m.start()]
                prefix = prefix[prefix.rfind('}')+1:]
                method = dict(path=path, line=line(start), end_line=line(end), class_name=file.stem, method=m[2], signature=' '.join(text[start:m.end()].split()), kind=kind, transactional=bool(re.search(r'@Transactional', prefix)), status='UNCERTAIN', semantics='lexical signature; effective proxy transaction and callers require review')
                if is_service:
                    result['methods'].append(method)
                if m[4] == '{' and (is_service or 'controller' in path.lower() or 'job' in path.lower()):
                    body = clean[m.end():end]
                    for call in re.finditer(r'\b(\w+)\s*\.\s*(\w+)\s*\(', body):
                        result['calls'].append(dict(path=path, line=line(m.end()+call.start()), caller=file.stem+'.'+m[2], receiver=call[1], method=call[2], status='UNCERTAIN', resolution='receiver token only; DI/proxy/overload/dynamic dispatch unresolved'))
                if re.search(r'@(?:Get|Post|Put|Delete|Patch|Request)Mapping', prefix) or ('Api' in file.stem and kind == 'generated-sdk'):
                    result['apis'].append(dict(path=path, line=line(start), operation=m[2], kind=kind, annotations=' '.join(re.findall(r'@(?:Get|Post|Put|Delete|Patch|Request)Mapping[^\n]*', prefix)), status='UNCERTAIN', official_contract='not verified; SDK is not official current schema'))
            if is_service:
                result['services'].append(dict(path=path, kind=kind, total_lines=total, effective_lines=effective, methods=method_count, content_sha256=digest, status='UNCERTAIN'))
                if method_count == 0:
                    exception(path, 1, 'Service candidate without parsed signatures')
            for m in re.finditer(r'@TableName\s*\(\s*(?:value\s*=\s*)?["\']([^"\']+)["\']', text):
                result['entities'].append(dict(path=path, line=line(m.start()), table=m[1], class_name=file.stem, status='INFERRED', note='annotation only; schema identity and field mapping require domain review'))
            if '/pojo/entity/' in path or '/domain/' in path:
                if '@TableName' not in text:
                    result['entities'].append(dict(path=path, line=1, table=None, class_name=file.stem, status='UNCERTAIN', note='entity/domain candidate without table annotation; resolve from Mapper/resultMap; DTOs may not own a table'))
                for m in re.finditer(r'(?m)^\s*(?:private|protected|public)\s+(?!static\b)([\w<>\[\],.?]+)\s+(\w+)\s*(?:=[^;]*)?;', clean):
                    result['entity_fields'].append(dict(path=path, line=line(m.start()), class_name=file.stem, field=m[2], type=m[1], status='UNCERTAIN', mapping='lexical field; annotation, inherited field and Mapper reconciliation pending'))
            for m in re.finditer(r'@(?:Scheduled|XxlJob)\b[^\n]*|\bimplements\s+(?:Job|IJobHandler)\b|\bextends\s+QuartzJobBean\b', text):
                result['schedulers'].append(dict(path=path, line=line(m.start()), entry=m[0], status='UNCERTAIN', recovery='lock/retry/checkpoint not verified; do not start task'))
            if re.search(r'QuartzTaskMapper|CronScheduleBuilder|refreshTask\(|@RequestMapping\([^\n]*[Tt]ask', text):
                result['schedulers'].append(dict(path=path, line=1, entry='dynamic scheduler/task candidate', status='UNCERTAIN', recovery='database-defined cron/path not enumerated; INSERT/config values excluded; source-only inventory'))
            for m in re.finditer(r'(?m)^import\s+(com\.wimoor\.[\w.]+);', clean):
                result['dependencies'].append(dict(path=path, line=line(m.start()), module=module, dependency=m[1], status='INFERRED', relation='source import; not runtime dependency proof'))
        elif category == 'mapper':
            for m in re.finditer(r'<(select|insert|update|delete|sql)\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)</\1>', text):
                tables = sorted(set(re.findall(r'\b(?:from|join|update|into)\s+`?((?:t_|fin_|gen_|QRTZ_)\w+)', m[3], re.I)))
                result['mapper_statements'].append(dict(path=path, line=line(m.start()), statement=m[2], action=m[1], tables=','.join(tables), row_lock=bool(re.search(r'for\s+update', m[3], re.I)), dynamic=bool(re.search(r'<(?:if|foreach|choose|include)\b|\$\{', m[3])), status='INFERRED'))
            if not re.search(r'<mapper\b', text):
                exception(path, 1, 'mapper-path XML without mapper root')
    groups = collections.defaultdict(list)
    for table in result['tables']:
        groups[(table['database'], table['table'])].append(table)
    conflicts = [dict(database=k[0], table=k[1], definitions=len(v), sources=[t['evidence'] for t in v]) for k, v in groups.items() if len(set(t['definition_sha256'] for t in v)) > 1]
    result['conflicts'] = conflicts
    result['ignored-scan'] = dict(ignored_files_outside_excluded_build_dirs=len(ignored), ignored_source_candidates=ignored_candidates)
    result['duplicates'] = [dict(database=k[0], table=k[1], sources=[t['evidence'] for t in v]) for k, v in groups.items() if len(v) > 1]
    hashes = collections.defaultdict(list)
    for service in result['services']:
        hashes[service['content_sha256']].append(service['path'])
    result['service_duplicates'] = [dict(sha256=k, paths=v) for k, v in hashes.items() if len(v) > 1]
    counts = collections.Counter(f['category'] for f in result['files'])
    service_counts = {}
    for kind in sorted(set(s['kind'] for s in result['services'])):
        subset = [s for s in result['services'] if s['kind'] == kind]
        service_counts[kind] = dict(files=len(subset), total_lines=sum(s['total_lines'] for s in subset), effective_lines=sum(s['effective_lines'] for s in subset), methods=sum(s['methods'] for s in subset))
    result['summary'] = dict(extractor_version=VERSION, source=str(root), head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(), source_changes=subprocess.check_output(['git', 'status', '--short'], cwd=root, text=True).splitlines(), files=len(files), categories=dict(counts), table_definitions=len(result['tables']), unique_table_identities=len(groups), database_counts=dict(collections.Counter(k[0] for k in groups)), conflicting_identities=len(conflicts), service_counts=service_counts, exceptions=len(result['exceptions']), limitations=['lexical scan, not Java/MyBatis AST', 'generated overloads counted separately', 'Java package-private/multiline annotations, anonymous classes and dynamic calls may be missed', 'DDL ALTER/view/LIKE/AS logged, not merged', 'module ownership and shared tables unresolved until call-chain review', 'page files indexed, route interaction semantics not verified', 'no external API/version/retirement claims from SDK', 'rg hidden nonignored files; ignored build/vendor directories excluded'], gate='P0-A scan only; manual slice and shared-boundary approval required')
    out.mkdir(parents=True, exist_ok=True)
    for key, value in result.items():
        (out / (key+'.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(result['summary'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
