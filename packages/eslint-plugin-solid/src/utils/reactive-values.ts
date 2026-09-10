import type { TSESTree as T } from "@typescript-eslint/utils";

export type Value =
  | { kind: "object" | "plain"; properties: Map<string, Value> }
  | { kind: "accessor"; result: Value }
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

// A store recursively wraps objects, but leaves primitive fields alone.
export const asStore = (value: Value): Value =>
  value?.kind === "plain"
    ? {
        kind: "object",
        properties: new Map([...value.properties].map(([key, value]) => [key, asStore(value)])),
      }
    : value ?? object;

export const propertyValue = (value: Value, key: string | null): Value => {
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
