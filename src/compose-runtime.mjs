import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { identifyReportCommissionContent } from "./commission-identity.mjs";
import { createLocalReportExecutionLease, createReportWitnessProviders } from "./report-witness.mjs";
import { validateReportProfile } from "../lib/commission.mjs";

/** The owning host supplies real task custody, coordination, production,
 * review, commerce and authentication through one bindings module. */
export async function createTopicalKnowledgeCellReportRuntime({ boundary, root, bindings } = {}) {
  if (!bindings) {
    const configured = boundary?.bindingsModule;
    if (typeof configured !== "string" || !configured) throw new TypeError("report host bindingsModule is required");
    let module = configured;
    if (configured.startsWith(".")) {
      const path = resolve(root, configured), displacement = relative(root, path);
      if (displacement === ".." || displacement.startsWith("../") || isAbsolute(displacement)) throw new TypeError("report bindings leave their owning source root");
      module = pathToFileURL(path).href;
    }
    const provider = await import(module);
    if (typeof provider.createReportHostBindings !== "function") throw new TypeError("report binding provider has no createReportHostBindings");
    bindings = await provider.createReportHostBindings({ boundary, root });
  }
  if ((!bindings.taskSource && !bindings.taskStore) || !bindings.coordinationSource) throw new TypeError("report runtime requires existing A2A task and coordination custody");
  if (typeof bindings.customer !== "string" || !bindings.customer) throw new TypeError("report runtime requires an authenticated customer tenant");
  if (bindings.agentOptions?.bearerUser !== bindings.customer || typeof bindings.agentOptions?.bearerTokenFile !== "string" || !isAbsolute(bindings.agentOptions.bearerTokenFile)) throw new TypeError("report runtime requires the original A2A Bearer binding for its customer tenant");
  validateReportProfile(bindings.commissionProfile);
  const withRequestLease = bindings.withRequestLease ?? createLocalReportExecutionLease(bindings.executionLease);
  const witnesses = createReportWitnessProviders({ coordinationSource: bindings.coordinationSource, tenant: bindings.customer, withRequestLease });
  const identity = { identifyCommission: identifyReportCommissionContent };
  const reportProviders = { ...bindings.reportProviders, ...identity, ...witnesses };
  const quoteProviders = { ...bindings.quoteProviders, ...identity, ...witnesses };
  for (const name of ["generateReportCommission", "reviewReportCommission"]) if (typeof reportProviders[name] !== "function") throw new TypeError(`report runtime requires ${name}`);
  const options = { ...bindings.reportOptions, commissionProfile: bindings.commissionProfile, authenticatedActor: bindings.customer,
    taskId: process.env.A2A_TASK_ID ?? null };
  return Object.freeze({
    reportProviders, reportOptions: options, quoteProviders,
    quoteOptions: { ...bindings.quoteOptions, commissionProfile: bindings.commissionProfile, authenticatedActor: bindings.customer },
    agentOptions: { ...bindings.agentOptions, taskSource: bindings.taskSource, taskStore: bindings.taskStore, coordinationSource: bindings.coordinationSource },
  });
}
