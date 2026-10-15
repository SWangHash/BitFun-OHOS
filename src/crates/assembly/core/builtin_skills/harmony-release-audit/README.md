# 鸿蒙上架预检助手

在 BitFun 的“智能体 → 行业智能体”中选择“上架预检助手”，打开包含 `build-profile.json5` 的鸿蒙手机工程。执行主机需要 Node.js。

可以说：“检查这个工程的上架风险，完成报告后让我选择修复项”；“只检查，不修改源码”；或“只修复本轮报告中确认的默认同意问题”。

第一版检查文字色彩对比度、发布完整性、隐私主动同意。扫描候选经源码复核后生成报告及具体方案，通过 BitFun 原生问题卡片选择，再备份、编辑、复扫。支持部分修复、跳过、已有授权与中断后的继续处理。未回答不执行待决修改。

每轮报告保留 `report.json`、`report.md`、`reviewed.md`；修复时另有 `fix-plan.md`、`backups/`、`after/` 和 `fix-result.md`。报告区分确认、疑似、排除与源码无法确认；源码检查不能代表完整审核、构建或设备验证。

原始扫描器、资源追踪、JSON5 解析器和 42 项测试来自 [harmony-release-audit](https://gitcode.com/BitFun_Coder/harmony-release-audit)，固定版本及源码摘要见 `UPSTREAM.json`。BitFun 适配见 [宿主与扩展约定](references/bitfun-host.md)。规则口径见 [rules.md](references/rules.md)，完整修复步骤见 [repair-workflow.md](references/repair-workflow.md)。

## 开发验证

在仓库根目录运行：

```text
node --test src/crates/assembly/core/builtin_skills/harmony-release-audit/scripts/scan.test.mjs
```

真实 Agent 行为按 [repair-scenarios.md](evals/repair-scenarios.md) 验收：尤其验证回答前不修改、部分选择仅改选中项、取消不修改、只检查不提问、已授权不重复问、覆盖下降不误报修复成功。扫描器测试与界面/模型验收分别记录。

本版不增加 SDK、构建、设备与云测试依赖。SSH/容器中脚本不可访问时明确报告不支持；远程控制和 Peer 沿用宿主通道，实际支持范围以验收记录为准。

## 可重复的演示工程

运行 `node <本Skill目录>/evals/create-demo.mjs <不存在的输出目录>`，父目录需已存在。生成器拒绝覆盖现有目录。工程是仅供源码预检的样例，包含三类风险与明确启动路径，不是完整 SDK 构建模板。

打开该工程，向上架预检助手发送“检查上架风险，完成后让我选择修复范围”。先尝试仅修复测试版本后缀：两种语言资源应更新，颜色和默认同意问题仍应保留。重新生成到新目录可再次演示。`demo.test.mjs` 验证样例与扫描器的配合，不替代真实模型提问和编辑行为验收。
