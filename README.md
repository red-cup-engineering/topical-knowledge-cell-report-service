# topical-knowledge-cell-report-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Commission reports through one prompt and structured form contract, execute them as durable A2A tasks, and retrieve the reviewed report and supporting artifacts. The service hires production and review separately and supports private ActivityPub delivery after x402 settlement.

## Commission a report

Version 2 adds independent choices for discipline, document type, audience, geography and period, research question, language, length, depth, source and method preferences, supporting deliverables, and requested turnaround. The original prompt is retained unchanged. Every source, method and artifact preference distinguishes a required result from a preference. A required term must be supported by the current provider profile before a quote can be issued; an unsupported preference remains visible in the plan the customer authorizes.

The profile supplies the offered disciplines, genres, methods and artifact kinds. The shared descriptor includes nested field schemas and available choices for a human form and an agent client. Both call the same normalization and planning code in [lib/commission.mjs](lib/commission.mjs). Version 1 callers retain their existing terms, identities and completed replay behavior.

The requested demonstration prompt is `white repopulation`. Preserve that wording in the prompt field and let the customer independently choose the discipline, document type, audience, scope and research question in the same form. It uses this common production and review pipeline.

For example, the `terms` field of an existing report request can contain:

```json
{
  "version": 2,
  "prompt": "Compare neighborhood heat-adaptation options for the council.",
  "discipline": "social-science",
  "genre": "public-policy-brief",
  "audience": {
    "description": "municipal council",
    "background": "budget decisions"
  },
  "language": "en",
  "length": "long",
  "depth": "comparative-analysis",
  "scope": {
    "geography": { "label": "Customer-selected municipality" },
    "period": { "label": "2020–2025" }
  },
  "artifacts": [{
    "id": "options",
    "kind": "data-table",
    "requirement": "required",
    "description": "Compare options, costs with units, and beneficiaries."
  }]
}
```

The chosen profile must offer those values; this example establishes no price or turnaround. The full commission and provider instruction projection are retained with the quote, authorization and result. Data's canonical JSON semantic identity supplies the v2 commission, profile, plan and request identities, with a separate digest committing the exact original prompt bytes.

## Callable operations

The existing RMN operation envelope and A2A task interface remain the public protocol.

| Operation | Result |
| --- | --- |
| `describe-report-commission` | Current profile, complete form schema, operation names and A2A task controls. |
| `issue-report-quote` | A buyer-bound quote for the exact commission and plan, using the host's seller-owned `productOffers` and payout configuration. |
| `execute-report` | The reviewed report and supporting artifacts, or the progress and original task identity of an execution already in progress. |
| `get-report` | The authenticated customer's retained progress, original task identity, result and settlement/delivery receipts. Input is `{ "requestId": "…", "actor": "…" }`. |

Submit an `execute-report` message through the original A2A send operation with `configuration.returnImmediately: true`. The contracted-agent host returns the task; use `tasks/get`, `tasks/list` and `tasks/cancel` through that same host. Its interrupted-task recovery replays the original operation. There is no additional report queue. The corrected server executable starts `scripts/execute-a2a-task.mjs` and forwards the host's existing task and coordination sources.

## Durable execution

[src/report-witness.mjs](src/report-witness.mjs) stores quote and report witnesses in the host's existing A2A coordination custody, under the `topical-knowledge-cell-report-service` namespace and authenticated customer tenant. It consumes the original `get({ namespace, tenant, key })` and `put({ namespace, tenant, key, value })` ports. The original A2A task source owns scheduling, task history, cancellation and restart recovery.

An exclusive request lease covers admission and execution. A single-node host can use the included adapter to the File service's stable-inode kernel lease, with an existing lease directory and the host's Code executor. A host with more than one executor node must supply one lease function that serializes every writer to the same coordination records; separate local directories do not coordinate separate nodes.

The request record checkpoints admission, settlement, generation, review, fulfillment and delivery. Each external effect is marked before the call and its returned outcome is persisted before validation. Received flags distinguish a malformed response from an operation that has not run. Replaying a retained malformed result cannot trigger a second charge or generation. Concurrent identical requests return the original progress and task identity; changing a request under its existing identity is refused.

If the process stops after starting an effect, the corresponding provider must reconcile that operation. Its response is either `{ status: "completed", value }` or `{ status: "absent" }`; any other outcome suspends continuation. Only an explicit absence permits another attempt. The reconciliation methods are `reconcileX402`, `reconcileReportCommission`, `reconcileReportReview` and `reconcileReportDelivery`. They receive the committed operation identity and request; delivery reconciliation also receives the exact persisted delivery identity and report. Fulfilled reports remain retrievable even when delivery needs recovery.

V2 quote execution checks the original seller-issued quote witness as well as its canonical identity. Changing the price and recomputing a hash cannot manufacture an issued quote. Authorization and quoting commit the complete commission, current capability profile and fulfillment plan.

## Host composition

[src/compose-runtime.mjs](src/compose-runtime.mjs) exports `createTopicalKnowledgeCellReportRuntime`. An activated deployment boundary can select it as `runtimeAdapterModule` and select its owning host module with `bindingsModule`. The host module exports `createReportHostBindings({ boundary, root })` and returns:

- `customer`: the authenticated customer principal.
- `taskSource` or `taskStore`, and `coordinationSource`: the original durable A2A state providers.
- `commissionProfile`: provider/reviewer identities, offered choices and concrete input/output limits, as validated by `validateReportProfile`.
- `withRequestLease(coordinate, operation)`, or `executionLease: { directory, host }` for the included File lease adapter.
- `reportProviders`: production, review, settlement, delivery and reconciliation bindings. The runtime supplies the canonical identity and original witness adapters.
- `quoteOptions`: the seller-owned `productOffers`, `payTo`, `facilitator` and quote lifetime. V2 issuance refuses client-substituted offer terms.
- `reportOptions` and `agentOptions`: the host's remaining service configuration. `agentOptions.bearerUser` must equal `customer`, and `agentOptions.bearerTokenFile` must name an absolute host-owned token file. The Agent Card requires the original A2A Bearer authentication for all operations.

`generateReportCommission` receives the normalized commission, committed plan, source manifest and operation identity. Its output is `{ report, artifacts }`: the original `NotebookLMSourceGroundedReportArtifact`, plus supporting `{ id, kind, mediaType, content, contentDigest, generationReceipt, providerCost }` records. Every required planned artifact must be present with matching media type, digest and bounds; JSON carriers must parse. The plan includes the existing producer artifact type and complete instruction projection for each deliverable. The bound producer is responsible for consuming that projection through its actual source/workspace contract.

`reviewReportCommission` receives that output and its exact deliverable digests. Acceptance returns a `ReportCommissionReview` containing the operation, commission and plan identities; reviewer; `status: "accepted"`; exact `deliverableDigests`; receipt; and review `providerCost`. Invalid candidates and decisions remain in custody for recovery or a new authorized revision. The result's accounting retains production and review charges, deduplicates shared charge receipts, and records the contribution after those costs. Full gross margin remains unset until all commercial costs are represented.

## Installation status and verification

Install the exact dependencies from the house registry, `https://registry.561.group`. The report service selects these published A2A interfaces:

| Package | Version | Role |
| --- | --- | --- |
| `a2a-contracted-agent-service` | `0.12.0` | Authenticated server, original task custody, background execution and recovery |
| `a2a-sovereign-operation-boundary-service` | `0.4.0` | Commission operation protocol, runtime loading and executor dispatch |
| `a2a-rmn-part-service` | `0.5.0` | Content-identified A2A message parts |
| `ni-services-section` | `0.1.2` | Existing NI byte identity used by the report checks |
| `@a2a-js/sdk` | `1.1.0` | Stable message interfaces shared with the contracted server and RMN parts |

The published server accepts the existing task and coordination sources, customer Bearer binding and executor arguments, and passes the original task identity through `A2A_TASK_ID`. The operation protocol returns the admitted request envelope as `encodeRequest(...).bytes`; responses are read with `reportServiceProtocol.admitResponse(bytes, ni)`. The A2A checks use those original protocol interfaces. Data `0.7.1`, File `0.8.4`, and the declared semantic-content identity supplier also have exact house-registry publications.

The received house artifacts pass the three A2A boundary checks, seven existing report checks and fourteen commission checks. Host activation supplies the actual authenticated customer, producer, reviewer, existing task and coordination custody, and settlement/delivery bindings through the deployment boundary and runtime composition described above.

`npm run check` checks the module syntax. `test/commission.test.mjs` exercises the native selected Data and File services, durable coordination-port records, concurrent admission, interruption/reconciliation, seller-issued quote checks, supporting artifact/review acceptance and malformed-result replay. Run it with `node --test --test-isolation=none --test-reporter=tap test/commission.test.mjs` where process-isolated test reporting is unavailable.

The [report commission specification](content/specifications/report-commission-contract.md) retains the full requirements and producer analysis; this implementation supplies its shared commission and durable execution slice.

