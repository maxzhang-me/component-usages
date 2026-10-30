// Exercise the built extension with actual files and polling-based file events, using a small
// VS Code API adapter so this regression also runs in headless CI.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const fsp=fs.promises;
const path=require('node:path');const os=require('node:os');const Module=require('node:module');
const {pathToFileURL}=require('node:url');
test('workspace integration: excluded Nuxt metadata, exact jump, regeneration, deletion',async()=>{
 const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'component-usages-nuxt-'));
 const dialog='components/account/payment/installments_due/autoPayDialog.vue';
 const name='AccountPaymentInstallmentsDueAutoPayDialog';
 const file=path.join(folder,dialog),caller=path.join(folder,'account.vue'),declaration=path.join(folder,'.nuxt/components.d.ts');
 await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.mkdir(path.dirname(declaration),{recursive:true});
 await fsp.writeFile(file,'<template><div/></template>');
 await fsp.writeFile(caller,`<template>\n<${name}\n @refresh="getDetail"\n ref="autoPayRef"\n></${name}>\n</template>`);
 const declarationText=`interface _GlobalComponents {'${name}': typeof import('../${dialog}')['default']}\ndeclare module 'vue' {export interface GlobalComponents extends _GlobalComponents{}}\nexport {}`;
 await fsp.writeFile(declaration,declarationText);
 const disposables=[];const commands=new Map();const documents=[];const findCalls=[];
 class Uri {
  constructor(p,scheme='file',authority=''){this.path=p;this.scheme=scheme;this.authority=authority;this.fsPath=p;}
  toString(){return pathToFileURL(this.path).toString();}
  with(o){return new Uri(o.path??this.path,o.scheme??this.scheme,o.authority??this.authority);}
  static from(o){return new Uri(o.path,o.scheme,o.authority);}
  static joinPath(base,...parts){return new Uri(path.posix.join(base.path,...parts),base.scheme,base.authority);}
 }
 class Position {constructor(line,character){this.line=line;this.character=character;}}
 class Range {constructor(a,b,c,d){this.start=typeof a==='number'?new Position(a,b):a;this.end=typeof a==='number'?new Position(c,d):b;}}
 const event=()=>({dispose(){}});
 class Emitter {constructor(){this.event=event;}fire(){}dispose(){}}
 const defaults=Object.fromEntries(Object.entries(require('../package.json').contributes.configuration.properties).map(([k,v])=>[k.split('.').slice(1).join('.'),v.default]));
 defaults.include='**/*.vue'; // metadata must be read even with a Vue-only include.
 const docFor=async uri=>{
  let doc=documents.find(d=>d.uri.path===uri.path);if(doc)return doc;
  const text=await fsp.readFile(uri.path,'utf8');
  doc={uri,isClosed:false,getText(){return text;},positionAt(offset){const lines=text.slice(0,offset).split('\n');return new Position(lines.length-1,lines.at(-1).length);}};
  documents.push(doc);return doc;
 };
 const vscode={Uri,Position,Range,EventEmitter:Emitter,CodeLens:class{constructor(range){this.range=range;}},Location:class{constructor(uri,range){this.uri=uri;this.range=range;}},ProgressLocation:{Window:10},TextEditorRevealType:{InCenterIfOutsideViewport:1},
  env:{language:'zh-cn'},languages:{registerCodeLensProvider:()=>({dispose(){}})},
  workspace:{workspaceFolders:[{uri:new Uri(folder)}],textDocuments:documents,
   getConfiguration:()=>({get:(k,fallback)=>defaults[k]??fallback}),
   getWorkspaceFolder:uri=>uri.path.startsWith(folder+'/')?{uri:new Uri(folder)}:undefined,
   fs:{stat:async uri=>fsp.stat(uri.path),readFile:async uri=>fsp.readFile(uri.path)},
   openTextDocument:docFor, onDidChangeTextDocument:event,onDidChangeWorkspaceFolders:event,onDidChangeConfiguration:event,
   findFiles:async(include,exclude)=>{
    findCalls.push({include,exclude});
    if(include.includes('tsconfig'))return [];
    if(include.includes('.nuxt')){assert.ok(!exclude.includes('.nuxt'),'metadata search must override the .nuxt exclusion');return fs.existsSync(declaration)?[new Uri(declaration)]:[];}
    assert.ok(exclude.includes('.nuxt'),'normal source scan still excludes .nuxt');return [new Uri(file),new Uri(caller)];
   },
   createFileSystemWatcher:pattern=>{
    const callbacks={change:[],create:[],delete:[]};let watched;let handler;
    if(typeof pattern==='object'&&fs.existsSync(pattern.base.path)) {
     watched=path.join(pattern.base.path,'components.d.ts');
     handler=(now,before)=>{if(now.mtimeMs!==before.mtimeMs||now.size!==before.size||now.nlink!==before.nlink)for(const cb of Object.values(callbacks).flat())cb();};
     fs.watchFile(watched,{interval:25},handler);
    }
    const api={onDidChange:cb=>callbacks.change.push(cb),onDidCreate:cb=>callbacks.create.push(cb),onDidDelete:cb=>callbacks.delete.push(cb),dispose:()=>{if(watched)fs.unwatchFile(watched,handler);}};
    disposables.push(api);return api;
   }
  },
  RelativePattern:class{constructor(base,pattern){this.base=base;this.pattern=pattern;}},
  commands:{registerCommand:(name,fn)=>{commands.set(name,fn);return {dispose(){}};},executeCommand:async(name,...args)=>commands.get(name)?.(...args)},
  window:{createOutputChannel:()=>({appendLine(){},dispose(){}}),withProgress:async(_opts,fn)=>fn({}, {isCancellationRequested:false}),showWarningMessage:msg=>assert.fail(msg),showInformationMessage:msg=>assert.fail(msg),
   showTextDocument:async uriOrDoc=>{const doc=uriOrDoc.uri?uriOrDoc:await docFor(uriOrDoc);const editor={document:doc,revealRange(){}};vscode.window.activeTextEditor=editor;return editor;}
  }
 };
 // Capture selection without involving an editor UI.
 vscode.window.showTextDocument=async(uri,options)=>{const editor={document:await docFor(uri),selection:options?.selection,revealRange(){}};vscode.window.activeTextEditor=editor;return editor;};
 const load=Module._load;let extension;
 try{Module._load=function(id,...args){if(id==='vscode')return vscode;return load.call(this,id,...args);};delete require.cache[require.resolve('../dist/extension')];extension=require('../dist/extension');}finally{Module._load=load;}
 const context={subscriptions:[]};
 try{
  const api=extension.activate(context);assert.equal((await api.findUsages(new Uri(file))).length,1);
  assert.ok(findCalls.some(c=>c.include.includes('.nuxt')));
  await vscode.commands.executeCommand('componentUsages.show',new Uri(file));
  assert.equal(vscode.window.activeTextEditor.document.uri.path,caller);
  assert.deepEqual(vscode.window.activeTextEditor.selection.start,new Position(1,1));
  assert.equal(vscode.window.activeTextEditor.selection.end.character,name.length+1);
  const waitFor=async n=>{for(let i=0;i<80;i++){if((await api.findUsages(new Uri(file))).length===n)return;await new Promise(r=>setTimeout(r,25));}assert.fail('metadata watcher cache refresh timed out');};
  await fsp.writeFile(declaration,`export const OtherDialog: typeof import('../${dialog}')['default']`);await waitFor(0);
  await fsp.writeFile(declaration,declarationText);await waitFor(1);
  await fsp.unlink(declaration);await waitFor(0);
 }finally{
  for(const disposable of context.subscriptions)disposable?.dispose?.();for(const d of disposables)d.dispose();
  await fsp.rm(folder,{recursive:true,force:true});
 }
});
