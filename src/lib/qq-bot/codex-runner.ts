import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { type QqBotConfig } from "@/lib/qq-bot/config";

export interface CodexTaskResult {
  id: string;
  ok: boolean;
  output: string;
}

export interface CodexTaskState {
  id: string;
  prompt: string;
  status: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  output?: string;
}

const tasks = new Map<string, CodexTaskState>();

function buildPrompt(userPrompt: string) {
  return [
    "你正在通过 QQ Bot 为用户执行 Codex 代码任务。",
    "请在当前仓库内完成用户请求，遵守 AGENTS.md，保持改动最小。",
    "如果需要修改代码，直接实现并验证；如果无法完成，说明阻塞原因。",
    "",
    "用户请求：",
    userPrompt,
  ].join("\n");
}

function buildArgs(config: QqBotConfig, outputFile: string) {
  const args = [
    "exec",
    "--cd",
    config.codexWorkdir,
    "--sandbox",
    config.codexSandbox,
    "--ask-for-approval",
    "never",
    "--output-last-message",
    outputFile,
  ];

  if (config.codexModel) {
    args.push("--model", config.codexModel);
  }

  args.push("-");
  return args;
}

export function getCodexTask(id: string) {
  return tasks.get(id);
}

export async function runCodexTask(config: QqBotConfig, userPrompt: string): Promise<CodexTaskResult> {
  const id = randomUUID().slice(0, 8);
  const outputFile = `/tmp/qq-codex-${id}.txt`;
  const task: CodexTaskState = {
    id,
    prompt: userPrompt,
    status: "running",
    startedAt: Date.now(),
  };
  tasks.set(id, task);

  return await new Promise<CodexTaskResult>((resolve) => {
    const child = spawn(config.codexBin, buildArgs(config, outputFile), {
      cwd: config.codexWorkdir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      task.status = "failed";
      task.finishedAt = Date.now();
      task.output = error.message;
      resolve({ id, ok: false, output: error.message });
    });
    child.on("close", (code) => {
      void readFile(outputFile, "utf8")
        .catch(() => chunks.join("").trim())
        .then((finalMessage) => {
          const output = finalMessage.trim() || chunks.join("").trim();
          task.status = code === 0 ? "done" : "failed";
          task.finishedAt = Date.now();
          task.output = output;
          resolve({
            id,
            ok: code === 0,
            output: output || (code === 0 ? "Codex 已完成，但没有返回文本。" : `Codex 退出码：${code}`),
          });
        });
    });
    child.stdin.end(buildPrompt(userPrompt));
  });
}
