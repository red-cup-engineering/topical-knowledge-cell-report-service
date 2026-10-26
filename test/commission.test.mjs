import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { normalizeReportCommission, planReportCommission, describeReportCommission } from "../lib/commission.mjs";
import { FORBIDDEN_AUTHORITIES, executeTopicalKnowledgeCellReport, issueTopicalKnowledgeCellReportQuote, readTopicalKnowledgeCellReport } from "../lib/report.mjs";
import { identifyReportCommissionContent as identify } from "../src/commission-identity.mjs";
import { createLocalReportExecutionLease, createReportWitnessProviders } from "../src/report-witness.mjs";
import { Message } from "@a2a-js/sdk";
import { userRmnMessage, extractRmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { createRelationalOperationProtocol } from "@red-cup-engineering/a2a-sovereign-operation-boundary-service";
import { reportServiceProtocol } from "../src/protocol.mjs";
import { executeA2aMessage } from "../scripts/execute-a2a-task.mjs";

const NOW = "2026-10-25T20:00:00.000Z", CUSTOMER = "urn:ame:report-customer", PRODUCER = "urn:ame:notebook-producer";
const ASSET = { assetId: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", network: "eip155:8453", tokenContract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 };
const PROFILE = {
  id: "urn:report-profile:policy", revision: "1", provider: PRODUCER, reviewer: "urn:ame:policy-review",
  disciplines: ["social-science", "business", "mathematics", "other", "unspecified"],
  genres: ["research-paper", "public-policy-brief", "business-decision-memo", "literature-review", "explanatory-report", "study-guide"],
  languages: ["en"], lengths: ["short", "medium", "long"], depths: ["overview", "comparative-analysis"],
  methods: ["compare-options"], sourcePreferences: ["admitted-sources"], artifactKinds: ["data-table", "json", "mind-map", "code-proposal"],
  turnaroundSeconds: null, limits: { promptBytes: 20000, commissionBytes: 50000, artifacts: 8, reportBytes: 300000, artifactBytes: 100000 },
};
const digest = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const terms = () => ({ version: 2, prompt: "Compare neighborhood heat-adaptation options.\nPreserve uncertainty.",
  discipline: "social-science", genre: "public-policy-brief", audience: { description: "municipal council", background: "budget decisions" },
  language: "en", length: "long", depth: "comparative-analysis", scope: { geography: { label: "Customer-selected municipality" }, period: { label: "2020–2025" } },
  methodPreferences: [{ id: "compare-options", requirement: "required", instruction: "Compare costs and distribution of benefits." }],
  artifacts: [{ id: "options", kind: "data-table", requirement: "required", description: "Options and costs, with units." }] });
const manifest = () => ({ id: "urn:manifest:one", type: "TopicalKnowledgeCellManifest", issuer: "urn:ame:corpus-owner", cellId: "urn:cell:heat", ownerEnterprise: "urn:ame:corpus-owner",
  scopeKind: "public", authorityMode: "non-authoritative-projection", custodyAssignment: "urn:custody:one", notebookProvider: PRODUCER,
  corpusSourceSetId: "urn:source-set:one", disclosureClass: "public", observedAt: "2026-10-25T00:00:00Z", validUntil: "2026-10-27T00:00:00Z", predecessorManifest: null, endpoint: "https://corpus.example/" });
const options = extra => ({ now: NOW, authenticatedActor: CUSTOMER, commissionProfile: PROFILE, taskId: "task:original", ...extra });
async function request(commission = terms(), channel = { type: "a2a-internal", contractId: "urn:contract:one" }) {
  const value = { type: "TopicalKnowledgeCellReportRequest", requestId: "urn:request:one", actor: CUSTOMER, manifest: manifest(),
    discoveryReceipt: { snapshotId: "urn:discovery:one", manifestId: "urn:manifest:one", status: "fresh", observedAt: NOW }, terms: commission, channel, authorization: null };
  const prepared = await planReportCommission(commission, PROFILE, identify);
  const body = { type: value.type, requestId: value.requestId, actor: value.actor, manifest: value.manifest, discoveryReceipt: value.discoveryReceipt,
    terms: prepared.commission, channel: value.channel, commissionId: prepared.commissionId, planId: prepared.plan.id };
  value.authorization = { holder: CUSTOMER, operation: "request-one-source-grounded-report", requestId: value.requestId,
    requestBodyId: identify(body).id, expiresAt: "2026-10-26T00:00:00Z", nondelegable: true, singleUse: true,
    allowedEffects: ["request-one-report"], forbiddenAuthorities: [...FORBIDDEN_AUTHORITIES] };
  return value;
}

// Persistent source fixture exercising the actual custody port and actual File
// kernel lease. The production adapter consumes the host's existing A2A source.
async function harness(t) {
  const directory = await mkdtemp(join(tmpdir(), "report-commission-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = coordinate => join(directory, `${createHash("sha256").update(JSON.stringify([coordinate.namespace, coordinate.tenant, coordinate.key])).digest("hex")}.json`);
  const source = {
    async get(coordinate) { try { return JSON.parse(await readFile(path(coordinate), "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } },
    async put(record) { const file = path(record); await writeFile(`${file}.next`, JSON.stringify(record)); await rename(`${file}.next`, file); return JSON.parse(await readFile(file, "utf8")); },
  };
  const host = { executeCommandSync(command, execution) {
    const r = spawnSync(command.command, command.arguments, { cwd: command.directory, timeout: execution.timeoutMilliseconds,
      stdio: ["ignore", "pipe", "pipe", ...execution.inheritedFileDescriptors] });
    return { type: "JavascriptNodeCommandExecutionReceipt", version: 1, request: command,
      result: { type: "JavascriptNodeCommandExecutionResult", version: 1, status: r.status, signal: r.signal, error: r.error?.message ?? "" } };
  } };
  const witnesses = () => createReportWitnessProviders({ coordinationSource: source, tenant: CUSTOMER,
    withRequestLease: createLocalReportExecutionLease({ directory, host }) });
  const calls = { generate: 0, review: 0, settle: 0, deliver: 0 }, requests = [];
  const cost = { type: "ProviderCharge", provider: PRODUCER, asset: ASSET, amountAtomic: "0", status: "no-charge", receipt: "urn:cost:fixture" };
  const producer = {
    identifyCommission: identify,
    async generateReportCommission(input) {
      calls.generate++; requests.push(input);
      const text = "# Options for the council\n\nA sourced comparison with cost ranges and distributional effects.";
      const csv = "option,cost_unit,beneficiary\nshade,USD,neighborhood\n";
      return { report: { type: "NotebookLMSourceGroundedReportArtifact", operationId: input.operationId, provider: PRODUCER,
        manifest: input.manifest.id, corpusSourceSetId: input.manifest.corpusSourceSetId, format: "markdown", language: "en", text,
        contentDigest: digest(text), citations: [{ sourceReceipt: "urn:source:one" }], generationReceipt: "urn:generation:report", providerCost: cost },
      artifacts: [{ id: "options", kind: "data-table", mediaType: "text/csv", content: csv, contentDigest: digest(csv), generationReceipt: "urn:generation:csv", providerCost: cost }] };
    },
    async reviewReportCommission(input) { calls.review++; return { type: "ReportCommissionReview", operationId: input.operationId, commissionId: input.commissionId,
      planId: input.plan.id, reviewer: PROFILE.reviewer, status: "accepted", deliverableDigests: input.deliverableDigests, receipt: "urn:review:one",
      providerCost: { ...cost, provider: PROFILE.reviewer, receipt: "urn:cost:review" } }; },
    async settleX402({ quote, buyer, operationId }) { calls.settle++; return { id: "urn:settlement:one", type: "X402SettlementReceipt", status: "settled", quoteId: quote.id, operationId,
      asset: quote.asset, amountAtomic: quote.amountAtomic, payTo: quote.payTo, payer: buyer, network: quote.asset.network,
      transaction: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", facilitator: quote.facilitator, settledAt: NOW }; },
    async deliverActivityPub({ deliveryId }) { calls.deliver++; return { id: "urn:delivery:one", deliveryId, status: "delivered", public: false }; },
  };
  return { directory, calls, requests, producer, witnesses, providers: { ...producer, ...witnesses() } };
}
async function externalRequest(h) {
  const input = { type: "TopicalKnowledgeCellReportQuoteRequest", requestId: "urn:quote-request:one", actor: CUSTOMER, manifest: manifest(), terms: terms(),
    offer: { type: "TopicalKnowledgeCellReportProductOffer", version: 1, offerId: "urn:offer:policy", seller: "urn:ame:topical-knowledge-cell-report-service", productId: "urn:product:policy",
      title: "Policy research", topic: "Commissioned research", manifestId: "urn:manifest:one", formats: ["markdown"], lengths: ["long"], languages: ["en"],
      price: { asset: ASSET, amountAtomic: "2000000" }, validFrom: "2026-10-25T00:00:00Z", validUntil: "2026-10-27T00:00:00Z", status: "active" } };
  const quote = await issueTopicalKnowledgeCellReportQuote(input, h.providers, options({ productOffers: [input.offer], payTo: "eip155:8453:0x1111111111111111111111111111111111111111", facilitator: "https://facilitator.example/" }));
  return request(input.terms, { type: "activitypub-x402", recipient: "https://customer.example/inbox", quote });
}

test("form descriptor, canonical identity and instructions preserve independent customer choices", async () => {
  const source = terms(), one = await planReportCommission(source, PROFILE, identify);
  const reordered = Object.fromEntries(Object.entries(source).reverse()), two = await planReportCommission(reordered, PROFILE, identify);
  assert.equal(one.commissionId, two.commissionId); assert.equal(one.plan.id, two.plan.id);
  assert.equal(one.commission.prompt, source.prompt);
  const descriptor = describeReportCommission(PROFILE);
  assert.deepEqual(descriptor.schema.properties.discipline.enum, PROFILE.disciplines);
  assert.deepEqual(descriptor.schema.properties.genre.enum, PROFILE.genres);
  assert.equal(descriptor.asynchronous.submitConfiguration.returnImmediately, true);
  const instructions = one.plan.providerRequests[0].instructions;
  for (const fragment of [source.prompt, "municipal council", "public-policy-brief", "2020–2025", "Options and costs"]) assert.ok(instructions.includes(fragment));
});

test("raw prompt bytes remain committed even under Unicode canonicalization", async () => {
  const first = terms(); first.prompt = "cafe\u0301";
  const second = terms(); second.prompt = "caf\u00e9";
  const a = await planReportCommission(first, PROFILE, identify), b = await planReportCommission(second, PROFILE, identify);
  assert.notEqual(a.commissionId, b.commissionId); assert.equal(a.commission.prompt, first.prompt);
});

test("unsupported required terms and malformed intervals refuse before effect", async () => {
  const unsupported = terms(); unsupported.artifacts[0].kind = "quantitative-chart";
  await assert.rejects(planReportCommission(unsupported, PROFILE, identify), /unsupported required artifacts/);
  const preferred = terms(); preferred.artifacts[0].kind = "quantitative-chart"; preferred.artifacts[0].requirement = "preferred";
  const result = await planReportCommission(preferred, PROFILE, identify);
  assert.equal(result.plan.unfulfilledPreferences[0].id, "options"); assert.equal(result.commission.artifacts[0].kind, "quantitative-chart");
  const invalid = terms(); invalid.scope.period = { label: "invalid", start: "2026-11-01T00:00:00Z", end: "2026-01-01T00:00:00Z" };
  assert.throws(() => normalizeReportCommission(invalid), /ordered UTC/);
});

test("a complete report plus CSV is persisted, reviewed and retrievable after rebuilding witnesses", async t => {
  const h = await harness(t), input = await request();
  const first = await executeTopicalKnowledgeCellReport(input, h.providers, options());
  const restarted = { ...h.producer, ...h.witnesses() };
  const replay = await executeTopicalKnowledgeCellReport(input, restarted, options({ now: "2026-10-28T00:00:00Z" }));
  assert.equal(first.report.id, replay.report.id); assert.equal(replay.replay, true);
  assert.equal(first.report.artifacts[0].mediaType, "text/csv");
  assert.deepEqual(h.calls, { generate: 1, review: 1, settle: 0, deliver: 0 });
  const received = await readTopicalKnowledgeCellReport({ requestId: input.requestId, actor: CUSTOMER }, restarted, options());
  assert.equal(received.report.id, first.report.id); assert.equal(received.taskId, "task:original");
  await assert.rejects(readTopicalKnowledgeCellReport({ requestId: input.requestId, actor: "urn:ame:other" }, restarted, options()), /authenticated/);
});

test("concurrent identical executions share the original job and do not repeat production", async t => {
  const h = await harness(t), input = await request();
  let started, release; const ready = new Promise(r => { started = r; }), pause = new Promise(r => { release = r; });
  const generate = h.providers.generateReportCommission;
  h.providers.generateReportCommission = async value => { started(); await pause; return generate(value); };
  const first = executeTopicalKnowledgeCellReport(input, h.providers, options()); await ready;
  const duplicate = await executeTopicalKnowledgeCellReport(input, { ...h.producer, ...h.witnesses() }, options({ taskId: "task:duplicate" }));
  assert.equal(duplicate.phase, "generating"); assert.equal(duplicate.taskId, "task:original");
  release(); await first; assert.equal(h.calls.generate, 1);
});

test("settled payment lost before checkpoint is reconciled without a second charge", async t => {
  const h = await harness(t), input = await externalRequest(h), settle = h.providers.settleX402;
  h.providers.settleX402 = async value => { const receipt = await settle(value); await writeFile(join(h.directory, "provider-payment.json"), JSON.stringify(receipt)); throw new Error("transport lost after settlement"); };
  await assert.rejects(executeTopicalKnowledgeCellReport(input, h.providers, options()), /transport lost/);
  const restarted = { ...h.producer, ...h.witnesses(), reconcileX402: async () => ({ status: "completed", value: JSON.parse(await readFile(join(h.directory, "provider-payment.json"), "utf8")) }) };
  const result = await executeTopicalKnowledgeCellReport(input, restarted, options({ now: "2026-10-28T00:00:00Z" }));
  assert.equal(result.paymentReceipt.id, "urn:settlement:one"); assert.equal(h.calls.settle, 1); assert.equal(h.calls.generate, 1); assert.equal(h.calls.deliver, 1);
});

test("unknown generation is retained, and recovered artifact resumes through review", async t => {
  const h = await harness(t), input = await request(), generate = h.providers.generateReportCommission;
  h.providers.generateReportCommission = async value => { const artifact = await generate(value); await writeFile(join(h.directory, "provider-artifact.json"), JSON.stringify(artifact)); throw new Error("lost generated response"); };
  await assert.rejects(executeTopicalKnowledgeCellReport(input, h.providers, options()), /lost generated/);
  const restarted = { ...h.producer, ...h.witnesses() };
  await assert.rejects(executeTopicalKnowledgeCellReport(input, restarted, options()), /requires reconciliation/);
  assert.equal(h.calls.generate, 1);
  restarted.reconcileReportCommission = async () => ({ status: "completed", value: JSON.parse(await readFile(join(h.directory, "provider-artifact.json"), "utf8")) });
  const result = await executeTopicalKnowledgeCellReport(input, restarted, options());
  assert.equal(result.report.version, 2); assert.equal(h.calls.generate, 1); assert.equal(h.calls.review, 1);
});

test("changed commission or profile cannot spend an earlier authorization", async t => {
  const h = await harness(t), input = await request(); input.terms.audience.description = "a different audience";
  await assert.rejects(executeTopicalKnowledgeCellReport(input, h.providers, options()), /authority/);
  const valid = await request(), changedProfile = structuredClone(PROFILE); changedProfile.limits.reportBytes--;
  await assert.rejects(executeTopicalKnowledgeCellReport(valid, h.providers, options({ commissionProfile: changedProfile })), /authority/);
  assert.equal(h.calls.generate, 0); assert.equal(h.calls.settle, 0);
});

test("missing required artifacts cannot fulfill and returned candidates remain in custody", async t => {
  const h = await harness(t), input = await request(), generate = h.providers.generateReportCommission;
  h.providers.generateReportCommission = async value => ({ ...(await generate(value)), artifacts: [] });
  await assert.rejects(executeTopicalKnowledgeCellReport(input, h.providers, options()), /required artifact is missing/);
  const retained = await h.providers.lookupRequest(input.requestId, { actor: CUSTOMER });
  assert.equal(retained.phase, "generated"); assert.ok(retained.output.report.text);
  assert.equal(h.calls.review, 0);
});

test("a customer-authored quote cannot change the seller price", async t => {
  const h = await harness(t), input = await externalRequest(h);
  const { id, ...body } = input.channel.quote;
  body.amountAtomic = "1";
  const counterfeit = { id: identify(body).id, ...body };
  const changed = await request(input.terms, { ...input.channel, quote: counterfeit });
  await assert.rejects(executeTopicalKnowledgeCellReport(changed, h.providers, options()), /not issued by this seller/);
  assert.equal(h.calls.settle, 0); assert.equal(h.calls.generate, 0);
});

test("review of different bytes cannot fulfill and its decision remains in custody", async t => {
  const h = await harness(t), input = await request(), review = h.providers.reviewReportCommission;
  h.providers.reviewReportCommission = async value => {
    const accepted = await review(value);
    accepted.deliverableDigests.report = digest("other");
    return accepted;
  };
  await assert.rejects(executeTopicalKnowledgeCellReport(input, h.providers, options()), /different artifact bytes/);
  const retained = await h.providers.lookupRequest(input.requestId, { actor: CUSTOMER });
  assert.equal(retained.phase, "reviewed"); assert.equal(retained.report, null); assert.ok(retained.review);
});

test("malformed completed effects remain received and cannot repeat on replay", async t => {
  for (const [method, counter] of [["generateReportCommission", "generate"], ["reviewReportCommission", "review"], ["settleX402", "settle"], ["deliverActivityPub", "deliver"]]) {
    const h = await harness(t), input = ["settle", "deliver"].includes(counter) ? await externalRequest(h) : await request();
    h.providers[method] = async () => { h.calls[counter]++; return null; };
    await assert.rejects(executeTopicalKnowledgeCellReport(input, h.providers, options()));
    await assert.rejects(executeTopicalKnowledgeCellReport(input, { ...h.producer, ...h.witnesses() }, options()));
    assert.equal(h.calls[counter], 1, `${method} repeated its malformed completed effect`);
  }
});

test("completed reconciliation with null output cannot be interpreted as an absent effect", async t => {
  const h = await harness(t), input = await request();
  h.providers.generateReportCommission = async () => { h.calls.generate++; throw new Error("lost response"); };
  await assert.rejects(executeTopicalKnowledgeCellReport(input, h.providers, options()), /lost response/);
  const restarted = { ...h.producer, ...h.witnesses(), reconcileReportCommission: async () => ({ status: "completed", value: null }) };
  await assert.rejects(executeTopicalKnowledgeCellReport(input, restarted, options()), /plain record/);
  await assert.rejects(executeTopicalKnowledgeCellReport(input, restarted, options()), /plain record/);
  assert.equal(h.calls.generate, 1);
});

test("literal __proto__ deliverables are reviewed as own data and altered bytes refuse", async t => {
  for (const alter of [false, true]) {
    const h = await harness(t), commission = terms(); commission.artifacts[0].id = "__proto__";
    const input = await request(commission), generate = h.providers.generateReportCommission, review = h.providers.reviewReportCommission;
    h.providers.generateReportCommission = async value => {
      const output = await generate(value); output.artifacts[0].id = "__proto__"; return output;
    };
    h.providers.reviewReportCommission = async value => {
      assert.equal(Object.hasOwn(value.deliverableDigests, "__proto__"), true);
      assert.equal(value.deliverableDigests.__proto__, value.output.artifacts[0].contentDigest);
      const accepted = await review(value);
      if (alter) accepted.deliverableDigests = Object.fromEntries(Object.entries(accepted.deliverableDigests).map(([id, bytes]) => [id, id === "__proto__" ? digest("other") : bytes]));
      return accepted;
    };
    if (alter) await assert.rejects(executeTopicalKnowledgeCellReport(input, h.providers, options()), /different artifact bytes/);
    else {
      const result = await executeTopicalKnowledgeCellReport(input, h.providers, options());
      assert.equal(Object.hasOwn(result.report.review.deliverableDigests, "__proto__"), true);
      assert.equal(result.report.artifacts[0].id, "__proto__");
    }
  }
});

test("canonical transport preserves the complete v2 plan across nested member order", async () => {
  const reverseMembers = value => Array.isArray(value) ? value.map(reverseMembers)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseMembers(child)])) : value;
  const one = await planReportCommission(terms(), PROFILE, identify);
  const reordered = reverseMembers(terms()), two = await planReportCommission(reordered, PROFILE, identify);
  assert.equal(one.commissionId, two.commissionId); assert.equal(one.plan.id, two.plan.id);
  assert.deepEqual(one.plan.providerRequests, two.plan.providerRequests);
  const input = await request(reordered), wire = reportServiceProtocol.encodeRequest("execute-report", input);
  const admitted = reportServiceProtocol.admitRequest(wire.bytes, wire.id).input;
  assert.deepEqual(admitted, input);
  assert.equal((await planReportCommission(admitted.terms, PROFILE, identify)).plan.id, one.plan.id);
  const descriptor = describeReportCommission(PROFILE);
  assert.deepEqual(descriptor.asynchronous, { protocol: "A2A", version: "1.0", submit: "SendMessage",
    submitConfiguration: { returnImmediately: true }, status: "GetTask", history: "ListTasks", cancel: "CancelTask" });
});

test("v2 canonical A2A intake and output retain original Unicode prompt and reviewed report bytes", async t => {
  const h = await harness(t), source = terms(); source.prompt = "Study cafe\u0301 culture."; source.audience.description = "Cafe\u0301 researchers";
  const input = await request(source), original = h.providers.generateReportCommission;
  h.providers.generateReportCommission = async value => {
    assert.equal(value.commission.prompt, source.prompt);
    assert.equal(value.commission.audience.description, source.audience.description);
    assert.ok(value.plan.providerRequests.every(item => item.instructions.includes(source.prompt)));
    const output = await original(value); output.report.text = "# Cafe\u0301 study\n\nSource-grounded fixture.";
    output.report.contentDigest = digest(output.report.text); return output;
  };
  const wire = reportServiceProtocol.encodeRequest("execute-report", input);
  const message = await executeA2aMessage(userRmnMessage(wire.bytes), async () => ({
    reportProviders: h.providers, reportOptions: options(), quoteProviders: h.providers, quoteOptions: options(),
  }));
  const part = extractRmnPart(Message.fromJSON(message).parts), received = reportServiceProtocol.admitResponse(part.bytes, part.ni);
  assert.equal(received.disposition, "accepted", received.reason);
  assert.equal(received.result.report.commission.prompt, source.prompt);
  assert.equal(received.result.report.text, "# Cafe\u0301 study\n\nSource-grounded fixture.");
  assert.equal(received.result.report.contentDigest, digest(received.result.report.text));
  assert.equal(received.result.report.review.deliverableDigests.report, received.result.report.contentDigest);
  assert.deepEqual(h.calls, { generate: 1, review: 1, settle: 0, deliver: 0 });
});

const originalSemanticProtocol = () => createRelationalOperationProtocol({
  requestKind: "org.emsenn.topical-knowledge-cell-report-service.request.v1",
  responseKind: "org.emsenn.topical-knowledge-cell-report-service.response.v1", label: "report-service protocol",
});

test("v1 operation and response carriers retain their original semantic wire identities", () => {
  const original = originalSemanticProtocol(), input = { type: "TopicalKnowledgeCellReportRequest",
    terms: { prompt: "Legacy cafe\u0301 prompt", format: "brief", language: "en", length: "short" } };
  const before = original.encodeRequest("execute-report", input), after = reportServiceProtocol.encodeRequest("execute-report", input);
  assert.equal(after.id, before.id); assert.deepEqual(after.bytes, before.bytes);
  const response = { request: before.id, disposition: "accepted",
    result: { type: "TopicalKnowledgeCellReportServiceResult", report: { version: 1, text: "Legacy result" } } };
  const oldOutput = original.encodeResponse(response), output = reportServiceProtocol.encodeResponse(response);
  assert.equal(output.id, oldOutput.id); assert.deepEqual(output.bytes, oldOutput.bytes);
  assert.deepEqual(reportServiceProtocol.admitResponse(output.bytes, output.id), original.admitResponse(oldOutput.bytes, oldOutput.id));
});

test("v2 protocol rejects plain normalized intake and malformed or ambiguous exact carriers", () => {
  const original = originalSemanticProtocol(), plain = original.encodeRequest("execute-report", { terms: terms() });
  assert.throws(() => reportServiceProtocol.admitRequest(plain.bytes, plain.id), /exact JSON byte carrier/);
  const carrier = (text, mediaType = "application/json") => ({ type: "ReportCommissionJsonByteCarrier", version: 2,
    body: { mediaType, contentBase64: Buffer.from(text).toString("base64") } });
  for (const input of [
    carrier('{ "terms": {"version":2} }'),
    carrier('{"terms":{"version":2}}', "text/plain"),
    carrier('{"terms":{"version":1}}'),
    { type: "ReportCommissionJsonByteCarrier", version: 2, body: { mediaType: "application/json", contentBase64: "***" } },
    { ...carrier('{"terms":{"version":2}}'), extra: true },
  ]) {
    const wire = original.encodeRequest("execute-report", input);
    assert.throws(() => reportServiceProtocol.admitRequest(wire.bytes, wire.id));
  }
});
