# 版本与发布

## 本地打包

```sh
npm ci
npm run package
```

VSIX 输出到 `artifacts/`，文件名自动包含 `package.json` 中的版本。源码仓库不提交依赖、编译结果或安装包。

## GitHub Release

修复功能后更新 `CHANGELOG.md`，然后创建版本提交与标签：

```sh
npm version patch --no-git-tag-version
npm run package
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release 0.1.3"
git tag v0.1.3
git push origin main
git push origin v0.1.3
```

示例版本 `0.1.3` 需要替换为实际版本。标签必须与 package.json 完全一致。GitHub Release 工作流会验证版本、执行测试、打包并创建附带 VSIX 的草稿 Release。检查草稿后，在 GitHub 点击发布。

## VS Code Marketplace 首次发布

当前 `publisher: local-tools` 是本地安装包使用的占位值。先在 [Marketplace 管理页](https://marketplace.visualstudio.com/manage) 创建发布者，并将 package.json 的 `publisher` 改为实际 ID，同时配置真实的 repository URL。GitHub 账号与 Marketplace 发布者是两种独立身份。首次上架前确认名称和 publisher；它们组成插件 ID，修改 publisher 会成为另一个插件，已有本地安装不会自动迁移。

最直接的方式是运行 `npm run package`，在管理页上传生成的 VSIX。确认以上身份配置后再发布正式版本。

也可以启用仓库中的手动工作流：

1. 在 GitHub Settings → Environments 创建 `marketplace` 环境；如账号与仓库类型支持，可配置审批人。
2. 按 [VS Code 官方发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) 创建有 Marketplace Manage 权限的组织范围 Azure DevOps PAT，将其保存为该环境的 `VSCE_PAT` secret。
3. 提交 publisher / repository 配置，创建并推送与版本一致的标签。
4. 在 Actions 选择 **Publish to VS Code Marketplace**，输入该标签，点击 Run workflow。流程会验证身份配置、检查、测试、打包，再上传 VSIX。

仓库推送和 GitHub Release 不会触发市场发布。令牌仅通过 GitHub Secrets 提供，不写入代码或命令参数。

官方还提供 [Trusted Publishing / OIDC](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)，可在所使用的 vsce 版本支持 `--oidc` 后切换。当前锁定工具版本的 `publish --help` 尚不包含该参数，因此这里提供已支持的 PAT 发布流程以及无需令牌的管理页上传方式。
