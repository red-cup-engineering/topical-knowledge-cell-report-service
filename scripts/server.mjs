#!/usr/bin/env node
import { resolve } from "node:path";
import { serveContractedAgent } from "@red-cup-engineering/a2a-contracted-agent-service";
import { loadReportRuntime } from "../src/runtime.mjs";

const port = Number(process.env.PORT ?? 19837);
const host = process.env.HOST ?? "127.0.0.1";
const baseUrl = process.env.BASE_URL ?? `http://${host}:${port}`;
const root = resolve(import.meta.dirname, "..");

loadReportRuntime().then(runtime => serveContractedAgent({
  ...runtime.agentOptions,
  port,
  host,
  baseUrl,
  agentCard: resolve(root, "content/agent-cards/topical-knowledge-cell-report-service.json"),
  executor: process.execPath,
  executorArgs: [resolve(root, "scripts/execute-a2a-task.mjs")],
})).then(() => {
  process.stdout.write(`${baseUrl}\n`);
}).catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});

