import type { CommandSpec } from '@/lib/command-intelligence/types'

// Docker 容器与镜像命令（顶层 docker + docker-compose，共 130+ 子命令定义）
export const dockerCommands: CommandSpec[] = [
  {
    cmd: 'docker',
    desc: '容器引擎',
    category: 'docker',
    platforms: ['universal'],
    usage: 'docker COMMAND',
    params: [
      { name: '--version', desc: '版本', type: 'flag' },
      { name: '--host', desc: '指定 daemon', requiresValue: true, valueHint: '<host>' },
      { name: '--context', desc: '上下文', requiresValue: true, valueHint: '<name>' },
      { name: '--config', desc: '配置目录', requiresValue: true, valueHint: '<dir>' },
      { name: '--tls', desc: '启用 TLS', type: 'flag' },
      { name: '--tlsverify', desc: 'TLS 校验', type: 'flag' },
    ],
    subcommands: [
      // ============ 容器生命周期 ============
      {
        cmd: 'run',
        desc: '创建并启动容器',
        params: [
          { name: '-d', desc: '后台运行', type: 'flag' },
          { name: '-p', desc: '端口映射', requiresValue: true, valueHint: '<host>:<container>', repeatable: true },
          { name: '-v', desc: '挂载卷', requiresValue: true, valueHint: '<host>:<container>', repeatable: true },
          { name: '--name', desc: '容器名', requiresValue: true, valueHint: '<name>' },
          { name: '--rm', desc: '退出后删除', type: 'flag' },
          { name: '-it', desc: '交互+终端', type: 'flag' },
          { name: '-e', desc: '环境变量', requiresValue: true, valueHint: '<key>=<val>', repeatable: true },
          { name: '--network', desc: '网络', requiresValue: true, valueHint: '<net>' },
          { name: '--restart', desc: '重启策略', requiresValue: true, valueHint: 'always' },
          { name: '-w', desc: '工作目录', requiresValue: true, valueHint: '<dir>' },
          { name: '--entrypoint', desc: '入口点', requiresValue: true, valueHint: '<cmd>' },
          { name: '--user', desc: '用户', requiresValue: true, valueHint: '<uid>:<gid>' },
          { name: '--memory', desc: '内存限制', requiresValue: true, valueHint: '<bytes>' },
          { name: '--cpus', desc: 'CPU 数量', requiresValue: true, valueHint: '<n>' },
          { name: '--privileged', desc: '特权模式', type: 'flag' },
          { name: '--dns', desc: 'DNS 服务器', requiresValue: true, valueHint: '<ip>' },
        ],
        positional: [
          { name: '<image>', desc: '镜像名', type: 'value' },
          { name: '<cmd>', desc: '命令', type: 'vararg' },
        ],
        examples: [
          { cmd: 'docker run -d --name nginx -p 80:80 nginx', desc: '后台启动 nginx' },
          { cmd: 'docker run -it ubuntu bash', desc: '交互进入 ubuntu' },
          { cmd: 'docker run --rm alpine echo hello', desc: '执行后删除' },
        ],
      },
      {
        cmd: 'create',
        desc: '创建容器但不启动',
        params: [
          { name: '--name', desc: '容器名', requiresValue: true, valueHint: '<name>' },
          { name: '-p', desc: '端口映射', requiresValue: true, valueHint: '<host>:<container>' },
          { name: '-v', desc: '挂载卷', requiresValue: true, valueHint: '<host>:<container>' },
          { name: '-e', desc: '环境变量', requiresValue: true, valueHint: '<k>=<v>' },
          { name: '--network', desc: '网络', requiresValue: true, valueHint: '<net>' },
        ],
        positional: [
          { name: '<image>', desc: '镜像', type: 'value' },
          { name: '<cmd>', desc: '命令', type: 'vararg' },
        ],
        examples: [
          { cmd: 'docker create --name web nginx', desc: '创建容器 web' },
        ],
      },
      {
        cmd: 'start',
        desc: '启动已停止的容器',
        params: [
          { name: '-a', desc: '附加 stdout/stderr', type: 'flag' },
          { name: '-i', desc: '附加 stdin', type: 'flag' },
          { name: '--detach-keys', desc: '分离按键', requiresValue: true, valueHint: '<keys>' },
        ],
        positional: [{ name: '<container>', desc: '容器', type: 'value', repeatable: true }],
        examples: [
          { cmd: 'docker start web', desc: '启动容器 web' },
          { cmd: 'docker start -ai web', desc: '附加启动' },
        ],
      },
      {
        cmd: 'stop',
        desc: '停止运行中的容器',
        params: [{ name: '-t', desc: '等待秒数', requiresValue: true, valueHint: '<n>' }],
        positional: [{ name: '<container>', desc: '容器', type: 'value', repeatable: true }],
        examples: [
          { cmd: 'docker stop web', desc: '停止容器' },
          { cmd: 'docker stop -t 5 web', desc: '5 秒后强制停止' },
        ],
      },
      {
        cmd: 'restart',
        desc: '重启容器',
        params: [{ name: '-t', desc: '等待秒数', requiresValue: true, valueHint: '<n>' }],
        positional: [{ name: '<container>', desc: '容器', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker restart web', desc: '重启 web 容器' }],
      },
      {
        cmd: 'kill',
        desc: '向容器发送信号',
        params: [
          { name: '-s', desc: '信号', requiresValue: true, valueHint: '<signal>' },
        ],
        positional: [{ name: '<container>', desc: '容器', type: 'value', repeatable: true }],
        examples: [
          { cmd: 'docker kill web', desc: '默认 SIGKILL' },
          { cmd: 'docker kill -s HUP web', desc: '发送 SIGHUP' },
        ],
      },
      {
        cmd: 'rm',
        desc: '删除容器',
        params: [
          { name: '-f', desc: '强制删除运行中', type: 'flag' },
          { name: '-v', desc: '删除关联卷', type: 'flag' },
          { name: '-l', desc: '仅移除链接', type: 'flag' },
        ],
        positional: [{ name: '<container>', desc: '容器', type: 'value', repeatable: true }],
        examples: [
          { cmd: 'docker rm web', desc: '删除容器' },
          { cmd: 'docker rm -f $(docker ps -aq)', desc: '危险：删除全部容器（不可逆，慎用）' },
        ],
      },
      {
        cmd: 'pause',
        desc: '暂停容器进程（cgroup 冻结）',
        positional: [{ name: '<container>', desc: '容器', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker pause web', desc: '暂停 web' }],
      },
      {
        cmd: 'unpause',
        desc: '恢复暂停的容器',
        positional: [{ name: '<container>', desc: '容器', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker unpause web', desc: '恢复 web' }],
      },
      {
        cmd: 'rename',
        desc: '重命名容器',
        positional: [
          { name: '<old>', desc: '原名', type: 'value' },
          { name: '<new>', desc: '新名', type: 'value' },
        ],
        examples: [{ cmd: 'docker rename web webserver', desc: '重命名' }],
      },

      // ============ 容器交互 ============
      {
        cmd: 'exec',
        desc: '在运行中容器内执行命令',
        params: [
          { name: '-it', desc: '交互+终端', type: 'flag' },
          { name: '-d', desc: '后台执行', type: 'flag' },
          { name: '-u', desc: '用户', requiresValue: true, valueHint: '<user>' },
          { name: '-w', desc: '工作目录', requiresValue: true, valueHint: '<dir>' },
          { name: '-e', desc: '环境变量', requiresValue: true, valueHint: '<k>=<v>' },
          { name: '--privileged', desc: '特权', type: 'flag' },
        ],
        positional: [
          { name: '<container>', desc: '容器', type: 'value' },
          { name: '<cmd>', desc: '命令', type: 'vararg' },
        ],
        examples: [
          { cmd: 'docker exec -it nginx bash', desc: '进入 nginx' },
          { cmd: 'docker exec web ls /app', desc: '执行命令' },
        ],
      },
      {
        cmd: 'attach',
        desc: '附加到运行中容器',
        params: [
          { name: '--no-stdin', desc: '不附加 stdin', type: 'flag' },
          { name: '--sig-proxy', desc: '信号代理', type: 'flag' },
          { name: '--detach-keys', desc: '分离按键', requiresValue: true, valueHint: '<keys>' },
        ],
        positional: [{ name: '<container>', desc: '容器', type: 'value' }],
        examples: [{ cmd: 'docker attach web', desc: '附加到 web' }],
      },
      {
        cmd: 'logs',
        desc: '查看容器日志',
        params: [
          { name: '-f', desc: '追踪', type: 'flag' },
          { name: '--tail', desc: '尾部行数', requiresValue: true, valueHint: '<n>' },
          { name: '-t', desc: '时间戳', type: 'flag' },
          { name: '--since', desc: '起始时间', requiresValue: true, valueHint: '<time>' },
          { name: '--until', desc: '结束时间', requiresValue: true, valueHint: '<time>' },
          { name: '--details', desc: '附加细节', type: 'flag' },
        ],
        positional: [{ name: '<container>', desc: '容器', type: 'value' }],
        examples: [
          { cmd: 'docker logs -f --tail 100 nginx', desc: '追踪最近 100 行' },
          { cmd: 'docker logs --since 1h web', desc: '最近 1 小时' },
        ],
      },
      {
        cmd: 'top',
        desc: '查看容器内进程',
        params: [
          { name: '-eo', desc: '显示选项', requiresValue: true, valueHint: '<fmt>' },
        ],
        positional: [
          { name: '<container>', desc: '容器', type: 'value' },
          { name: '<ps-args>', desc: 'ps 参数', type: 'vararg' },
        ],
        examples: [{ cmd: 'docker top web', desc: '查看 web 进程' }],
      },
      {
        cmd: 'stats',
        desc: '实时资源占用',
        params: [
          { name: '-a', desc: '全部容器', type: 'flag' },
          { name: '--no-stream', desc: '只取一次', type: 'flag' },
          { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
        ],
        positional: [{ name: '<container>', desc: '容器', type: 'value', repeatable: true }],
        examples: [
          { cmd: 'docker stats', desc: '实时统计' },
          { cmd: 'docker stats --no-stream', desc: '一次性统计' },
        ],
      },
      {
        cmd: 'wait',
        desc: '阻塞直到容器停止',
        positional: [{ name: '<container>', desc: '容器', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker wait web', desc: '等待 web 退出' }],
      },
      {
        cmd: 'port',
        desc: '查看端口映射',
        params: [{ name: '--all', desc: '全部端口', type: 'flag' }],
        positional: [
          { name: '<container>', desc: '容器', type: 'value' },
          { name: '<port>', desc: '端口', type: 'value' },
        ],
        examples: [{ cmd: 'docker port web 80', desc: '查看 80 端口映射' }],
      },
      {
        cmd: 'diff',
        desc: '查看容器文件系统变化',
        positional: [{ name: '<container>', desc: '容器', type: 'value' }],
        examples: [{ cmd: 'docker diff web', desc: '查看变化' }],
      },

      // ============ 容器查看 ============
      {
        cmd: 'ps',
        desc: '列出容器',
        params: [
          { name: '-a', desc: '全部（含停止）', type: 'flag' },
          { name: '-q', desc: '只显示 ID', type: 'flag' },
          { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
          { name: '-l', desc: '最近一个', type: 'flag' },
          { name: '-s', desc: '显示大小', type: 'flag' },
          { name: '-n', desc: '最近 N 个', requiresValue: true, valueHint: '<n>' },
          { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
          { name: '--no-trunc', desc: '不截断', type: 'flag' },
        ],
        examples: [
          { cmd: 'docker ps', desc: '运行中容器' },
          { cmd: 'docker ps -a', desc: '全部容器' },
          { cmd: 'docker ps -a --format "table {{.Names}}\t{{.Status}}"', desc: '自定义格式' },
        ],
      },
      {
        cmd: 'inspect',
        desc: '查看容器/镜像详情',
        params: [
          { name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' },
          { name: '-s', desc: '含 size', type: 'flag' },
          { name: '--type', desc: '类型', requiresValue: true, valueHint: '<type>' },
        ],
        positional: [{ name: '<id>', desc: '容器/镜像 ID', type: 'value', repeatable: true }],
        examples: [
          { cmd: 'docker inspect web', desc: '查看详情' },
          { cmd: 'docker inspect -f "{{.NetworkSettings.IPAddress}}" web', desc: '取 IP' },
        ],
      },
      {
        cmd: 'events',
        desc: '实时事件流',
        params: [
          { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
          { name: '--since', desc: '起始', requiresValue: true, valueHint: '<time>' },
          { name: '--until', desc: '结束', requiresValue: true, valueHint: '<time>' },
          { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
        ],
        examples: [{ cmd: 'docker events --filter type=container', desc: '仅容器事件' }],
      },
      {
        cmd: 'history',
        desc: '镜像构建历史',
        params: [
          { name: '--no-trunc', desc: '不截断', type: 'flag' },
          { name: '-q', desc: '只显示 ID', type: 'flag' },
          { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
        ],
        positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
        examples: [{ cmd: 'docker history nginx', desc: '查看 nginx 历史' }],
      },

      // ============ 容器传输 ============
      {
        cmd: 'cp',
        desc: '容器与主机间复制文件',
        params: [
          { name: '-a', desc: '保留归档属性', type: 'flag' },
          { name: '-L', desc: '跟随符号链接', type: 'flag' },
        ],
        positional: [
          { name: '<src>', desc: '源 (container:path 或 path)', type: 'value' },
          { name: '<dst>', desc: '目标 (container:path 或 path)', type: 'value' },
        ],
        examples: [
          { cmd: 'docker cp web:/var/log/nginx.log .', desc: '从容器复制' },
          { cmd: 'docker cp ./app.conf web:/etc/', desc: '复制到容器' },
        ],
      },
      {
        cmd: 'export',
        desc: '导出容器文件系统为 tar',
        params: [{ name: '-o', desc: '输出文件', requiresValue: true, valueHint: '<file>' }],
        positional: [{ name: '<container>', desc: '容器', type: 'value' }],
        examples: [
          { cmd: 'docker export -o web.tar web', desc: '导出为 web.tar' },
          { cmd: 'docker export web > web.tar', desc: '重定向输出' },
        ],
      },
      {
        cmd: 'import',
        desc: '从 tar 创建镜像',
        params: [
          { name: '-c', desc: 'Dockerfile 指令', requiresValue: true, valueHint: '<cmd>' },
          { name: '-m', desc: '提交信息', requiresValue: true, valueHint: '<msg>' },
        ],
        positional: [
          { name: '<file>', desc: 'tar 文件或 -', type: 'path' },
          { name: '<repository>', desc: '仓库名:标签', type: 'value' },
        ],
        examples: [
          { cmd: 'docker import web.tar myimage:1.0', desc: '导入为镜像' },
          { cmd: 'cat web.tar | docker import - myimage:1.0', desc: '管道导入' },
        ],
      },

      // ============ 容器提交与镜像打包 ============
      {
        cmd: 'commit',
        desc: '从容器创建镜像',
        params: [
          { name: '-a', desc: '作者', requiresValue: true, valueHint: '<author>' },
          { name: '-m', desc: '提交信息', requiresValue: true, valueHint: '<msg>' },
          { name: '-c', desc: 'Dockerfile 指令', requiresValue: true, valueHint: '<cmd>' },
          { name: '-p', desc: '提交时暂停', type: 'flag' },
        ],
        positional: [
          { name: '<container>', desc: '容器', type: 'value' },
          { name: '<repo>:<tag>', desc: '镜像标签', type: 'value' },
        ],
        examples: [{ cmd: 'docker commit -m "fix" web myimage:1.0', desc: '提交为镜像' }],
      },
      {
        cmd: 'save',
        desc: '导出镜像为 tar',
        params: [
          { name: '-o', desc: '输出文件', requiresValue: true, valueHint: '<file>' },
          { name: '--compress', desc: '压缩', type: 'flag' },
        ],
        positional: [{ name: '<image>', desc: '镜像', type: 'value', repeatable: true }],
        examples: [
          { cmd: 'docker save -o nginx.tar nginx:latest', desc: '导出镜像' },
          { cmd: 'docker save nginx | gzip > nginx.tar.gz', desc: '压缩导出' },
        ],
      },
      {
        cmd: 'load',
        desc: '从 tar 导入镜像',
        params: [
          { name: '-i', desc: '输入文件', requiresValue: true, valueHint: '<file>' },
          { name: '-q', desc: '静默', type: 'flag' },
        ],
        examples: [
          { cmd: 'docker load -i nginx.tar', desc: '从文件导入' },
          { cmd: 'docker load < nginx.tar', desc: '从 stdin 导入' },
        ],
      },

      // ============ 镜像管理 ============
      {
        cmd: 'images',
        desc: '列出镜像',
        params: [
          { name: '-a', desc: '全部（含中间层）', type: 'flag' },
          { name: '-q', desc: '只显示 ID', type: 'flag' },
          { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
          { name: '--no-trunc', desc: '不截断', type: 'flag' },
          { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
        ],
        positional: [{ name: '<repository>', desc: '仓库名', type: 'value' }],
        examples: [
          { cmd: 'docker images', desc: '列出镜像' },
          { cmd: 'docker images -q --filter dangling=true', desc: '悬空镜像 ID' },
        ],
      },
      {
        cmd: 'rmi',
        desc: '删除镜像',
        params: [
          { name: '-f', desc: '强制删除', type: 'flag' },
          { name: '--no-prune', desc: '不清理父层', type: 'flag' },
        ],
        positional: [{ name: '<image>', desc: '镜像', type: 'value', repeatable: true }],
        examples: [
          { cmd: 'docker rmi nginx', desc: '删除 nginx' },
          { cmd: 'docker rmi $(docker images -q)', desc: '危险：删除全部镜像（不可逆，慎用）' },
        ],
      },
      {
        cmd: 'pull',
        desc: '拉取镜像',
        params: [
          { name: '--all-tags', desc: '全部标签', type: 'flag' },
          { name: '--platform', desc: '平台', requiresValue: true, valueHint: '<os/arch>' },
          { name: '-q', desc: '静默', type: 'flag' },
        ],
        positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
        examples: [
          { cmd: 'docker pull nginx:1.25', desc: '拉取指定版本' },
          { cmd: 'docker pull --all-tags alpine', desc: '拉取全部标签' },
        ],
      },
      {
        cmd: 'push',
        desc: '推送镜像到仓库',
        params: [
          { name: '--all-tags', desc: '全部标签', type: 'flag' },
          { name: '-q', desc: '静默', type: 'flag' },
          { name: '--disable-content-trust', desc: '禁用信任', type: 'flag' },
        ],
        positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
        examples: [{ cmd: 'docker push myrepo/myapp:1.0', desc: '推送镜像' }],
      },
      {
        cmd: 'build',
        desc: '构建镜像',
        params: [
          { name: '-t', desc: '标签', requiresValue: true, valueHint: '<name>:<tag>', repeatable: true },
          { name: '-f', desc: 'Dockerfile', requiresValue: true, valueHint: '<file>' },
          { name: '--no-cache', desc: '不用缓存', type: 'flag' },
          { name: '--build-arg', desc: '构建参数', requiresValue: true, valueHint: '<k>=<v>' },
          { name: '--target', desc: '构建阶段', requiresValue: true, valueHint: '<stage>' },
          { name: '--platform', desc: '平台', requiresValue: true, valueHint: '<os/arch>' },
          { name: '--pull', desc: '拉取最新基础镜像', type: 'flag' },
          { name: '--label', desc: '标签', requiresValue: true, valueHint: '<k>=<v>' },
        ],
        positional: [{ name: '<path>', desc: '构建上下文', type: 'path' }],
        examples: [
          { cmd: 'docker build -t myapp:1.0 .', desc: '构建当前目录' },
          { cmd: 'docker build -f Dockerfile.prod -t myapp .', desc: '指定 Dockerfile' },
        ],
      },
      {
        cmd: 'tag',
        desc: '为镜像打标签',
        positional: [
          { name: '<src>', desc: '源镜像', type: 'value' },
          { name: '<dst>', desc: '目标标签', type: 'value' },
        ],
        examples: [{ cmd: 'docker tag myapp:1.0 myrepo/myapp:1.0', desc: '打远程标签' }],
      },
      {
        cmd: 'search',
        desc: '搜索 Docker Hub 镜像',
        params: [
          { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
          { name: '--limit', desc: '数量上限', requiresValue: true, valueHint: '<n>' },
          { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
          { name: '--no-trunc', desc: '不截断', type: 'flag' },
        ],
        positional: [{ name: '<term>', desc: '关键词', type: 'value' }],
        examples: [
          { cmd: 'docker search nginx', desc: '搜索 nginx' },
          { cmd: 'docker search --filter stars=10 alpine', desc: '高赞过滤' },
        ],
      },

      // ============ 登录与信息 ============
      {
        cmd: 'login',
        desc: '登录镜像仓库',
        params: [
          { name: '-u', desc: '用户名', requiresValue: true, valueHint: '<user>' },
          { name: '-p', desc: '密码', requiresValue: true, valueHint: '<pass>' },
          { name: '--password-stdin', desc: '从 stdin 读密码', type: 'flag' },
        ],
        positional: [{ name: '<server>', desc: '仓库地址', type: 'value' }],
        examples: [
          { cmd: 'docker login', desc: '登录 Docker Hub' },
          { cmd: 'docker login registry.example.com', desc: '登录私有仓库' },
        ],
      },
      {
        cmd: 'logout',
        desc: '退出镜像仓库',
        positional: [{ name: '<server>', desc: '仓库地址', type: 'value' }],
        examples: [{ cmd: 'docker logout', desc: '退出登录' }],
      },
      {
        cmd: 'version',
        desc: '查看版本信息',
        params: [{ name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' }],
        examples: [{ cmd: 'docker version', desc: '查看版本' }],
      },
      {
        cmd: 'info',
        desc: '查看系统信息',
        params: [
          { name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' },
          { name: '--format', desc: '格式化', requiresValue: true, valueHint: '<tpl>' },
        ],
        examples: [{ cmd: 'docker info', desc: '系统信息' }],
      },

      // ============ 容器管理组 ============
      {
        cmd: 'container',
        desc: '容器管理',
        subcommands: [
          {
            cmd: 'ls',
            desc: '列出容器',
            params: [
              { name: '-a', desc: '全部', type: 'flag' },
              { name: '-q', desc: '只显示 ID', type: 'flag' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
            ],
            examples: [{ cmd: 'docker container ls -a', desc: '全部容器' }],
          },
          {
            cmd: 'prune',
            desc: '清理已停止的容器',
            params: [
              { name: '-f', desc: '强制', type: 'flag' },
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
            ],
            examples: [{ cmd: 'docker container prune -f', desc: '清理停止容器' }],
          },
          {
            cmd: 'inspect',
            desc: '容器详情',
            params: [{ name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' }],
            positional: [{ name: '<container>', desc: '容器', type: 'value' }],
          },
          {
            cmd: 'stats',
            desc: '容器统计',
            params: [{ name: '-a', desc: '全部', type: 'flag' }],
          },
        ],
      },

      // ============ 镜像管理组 ============
      {
        cmd: 'image',
        desc: '镜像管理',
        subcommands: [
          {
            cmd: 'ls',
            desc: '列出镜像',
            params: [
              { name: '-a', desc: '全部', type: 'flag' },
              { name: '-q', desc: '只显示 ID', type: 'flag' },
            ],
            examples: [{ cmd: 'docker image ls', desc: '镜像列表' }],
          },
          {
            cmd: 'prune',
            desc: '清理无用镜像',
            params: [
              { name: '-f', desc: '强制', type: 'flag' },
              { name: '-a', desc: '全部未使用', type: 'flag' },
            ],
            examples: [{ cmd: 'docker image prune -a', desc: '清理全部未使用' }],
          },
          {
            cmd: 'inspect',
            desc: '镜像详情',
            params: [{ name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' }],
            positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
          },
          {
            cmd: 'history',
            desc: '镜像历史',
            params: [{ name: '--no-trunc', desc: '不截断', type: 'flag' }],
            positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
          },
          {
            cmd: 'import',
            desc: '从 tar 创建镜像',
            positional: [{ name: '<file>', desc: 'tar 文件', type: 'path' }],
          },
          {
            cmd: 'save',
            desc: '导出镜像为 tar',
            params: [{ name: '-o', desc: '输出文件', requiresValue: true, valueHint: '<file>' }],
            positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
          },
          {
            cmd: 'load',
            desc: '从 tar 导入镜像',
            params: [{ name: '-i', desc: '输入文件', requiresValue: true, valueHint: '<file>' }],
          },
          {
            cmd: 'rm',
            desc: '删除镜像',
            params: [{ name: '-f', desc: '强制', type: 'flag' }],
            positional: [{ name: '<image>', desc: '镜像', type: 'value', repeatable: true }],
          },
          {
            cmd: 'tag',
            desc: '打标签',
            positional: [
              { name: '<src>', desc: '源镜像', type: 'value' },
              { name: '<dst>', desc: '目标标签', type: 'value' },
            ],
          },
          {
            cmd: 'pull',
            desc: '拉取镜像',
            positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
          },
          {
            cmd: 'push',
            desc: '推送镜像',
            positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
          },
        ],
      },

      // ============ 网络管理 ============
      {
        cmd: 'network',
        desc: '网络管理',
        subcommands: [
          {
            cmd: 'ls',
            desc: '列出网络',
            params: [
              { name: '-q', desc: '只显示 ID', type: 'flag' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
              { name: '--no-trunc', desc: '不截断', type: 'flag' },
            ],
            examples: [{ cmd: 'docker network ls', desc: '网络列表' }],
          },
          {
            cmd: 'create',
            desc: '创建网络',
            params: [
              { name: '-d', desc: '驱动', requiresValue: true, valueHint: '<driver>' },
              { name: '--subnet', desc: '子网', requiresValue: true, valueHint: '<cidr>' },
              { name: '--gateway', desc: '网关', requiresValue: true, valueHint: '<ip>' },
              { name: '--ip-range', desc: 'IP 范围', requiresValue: true, valueHint: '<cidr>' },
              { name: '--internal', desc: '内部网络', type: 'flag' },
              { name: '--attachable', desc: '可手动连接', type: 'flag' },
              { name: '--label', desc: '标签', requiresValue: true, valueHint: '<k>=<v>' },
            ],
            positional: [{ name: '<name>', desc: '网络名', type: 'value' }],
            examples: [
              { cmd: 'docker network create -d bridge mynet', desc: '创建 bridge 网络' },
              { cmd: 'docker network create --subnet 10.0.0.0/24 mynet', desc: '指定子网' },
            ],
          },
          {
            cmd: 'rm',
            desc: '删除网络',
            params: [{ name: '-f', desc: '强制', type: 'flag' }],
            positional: [{ name: '<name>', desc: '网络名', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker network rm mynet', desc: '删除网络' }],
          },
          {
            cmd: 'inspect',
            desc: '网络详情',
            params: [{ name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' }],
            positional: [{ name: '<name>', desc: '网络名', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker network inspect mynet', desc: '查看详情' }],
          },
          {
            cmd: 'connect',
            desc: '连接容器到网络',
            params: [
              { name: '--alias', desc: '别名', requiresValue: true, valueHint: '<name>' },
              { name: '--ip', desc: '指定 IP', requiresValue: true, valueHint: '<ip>' },
              { name: '--link', desc: '链接', requiresValue: true, valueHint: '<container>' },
            ],
            positional: [
              { name: '<net>', desc: '网络', type: 'value' },
              { name: '<container>', desc: '容器', type: 'value' },
            ],
            examples: [{ cmd: 'docker network connect mynet web', desc: '连接容器' }],
          },
          {
            cmd: 'disconnect',
            desc: '断开容器与网络',
            params: [{ name: '-f', desc: '强制', type: 'flag' }],
            positional: [
              { name: '<net>', desc: '网络', type: 'value' },
              { name: '<container>', desc: '容器', type: 'value' },
            ],
            examples: [{ cmd: 'docker network disconnect mynet web', desc: '断开' }],
          },
          {
            cmd: 'prune',
            desc: '清理无用网络',
            params: [
              { name: '-f', desc: '强制', type: 'flag' },
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
            ],
            examples: [{ cmd: 'docker network prune', desc: '清理无用网络' }],
          },
        ],
      },

      // ============ 卷管理 ============
      {
        cmd: 'volume',
        desc: '卷管理',
        subcommands: [
          {
            cmd: 'ls',
            desc: '列出卷',
            params: [
              { name: '-q', desc: '只显示名', type: 'flag' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
            ],
            examples: [{ cmd: 'docker volume ls', desc: '卷列表' }],
          },
          {
            cmd: 'create',
            desc: '创建卷（卷名为位置参数，无 --name 选项）',
            params: [
              { name: '-d', desc: '驱动', requiresValue: true, valueHint: '<driver>' },
              { name: '--opt', desc: '驱动选项', requiresValue: true, valueHint: '<k>=<v>' },
              { name: '--label', desc: '标签', requiresValue: true, valueHint: '<k>=<v>' },
            ],
            examples: [
              { cmd: 'docker volume create myvol', desc: '创建卷' },
              { cmd: 'docker volume create -d nfs myvol', desc: '指定驱动' },
            ],
          },
          {
            cmd: 'rm',
            desc: '删除卷',
            params: [{ name: '-f', desc: '强制', type: 'flag' }],
            positional: [{ name: '<name>', desc: '卷名', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker volume rm myvol', desc: '删除卷' }],
          },
          {
            cmd: 'inspect',
            desc: '卷详情',
            params: [{ name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' }],
            positional: [{ name: '<name>', desc: '卷名', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker volume inspect myvol', desc: '查看详情' }],
          },
          {
            cmd: 'prune',
            desc: '清理无用卷',
            params: [
              { name: '-f', desc: '强制', type: 'flag' },
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
            ],
            examples: [{ cmd: 'docker volume prune', desc: '清理无用卷' }],
          },
        ],
      },

      // ============ 系统管理 ============
      {
        cmd: 'system',
        desc: '系统管理',
        subcommands: [
          {
            cmd: 'df',
            desc: '磁盘占用',
            params: [
              { name: '-v', desc: '详细信息', type: 'flag' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
            ],
            examples: [{ cmd: 'docker system df', desc: '磁盘占用' }],
          },
          {
            cmd: 'events',
            desc: '系统事件流',
            params: [
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
              { name: '--since', desc: '起始', requiresValue: true, valueHint: '<time>' },
              { name: '--until', desc: '结束', requiresValue: true, valueHint: '<time>' },
            ],
            examples: [{ cmd: 'docker system events', desc: '事件流' }],
          },
          {
            cmd: 'info',
            desc: '系统信息',
            params: [{ name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' }],
            examples: [{ cmd: 'docker system info', desc: '信息' }],
          },
          {
            cmd: 'prune',
            desc: '全面清理',
            params: [
              { name: '-f', desc: '强制', type: 'flag' },
              { name: '-a', desc: '含未使用镜像', type: 'flag' },
              { name: '--volumes', desc: '含卷', type: 'flag' },
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
            ],
            examples: [
              { cmd: 'docker system prune -af', desc: '危险：删除全部未使用资源含镜像（不可逆，慎用）' },
              { cmd: 'docker system prune --volumes', desc: '含卷清理' },
            ],
          },
        ],
      },

      // ============ Swarm 集群 ============
      {
        cmd: 'swarm',
        desc: 'Swarm 集群管理',
        subcommands: [
          {
            cmd: 'init',
            desc: '初始化 Swarm',
            params: [
              { name: '--advertise-addr', desc: '广播地址', requiresValue: true, valueHint: '<ip:port>' },
              { name: '--listen-addr', desc: '监听地址', requiresValue: true, valueHint: '<ip:port>' },
              { name: '--autolock', desc: '自动锁定', type: 'flag' },
              { name: '--force-new-cluster', desc: '强制新集群', type: 'flag' },
            ],
            examples: [{ cmd: 'docker swarm init --advertise-addr 192.168.1.10', desc: '初始化' }],
          },
          {
            cmd: 'join',
            desc: '加入 Swarm',
            params: [
              { name: '--token', desc: '令牌', requiresValue: true, valueHint: '<token>' },
              { name: '--advertise-addr', desc: '广播地址', requiresValue: true, valueHint: '<ip:port>' },
              { name: '--listen-addr', desc: '监听地址', requiresValue: true, valueHint: '<ip:port>' },
            ],
            positional: [{ name: '<host>:<port>', desc: '管理节点', type: 'value' }],
            examples: [{ cmd: 'docker swarm join --token SWMTKN-... 192.168.1.10:2377', desc: '加入' }],
          },
          {
            cmd: 'leave',
            desc: '离开 Swarm',
            params: [{ name: '-f', desc: '强制', type: 'flag' }],
            examples: [
              { cmd: 'docker swarm leave', desc: '离开（worker）' },
              { cmd: 'docker swarm leave -f', desc: '强制离开' },
            ],
          },
          {
            cmd: 'update',
            desc: '更新 Swarm 配置',
            params: [
              { name: '--cert-expiry', desc: '证书有效期', requiresValue: true, valueHint: '<duration>' },
              { name: '--dispatcher-heartbeat', desc: '心跳', requiresValue: true, valueHint: '<duration>' },
              { name: '--autolock', desc: '自动锁定', type: 'flag' },
            ],
            examples: [{ cmd: 'docker swarm update --autolock', desc: '开启锁定' }],
          },
          {
            cmd: 'join-token',
            desc: '查看/轮换加入令牌',
            params: [
              { name: '-q', desc: '只显示令牌', type: 'flag' },
              { name: '--rotate', desc: '轮换', type: 'flag' },
            ],
            positional: [{ name: '<role>', desc: 'worker|manager', type: 'choice', choices: ['worker', 'manager'] }],
            examples: [
              { cmd: 'docker swarm join-token worker', desc: '查看 worker 令牌' },
              { cmd: 'docker swarm join-token --rotate manager', desc: '轮换 manager 令牌' },
            ],
          },
        ],
      },

      // ============ Service 服务 ============
      {
        cmd: 'service',
        desc: 'Swarm 服务管理',
        subcommands: [
          {
            cmd: 'create',
            desc: '创建服务',
            params: [
              { name: '--name', desc: '名称', requiresValue: true, valueHint: '<name>' },
              { name: '--replicas', desc: '副本数', requiresValue: true, valueHint: '<n>' },
              { name: '-p', desc: '端口映射', requiresValue: true, valueHint: '<host>:<container>' },
              { name: '--network', desc: '网络', requiresValue: true, valueHint: '<net>' },
              { name: '--env', desc: '环境变量', requiresValue: true, valueHint: '<k>=<v>' },
              { name: '--mode', desc: '模式', requiresValue: true, valueHint: 'replicated|global' },
              { name: '--mount', desc: '挂载', requiresValue: true, valueHint: '<mount>' },
              { name: '--constraint', desc: '约束', requiresValue: true, valueHint: '<expr>' },
            ],
            positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
            examples: [
              { cmd: 'docker service create --name web --replicas 3 -p 80:80 nginx', desc: '3 副本服务' },
              { cmd: 'docker service create --mode global nginx', desc: '全局服务' },
            ],
          },
          {
            cmd: 'ls',
            desc: '服务列表',
            params: [
              { name: '-q', desc: '只显示 ID', type: 'flag' },
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
            ],
            examples: [{ cmd: 'docker service ls', desc: '服务列表' }],
          },
          {
            cmd: 'rm',
            desc: '删除服务',
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker service rm web', desc: '删除服务' }],
          },
          {
            cmd: 'ps',
            desc: '服务任务列表',
            params: [
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
              { name: '--no-trunc', desc: '不截断', type: 'flag' },
              { name: '-q', desc: '只显示 ID', type: 'flag' },
            ],
            positional: [{ name: '<service>', desc: '服务', type: 'value' }],
            examples: [{ cmd: 'docker service ps web', desc: '任务列表' }],
          },
          {
            cmd: 'inspect',
            desc: '服务详情',
            params: [{ name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' }],
            positional: [{ name: '<service>', desc: '服务', type: 'value' }],
            examples: [{ cmd: 'docker service inspect web', desc: '详情' }],
          },
          {
            cmd: 'scale',
            desc: '服务扩缩容',
            positional: [{ name: '<service>=<n>', desc: '服务=数量', type: 'value', repeatable: true }],
            examples: [
              { cmd: 'docker service scale web=5', desc: '扩容到 5' },
              { cmd: 'docker service scale web=3 db=2', desc: '批量扩缩' },
            ],
          },
          {
            cmd: 'update',
            desc: '更新服务',
            params: [
              { name: '--image', desc: '镜像', requiresValue: true, valueHint: '<image>' },
              { name: '--replicas', desc: '副本数', requiresValue: true, valueHint: '<n>' },
              { name: '--env-add', desc: '添加环境变量', requiresValue: true, valueHint: '<k>=<v>' },
              { name: '--env-rm', desc: '移除环境变量', requiresValue: true, valueHint: '<k>' },
              { name: '--publish-add', desc: '添加端口', requiresValue: true, valueHint: '<port>' },
              { name: '--force', desc: '强制更新', type: 'flag' },
            ],
            positional: [{ name: '<service>', desc: '服务', type: 'value' }],
            examples: [{ cmd: 'docker service update --image nginx:1.25 web', desc: '更新镜像' }],
          },
          {
            cmd: 'logs',
            desc: '服务日志',
            params: [
              { name: '-f', desc: '追踪', type: 'flag' },
              { name: '--tail', desc: '尾部行数', requiresValue: true, valueHint: '<n>' },
              { name: '--since', desc: '起始', requiresValue: true, valueHint: '<time>' },
              { name: '--details', desc: '细节', type: 'flag' },
            ],
            positional: [{ name: '<service>', desc: '服务或任务 ID', type: 'value' }],
            examples: [{ cmd: 'docker service logs -f web', desc: '追踪日志' }],
          },
        ],
      },

      // ============ Node 节点 ============
      {
        cmd: 'node',
        desc: 'Swarm 节点管理',
        subcommands: [
          {
            cmd: 'ls',
            desc: '节点列表',
            params: [
              { name: '-q', desc: '只显示 ID', type: 'flag' },
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
            ],
            examples: [{ cmd: 'docker node ls', desc: '节点列表' }],
          },
          {
            cmd: 'inspect',
            desc: '节点详情',
            params: [{ name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' }],
            positional: [{ name: '<node>', desc: '节点', type: 'value' }],
            examples: [{ cmd: 'docker node inspect self', desc: '本节点详情' }],
          },
          {
            cmd: 'promote',
            desc: '提升为 manager',
            positional: [{ name: '<node>', desc: '节点', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker node promote node-2', desc: '提升' }],
          },
          {
            cmd: 'demote',
            desc: '降级为 worker',
            positional: [{ name: '<node>', desc: '节点', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker node demote node-2', desc: '降级' }],
          },
          {
            cmd: 'ps',
            desc: '节点任务',
            params: [{ name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' }],
            positional: [{ name: '<node>', desc: '节点', type: 'value' }],
            examples: [{ cmd: 'docker node ps self', desc: '本节点任务' }],
          },
          {
            cmd: 'rm',
            desc: '删除节点',
            params: [{ name: '-f', desc: '强制', type: 'flag' }],
            positional: [{ name: '<node>', desc: '节点', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker node rm node-3', desc: '删除节点' }],
          },
          {
            cmd: 'update',
            desc: '更新节点',
            params: [
              { name: '--availability', desc: '可用性', requiresValue: true, valueHint: 'active|pause|drain' },
              { name: '--label-add', desc: '添加标签', requiresValue: true, valueHint: '<k>=<v>' },
              { name: '--label-rm', desc: '移除标签', requiresValue: true, valueHint: '<k>' },
              { name: '--role', desc: '角色', requiresValue: true, valueHint: 'worker|manager' },
            ],
            positional: [{ name: '<node>', desc: '节点', type: 'value' }],
            examples: [
              { cmd: 'docker node update --availability drain node-2', desc: '排空节点' },
              { cmd: 'docker node update --label-add ssd=true node-1', desc: '加标签' },
            ],
          },
        ],
      },

      // ============ Secret 机密 ============
      {
        cmd: 'secret',
        desc: 'Swarm 机密管理',
        subcommands: [
          {
            cmd: 'create',
            desc: '创建机密',
            params: [
              { name: '-l', desc: '标签', requiresValue: true, valueHint: '<k>=<v>' },
              { name: '-d', desc: '驱动', requiresValue: true, valueHint: '<driver>' },
            ],
            positional: [
              { name: '<name>', desc: '名称', type: 'value' },
              { name: '<file>', desc: '文件或 -', type: 'path' },
            ],
            examples: [
              { cmd: 'docker secret create db-pass /run/secrets/pass', desc: '从文件创建' },
              { cmd: 'echo "pass" | docker secret create db-pass -', desc: '从 stdin' },
            ],
          },
          {
            cmd: 'ls',
            desc: '机密列表',
            params: [
              { name: '-q', desc: '只显示 ID', type: 'flag' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
            ],
            examples: [{ cmd: 'docker secret ls', desc: '机密列表' }],
          },
          {
            cmd: 'rm',
            desc: '删除机密',
            positional: [{ name: '<secret>', desc: '机密', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker secret rm db-pass', desc: '删除' }],
          },
          {
            cmd: 'inspect',
            desc: '机密详情',
            params: [{ name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' }],
            positional: [{ name: '<secret>', desc: '机密', type: 'value' }],
            examples: [{ cmd: 'docker secret inspect db-pass', desc: '详情' }],
          },
        ],
      },

      // ============ Config 配置 ============
      {
        cmd: 'config',
        desc: 'Swarm 配置文件管理',
        subcommands: [
          {
            cmd: 'create',
            desc: '创建配置',
            params: [
              { name: '-l', desc: '标签', requiresValue: true, valueHint: '<k>=<v>' },
              { name: '--template-driver', desc: '模板驱动', requiresValue: true, valueHint: '<driver>' },
            ],
            positional: [
              { name: '<name>', desc: '名称', type: 'value' },
              { name: '<file>', desc: '文件或 -', type: 'path' },
            ],
            examples: [{ cmd: 'docker config create nginx-conf /etc/nginx/nginx.conf', desc: '创建配置' }],
          },
          {
            cmd: 'ls',
            desc: '配置列表',
            params: [
              { name: '-q', desc: '只显示 ID', type: 'flag' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
            ],
            examples: [{ cmd: 'docker config ls', desc: '配置列表' }],
          },
          {
            cmd: 'rm',
            desc: '删除配置',
            positional: [{ name: '<config>', desc: '配置', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker config rm nginx-conf', desc: '删除' }],
          },
          {
            cmd: 'inspect',
            desc: '配置详情',
            params: [{ name: '-f', desc: '格式化', requiresValue: true, valueHint: '<tpl>' }],
            positional: [{ name: '<config>', desc: '配置', type: 'value' }],
            examples: [{ cmd: 'docker config inspect nginx-conf', desc: '详情' }],
          },
        ],
      },

      // ============ Stack 栈 ============
      {
        cmd: 'stack',
        desc: 'Swarm 栈（多服务编排）',
        params: [
          { name: '--orchestrator', desc: '编排器', requiresValue: true, valueHint: 'swarm|kubernetes' },
        ],
        subcommands: [
          {
            cmd: 'deploy',
            desc: '部署栈',
            params: [
              { name: '-c', desc: 'compose 文件', requiresValue: true, valueHint: '<file>', repeatable: true },
              { name: '--with-registry-auth', desc: '带仓库认证', type: 'flag' },
              { name: '--prune', desc: '清理旧服务', type: 'flag' },
              { name: '--resolve-image', desc: '镜像解析', requiresValue: true, valueHint: 'always|changed|never' },
            ],
            positional: [{ name: '<stack>', desc: '栈名', type: 'value' }],
            examples: [
              { cmd: 'docker stack deploy -c stack.yml mystack', desc: '部署' },
              { cmd: 'docker stack deploy -c stack.yml --with-registry-auth mystack', desc: '带认证' },
            ],
          },
          {
            cmd: 'ls',
            desc: '栈列表',
            params: [{ name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' }],
            examples: [{ cmd: 'docker stack ls', desc: '栈列表' }],
          },
          {
            cmd: 'rm',
            desc: '删除栈',
            positional: [{ name: '<stack>', desc: '栈名', type: 'value' }],
            examples: [{ cmd: 'docker stack rm mystack', desc: '删除栈' }],
          },
          {
            cmd: 'ps',
            desc: '栈任务列表',
            params: [
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
              { name: '--no-trunc', desc: '不截断', type: 'flag' },
            ],
            positional: [{ name: '<stack>', desc: '栈名', type: 'value' }],
            examples: [{ cmd: 'docker stack ps mystack', desc: '栈任务' }],
          },
          {
            cmd: 'services',
            desc: '栈服务列表',
            params: [
              { name: '-q', desc: '只显示 ID', type: 'flag' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
            ],
            positional: [{ name: '<stack>', desc: '栈名', type: 'value' }],
            examples: [{ cmd: 'docker stack services mystack', desc: '栈服务' }],
          },
        ],
      },

      // ============ Plugin 插件 ============
      {
        cmd: 'plugin',
        desc: '插件管理',
        subcommands: [
          {
            cmd: 'install',
            desc: '安装插件',
            params: [
              { name: '--alias', desc: '别名', requiresValue: true, valueHint: '<name>' },
              { name: '--disable', desc: '安装后禁用', type: 'flag' },
              { name: '--grant-all-permissions', desc: '授予所有权限', type: 'flag' },
            ],
            positional: [{ name: '<plugin>', desc: '插件', type: 'value' }],
            examples: [{ cmd: 'docker plugin install vieux/sshfs', desc: '安装插件' }],
          },
          {
            cmd: 'ls',
            desc: '插件列表',
            params: [
              { name: '-q', desc: '只显示 ID', type: 'flag' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
            ],
            examples: [{ cmd: 'docker plugin ls', desc: '插件列表' }],
          },
          {
            cmd: 'rm',
            desc: '删除插件',
            params: [{ name: '-f', desc: '强制', type: 'flag' }],
            positional: [{ name: '<plugin>', desc: '插件', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker plugin rm vieux/sshfs', desc: '删除插件' }],
          },
          {
            cmd: 'enable',
            desc: '启用插件',
            positional: [{ name: '<plugin>', desc: '插件', type: 'value' }],
            examples: [{ cmd: 'docker plugin enable vieux/sshfs', desc: '启用' }],
          },
          {
            cmd: 'disable',
            desc: '禁用插件',
            params: [{ name: '-f', desc: '强制', type: 'flag' }],
            positional: [{ name: '<plugin>', desc: '插件', type: 'value' }],
            examples: [{ cmd: 'docker plugin disable vieux/sshfs', desc: '禁用' }],
          },
        ],
      },

      // ============ Trust 信任 ============
      {
        cmd: 'trust',
        desc: '镜像内容信任（DCT）',
        subcommands: [
          {
            cmd: 'sign',
            desc: '签名镜像',
            params: [{ name: '--local', desc: '本地签名', type: 'flag' }],
            positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
            examples: [{ cmd: 'docker trust sign myrepo/myapp:1.0', desc: '签名镜像' }],
          },
          {
            cmd: 'inspect',
            desc: '查看签名信息',
            params: [{ name: '--pretty', desc: '美化输出', type: 'flag' }],
            positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
            examples: [{ cmd: 'docker trust inspect myrepo/myapp:1.0', desc: '查看签名' }],
          },
          {
            cmd: 'key',
            desc: '密钥管理',
            subcommands: [
              { cmd: 'generate', desc: '生成密钥', positional: [{ name: '<name>', desc: '名称', type: 'value' }] },
              { cmd: 'load', desc: '加载密钥', positional: [{ name: '<file>', desc: '密钥文件', type: 'path' }] },
              { cmd: 'rotate', desc: '轮换根密钥' },
            ],
          },
          {
            cmd: 'signer',
            desc: '签名者管理',
            subcommands: [
              {
                cmd: 'add',
                desc: '添加签名者',
                params: [{ name: '--key', desc: '公钥文件', requiresValue: true, valueHint: '<file>' }],
                positional: [
                  { name: '<signer>', desc: '签名者名', type: 'value' },
                  { name: '<repository>', desc: '仓库', type: 'value' },
                ],
                examples: [{ cmd: 'docker trust signer add --key alice.pub alice myrepo/myapp', desc: '添加' }],
              },
              {
                cmd: 'remove',
                desc: '移除签名者',
                positional: [
                  { name: '<signer>', desc: '签名者名', type: 'value' },
                  { name: '<repository>', desc: '仓库', type: 'value' },
                ],
                examples: [{ cmd: 'docker trust signer remove alice myrepo/myapp', desc: '移除' }],
              },
            ],
          },
        ],
      },

      // ============ Manifest 清单 ============
      {
        cmd: 'manifest',
        desc: '镜像清单（实验性）',
        subcommands: [
          {
            cmd: 'create',
            desc: '创建清单列表',
            positional: [
              { name: '<manifest>', desc: '目标清单', type: 'value' },
              { name: '<image>', desc: '镜像', type: 'value', repeatable: true },
            ],
            examples: [{ cmd: 'docker manifest create myapp:latest myapp:linux myapp:windows', desc: '创建' }],
          },
          {
            cmd: 'inspect',
            desc: '查看清单',
            params: [{ name: '--verbose', desc: '详细', type: 'flag' }],
            positional: [{ name: '<manifest>', desc: '清单', type: 'value' }],
            examples: [{ cmd: 'docker manifest inspect myapp:latest', desc: '查看' }],
          },
          {
            cmd: 'push',
            desc: '推送清单列表',
            params: [{ name: '--purge', desc: '推送后清除本地', type: 'flag' }],
            positional: [{ name: '<manifest>', desc: '清单', type: 'value' }],
            examples: [{ cmd: 'docker manifest push myapp:latest', desc: '推送' }],
          },
          {
            cmd: 'annotate',
            desc: '添加注释',
            params: [
              { name: '--os', desc: '操作系统', requiresValue: true, valueHint: '<os>' },
              { name: '--arch', desc: '架构', requiresValue: true, valueHint: '<arch>' },
              { name: '--variant', desc: '变体', requiresValue: true, valueHint: '<variant>' },
              { name: '--os-features', desc: 'OS 特性', requiresValue: true, valueHint: '<features>' },
            ],
            positional: [
              { name: '<manifest>', desc: '清单', type: 'value' },
              { name: '<image>', desc: '镜像', type: 'value' },
            ],
            examples: [{ cmd: 'docker manifest annotate --arch arm64 myapp:latest myapp:arm64', desc: '注释' }],
          },
        ],
      },

      // ============ Buildx 构建器 ============
      {
        cmd: 'buildx',
        desc: '扩展构建器',
        subcommands: [
          {
            cmd: 'build',
            desc: '构建镜像（多平台）',
            params: [
              { name: '--platform', desc: '平台', requiresValue: true, valueHint: '<os/arch>' },
              { name: '-t', desc: '标签', requiresValue: true, valueHint: '<name>:<tag>', repeatable: true },
              { name: '--push', desc: '构建后推送', type: 'flag' },
              { name: '--load', desc: '加载到本地', type: 'flag' },
              { name: '--output', desc: '输出', requiresValue: true, valueHint: '<type>' },
              { name: '--no-cache', desc: '不用缓存', type: 'flag' },
              { name: '--cache-from', desc: '缓存源', requiresValue: true, valueHint: '<ref>' },
              { name: '--cache-to', desc: '缓存目标', requiresValue: true, valueHint: '<ref>' },
            ],
            positional: [{ name: '<path>', desc: '构建上下文', type: 'path' }],
            examples: [
              { cmd: 'docker buildx build --platform linux/amd64,linux/arm64 -t myapp:latest --push .', desc: '多平台构建并推送' },
              { cmd: 'docker buildx build --load -t myapp:1.0 .', desc: '构建并加载' },
            ],
          },
          {
            cmd: 'ls',
            desc: '构建器列表',
            examples: [{ cmd: 'docker buildx ls', desc: '构建器列表' }],
          },
          {
            cmd: 'create',
            desc: '创建构建器',
            params: [
              { name: '--name', desc: '名称', requiresValue: true, valueHint: '<name>' },
              { name: '--driver', desc: '驱动', requiresValue: true, valueHint: 'docker-container|kubernetes' },
              { name: '--use', desc: '设为当前', type: 'flag' },
              { name: '--platform', desc: '平台', requiresValue: true, valueHint: '<os/arch>' },
            ],
            examples: [
              { cmd: 'docker buildx create --name mybuilder --use', desc: '创建并切换' },
              { cmd: 'docker buildx create --driver docker-container mybuilder', desc: '指定驱动' },
            ],
          },
          {
            cmd: 'use',
            desc: '切换构建器',
            params: [{ name: '--default', desc: '默认', type: 'flag' }],
            positional: [{ name: '<name>', desc: '构建器名', type: 'value' }],
            examples: [{ cmd: 'docker buildx use mybuilder', desc: '切换' }],
          },
          {
            cmd: 'inspect',
            desc: '查看构建器',
            params: [{ name: '--bootstrap', desc: '启动构建器', type: 'flag' }],
            positional: [{ name: '<name>', desc: '构建器名', type: 'value' }],
            examples: [{ cmd: 'docker buildx inspect --bootstrap', desc: '查看并启动' }],
          },
          {
            cmd: 'rm',
            desc: '删除构建器',
            params: [{ name: '-f', desc: '强制', type: 'flag' }],
            positional: [{ name: '<name>', desc: '构建器名', type: 'value' }],
            examples: [{ cmd: 'docker buildx rm mybuilder', desc: '删除' }],
          },
          {
            cmd: 'prune',
            desc: '清理构建缓存',
            params: [
              { name: '-f', desc: '强制', type: 'flag' },
              { name: '--all', desc: '全部', type: 'flag' },
              { name: '--keep-storage', desc: '保留大小', requiresValue: true, valueHint: '<bytes>' },
            ],
            examples: [{ cmd: 'docker buildx prune -af', desc: '危险：删除全部构建缓存（慎用）' }],
          },
          {
            cmd: 'du',
            desc: '构建缓存磁盘占用',
            params: [{ name: '-v', desc: '详细', type: 'flag' }],
            examples: [{ cmd: 'docker buildx du', desc: '磁盘占用' }],
          },
        ],
      },

      // ============ Scan 安全扫描 ============
      {
        cmd: 'scan',
        desc: '镜像安全扫描（旧版）',
        params: [
          { name: '--file', desc: 'Dockerfile', requiresValue: true, valueHint: '<file>' },
          { name: '--severity', desc: '严重级别', requiresValue: true, valueHint: 'high|medium|low' },
          { name: '--json', desc: 'JSON 输出', type: 'flag' },
          { name: '--exclude-base', desc: '排除基础镜像', type: 'flag' },
        ],
        positional: [{ name: '<image>', desc: '镜像', type: 'value' }],
        examples: [{ cmd: 'docker scan myapp:1.0', desc: '扫描镜像' }],
      },
      {
        cmd: 'scout',
        desc: '镜像安全评估（Docker Scout）',
        params: [
          { name: '--env', desc: '环境', requiresValue: true, valueHint: '<env>' },
          { name: '--format', desc: '格式', requiresValue: true, valueHint: '<fmt>' },
          { name: '--only-fixed', desc: '仅可修复', type: 'flag' },
          { name: '--only-vuln', desc: '仅漏洞', requiresValue: true, valueHint: '<kind>' },
        ],
        subcommands: [
          { cmd: 'compare', desc: '对比镜像', positional: [{ name: '<image>', desc: '镜像', type: 'value' }] },
          { cmd: 'cves', desc: '查看 CVE', positional: [{ name: '<image>', desc: '镜像', type: 'value' }] },
          { cmd: 'recommendations', desc: '修复建议', positional: [{ name: '<image>', desc: '镜像', type: 'value' }] },
          { cmd: 'version', desc: '版本' },
        ],
        examples: [{ cmd: 'docker scout cves myapp:1.0', desc: '查看 CVE' }],
      },

      // ============ Context 上下文 ============
      {
        cmd: 'context',
        desc: '上下文管理（多 daemon 切换）',
        subcommands: [
          {
            cmd: 'create',
            desc: '创建上下文',
            params: [
              { name: '--docker', desc: 'Docker 端点', requiresValue: true, valueHint: '<endpoint>' },
              { name: '--description', desc: '描述', requiresValue: true, valueHint: '<text>' },
              { name: '--from', desc: '从已有上下文', requiresValue: true, valueHint: '<name>' },
            ],
            positional: [{ name: '<name>', desc: '上下文名', type: 'value' }],
            examples: [
              { cmd: 'docker context create remote --docker "host=ssh://user@host"', desc: 'SSH 远程' },
              { cmd: 'docker context create prod --docker "host=tcp://prod:2376"', desc: 'TCP 远程' },
            ],
          },
          {
            cmd: 'ls',
            desc: '上下文列表',
            params: [{ name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' }],
            examples: [{ cmd: 'docker context ls', desc: '上下文列表' }],
          },
          {
            cmd: 'rm',
            desc: '删除上下文',
            params: [{ name: '-f', desc: '强制', type: 'flag' }],
            positional: [{ name: '<name>', desc: '上下文名', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker context rm remote', desc: '删除' }],
          },
          {
            cmd: 'use',
            desc: '切换上下文',
            positional: [{ name: '<name>', desc: '上下文名', type: 'value' }],
            examples: [{ cmd: 'docker context use prod', desc: '切换到 prod' }],
          },
          {
            cmd: 'inspect',
            desc: '上下文详情',
            positional: [{ name: '<name>', desc: '上下文名', type: 'value' }],
            examples: [{ cmd: 'docker context inspect prod', desc: '详情' }],
          },
          {
            cmd: 'show',
            desc: '当前上下文名',
            examples: [{ cmd: 'docker context show', desc: '当前上下文' }],
          },
          {
            cmd: 'export',
            desc: '导出上下文',
            params: [{ name: '--kubeconfig', desc: 'kubeconfig', type: 'flag' }],
            positional: [
              { name: '<name>', desc: '上下文名', type: 'value' },
              { name: '<file>', desc: '输出文件', type: 'path' },
            ],
            examples: [{ cmd: 'docker context export prod prod.ctx', desc: '导出' }],
          },
          {
            cmd: 'import',
            desc: '导入上下文',
            positional: [{ name: '<file>', desc: '上下文文件', type: 'path' }],
            examples: [{ cmd: 'docker context import prod.ctx', desc: '导入' }],
          },
        ],
      },

      // ============ Builder 构建后端 ============
      {
        cmd: 'builder',
        desc: '构建器管理',
        subcommands: [
          {
            cmd: 'build',
            desc: '构建镜像（同 docker build）',
            params: [
              { name: '-t', desc: '标签', requiresValue: true, valueHint: '<name>:<tag>' },
              { name: '--no-cache', desc: '不用缓存', type: 'flag' },
              { name: '--build-arg', desc: '构建参数', requiresValue: true, valueHint: '<k>=<v>' },
            ],
            positional: [{ name: '<path>', desc: '构建上下文', type: 'path' }],
            examples: [{ cmd: 'docker builder build -t myapp:1.0 .', desc: '构建' }],
          },
          {
            cmd: 'prune',
            desc: '清理构建缓存',
            params: [
              { name: '-f', desc: '强制', type: 'flag' },
              { name: '-a', desc: '全部', type: 'flag' },
              { name: '--filter', desc: '过滤', requiresValue: true, valueHint: '<f=k>' },
              { name: '--keep-storage', desc: '保留大小', requiresValue: true, valueHint: '<bytes>' },
            ],
            examples: [{ cmd: 'docker builder prune -af', desc: '清理缓存' }],
          },
          {
            cmd: 'ls',
            desc: '构建器列表',
            examples: [{ cmd: 'docker builder ls', desc: '构建器列表' }],
          },
          {
            cmd: 'use',
            desc: '切换构建器',
            positional: [{ name: '<name>', desc: '构建器名', type: 'value' }],
            examples: [{ cmd: 'docker builder use default', desc: '切换' }],
          },
        ],
      },

      // ============ Compose（docker compose v2） ============
      {
        cmd: 'compose',
        desc: '应用编排（Compose v2）',
        params: [
          { name: '-f', desc: 'compose 文件', requiresValue: true, valueHint: '<file>', repeatable: true },
          { name: '-p', desc: '项目名', requiresValue: true, valueHint: '<name>' },
          { name: '--profile', desc: '启用 profile', requiresValue: true, valueHint: '<name>' },
          { name: '--env-file', desc: '环境变量文件', requiresValue: true, valueHint: '<file>' },
          { name: '--ansi', desc: 'ANSI 控制', requiresValue: true, valueHint: 'always|never|auto' },
        ],
        subcommands: [
          {
            cmd: 'up',
            desc: '启动编排',
            params: [
              { name: '-d', desc: '后台', type: 'flag' },
              { name: '--build', desc: '构建镜像', type: 'flag' },
              { name: '--force-recreate', desc: '强制重建', type: 'flag' },
              { name: '--remove-orphans', desc: '清理孤儿', type: 'flag' },
              { name: '--no-deps', desc: '不启动依赖', type: 'flag' },
              { name: '--scale', desc: '扩缩容', requiresValue: true, valueHint: '<service>=<n>' },
              { name: '--no-build', desc: '不构建', type: 'flag' },
              { name: '--abort-on-container-exit', desc: '容器退出即停止', type: 'flag' },
            ],
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [
              { cmd: 'docker compose up -d', desc: '后台启动' },
              { cmd: 'docker compose up --build web', desc: '重建并启动' },
            ],
          },
          {
            cmd: 'down',
            desc: '停止并删除',
            params: [
              { name: '-v', desc: '删卷', type: 'flag' },
              { name: '--rmi', desc: '删镜像', requiresValue: true, valueHint: 'all|local' },
              { name: '--remove-orphans', desc: '清理孤儿', type: 'flag' },
              { name: '-t', desc: '超时', requiresValue: true, valueHint: '<n>' },
            ],
            examples: [
              { cmd: 'docker compose down', desc: '停止删除' },
              { cmd: 'docker compose down -v', desc: '同时删卷' },
            ],
          },
          {
            cmd: 'start',
            desc: '启动已停止的服务',
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose start web', desc: '启动 web' }],
          },
          {
            cmd: 'stop',
            desc: '停止服务',
            params: [{ name: '-t', desc: '超时', requiresValue: true, valueHint: '<n>' }],
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose stop', desc: '停止' }],
          },
          {
            cmd: 'restart',
            desc: '重启服务',
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose restart web', desc: '重启' }],
          },
          {
            cmd: 'build',
            desc: '构建服务镜像',
            params: [
              { name: '--no-cache', desc: '不用缓存', type: 'flag' },
              { name: '--pull', desc: '拉取最新', type: 'flag' },
              { name: '--parallel', desc: '并行构建', type: 'flag' },
            ],
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose build', desc: '构建全部' }],
          },
          {
            cmd: 'pull',
            desc: '拉取服务镜像',
            params: [
              { name: '--ignore-pull-failures', desc: '忽略失败', type: 'flag' },
              { name: '--include-deps', desc: '含依赖', type: 'flag' },
            ],
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose pull', desc: '拉取' }],
          },
          {
            cmd: 'push',
            desc: '推送服务镜像',
            params: [{ name: '--ignore-push-failures', desc: '忽略失败', type: 'flag' }],
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose push', desc: '推送' }],
          },
          {
            cmd: 'logs',
            desc: '查看日志',
            params: [
              { name: '-f', desc: '追踪', type: 'flag' },
              { name: '--tail', desc: '尾部', requiresValue: true, valueHint: '<n>' },
              { name: '-t', desc: '时间戳', type: 'flag' },
              { name: '--no-color', desc: '无颜色', type: 'flag' },
            ],
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose logs -f web', desc: '追踪 web 日志' }],
          },
          {
            cmd: 'ps',
            desc: '容器列表',
            params: [
              { name: '-q', desc: '只显示 ID', type: 'flag' },
              { name: '--services', desc: '显示服务', type: 'flag' },
              { name: '-a', desc: '全部', type: 'flag' },
              { name: '--format', desc: '格式', requiresValue: true, valueHint: '<tpl>' },
            ],
            examples: [{ cmd: 'docker compose ps', desc: '列表' }],
          },
          {
            cmd: 'exec',
            desc: '执行命令',
            params: [
              { name: '-it', desc: '交互', type: 'flag' },
              { name: '-d', desc: '后台', type: 'flag' },
              { name: '-u', desc: '用户', requiresValue: true, valueHint: '<user>' },
            ],
            positional: [
              { name: '<service>', desc: '服务', type: 'value' },
              { name: '<cmd>', desc: '命令', type: 'vararg' },
            ],
            examples: [{ cmd: 'docker compose exec web bash', desc: '进入 web' }],
          },
          {
            cmd: 'run',
            desc: '运行一次性容器',
            params: [
              { name: '-d', desc: '后台', type: 'flag' },
              { name: '--rm', desc: '退出后删除', type: 'flag' },
              { name: '--no-deps', desc: '不启动依赖', type: 'flag' },
              { name: '-e', desc: '环境变量', requiresValue: true, valueHint: '<k>=<v>' },
              { name: '-p', desc: '端口', requiresValue: true, valueHint: '<h>:<c>' },
            ],
            positional: [
              { name: '<service>', desc: '服务', type: 'value' },
              { name: '<cmd>', desc: '命令', type: 'vararg' },
            ],
            examples: [{ cmd: 'docker compose run --rm web python manage.py migrate', desc: '运行迁移' }],
          },
          {
            cmd: 'scale',
            desc: '扩缩容服务',
            positional: [{ name: '<service>=<n>', desc: '服务=数量', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose scale web=3 db=1', desc: '扩缩' }],
          },
          {
            cmd: 'top',
            desc: '查看服务进程',
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose top', desc: '所有进程' }],
          },
          {
            cmd: 'events',
            desc: '实时事件',
            params: [{ name: '--json', desc: 'JSON 输出', type: 'flag' }],
            examples: [{ cmd: 'docker compose events', desc: '事件流' }],
          },
          {
            cmd: 'config',
            desc: '查看合并配置',
            params: [
              { name: '--services', desc: '服务列表', type: 'flag' },
              { name: '--volumes', desc: '卷列表', type: 'flag' },
              { name: '--quiet', desc: '仅校验', type: 'flag' },
              { name: '--output', desc: '输出格式', requiresValue: true, valueHint: 'yaml|json' },
            ],
            examples: [
              { cmd: 'docker compose config', desc: '合并配置' },
              { cmd: 'docker compose config -q', desc: '校验' },
            ],
          },
          {
            cmd: 'images',
            desc: '服务镜像列表',
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose images', desc: '镜像列表' }],
          },
          {
            cmd: 'port',
            desc: '查看端口映射',
            params: [
              { name: '--protocol', desc: '协议', requiresValue: true, valueHint: 'tcp|udp' },
              { name: '--index', desc: '索引', requiresValue: true, valueHint: '<n>' },
            ],
            positional: [
              { name: '<service>', desc: '服务', type: 'value' },
              { name: '<port>', desc: '端口', type: 'value' },
            ],
            examples: [{ cmd: 'docker compose port web 80', desc: '查看端口' }],
          },
          {
            cmd: 'pause',
            desc: '暂停服务',
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose pause', desc: '暂停' }],
          },
          {
            cmd: 'unpause',
            desc: '恢复服务',
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose unpause', desc: '恢复' }],
          },
          {
            cmd: 'rm',
            desc: '删除已停止容器',
            params: [
              { name: '-f', desc: '强制', type: 'flag' },
              { name: '-v', desc: '删卷', type: 'flag' },
              { name: '-s', desc: '先停止', type: 'flag' },
            ],
            positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
            examples: [{ cmd: 'docker compose rm -f', desc: '删除' }],
          },
          {
            cmd: 'version',
            desc: '查看 compose 版本',
            examples: [{ cmd: 'docker compose version', desc: '版本' }],
          },
        ],
      },
    ],
  },

  // ============ docker-compose（独立 v1 命令） ============
  {
    cmd: 'docker-compose',
    desc: 'Docker 编排（Compose v1 独立命令）',
    category: 'docker',
    platforms: ['universal'],
    usage: 'docker-compose [OPTIONS] COMMAND',
    params: [
      { name: '-f', desc: 'compose 文件', requiresValue: true, valueHint: '<file>', repeatable: true },
      { name: '-p', desc: '项目名', requiresValue: true, valueHint: '<name>' },
      { name: '--profile', desc: '启用 profile', requiresValue: true, valueHint: '<name>' },
      { name: '--env-file', desc: '环境变量文件', requiresValue: true, valueHint: '<file>' },
      { name: '--verbose', desc: '详细输出', type: 'flag' },
      { name: '--no-ansi', desc: '无 ANSI', type: 'flag' },
    ],
    subcommands: [
      {
        cmd: 'up',
        desc: '启动编排',
        params: [
          { name: '-d', desc: '后台', type: 'flag' },
          { name: '--build', desc: '构建', type: 'flag' },
          { name: '--force-recreate', desc: '强制重建', type: 'flag' },
          { name: '--remove-orphans', desc: '清理孤儿', type: 'flag' },
          { name: '--no-deps', desc: '不启动依赖', type: 'flag' },
          { name: '--scale', desc: '扩缩容', requiresValue: true, valueHint: '<service>=<n>' },
          { name: '--abort-on-container-exit', desc: '退出即停', type: 'flag' },
        ],
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [
          { cmd: 'docker-compose up -d', desc: '后台启动' },
          { cmd: 'docker-compose up --build web', desc: '构建并启动' },
        ],
      },
      {
        cmd: 'down',
        desc: '停止并删除',
        params: [
          { name: '-v', desc: '删卷', type: 'flag' },
          { name: '--rmi', desc: '删镜像', requiresValue: true, valueHint: 'all|local' },
          { name: '--remove-orphans', desc: '清理孤儿', type: 'flag' },
        ],
        examples: [
          { cmd: 'docker-compose down', desc: '停止删除' },
          { cmd: 'docker-compose down -v', desc: '含卷删除' },
        ],
      },
      {
        cmd: 'start',
        desc: '启动已停止服务',
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose start', desc: '启动' }],
      },
      {
        cmd: 'stop',
        desc: '停止服务',
        params: [{ name: '-t', desc: '超时', requiresValue: true, valueHint: '<n>' }],
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose stop', desc: '停止' }],
      },
      {
        cmd: 'restart',
        desc: '重启服务',
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose restart', desc: '重启' }],
      },
      {
        cmd: 'build',
        desc: '构建镜像',
        params: [
          { name: '--no-cache', desc: '不用缓存', type: 'flag' },
          { name: '--pull', desc: '拉取最新', type: 'flag' },
          { name: '--parallel', desc: '并行', type: 'flag' },
        ],
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose build', desc: '构建' }],
      },
      {
        cmd: 'pull',
        desc: '拉取镜像',
        params: [{ name: '--ignore-pull-failures', desc: '忽略失败', type: 'flag' }],
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose pull', desc: '拉取' }],
      },
      {
        cmd: 'push',
        desc: '推送镜像',
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose push', desc: '推送' }],
      },
      {
        cmd: 'logs',
        desc: '查看日志',
        params: [
          { name: '-f', desc: '追踪', type: 'flag' },
          { name: '--tail', desc: '尾部', requiresValue: true, valueHint: '<n>' },
          { name: '-t', desc: '时间戳', type: 'flag' },
        ],
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose logs -f web', desc: '追踪日志' }],
      },
      {
        cmd: 'ps',
        desc: '容器列表',
        params: [{ name: '-q', desc: '只显示 ID', type: 'flag' }],
        examples: [{ cmd: 'docker-compose ps', desc: '列表' }],
      },
      {
        cmd: 'exec',
        desc: '执行命令',
        params: [
          { name: '-it', desc: '交互', type: 'flag' },
          { name: '-d', desc: '后台', type: 'flag' },
          { name: '-u', desc: '用户', requiresValue: true, valueHint: '<user>' },
        ],
        positional: [
          { name: '<service>', desc: '服务', type: 'value' },
          { name: '<cmd>', desc: '命令', type: 'vararg' },
        ],
        examples: [{ cmd: 'docker-compose exec web bash', desc: '进入 web' }],
      },
      {
        cmd: 'run',
        desc: '运行一次性容器',
        params: [
          { name: '-d', desc: '后台', type: 'flag' },
          { name: '--rm', desc: '退出后删除', type: 'flag' },
          { name: '--no-deps', desc: '不启动依赖', type: 'flag' },
          { name: '-e', desc: '环境变量', requiresValue: true, valueHint: '<k>=<v>' },
        ],
        positional: [
          { name: '<service>', desc: '服务', type: 'value' },
          { name: '<cmd>', desc: '命令', type: 'vararg' },
        ],
        examples: [{ cmd: 'docker-compose run --rm web python manage.py migrate', desc: '运行' }],
      },
      {
        cmd: 'scale',
        desc: '扩缩容',
        positional: [{ name: '<service>=<n>', desc: '服务=数量', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose scale web=3', desc: '扩容' }],
      },
      {
        cmd: 'top',
        desc: '查看进程',
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose top', desc: '进程' }],
      },
      {
        cmd: 'events',
        desc: '事件流',
        params: [{ name: '--json', desc: 'JSON', type: 'flag' }],
        examples: [{ cmd: 'docker-compose events', desc: '事件' }],
      },
      {
        cmd: 'config',
        desc: '查看合并配置',
        params: [
          { name: '--services', desc: '服务列表', type: 'flag' },
          { name: '--volumes', desc: '卷列表', type: 'flag' },
          { name: '-q', desc: '仅校验', type: 'flag' },
        ],
        examples: [{ cmd: 'docker-compose config', desc: '配置' }],
      },
      {
        cmd: 'images',
        desc: '镜像列表',
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose images', desc: '镜像' }],
      },
      {
        cmd: 'port',
        desc: '查看端口',
        params: [{ name: '--protocol', desc: '协议', requiresValue: true, valueHint: 'tcp|udp' }],
        positional: [
          { name: '<service>', desc: '服务', type: 'value' },
          { name: '<port>', desc: '端口', type: 'value' },
        ],
        examples: [{ cmd: 'docker-compose port web 80', desc: '端口' }],
      },
      {
        cmd: 'pause',
        desc: '暂停服务',
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose pause', desc: '暂停' }],
      },
      {
        cmd: 'unpause',
        desc: '恢复服务',
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose unpause', desc: '恢复' }],
      },
      {
        cmd: 'rm',
        desc: '删除已停止容器',
        params: [
          { name: '-f', desc: '强制', type: 'flag' },
          { name: '-v', desc: '删卷', type: 'flag' },
        ],
        positional: [{ name: '<service>', desc: '服务', type: 'value', repeatable: true }],
        examples: [{ cmd: 'docker-compose rm -f', desc: '删除' }],
      },
      {
        cmd: 'version',
        desc: '查看版本',
        examples: [{ cmd: 'docker-compose version', desc: '版本' }],
      },
    ],
  },
]
