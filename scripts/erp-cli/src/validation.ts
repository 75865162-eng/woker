// Explicit v1 ProductWorkbench field shapes. Unknown nested keys are rejected too.
type Shape = "string" | "number" | "boolean" | readonly string[] | { [key: string]: Shape };
const strings = (...keys: string[]): Record<string, Shape> => Object.fromEntries(keys.map(key => [key, "string"]));
const file = { ...strings("id", "name", "mimeType", "uploadedAt", "downloadUrl"), size: "number", storageType: ["local", "s3", "r2"] } satisfies Shape;
const image = { ...file, ...strings("thumbUrl", "previewUrl", "previewFileId", "originalUrl", "thumbFileId") } satisfies Shape;
const patentAttachment = { ...file, ...strings("thumbUrl", "originalUrl", "thumbFileId", "previewUrl", "previewFileId") } satisfies Shape;
const videoAsset = { ...strings("id", "name", "mimeType", "url", "uploadedAt"), size: "number" } satisfies Shape;
// A one-element object with '*' denotes an array, separate from enum arrays.
const array = (item: Shape): Shape => ({ "*": item });
const event = { ...strings("id", "stageLabel", "actorUserId", "actorName", "assigneeName", "note", "createdAt"), stage: ["selection_pending", "ops_confirming", "design_in_progress", "design_review", "done", "blocked"] } satisfies Shape;
const size = { length: "number", width: "number", height: "number" } satisfies Shape;
const fields: Record<string, Shape> = {
  ...strings("id", "sku", "title", "品名", "chineseName", "englishName", "marketplace", "workspace", "workspaceId", "accountId", "image", "imageFileId", "asin", "developer", "supplierName", "supplierUrl", "specs", "purchaseLeadTime", "createdAt", "keywords", "note", "cancelReason", "hsCode", "selectionOwner", "opsAssignee", "designerAssignee", "workflowStartedAt", "workflowDueAt", "workflowUpdatedAt", "workflowReminderAt", "currentOwner"),
  purchasePrice: "number", productWeightG: "number", packageWeightG: "number", revision: "number", isOverdue: "boolean",
  source: ["dashboard"], status: ["pending", "developing", "ops_review", "design_in_progress", "listing_confirming", "listed", "canceled", "delisted", "patent_risk"],
  workflowStage: event.stage, workflowHistory: array(event), productSizeCm: size, packageSizeCm: size,
  ...Object.fromEntries(["images", "competitorAsins", "opsAssignees", "designerAssignees", "editableBy", "viewableBy", "imagePaths"].map(key => [key, array("string")])),
  imageAssets: array(image), conclusionExcelFile: file,
  patentInformation: {
    searchChannels: array({ ...strings("id", "name", "note"), keywords: array("string"), imageAssets: array(patentAttachment) }),
    patents: array({ ...strings("id", "patentNumber", "patentType", "relatedUrl", "note"), attachments: array(patentAttachment) }),
  },
  operationsProgress: {
    orderQuantity: "number", forecastMonthlySales: "number", forecastPrice: "number", ...strings("shipDate", "updatedAt", "updatedByUserId", "updatedBy"),
    history: array(strings("id", "changedAt", "changedByUserId", "changedBy", "summary")),
    stages: array({
      ...strings("owner", "plannedAt", "completedAt", "note", "updatedAt"),
      id: ["selection_data", "backend_upload", "order", "image_request", "copywriting", "design", "final_sample_confirmation", "shipping", "keyword_research", "listing"],
      status: ["not_started", "in_progress", "completed", "blocked"],
      evidenceFile: { ...strings("fileId", "fileName", "fileType", "downloadUrl", "thumbUrl", "fileDataUrl", "uploadedAt"), fileSize: "number" },
    }),
  },
  videoPlan: {
    ...strings("propsSceneRequirements", "videoType", "styleConfirmation", "backgroundMusic", "productionNotes"),
    ...Object.fromEntries(["propsSceneRequirementImages", "videoTypeImages", "styleConfirmationImages", "backgroundMusicFiles"].map(key => [key, array(videoAsset)])),
    references: array(strings("label", "url")),
    shots: array({ ...strings("id", "sellingPoint", "sceneContent", "shotType", "cameraMove", "duration", "angle", "effectReference", "copyEnglish"), shotNo: "number", images: array(videoAsset) }),
    props: array({ ...strings("id", "imageUrl", "spec", "purchasePlatform", "purchaseLink"), quantity: "number", unitPrice: "number", totalPrice: "number", images: array(videoAsset) }),
  },
};

const optionalNestedKeys = new Set(["actorUserId", "actorName", "assigneeName", "note", "updatedByUserId", "changedByUserId", "evidenceFile", "fileId", "fileSize", "downloadUrl", "thumbUrl", "fileDataUrl", "previewUrl", "previewFileId", "thumbFileId"]);
function requiredKeys(shape: Record<string, Shape>) {
  if (shape === size) return []; // normalized to zero for omitted dimensions
  return Object.keys(shape).filter(key => !optionalNestedKeys.has(key) && !(shape === patentAttachment && key === "originalUrl"));
}

function validate(value: unknown, shape: Shape, path: string, errors: string[]) {
  if (typeof shape === "string") {
    if (typeof value !== shape || (shape === "number" && (!Number.isFinite(value) || Number(value) < 0))) errors.push(`${path} must be ${shape === "number" ? "a finite non-negative number" : `a ${shape}`}`);
    return;
  }
  if (Array.isArray(shape)) {
    if (!shape.includes(value as string)) errors.push(`${path} has an unsupported value`);
    return;
  }
  const objectShape = shape as Record<string, Shape>;
  if (objectShape["*"]) {
    if (!Array.isArray(value)) errors.push(`${path} must be an array`);
    else value.forEach((item, index) => validate(item, objectShape["*"], `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push(`${path} must be an object`); return; }
  for (const key of requiredKeys(objectShape)) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(objectShape, key)) errors.push(`unknown field: ${path}.${key}`);
    else validate(item, objectShape[key], `${path}.${key}`, errors);
  }
}

function jsonShape(shape: Shape): Record<string, unknown> {
  if (typeof shape === "string") return { type: shape, ...(shape === "number" ? { minimum: 0 } : {}) };
  if (Array.isArray(shape)) return { type: "string", enum: shape };
  const objectShape = shape as Record<string, Shape>;
  if (objectShape["*"]) return { type: "array", items: jsonShape(objectShape["*"]) };
  return { type: "object", additionalProperties: false, properties: Object.fromEntries(Object.entries(objectShape).map(([key, value]) => [key, jsonShape(value)])), required: requiredKeys(objectShape) };
}

export const draftJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "ERP Product Upsert v1",
  type: "object",
  additionalProperties: false,
  properties: {
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, jsonShape(value)])),
    version: { const: 1 }, meta: { type: "object" },
    revision: { type: "integer", minimum: 1 },
  },
  required: ["version", "sku", "marketplace"],
  allOf: [
    { anyOf: [{ required: ["title"] }, { required: ["品名"] }, { required: ["chineseName"] }] },
    { anyOf: [{ required: ["workspace"] }, { required: ["workspaceId"] }] },
  ],
};

export function validateFields(raw: Record<string, unknown>, errors: string[]) {
  for (const [key, value] of Object.entries(raw)) if (Object.hasOwn(fields, key)) validate(value, fields[key], key, errors);
  if (raw.revision !== undefined && (!Number.isInteger(raw.revision) || Number(raw.revision) < 1)) errors.push("revision must be a positive integer");
  const names = [raw.title, raw["品名"], raw.chineseName].filter(value => value !== undefined);
  if (names.some(value => typeof value === "string" && value.trim() !== String(names[0]).trim())) errors.push("title, 品名 and chineseName must match when supplied together");
}
