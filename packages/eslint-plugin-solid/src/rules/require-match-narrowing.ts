import type { TSESLint } from "@typescript-eslint/utils";
import { TSESTree as T, ESLintUtils, ASTUtils } from "@typescript-eslint/utils";
import { findVariable, getScope } from "../compat";
import {
  getSolidSourceRegex,
  ignoreTransparentWrappers,
  isFunctionNode,
  isSolidV2,
} from "../utils";

type MessageIds = "matchNarrowing";
type Options = [];
type Variable = TSESLint.Scope.Variable;
const CALL = Symbol("accessor call");
type Path = Array<string | typeof CALL>;
interface ReferencePath {
  variable: Variable;
  path: Path;
}

/**
 * Keep data selected by a Match condition connected to its render callback.
 * This is a syntactic guard for potentially reactive data, not a proof that
 * every independent branch read will cause a hydration mismatch.
 */
export default ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require Match branches to consume the data selected by their condition through a narrowing callback.",
      url: "https://github.com/solidjs-community/eslint-plugin-solid/blob/main/packages/eslint-plugin-solid/docs/require-match-narrowing.md",
    },
    schema: [],
    messages: {
      matchNarrowing:
        "This <Match> branch independently reads data selected by 'when'. Return that data from 'when' and read it through the Match callback.",
    },
  },
  defaultOptions: [],
  create(context) {
    if (!isSolidV2(context)) return {};
    const sourceCode = context.sourceCode;
    const solidSource = getSolidSourceRegex(context);
    const isSolidSource = (source: string): boolean =>
      source === "@solidjs/web" || solidSource.test(source);
    const unwrap = (node: T.Node): T.Node => {
      const inner = ignoreTransparentWrappers(node);
      return inner.type === "ChainExpression" || inner.type === "TSTypeAssertion"
        ? unwrap(inner.expression)
        : inner;
    };
    const propertyName = (node: T.Node, computed: boolean): string | null => {
      node = unwrap(node);
      if (!computed && node.type === "Identifier") return node.name;
      return node.type === "Literal" &&
        (typeof node.value === "string" || typeof node.value === "number")
        ? String(node.value)
        : null;
    };
    const isStable = (variable: Variable): boolean =>
      !variable.references.some((reference) => reference.isWrite() && !reference.init);

    function patternPath(pattern: T.Node, variable: Variable): Path | null {
      if (pattern.type === "Identifier")
        return findVariable(context, pattern) === variable ? [] : null;
      if (pattern.type === "AssignmentPattern") {
        // A nonempty default introduces another source, not a stable alias.
        return pattern.right.type === "Identifier" && pattern.right.name === "undefined"
          ? patternPath(pattern.left, variable)
          : null;
      }
      if (pattern.type === "ObjectPattern") {
        for (const property of pattern.properties) {
          if (property.type !== "Property") continue;
          const key = propertyName(property.key, property.computed);
          const child = patternPath(property.value, variable);
          if (key !== null && child) return [key, ...child];
        }
      }
      if (pattern.type === "ArrayPattern") {
        for (const [index, element] of pattern.elements.entries()) {
          if (!element || element.type === "RestElement") continue;
          const child = patternPath(element, variable);
          if (child) return [String(index), ...child];
        }
      }
      return null;
    }

    const referencePath = (node: T.Node, seen = new Set<Variable>()): ReferencePath | null => {
      node = unwrap(node);
      if (node.type === "Identifier") {
        const variable = findVariable(context, node);
        if (!variable) return null;
        const own = { variable, path: [] };
        if (seen.has(variable) || !isStable(variable)) return own;
        const def = variable.defs[0];
        if (def?.type !== "Variable" || !def.node.init) return own;
        const init = unwrap(def.node.init);
        // Factory calls create distinct values; they are not aliases of the
        // factory itself. This also preserves the identity of each signal.
        if (init.type !== "Identifier" && init.type !== "MemberExpression") return own;
        const path = patternPath(def.node.id, variable);
        if (!path) return own;
        const base = referencePath(init, new Set(seen).add(variable));
        return base ? { ...base, path: [...base.path, ...path] } : own;
      }
      if (node.type === "MemberExpression") {
        const base = referencePath(node.object, seen);
        const key = propertyName(node.property, node.computed);
        return base && key !== null ? { ...base, path: [...base.path, key] } : null;
      }
      if (node.type === "CallExpression" && node.arguments.length === 0) {
        const base = referencePath(node.callee, seen);
        return base ? { ...base, path: [...base.path, CALL] } : null;
      }
      return null;
    };

    const isPlainConstant = (node: T.Node, seen = new Set<Variable>()): boolean => {
      node = unwrap(node);
      if (node.type === "Literal") return true;
      if (node.type === "Identifier") {
        const variable = findVariable(context, node);
        if (!variable || seen.has(variable) || !isStable(variable)) return false;
        const def = variable.defs[0];
        return (
          def?.type === "Variable" &&
          !!def.node.init &&
          isPlainConstant(def.node.init, new Set(seen).add(variable))
        );
      }
      if (node.type === "ObjectExpression") {
        return node.properties.every(
          (property) =>
            property.type === "Property" &&
            !property.computed &&
            property.kind === "init" &&
            isPlainConstant(property.value, new Set(seen))
        );
      }
      if (node.type === "ArrayExpression") {
        return node.elements.every(
          (element) => !element || isPlainConstant(element, new Set(seen))
        );
      }
      return false;
    };
    const isPotentialData = (reference: ReferencePath): boolean => {
      const def = reference.variable.defs[0];
      return !(
        isStable(reference.variable) &&
        def?.type === "Variable" &&
        def.node.init &&
        isPlainConstant(def.node.init, new Set([reference.variable]))
      );
    };
    const contains = (source: ReferencePath, read: ReferencePath): boolean =>
      source.variable === read.variable &&
      source.path.length <= read.path.length &&
      source.path.every((part, index) => part === read.path[index]);

    const isPredicate = (node: T.Node): boolean => {
      node = unwrap(node);
      if (node.type === "Literal") return typeof node.value === "boolean";
      if (node.type === "UnaryExpression")
        return node.operator === "!" || node.operator === "delete";
      if (node.type === "BinaryExpression") {
        return ["==", "!=", "===", "!==", "<", "<=", ">", ">=", "in", "instanceof"].includes(
          node.operator
        );
      }
      if (node.type === "LogicalExpression") {
        // && may return a falsy sentinel, but its selected value is boolean
        // when its right operand is a predicate.
        return isPredicate(node.right) && (node.operator === "&&" || isPredicate(node.left));
      }
      if (node.type === "ConditionalExpression")
        return isPredicate(node.consequent) && isPredicate(node.alternate);
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        node.callee.name === "Boolean"
      ) {
        const variable = findVariable(context, node.callee);
        return !variable || variable.defs.length === 0;
      }
      return false;
    };

    const childrenOf = (node: T.Node, visit: (child: T.Node) => void): void => {
      for (const key of sourceCode.visitorKeys[node.type] ?? []) {
        const child = (node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
          for (const item of child) if (item?.type) visit(item as T.Node);
        } else if (child && typeof child === "object" && "type" in child) visit(child as T.Node);
      }
    };
    const isReference = (node: T.Identifier): boolean =>
      !!findVariable(context, node)?.references.some((reference) => reference.identifier === node);

    // Collect complete reads, never all their base identifiers: props.detail
    // must not become a read of every unrelated property on props.
    const collectReads = (node: T.Node, result: ReferencePath[]): void => {
      node = unwrap(node);
      if (isFunctionNode(node) || node.type.startsWith("TS")) return;
      if (node.type === "Identifier") {
        const path = isReference(node) && referencePath(node);
        if (path) result.push(path);
        return;
      }
      if (node.type === "MemberExpression") {
        const path = referencePath(node);
        if (path) {
          result.push(path);
          return;
        }
        collectReads(node.object, result);
        if (node.computed) collectReads(node.property, result);
        return;
      }
      if (node.type === "CallExpression") {
        const path = referencePath(node);
        if (path) result.push(path);
        for (const argument of node.arguments) collectReads(argument, result);
        if (!path && node.callee.type === "MemberExpression")
          collectReads(node.callee.object, result);
        return;
      }
      childrenOf(node, (child) => collectReads(child, result));
    };

    const importedName = (name: T.JSXTagNameExpression): string | null => {
      const id =
        name.type === "JSXIdentifier"
          ? name
          : name.type === "JSXMemberExpression" && name.object.type === "JSXIdentifier"
          ? name.object
          : null;
      if (!id) return null;
      const variable = ASTUtils.findVariable(getScope(context, id), id.name);
      if (!variable?.defs.length) return name.type === "JSXIdentifier" ? id.name : null;
      const def = variable.defs[0];
      if (
        def.type !== "ImportBinding" ||
        def.parent.type !== "ImportDeclaration" ||
        def.parent.importKind === "type" ||
        !isSolidSource(def.parent.source.value)
      )
        return null;
      if (name.type === "JSXMemberExpression")
        return def.node.type === "ImportNamespaceSpecifier" ? name.property.name : null;
      return def.node.type === "ImportSpecifier" && def.node.importKind !== "type"
        ? def.node.imported.type === "Identifier"
          ? def.node.imported.name
          : def.node.imported.value
        : null;
    };
    const callbackComponents = new Set(["Match", "Show", "For", "Repeat"]);
    const collectBranchReads = (
      node: T.Node,
      result: ReferencePath[],
      renderCallback = false
    ): void => {
      node = unwrap(node);
      if (isFunctionNode(node)) {
        if (renderCallback) collectBranchReads(node.body, result);
        return;
      }
      if (node.type === "JSXExpressionContainer") {
        collectBranchReads(node.expression, result, renderCallback);
        return;
      }
      if (node.type === "JSXElement") {
        const component = importedName(node.openingElement.name);
        const callback = callbackComponents.has(component ?? "");
        for (const attribute of node.openingElement.attributes) {
          if (attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier") {
            const name = attribute.name.name;
            // A nested conditional is another guard, not a rendered data read.
            if (name === "when" && (component === "Match" || component === "Show")) continue;
            if (attribute.value)
              collectBranchReads(
                attribute.value,
                result,
                (name === "children" && callback) ||
                  (name === "fallback" && component === "Errored")
              );
          } else collectBranchReads(attribute, result);
        }
        for (const child of node.children) collectBranchReads(child, result, callback);
        return;
      }
      if (
        node.type.startsWith("JSX") &&
        node.type !== "JSXFragment" &&
        node.type !== "JSXSpreadAttribute"
      )
        return;
      if (
        node.type === "Identifier" ||
        node.type === "MemberExpression" ||
        node.type === "CallExpression"
      ) {
        collectReads(node, result);
        return;
      }
      if (node.type.startsWith("TS")) return;
      childrenOf(node, (child) => collectBranchReads(child, result));
    };
    const attribute = (node: T.JSXElement, name: string): T.JSXAttribute | undefined =>
      node.openingElement.attributes.find(
        (attr): attr is T.JSXAttribute =>
          attr.type === "JSXAttribute" &&
          attr.name.type === "JSXIdentifier" &&
          attr.name.name === name
      );
    const isFalsy = (node: T.Node): boolean => {
      node = unwrap(node);
      return (
        (node.type === "Literal" && !node.value) ||
        (node.type === "Identifier" &&
          node.name === "undefined" &&
          !findVariable(context, node)?.defs.length)
      );
    };

    return {
      JSXElement(node: T.JSXElement) {
        if (importedName(node.openingElement.name) !== "Match") return;
        const when = attribute(node, "when");
        if (when?.value?.type !== "JSXExpressionContainer") return;
        const expression = unwrap(when.value.expression);
        const sources: ReferencePath[] = [];
        if (isPredicate(expression)) {
          const reads: ReferencePath[] = [];
          collectReads(expression, reads);
          for (const read of reads) {
            if (!isPotentialData(read)) continue;
            sources.push(read);
            // props.detail.locked selects detail. Never widen props.ready to
            // all props, or an accessor call to the function object.
            if (
              read.path.length &&
              read.path.at(-1) !== CALL &&
              (read.path.length > 1 || read.variable.defs[0]?.type !== "Parameter")
            ) {
              sources.push({ ...read, path: read.path.slice(0, -1) });
            }
          }
        } else {
          // Changing only `when` must not hide independent source reads.
          const value =
            expression.type === "ConditionalExpression" && isPredicate(expression.test)
              ? isFalsy(expression.alternate)
                ? expression.consequent
                : isFalsy(expression.consequent)
                ? expression.alternate
                : null
              : expression.type === "LogicalExpression" &&
                expression.operator === "&&" &&
                isPredicate(expression.left)
              ? expression.right
              : expression;
          const source = value && referencePath(value);
          if (source && isPotentialData(source)) sources.push(source);
        }
        if (!sources.length) return;
        const reads: ReferencePath[] = [];
        const children = attribute(node, "children");
        if (children?.value) collectBranchReads(children.value, reads, true);
        for (const child of node.children) collectBranchReads(child, reads, true);
        if (reads.some((read) => sources.some((source) => contains(source, read)))) {
          context.report({ node: when, messageId: "matchNarrowing" });
        }
      },
    };
  },
});
