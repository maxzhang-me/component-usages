import ts from 'typescript';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseTemplate, NodeTypes } from '@vue/compiler-dom';
import path from 'node:path';
const p = path.posix;
export const componentFile = /\.(vue|svelte|astro|tsx|jsx)$/i;
export interface Source { path: string; text: string; root: string }
export interface Usage { path: string; start: number; length: number; tag: string; lineText: string }
interface Binding { source: string; imported: string }
interface Tag { name: string; start: number; length: number }
interface Module { source: Source; bindings: Map<string, Binding>; exports: Map<string, Binding>; stars: string[]; tags: Tag[]; globals: { name: string; binding: Binding }[] }
export interface Config { dir: string; baseUrl: string; paths: Record<string, string[]> }
export interface Options { aliases?: Record<string, string>; globals?: Record<string, string>; autoDirs?: string[]; configs?: Config[] }
const canonical = (name: string) => name.replace(/[-_]/g, '').toLowerCase();
const pascal = (name: string) => name.replace(/(^|[-_/])(\w)/g, (_, _a, b: string) => b.toUpperCase());
function scriptModules(text: string, file: string): { text: string; offset: number }[] {
  if (file.endsWith('.vue')) {
    const { descriptor } = parseSfc(text, { filename: file });
    return [descriptor.script, descriptor.scriptSetup].filter(Boolean).map(s => ({ text: s!.content, offset: s!.loc.start.offset }));
  }
  if (file.endsWith('.svelte')) return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/g)].map(m => ({ text: m[1], offset: m.index! + m[0].indexOf('>') + 1 }));
  if (file.endsWith('.astro')) { const m = /^(?:\uFEFF)?---\s*\r?\n([\s\S]*?)\r?\n---/.exec(text); return m ? [{ text: m[1], offset: m[0].indexOf('\n') + 1 }] : []; }
  return [{ text, offset: 0 }];
}
const nuxtDeclaration = /\/\.nuxt\/(?:types\/)?components\.d\.ts$/;
function nuxtScope(file: string): string | undefined {
  return nuxtDeclaration.test(file) ? file.slice(0, file.lastIndexOf('/.nuxt/')) : undefined;
}
// Read the declared import structurally, including LazyComponent<T>/IslandComponent<T>.
function componentTypeBinding(node: ts.TypeNode): Binding | undefined {
  if (ts.isParenthesizedTypeNode(node)) return componentTypeBinding(node.type);
  if (ts.isTypeReferenceNode(node)) {
    for (const arg of node.typeArguments ?? []) { const found = componentTypeBinding(arg); if (found) return found; }
  }
  if (ts.isIndexedAccessTypeNode(node) && ts.isImportTypeNode(node.objectType) && ts.isLiteralTypeNode(node.indexType) && ts.isStringLiteral(node.indexType.literal)) {
    const imported = componentTypeBinding(node.objectType);
    if (imported) return { ...imported, imported: node.indexType.literal.text };
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
    return { source: node.argument.literal.text, imported: node.qualifier?.getText() ?? 'default' };
  }
  return undefined;
}
function analyze(source: Source): Module {
  const { text, path: file } = source;
  const mod: Module = { source, bindings: new Map(), exports: new Map(), stars: [], tags: [], globals: [] };
  for (const script of scriptModules(text, file)) {
    const ast = ts.createSourceFile(file + '.tsx', script.text, ts.ScriptTarget.Latest, true, /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const stmt of ast.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.importClause && !stmt.importClause.isTypeOnly) {
        const src = stmt.moduleSpecifier.text, clause = stmt.importClause;
        if (clause.name) mod.bindings.set(clause.name.text, { source: src, imported: 'default' });
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const b of clause.namedBindings.elements) {
          if (!b.isTypeOnly) mod.bindings.set(b.name.text, { source: src, imported: b.propertyName?.text ?? b.name.text });
        }
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) mod.bindings.set(clause.namedBindings.name.text, { source: src, imported: '*' });
      }
      if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
        const src = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : '';
        if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) for (const b of stmt.exportClause.elements) {
          if (!b.isTypeOnly) mod.exports.set(b.name.text, { source: src, imported: b.propertyName?.text ?? b.name.text });
        }
        else if (src) mod.stars.push(src);
      }
    }
    // Async/lazy component bindings, including Vue defineAsyncComponent and React.lazy.
    const visit = (node: ts.Node) => {
      if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) mod.exports.set('default', {source:'', imported:node.expression.text});
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'component' && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0]) && ts.isIdentifier(node.arguments[1])) {
        const b = mod.bindings.get(node.arguments[1].text);
        if (b) mod.globals.push({name:node.arguments[0].text, binding:b});
      }
      if (ts.isInterfaceDeclaration(node) && (node.name.text === 'GlobalComponents' || (nuxtDeclaration.test(file) && node.name.text === '_GlobalComponents'))) {
        for (const prop of node.members) if (ts.isPropertySignature(prop) && prop.name && prop.type) {
          const binding = componentTypeBinding(prop.type);
          if (binding) mod.globals.push({ name: ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText(ast), binding });
        }
      }
      if (nuxtDeclaration.test(file) && ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const decl of node.declarationList.declarations) if (ts.isIdentifier(decl.name) && decl.type) {
          const binding = componentTypeBinding(decl.type);
          if (binding) { mod.globals.push({name:decl.name.text,binding}); mod.exports.set(decl.name.text,binding); }
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        let spec: string | undefined;
        const findImport = (n: ts.Node) => {
          if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) spec = n.arguments[0].text;
          ts.forEachChild(n, findImport);
        };
        findImport(node.initializer);
        if (spec) mod.bindings.set(node.name.text, { source: spec, imported: 'default' });
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        mod.tags.push({ name: node.tagName.getText(ast), start: script.offset + node.tagName.getStart(ast), length: node.tagName.getWidth(ast) });
      }
      // Options API component registration aliases: components: { 'app-card': ImportedCard }.
      if (ts.isPropertyAssignment(node) && node.name.getText(ast).replace(/['"]/g, '') === 'components' && ts.isObjectLiteralExpression(node.initializer)) {
        for (const prop of node.initializer.properties) if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer)) {
          const b = mod.bindings.get(prop.initializer.text);
          if (b) mod.bindings.set(prop.name.getText(ast).replace(/['"]/g, ''), b);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  if (file.endsWith('.vue')) {
    const { descriptor } = parseSfc(text, { filename: file });
    const template = descriptor.template;
    if (template && (!template.lang || template.lang === 'html')) {
      const ast = parseTemplate(template.content, { onError: () => {} });
      const walk = (node: any) => {
        if (node.type === NodeTypes.ELEMENT) {
          const start = template.loc.start.offset + node.loc.start.offset + 1;
          if (node.tag !== 'component') mod.tags.push({ name: node.tag, start, length: node.tag.length });
          else for (const attr of node.props) {
            if (attr.type === NodeTypes.ATTRIBUTE && attr.name === 'is' && attr.value) mod.tags.push({ name: attr.value.content, start: template.loc.start.offset + attr.value.loc.start.offset + 1, length: attr.value.content.length });
            if (attr.type === NodeTypes.DIRECTIVE && attr.name === 'bind' && attr.arg?.content === 'is' && attr.exp) {
              const value = attr.exp.content.trim();
              if (/^[\w.$-]+$/.test(value)) mod.tags.push({ name: value, start: template.loc.start.offset + attr.exp.loc.start.offset, length: value.length });
              else if (/^(['"])[\w-]+\1$/.test(value)) mod.tags.push({ name: value.slice(1, -1), start: template.loc.start.offset + attr.exp.loc.start.offset + 1, length: value.length - 2 });
            }
          }
        }
        if (node.children) node.children.forEach(walk);
      };
      walk(ast);
    }
  } else if (/\.(svelte|astro)$/.test(file)) {
    // Preserve offsets while ignoring comments, script/style bodies and Astro frontmatter.
    let masked = text.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/g, m => ' '.repeat(m.length));
    if (file.endsWith('.astro')) masked = masked.replace(/^(?:\uFEFF)?---\s*\r?\n[\s\S]*?\r?\n---/, m => ' '.repeat(m.length));
    for (const m of masked.matchAll(/<([A-Za-z_$][\w.$-]*)(?=[\s/>])/g)) mod.tags.push({ name: m[1], start: m.index! + 1, length: m[1].length });
  }
  return mod;
}
export class ProjectIndex {
  private modules = new Map<string, Module>();
  private usages = new Map<string, Usage[]>();
  constructor(sources: Source[], private options: Options = {}) {
    for (const s of sources) this.modules.set(p.normalize(s.path), analyze(s));
    this.build();
  }
  private resolve(from: string, specifier: string): string | undefined {
    const clean = specifier.replace(/[?#].*$/, '');
    const mod = this.modules.get(from)!;
    const candidates: string[] = [];
    if (clean.startsWith('.')) candidates.push(p.resolve(p.dirname(from), clean));
    else if (clean.startsWith('/') || /^[A-Za-z]:[\\/]/.test(clean)) {
      const absolute = clean.replace(/\\/g, '/').replace(/^([A-Za-z]:)/, '/$1');
      const uriPrefix = /^\/[^/]*%3A[^/]*/i.exec(mod.source.root)?.[0] ?? '';
      candidates.push(uriPrefix + absolute, absolute, p.join(mod.source.root, clean));
    }
    else {
      for (const [key, value] of Object.entries(this.options.aliases ?? {})) {
        if (clean === key || clean.startsWith(key + '/')) candidates.push(p.resolve(mod.source.root, value, clean.slice(key.length).replace(/^\//, '')));
      }
      const config = this.options.configs?.filter(c => from.startsWith(c.dir + '/')).sort((a, b) => b.dir.length - a.dir.length || Object.keys(b.paths).length - Object.keys(a.paths).length)[0];
      if (config) {
        for (const [key, values] of Object.entries(config.paths)) {
          const at = key.indexOf('*');
          const match = at < 0 ? clean === key : clean.startsWith(key.slice(0, at)) && clean.endsWith(key.slice(at + 1));
          if (match) for (const value of values) candidates.push(p.resolve(config.baseUrl, at < 0 ? value : value.replace('*', clean.slice(at, key.length - at - 1 ? -(key.length - at - 1) : undefined))));
        }
        candidates.push(p.resolve(config.baseUrl, clean));
      }
    }
    for (const c of candidates) {
      const variants = [c, ...['.vue','.svelte','.astro','.tsx','.jsx','.ts','.js','.mts','.mjs','.cts','.cjs'].flatMap(ext => [c + ext, p.join(c, 'index' + ext)])];
      // TS projects commonly import .js while source is .ts/.tsx.
      if (/\.[cm]?js$/.test(c)) variants.push(c.replace(/\.[cm]?js$/, '.ts'), c.replace(/\.js$/, '.tsx'));
      for (const v of variants) if (this.modules.has(v)) return v;
    }
    return undefined;
  }
  private follow(from: string, binding: Binding, seen = new Set<string>()): string | undefined {
    if (binding.source === '#components') {
      const declaration = [...this.modules.keys()].filter(file => {
        const scope = nuxtScope(file);
        return scope && from.startsWith(scope + '/') && this.modules.get(file)!.exports.has(binding.imported);
      }).sort((a,b) => nuxtScope(b)!.length - nuxtScope(a)!.length)[0];
      if (declaration) return this.follow(declaration, this.modules.get(declaration)!.exports.get(binding.imported)!, seen);
    }
    const file = binding.source ? this.resolve(from, binding.source) : from;
    if (!file) return;
    const key = file + '#' + binding.imported;
    if (seen.has(key)) return;
    seen.add(key);
    if (componentFile.test(file)) return file;
    const m = this.modules.get(file)!;
    const exported = m.exports.get(binding.imported);
    if (exported) {
      if (exported.source) return this.follow(file, exported, seen);
      const local = m.bindings.get(exported.imported);
      if (local) return this.follow(file, local, seen);
    }
    if (binding.imported !== 'default') for (const star of m.stars) {
      const found = this.follow(file, { source: star, imported: binding.imported }, new Set(seen));
      if (found) return found;
    }
    return undefined;
  }
  private build() {
    const registered = new Map<string, {name:string;target:string}[]>();
    for (const [file, mod] of this.modules) for (const entry of mod.globals) {
      const target = this.follow(file, entry.binding);
      if (target) { const list = registered.get(nuxtScope(file) ?? mod.source.root) ?? []; list.push({name:entry.name,target}); registered.set(nuxtScope(file) ?? mod.source.root,list); }
    }
    const globalsByRoot = new Map<string, Map<string, Set<string>>>();
    for (const [file, mod] of this.modules) {
      const scopes = [...registered.keys()].filter(scope => file.startsWith(scope + '/')).sort((a,b) => a.length-b.length);
      const cacheKey = mod.source.root + ':' + scopes.join(':');
      let globals = globalsByRoot.get(cacheKey);
      if (!globals) {
      globals = new Map<string, Set<string>>();
      const add = (name: string, target: string) => { const k = canonical(name); const set = globals!.get(k) ?? new Set<string>(); set.add(target); globals!.set(k, set); };
      for (const scope of scopes) {
        const scoped = new Map<string, Set<string>>();
        for (const entry of registered.get(scope)!) {
          const key = canonical(entry.name); const targets = scoped.get(key) ?? new Set<string>(); targets.add(entry.target); scoped.set(key,targets);
        }
        for (const [name, targets] of scoped) globals.set(name, targets);
      }
      for (const [name, relative] of Object.entries(this.options.globals ?? {})) {
        const target = p.resolve(mod.source.root, relative);
        if (this.modules.has(target)) add(name, target);
      }
      for (const dir of this.options.autoDirs ?? []) {
        const prefix = p.resolve(mod.source.root, dir) + '/';
        for (const target of this.modules.keys()) if (target.startsWith(prefix) && componentFile.test(target)) {
          const relative = target.slice(prefix.length).replace(/\.[^.]+$/, '').replace(/\/index$/, '');
          add(pascal(relative), target); add(pascal(p.basename(relative)), target);
        }
      }
      // Explicit mappings override convention-based candidates, including ambiguous names.
      for (const [name, relative] of Object.entries(this.options.globals ?? {})) {
        const target = p.resolve(mod.source.root, relative);
        if (this.modules.has(target)) globals.set(canonical(name), new Set([target]));
      }
      globalsByRoot.set(cacheKey, globals);
      }
      for (const tag of mod.tags) {
        let binding = mod.bindings.get(tag.name);
        if (!binding) binding = [...mod.bindings].find(([name]) => canonical(name) === canonical(tag.name))?.[1];
        const [namespace, member] = tag.name.split('.');
        if (!binding && member && mod.bindings.get(namespace)?.imported === '*') binding = { source: mod.bindings.get(namespace)!.source, imported: member };
        let target = binding ? this.follow(file, binding) : undefined;
        if (!binding) { const set = globals.get(canonical(tag.name)); if (set?.size === 1) target = [...set][0]; }
        if (!target) continue;
        const list = this.usages.get(target) ?? [];
        const lineStart = mod.source.text.lastIndexOf('\n', tag.start) + 1;
        const lineEnd = mod.source.text.indexOf('\n', tag.start);
        list.push({ path: file, start: tag.start, length: tag.length, tag: tag.name, lineText: mod.source.text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim() });
        this.usages.set(target, list);
      }
    }
  }
  find(file: string): Usage[] { return (this.usages.get(file) ?? []).slice().sort((a, b) => a.path.localeCompare(b.path) || a.start - b.start); }
}
export function parseConfig(file: string, text: string): Config | undefined {
  const parsed = ts.parseConfigFileTextToJson(file, text);
  if (parsed.error) return;
  const opts = parsed.config?.compilerOptions ?? {};
  return { dir: p.dirname(file), baseUrl: p.resolve(p.dirname(file), opts.baseUrl ?? '.'), paths: opts.paths ?? {} };
}

export function resolveConfigs(files: Map<string, string>): Config[] {
  const cache = new Map<string, Config>();
  const load = (file: string, seen = new Set<string>()): Config | undefined => {
    if (cache.has(file)) return cache.get(file);
    if (seen.has(file) || !files.has(file)) return;
    seen.add(file);
    const parsed = ts.parseConfigFileTextToJson(file, files.get(file)!).config;
    if (!parsed) return;
    let parent: Config | undefined;
    for (const ref of Array.isArray(parsed.extends) ? parsed.extends : [parsed.extends]) {
      if (typeof ref !== 'string' || !ref.startsWith('.')) continue;
      let target = p.resolve(p.dirname(file), ref);
      if (!files.has(target)) target += '.json';
      parent = load(target, new Set(seen)) ?? parent;
    }
    const own = parseConfig(file, files.get(file)!)!;
    const opts = parsed.compilerOptions ?? {};
    const baseUrl = opts.baseUrl !== undefined ? own.baseUrl : parent?.baseUrl ?? own.baseUrl;
    const config: Config = { dir: own.dir, baseUrl, paths: opts.paths ?? parent?.paths ?? {} };
    cache.set(file, config);
    return config;
  };
  return [...files.keys()].map(file => load(file)).filter((x): x is Config => !!x);
}
