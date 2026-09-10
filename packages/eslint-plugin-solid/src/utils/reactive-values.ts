import type { TSESTree as T } from "@typescript-eslint/utils";

export type Value =
  | { kind: "object" | "plain"; properties: Map<string, Value> }
  | { kind: "accessor" | "promise"; result: Value }
  | { kind: "union"; values: Value[] }
  | { kind: "setter" }
  | { kind: "scalar" }
  | null;

export const object: Value = { kind: "object", properties: new Map() };
export const setter: Value = { kind: "setter" };
export const scalar: Value = { kind: "scalar" };
export const container = (entries: Array<[string, Value]>): Value => ({
  kind: "plain",
  properties: new Map(entries),
});

// Awaiting unwraps only the outer value, never promises stored in its fields.
export const awaitedValue = (value: Value): Value =>
  value?.kind === "promise"
    ? awaitedValue(value.result)
    : value?.kind === "union"
    ? value.values.map(awaitedValue).reduce(mergeValues, null)
    : value;

export const promiseValue = (value: Value): Value => ({
  kind: "promise",
  result: awaitedValue(value),
});

export const hasKind = (value: Value, kind: NonNullable<Value>["kind"]): boolean =>
  value?.kind === kind ||
  (value?.kind === "union" && value.values.some((entry) => hasKind(entry, kind)));

export const callResult = (value: Value): Value =>
  value?.kind === "accessor"
    ? value.result
    : value?.kind === "union"
    ? value.values.map(callResult).reduce(mergeValues, null)
    : null;

export const propertiesOf = (value: Value): Map<string, Value> => {
  if (value?.kind === "object" || value?.kind === "plain") return value.properties;
  const properties = new Map<string, Value>();
  if (value?.kind === "union") {
    for (const entry of value.values) {
      for (const [key, field] of propertiesOf(entry)) {
        properties.set(key, mergeValues(properties.get(key) ?? null, field));
      }
    }
  }
  return properties;
};

// A store recursively wraps objects, but leaves primitive fields alone.
export const asStore = (value: Value): Value =>
  value?.kind === "union"
    ? value.values.map(asStore).reduce(mergeValues, null)
    : value?.kind === "plain"
    ? {
        kind: "object",
        properties: new Map([...value.properties].map(([key, value]) => [key, asStore(value)])),
      }
    : value ?? object;

export const propertyValue = (value: Value, key: string | null): Value => {
  if (value?.kind === "union")
    return value.values.map((entry) => propertyValue(entry, key)).reduce(mergeValues, null);
  if (value?.kind !== "object" && value?.kind !== "plain") return null;
  if (key !== null && value.properties.has(key)) return value.properties.get(key)!;
  return value.kind === "object" ? object : null;
};

export const propertyName = (key: T.Node, computed: boolean): string | null => {
  if (!computed && key.type === "Identifier") return key.name;
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number"))
    return String(key.value);
  return null;
};

export const mergeValues = (left: Value, right: Value): Value => {
  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  if (left.kind === "promise" && right.kind === "promise")
    return promiseValue(mergeValues(left.result, right.result));
  // Preserve promise/non-promise alternatives until the consumer awaits them.
  // Collapsing them early mistakes Promise methods for reactive property reads.
  if ([left.kind, right.kind].some((kind) => kind === "promise" || kind === "union")) {
    return {
      kind: "union",
      values: [
        ...new Set([
          ...(left.kind === "union" ? left.values : [left]),
          ...(right.kind === "union" ? right.values : [right]),
        ]),
      ],
    };
  }
  if (left.kind === "scalar") return right;
  if (right.kind === "scalar") return left;
  if (
    (left.kind === "object" || left.kind === "plain") &&
    (right.kind === "object" || right.kind === "plain")
  ) {
    const properties = new Map(left.properties);
    for (const [key, value] of right.properties) {
      properties.set(key, mergeValues(properties.get(key) ?? null, value));
    }
    return {
      kind: left.kind === "object" || right.kind === "object" ? "object" : "plain",
      properties,
    };
  }
  return left;
};
