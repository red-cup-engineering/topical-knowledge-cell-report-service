import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/semantic-content-identity";

export function identifyReportCommissionContent(value) {
  return identifyJsonSemanticContent({ objectKind: "org.emsenn.report-commission.v2", value, witnessRoot: EMPTY_WITNESS_ROOT });
}
