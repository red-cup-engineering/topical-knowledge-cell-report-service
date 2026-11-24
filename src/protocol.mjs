import { createRelationalOperationProtocol } from "@red-cup-engineering/a2a-sovereign-operation-boundary-service";
import { canonicalJson, encodeJsonByteCarrier, decodeJsonByteCarrier } from "@red-cup-engineering/json-services-section";

const semanticProtocol = createRelationalOperationProtocol({
  requestKind: "org.emsenn.topical-knowledge-cell-report-service.request.v1",
  responseKind: "org.emsenn.topical-knowledge-cell-report-service.response.v1",
  label: "report-service protocol",
});

// Semantic admission normalizes marks. V2 commissions and reviewed output
// commit exact customer/provider text, so their JSON travels in the original
// JSON byte carrier inside the original semantic operation envelope.
const CARRIER_TYPE = "ReportCommissionJsonByteCarrier";
const isCarrier = value => value?.type === CARRIER_TYPE;
const exactInput = (operation, input) => ["describe-report-commission", "get-report"].includes(operation)
  || (["issue-report-quote", "execute-report"].includes(operation) && input?.terms?.version === 2);
const exactResult = result => result?.type === "ReportCommissionDescriptor"
  || result?.type === "TopicalKnowledgeCellReportServiceProgress"
  || result?.type === "X402ReportCommissionQuote" && result.version === 2
  || result?.type === "TopicalKnowledgeCellReport" && result.version === 2
  || result?.type === "TopicalKnowledgeCellReportServiceResult" && result.report?.version === 2;

function carry(value) {
  const bytes = Array.from(new TextEncoder().encode(canonicalJson(value)));
  return { type: CARRIER_TYPE, version: 2,
    body: encodeJsonByteCarrier({ bytes, mediaType: "application/json" }) };
}

function receive(carrier) {
  if (!carrier || Object.getPrototypeOf(carrier) !== Object.prototype
    || Object.keys(carrier).sort().join(",") !== "body,type,version"
    || carrier.type !== CARRIER_TYPE || carrier.version !== 2) throw new TypeError("invalid report commission byte carrier");
  const received = decodeJsonByteCarrier({ carrier: carrier.body, expectedMediaType: "application/json" });
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(received.bytes));
  const value = JSON.parse(text);
  if (canonicalJson(value) !== text) throw new TypeError("report commission carrier must contain canonical JSON bytes");
  return value;
}

function receivedRequest(request) {
  if (isCarrier(request.input)) {
    const input = receive(request.input);
    if (!exactInput(request.operation, input)) throw new TypeError("report byte carrier is outside its v2 operation");
    return { ...request, input };
  }
  if (exactInput(request.operation, request.input)) throw new TypeError("v2 report operations require the exact JSON byte carrier");
  return request;
}

function receivedResponse(response) {
  if (isCarrier(response.result)) {
    const result = receive(response.result);
    if (!exactResult(result)) throw new TypeError("report byte carrier is outside its v2 result");
    return { ...response, result };
  }
  if (exactResult(response.result)) throw new TypeError("v2 report results require the exact JSON byte carrier");
  return response;
}

export const reportServiceProtocol = Object.freeze({
  encodeRequest(operation, input) {
    return semanticProtocol.encodeRequest(operation, exactInput(operation, input) ? carry(input) : input);
  },
  decodeRequest: term => receivedRequest(semanticProtocol.decodeRequest(term)),
  admitRequest: (bytes, token) => receivedRequest(semanticProtocol.admitRequest(bytes, token)),
  encodeResponse(response) {
    return semanticProtocol.encodeResponse({ ...response,
      result: exactResult(response.result) ? carry(response.result) : response.result });
  },
  decodeResponse: term => receivedResponse(semanticProtocol.decodeResponse(term)),
  admitResponse: (bytes, token) => receivedResponse(semanticProtocol.admitResponse(bytes, token)),
});

export const encodeRequest = reportServiceProtocol.encodeRequest;
export const decodeRequest = reportServiceProtocol.decodeRequest;
export const encodeResponse = reportServiceProtocol.encodeResponse;
export const decodeResponse = reportServiceProtocol.decodeResponse;
