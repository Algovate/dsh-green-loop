# 绿循环

![绿循环演示：开启、检查失败、失败回传、修复、变绿](demo.gif)

*UI 流程的模拟演示。插件本身已安装并验证；下方是真实 Dock 截图。*

![绿循环 Dock（已开启）](dock.webp)

**开一次，让 Agent 修到项目检查通过为止。**

编码 Agent 往往很乐观：写完代码、随手跑一下，就说“完成了”。然后 CI 在一个它根本没跑的测试上失败。
绿循环补上这一环：每轮结束自动运行项目检查；如果失败，就在回合关闭前把失败输出送回 Agent。
Agent 看到失败、继续修，检查再次运行。绿了，才算完成。

## 20 秒演示

1. 打开一个编码会话，输入框上方出现 **绿循环**。
2. 点 **开启**。插件会从项目根目录自动检测 `pnpm test` / `npm test` / `pytest` / `go test` /
   `cargo test` / `make test`，也可以用 `config.command` 指定。
3. 让 Agent 结束一轮。
4. 如果检查失败，失败输出会 steer 进同一个回合，Agent 继续修。
5. 检查通过后循环自动关闭，Dock 变绿。

它不请第二个模型来评判代码好不好；**退出码就是裁决**。

## 它不是什么

- **不是手动质量门禁**：`dsh-doublecheck` 一类工具按需给出交付裁决；绿循环是“自动跑 + 逼着修”的循环。
- **不是 LLM 评审**：不让模型来审代码，只运行你信任的命令。
- **不是断网自动继续**：不是无脑发“继续”，而是把具体、有限的失败报告回传。
- **不是代码生成器**：只执行检查，并决定什么时候停。

## 控制面

| 界面 | 能做什么 |
|---|---|
| Dock | 开启、关闭、立即检查、停止、详情（命令、cwd、次数、最近输出） |
| `/green` | `start`、`stop`、`run`、`status` |
| `green_check` 工具 | Agent 在声称完成前主动探测 |
| `green_status` 工具 | 读取开启/运行/次数/最近结果 |

Agent **不能**开启或关闭循环。自动执行命令始终是用户的决定。

## 有界设计

- `maxAttempts`（默认 3）：一个开启周期内最多检查几次。
- `timeoutMs`（默认 180s）：杀不掉退出的检查。
- 连续两次完全相同的失败 → `stalled`，不再浪费次数。
- 只保留 `outputTailChars`（默认 4000）输出，用于 steer 和 Dock。
- 随时可以在 Dock 点停止，或 `/green stop` 中止正在运行的检查。

## 安全

绿循环会运行 shell 命令。它默认不运行，但一旦开启，每轮结束都会运行。

- 命令来自 `config.command` 或只读检测；模型不能修改。
- 检查走 `ctx.shell`，和 `bash` 工具同一个执行器与沙箱。
- 检测只读项目元数据，不执行任何东西。
- 不读凭据、不发网络请求、不修改项目文件。
- 请像对待 `package.json` 脚本一样，只在可信项目中使用。

## 兼容性

- DSH `>=0.2.2-0 <0.3.0`，Node `>=22.19`。
- Dock 需要 Web 客户端；工具和 turn-stopping 循环在没有 Dock 时也可用。
- 已在 DSH 0.2.2-rc.3 Desktop 验证：开启 → turn-stopping → `make test` → 绿。

## 配置

```yaml
- id: green-loop
  name: dsh-green-loop
  config:
    command: ''             # 显式检查命令；空 = 从项目根目录检测
    timeoutMs: 180000
    maxAttempts: 3
    stopOnRepeat: true
    outputTailChars: 4000
    cwd: ''
    detect: true
```

完整的命令检测表和架构说明见 [README.zh.md](../README.zh.md)。
