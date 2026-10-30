import * as vscode from 'vscode';
import { ProjectIndex, Source, Usage, componentFile, resolveConfigs } from './analyzer';
const section = 'componentUsages';
const cfg = () => vscode.workspace.getConfiguration(section);
const zh = () => cfg().get('language') === 'zh-cn' || (cfg().get('language') === 'auto' && vscode.env.language.toLowerCase().startsWith('zh'));
const tr = (cn: string, en: string) => zh() ? cn : en;
const supported = (doc: vscode.TextDocument) => componentFile.test(doc.uri.path);
class IndexService implements vscode.Disposable {
  readonly changed = new vscode.EventEmitter<void>();
  private snapshot?: { index: ProjectIndex; uris: Map<string, vscode.Uri>; partial: boolean };
  private pending?: Promise<NonNullable<IndexService['snapshot']>>;
  private revision = 0;
  private metadataWatchers = new Map<string, vscode.FileSystemWatcher>();
  private watchNuxt(uri: vscode.Uri) {
    // Non-recursive watches keep generated declarations observable even when
    // the rest of .nuxt is excluded from recursive workspace watching.
    for (const dir of [uri, vscode.Uri.joinPath(uri, 'types')]) {
      const key = dir.toString();
      if (this.metadataWatchers.has(key)) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, 'components.d.ts'));
      watcher.onDidChange(() => this.invalidate()); watcher.onDidCreate(() => this.invalidate()); watcher.onDidDelete(() => this.invalidate());
      this.metadataWatchers.set(key, watcher);
    }
  }
  private timer?: ReturnType<typeof setTimeout>;
  readonly output = vscode.window.createOutputChannel('Component Usages');
  invalidate() {
    this.revision++; this.snapshot = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed.fire(), 350);
  }
  async get(): Promise<{ index: ProjectIndex; uris: Map<string, vscode.Uri>; partial: boolean }> {
    if (this.snapshot) return this.snapshot;
    if (this.pending) { await this.pending; return this.get(); }
    const revision = this.revision;
    const task = this.build(); this.pending = task;
    try {
      const result = await task;
      if (revision === this.revision) this.snapshot = result;
    } finally { if (this.pending === task) this.pending = undefined; }
    return this.get();
  }
  private async build() {
    const started = Date.now();
    const max = cfg().get<number>('maxFiles', 15000);
    const exclude = cfg().get<string>('exclude')!;
    const uris = await vscode.workspace.findFiles(cfg().get<string>('include')!, exclude, max + 1);
    let partial = uris.length > max;
    const selected = new Map(uris.slice(0, max).map(uri => [uri.toString(), uri]));
    // Nuxt's declarations are metadata, not build output to search for usages.
    // Read just these files even though .nuxt is excluded from the normal scan.
    const metadata = await vscode.workspace.findFiles('**/.nuxt/{components.d.ts,types/components.d.ts}', '**/{node_modules,.git,vendor}/**');
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const dir = vscode.Uri.joinPath(folder.uri, '.nuxt'); this.watchNuxt(dir);
      for (const suffix of ['components.d.ts', 'types/components.d.ts']) {
        const uri = vscode.Uri.joinPath(dir, suffix);
        try { await vscode.workspace.fs.stat(uri); metadata.push(uri); } catch { /* Nuxt may not have generated the declaration yet. */ }
      }
    }
    for (const uri of metadata) {
      selected.set(uri.toString(), uri);
      const dirPath = uri.path.slice(0, uri.path.lastIndexOf('/.nuxt/') + '/.nuxt'.length);
      this.watchNuxt(uri.with({path:dirPath}));
    }
    // Open buffers are overlaid below, after the workspace glob filter.
    const sources: Source[] = [];
    const locations = new Map<string, vscode.Uri>();
    const open = new Map(vscode.workspace.textDocuments.map(d => [d.uri.toString(), d]));
    // Bounded I/O; unsaved editor contents always win over disk.
    const queue = [...selected.values()]; let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(12, queue.length) }, async () => {
      while (cursor < queue.length) {
        const uri = queue[cursor++];
        try {
          const text = open.get(uri.toString())?.getText() ?? new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
          const root = vscode.workspace.getWorkspaceFolder(uri)!.uri.path;
          // Include scheme/authority in the index path to keep remote and multi-root files distinct.
          const key = indexPath(uri);
          sources.push({ path: key, text, root: indexPath(vscode.Uri.from({ scheme: uri.scheme, authority: uri.authority, path: root })) });
          locations.set(key, uri);
        } catch (error) { partial = true; this.output.appendLine(`Cannot index ${uri.toString()}: ${String(error)}`); }
      }
    }));
    const configTexts = new Map<string, string>();
    for (const uri of await vscode.workspace.findFiles('**/{tsconfig,jsconfig}*.json', exclude, 500)) {
      try {
        const text = open.get(uri.toString())?.getText() ?? new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        configTexts.set(indexPath(uri), text);
      } catch (e) { this.output.appendLine(String(e)); }
    }
    const index = new ProjectIndex(sources, { aliases: cfg().get('aliases'), globals: cfg().get('globalComponents'), autoDirs: cfg().get('autoImportDirectories'), configs: resolveConfigs(configTexts) });
    this.output.appendLine(`Indexed ${sources.length} files in ${Date.now() - started}ms${partial ? ' (incomplete)' : ''}`);
    return { index, uris: locations, partial };
  }
  dispose() { if (this.timer) clearTimeout(this.timer); this.metadataWatchers.forEach(w => w.dispose()); this.changed.dispose(); this.output.dispose(); }
}
function indexPath(uri: vscode.Uri) { return '/' + encodeURIComponent(uri.scheme + ':' + uri.authority) + uri.path; }
class LensProvider implements vscode.CodeLensProvider {
  readonly onDidChangeCodeLenses;
  constructor(private service: IndexService) { this.onDidChangeCodeLenses = service.changed.event; }
  async provideCodeLenses(doc: vscode.TextDocument, token: vscode.CancellationToken) {
    if (!cfg().get('enabled') || !supported(doc)) return [];
    let title = tr('显示组件用法', 'Show component usages');
    if (cfg().get('label') === 'count') {
      const result = await this.service.get();
      if (token.isCancellationRequested) return [];
      const n = result.index.find(indexPath(doc.uri)).length;
      title = tr(`${n}${result.partial ? '+' : ''} 处组件用法`, `${n}${result.partial ? '+' : ''} component usage${n === 1 ? '' : 's'}`);
    }
    const lens = new vscode.CodeLens(new vscode.Range(0, 0, 0, 0));
    lens.command = { title, command: 'componentUsages.show', arguments: [doc.uri], tooltip: tr('查找组件的渲染用法；一处直接跳转，多处显示列表。', 'Find component render usages. Jump to a single usage or choose from a list.') };
    return [lens];
  }
}
async function show(service: IndexService, uri?: vscode.Uri, forcePeek = false) {
  uri ??= vscode.window.activeTextEditor?.document.uri;
  if (!uri || !componentFile.test(uri.path)) return;
  if (!vscode.workspace.getWorkspaceFolder(uri)) { void vscode.window.showInformationMessage(tr('请先打开组件所在的工作区文件夹。', 'Open the workspace folder containing this component first.')); return; }
  const targetUri = uri;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: tr('正在查找组件用法…', 'Finding component usages…'), cancellable: true }, async (_, token) => {
    const result = await service.get();
    if (token.isCancellationRequested) return;
    const usages = result.index.find(indexPath(targetUri));
    if (result.partial) void vscode.window.showWarningMessage(tr('用法索引不完整：已达到文件上限或有文件无法读取。请调整 maxFiles / exclude，详情见输出面板。', 'Usage index is incomplete: file limit reached or files could not be read. Adjust maxFiles/exclude; see Output for details.'));
    if (!usages.length) { void vscode.window.showInformationMessage(tr('未找到组件的渲染用法。路径别名或自动导入项目可在 Component Usages 设置中配置。', 'No component render usages found. Configure aliases or auto-import directories in Component Usages settings if needed.')); return; }
    const entries: { usage: Usage; location: vscode.Location }[] = [];
    for (const usage of usages) {
      const sourceUri = result.uris.get(usage.path); if (!sourceUri) continue;
      try {
        const document = await vscode.workspace.openTextDocument(sourceUri);
        entries.push({ usage, location: new vscode.Location(sourceUri, new vscode.Range(document.positionAt(usage.start), document.positionAt(usage.start + usage.length))) });
      } catch (e) { service.output.appendLine(String(e)); }
    }
    if (token.isCancellationRequested || !entries.length) return;
    const open = async (location: vscode.Location, preview: boolean) => {
      const editor = await vscode.window.showTextDocument(location.uri, { preview, selection: location.range });
      editor.revealRange(location.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    };
    if (forcePeek || cfg().get('openMode') === 'peek') {
      await vscode.commands.executeCommand('editor.action.peekLocations', targetUri, new vscode.Position(0, 0), entries.map(e => e.location), 'peek'); return;
    }
    if (entries.length === 1 && cfg().get('singleUsageJump')) { await open(entries[0].location, false); return; }
    type Item = vscode.QuickPickItem & { location: vscode.Location };
    const picker = vscode.window.createQuickPick<Item>();
    picker.title = tr(`组件用法 — ${entries.length} 处`, `Component usages — ${entries.length}`);
    picker.placeholder = tr('输入文件名或代码筛选 · ↑↓ 选择 · Enter 跳转 · Esc 返回', 'Filter by file or code · ↑↓ select · Enter jump · Esc return');
    picker.matchOnDetail = true;
    picker.items = entries.map(({ usage, location }) => ({
      label: usage.lineText,
      detail: `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}:${location.range.start.character + 1}`,
      location
    }));
    // Preview via a button keeps arrow navigation predictable and avoids focus races.
    picker.buttons = [{ iconPath: new vscode.ThemeIcon('references'), tooltip: tr('在编辑器中预览所有用法', 'Peek all usages in editor') }];
    const disposables: vscode.Disposable[] = [];
    disposables.push(picker.onDidAccept(() => { const item = picker.selectedItems[0]; if (item) { picker.hide(); void open(item.location, false); } }));
    disposables.push(picker.onDidTriggerButton(async () => { picker.hide(); await vscode.commands.executeCommand('editor.action.peekLocations', targetUri, new vscode.Position(0, 0), entries.map(e => e.location), 'peek'); }));
    disposables.push(picker.onDidHide(() => { picker.dispose(); disposables.forEach(d => d.dispose()); }));
    // No editor navigation occurs until selection is accepted, so Esc preserves the source.
    picker.show();
  });
}
export function activate(context: vscode.ExtensionContext) {
  const service = new IndexService();
  const provider = new LensProvider(service);
  context.subscriptions.push(service, vscode.languages.registerCodeLensProvider([{ pattern: '**/*.vue' }, { pattern: '**/*.svelte' }, { pattern: '**/*.astro' }, { pattern: '**/*.tsx' }, { pattern: '**/*.jsx' }], provider));
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(watcher, watcher.onDidCreate(() => service.invalidate()), watcher.onDidDelete(() => service.invalidate()), watcher.onDidChange(() => service.invalidate()),
    vscode.workspace.onDidChangeTextDocument(e => { if (/\.(vue|svelte|astro|[cm]?[jt]sx?|json)$/.test(e.document.uri.path)) service.invalidate(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => service.invalidate()),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(section)) service.invalidate(); }),
    vscode.commands.registerCommand('componentUsages.show', (uri?: vscode.Uri) => show(service, uri)),
    vscode.commands.registerCommand('componentUsages.peek', (uri?: vscode.Uri) => show(service, uri, true)),
    vscode.commands.registerCommand('componentUsages.toggle', async () => { await cfg().update('enabled', !cfg().get('enabled'), vscode.ConfigurationTarget.Global); }),
    vscode.commands.registerCommand('componentUsages.refresh', async () => { service.invalidate(); await service.get(); service.changed.fire(); void vscode.window.showInformationMessage(tr('组件用法索引已刷新。', 'Component usages index refreshed.')); })
  );
  return { findUsages: async (uri: vscode.Uri) => (await service.get()).index.find(indexPath(uri)), invalidate: () => service.invalidate() };
}
