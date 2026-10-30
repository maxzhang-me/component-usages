# 参与维护

使用 Node.js 22。克隆仓库后运行：

```sh
npm ci
npm run check
npm test
npm run package
```

`src/extension.ts` 管理 VS Code 交互和索引生命周期，`src/analyzer.ts` 解析组件和模块关系。回归测试位于 `test/`。F5 启动扩展开发窗口；`npm run test:host` 执行原生 VS Code 集成测试，需要可用的桌面会话。Linux 无头环境可使用 `xvfb-run -a npm run test:host`。

提交组件识别相关修复时，请附上最小组件、声明或导入关系以及预期用法位置。提交前运行检查和测试。推送 main 或创建 PR 会触发 CI，构建产物可从 Actions 下载。

版本、标签与市场发布步骤见 [PUBLISHING.md](PUBLISHING.md)。
