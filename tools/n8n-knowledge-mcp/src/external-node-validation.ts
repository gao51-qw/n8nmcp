export type ExternalNodeCandidateValidationInput = {
  source: string | null;
  package_name: string | null;
  node_type: string | null;
  normalized_node_type: string | null;
  display_name: string | null;
  version: string | null;
  candidate_kind: string | null;
  properties_json: string | null;
  credentials_json: string | null;
  operations_json: string | null;
  source_metadata_json: string | null;
  npm_package_name: string | null;
  npm_version: string | null;
  normalized_tool_variant_of: string | null;
};

export type ExternalNodeCandidateValidationResult = {
  passed: boolean;
  errors: string[];
  warnings: string[];
};

const ALLOWED_KINDS = new Set(["community", "tool_variant", "external_official_missing"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseJson(value: string | null, field: string, errors: string[]): unknown {
  if (!isNonEmptyString(value)) return field.endsWith("_metadata_json") ? {} : [];
  try {
    return JSON.parse(value);
  } catch {
    errors.push(`${field} must be valid JSON`);
    return field.endsWith("_metadata_json") ? {} : [];
  }
}

function validateJsonArray(
  value: string | null,
  field: string,
  errors: string[],
  warnings: string[],
): unknown[] {
  const parsed = parseJson(value, field, errors);
  if (!Array.isArray(parsed)) {
    errors.push(`${field} must be a JSON array`);
    return [];
  }
  if (parsed.length === 0) warnings.push(`${field} is empty`);
  return parsed;
}

function validateProperties(properties: unknown[], errors: string[]) {
  properties.forEach((property, index) => {
    if (!property || typeof property !== "object" || Array.isArray(property)) {
      errors.push(`properties_json[${index}] must be an object`);
      return;
    }
    const row = property as Record<string, unknown>;
    if (!isNonEmptyString(row.name)) {
      errors.push(`properties_json[${index}].name must be a non-empty string`);
    }
    if (!isNonEmptyString(row.type)) {
      errors.push(`properties_json[${index}].type must be a non-empty string`);
    }
  });
}

function validateCredentials(credentials: unknown[], errors: string[]) {
  credentials.forEach((credential, index) => {
    if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
      errors.push(`credentials_json[${index}] must be an object`);
      return;
    }
    const row = credential as Record<string, unknown>;
    if (!isNonEmptyString(row.name)) {
      errors.push(`credentials_json[${index}].name must be a non-empty string`);
    }
  });
}

function validateOperations(operations: unknown[], errors: string[], warnings: string[]) {
  operations.forEach((operation, index) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      errors.push(`operations_json[${index}] must be an object`);
      return;
    }
    const row = operation as Record<string, unknown>;
    const hasOperation = isNonEmptyString(row.operation);
    const hasName = isNonEmptyString(row.name);
    const hasResource = isNonEmptyString(row.resource);
    if (!hasOperation && !hasName && !hasResource) {
      warnings.push(`operations_json[${index}] has no operation/name/resource fields`);
    }
  });
}

export function validateExternalNodeCandidate(
  row: ExternalNodeCandidateValidationInput,
  officialNodeTypes: Set<string>,
): ExternalNodeCandidateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of ["source", "package_name", "node_type", "normalized_node_type", "display_name", "version"] as const) {
    if (!isNonEmptyString(row[field])) errors.push(`${field} must be a non-empty string`);
  }

  if (!isNonEmptyString(row.candidate_kind) || !ALLOWED_KINDS.has(row.candidate_kind)) {
    errors.push("candidate_kind must be one of community, tool_variant, external_official_missing");
  }

  const properties = validateJsonArray(row.properties_json, "properties_json", errors, warnings);
  const credentials = validateJsonArray(row.credentials_json, "credentials_json", errors, warnings);
  const operations = validateJsonArray(row.operations_json, "operations_json", errors, warnings);
  const metadata = parseJson(row.source_metadata_json, "source_metadata_json", errors);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    errors.push("source_metadata_json must be a JSON object");
  }

  validateProperties(properties, errors);
  validateCredentials(credentials, errors);
  validateOperations(operations, errors, warnings);

  if (row.candidate_kind === "community") {
    if (!isNonEmptyString(row.npm_package_name)) errors.push("community candidate must have npm_package_name");
    if (!isNonEmptyString(row.npm_version)) errors.push("community candidate must have npm_version");
  }

  if (row.candidate_kind === "tool_variant") {
    if (!isNonEmptyString(row.normalized_tool_variant_of)) {
      errors.push("tool_variant must have normalized_tool_variant_of");
    } else if (!officialNodeTypes.has(row.normalized_tool_variant_of)) {
      errors.push("tool_variant base node is not present in official nodes");
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
