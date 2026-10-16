/**
 * 命令智能（Command Intelligence）数据 Schema
 *
 * 设计目标：把命令描述做成"数据库化"的分层 JSON 数据，
 * 由 completion-engine 进行词法分析 + 命令树导航 + 多级补全。
 *
 * 一个 CommandSpec 可独立存在（如 ls），也可作为父命令的子命令（如 git.commit）。
 * 嵌套层数无限制，支持 git → commit → -m 这种任意深度。
 */

/** 参数类型 */
export type ParamType = 'flag' | 'value' | 'path' | 'file' | 'choice' | 'vararg'

/**
 * 命令适用的平台/发行版标签。
 *
 * - universal：几乎所有 Linux/Unix 通用（POSIX 基础命令）
 * - debian：Debian 系（Ubuntu、Linux Mint、Kali 等），包管理 apt/dpkg
 * - redhat：Red Hat 系（RHEL、CentOS、Fedora、Rocky、AlmaLinux），包管理 dnf/yum/rpm
 * - arch：Arch 系（Arch、Manjaro、EndeavourOS），包管理 pacman
 * - alpine：Alpine Linux，包管理 apk
 * - suse：SUSE 系（openSUSE、SLES），包管理 zypper
 * - macos：macOS（BSD 变体），部分参数与 GNU 版本不同
 * - bsd：FreeBSD/OpenBSD/NetBSD
 *
 * 一条命令可属于多个平台。缺省视为 universal。
 */
export type Platform =
  | 'universal'
  | 'debian'
  | 'redhat'
  | 'arch'
  | 'alpine'
  | 'suse'
  | 'macos'
  | 'bsd'
  | 'network'

/** 单条命令示例 */
export interface CommandExample {
  /** 示例命令行 */
  cmd: string
  /** 说明 */
  desc?: string
}

/** 命令参数定义 */
export interface CommandParam {
  /** 参数名，如 '-l' / '--name' / '-m'；位置参数可用 '<file>' 占位 */
  name: string
  /** 简写（若 name 是长选项），如 '--list' 对应 '-l' */
  short?: string
  /** 说明 */
  desc: string
  /** 参数类型 */
  type?: ParamType
  /** 是否需要带值（如 -m <msg>） */
  requiresValue?: boolean
  /** 值的占位提示，如 '<msg>' / '<port>' */
  valueHint?: string
  /** type=choice 时的可选值 */
  choices?: string[]
  /** 是否可重复出现（如 -e KEY=V 多次） */
  repeatable?: boolean
}

/**
 * 命令定义。可作为顶层命令，也可作为子命令嵌套。
 * 子命令与 params 可同时存在：params 是命令自身参数，subcommands 是下一级命令。
 */
export interface CommandSpec {
  /** 命令名，如 'git' / 'commit' / '-m' */
  cmd: string
  /** 简短说明（一行） */
  desc: string
  /** 详细说明（多行，可选） */
  longDesc?: string
  /** 用法签名，如 'grep [OPTION] PATTERN FILE'；缺省时由引擎拼装 */
  usage?: string
  /** 命令参数列表 */
  params?: CommandParam[]
  /** 子命令（如 git 的 commit/push/pull） */
  subcommands?: CommandSpec[]
  /** 命令示例 */
  examples?: CommandExample[]
  /** 分类标签（如 'file' / 'network' / 'docker'），用于浏览 */
  category?: string
  /**
   * 适用平台标签（如 ['debian','redhat']）。
   * 缺省视为 ['universal']，对所有平台生效。
   * 引擎在命令名匹配阶段会按当前服务器 OS 过滤。
   */
  platforms?: Platform[]
  /** 不可与 subcommands 同时出现的位置参数占位（如 cp <src> <dst>） */
  positional?: CommandParam[]
}

/** 分类元信息 */
export interface CategoryMeta {
  /** 分类 id，对应 CommandSpec.category */
  id: string
  /** 显示名 */
  label: string
  /** 图标（lucide 图标名，可选） */
  icon?: string
}

/** 提示项类型 */
export type HintKind = 'command' | 'subcommand' | 'param' | 'positional' | 'path' | 'history' | 'example' | 'dynamic' | 'markov'

// ==================== 动态补全类型 ====================

/**
 * 动态补全候选项（provider 返回的原始数据）。
 *
 * 与静态命令库互补：静态库存放命令元数据，动态 provider 在运行时
 * 根据当前服务器状态返回具体资源名（容器名、服务名、分支名等）。
 */
export interface DynamicSuggestion {
  /** 补全时要插入的文本 */
  insertText: string
  /** 显示说明 */
  desc?: string
}

/**
 * 动态补全 Provider 接口。
 *
 * 每个 Provider 描述「在什么命令链 + 位置触发」以及「如何获取候选项」。
 * 引擎在 matchHints 阶段调用 provider.match() 判定是否触发；
 * 命中后 terminal.tsx 异步调用 provider.fetch() 拉取候选项，
 * 结果带 TTL 缓存避免重复请求。
 */
export interface DynamicCompletionProvider {
  /** Provider 唯一标识 */
  id: string
  /**
   * 判断当前输入是否应该触发此 provider。
   *
   * @param commandChain 命令链（如 ['docker','exec']）
   * @param tokens 输入行切分后的 tokens
   * @param currentToken 当前正在输入的 token
   * @returns true 表示触发动态补全
   */
  match(
    commandChain: string[],
    tokens: string[],
    currentToken: string,
  ): boolean
  /**
   * 获取动态补全候选项。
   *
   * @param serverId 远程服务器 ID
   * @param commandChain 命令链
   * @param tokens 输入行 tokens
   * @param currentToken 当前 token
   * @returns 候选项列表
   */
  fetch(
    serverId: string,
    commandChain: string[],
    tokens: string[],
    currentToken: string,
  ): Promise<DynamicSuggestion[]>
}

/** 单条提示项（UI 渲染用） */
export interface HintItem {
  kind: HintKind
  /** 显示名，如 'git' / 'commit' / '-m' / 'src/' */
  label: string
  /** 说明 */
  desc: string
  /** 补全时要插入的文本 */
  insertText: string
  /** 是否需要带值（用于 UI 显示占位提示） */
  requiresValue?: boolean
  /** 值占位提示 */
  valueHint?: string
  /** 分类（仅 command 阶段用于分组） */
  category?: string
  /** 用法签名（command 阶段附带，用于 Usage 预览） */
  usage?: string
  /** 示例（command 阶段附带） */
  examples?: CommandExample[]
  /** 原始 spec */
  spec?: CommandSpec
  param?: CommandParam
  /** 匹配得分（用于排序，越高越靠前） */
  score?: number
  /** 历史来源时间戳（仅 history 类型） */
  usedAt?: number
  /** 历史使用次数（仅 history 类型） */
  useCount?: number
  /**
   * 是否为平台不兼容项（当前服务器 OS 不支持该命令）。
   * true 时 UI 灰色显示而非隐藏，补全仍可用（用户可强制选择）。
   */
  disabled?: boolean
  /** 不兼容原因（disabled=true 时附带，供 UI 提示） */
  disabledReason?: string
  /**
   * 别名指向：当本项是 shell 别名时，记录其展开（如 ll → 'ls -alF'）。
   * UI 展示「alias → ls -alF」。
   */
  aliasOf?: string
  /** 是否为「Did you mean」纠错建议项 */
  isCorrection?: boolean
}

/** 引擎匹配结果 */
export interface HintResult {
  /** 当前阶段 */
  phase: 'command' | 'subcommand' | 'param' | 'path' | 'history' | 'dynamic'
  /** 提示项列表（已排序） */
  items: HintItem[]
  /** 已识别的命令链（如 ['git', 'commit']） */
  commandChain: CommandSpec[]
  /** 当前用法签名（用于 Usage 预览） */
  usage?: string
  /** 当前命令示例（用于 Examples 区块） */
  examples?: CommandExample[]
  /** 当前生效的 spec（最深一层） */
  activeSpec?: CommandSpec
  /** 是否处于位置参数阶段（用于触发路径补全） */
  expectingPath?: boolean
  /** 原始输入 */
  input: string
  /**
   * 动态补全 Provider（仅 phase === 'dynamic' 时存在）。
   * terminal.tsx 据此异步调用 fetchDynamicHints 拉取候选项。
   */
  dynamicProvider?: DynamicCompletionProvider
  /** 引擎切分后的 tokens（dynamic 阶段供 terminal.tsx 透传给 provider） */
  tokens?: string[]
  /** 当前正在输入的 token（dynamic 阶段供 terminal.tsx 透传给 provider） */
  currentToken?: string
}
