#!/usr/bin/env python3
"""Exchange the website's one-time code and update only Codex's lili server. No secret stdout."""
import getpass, json, os, pathlib, re, sys, tempfile, tomllib, urllib.parse, urllib.request

def connect(endpoint, pairing_id, code, device_name="Codex"):
    parsed=urllib.parse.urlparse(endpoint)
    if parsed.username or parsed.password or parsed.query or parsed.fragment: raise ValueError("Endpoint must not contain credentials or query parameters")
    if parsed.path!="/api/lili/mcp" or (parsed.scheme!="https" and not (parsed.scheme=="http" and parsed.hostname in ("localhost","127.0.0.1","::1"))):
        raise ValueError("Use HTTPS or loopback /api/lili/mcp")
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args): raise ValueError("Redirect refused")
    payload=json.dumps(dict(pairingId=pairing_id,code=code,deviceName=device_name)).encode()
    request=urllib.request.Request(urllib.parse.urlunparse(parsed._replace(path="/api/lili/pair",query="",fragment="")),data=payload,headers={"Content-Type":"application/json"})
    with urllib.request.build_opener(NoRedirect).open(request,timeout=30) as response: paired=json.load(response)
    token=paired["access_token"]
    if not re.fullmatch(r"amcp_[A-Za-z0-9_-]{43}",token): raise ValueError("Invalid credential response")
    folder=pathlib.Path(os.environ.get("CODEX_HOME",pathlib.Path.home()/".codex"));folder.mkdir(exist_ok=True)
    config=folder/"config.toml"
    if config.is_symlink(): raise ValueError("Config symlink refused")
    original=config.read_text() if config.exists() else ""
    tomllib.loads(original)
    # Remove exactly lili and its nested tables, preserving every other server and all unrelated settings.
    lines=original.splitlines(keepends=True); output=[]; skip=False
    for line in lines:
        header=re.match(r'^\s*\[([^\]]+)\]\s*(?:#.*)?$',line)
        if header:
            name=header.group(1).strip()
            skip=name=="mcp_servers.lili" or name.startswith("mcp_servers.lili.")
        if not skip: output.append(line)
    section='\n[mcp_servers.lili]\nurl = '+json.dumps(endpoint)+'\nhttp_headers = { Authorization = '+json.dumps("Bearer "+token)+' }\n'
    updated="".join(output)+section
    parsed_config=tomllib.loads(updated)
    if parsed_config["mcp_servers"]["lili"]["url"]!=endpoint: raise ValueError("Config verification failed")
    fd,temporary=tempfile.mkstemp(prefix=".lili-config-",dir=folder)
    try:
        with os.fdopen(fd,"w") as f: f.write(updated);f.flush();os.fsync(f.fileno())
        os.chmod(temporary,0o600);os.replace(temporary,config)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    return {"deviceId":paired["device"]["id"],"expiresAt":paired["expires_at"],"endpoint":endpoint,"authentication":"bearer-transition","config":str(config)}
if __name__=="__main__":
    try:
        endpoint=sys.argv[1] if len(sys.argv)>1 else "http://localhost:3017/api/lili/mcp"
        pairing_id=input("网站配对 ID: ").strip()
        code=getpass.getpass("一次性验证密钥（不回显）: ").strip()
        print(json.dumps(connect(endpoint,pairing_id,code),ensure_ascii=False,indent=2))
    except Exception as e:
        print("连接失败（未输出密钥）: "+type(e).__name__,file=sys.stderr);sys.exit(1)
