# dsh-green-loop（绿循环）

[![CI](https://github.com/algovate/dsh-green-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/algovate/dsh-green-loop/actions/workflows/ci.yml)
[![GitHub](https://img.shields.io/badge/GitHub-algovate%2Fdsh--green--loop-181717?logo=github)](https://github.com/algovate/dsh-green-loop)
[![npm](https://img.shields.io/npm/v/dsh-green-loop)](https://www.npmjs.com/package/dsh-green-loop)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)


**开一次，让 Agent 修到测试通过为止。**

![绿循环演示：开启、检查失败、失败回传、修复、变绿](docs/demo.gif)

<sub>GIF 是 UI 流程的模拟演示；插件本身已安装并验证，真实 Dock 截图在 [这里](docs/dock.webp)。</sub>

`dsh-green-loop` 是 DeepSeek Harness 的编码 Agent 插件，专门解决“Agent 说做完了，但测试其实没过”。
每轮结束时它自动运行你的测试/检查命令；如果失败，就把失败输出**以 steer 的方式送回同一个回合**，
让 Agent 看到失败并继续修。直到检查通过、次数用完、输出不再变化，或你手动停止。

这是确定性的验证，不是“让另一个模型来评审”：

| | 绿循环 | 手动质量门禁 | 断网自动继续 |
|---|---|---|---|
| 触发 | 已开启时每轮结束 | 用户执行 `/gate` | 网络错误 |
| 判定 | 你的命令退出码 | 证据/规范规则 | 传输错误 |
| 动作 | 把输出 steer 回 Agent | 出报告 / 返工裁决 | 发送“继续” |
| 停止 | 通过 / 次数 / 输出不变 | 门禁裁决 | 传输恢复 |

## 安装

```sh
dsh plugin --profile <profile> add dsh-green-loop@0.1.0
```

也可以在 **Settings → Plugins** 里安装本地目录或发布 tarball：

```sh
dsh plugin --profile <profile> add ./dsh-green-loop-0.1.0.tgz
```

包内声明了 `dsh.bundle.patch`，profile 会自动追加 bundle 并插入 Host 行；
浏览器 Dock 通过 `dsh.client` 挂载。

要求 DSH `0.2.2-rc.0` 及以上（`0.2.x` 线）。

## 快速开始

1. 安装后打开一个编码会话。
2. 输入框上方出现 **绿循环**：
   - **开启**：自动检测检查命令并进入待命。
   - **立即检查**：不开启也可以先跑一次。
   - **详情**：查看命令、工作目录、尝试次数、最近输出。
3. 让 Agent 结束一轮：
   - **通过** → 自动关闭，状态变绿。
   - **失败** → 失败输出回传给 Agent，同一回合继续；Agent 再次停下时重新检查。
   - **无进展** → 连续两次完全相同的失败，停止并标记“无进展”。
   - **次数用完** → 达到 `maxAttempts` 后停止并标红。
4. 随时可以在 Dock 点停止，或输入 `/green stop`。

不用 Dock 也可以用命令：

```text
/green status    查看状态、次数、解析出的命令
/green start     开启；下一轮结束时检查
/green run       立即检查；失败会马上回传给 Agent
/green stop      关闭并中止正在运行的检查
```

## 检查命令从哪里来

配置了 `config.command` 就用配置；否则从会话工作目录**只读检测**，检测过程不执行任何命令：

| 项目特征 | 命令 |
|---|---|
| `package.json` 有 `scripts.test` + `pnpm-lock.yaml` | `pnpm test` |
| `package.json` 有 `scripts.test` + `yarn.lock` | `yarn test` |
| `package.json` 有 `scripts.test` + Bun lockfile | `bun run test` |
| `package.json` 有 `scripts.test` | `npm test` |
| `pyproject.toml` / `pytest.ini` / `tox.ini` / `tests/` | `pytest -q`（有 uv/poetry lockfile 时用 `uv run` / `poetry run`） |
| `go.mod` | `go test ./...` |
| `Cargo.toml` | `cargo test` |
| `Makefile` 有 `test:` 目标 | `make test` |

检测出的命令会先显示在 Dock 里，再运行。monorepo 或非标准布局请显式设置 `command`。

## 配置

```yaml
- id: green-loop
  name: dsh-green-loop
  config:
    command: ''             # 显式检查命令；空 = 从项目根目录检测
    timeoutMs: 180000       # 单次检查（含准备）超时
    maxAttempts: 3          # 一个开启周期内最多检查几次
    stopOnRepeat: true      # 连续两次相同失败 = 无进展，停止
    outputTailChars: 4000   # 保留给 steer 和 Dock 的输出尾部
    cwd: ''                 # 覆盖工作目录；相对路径从会话 cwd 解析
    detect: true            # command 为空时允许自动检测
```

所有字段都由 Schemastery 校验，用户可以在自己的 `cordis.patch.yml` 覆盖，不需要改包。
**Settings → Plugins** 的通用表单也会显示这些字段。

## 模型工具

| 工具 | 作用 |
|---|---|
| `green_check` | 运行配置/检测出的检查，返回通过/失败和输出尾部。适合在声称完成前主动调用。 |
| `green_status` | 返回是否开启、是否运行、次数、解析出的命令和最近结果。 |

Agent **不能**开启或关闭循环；这是用户权限。`green_check` 只是探测：不会开启循环，也不会 steer。

## 工作原理

1. **开启**：解析命令，建立 per-session 循环状态。
2. 在 `agent/turn-stopping` 事件里，用 `ctx.shell` 运行命令——和 `bash` 工具同一个执行器与沙箱。
3. 非零退出、超时或基础设施错误都算失败。插件构造一段有长度上限的失败报告，调用 `agent.steer(...)`；
   循环会重新读取 inbox，继续下一个 step，而不是结束回合。
4. 通过则关闭循环；连续相同输出标记 `stalled`；次数用完标记 `red`。
5. Dock 只在开启/运行期间轮询 Host API；进程重启后状态不保留。

更完整的时序、状态机和失败模式见 [docs/architecture.md](docs/architecture.md)。

## 安全与成本

- **默认不运行。** 只有用户开启，或显式调用 `green_check` / `/green run` 才会执行；Agent 没有开启工具。
- **命令由用户控制。** 模型不能修改命令；自动检测只读项目元数据，不执行。
- **和 Agent 同一执行边界。** 检查走 `ctx.shell`，继承部署的沙箱、工作目录和环境；超时会杀掉检查。
- **输出有上限。** 只保留 `outputTailChars`，其余不进入 steer，也不由本插件持久化。
- **成本有界。** 每次失败会多一个模型 step；次数上限和“输出不变”规则负责兜底，随时可停。
- **信任命令。** 开启后每轮都会自动跑配置/检测出的命令；请像对待 `package.json` 脚本一样，只在可信项目里使用。

## 验证

```sh
node --test test/*.test.js
node --check index.js && node --check client.js && node --check engine.js \
  && node --check detect.js && node --check loop.js
```

测试覆盖检测、纯重试/停滞/停止决策、带 fake agent/shell 的实时引擎和 abort 行为。
当前 Desktop profile 已经用 `green_check` 跑通 `make test`（61 项测试），并且已经走过一次真实的
Arm → turn-stopping → `green · attempt 1/3`；完整记录见 [docs/verification.md](docs/verification.md)。

发布步骤见 [docs/RELEASE.md](docs/RELEASE.md)。

## 限制

- 已开启的会话在**每轮停止**时都会检查，包括 Agent 用普通文字提问后结束的回合；不需要时请关闭。
- 检查命令必须能退出；watch 模式会撞上 `timeoutMs`。
- 检测只看项目根目录，且是启发式；monorepo 请显式配置 `command`。
- 状态在进程内，重启后需要重新开启。
- Dock 是 `conversation.input.dock` 的一个条目，不 portal 固定浮层。
