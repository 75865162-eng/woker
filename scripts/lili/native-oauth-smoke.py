#!/usr/bin/env python3
"""Exercise Codex native OAuth/PKCE and real tools. Never prints credentials or auth URLs."""
import argparse, importlib.util, json, pathlib, tomllib, urllib.parse, urllib.request, time, sys

spec = importlib.util.spec_from_file_location("native_smoke", pathlib.Path(__file__).with_name("native-smoke.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:3017/api/lili/mcp")
    parser.add_argument("--parent-server", default="erp")
    parser.add_argument("--parent-stdin", action="store_true", help="Read the explicitly authorized parent bearer from stdin without saving it")
    parser.add_argument("--server", default="lili_oauth_acceptance")
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    origin = urllib.parse.urlsplit(args.url)
    if origin.scheme != "http" or origin.hostname not in ("localhost", "127.0.0.1"):
        raise SystemExit("This acceptance helper is limited to the reviewed local environment")
    base = urllib.parse.urlunsplit((origin.scheme, origin.netloc, "", "", ""))
    if args.parent_stdin:
        parent = sys.stdin.read().strip()
    else:
        config = tomllib.loads((pathlib.Path.home() / ".codex/config.toml").read_text())
        parent = config["mcp_servers"][args.parent_server]["http_headers"]["Authorization"]
    if not __import__("re").fullmatch(r"Bearer amcp_[A-Za-z0-9_-]{43}", parent):
        raise SystemExit("Invalid parent authorization")
    # Resolve identity from the existing parent bearer, never a model-provided user ID.
        # Pair API requires the exact parent credential ID; obtain it through a scoped helper
    # using the same root runtime, returning only its non-secret ID.
    import subprocess
    query = """import {prisma} from './src/lib/db/prisma.ts';
import {authenticateAmazonMcp} from './src/lib/amazon-sync/mcp.ts';
let input='';for await(const c of process.stdin)input+=c;
try {const i=await authenticateAmazonMcp(input);console.log(JSON.stringify({id:i.id}));}finally{await prisma.$disconnect();}"""
    proc = subprocess.run(["node", "--import", "./scripts/runtime/database-bootstrap.mjs", "--import", "tsx", "--input-type=module", "-e", query], input=parent, text=True, capture_output=True, check=True)
    parent_id = json.loads(proc.stdout)["id"]
    def post(url, body, headers):
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        return urllib.request.urlopen(req, timeout=30)
    paired = json.load(post(base + "/api/lili/devices", json.dumps({"action":"pair", "credentialId":parent_id}).encode(), {"Authorization":parent,"Content-Type":"application/json"}))
    summary = {"client":"Codex app-server native OAuth/PKCE", "calls":[], "parentCredentialId":parent_id, "endpoint":args.url}
    client = module.NativeCodex(["-c", 'mcp_servers.' + args.server + '.url=' + json.dumps(args.url)])
    try:
        print("Native OAuth: login starting", flush=True)
        login = client.call("mcpServer/oauth/login", {"name":args.server, "clientRegistration":"dcr", "timeoutSecs":60})
        print("Native OAuth: login URL received", flush=True)
        auth_url = login["authorizationUrl"]
        if urllib.parse.urlsplit(auth_url).netloc != origin.netloc:
            raise RuntimeError("Unexpected authorization origin")
        auth = urllib.parse.parse_qs(urllib.parse.urlsplit(auth_url).query)
        summary["pkceMethod"] = auth.get("code_challenge_method", [None])[0]
        summary["resourceBound"] = auth.get("resource", [None])[0] == args.url
        form = urllib.parse.urlencode({"pairingId":paired["pairingId"], "pairingCode":paired["code"]}).encode()
        # Complete the actual native client's authorization callback with a real one-use code.
        with post(auth_url, form, {"Origin":base,"Content-Type":"application/x-www-form-urlencoded"}) as response:
            summary["callbackStatus"] = response.status
        print("Native OAuth: callback completed", flush=True)
        thread = client.call("thread/start", {"ephemeral":True,"cwd":str(pathlib.Path.cwd())})["thread"]["id"]
        def call(name, arguments):
            result=client.call("mcpServer/tool/call", {"threadId":thread,"server":args.server,"tool":name,"arguments":arguments})
            if result.get("isError"): raise RuntimeError("Native tool call failed: " + name)
            parsed=json.loads(result["content"][0]["text"])
            summary["calls"].append({"tool":name,"isError":False,"requestId":parsed.get("meta",{}).get("requestId") if isinstance(parsed,dict) else None})
            return parsed
        for _ in range(40):
            status=client.call("mcpServerStatus/list", {"threadId":thread,"serverName":args.server})["data"][0]
            if "data_query" in status["tools"] and status["runtimeStatus"] == "connected": break
            time.sleep(0.25)
        summary["authenticated"]=call("lili_ping", {})["authenticated"]
        if not summary["authenticated"]: raise RuntimeError("OAuth identity not ready")
        stores=call("amazon.stores.list", {})
        store=next((s for s in stores if s.get("sellerAccountId")=="bc6b9f51-fb75-408d-9ecd-4c5058bd39d7" and s.get("marketplaceId")=="ATVPDKIKX0DER"),None)
        if store:
            data=call("data_query", {"table":"inventory","sellerAccountId":store["sellerAccountId"],"marketplaceId":store["marketplaceId"],"page":1,"pageSize":3})
            summary["inventory"]={"returnedRows":len(data["data"]["items"]),"total":data["data"]["total"],"meta":data["meta"]}
        summary["skills"]=[]
        for skill in ["amazon-niche-finder","amazon-product-research","amazon-review-analyzer","tariff-calculator-amazon","amazon-product-selection"]:
            call("meta_search_skills", {"query":skill})
            manifest=call("meta_get_skill_manifest", {"skill_id":skill})["manifest"]
            import hashlib
            candidates=[pathlib.Path.home()/".codex/skills"/skill/"SKILL.md",pathlib.Path.home()/".codex/skills"/("lili-"+skill)/"SKILL.md"]
            local=next((p for p in candidates if p.exists() and hashlib.sha256(p.read_bytes()).hexdigest()==manifest["sha256"]),None)
            if not local: raise RuntimeError("Run local cache sync before this acceptance")
            local.read_text()  # Load the verified SOP, without executing downloaded code.
            summary["skills"].append({"skill_id":skill,"status":"local-hit","version":manifest["version"],"sha256":manifest["sha256"]})
        for _ in range(20):
            status=client.call("mcpServerStatus/list", {"threadId":thread,"serverName":args.server})["data"][0]
            if "data_query" in status["tools"]: break
            time.sleep(0.25)
        summary.update(runtimeStatus=status["runtimeStatus"],tools=sorted(status["tools"]))
        args.output.write_text(json.dumps(summary,ensure_ascii=False,indent=2))
        print(json.dumps({"output":str(args.output),"authenticated":summary["authenticated"],"runtimeStatus":summary["runtimeStatus"],"toolCount":len(summary["tools"])}))
    finally:
        client.close()

if __name__ == "__main__":
    try: main()
    except Exception as error:
        # HTTP exceptions may include authorization codes in URLs; never echo them.
        raise SystemExit("Native OAuth acceptance failed: " + type(error).__name__) from None
