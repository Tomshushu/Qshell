import type { CommandSpec } from '@/lib/command-intelligence/types'

// Shell 内建命令
export const shellBuiltinCommands: CommandSpec[] = [
  // cd - 切换目录
  {
    cmd: 'cd',
    desc: '切换目录',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<dir>', desc: '目标目录', type: 'dir' }],
    examples: [
      { cmd: 'cd /tmp', desc: '进入/tmp' },
      { cmd: 'cd ..', desc: '返回上级' },
      { cmd: 'cd ~', desc: '返回家目录' },
    ],
  },
  // pwd - 显示当前目录
  {
    cmd: 'pwd',
    desc: '显示当前目录',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-P', desc: '物理路径（不解析符号链接）', type: 'flag' },
      { name: '-L', desc: '逻辑路径（解析符号链接）', type: 'flag' },
    ],
    examples: [
      { cmd: 'pwd', desc: '显示当前目录' },
      { cmd: 'pwd -P', desc: '显示物理路径' },
    ],
  },
  // echo - 输出文本
  {
    cmd: 'echo',
    desc: '输出文本',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-n', desc: '不换行', type: 'flag' },
      { name: '-e', desc: '解析转义字符', type: 'flag' },
      { name: '-E', desc: '不解析转义字符', type: 'flag' },
    ],
    positional: [{ name: '<text>', desc: '文本内容', type: 'vararg' }],
    examples: [
      { cmd: 'echo "hello"', desc: '输出文本' },
      { cmd: 'echo -n "no newline"', desc: '不换行输出' },
      { cmd: 'echo -e "line1\\nline2"', desc: '解析转义字符' },
    ],
  },
  // printf - 格式化输出
  {
    cmd: 'printf',
    desc: '格式化输出',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [
      { name: '<format>', desc: '格式串', type: 'value' },
      { name: '<args>', desc: '参数', type: 'vararg' },
    ],
    examples: [
      { cmd: 'printf "%s\\n" hello', desc: '输出字符串' },
      { cmd: 'printf "%d + %d = %d\\n" 1 2 3', desc: '格式化数字' },
    ],
  },
  // export - 设置环境变量
  {
    cmd: 'export',
    desc: '设置环境变量',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [{ name: '-n', desc: '删除导出属性', type: 'flag' }],
    positional: [{ name: '<name>=<value>', desc: '环境变量赋值', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'export PATH=$PATH:/opt/bin', desc: '追加 PATH' },
      { cmd: 'export MY_VAR=hello', desc: '设置变量' },
    ],
  },
  // unset - 删除变量
  {
    cmd: 'unset',
    desc: '删除变量',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-v', desc: '删除变量（默认）', type: 'flag' },
      { name: '-f', desc: '删除函数', type: 'flag' },
    ],
    positional: [{ name: '<name>', desc: '变量名', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'unset MY_VAR', desc: '删除变量' },
      { cmd: 'unset -f my_func', desc: '删除函数' },
    ],
  },
  // env - 显示/设置环境变量
  {
    cmd: 'env',
    desc: '显示/设置环境变量',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-i', desc: '清空环境变量', type: 'flag' },
      { name: '-u', desc: '删除指定变量', requiresValue: true, valueHint: '<name>' },
    ],
    positional: [{ name: '<name>=<value>', desc: '环境变量赋值', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'env', desc: '显示所有环境变量' },
      { cmd: 'env -i /bin/sh', desc: '在空环境中启动 shell' },
      { cmd: 'env VAR=1 ./script.sh', desc: '带变量运行脚本' },
    ],
  },
  // set - 设置shell选项
  {
    cmd: 'set',
    desc: '设置shell选项',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-e', desc: '出错即退出', type: 'flag' },
      { name: '-x', desc: '跟踪命令执行', type: 'flag' },
      { name: '-u', desc: '未定义变量报错', type: 'flag' },
      { name: '-o', desc: '选项名', requiresValue: true, valueHint: '<option>' },
    ],
    examples: [
      { cmd: 'set -e', desc: '出错即退出' },
      { cmd: 'set -x', desc: '开启跟踪' },
      { cmd: 'set -o nounset', desc: '未定义变量报错' },
    ],
  },
  // source - 执行文件（. 是简写）
  {
    cmd: 'source',
    desc: '执行文件（在当前 shell 中，. 是简写）',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<file>', desc: '脚本文件', type: 'file' }],
    examples: [
      { cmd: 'source ~/.bashrc', desc: '重载配置' },
      { cmd: 'source ./env.sh', desc: '加载环境变量' },
      { cmd: '. ./env.sh', desc: '简写形式' },
    ],
  },
  // alias - 设置别名
  {
    cmd: 'alias',
    desc: '设置别名',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<name>=<value>', desc: '别名定义', type: 'value' }],
    examples: [
      { cmd: 'alias', desc: '列出所有别名' },
      { cmd: 'alias ll="ls -la"', desc: '设置 ll 别名' },
    ],
  },
  // unalias - 删除别名
  {
    cmd: 'unalias',
    desc: '删除别名',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [{ name: '-a', desc: '删除所有别名', type: 'flag' }],
    positional: [{ name: '<name>', desc: '别名名', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'unalias ll', desc: '删除别名' },
      { cmd: 'unalias -a', desc: '删除所有别名' },
    ],
  },
  // history - 命令历史
  {
    cmd: 'history',
    desc: '命令历史',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-c', desc: '清空历史', type: 'flag' },
      { name: '-d', desc: '删除指定历史', requiresValue: true, valueHint: '<offset>' },
      { name: '-a', desc: '追加到历史文件', type: 'flag' },
      { name: '-r', desc: '读取历史文件', type: 'flag' },
    ],
    positional: [{ name: '<n>', desc: '显示最近 n 条', type: 'value' }],
    examples: [
      { cmd: 'history', desc: '显示所有历史' },
      { cmd: 'history 10', desc: '显示最近 10 条' },
      { cmd: 'history -c', desc: '清空历史' },
    ],
  },
  // type - 查看命令类型
  {
    cmd: 'type',
    desc: '查看命令类型',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-a', desc: '显示所有匹配', type: 'flag' },
      { name: '-t', desc: '仅显示类型', type: 'flag' },
    ],
    positional: [{ name: '<command>', desc: '命令名', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'type ls', desc: '查看 ls 类型' },
      { cmd: 'type -a cd', desc: '显示所有匹配' },
    ],
  },
  // which - 查找命令路径
  {
    cmd: 'which',
    desc: '查找命令路径',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [{ name: '-a', desc: '显示所有匹配', type: 'flag' }],
    positional: [{ name: '<command>', desc: '命令名', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'which python3', desc: '查找 python3 路径' },
      { cmd: 'which -a bash', desc: '显示所有匹配' },
    ],
  },
  // man - 查看手册
  {
    cmd: 'man',
    desc: '查看手册',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-k', desc: '关键词搜索', requiresValue: true, valueHint: '<keyword>' },
      { name: '-f', desc: '简短描述', requiresValue: true, valueHint: '<command>' },
      { name: '-a', desc: '显示所有章节', type: 'flag' },
    ],
    positional: [{ name: '<command>', desc: '命令名', type: 'value' }],
    examples: [
      { cmd: 'man ls', desc: '查看 ls 手册' },
      { cmd: 'man -k "copy files"', desc: '关键词搜索' },
      { cmd: 'man 5 crontab', desc: '查看指定章节' },
    ],
  },
  // info - 查看info文档
  {
    cmd: 'info',
    desc: '查看info文档',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<command>', desc: '命令名', type: 'value' }],
    examples: [
      { cmd: 'info coreutils', desc: '查看 coreutils 文档' },
      { cmd: 'info ls', desc: '查看 ls 文档' },
    ],
  },
  // help - 查看内建帮助
  {
    cmd: 'help',
    desc: '查看内建帮助',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<command>', desc: '命令名', type: 'value' }],
    examples: [
      { cmd: 'help', desc: '列出所有内建命令' },
      { cmd: 'help cd', desc: '查看 cd 帮助' },
    ],
  },
  // read - 读取输入
  {
    cmd: 'read',
    desc: '读取输入',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-p', desc: '提示符', requiresValue: true, valueHint: '<prompt>' },
      { name: '-t', desc: '超时（秒）', requiresValue: true, valueHint: '<seconds>' },
      { name: '-n', desc: '读取字符数', requiresValue: true, valueHint: '<count>' },
      { name: '-s', desc: '静默模式', type: 'flag' },
      { name: '-a', desc: '读入数组', requiresValue: true, valueHint: '<name>' },
    ],
    positional: [{ name: '<variable>', desc: '变量名', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'read -p "Name: " name', desc: '提示输入名字' },
      { cmd: 'read -s -p "Password: " pwd', desc: '静默读取密码' },
      { cmd: 'read -t 5 answer', desc: '5秒超时读取' },
    ],
  },
  // exec - 替换当前进程
  {
    cmd: 'exec',
    desc: '替换当前进程',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<command>', desc: '要执行的命令', type: 'value' }],
    examples: [
      { cmd: 'exec /bin/bash', desc: '替换为 bash' },
      { cmd: 'exec ls', desc: '执行后退出当前 shell' },
    ],
  },
  // eval - 执行字符串
  {
    cmd: 'eval',
    desc: '执行字符串',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<command>', desc: '命令字符串', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'eval "a=1; b=2; echo $((a+b))"', desc: '执行组合命令' },
      { cmd: 'eval $(ssh-agent)', desc: '执行代理输出' },
    ],
  },
  // trap - 信号处理
  {
    cmd: 'trap',
    desc: '信号处理',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-l', desc: '列出所有信号', type: 'flag' },
      { name: '-p', desc: '显示当前处理', type: 'flag' },
    ],
    positional: [
      { name: '<action>', desc: '处理动作', type: 'value' },
      { name: '<signal>', desc: '信号名', type: 'value' },
    ],
    examples: [
      { cmd: 'trap "echo bye" EXIT', desc: '退出时执行' },
      { cmd: 'trap "" SIGINT', desc: '忽略 Ctrl+C' },
      { cmd: 'trap -l', desc: '列出所有信号' },
    ],
  },
  // wait - 等待后台进程
  {
    cmd: 'wait',
    desc: '等待后台进程',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<pid>', desc: '进程ID', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'wait', desc: '等待所有后台进程' },
      { cmd: 'wait 1234', desc: '等待指定进程' },
    ],
  },
  // jobs - 显示后台任务
  {
    cmd: 'jobs',
    desc: '显示后台任务',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-l', desc: '显示 PID', type: 'flag' },
      { name: '-p', desc: '仅显示 PID', type: 'flag' },
      { name: '-r', desc: '仅运行中', type: 'flag' },
      { name: '-s', desc: '仅已停止', type: 'flag' },
    ],
    positional: [{ name: '<jobid>', desc: '作业号', type: 'value' }],
    examples: [
      { cmd: 'jobs', desc: '显示所有任务' },
      { cmd: 'jobs -l', desc: '显示 PID' },
    ],
  },
  // bg - 后台运行
  {
    cmd: 'bg',
    desc: '后台运行',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<jobid>', desc: '作业号', type: 'value' }],
    examples: [
      { cmd: 'bg', desc: '将当前任务转后台' },
      { cmd: 'bg %1', desc: '将任务 1 转后台' },
    ],
  },
  // fg - 前台运行
  {
    cmd: 'fg',
    desc: '前台运行',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<jobid>', desc: '作业号', type: 'value' }],
    examples: [
      { cmd: 'fg', desc: '将当前任务转前台' },
      { cmd: 'fg %1', desc: '将任务 1 转前台' },
    ],
  },
  // disown - 移除作业
  {
    cmd: 'disown',
    desc: '移除作业',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-h', desc: '不发送 SIGHUP', type: 'flag' },
      { name: '-a', desc: '所有作业', type: 'flag' },
    ],
    positional: [{ name: '<jobid>', desc: '作业号', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'disown %1', desc: '移除任务 1' },
      { cmd: 'disown -a', desc: '移除所有任务' },
    ],
  },
  // nohup - 忽略SIGHUP运行
  {
    cmd: 'nohup',
    desc: '忽略SIGHUP运行',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<command>', desc: '命令', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'nohup ./server.sh &', desc: '后台运行服务' },
      { cmd: 'nohup tar -czf backup.tar.gz . > log.txt 2>&1 &', desc: '后台备份' },
    ],
  },
  // logout - 退出登录
  {
    cmd: 'logout',
    desc: '退出登录',
    category: 'shell-builtin',
    platforms: ['universal'],
  },
  // exit - 退出shell
  {
    cmd: 'exit',
    desc: '退出shell',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<code>', desc: '退出码', type: 'value' }],
    examples: [
      { cmd: 'exit', desc: '退出当前 shell' },
      { cmd: 'exit 1', desc: '以退出码 1 退出' },
    ],
  },
  // return - 从函数返回
  {
    cmd: 'return',
    desc: '从函数返回',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<code>', desc: '返回码', type: 'value' }],
    examples: [
      { cmd: 'return 0', desc: '返回成功' },
      { cmd: 'return 1', desc: '返回失败' },
    ],
  },
  // break - 跳出循环
  {
    cmd: 'break',
    desc: '跳出循环',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<n>', desc: '跳出层数', type: 'value' }],
    examples: [
      { cmd: 'break', desc: '跳出当前循环' },
      { cmd: 'break 2', desc: '跳出 2 层循环' },
    ],
  },
  // continue - 继续循环
  {
    cmd: 'continue',
    desc: '继续循环',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<n>', desc: '继续层数', type: 'value' }],
    examples: [
      { cmd: 'continue', desc: '继续当前循环' },
      { cmd: 'continue 2', desc: '继续外层循环' },
    ],
  },
  // shift - 左移位置参数
  {
    cmd: 'shift',
    desc: '左移位置参数',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<n>', desc: '移动位数', type: 'value' }],
    examples: [
      { cmd: 'shift', desc: '左移 1 位' },
      { cmd: 'shift 3', desc: '左移 3 位' },
    ],
  },
  // test - 条件测试
  {
    cmd: 'test',
    desc: '条件测试',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '是文件', requiresValue: true, valueHint: '<file>' },
      { name: '-d', desc: '是目录', requiresValue: true, valueHint: '<dir>' },
      { name: '-e', desc: '存在', requiresValue: true, valueHint: '<path>' },
      { name: '-r', desc: '可读', requiresValue: true, valueHint: '<path>' },
      { name: '-w', desc: '可写', requiresValue: true, valueHint: '<path>' },
      { name: '-x', desc: '可执行', requiresValue: true, valueHint: '<path>' },
      { name: '-z', desc: '空字符串', requiresValue: true, valueHint: '<str>' },
      { name: '-n', desc: '非空字符串', requiresValue: true, valueHint: '<str>' },
      { name: '-eq', desc: '等于（数字）', requiresValue: true, valueHint: '<n>' },
      { name: '-ne', desc: '不等于（数字）', requiresValue: true, valueHint: '<n>' },
      { name: '-lt', desc: '小于（数字）', requiresValue: true, valueHint: '<n>' },
      { name: '-gt', desc: '大于（数字）', requiresValue: true, valueHint: '<n>' },
      { name: '-le', desc: '小于等于（数字）', requiresValue: true, valueHint: '<n>' },
      { name: '-ge', desc: '大于等于（数字）', requiresValue: true, valueHint: '<n>' },
    ],
    positional: [{ name: '<expression>', desc: '条件表达式', type: 'value' }],
    examples: [
      { cmd: 'test -f /etc/passwd && echo "文件存在"', desc: '检测文件' },
      { cmd: 'test $a -eq 5', desc: '数字比较' },
      { cmd: 'test -z "$str"', desc: '检测空串' },
    ],
  },
  // true - 返回成功
  {
    cmd: 'true',
    desc: '返回成功',
    category: 'shell-builtin',
    platforms: ['universal'],
  },
  // false - 返回失败
  {
    cmd: 'false',
    desc: '返回失败',
    category: 'shell-builtin',
    platforms: ['universal'],
  },
  // declare - 声明变量
  {
    cmd: 'declare',
    desc: '声明变量',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-r', desc: '只读', type: 'flag' },
      { name: '-i', desc: '整数', type: 'flag' },
      { name: '-a', desc: '数组', type: 'flag' },
      { name: '-A', desc: '关联数组', type: 'flag' },
      { name: '-x', desc: '导出', type: 'flag' },
      { name: '-p', desc: '显示属性', type: 'flag' },
    ],
    positional: [{ name: '<name>=<value>', desc: '变量定义', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'declare -r PI=3.14', desc: '只读变量' },
      { cmd: 'declare -i num=10', desc: '整型变量' },
      { cmd: 'declare -A map=([a]=1 [b]=2)', desc: '关联数组' },
    ],
  },
  // local - 声明局部变量
  {
    cmd: 'local',
    desc: '声明局部变量',
    category: 'shell-builtin',
    platforms: ['universal'],
    positional: [{ name: '<name>=<value>', desc: '变量定义', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'local count=0', desc: '函数内局部变量' },
      { cmd: 'local name="test"', desc: '局部字符串变量' },
    ],
  },
  // readonly - 只读变量
  {
    cmd: 'readonly',
    desc: '只读变量',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [{ name: '-p', desc: '显示所有只读变量', type: 'flag' }],
    positional: [{ name: '<name>=<value>', desc: '变量定义', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'readonly CONF=/etc/app.conf', desc: '定义只读变量' },
      { cmd: 'readonly -p', desc: '显示所有只读变量' },
    ],
  },
  // xargs - 从stdin构建命令
  {
    cmd: 'xargs',
    desc: '从stdin构建命令',
    category: 'shell-builtin',
    platforms: ['universal'],
    params: [
      { name: '-I', desc: '替换符', requiresValue: true, valueHint: '<replace-str>' },
      { name: '-n', desc: '每次参数数', requiresValue: true, valueHint: '<max-args>' },
      { name: '-0', desc: 'null 分隔', type: 'flag' },
      { name: '-d', desc: '自定义分隔符', requiresValue: true, valueHint: '<delimiter>' },
      { name: '-P', desc: '并行数', requiresValue: true, valueHint: '<max-procs>' },
      { name: '-t', desc: '打印命令', type: 'flag' },
    ],
    positional: [{ name: '<command>', desc: '要执行的命令', type: 'value' }],
    examples: [
      { cmd: 'find . -name "*.log" | xargs rm', desc: '删除所有 log 文件' },
      { cmd: 'cat urls.txt | xargs -n 1 curl', desc: '逐个请求 URL' },
      { cmd: 'find . -type f -print0 | xargs -0 grep "TODO"', desc: '处理带空格文件名' },
    ],
  },
]
