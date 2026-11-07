#!/usr/bin/env python3
"""Use the installed Codex native MCP client, without a model turn or an HTTP substitute."""
import argparse, json, pathlib, queue, subprocess, threading, time

class NativeCodex:
    def __init__(self, overrides=()):
        self.process = subprocess.Popen(["codex", *overrides, "app-server", "--stdio"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.messages = queue.Queue()
        self.request_id = 0
        def read():
            for line in self.process.stdout:
                try: self.messages.put(json.loads(line))
                except ValueError: pass
        threading.Thread(target=read, daemon=True).start()
        self.call("initialize", {"clientInfo": {"name": "lili-native-acceptance", "version": "1.0.0"}, "capabilities": {"experimentalApi": True}})
    def call(self, method, params):
        self.request_id += 1
        request_id = self.request_id
        self.process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}) + "\n")
        self.process.stdin.flush()
        deadline = time.monotonic() + 55
        while time.monotonic() < deadline:
            try: response = self.messages.get(timeout=max(0.1, deadline - time.monotonic()))
            except queue.Empty: raise TimeoutError("Codex MCP client timed out") from None
            if response.get("id") != request_id: continue
            if "error" in response: raise RuntimeError("Native MCP request failed: " + method + " (code " + str(response["error"].get("code")) + ")")
            return response["result"]
        raise TimeoutError("Codex MCP client timed out")
    def close(self):
        self.process.terminate()
        try: self.process.wait(timeout=10)
        except subprocess.TimeoutExpired: self.process.kill(); self.process.wait()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="lili")
    parser.add_argument("--seller", help="ERP sellerAccountId; must already be authorized")
    parser.add_argument("--marketplace", default="ATVPDKIKX0DER")
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    summary = {"client": "Codex app-server native MCP", "calls": [], "skills": []}
    client = NativeCodex()
    try:
        thread_id = client.call("thread/start", {"ephemeral": True, "cwd": str(pathlib.Path.cwd())})["thread"]["id"]
        summary["threadId"] = thread_id
        status = client.call("mcpServerStatus/list", {"threadId": thread_id, "serverName": args.server})["data"][0]
        summary.update(runtimeStatus=status["runtimeStatus"], tools=sorted(status["tools"]), serverInfo=status["serverInfo"])
        def call(name, arguments):
            response = client.call("mcpServer/tool/call", {"threadId": thread_id, "server": args.server, "tool": name, "arguments": arguments})
            if response.get("isError"): raise RuntimeError("Tool failed: " + name)
            result = json.loads(response["content"][0]["text"])
            summary["calls"].append({"tool": name, "requestId": result.get("meta", {}).get("requestId") if isinstance(result, dict) else None, "isError": False})
            return result
        summary["ping"] = call("lili_ping", {})
        for skill_id in ["amazon-niche-finder", "amazon-product-research", "amazon-review-analyzer", "tariff-calculator-amazon", "amazon-product-selection"]:
            found = call("meta_search_skills", {"query": skill_id})
            if not any(skill["slug"] == skill_id for skill in found["skills"]): raise RuntimeError("Skill missing")
            manifest = call("meta_get_skill_manifest", {"skill_id": skill_id})["manifest"]
            summary["skills"].append({"skill_id": skill_id, "version": manifest["version"], "sha256": manifest["sha256"]})
        if args.seller:
            stores = call("amazon.stores.list", {})
            if not any(row["sellerAccountId"] == args.seller and row["marketplaceId"] == args.marketplace for row in stores): raise RuntimeError("Requested seller is not in authorized native discovery")
            query = {"table": "inventory", "sellerAccountId": args.seller, "marketplaceId": args.marketplace}
            call("data_describe_table", query)
            inventory = call("data_query", {**query, "page": 1, "pageSize": 3})
            summary["inventory"] = {"returnedRows": len(inventory["data"]["items"]), "total": inventory["data"]["total"], "meta": inventory["meta"]}
        summary["marketAccess"] = call("meta_get_market_access", {})
        args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        print(json.dumps({"output": str(args.output.resolve()), "runtimeStatus": summary["runtimeStatus"], "authenticated": summary["ping"]["authenticated"], "toolCount": len(summary["tools"])}, ensure_ascii=False))
    finally: client.close()

if __name__ == "__main__": main()
