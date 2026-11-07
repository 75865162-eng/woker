#!/usr/bin/env python3
"""Load verified website Skills through Codex native MCP; OAuth remains owned by Codex."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import tomllib
import urllib.parse
import uuid

spec = importlib.util.spec_from_file_location("lili_native", pathlib.Path(__file__).with_name("native-smoke.py"))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def atomic_receipt(path, receipt):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise RuntimeError("Receipt symlink refused")
    fd, temporary = tempfile.mkstemp(prefix=".lili-receipt-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(receipt, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_ids", nargs="+", help="One or more website skill_id values")
    parser.add_argument("--server", default="lili")
    parser.add_argument("--skills-root", type=pathlib.Path)
    parser.add_argument("--receipt", type=pathlib.Path)
    parser.add_argument("--print-skill", action="store_true", help="Print the verified original SOP after loading")
    args = parser.parse_args()
    home = pathlib.Path(os.environ.get("CODEX_HOME", pathlib.Path.home() / ".codex"))
    config = tomllib.loads((home / "config.toml").read_text())
    endpoint = config["mcp_servers"][args.server]["url"]
    source = urllib.parse.urlsplit(endpoint)
    if source.username or source.password or source.query or source.fragment or source.path != "/api/lili/mcp" or not (source.scheme == "https" or source.scheme == "http" and source.hostname in ("localhost", "127.0.0.1", "::1")):
        raise RuntimeError("Invalid configured Lili source")
    root = args.skills_root or home / "skills"
    receipt = {"client": "Codex app-server native MCP", "server": args.server, "endpoint": endpoint, "loadedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "calls": [], "skills": []}
    client = native.NativeCodex()
    try:
        thread = client.call("thread/start", {"ephemeral": True, "cwd": str(pathlib.Path.cwd())})["thread"]["id"]
        def rpc(name, arguments):
            result = client.call("mcpServer/tool/call", {"threadId": thread, "server": args.server, "tool": name, "arguments": arguments})
            if result.get("isError"):
                raise RuntimeError("Native tool failed")
            receipt["calls"].append({"tool": name, "skill_id": arguments.get("skill_id") or arguments.get("skill_name")})
            return json.loads(result["content"][0]["text"])
        ping = rpc("lili_ping", {})
        receipt["authenticated"] = ping.get("authenticated", False)
        status = client.call("mcpServerStatus/list", {"threadId": thread, "serverName": args.server})["data"][0]
        available = set(status["tools"])
        for skill_id in dict.fromkeys(args.skill_ids):
            matches = rpc("meta_search_skills", {"query": skill_id})
            if not any(s.get("slug") == skill_id for s in matches["skills"]):
                raise RuntimeError("Skill not discovered")
            worker = subprocess.Popen(["node", str(pathlib.Path(__file__).with_name("skill-cache-worker.mjs"))], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
            try:
                worker.stdin.write(json.dumps({"root": str(root), "endpoint": endpoint, "skillId": skill_id}) + "\n")
                worker.stdin.flush()
                loaded = None
                for line in worker.stdout:
                    message = json.loads(line)
                    if message["type"] == "rpc":
                        value = rpc(message["name"], message["arguments"])
                        worker.stdin.write(json.dumps({"result": value}) + "\n")
                        worker.stdin.flush()
                    elif message["type"] == "result":
                        loaded = message
                        break
                    else:
                        raise RuntimeError("Skill cache validation failed")
                if not loaded or not loaded.get("loaded"):
                    raise RuntimeError("Skill not loaded")
                markdown = loaded.pop("markdown")
                if hashlib.sha256(markdown.encode()).hexdigest() != loaded["manifest"]["sha256"]:
                    raise RuntimeError("Skill digest mismatch")
                required = loaded["manifest"].get("required_tools", [])
                receipt["skills"].append({"skill_id": skill_id, "path": loaded["path"], "status": loaded["status"], "loaded": True, "version": loaded["manifest"]["version"], "sha256": loaded["manifest"]["sha256"], "unavailable_original_tool_references": [name for name in required if name not in available]})
                if args.print_skill:
                    print(markdown)
            finally:
                worker.stdin.close()
                try:
                    worker.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    worker.kill()
                    worker.wait()
        receipt_path = args.receipt or home / "lili" / "skill-receipts" / (str(uuid.uuid4()) + ".json")
        receipt["receiptPath"] = str(receipt_path.resolve())
        atomic_receipt(receipt_path, receipt)
        if not args.print_skill:
            print(json.dumps(receipt, ensure_ascii=False, indent=2))
    finally:
        client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit("Lili native Skill sync failed: " + type(error).__name__) from None
