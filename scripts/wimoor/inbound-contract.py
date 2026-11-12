"""Generate local source-SDK contract evidence. Reads files only; never downloads schemas."""
from pathlib import Path
import re,json,hashlib
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path('/Users/chenjieliang/Documents/wimoor/wimoor-amazon/amazon-sp-api/src/main/java/com/amazon/spapi')
api=SOURCE/'api/FbaInboundV20240320Api.java'
text=api.read_text(); operations={}; roots=[]
for m in re.finditer(r'public Call (\w+)Call\((.*?)\) throws.*?\{(.*?)(?=\n    @SuppressWarnings)',text,re.S):
 name,parameters,body=m.groups();path=re.search(r'String localVarPath = "([^"]+)"',body)[1];method=re.search(r'buildCall\(localVarPath, "([A-Z]+)"',body)[1]
 types=dict((name,kind) for kind,name in re.findall(r'(List<\w+>|\w+) (\w+)(?:,|$)',parameters.split(', final')[0]))
 body_type=types.get('body'); roots.extend([body_type] if body_type else [])
 queries={}
 for q in re.finditer(r'parameterToPair\("([^"]+)", (\w+)\)',body): queries[q[1]]={'type':types[q[2]]}
 for q in re.finditer(r'parameterToPairs\("([^"]+)", "([^"]+)", (\w+)\)',body): queries[q[2]]={'type':types[q[3]],'collection':q[1]}
 # Required query parameters are recorded in ValidateBeforeCall, not inferred from names.
 validation=re.search(r'private Call '+name+r'ValidateBeforeCall\(.*?\{(.*?)(?=\n    /\*\*)',text,re.S)
 required=re.findall(r'if \((\w+) == null\)',validation[1]) if validation else []
 for key in queries: queries[key]['required']=key in required
 response_match=re.search(r'public ApiResponse<(\w+)> '+name+r'WithHttpInfo\(',text)
 assert response_match,name
 response_type=response_match[1]
 response_path=SOURCE/'model/fulfillmentinboundV20240320'/f'{response_type}.java'
 response_text=response_path.read_text() if response_type!='Void' else ''
 if response_type!='Void':roots.append(response_type)
 # Async classification comes from the response DTO field, never the HTTP method.
 asynchronous=method!='GET' and bool(re.search(r'@SerializedName\("operationId"\)',response_text))
 operations[name]={'responseType':response_type,'responseSourceSha256':hashlib.sha256(response_path.read_bytes()).hexdigest() if response_type!='Void' else None,'asynchronous':asynchronous,'method':method,'path':path,'pathParameters':re.findall(r'\{(\w+)\}',path),'query':queries,'bodyType':body_type,'bodyRequired':'body' in required}
models={};pending=list(roots)
primitive={'String','Integer','BigDecimal','OffsetDateTime','Boolean'}
while pending:
 name=pending.pop()
 if name in models or name in primitive:continue
 p=SOURCE/'model/fulfillmentinboundV20240320'/f'{name}.java';s=p.read_text()
 if re.search(r'public enum '+name+r'\b',s):
  models[name]={'enum':re.findall(r'\b[A-Z][A-Z0-9_]*\("([^"]+)"\)',s)}
  assert models[name]['enum'],name
 else:
  fields={}
  for f in re.finditer(r'@SerializedName\("([^"]+)"\)\s+private ([\w<>, ?]+) (\w+)\s*=',s):
   serialized,kind,prop=f.groups();getter='get'+prop[0].upper()+prop[1:]
   getter_index=s.index(' '+getter+'(')
   declaration=s[:getter_index].rsplit('@ApiModelProperty(',1)[1].split(')\n',1)[0]
   fields[serialized]={'type':kind,'required':bool(re.match(r'\s*required\s*=\s*true',declaration))}
   nested=re.sub(r'^List<(.*)>$',r'\1',kind)
   if nested not in primitive:pending.append(nested)
  assert fields,name
  models[name]={'fields':fields}
 models[name]['sourceSha256']=hashlib.sha256(p.read_bytes()).hexdigest()
out={'provenance':{'apiVersion':'2024-03-20','source':'Wimoor bundled Java SDK','sourceGeneratedAt':'2024-11-13','apiSha256':hashlib.sha256(api.read_bytes()).hexdigest(),'currentOfficialParityVerified':False,'networkAccess':False},'operations':operations,'models':models}
(ROOT/'src/lib/fba-local/inbound-source-contract.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'operations':len(operations),'reachableRequestAndResponseModels':len(models)}))
