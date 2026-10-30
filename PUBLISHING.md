# 版本与自动发布

发布者为 **`max-zhang`**，插件 ID 为 **`max-zhang.component-usages-code-vision`**。

推送与 `package.json` 版本一致的 `v版本号` 标签后，GitHub Actions 会自动验证版本、执行检查和测试、生成 VSIX，然后上架到 VS Code Marketplace。普通代码推送只运行 CI。

## 首次配置：添加信任授权

GitHub 的 `marketplace` 环境已创建。还需要发布者本人在 [Marketplace 发布者后台](https://marketplace.visualstudio.com/manage) 为 `max-zhang` 添加一次 Trusted Publishing 策略：

| 字段 | 填写值 |
| --- | --- |
| Policy name | `component-usages-release`（可自定义） |
| Repository owner | `maxzhang-me` |
| Repository | `component-usages` |
| Workflow | `publish-marketplace.yml` |
| Environment | `marketplace` |

打开发布者 → Trusted Publishing → Create，填写上述字段并保存。Workflow 仅填写文件名，Environment 需完全一致。此授权在 Marketplace 端配置，GitHub 设置不能代替它。

工作流通过 GitHub OIDC 获取短期凭据，使用已锁定的 `@vscode/vsce` 4.1.0。**不需要创建或保存 `VSCE_PAT` secret。** 配置依据：[VS Code 官方 Trusted Publishing 文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)。

## 后续发布

先提交功能修改和 CHANGELOG，再运行：

```sh
npm version patch -m "Release %s"
git push origin main --follow-tags
```

`npm version patch` 会同步更新 package.json 和 package-lock.json，创建版本提交及带注释的 `v版本号` 标签；`--follow-tags` 将该标签与 main 一起推送。例如从 0.1.2 升级到 0.1.3，会触发 `v0.1.3` 自动发布。

发布进度见 [Marketplace 工作流](https://github.com/maxzhang-me/component-usages/actions/workflows/publish-marketplace.yml)。如果测试、版本检查或认证失败，上架流程会停止；修复认证后可在 Actions 中重新运行，或手动选择该工作流并输入同一标签。已经上架的版本不能重复发布，新修改应提升版本号。

同一标签也会生成带 VSIX 的 GitHub 草稿 Release。草稿是否公开发布只影响 GitHub 展示，不影响 Marketplace 自动上架。

## 本地打包或首次手动上架

```sh
npm ci
npm run package
```

输出位于 `artifacts/component-usages-code-vision-版本号.vsix`。也可在发布者后台选择 `max-zhang`，直接上传 VSIX。此前 `local-tools` 本地安装包与正式插件属于不同插件 ID；后续保持 publisher 与 name 稳定。
