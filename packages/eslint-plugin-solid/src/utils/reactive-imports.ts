import ts from "typescript";
import { createReactiveTypeResolver } from "./reactive-types";
import {
  Value,
  object,
  scalar,
  setter,
  container,
  asStore,
  propertyValue,
  mergeValues,
  awaitedValue,
  promiseValue,
  callResult,
  propertiesOf,
} from "./reactive-values";

interface Module {
  source: ts.SourceFile;
  checker: ts.TypeChecker;
}

/**
 * Follow return values in local source modules. Each module is bound on its
 * own, without libraries or dependencies, solely to resolve lexical bindings.
 * This does not type-check a project or execute the imported code, and works
 * in Oxlint without typescript-eslint's parser services.
 *
 * Caches live for one linted file so editor runs cannot retain stale sources.
 * File/step limits bound work on cyclic or unusually large module graphs.
 */
export function createReactiveImportResolver(filename: string, solidSource: RegExp, text: string) {
  const modules = new Map<string, Module | null>();
  let resolutionOptions: ts.CompilerOptions | undefined;
  let steps = 0;

  const load = (file: string): Module | null => {
    if (modules.has(file)) return modules.get(file)!;
    if (modules.size >= 32) return null;
    modules.set(file, null);
    const options: ts.CompilerOptions = {
      allowJs: true,
      noLib: true,
      noResolve: true,
      types: [],
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
    };
    const host = ts.createCompilerHost(options);
    // No full program graph: the checker is only used for this file's symbols.
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion) =>
      name === file ? getSourceFile(name, languageVersion) : undefined;
    const program = ts.createProgram([file], options, host);
    const source = program.getSourceFile(file);
    if (!source || program.getSyntacticDiagnostics(source).length) return null;
    const module = { source, checker: program.getTypeChecker() };
    modules.set(file, module);
    return module;
  };

  const resolveFile = (specifier: string, from: string): string | undefined => {
    // The browser standalone build and virtual lint inputs have no file graph.
    if (!ts.sys?.fileExists || !filename || !ts.sys.fileExists(filename)) return undefined;
    if (!resolutionOptions) {
      const config = ts.findConfigFile(filename, ts.sys.fileExists);
      resolutionOptions = config
        ? ts.getParsedCommandLineOfConfigFile(
            config,
            {},
            {
              ...ts.sys,
              onUnRecoverableConfigFileDiagnostic() {},
            }
          )?.options
        : undefined;
      resolutionOptions ??= { moduleResolution: ts.ModuleResolutionKind.NodeJs, allowJs: true };
    }
    const resolved = ts.resolveModuleName(
      specifier,
      from,
      resolutionOptions,
      ts.sys
    ).resolvedModule;
    // Library implementations are an explicit knowledge boundary. Do not crawl
    // node_modules or mistake declarations for an implementation.
    if (
      !resolved ||
      resolved.isExternalLibraryImport ||
      /(?:^|[/\\])node_modules[/\\]|\.d\.[cm]?ts$/.test(resolved.resolvedFileName)
    ) {
      return undefined;
    }
    return resolved.resolvedFileName;
  };

  const importSource = (node: ts.Node): string | null => {
    for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) {
      if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
        return parent.moduleSpecifier && ts.isStringLiteral(parent.moduleSpecifier)
          ? parent.moduleSpecifier.text
          : null;
      }
    }
    return null;
  };

  const imported = (
    source: string,
    name: string,
    from: string,
    args: Value[] | undefined,
    seen: Set<ts.Node>
  ): Value => {
    if (++steps > 1000) return null;
    if (
      args &&
      source === "@tanstack/solid-query" &&
      (name === "useQuery" || name === "useInfiniteQuery")
    )
      return object;
    if (args && solidSource.test(source)) {
      if (name === "createSignal" || name === "createOptimistic") {
        return container([
          ["0", { kind: "accessor", result: args[0] ?? null }],
          ["1", setter],
        ]);
      }
      if (name === "createMemo") return { kind: "accessor", result: null };
      if (name === "createStore" || name === "createOptimisticStore") {
        return container([
          ["0", asStore(args[0] ?? args[1] ?? null)],
          ["1", setter],
        ]);
      }
      if (name === "createProjection") return asStore(args[1] ?? null);
      if (name === "omit") return args[0] ?? null;
      if (name === "merge") return args.reduce(mergeValues, null);
    }
    const file = resolveFile(source, from);
    const module = file ? load(file) : null;
    if (!module) return null;
    const symbol = module.checker.getSymbolAtLocation(module.source);
    const exported =
      symbol && module.checker.getExportsOfModule(symbol).find((s) => s.name === name);
    if (exported) return evaluateSymbol(module, exported, args, new Map(), seen);
    // The single-file binder cannot expand export-star declarations itself.
    if (name !== "default") {
      for (const statement of module.source.statements) {
        if (ts.isExportDeclaration(statement) && !statement.exportClause && !statement.isTypeOnly) {
          const source = importSource(statement);
          if (!source || seen.has(statement)) continue;
          const value = imported(
            source,
            name,
            module.source.fileName,
            args,
            new Set(seen).add(statement)
          );
          if (value) return value;
        }
      }
    }
    return null;
  };

  const evaluateSymbol = (
    module: Module,
    symbol: ts.Symbol | undefined,
    args: Value[] | undefined,
    env: Map<ts.Symbol, Value>,
    seen: Set<ts.Node>
  ): Value => {
    if (!symbol) return null;
    if (env.has(symbol)) {
      const value = env.get(symbol)!;
      return args ? callResult(value) : value;
    }
    const declarations = symbol.declarations ?? [];
    const declaration =
      declarations.find((d) => ts.isFunctionDeclaration(d) && d.body) ?? declarations[0];
    return declaration ? evaluate(module, declaration, args, env, seen) : null;
  };

  const evaluate = (
    module: Module,
    node: ts.Node,
    args: Value[] | undefined,
    env: Map<ts.Symbol, Value>,
    seen: Set<ts.Node>
  ): Value => {
    if (++steps > 1000 || seen.has(node)) return null;
    const next = new Set(seen).add(node);
    const valueOf = (node: ts.Node): Value => evaluate(module, node, undefined, env, next);
    if (ts.isAwaitExpression(node)) {
      const value = awaitedValue(valueOf(node.expression));
      return args ? callResult(value) : value;
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression?.(node)
    ) {
      return evaluate(module, node.expression, args, env, next);
    }
    if (ts.isIdentifier(node))
      return evaluateSymbol(module, module.checker.getSymbolAtLocation(node), args, env, next);
    if (ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isExportSpecifier(node)) {
      if (node.isTypeOnly) return null;
      const source = importSource(node);
      if (source) {
        const name = ts.isImportClause(node) ? "default" : (node.propertyName ?? node.name).text;
        return imported(source, name, module.source.fileName, args, next);
      }
      if (ts.isExportSpecifier(node)) {
        return evaluateSymbol(
          module,
          module.checker.getExportSpecifierLocalTargetSymbol(node),
          args,
          env,
          next
        );
      }
    }
    if (ts.isExportAssignment(node)) return evaluate(module, node.expression, args, env, next);
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (!(node.parent.flags & ts.NodeFlags.Const)) return null;
      return evaluate(module, node.initializer, args, env, next);
    }
    if (
      ts.isBindingElement(node) &&
      ts.isArrayBindingPattern(node.parent) &&
      ts.isVariableDeclaration(node.parent.parent)
    ) {
      const tuple = valueOf(node.parent.parent);
      const value = propertyValue(tuple, String(node.parent.elements.indexOf(node)));
      return args ? callResult(value) : value;
    }
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      if (!args || !node.body || node.asteriskToken) return null;
      const wrap = (value: Value): Value =>
        ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async ? promiseValue(value) : value;
      const local = new Map(env);
      node.parameters.forEach((param, index) => {
        if (ts.isIdentifier(param.name)) {
          const symbol = module.checker.getSymbolAtLocation(param.name);
          if (symbol)
            local.set(
              symbol,
              args[index] ?? (param.initializer ? valueOf(param.initializer) : null)
            );
        }
      });
      if (!ts.isBlock(node.body)) return wrap(evaluate(module, node.body, undefined, local, next));
      let result: Value = null;
      const visit = (child: ts.Node): void => {
        if (ts.isFunctionLike(child) || ts.isClassLike(child)) return;
        if (ts.isReturnStatement(child) && child.expression) {
          result = mergeValues(result, evaluate(module, child.expression, undefined, local, next));
        } else ts.forEachChild(child, visit);
      };
      visit(node.body);
      return wrap(result);
    }
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Promise" &&
        node.expression.name.text === "resolve" &&
        !module.checker.getSymbolAtLocation(node.expression.expression)?.declarations?.length
      ) {
        return args ? null : promiseValue(node.arguments[0] ? valueOf(node.arguments[0]) : null);
      }
      const value = evaluate(module, node.expression, node.arguments.map(valueOf), env, next);
      return args ? callResult(value) : value;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression) ||
          ts.isNumericLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
      if (key !== null && ts.isIdentifier(node.expression)) {
        const declaration = module.checker.getSymbolAtLocation(node.expression)?.declarations?.[0];
        if (declaration && ts.isNamespaceImport(declaration)) {
          const source = importSource(declaration);
          if (source) return imported(source, key, module.source.fileName, args, next);
        }
      }
      const value = propertyValue(valueOf(node.expression), key);
      return args ? callResult(value) : value;
    }
    if (args) return null;
    if (ts.isObjectLiteralExpression(node)) {
      const properties = new Map<string, Value>();
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          const value = valueOf(property.expression);
          for (const [key, entry] of propertiesOf(value)) properties.set(key, entry);
        } else if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
          properties.set(property.name.text, valueOf(property.initializer));
        } else if (ts.isShorthandPropertyAssignment(property)) {
          properties.set(
            property.name.text,
            evaluateSymbol(
              module,
              module.checker.getShorthandAssignmentValueSymbol(property),
              undefined,
              env,
              next
            )
          );
        }
      }
      return { kind: "plain", properties };
    }
    if (ts.isArrayLiteralExpression(node))
      return container(node.elements.map((element, i) => [String(i), valueOf(element)]));
    if (ts.isConditionalExpression(node))
      return mergeValues(valueOf(node.whenTrue), valueOf(node.whenFalse));
    if (ts.isBinaryExpression(node)) {
      return [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(node.operatorToken.kind)
        ? mergeValues(valueOf(node.left), valueOf(node.right))
        : scalar;
    }
    if (
      ts.isLiteralExpression(node) ||
      ts.isTemplateExpression(node) ||
      ts.isPrefixUnaryExpression(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword
    )
      return scalar;
    return null;
  };

  return {
    value(source: string, name: string, args?: Value[]): Value {
      steps = 0;
      return imported(source, name, filename, args, new Set());
    },
    type: createReactiveTypeResolver(
      filename,
      text,
      (source, from) => {
        const file = resolveFile(source, from);
        return file ? load(file) : null;
      },
      solidSource
    ),
  };
}
