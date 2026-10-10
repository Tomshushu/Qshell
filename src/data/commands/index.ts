import type { CommandSpec, CategoryMeta } from '@/lib/command-intelligence/types'
import { fileCommands } from './file'
import { textCommands } from './text'
import { systemCommands } from './system'
import { networkCommands } from './network'
import { dockerCommands } from './docker'
import { gitCommands } from './git'
import { archiveCommands } from './archive'
import { packageCommands } from './package'
import { miscCommands } from './misc'
import { userPermCommands } from './user-perm'
import { diskFsCommands } from './disk-fs'
import { devopsCommands } from './devops'
import { securityCommands } from './security'
import { databaseCommands } from './database'
import { packageManagerCommands } from './package-managers'
import { shellBuiltinCommands } from './shell-builtin'
import { hardwareCommands } from './hardware'
import { editorCommands } from './editors'
import { monitoringCommands } from './monitoring'
import { languageToolchainCommands } from './language-toolchains'
import { cloudCommands } from './cloud'
import { virtualizationCommands } from './virtualization'
import { routerCommands } from './router'

/**
 * 全部命令定义。
 *
 * 按类目分组导出，最后合并为单一数组并建立索引供引擎快速查找。
 * 如需新增命令，优先在对应类目文件中追加；若是新类目，新增文件并在本文件导入。
 *
 * 平台过滤：每条命令可带 platforms 标签（如 ['debian']），
 * 引擎在命令名匹配阶段按当前服务器 OS 过滤发行版专属命令。
 */
export const ALL_COMMANDS: CommandSpec[] = [
  ...routerCommands,
  ...shellBuiltinCommands,
  ...fileCommands,
  ...textCommands,
  ...systemCommands,
  ...hardwareCommands,
  ...diskFsCommands,
  ...networkCommands,
  ...userPermCommands,
  ...securityCommands,
  ...dockerCommands,
  ...gitCommands,
  ...devopsCommands,
  ...databaseCommands,
  ...archiveCommands,
  ...packageCommands,
  ...packageManagerCommands,
  ...miscCommands,
  ...editorCommands,
  ...monitoringCommands,
  ...languageToolchainCommands,
  ...cloudCommands,
  ...virtualizationCommands,
]

/** 按命令名建索引，加速一级命令查找 */
export const COMMAND_BY_NAME = new Map<string, CommandSpec>(
  ALL_COMMANDS.map((c) => [c.cmd, c]),
)

/** 分类元信息 */
export const CATEGORY_META: CategoryMeta[] = [
  { id: 'shell-builtin', label: 'Shell 内建' },
  { id: 'file', label: '文件管理' },
  { id: 'text', label: '文本处理' },
  { id: 'system', label: '进程与系统' },
  { id: 'hardware', label: '硬件与系统信息' },
  { id: 'disk-fs', label: '磁盘与文件系统' },
  { id: 'network', label: '网络' },
  { id: 'user-perm', label: '用户与权限' },
  { id: 'security', label: '安全' },
  { id: 'docker', label: 'Docker' },
  { id: 'git', label: 'Git' },
  { id: 'devops', label: 'DevOps' },
  { id: 'database', label: '数据库' },
  { id: 'archive', label: '压缩归档' },
  { id: 'package-manager', label: '包管理' },
  { id: 'misc', label: '其他' },
  { id: 'editors', label: '编辑器与交互工具' },
  { id: 'monitoring', label: '系统监控' },
  { id: 'language-toolchains', label: '语言工具链' },
  { id: 'cloud', label: '云平台 CLI' },
  { id: 'virtualization', label: '虚拟化与容器' },
]
