import type { TSESLint } from "@typescript-eslint/utils";
import { TSESTree as T, ESLintUtils } from "@typescript-eslint/utils";
import { findVariable } from "../compat";
import {
  FunctionNode,
  getSolidSourceRegex,
  ignoreTransparentWrappers,
  isFunctionNode,
  isPropsByName,
  isSolidV2,
} from "../utils";

type MessageIds = "untrackedRead";
type Options = [{ reactiveObjectFactories?: string[] }];
type Variable = TSESLint.Scope.Variable;
type Value =
  | { kind: "object" | "plain"; properties: Map<string, Value> }
  | { kind: "accessor"; result: Value }
  | { kind: "setter" }
  | { kind: "scalar" }
  | null;
type Bindings = Map<Variable, Value>;

const object: Value = { kind: "object", properties: new Map() };
const setter: Value = { kind: "setter" };
const scalar: Value = { kind: "scalar" };
const container = (entries: Array<[string, Value]>): Value => ({
  kind: "plain",
  properties: new Map(entries),
});

// A store recursively wraps objects, but leaves primitive fields alone.
const asStore = (value: Value): Value =>
  value?.kind === "plain"
    ? {
        kind: "object",
        properties: new Map([...value.properties].map(([key, value]) => [key, asStore(value)])),
      }
    : value ?? object;

const propertyValue = (value: Value, key: string | null): Value => {
  if (value?.kind !== "object" && value?.kind !== "plain") return null;
  if (key !== null && value.properties.has(key)) return value.properties.get(key)!;
  return value.kind === "object" ? object : null;
};

const propertyName = (key: T.Node, computed: boolean): string | null => {
  if (!computed && key.type === "Identifier") return key.name;
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number"))
    return String(key.value);
  return null;
};

const mergeValues = (left: Value, right: Value): Value => {
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

/**
 * Track the shape of values crossing the compute/apply boundary. Plain
 * containers can retain proxies or accessors in individual fields; copying a
 * container is not necessarily a snapshot. This is local syntax analysis,
 * not a type checker or a whole-program data-flow analysis.
 */
export default ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow reading reactive values in the untracked apply callback of a Solid 2 split effect.",
      url: "https://github.com/solidjs-community/eslint-plugin-solid/blob/main/packages/eslint-plugin-solid/docs/no-reactive-read-in-effect-callback.md",
    },
    schema: [
      {
        type: "object",
        properties: {
          reactiveObjectFactories: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
            description: "Local names of additional functions that return reactive objects.",
            default: [],
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      untrackedRead:
        "Reactive value '{{name}}' is read in an untracked effect callback. Read it in the compute function and pass a plain snapshot to the callback.",
    },
  },
  defaultOptions: [{ reactiveObjectFactories: [] }],
  create(context, [options]) {
    if (!isSolidV2(context)) return {};

    const sourceCode = context.sourceCode;
    const solidSource = getSolidSourceRegex(context);
    const factories = new Set(options.reactiveObjectFactories);
    const reported = new Set<number>();
    const parameterReads = new WeakMap<Bindings, T.Node[]>();

    const unwrap = (node: T.Node): T.Node =>
      node.type === "ChainExpression" ? unwrap(node.expression) : ignoreTransparentWrappers(node);

    // Resolve only stable local aliases, with a guard for circular definitions.
    const resolve = (node: T.Node | undefined, seen = new Set<T.Node>()): T.Node | undefined => {
      if (!node) return undefined;
      node = unwrap(node);
      if (seen.has(node)) return undefined;
      seen.add(node);
      if (node.type === "Identifier") {
        const variable = findVariable(context, node);
        const def = variable?.defs[0];
        if (def?.type === "FunctionName") return def.node;
        if (
          def?.type === "Variable" &&
          def.node.id.type === "Identifier" &&
          !variable?.references.some((ref) => ref.isWrite() && !ref.init)
        ) {
          return resolve(def.node.init ?? undefined, seen);
        }
      }
      if (node.type === "MemberExpression") {
        const base = resolve(node.object, seen);
        const key = propertyName(node.property, node.computed);
        if (base?.type === "ObjectExpression" && key !== null) {
          const property = base.properties.find(
            (p) => p.type === "Property" && propertyName(p.key, p.computed) === key
          );
          if (property?.type === "Property") return resolve(property.value, seen);
        }
      }
      return node;
    };

    const resolveFunction = (node: T.Node | undefined): FunctionNode | null => {
      const resolved = resolve(node);
      return isFunctionNode(resolved) ? resolved : null;
    };

    // Resolve the binding, not just its spelling: aliases, namespaces and
    // shadowed imports must all have the same behavior.
    const solidImport = (node: T.Node): string | null => {
      node = resolve(node) ?? node;
      const id =
        node.type === "Identifier"
          ? node
          : node.type === "MemberExpression" && node.object.type === "Identifier"
          ? node.object
          : null;
      if (!id) return null;
      const def = findVariable(context, id)?.defs[0];
      if (
        def?.type !== "ImportBinding" ||
        def.parent.type !== "ImportDeclaration" ||
        !solidSource.test(def.parent.source.value)
      )
        return null;
      if (node.type === "Identifier" && def.node.type === "ImportSpecifier") {
        return def.node.imported.type === "Identifier"
          ? def.node.imported.name
          : def.node.imported.value;
      }
      if (node.type === "MemberExpression" && def.node.type === "ImportNamespaceSpecifier") {
        return propertyName(node.property, node.computed);
      }
      return null;
    };

    const report = (node: T.Node): void => {
      if (reported.has(node.range[0])) return;
      reported.add(node.range[0]);
      context.report({
        node,
        messageId: "untrackedRead",
        data: { name: sourceCode.getText(node) },
      });
    };

    // Parser visitor keys exclude parent links and include TS/JSX nodes.
    // Nested functions are visited only when a synchronous call is known.
    const walk = (node: T.Node, visit: (node: T.Node) => void): void => {
      if (isFunctionNode(node)) return;
      visit(node);
      for (const key of sourceCode.visitorKeys[node.type] ?? []) {
        const child = (node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
          for (const item of child) if (item?.type) walk(item as T.Node, visit);
        } else if (child && typeof child === "object" && "type" in child) {
          walk(child as T.Node, visit);
        }
      }
    };

    const returns = (fn: FunctionNode): T.Node[] => {
      if (fn.body.type !== "BlockStatement") return [fn.body];
      const result: T.Node[] = [];
      walk(fn.body, (node) => {
        if (node.type === "ReturnStatement" && node.argument) result.push(node.argument);
      });
      return result;
    };

    const bind = (
      pattern: T.Node,
      value: Value,
      env: Bindings,
      check = false,
      seen = new Set<T.Node>()
    ): void => {
      if (seen.has(pattern)) return;
      const next = new Set(seen).add(pattern);
      if (pattern.type === "Identifier") {
        const variable = findVariable(context, pattern);
        if (variable) env.set(variable, value);
      } else if (pattern.type === "AssignmentPattern") {
        if (check && !value) parameterReads.get(env)?.push(pattern.right);
        bind(pattern.left, value ?? infer(pattern.right, env, next), env, check, next);
      } else if (pattern.type === "ObjectPattern") {
        for (const property of pattern.properties) {
          if (check && value?.kind === "object") report(property);
          if (property.type === "RestElement") {
            bind(
              property.argument,
              value?.kind === "object" || value?.kind === "plain"
                ? { kind: "plain", properties: new Map(value.properties) }
                : null,
              env,
              false,
              next
            );
          } else {
            if (check && property.computed) parameterReads.get(env)?.push(property.key);
            bind(
              property.value,
              propertyValue(value, propertyName(property.key, property.computed)),
              env,
              check,
              next
            );
          }
        }
      } else if (pattern.type === "ArrayPattern") {
        if (check && value?.kind === "object") report(pattern);
        pattern.elements.forEach((element, index) => {
          if (element) bind(element, propertyValue(value, String(index)), env, check, next);
        });
      } else if (pattern.type === "RestElement") {
        bind(pattern.argument, value, env, check, next);
      }
    };

    const callBindings = (
      fn: FunctionNode,
      args: Value[],
      env: Bindings,
      check = false,
      seen = new Set<T.Node>()
    ): Bindings => {
      const local = new Map(env);
      if (check) parameterReads.set(local, []);
      fn.params.forEach((param, index) => {
        const value =
          param.type === "RestElement"
            ? container(args.slice(index).map((arg, i) => [String(i), arg]))
            : args[index] ?? null;
        bind(param, value, local, check, seen);
      });
      return local;
    };

    const resultOf = (fn: FunctionNode, env: Bindings, seen: Set<T.Node>): Value => {
      if (seen.has(fn)) return null;
      const next = new Set(seen).add(fn);
      return returns(fn).reduce<Value>(
        (value, node) => mergeValues(value, infer(node, env, next)),
        null
      );
    };

    const infer = (input: T.Node | undefined, env: Bindings, seen = new Set<T.Node>()): Value => {
      if (!input) return null;
      const node = unwrap(input);
      if (seen.has(node)) return null;
      const next = new Set(seen).add(node);
      if (node.type === "Identifier") {
        const variable = findVariable(context, node);
        if (!variable) return null;
        if (env.has(variable)) return env.get(variable)!;
        const def = variable.defs[0];
        if (def?.type === "Parameter") return isPropsByName(node.name) ? object : null;
        if (def?.type !== "Variable" || !def.node.init || seen.has(def.node)) return null;
        if (variable.references.some((ref) => ref.isWrite() && !ref.init)) return null;
        next.add(def.node);
        const value = infer(def.node.init, env, next);
        const bindings = new Map<Variable, Value>();
        bind(def.node.id, value, bindings, false, next);
        return bindings.get(variable) ?? null;
      }
      if (node.type === "MemberExpression") {
        return propertyValue(
          infer(node.object, env, next),
          propertyName(node.property, node.computed)
        );
      }
      if (
        node.type === "Literal" ||
        node.type === "TemplateLiteral" ||
        node.type === "BinaryExpression" ||
        node.type === "UnaryExpression"
      )
        return scalar;
      if (node.type === "ObjectExpression") {
        const properties = new Map<string, Value>();
        for (const property of node.properties) {
          if (property.type === "SpreadElement") {
            const value = infer(property.argument, env, next);
            if (value?.kind === "object" || value?.kind === "plain") {
              for (const [key, entry] of value.properties) properties.set(key, entry);
            }
          } else {
            const key = propertyName(property.key, property.computed);
            if (key !== null) properties.set(key, infer(property.value, env, next));
          }
        }
        return { kind: "plain", properties };
      }
      if (node.type === "ArrayExpression") {
        return container(
          node.elements.map((element, i) => [String(i), infer(element ?? undefined, env, next)])
        );
      }
      if (node.type === "ConditionalExpression") {
        return mergeValues(infer(node.consequent, env, next), infer(node.alternate, env, next));
      }
      if (node.type === "LogicalExpression") {
        return mergeValues(infer(node.left, env, next), infer(node.right, env, next));
      }
      if (node.type === "CallExpression") {
        const primitive = solidImport(node.callee);
        const first = node.arguments[0];
        const fn = resolveFunction(first);
        if (
          primitive === "createSignal" ||
          primitive === "createOptimistic" ||
          primitive === "createMemo"
        ) {
          const result = fn ? resultOf(fn, env, next) : infer(first, env, next);
          const accessor: Value = { kind: "accessor", result };
          return primitive === "createMemo"
            ? accessor
            : container([
                ["0", accessor],
                ["1", setter],
              ]);
        }
        if (
          primitive === "createStore" ||
          primitive === "createOptimisticStore" ||
          primitive === "createProjection"
        ) {
          const initial = fn ? node.arguments[1] : first;
          const value = asStore(infer(initial, env, next)) ?? object;
          return primitive === "createProjection"
            ? value
            : container([
                ["0", value],
                ["1", setter],
              ]);
        }
        if (primitive === "omit") return infer(first, env, next);
        if (primitive === "merge") {
          return node.arguments.reduce<Value>(
            (value, arg) => mergeValues(value, infer(arg, env, next)),
            null
          );
        }
        if (node.callee.type === "Identifier" && factories.has(node.callee.name)) return object;
        const callee = infer(node.callee, env, next);
        if (callee?.kind === "accessor") return callee.result;
        const called = resolveFunction(node.callee);
        if (called && !next.has(called)) {
          return resultOf(
            called,
            callBindings(
              called,
              node.arguments.map((arg) => infer(arg, env, next)),
              env,
              false,
              new Set(next).add(called)
            ),
            next
          );
        }
      }
      return null;
    };

    const analyze = (fn: FunctionNode, env: Bindings, active = new Set<FunctionNode>()): void => {
      if (active.has(fn) || fn.generator) return;
      const next = new Set(active).add(fn);
      // Default parameter expressions also execute in the apply phase.
      const visit = (node: T.Node): void => {
        if (node.type === "VariableDeclarator" && node.init) {
          bind(node.id, infer(node.init, env), env, true);
        } else if (node.type === "AssignmentExpression") {
          bind(node.left, infer(node.right, env), env, true);
        } else if (node.type === "SpreadElement" && infer(node.argument, env)?.kind === "object") {
          report(node);
        } else if (node.type === "MemberExpression" && infer(node.object, env)?.kind === "object") {
          const parent = node.parent;
          if (
            !(
              parent?.type === "AssignmentExpression" &&
              parent.left === node &&
              parent.operator === "="
            )
          ) {
            report(node);
          }
        }
        if (node.type !== "CallExpression") return;
        const callee = infer(node.callee, env);
        if (callee?.kind === "accessor") report(node);
        const called = resolveFunction(node.callee);
        if (called) {
          analyze(
            called,
            callBindings(
              called,
              node.arguments.map((arg) => infer(arg, env)),
              env,
              true
            ),
            next
          );
        } else if (callee?.kind === "setter") {
          const updater = resolveFunction(node.arguments[0]);
          // The setter's previous value/draft is safe; captured values are not.
          if (updater) analyze(updater, callBindings(updater, [], env, true), next);
        } else if (
          node.callee.type === "MemberExpression" &&
          ["forEach", "map", "filter", "some", "every", "find", "findIndex", "flatMap"].includes(
            propertyName(node.callee.property, node.callee.computed) ?? ""
          )
        ) {
          const callback = resolveFunction(node.arguments[0]);
          if (callback) {
            const item = propertyValue(infer(node.callee.object, env), "0");
            analyze(callback, callBindings(callback, [item], env, true), next);
          }
        }
      };
      for (const expression of parameterReads.get(env) ?? []) walk(expression, visit);
      walk(fn.body, visit);
    };

    const effects: T.CallExpression[] = [];
    return {
      CallExpression(node) {
        effects.push(node);
      },
      "Program:exit"() {
        for (const node of effects) {
          if (
            !["createEffect", "createRenderEffect"].includes(solidImport(node.callee) ?? "") ||
            node.arguments.length < 2
          )
            continue;
          let apply = resolveFunction(node.arguments[1]);
          if (!apply) {
            const bundle = resolve(node.arguments[1]);
            if (bundle?.type === "ObjectExpression") {
              const effect = bundle.properties.find(
                (p) => p.type === "Property" && propertyName(p.key, p.computed) === "effect"
              );
              if (effect?.type === "Property") apply = resolveFunction(effect.value);
            }
          }
          if (!apply) continue;
          const env: Bindings = new Map();
          const compute = resolveFunction(node.arguments[0]);
          const accessor = infer(node.arguments[0], env);
          const value = compute
            ? resultOf(compute, env, new Set())
            : accessor?.kind === "accessor"
            ? accessor.result
            : null;
          analyze(apply, callBindings(apply, [value, value], env, true));
        }
      },
    };
  },
});
