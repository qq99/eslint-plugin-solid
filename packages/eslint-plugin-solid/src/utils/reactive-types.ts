import ts from "@typescript/typescript6";

export interface TypeModule {
  source: ts.SourceFile;
  checker: ts.TypeChecker;
}

type Fact = "scalar" | "callback" | "nullish" | "void" | null;
type TypeArgument = { module: TypeModule; node: ts.Node; env: Environment };
type Environment = Map<ts.Symbol, TypeArgument>;

// The plugin owns this compiler API dependency so type refinement does not vary
// with the consumer's TypeScript compiler. The guard is for the standalone/
// browser build, where this Node-only API is intentionally mocked out.
const hasCompilerApi = Boolean(
  typeof ts.createSourceFile === "function" &&
    typeof ts.createProgram === "function" &&
    typeof ts.forEachChild === "function" &&
    typeof ts.ScriptTarget?.Latest === "number"
);

/** Only prove scalar snapshots and conventional void callback signatures.
 * Object types never establish (or disprove) reactivity. No parser services,
 * standard libraries, project type check, or execution of application code.
 */
export function createReactiveTypeResolver(
  filename: string,
  text: string,
  loadImport: (source: string, from: string) => TypeModule | null,
  solidSource: RegExp
) {
  let current: TypeModule | undefined;
  const nodes = new Map<string, ts.Node>();
  const facts = new Map<string, Fact>();
  let steps = 0;

  const initialize = (): TypeModule => {
    if (current) return current;
    // The active buffer, not its potentially stale on-disk contents. This host
    // is intentionally in-memory so virtual inputs and the browser still work.
    const file = /\.[cm]?[jt]sx?$/.test(filename) ? filename : "input.tsx";
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const program = ts.createProgram(
      [file],
      { noLib: true, noResolve: true, types: [] },
      {
        getSourceFile: (name) => (name === file ? source : undefined),
        getDefaultLibFileName: () => "",
        writeFile() {},
        getCurrentDirectory: () => "/",
        getDirectories: () => [],
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (name) => name === file,
        readFile: (name) => (name === file ? text : undefined),
      }
    );
    const visit = (node: ts.Node): void => {
      nodes.set(`${node.getStart(source)}:${node.end}`, node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return (current = { source, checker: program.getTypeChecker() });
  };

  const sourceOf = (node: ts.Node): string | null => {
    for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) {
      if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
        return parent.moduleSpecifier && ts.isStringLiteral(parent.moduleSpecifier)
          ? parent.moduleSpecifier.text
          : null;
      }
    }
    return null;
  };

  const combine = (values: Fact[]): Fact => {
    if (values.some((value) => value === null)) return null;
    const concrete = values.filter((value) => value !== "nullish");
    return concrete.length === 0
      ? "nullish"
      : concrete.every((value) => value === concrete[0])
      ? concrete[0]
      : null;
  };

  const exported = (
    module: TypeModule,
    name: string,
    path: string[],
    env: Environment,
    seen: Set<ts.Node>,
    args: TypeArgument[] = []
  ): Fact => {
    if (++steps > 1000) return null;
    const symbol = module.checker.getSymbolAtLocation(module.source);
    const target = symbol && module.checker.getExportsOfModule(symbol).find((s) => s.name === name);
    if (target) return declaration(module, target, path, env, seen, args);
    for (const statement of module.source.statements) {
      if (!ts.isExportDeclaration(statement) || statement.exportClause || seen.has(statement))
        continue;
      const source = sourceOf(statement);
      const next = source && loadImport(source, module.source.fileName);
      if (!next) continue;
      const fact = exported(next, name, path, env, new Set(seen).add(statement), args);
      if (fact) return fact;
    }
    return null;
  };

  const declaration = (
    module: TypeModule,
    symbol: ts.Symbol | undefined,
    path: string[],
    env: Environment,
    seen: Set<ts.Node>,
    args: TypeArgument[] = []
  ): Fact => {
    if (!symbol) return null;
    const substitution = env.get(symbol);
    if (substitution)
      return evaluate(substitution.module, substitution.node, path, substitution.env, seen);
    const declarations = symbol.declarations ?? [];
    // Merged declarations can disagree; never use just one to prove a scalar.
    if (declarations.length !== 1) return null;
    const node = declarations[0];
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const local = new Map(env);
      node.typeParameters?.forEach((param, index) => {
        const symbol = module.checker.getSymbolAtLocation(param.name);
        const value = args[index] ?? (param.default ? { module, node: param.default, env } : null);
        if (symbol && value) local.set(symbol, value);
      });
      return evaluate(module, node, path, local, seen);
    }
    return evaluate(module, node, path, env, seen, args);
  };

  const evaluate = (
    module: TypeModule,
    node: ts.Node,
    path: string[],
    env: Environment,
    seen: Set<ts.Node>,
    args: TypeArgument[] = []
  ): Fact => {
    if (++steps > 1000 || seen.has(node)) return null;
    const next = new Set(seen).add(node);
    const read = (node: ts.Node, keys = path): Fact => evaluate(module, node, keys, env, next);
    if (ts.isIdentifier(node))
      return declaration(module, module.checker.getSymbolAtLocation(node), path, env, next, args);
    if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
      const name = ts.isTypeReferenceNode(node) ? node.typeName : node.expression;
      const typeArgs = node.typeArguments?.map((node) => ({ module, node, env })) ?? [];
      if (ts.isIdentifier(name)) {
        const symbol = module.checker.getSymbolAtLocation(name);
        const imported = symbol?.declarations?.[0];
        // Solid's wrappers preserve the supplied props. Do not need to load
        // the renderer's external declaration graph just to inspect them.
        if (imported && ts.isImportSpecifier(imported)) {
          const source = sourceOf(imported);
          if (
            source &&
            solidSource.test(source) &&
            ["ParentProps", "FlowProps"].includes((imported.propertyName ?? imported.name).text)
          ) {
            return node.typeArguments?.[0] ? read(node.typeArguments[0]) : null;
          }
        }
        if (
          !symbol?.declarations?.length &&
          ["Readonly", "Partial", "Required"].includes(name.text)
        ) {
          return node.typeArguments?.[0] ? read(node.typeArguments[0]) : null;
        }
        return declaration(module, symbol, path, env, next, typeArgs);
      }
      if (ts.isQualifiedName(name) && ts.isIdentifier(name.left)) {
        const imported = module.checker.getSymbolAtLocation(name.left)?.declarations?.[0];
        const source = imported && ts.isNamespaceImport(imported) && sourceOf(imported);
        const target = source && loadImport(source, module.source.fileName);
        return target ? exported(target, name.right.text, path, env, next, typeArgs) : null;
      }
      return null;
    }
    if (ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isExportSpecifier(node)) {
      const source = sourceOf(node);
      if (!source && ts.isExportSpecifier(node)) {
        return declaration(
          module,
          module.checker.getExportSpecifierLocalTargetSymbol(node),
          path,
          env,
          next,
          args
        );
      }
      const target = source && loadImport(source, module.source.fileName);
      const name = ts.isImportClause(node) ? "default" : (node.propertyName ?? node.name).text;
      return target ? exported(target, name, path, env, next, args) : null;
    }
    if (ts.isPropertyAccessExpression(node))
      return read(node.expression, [node.name.text, ...path]);
    if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression;
      return ts.isStringLiteralLike(key) || ts.isNumericLiteral(key)
        ? read(node.expression, [key.text, ...path])
        : null;
    }
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      return node.type ? read(node.type) : node.initializer ? read(node.initializer) : null;
    }
    if (ts.isTypeAliasDeclaration(node) || ts.isParenthesizedTypeNode(node)) return read(node.type);
    if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))
      return read(node.expression);
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return read(node.type);
    if (ts.isUnionTypeNode(node)) return combine(node.types.map((type) => read(type)));
    if (ts.isIntersectionTypeNode(node)) {
      const known = node.types.map((type) => read(type)).filter((value) => value !== null);
      return known.length ? combine(known) : null;
    }
    if (ts.isTypeLiteralNode(node) || ts.isInterfaceDeclaration(node)) {
      if (!path.length) return null;
      const member = node.members.find(
        (member) =>
          member.name &&
          (ts.isIdentifier(member.name) ||
            ts.isStringLiteralLike(member.name) ||
            ts.isNumericLiteral(member.name)) &&
          member.name.text === path[0]
      );
      if (member && ts.isPropertySignature(member) && member.type)
        return read(member.type, path.slice(1));
      if (member && ts.isMethodSignature(member) && path.length === 1 && member.type) {
        return read(member.type, []) === "void" ? "callback" : null;
      }
      if (ts.isInterfaceDeclaration(node)) {
        const inherited =
          node.heritageClauses
            ?.flatMap((clause) => clause.types.map((type) => read(type)))
            .filter((value) => value !== null) ?? [];
        return inherited.length ? combine(inherited) : null;
      }
      return null;
    }
    if (ts.isArrayTypeNode(node) && path.length && /^\d+$/.test(path[0]))
      return read(node.elementType, path.slice(1));
    if (path.length) return null;
    if (ts.isFunctionTypeNode(node)) return read(node.type, []) === "void" ? "callback" : null;
    if (ts.isLiteralTypeNode(node)) return read(node.literal);
    if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword)
      return "nullish";
    if (node.kind === ts.SyntaxKind.VoidKeyword) return "void";
    if (
      [
        ts.SyntaxKind.StringKeyword,
        ts.SyntaxKind.NumberKeyword,
        ts.SyntaxKind.BooleanKeyword,
        ts.SyntaxKind.BigIntKeyword,
        ts.SyntaxKind.SymbolKeyword,
        ts.SyntaxKind.TrueKeyword,
        ts.SyntaxKind.FalseKeyword,
      ].includes(node.kind) ||
      ts.isLiteralExpression(node)
    )
      return "scalar";
    return null;
  };

  return (range: readonly [number, number]): "scalar" | "callback" | null => {
    if (!hasCompilerApi) return null;
    const key = `${range[0]}:${range[1]}`;
    if (!facts.has(key)) {
      const module = initialize();
      const node = nodes.get(key);
      steps = 0;
      facts.set(key, node ? evaluate(module, node, [], new Map(), new Set()) : null);
    }
    const fact = facts.get(key);
    return fact === "nullish" ? "scalar" : fact === "scalar" || fact === "callback" ? fact : null;
  };
}
