import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { acquireLocalFileLeaseSync } from "@red-cup-engineering/computer-file-engineering-services-section/local-file-lease";

const NAMESPACE = "topical-knowledge-cell-report-service";
const coordinateKey = (kind, requestId) => createHash("sha256").update(JSON.stringify([kind, requestId])).digest("hex");

/** Use the same host-owned A2A coordination custody for report witnesses.
 * No filesystem report store, queue or duplicate A2A task is created. */
export function createReportWitnessProviders({ coordinationSource, tenant, withRequestLease }) {
  if (!coordinationSource || typeof coordinationSource.get !== "function" || typeof coordinationSource.put !== "function") throw new TypeError("report witnesses require the host A2A coordination source");
  if (typeof tenant !== "string" || !tenant || typeof withRequestLease !== "function") throw new TypeError("report witnesses require a bound tenant and execution lease");
  const coordinate = (kind, requestId, actor = tenant) => {
    if (actor !== tenant || typeof requestId !== "string" || !requestId) throw new TypeError("report witness is outside its authenticated tenant");
    return { namespace: NAMESPACE, tenant, key: coordinateKey(kind, requestId) };
  };
  const read = async (kind, requestId, actor) => {
    const key = coordinate(kind, requestId, actor), record = await coordinationSource.get(key);
    if (!record) return null;
    if (record.namespace !== key.namespace || record.tenant !== key.tenant || record.key !== key.key) throw new TypeError("report custody returned another coordinate");
    return structuredClone(record.value);
  };
  const write = async (kind, requestId, actor, value) => {
    const key = coordinate(kind, requestId, actor);
    const received = await coordinationSource.put({ ...key, value: structuredClone(value) });
    if (!received || received.namespace !== key.namespace || received.tenant !== key.tenant || received.key !== key.key) throw new TypeError("report custody did not acknowledge its coordinate");
    return value;
  };
  return Object.freeze({
    lookupRequest: (requestId, options = {}) => read("request", requestId, options.actor),
    recordRequestProgress: value => write("request", value.requestId, value.customer, value),
    recordReport: value => write("request", value.requestId, value.customer ?? value.report?.customer, value),
    lookupQuoteRequest: (requestId, options = {}) => read("quote", requestId, options.actor),
    recordQuote: value => write("quote", value.requestId, value.buyer, value),
    lookupDelivery: deliveryId => read("delivery", deliveryId),
    recordDelivery: value => write("delivery", value.deliveryId, tenant, value.receipt),
    withRequestLock: (request, operation) => {
      const key = coordinate("request", request.requestId, request.actor);
      return withRequestLease(key, operation);
    },
  });
}

/** A single-node executor uses the File owner's kernel lease. The stable lock
 * remains named after close; deleting it would allow concurrent inode locks. */
export function createLocalReportExecutionLease({ directory, host }) {
  if (typeof directory !== "string" || !isAbsolute(directory) || typeof host?.executeCommandSync !== "function") throw new TypeError("local report execution requires its absolute host lease directory and Code executor");
  return async (coordinate, operation) => {
    const name = createHash("sha256").update(JSON.stringify(coordinate)).digest("hex");
    const lease = acquireLocalFileLeaseSync({ type: "LocalFileLeaseRequest", version: 1,
      profile: "linux-local-flock-v1", path: join(directory, `${name}.lock`) }, host);
    try { lease.assertBound(); return await operation(); }
    finally { lease.close(); }
  };
}
