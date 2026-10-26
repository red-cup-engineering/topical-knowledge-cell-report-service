import { createHash } from "node:crypto";

export const REPORT_COMMISSION_VERSION = 2;
export const REPORT_DISCIPLINES = Object.freeze(["social-science", "business", "mathematics", "other", "unspecified"]);
export const REPORT_GENRES = Object.freeze(["research-paper", "public-policy-brief", "business-decision-memo", "literature-review", "explanatory-report", "study-guide"]);
const REQUIREMENTS = ["required", "preferred"];
const MEDIA = Object.freeze({ report: "text/markdown", "data-table": "text/csv", json: "application/json", "mind-map": "application/json", "code-proposal": "application/json" });
const own = (object, key) => Object.hasOwn(object, key);
const freeze = (value) => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function exactRecord(value, required, optional = [], label = "record") {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain record`);
  for (const name of required) if (!own(value, name)) throw new TypeError(`${label} is missing ${name}`);
  for (const name of Object.keys(value)) if (![...required, ...optional].includes(name)) throw new TypeError(`${label} has unexpected ${name}`);
  return value;
}
const nonempty = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be nonempty text`);
  return value;
};
const selected = (value, choices, label) => {
  if (!choices.includes(value)) throw new TypeError(`unsupported ${label}: ${String(value)}`);
  return value;
};
export const promptByteDigest = prompt => `sha256:${createHash("sha256").update(prompt, "utf8").digest("hex")}`;

function preferences(value, label, artifact = false) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const ids = new Set();
  return value.map((item, index) => {
    const at = `${label}[${index}]`;
    exactRecord(item, artifact ? ["id", "kind", "requirement", "description"] : ["id", "requirement", "instruction"], [], at);
    nonempty(item.id, `${at}.id`);
    if (ids.has(item.id) || (artifact && item.id === "report")) throw new TypeError(`${at} duplicates a deliverable or preference identity`);
    ids.add(item.id);
    selected(item.requirement, REQUIREMENTS, `${at}.requirement`);
    nonempty(artifact ? item.description : item.instruction, `${at}.description`);
    if (artifact) nonempty(item.kind, `${at}.kind`);
    return structuredClone(item);
  });
}

/** One interpretation for forms, quotes, execution and retained results. */
export function normalizeReportCommission(terms) {
  exactRecord(terms, ["version", "prompt", "discipline", "genre", "audience", "language", "length", "depth"],
    ["format", "researchQuestion", "disciplineDescription", "scope", "sourcePreferences", "methodPreferences", "artifacts", "turnaround", "revision"], "commission");
  if (terms.version !== REPORT_COMMISSION_VERSION) throw new TypeError("unsupported report commission version");
  nonempty(terms.prompt, "prompt");
  selected(terms.discipline, REPORT_DISCIPLINES, "discipline");
  selected(terms.genre, REPORT_GENRES, "genre");
  exactRecord(terms.audience, ["description", "background"], [], "audience");
  for (const name of ["description", "background"]) if (terms.audience[name] !== null) nonempty(terms.audience[name], `audience.${name}`);
  nonempty(terms.language, "language"); nonempty(terms.length, "length"); nonempty(terms.depth, "depth");
  const format = terms.format ?? "markdown";
  if (format !== "markdown") throw new TypeError("commission main report format must be markdown");
  const disciplineDescription = terms.disciplineDescription ?? null;
  if (terms.discipline === "other") nonempty(disciplineDescription, "disciplineDescription");
  else if (disciplineDescription !== null) throw new TypeError("disciplineDescription is only used with other");
  const researchQuestion = terms.researchQuestion ?? null;
  if (researchQuestion !== null) nonempty(researchQuestion, "researchQuestion");
  const scope = structuredClone(terms.scope ?? { geography: null, period: null });
  exactRecord(scope, ["geography", "period"], [], "scope");
  if (scope.geography !== null) {
    exactRecord(scope.geography, ["label"], ["identifiers"], "scope.geography");
    nonempty(scope.geography.label, "geography label");
    if (own(scope.geography, "identifiers") && (!Array.isArray(scope.geography.identifiers) || scope.geography.identifiers.some(item => typeof item !== "string" || !item))) throw new TypeError("geography identifiers must be strings");
  }
  if (scope.period !== null) {
    exactRecord(scope.period, ["label"], ["start", "end"], "scope.period");
    nonempty(scope.period.label, "period label");
    if (own(scope.period, "start") !== own(scope.period, "end")) throw new TypeError("period interval needs both endpoints");
    if (own(scope.period, "start")) {
      const instant = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace(/(?<!\.\d{3})Z$/u, ".000Z");
      if (!instant(scope.period.start) || !instant(scope.period.end) || Date.parse(scope.period.end) < Date.parse(scope.period.start)) throw new TypeError("period endpoints must be ordered UTC instants");
    }
  }
  const turnaround = terms.turnaround ?? null;
  if (turnaround !== null) {
    exactRecord(turnaround, ["requirement", "elapsedSeconds", "startEvent"], [], "turnaround");
    selected(turnaround.requirement, REQUIREMENTS, "turnaround.requirement");
    if (!Number.isSafeInteger(turnaround.elapsedSeconds) || turnaround.elapsedSeconds < 1 || turnaround.startEvent !== "admission") throw new TypeError("turnaround needs positive seconds from admission");
  }
  const revision = terms.revision ?? { predecessor: null, resolution: null };
  exactRecord(revision, ["predecessor", "resolution"], [], "revision");
  for (const name of ["predecessor", "resolution"]) if (revision[name] !== null) nonempty(revision[name], `revision.${name}`);
  return freeze({ version: 2, prompt: terms.prompt, discipline: terms.discipline, disciplineDescription,
    genre: terms.genre, audience: structuredClone(terms.audience), researchQuestion, scope,
    language: terms.language, length: terms.length, depth: terms.depth, format,
    sourcePreferences: preferences(terms.sourcePreferences ?? [], "sourcePreferences"),
    methodPreferences: preferences(terms.methodPreferences ?? [], "methodPreferences"),
    artifacts: preferences(terms.artifacts ?? [], "artifacts", true),
    turnaround: structuredClone(turnaround), revision: structuredClone(revision) });
}

export function validateReportProfile(profile) {
  exactRecord(profile, ["id", "revision", "provider", "reviewer", "disciplines", "genres", "languages", "lengths", "depths", "methods", "sourcePreferences", "artifactKinds", "turnaroundSeconds", "limits"], [], "capability profile");
  for (const field of ["id", "revision", "provider", "reviewer"]) nonempty(profile[field], `profile.${field}`);
  for (const field of ["disciplines", "genres", "languages", "lengths", "depths", "methods", "sourcePreferences", "artifactKinds"]) {
    if (!Array.isArray(profile[field]) || profile[field].some(x => typeof x !== "string" || !x) || new Set(profile[field]).size !== profile[field].length) throw new TypeError(`profile.${field} must be duplicate-free strings`);
  }
  for (const kind of profile.artifactKinds) if (!own(MEDIA, kind)) throw new TypeError(`unsupported artifact carrier: ${kind}`);
  if (profile.turnaroundSeconds !== null && (!Number.isSafeInteger(profile.turnaroundSeconds) || profile.turnaroundSeconds < 1)) throw new TypeError("profile turnaround must be null or positive seconds");
  exactRecord(profile.limits, ["promptBytes", "commissionBytes", "artifacts", "reportBytes", "artifactBytes"], [], "profile limits");
  for (const [key, value] of Object.entries(profile.limits)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`profile limit ${key} must be a positive integer`);
  return profile;
}

export function projectReportInstructions(commission, deliverable = { id: "report", kind: "report" }) {
  const { prompt, ...choices } = commission;
  return ["Produce the commissioned deliverable using the admitted source corpus.",
    "Original customer prompt (preserve its question and scope):", prompt,
    "Structured commission (these are instructions for production and review):",
    JSON.stringify(choices, null, 2), "Deliverable:", JSON.stringify(deliverable, null, 2)].join("\n\n");
}

/** identify must be the host's current canonical JSON identity supplier. */
export async function planReportCommission(terms, profile, identify) {
  validateReportProfile(profile);
  if (typeof identify !== "function") throw new TypeError("canonical commission identity provider is required");
  const commission = normalizeReportCommission(terms), gaps = [];
  if (Buffer.byteLength(commission.prompt, "utf8") > profile.limits.promptBytes || Buffer.byteLength(JSON.stringify(commission), "utf8") > profile.limits.commissionBytes || commission.artifacts.length > profile.limits.artifacts) throw new TypeError("commission exceeds offered limits");
  for (const [field, offered] of [["discipline", "disciplines"], ["genre", "genres"], ["language", "languages"], ["length", "lengths"], ["depth", "depths"]]) {
    if (!profile[offered].includes(commission[field])) throw new TypeError(`unsupported required ${field}: ${commission[field]}`);
  }
  const admit = (item, values, field) => {
    if (values.includes(item.kind ?? item.id)) return true;
    if (item.requirement === "required") throw new TypeError(`unsupported required ${field}: ${item.id}`);
    gaps.push({ field, id: item.id, reason: "not-offered-by-profile" }); return false;
  };
  commission.sourcePreferences.forEach(item => admit(item, profile.sourcePreferences, "sourcePreferences"));
  commission.methodPreferences.forEach(item => admit(item, profile.methods, "methodPreferences"));
  const deliverables = [{ id: "report", kind: "report", requirement: "required", mediaType: "text/markdown", description: commission.genre },
    ...commission.artifacts.filter(item => admit(item, profile.artifactKinds, "artifacts")).map(item => ({ ...item, mediaType: MEDIA[item.kind] }))];
  if (commission.turnaround && (profile.turnaroundSeconds === null || profile.turnaroundSeconds > commission.turnaround.elapsedSeconds)) {
    if (commission.turnaround.requirement === "required") throw new TypeError("unsupported required turnaround");
    gaps.push({ field: "turnaround", id: "turnaround", reason: "not-offered-by-profile" });
  }
  const commissionId = nonempty((await identify({ type: "ReportCommission", commission, originalPromptDigest: promptByteDigest(commission.prompt) }))?.id, "commission identity");
  const profileContentId = nonempty((await identify(profile))?.id, "capability profile identity");
  const body = { type: "ReportCommissionPlan", version: 2, commissionId, profileId: profile.id, profileRevision: profile.revision, profileContentId,
    provider: profile.provider, reviewer: profile.reviewer, deliverables, unfulfilledPreferences: gaps,
    providerRequests: deliverables.map(deliverable => ({ deliverableId: deliverable.id, artifactType: deliverable.kind === "code-proposal" ? "code" : deliverable.kind,
      instructions: projectReportInstructions(commission, deliverable) })) };
  const planId = nonempty((await identify(body))?.id, "fulfillment plan identity");
  return freeze({ commission, commissionId, plan: { id: planId, ...body } });
}

export function describeReportCommission(profile) {
  validateReportProfile(profile);
  const text = { type: "string", minLength: 1 };
  const optionalText = { type: ["string", "null"], minLength: 1 };
  const requirement = { type: "string", enum: REQUIREMENTS, title: "Must be included or preferred?" };
  const preference = choices => ({ type: "array", default: [], items: { type: "object", additionalProperties: false,
    required: ["id", "requirement", "instruction"], properties: { id: { ...text, examples: choices }, requirement, instruction: { ...text, title: "Instructions" } } } });
  const utcInstant = { type: "string", format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$" };
  const fields = {
    version: { const: 2 }, prompt: { type: "string", minLength: 1, title: "What should we investigate?" },
    discipline: { type: "string", enum: profile.disciplines, title: "Discipline" },
    genre: { type: "string", enum: profile.genres, title: "Document type" },
    audience: { type: "object", additionalProperties: false, required: ["description", "background"], properties: { description: { type: ["string", "null"], title: "Audience" }, background: { type: ["string", "null"], title: "Audience background" } } },
    language: { type: "string", enum: profile.languages }, length: { type: "string", enum: profile.lengths }, depth: { type: "string", enum: profile.depths },
    format: { const: "markdown", default: "markdown" }, researchQuestion: { ...optionalText, title: "Research question", default: null },
    disciplineDescription: { ...optionalText, title: "Describe another discipline", default: null },
    scope: { type: "object", title: "Geography and period", additionalProperties: false, required: ["geography", "period"],
      default: { geography: null, period: null }, properties: {
        geography: { type: ["object", "null"], additionalProperties: false, required: ["label"], properties: {
          label: { ...text, title: "Place or region" }, identifiers: { type: "array", items: text } } },
        period: { type: ["object", "null"], additionalProperties: false, required: ["label"], dependentRequired: { start: ["end"], end: ["start"] }, properties: {
          label: { ...text, title: "Period" }, start: utcInstant, end: utcInstant } },
      } },
    sourcePreferences: { ...preference(profile.sourcePreferences), title: "Source preferences" },
    methodPreferences: { ...preference(profile.methods), title: "Research methods" },
    artifacts: { type: "array", title: "Supporting deliverables", default: [], maxItems: profile.limits.artifacts, items: {
      type: "object", additionalProperties: false, required: ["id", "kind", "requirement", "description"], properties: {
        id: { ...text, not: { const: "report" }, title: "Deliverable name" }, kind: { ...text, examples: profile.artifactKinds, title: "Deliverable type" },
        requirement, description: { ...text, title: "What should it contain?" },
      } } },
    turnaround: { type: ["object", "null"], title: "Requested turnaround", default: null, additionalProperties: false,
      required: ["requirement", "elapsedSeconds", "startEvent"], properties: { requirement,
        elapsedSeconds: { type: "integer", minimum: 1, title: "Seconds from admission" }, startEvent: { const: "admission", default: "admission" } } },
    revision: { type: "object", title: "Revision", additionalProperties: false, required: ["predecessor", "resolution"], default: { predecessor: null, resolution: null },
      properties: { predecessor: { ...optionalText, title: "Previous commission" }, resolution: { ...optionalText, title: "Changes requested" } } },
  };
  return freeze({ type: "ReportCommissionDescriptor", version: 2, profile: structuredClone(profile),
    schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false,
      required: ["version", "prompt", "discipline", "genre", "audience", "language", "length", "depth"], properties: fields,
      allOf: [{ if: { properties: { discipline: { const: "other" } }, required: ["discipline"] },
        then: { required: ["disciplineDescription"], properties: { disciplineDescription: text } },
        else: { properties: { disciplineDescription: { type: "null" } } } }] },
    operations: { describe: "describe-report-commission", quote: "issue-report-quote", execute: "execute-report", retrieve: "get-report" },
    asynchronous: { protocol: "A2A", version: "1.0", submitConfiguration: { returnImmediately: true }, status: "tasks/get", history: "tasks/list", cancel: "tasks/cancel" } });
}
