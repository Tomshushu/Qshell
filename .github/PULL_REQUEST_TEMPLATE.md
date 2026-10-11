## 📌 变更概述 (Summary)

请在此简要说明本次 Pull Request 的核心变更内容与动机。

<!-- 例如：重构终端字体自适应逻辑，解决分屏拖拽时的重绘闪烁问题 -->

---

## 🎯 变动类型 (Type of Change)

请勾选符合的一项或多项：

- [ ] 🐛 **缺陷修复 (Bug Fix)**：修复了已知问题且向后兼容
- [ ] ✨ **功能新增 (Feature)**：新增了功能特性且向后兼容
- [ ] ⚡ **性能优化 (Performance)**：降低资源消耗、加快响应或减少重绘
- [ ] ♻️ **代码重构 (Refactoring)**：既不修复缺陷也不新增特性的架构改进
- [ ] 📝 **文档变更 (Documentation)**：补充或修订项目文档
- [ ] 🧪 **测试用例 (Tests)**：补充或修正单元测试/集成测试
- [ ] 🔧 **构建/CI/CD (Build/Chore)**：依赖项变更、流水线或脚本调整

---

## 🔗 关联 Issue (Related Issues)

Closes #<!-- 关联的 Issue 编号，例如：Closes #123 -->

---

## 🛡️ 本地质量门禁自查清单 (Pre-flight Checklist)

提交 PR 前，请确保已在本地工作区执行并通过以下所有检查项：

- [ ] **Rust 编译门禁**：已运行 `cargo check --manifest-path src-tauri/Cargo.toml` 且 0 errors, 0 warnings
- [ ] **TS 类型门禁**：已运行 `npx tsc --noEmit` 且 0 报错
- [ ] **运行时安全检查**：已运行 `npm run check:undefined` 通过
- [ ] **自动化测试套件**：已运行 `npx vitest run` 且全部测试用例通过 (100% Pass)
- [ ] **代码风格与规范**：符合项目编码规范与 Conventional Commits 提交约定
- [ ] **无多余暂存文件**：未提交调试日志、个人敏感配置或临时构建缓存文件

---

## 📸 验证说明与效果截图 (Verification & Screenshots)

<!-- 如果涉及 UI 变动或交互优化，请在此附上操作动图或截图；若为底层逻辑，请简要说明测试复现方式 -->
