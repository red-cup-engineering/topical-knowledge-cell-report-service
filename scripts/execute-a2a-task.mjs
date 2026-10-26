#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { executeRelationalOperationMessage } from "@red-cup-engineering/a2a-sovereign-operation-boundary-service";
import {
  executeTopicalKnowledgeCellReport,
  issueTopicalKnowledgeCellReportQuote,
  readTopicalKnowledgeCellReport,
} from "../lib/report.mjs";
import { reportServiceProtocol } from "../src/protocol.mjs";
import { loadReportRuntime } from "../src/runtime.mjs";
import { describeReportCommission } from "../lib/commission.mjs";

const operations = Object.freeze({
  "describe-report-commission": (_input, runtime) => describeReportCommission(runtime.reportOptions.commissionProfile),
  "get-report": (input, runtime) => readTopicalKnowledgeCellReport(input, runtime.reportProviders, runtime.reportOptions),
  "issue-report-quote": (input, runtime) => issueTopicalKnowledgeCellReportQuote(
    input,
    runtime.quoteProviders,
    runtime.quoteOptions,
  ),
  "execute-report": (input, runtime) => executeTopicalKnowledgeCellReport(
    input,
    runtime.reportProviders,
    runtime.reportOptions,
  ),
});

export function executeA2aMessage(source, runtimeLoader = loadReportRuntime) {
  return executeRelationalOperationMessage(source, {
    protocol: reportServiceProtocol,
    operations,
    runtimeLoader,
    responseFilename: "topical-report-service-response.rmn.cbor",
    unknownOperationMessage: "unknown report-service operation",
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await executeA2aMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}

