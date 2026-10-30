const vscode=require('vscode');
const assert=require('node:assert/strict');
exports.run=async()=>{
 const manifest=require('../package.json');
 const ext=vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`); assert.ok(ext);
 const api=await ext.activate();
 const root=vscode.workspace.workspaceFolders[0].uri;
 const card=vscode.Uri.joinPath(root,'Card.vue'), app=vscode.Uri.joinPath(root,'App.vue');
 await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(card));
 const lenses=await vscode.commands.executeCommand('vscode.executeCodeLensProvider',card);
 assert.ok(lenses.some(l=>l.command?.command==='componentUsages.show'),'top CodeLens registered');
 assert.equal((await api.findUsages(card)).length,1);
 await vscode.commands.executeCommand('componentUsages.show',card);
 assert.equal(vscode.window.activeTextEditor.document.uri.toString(),app.toString());
 assert.equal(vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection),'Card');
 // Unsaved document edits must invalidate cached references.
 const doc=vscode.window.activeTextEditor.document;
 const edit=new vscode.WorkspaceEdit();edit.replace(app,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),`<script setup>import Card from './Card.vue'</script><template><Card/><Card/></template>`);
 await vscode.workspace.applyEdit(edit);
 assert.equal((await api.findUsages(card)).length,2,'dirty buffers are indexed');
 await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
 const fs=require('node:fs');
 const path=require('node:path');
 const dialogPath='components/account/payment/installments_due/autoPayDialog.vue';
 const name='AccountPaymentInstallmentsDueAutoPayDialog';
 const dialog=vscode.Uri.joinPath(root,dialogPath), caller=vscode.Uri.joinPath(root,'account.vue');
 assert.equal(vscode.workspace.getConfiguration('componentUsages').get('autoImportDirectories').length,0);
 assert.equal((await api.findUsages(dialog)).length,1,'read excluded .nuxt/components.d.ts without settings');
 await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(dialog));
 await vscode.commands.executeCommand('componentUsages.show',dialog);
 assert.equal(vscode.window.activeTextEditor.document.uri.toString(),caller.toString());
 assert.equal(vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection),name,'exact Nuxt auto-import tag selected');
 const declaration=path.join(root.fsPath,'.nuxt','components.d.ts');
 // Updates/deletions must invalidate cached results even under files.watcherExclude.
 fs.writeFileSync(declaration,`export const OtherDialog: typeof import('../${dialogPath}')['default']`);
 const waitFor=async(expected)=>{
  for(let i=0;i<60;i++) {if((await api.findUsages(dialog)).length===expected)return;await new Promise(r=>setTimeout(r,100));}
  assert.fail('Nuxt declaration file watcher failed to invalidate cache');
 };
 await waitFor(0);
 fs.writeFileSync(declaration,`export const ${name}: typeof import('../${dialogPath}')['default']`);
 await waitFor(1);
 fs.unlinkSync(declaration);await waitFor(0);
 console.log('HOST TESTS PASSED: activation, CodeLens, jump, dirty buffers, Nuxt excluded metadata, exact user regression, metadata change/delete watchers');
};
