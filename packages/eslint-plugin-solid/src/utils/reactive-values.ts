import type { TSESTree as T } from "@typescript-eslint/utils";

export type Value =
  | { kind: "object" | "plain"; properties: Map<string, Value>; array?: boolean }
  | { kind: "accessor" | "promise"; result: Value }
  | { kind: "iterator"; async: boolean; yielded: Value; returned: Value }
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
  array: true,
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

export const iteratorValue = (async: boolean, yielded: Value, returned: Value): Value => ({
  kind: "iterator",
  async,
  // Native async generators await each yield/return, but sync generators do not.
  yielded: async ? awaitedValue(yielded) : yielded,
  returned: async ? awaitedValue(returned) : returned,
});

export const iterationValue = (value: Value): Value => {
  if (value?.kind === "iterator") return value.yielded;
  if (value?.kind === "union") return value.values.map(iterationValue).reduce(mergeValues, null);
  if ((value?.kind === "object" || value?.kind === "plain") && value.array)
    return [...value.properties]
      .filter(([key]) => /^\d+$/.test(key))
      .map(([, item]) => item)
      .reduce(mergeValues, null);
  return null;
};

// The result of yield* is the delegated iterator's final return, not its yields.
export const iterationReturn = (value: Value): Value =>
  value?.kind === "iterator"
    ? value.returned
    : value?.kind === "union"
    ? value.values.map(iterationReturn).reduce(mergeValues, null)
    : null;

// Solid settles a Promise, then consumes one AsyncIterable. It neither drains
// ordinary sync iterators nor recursively consumes streams yielded as values.
export const computationValue = (value: Value): Value => {
  value = awaitedValue(value);
  if (value?.kind === "union") return value.values.map(computationValue).reduce(mergeValues, null);
  return value?.kind === "iterator" && value.async ? value.yielded : value;
};

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
        array: value.array,
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
  if (left.kind === "iterator" && right.kind === "iterator" && left.async === right.async)
    return iteratorValue(
      left.async,
      mergeValues(left.yielded, right.yielded),
      mergeValues(left.returned, right.returned)
    );
  // Preserve wrapper/value alternatives until the consuming operation is known.
  // Collapsing them early mistakes Promise/iterator methods for reactive reads.
  if ([left.kind, right.kind].some((kind) => ["promise", "iterator", "union"].includes(kind))) {
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
      array: left.array && right.array,
    };
  }
  return left;
};
