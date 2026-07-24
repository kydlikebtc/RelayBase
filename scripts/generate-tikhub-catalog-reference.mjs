#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIKHUB_DATA_TYPES as DATA_TYPES,
  TIKHUB_SURFACES as SURFACES,
  tikhubDataTypeFor as dataTypeFor,
  tikhubSurfaceForPath as surfaceFor,
} from "../shared/tikhub-taxonomy.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

const DEFAULT_INPUT = "/tmp/tikhub-openapi.json";
const DEFAULT_OUTPUT = resolve(
  repositoryRoot,
  "data/tikhub-catalog-reference.json",
);
const GENERATED_AT = "2026-07-23";
const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
];
const LIMITS = Object.freeze({
  maxSnapshotBytes: 16 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
  maxStructuralDepth: 64,
  maxReferenceDepth: 16,
  maxReferencesPerOperation: 512,
  maxNodesPerOperation: 100_000,
  maxStringBytes: 256 * 1024,
  maxExpandedInputBytesPerOperation: 1024 * 1024,
  maxExpandedInputBytesTotal: 64 * 1024 * 1024,
  maxReferenceLength: 512,
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function compactText(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : null;
}

function canonicalInputField(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function isSensitiveInputField(value) {
  const canonical = canonicalInputField(value);
  const compact = canonical.replaceAll("_", "");
  const allowedTokens = new Set([
    "pagination_token",
    "page_token",
    "cursor_token",
    "continuation_token",
    "next_token",
  ]);
  if (
    allowedTokens.has(canonical) ||
    [...allowedTokens].some(
      (field) => field.replaceAll("_", "") === compact,
    )
  ) {
    return false;
  }
  const sensitive = new Set([
    "cookie",
    "cookies",
    "session",
    "session_id",
    "access_token",
    "refresh_token",
    "auth_token",
    "auth",
    "authorization",
    "password",
    "passwd",
    "secret",
    "credential",
    "credentials",
    "csrf",
    "csrf_token",
    "api_key",
    "private_key",
    "proxy",
    "proxy_url",
    "proxy_username",
    "proxy_password",
    "ms_token",
    "device_id",
  ]);
  if (
    sensitive.has(canonical) ||
    [...sensitive].some(
      (field) => field.replaceAll("_", "") === compact,
    )
  ) {
    return true;
  }
  const segments = canonical.split("_").filter(Boolean);
  return (
    segments.some((segment) =>
      new Set([
        "cookie",
        "cookies",
        "session",
        "auth",
        "password",
        "passwd",
        "secret",
        "credential",
        "credentials",
        "csrf",
        "proxy",
        "authorization",
        "device",
      ]).has(segment),
    ) ||
    /(?:^|_)(?:api|private)_key$/.test(canonical) ||
    /(?:^|_)(?:access|refresh|auth|ms|device)_token$/.test(canonical) ||
    /(?:^|_)device_id$/.test(canonical) ||
    segments.includes("token")
  );
}

function redactedInputValue(fieldName) {
  const canonical = fieldName ? canonicalInputField(fieldName) : "";
  return canonical
    ? `YOUR_${canonical.toUpperCase().slice(0, 48)}`
    : "[REDACTED]";
}

function looksSensitiveExample(value) {
  return (
    typeof value === "string" &&
    (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value) ||
      /(?:Bearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|rb_live_[A-Za-z0-9_-]{16,})/i.test(
        value,
      ) ||
      /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(
        value,
      ))
  );
}

function redactSensitiveText(value) {
  if (typeof value !== "string") return value;
  const placeholder = (field) => redactedInputValue(field);
  return value
    .replace(
      /(["'])([A-Za-z][A-Za-z0-9_.\-/]{0,80})\1(\s*[:=]\s*)(["'])([^\r\n]*?)\4/g,
      (match, keyQuote, field, separator, valueQuote) =>
        isSensitiveInputField(field)
          ? `${keyQuote}${field}${keyQuote}${separator}${valueQuote}${placeholder(field)}${valueQuote}`
          : match,
    )
    .replace(
      /(^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9_.\-/]{0,80})(\s*[:=]\s*)(["'])([^\r\n]*?)\4/gm,
      (match, prefix, field, separator, quote) =>
        isSensitiveInputField(field)
          ? `${prefix}${field}${separator}${quote}${placeholder(field)}${quote}`
          : match,
    )
    .replace(
      /(^|[^A-Za-z0-9_])(["']?)([A-Za-z][A-Za-z0-9_.\-/]{0,80})\2(\s*[:=]\s*)(?!["'])([^\r\n]+)/gm,
      (match, prefix, keyQuote, field, separator) =>
        isSensitiveInputField(field)
          ? `${prefix}${keyQuote}${field}${keyQuote}${separator}${placeholder(field)}`
          : match,
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
      "[REDACTED_PRIVATE_KEY]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/gi, "Bearer [REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED_JWT]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|rb_live_[A-Za-z0-9_-]{16,})\b/gi,
      "[REDACTED_TOKEN]",
    );
}

function stripUpstreamExampleBlocks(value) {
  if (typeof value !== "string") return value;
  const output = [];
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  let skippedHeadingLevel = null;
  let insideFence = false;
  let insertedNotice = false;
  const insertNotice = () => {
    if (!insertedNotice) {
      output.push(
        "上游原始示例已移除；请使用 RelayBase 生成的安全调用示例。",
      );
      insertedNotice = true;
    }
  };

  for (const line of lines) {
    const heading = line.match(/^\s{0,4}(#{1,6})\s*(.*?)\s*#*\s*$/);
    if (skippedHeadingLevel != null) {
      if (heading && heading[1].length <= skippedHeadingLevel) {
        skippedHeadingLevel = null;
      } else {
        continue;
      }
    }
    if (
      heading &&
      /(?:示例|例子|\bexamples?\b)/iu.test(heading[2])
    ) {
      insertNotice();
      skippedHeadingLevel = heading[1].length;
      continue;
    }
    if (/^\s*(?:```|~~~)/.test(line)) {
      if (!insideFence) insertNotice();
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    output.push(line);
  }
  return compactText(output.join("\n"));
}

function publicDescription(value) {
  return redactSensitiveText(stripUpstreamExampleBlocks(compactText(value)));
}

function redactExampleAgainstSchema(
  value,
  schema,
  fieldName,
  state,
  depth = 0,
) {
  if (
    (fieldName && isSensitiveInputField(fieldName)) ||
    looksSensitiveExample(value)
  ) {
    state.count += 1;
    return redactedInputValue(fieldName);
  }
  if (depth > 32) return "[REDACTED]";
  if (Array.isArray(value)) {
    const itemSchema =
      isRecord(schema) && isRecord(schema.items) ? schema.items : null;
    return value.map((item) =>
      redactExampleAgainstSchema(
        item,
        itemSchema,
        fieldName,
        state,
        depth + 1,
      ),
    );
  }
  if (!isRecord(value)) return value;
  const properties =
    isRecord(schema) && isRecord(schema.properties)
      ? schema.properties
      : null;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      redactExampleAgainstSchema(
        child,
        properties?.[key],
        key,
        state,
        depth + 1,
      ),
    ]),
  );
}

function redactUnknownExample(
  value,
  fieldName,
  state,
  depth = 0,
) {
  if (
    (fieldName && isSensitiveInputField(fieldName)) ||
    looksSensitiveExample(value)
  ) {
    state.count += 1;
    return redactedInputValue(fieldName);
  }
  if (depth > 32) return "[REDACTED]";
  if (Array.isArray(value)) {
    return value.map((item) =>
      redactUnknownExample(item, fieldName, state, depth + 1),
    );
  }
  if (typeof value === "string") return redactSensitiveText(value);
  if (!isRecord(value)) return value;
  const exampleObject =
    hasOwn(value, "value") &&
    Object.keys(value).every((key) =>
      ["summary", "description", "value", "externalValue"].includes(key),
    );
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (
        exampleObject &&
        (key === "summary" ||
          key === "description" ||
          key === "externalValue")
      ) {
        return [
          key,
          typeof child === "string"
            ? redactSensitiveText(child)
            : "[REDACTED_INVALID_EXAMPLE_METADATA]",
        ];
      }
      return [
        key,
        redactUnknownExample(
          child,
          exampleObject && key === "value" ? fieldName : key,
          state,
          depth + 1,
        ),
      ];
    }),
  );
}

function redactInputMetadata(value, state, fieldName, depth = 0) {
  if (depth > 64) return value;
  if (Array.isArray(value)) {
    return value.map((item) =>
      redactInputMetadata(item, state, fieldName, depth + 1),
    );
  }
  if (typeof value === "string") return redactSensitiveText(value);
  if (!isRecord(value)) return value;
  const declaredName =
    typeof value.name === "string" && isSensitiveInputField(value.name)
      ? value.name
      : fieldName;
  const schema = isRecord(value.schema) ? value.schema : null;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === "description" && typeof child === "string") {
        return [key, publicDescription(child)];
      }
      if ((key === "example" || key === "default") && schema) {
        return [
          key,
          redactExampleAgainstSchema(
            child,
            schema,
            declaredName,
            state,
          ),
        ];
      }
      if (
        key === "example" ||
        key === "examples" ||
        key === "default"
      ) {
        return [
          key,
          redactUnknownExample(child, declaredName, state),
        ];
      }
      if (key === "properties" && isRecord(child)) {
        return [
          key,
          Object.fromEntries(
            Object.entries(child).map(([propertyName, propertySchema]) => [
              propertyName,
              redactInputMetadata(
                propertySchema,
                state,
                propertyName,
                depth + 1,
              ),
            ]),
          ),
        ];
      }
      return [
        key,
        redactInputMetadata(child, state, declaredName, depth + 1),
      ];
    }),
  );
}

function normalizeOperationTags(value, identity) {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    !value.every(
      (tag) =>
        typeof tag === "string" &&
        tag.length > 0 &&
        tag.length <= 160 &&
        tag.trim() === tag &&
        !/[?&#=\u0000-\u001F\u007F]/.test(tag) &&
        redactSensitiveText(tag) === tag,
    )
  ) {
    throw new Error(`${identity} has invalid or sensitive tags metadata.`);
  }
  return [...new Set(value)].sort(compareText);
}

function normalizeOperationId(value, identity) {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error(`${identity} operationId must be a string or null.`);
  }
  const trimmed = value.trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > 500 ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    throw new Error(`${identity} has invalid operationId metadata.`);
  }
  const redacted = redactSensitiveText(trimmed);
  if (
    typeof redacted !== "string" ||
    redacted.length < 1 ||
    redacted.length > 500 ||
    redacted.trim() !== redacted ||
    /[\u0000-\u001F\u007F]/.test(redacted)
  ) {
    throw new Error(`${identity} has invalid redacted operationId metadata.`);
  }
  return redacted;
}

function increment(counter, key) {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function sortedCountObject(counter) {
  return Object.fromEntries([...counter.entries()].sort(([left], [right]) =>
    compareText(left, right),
  ));
}

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item));
  }
  if (isRecord(value)) {
    const clone = Object.create(null);
    for (const key of Object.keys(value).sort(compareText)) {
      clone[key] = stableClone(value[key]);
    }
    return clone;
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableClone(value), null, 2)}\n`;
}

function parseArguments(arguments_) {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    check: false,
    validateOutput: false,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--input" || argument === "--output") {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a path.`);
      }
      options[argument.slice(2)] = resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--validate-output") {
      options.validateOutput = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/generate-tikhub-catalog-reference.mjs [options]",
          "",
          `  --input <path>   OpenAPI snapshot (default: ${DEFAULT_INPUT})`,
          `  --output <path>  Generated catalog (default: ${DEFAULT_OUTPUT})`,
          "  --check          Verify that the output is already up to date",
          "  --validate-output Validate the committed artifact without a source snapshot",
          "  --help           Show this help",
          "",
        ].join("\n"),
      );
      return null;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.check && options.validateOutput) {
    throw new Error("--check and --validate-output are mutually exclusive.");
  }
  return options;
}

function decodeJsonPointerSegment(segment) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new Error(`Invalid percent encoding in local reference: ${segment}`);
  }
  return decoded.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveLocalReference(root, reference) {
  if (
    typeof reference !== "string" ||
    !reference.startsWith("#/components/") ||
    reference.length > LIMITS.maxReferenceLength
  ) {
    throw new Error(
      `Only bounded local #/components references are allowed: ${String(reference)}`,
    );
  }

  const segments = reference
    .slice(2)
    .split("/")
    .map((segment) => decodeJsonPointerSegment(segment));
  if (
    segments.length < 2 ||
    segments.length > 8 ||
    segments.some(
      (segment) =>
        segment === "__proto__" ||
        segment === "prototype" ||
        segment === "constructor",
    )
  ) {
    throw new Error(`Unsafe or over-deep local reference: ${reference}`);
  }

  let current = root;
  for (const segment of segments) {
    if (!isRecord(current) && !Array.isArray(current)) {
      throw new Error(`Local reference does not resolve to a value: ${reference}`);
    }
    if (!hasOwn(current, segment)) {
      throw new Error(`Local reference target is missing: ${reference}`);
    }
    current = current[segment];
  }
  return current;
}

function expandInputMetadata(root, input, operationIdentity) {
  const state = {
    nodes: 0,
    references: 0,
  };

  function expand(value, structuralDepth, referenceDepth, referenceStack) {
    state.nodes += 1;
    if (state.nodes > LIMITS.maxNodesPerOperation) {
      throw new Error(
        `${operationIdentity} exceeds the per-operation node limit.`,
      );
    }
    if (structuralDepth > LIMITS.maxStructuralDepth) {
      throw new Error(
        `${operationIdentity} exceeds the structural depth limit.`,
      );
    }

    if (typeof value === "string") {
      if (byteLength(value) > LIMITS.maxStringBytes) {
        throw new Error(`${operationIdentity} contains an over-sized string.`);
      }
      return value;
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) =>
        expand(item, structuralDepth + 1, referenceDepth, referenceStack),
      );
    }
    if (!isRecord(value)) {
      throw new Error(
        `${operationIdentity} contains unsupported input metadata.`,
      );
    }

    if (hasOwn(value, "$ref")) {
      const reference = value.$ref;
      state.references += 1;
      if (state.references > LIMITS.maxReferencesPerOperation) {
        throw new Error(
          `${operationIdentity} exceeds the local reference count limit.`,
        );
      }
      if (referenceDepth >= LIMITS.maxReferenceDepth) {
        throw new Error(
          `${operationIdentity} exceeds the local reference depth limit.`,
        );
      }
      if (referenceStack.includes(reference)) {
        throw new Error(
          `${operationIdentity} contains a circular local reference: ${reference}`,
        );
      }

      const target = resolveLocalReference(root, reference);
      const expandedTarget = expand(
        target,
        structuralDepth + 1,
        referenceDepth + 1,
        [...referenceStack, reference],
      );
      if (!isRecord(expandedTarget)) {
        throw new Error(
          `${operationIdentity} local reference must resolve to an object: ${reference}`,
        );
      }
      if (hasOwn(expandedTarget, "x-relaybase-source-ref")) {
        throw new Error(
          `${operationIdentity} reference target uses a reserved extension.`,
        );
      }

      const expanded = Object.assign(Object.create(null), expandedTarget);
      expanded["x-relaybase-source-ref"] = reference;
      for (const key of Object.keys(value).sort(compareText)) {
        if (key === "$ref") continue;
        expanded[key] = expand(
          value[key],
          structuralDepth + 1,
          referenceDepth,
          referenceStack,
        );
      }
      return expanded;
    }

    const expanded = Object.create(null);
    for (const key of Object.keys(value).sort(compareText)) {
      expanded[key] = expand(
        value[key],
        structuralDepth + 1,
        referenceDepth,
        referenceStack,
      );
    }
    return expanded;
  }

  const expanded = expand(input, 0, 0, []);
  const bytes = byteLength(JSON.stringify(expanded));
  if (bytes > LIMITS.maxExpandedInputBytesPerOperation) {
    throw new Error(
      `${operationIdentity} exceeds the expanded input metadata size limit.`,
    );
  }

  return {
    expanded,
    bytes,
    references: state.references,
    nodes: state.nodes,
  };
}

function parameterIdentity(parameter, fallbackIndex) {
  if (
    isRecord(parameter) &&
    typeof parameter.in === "string" &&
    typeof parameter.name === "string"
  ) {
    return `${parameter.in}\u0000${parameter.name}`;
  }
  return `__anonymous__\u0000${fallbackIndex}\u0000${JSON.stringify(parameter)}`;
}

function mergeParameters(pathParameters, operationParameters) {
  const merged = [];
  const positions = new Map();

  for (const [index, parameter] of pathParameters.entries()) {
    const identity = parameterIdentity(parameter, `path-${index}`);
    if (positions.has(identity)) {
      merged[positions.get(identity)] = parameter;
    } else {
      positions.set(identity, merged.length);
      merged.push(parameter);
    }
  }
  for (const [index, parameter] of operationParameters.entries()) {
    const identity = parameterIdentity(parameter, `operation-${index}`);
    if (positions.has(identity)) {
      merged[positions.get(identity)] = parameter;
    } else {
      positions.set(identity, merged.length);
      merged.push(parameter);
    }
  }

  return merged;
}

function relayBasePath(sourcePath) {
  if (!sourcePath.startsWith("/api/")) {
    throw new Error(`TikHub path does not start with /api/: ${sourcePath}`);
  }
  return sourcePath.slice(4);
}

function platformForPath(sourcePath) {
  const segments = sourcePath.split("/").filter(Boolean);
  if (
    segments.length < 4 ||
    segments[0] !== "api" ||
    !/^v\d+$/i.test(segments[1])
  ) {
    throw new Error(`TikHub path has no stable platform segment: ${sourcePath}`);
  }
  return segments[2].toLowerCase();
}

function responseStatusCompare(left, right) {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : Number.POSITIVE_INFINITY;
  const rightNumber = /^\d+$/.test(right)
    ? Number(right)
    : Number.POSITIVE_INFINITY;
  return leftNumber - rightNumber || compareText(left, right);
}

function topLevelResponseSchemaReference(response, identity) {
  if (!isRecord(response) || !isRecord(response.content)) return null;
  const references = new Set();
  for (const contentType of Object.keys(response.content).sort(compareText)) {
    const media = response.content[contentType];
    if (
      isRecord(media) &&
      isRecord(media.schema) &&
      typeof media.schema.$ref === "string"
    ) {
      references.add(media.schema.$ref);
    }
  }
  if (references.size > 1) {
    throw new Error(
      `${identity} response has multiple top-level schema references.`,
    );
  }
  return references.values().next().value ?? null;
}

function extractResponses(operation, identity) {
  if (operation.responses == null) return [];
  if (!isRecord(operation.responses)) {
    throw new Error(`${identity} responses must be an object.`);
  }

  return Object.keys(operation.responses)
    .sort(responseStatusCompare)
    .map((status) => {
      const response = operation.responses[status];
      if (!isRecord(response)) {
        throw new Error(`${identity} response ${status} must be an object.`);
      }
      return {
        status,
        description: publicDescription(response.description),
        schemaRef: topLevelResponseSchemaReference(
          response,
          `${identity} response ${status}`,
        ),
      };
    });
}

function verifyPublicJsonMetadata(value, identity) {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > 5_000 || current.depth > 20) {
      throw new Error(`Public input metadata is too complex: ${identity}.`);
    }
    if (typeof current.value === "string") {
      if (
        current.value.length > 100_000 ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(
          current.value,
        )
      ) {
        throw new Error(`Public input metadata has unsafe text: ${identity}.`);
      }
      continue;
    }
    if (
      current.value === null ||
      typeof current.value === "boolean"
    ) {
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) {
        throw new Error(`Public input metadata has a non-finite number: ${identity}.`);
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > 1_000) {
        throw new Error(`Public input metadata has an oversized array: ${identity}.`);
      }
      for (const child of current.value) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    if (!isRecord(current.value)) {
      throw new Error(`Public input metadata has an invalid value: ${identity}.`);
    }
    const entries = Object.entries(current.value);
    if (entries.length > 1_000) {
      throw new Error(`Public input metadata has an oversized object: ${identity}.`);
    }
    for (const [key, child] of entries) {
      if (
        key.length > 300 ||
        key === "__proto__" ||
        key === "prototype" ||
        key === "constructor"
      ) {
        throw new Error(`Public input metadata has an unsafe key: ${identity}.`);
      }
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function verifyCatalog(catalog, discoveredOperationCount) {
  if (
    !isRecord(catalog) ||
    catalog.schemaVersion !== 1 ||
    !isRecord(catalog.source) ||
    !isRecord(catalog.stats) ||
    !Array.isArray(catalog.operations) ||
    catalog.operations.length < 1 ||
    catalog.operations.length > 5_000 ||
    typeof catalog.generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(catalog.generatedAt)
  ) {
    throw new Error("Generated catalog has an invalid top-level shape.");
  }
  if (
    typeof catalog.source.snapshotSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(catalog.source.snapshotSha256) ||
    typeof catalog.source.version !== "string" ||
    catalog.source.version.length < 1 ||
    catalog.source.version.length > 80 ||
    !Number.isSafeInteger(catalog.source.snapshotBytes) ||
    catalog.source.snapshotBytes < 1 ||
    catalog.source.snapshotBytes > LIMITS.maxSnapshotBytes
  ) {
    throw new Error("Generated catalog source provenance is invalid.");
  }
  if (catalog.operations.length !== discoveredOperationCount) {
    throw new Error(
      `Operation coverage mismatch: ${catalog.operations.length}/${discoveredOperationCount}.`,
    );
  }

  const identities = new Set();
  const paths = new Set();
  const methodCounts = new Map();
  const platformCounts = new Map();
  const surfaceCounts = new Map();
  const tagCounts = new Map();
  const dataTypeCounts = new Map();
  for (const operation of catalog.operations) {
    if (
      !isRecord(operation) ||
      (operation.method !== "GET" && operation.method !== "POST") ||
      typeof operation.path !== "string" ||
      !/^\/v1\/[A-Za-z0-9/_-]+$/.test(operation.path) ||
      operation.path.includes("..") ||
      operation.path.includes("//") ||
      operation.path.endsWith("/") ||
      typeof operation.platform !== "string" ||
      operation.platform !== operation.path.split("/")[2] ||
      !Array.isArray(operation.tags) ||
      !Array.isArray(operation.parameters) ||
      operation.parameters.length > 200 ||
      (operation.requestBody !== null &&
        !isRecord(operation.requestBody)) ||
      !Array.isArray(operation.responses) ||
      operation.responses.length > 100 ||
      (operation.summary !== null &&
        (typeof operation.summary !== "string" ||
          operation.summary.length > 1_000)) ||
      (operation.description !== null &&
        (typeof operation.description !== "string" ||
          operation.description.length > 20_000)) ||
      (operation.operationId !== null &&
        typeof operation.operationId !== "string")
    ) {
      throw new Error("Generated catalog contains an invalid operation.");
    }
    const identity = `${operation.method} ${operation.path}`;
    let normalizedTags;
    let normalizedOperationId;
    try {
      normalizedTags = normalizeOperationTags(operation.tags, identity);
      normalizedOperationId = normalizeOperationId(
        operation.operationId,
        identity,
      );
    } catch (error) {
      throw new Error(
        `Generated catalog contains invalid taxonomy metadata: ${error.message}`,
      );
    }
    if (
      JSON.stringify(normalizedTags) !== JSON.stringify(operation.tags) ||
      normalizedOperationId !== operation.operationId
    ) {
      throw new Error(
        `Generated catalog taxonomy is not canonical for ${identity}.`,
      );
    }
    if (identities.has(identity)) {
      throw new Error(`Duplicate operation identity: ${identity}`);
    }
    identities.add(identity);
    paths.add(operation.path);
    if (!SURFACES.includes(operation.surface)) {
      throw new Error(`Unknown surface for ${identity}: ${operation.surface}`);
    }
    if (!DATA_TYPES.includes(operation.dataType)) {
      throw new Error(`Unknown dataType for ${identity}: ${operation.dataType}`);
    }
    increment(methodCounts, operation.method);
    increment(platformCounts, operation.platform);
    increment(surfaceCounts, operation.surface);
    increment(dataTypeCounts, operation.dataType);
    for (const tag of operation.tags) increment(tagCounts, tag);
    for (const response of operation.responses) {
      if (
        !isRecord(response) ||
        typeof response.status !== "string" ||
        response.status.length > 20 ||
        (response.description !== null &&
          (typeof response.description !== "string" ||
            response.description.length > 20_000)) ||
        (response.schemaRef !== null &&
          (typeof response.schemaRef !== "string" ||
            !response.schemaRef.startsWith("#/components/") ||
            response.schemaRef.length > LIMITS.maxReferenceLength))
      ) {
        throw new Error(`Invalid response metadata in ${identity}.`);
      }
    }
    for (const [field, text] of [
      ["summary", operation.summary],
      ["description", operation.description],
      ["operationId", operation.operationId],
    ]) {
      if (
        typeof text === "string" &&
        redactSensitiveText(text) !== text
      ) {
        throw new Error(
          `Sensitive credential text remains in ${identity} ${field}.`,
        );
      }
    }
    if (
      typeof operation.description === "string" &&
      publicDescription(operation.description) !== operation.description
    ) {
      throw new Error(
        `Unsafe upstream example text remains in ${identity} description.`,
      );
    }
    for (const response of operation.responses) {
      if (
        typeof response.description === "string" &&
        publicDescription(response.description) !== response.description
      ) {
        throw new Error(
          `Sensitive response text remains in ${identity} response ${response.status}.`,
        );
      }
    }
    const inputJson = JSON.stringify({
      parameters: operation.parameters,
      requestBody: operation.requestBody,
    });
    verifyPublicJsonMetadata(
      {
        parameters: operation.parameters,
        requestBody: operation.requestBody,
      },
      identity,
    );
    if (inputJson.includes('"$ref"')) {
      throw new Error(`Unexpanded input reference remains in ${identity}.`);
    }
    const redactionAudit = { count: 0 };
    const safelyRedactedInput = redactInputMetadata(
      {
        parameters: operation.parameters,
        requestBody: operation.requestBody,
      },
      redactionAudit,
    );
    if (JSON.stringify(safelyRedactedInput) !== inputJson) {
      throw new Error(
        `Sensitive example/default remains in generated input metadata: ${identity}.`,
      );
    }
  }

  const actualCounts = {
    methodCounts: sortedCountObject(methodCounts),
    platformCounts: sortedCountObject(platformCounts),
    surfaceCounts: sortedCountObject(surfaceCounts),
    tagCounts: sortedCountObject(tagCounts),
    dataTypeCounts: sortedCountObject(dataTypeCounts),
  };
  for (const [name, actual] of Object.entries(actualCounts)) {
    if (JSON.stringify(catalog.stats[name]) !== JSON.stringify(actual)) {
      throw new Error(`Generated catalog ${name} do not match operations.`);
    }
  }
  if (
    catalog.stats.operationCount !== catalog.operations.length ||
    catalog.stats.pathCount !== paths.size ||
    paths.size !== catalog.operations.length ||
    catalog.stats.platformCount !== platformCounts.size ||
    catalog.stats.tagCount !== tagCounts.size ||
    tagCounts.size > 500 ||
    catalog.stats.dataTypeCount !== dataTypeCounts.size
  ) {
    throw new Error("Generated catalog summary counts do not match operations.");
  }
  const methodTotal = Object.values(catalog.stats.methodCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const platformTotal = Object.values(catalog.stats.platformCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const surfaceTotal = Object.values(catalog.stats.surfaceCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const dataTypeTotal = Object.values(catalog.stats.dataTypeCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  for (const [label, count] of [
    ["method", methodTotal],
    ["platform", platformTotal],
    ["surface", surfaceTotal],
    ["dataType", dataTypeTotal],
  ]) {
    if (count !== catalog.stats.operationCount) {
      throw new Error(
        `${label} statistics do not sum to ${catalog.stats.operationCount}.`,
      );
    }
  }
}

export function buildCatalog(root, snapshotSha256, snapshotBytes) {
  if (!isRecord(root) || !isRecord(root.paths)) {
    throw new Error("The OpenAPI snapshot must contain a paths object.");
  }

  const operations = [];
  const methodCounts = new Map();
  const platformCounts = new Map();
  const surfaceCounts = new Map();
  const tagCounts = new Map();
  const dataTypeCounts = new Map();
  let expandedInputBytes = 0;
  let expandedInputReferences = 0;
  let expandedInputNodes = 0;
  let redactedInputValues = 0;
  let discoveredOperationCount = 0;

  for (const sourcePath of Object.keys(root.paths).sort(compareText)) {
    const pathItem = root.paths[sourcePath];
    if (!isRecord(pathItem)) {
      throw new Error(`OpenAPI path item must be an object: ${sourcePath}`);
    }
    const rawPathParameters = Array.isArray(pathItem.parameters)
      ? pathItem.parameters
      : [];

    for (const method of HTTP_METHODS) {
      if (!hasOwn(pathItem, method)) continue;
      const operation = pathItem[method];
      if (!isRecord(operation)) {
        throw new Error(`OpenAPI operation must be an object: ${method} ${sourcePath}`);
      }
      discoveredOperationCount += 1;

      const upperMethod = method.toUpperCase();
      const path = relayBasePath(sourcePath);
      const identity = `${upperMethod} ${path}`;
      const tags = normalizeOperationTags(operation.tags, identity);
      const platform = platformForPath(sourcePath);
      const surface = surfaceFor(sourcePath, tags);
      const operationId = normalizeOperationId(
        operation.operationId,
        identity,
      );
      const dataType = dataTypeFor({
        platform,
        sourcePath,
        tags,
        operationId,
      });
      const rawOperationParameters = Array.isArray(operation.parameters)
        ? operation.parameters
        : [];
      const expansion = expandInputMetadata(
        root,
        {
          pathParameters: rawPathParameters,
          operationParameters: rawOperationParameters,
          requestBody: isRecord(operation.requestBody)
            ? operation.requestBody
            : null,
        },
        identity,
      );
      expandedInputBytes += expansion.bytes;
      expandedInputReferences += expansion.references;
      expandedInputNodes += expansion.nodes;
      if (expandedInputBytes > LIMITS.maxExpandedInputBytesTotal) {
        throw new Error("Expanded input metadata exceeds the total size limit.");
      }

      const redactionState = { count: 0 };
      const parameters = redactInputMetadata(
        mergeParameters(
          expansion.expanded.pathParameters,
          expansion.expanded.operationParameters,
        ),
        redactionState,
      );
      const requestBody = redactInputMetadata(
        expansion.expanded.requestBody,
        redactionState,
      );
      redactedInputValues += redactionState.count;
      operations.push({
        method: upperMethod,
        path,
        platform,
        surface,
        tags,
        dataType,
        summary: redactSensitiveText(compactText(operation.summary)),
        description: publicDescription(operation.description),
        operationId,
        parameters,
        requestBody,
        responses: extractResponses(operation, identity),
      });

      increment(methodCounts, upperMethod);
      increment(platformCounts, platform);
      increment(surfaceCounts, surface);
      increment(dataTypeCounts, dataType);
      for (const tag of tags) increment(tagCounts, tag);
    }
  }

  operations.sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      HTTP_METHODS.indexOf(left.method.toLowerCase()) -
        HTTP_METHODS.indexOf(right.method.toLowerCase()),
  );

  const catalog = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    source: {
      name: "TikHub OpenAPI",
      snapshot: "tikhub-openapi.json",
      title: compactText(root.info?.title),
      openapiVersion: compactText(root.openapi),
      version: compactText(root.info?.version),
      snapshotSha256,
      snapshotBytes,
    },
    limits: LIMITS,
    taxonomy: {
      surfaces: SURFACES,
      dataTypes: DATA_TYPES,
    },
    stats: {
      pathCount: Object.keys(root.paths).length,
      operationCount: operations.length,
      methodCounts: sortedCountObject(methodCounts),
      platformCount: platformCounts.size,
      platformCounts: sortedCountObject(platformCounts),
      surfaceCounts: sortedCountObject(surfaceCounts),
      tagCount: tagCounts.size,
      tagCounts: sortedCountObject(tagCounts),
      dataTypeCount: dataTypeCounts.size,
      dataTypeCounts: sortedCountObject(dataTypeCounts),
      expandedInputReferences,
      expandedInputNodes,
      expandedInputBytes,
      redactedInputValues,
    },
    operations,
  };
  verifyCatalog(catalog, discoveredOperationCount);
  return catalog;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options === null) return;

  if (options.validateOutput) {
    const existing = await readFile(options.output, "utf8");
    if (byteLength(existing) > LIMITS.maxOutputBytes) {
      throw new Error(
        `Committed catalog exceeds ${LIMITS.maxOutputBytes} bytes.`,
      );
    }
    let catalog;
    try {
      catalog = JSON.parse(existing);
    } catch (error) {
      throw new Error(
        `Committed catalog is not valid JSON: ${error.message}`,
      );
    }
    verifyCatalog(catalog, catalog?.operations?.length ?? -1);
    if (stableJson(catalog) !== existing) {
      throw new Error(
        "Committed catalog is not in stable canonical JSON form.",
      );
    }
    process.stdout.write(
      `Validated ${catalog.stats.operationCount} committed operations ` +
        `(${Object.entries(catalog.stats.methodCounts)
          .map(([method, count]) => `${method}=${count}`)
          .join(", ")}), ${catalog.stats.platformCount} platforms, ` +
        `${catalog.stats.tagCount} tags, ` +
        `sha256=${catalog.source.snapshotSha256}.\n`,
    );
    return;
  }

  const snapshot = await readFile(options.input);
  if (snapshot.byteLength > LIMITS.maxSnapshotBytes) {
    throw new Error(
      `OpenAPI snapshot exceeds ${LIMITS.maxSnapshotBytes} bytes.`,
    );
  }
  const snapshotSha256 = createHash("sha256").update(snapshot).digest("hex");
  let root;
  try {
    root = JSON.parse(snapshot.toString("utf8"));
  } catch (error) {
    throw new Error(`OpenAPI snapshot is not valid JSON: ${error.message}`);
  }

  const catalog = buildCatalog(root, snapshotSha256, snapshot.byteLength);
  const output = stableJson(catalog);
  if (byteLength(output) > LIMITS.maxOutputBytes) {
    throw new Error(`Generated catalog exceeds ${LIMITS.maxOutputBytes} bytes.`);
  }

  if (options.check) {
    const existing = await readFile(options.output, "utf8");
    if (existing !== output) {
      throw new Error(
        `Generated catalog is stale. Run this script without --check: ${options.output}`,
      );
    }
  } else {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, output, "utf8");
  }

  process.stdout.write(
    `${options.check ? "Verified" : "Generated"} ${catalog.stats.operationCount} operations ` +
      `(${Object.entries(catalog.stats.methodCounts)
        .map(([method, count]) => `${method}=${count}`)
        .join(", ")}), ${catalog.stats.platformCount} platforms, ` +
      `${catalog.stats.tagCount} tags, sha256=${snapshotSha256}.\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(
      `generate-tikhub-catalog-reference: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
