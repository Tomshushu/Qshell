import type { CommandSpec } from '@/lib/command-intelligence/types'

// 云平台 CLI（AWS / Azure / GCP / 阿里云 / 腾讯云 / 华为云）
// 多数云 CLI 采用 "主命令 + 子命令 + 子子命令" 三级结构，subcommands 已完整建模
export const cloudCommands: CommandSpec[] = [
  // ============ AWS CLI ============
  {
    cmd: 'aws',
    desc: 'AWS 命令行接口',
    category: 'cloud',
    platforms: ['universal'],
    params: [
      { name: '--profile', desc: '指定凭证配置', requiresValue: true, valueHint: '<name>' },
      { name: '--region', desc: '指定区域', requiresValue: true, valueHint: '<region>' },
      { name: '--output', desc: '输出格式', requiresValue: true, valueHint: 'json|text|table' },
      { name: '--no-paginate', desc: '禁用分页', type: 'flag' },
      { name: '--debug', desc: '调试模式', type: 'flag' },
    ],
    subcommands: [
      // EC2
      { cmd: 'ec2', desc: 'EC2 计算', subcommands: [
        { cmd: 'describe-instances', desc: '列出实例', params: [
          { name: '--filters', desc: '过滤条件', requiresValue: true, repeatable: true },
          { name: '--query', desc: 'JMESPath 查询', requiresValue: true },
        ] },
        { cmd: 'start-instances', desc: '启动实例', params: [{ name: '--instance-ids', desc: '实例ID', requiresValue: true, repeatable: true }] },
        { cmd: 'stop-instances', desc: '停止实例', params: [{ name: '--instance-ids', desc: '实例ID', requiresValue: true, repeatable: true }] },
        { cmd: 'reboot-instances', desc: '重启实例', params: [{ name: '--instance-ids', desc: '实例ID', requiresValue: true, repeatable: true }] },
        { cmd: 'terminate-instances', desc: '终止实例', params: [{ name: '--instance-ids', desc: '实例ID', requiresValue: true, repeatable: true }] },
        { cmd: 'create-tags', desc: '创建标签', params: [{ name: '--resources', desc: '资源ID', requiresValue: true, repeatable: true }, { name: '--tags', desc: '标签', requiresValue: true, repeatable: true }] },
        { cmd: 'describe-vpcs', desc: '列出 VPC', params: [] },
        { cmd: 'describe-subnets', desc: '列出子网', params: [] },
        { cmd: 'describe-security-groups', desc: '列出安全组', params: [] },
        { cmd: 'run-instances', desc: '创建实例', params: [
          { name: '--image-id', desc: 'AMI ID', requiresValue: true },
          { name: '--instance-type', desc: '实例类型', requiresValue: true, valueHint: 't3.micro' },
          { name: '--key-name', desc: '密钥名', requiresValue: true },
          { name: '--count', desc: '数量', requiresValue: true },
        ] },
      ] },
      // S3
      { cmd: 's3', desc: 'S3 对象存储', subcommands: [
        { cmd: 'ls', desc: '列出桶/对象', params: [{ name: '--recursive', desc: '递归', type: 'flag' }, { name: '--human-readable', desc: '易读大小', type: 'flag' }] },
        { cmd: 'cp', desc: '复制对象', positional: [{ name: '<source>', desc: '源' }, { name: '<dest>', desc: '目标' }], params: [{ name: '--recursive', desc: '递归', type: 'flag' }, { name: '--exclude', desc: '排除', requiresValue: true }, { name: '--include', desc: '包含', requiresValue: true }] },
        { cmd: 'mv', desc: '移动对象', positional: [{ name: '<source>', desc: '源' }, { name: '<dest>', desc: '目标' }] },
        { cmd: 'rm', desc: '删除对象', positional: [{ name: '<path>', desc: '路径' }], params: [{ name: '--recursive', desc: '递归', type: 'flag' }, { name: '--force', desc: '不确认', type: 'flag' }] },
        { cmd: 'sync', desc: '同步目录', positional: [{ name: '<source>', desc: '源' }, { name: '<dest>', desc: '目标' }], params: [{ name: '--delete', desc: '删除目标多余文件', type: 'flag' }, { name: '--dryrun', desc: '试运行', type: 'flag' }] },
        { cmd: 'mb', desc: '创建桶', positional: [{ name: '<bucket>', desc: '桶名' }] },
        { cmd: 'rb', desc: '删除桶', positional: [{ name: '<bucket>', desc: '桶名' }], params: [{ name: '--force', desc: '非空也删', type: 'flag' }] },
        { cmd: 'presign', desc: '生成预签名URL', positional: [{ name: '<s3uri>', desc: 'S3 URI' }], params: [{ name: '--expires-in', desc: '有效期秒', requiresValue: true }] },
      ] },
      // RDS
      { cmd: 'rds', desc: 'RDS 数据库', subcommands: [
        { cmd: 'describe-db-instances', desc: '列出实例', params: [] },
        { cmd: 'create-db-instance', desc: '创建实例', params: [{ name: '--db-instance-identifier', desc: '实例名', requiresValue: true }, { name: '--db-instance-class', desc: '规格', requiresValue: true }, { name: '--engine', desc: '引擎', requiresValue: true, valueHint: 'mysql|postgres' }] },
        { cmd: 'delete-db-instance', desc: '删除实例', positional: [{ name: '<id>', desc: '实例名' }] },
        { cmd: 'modify-db-instance', desc: '修改实例', positional: [{ name: '<id>', desc: '实例名' }] },
      ] },
      // IAM
      { cmd: 'iam', desc: 'IAM 身份', subcommands: [
        { cmd: 'list-users', desc: '列出用户', params: [] },
        { cmd: 'create-user', desc: '创建用户', params: [{ name: '--user-name', desc: '用户名', requiresValue: true }] },
        { cmd: 'delete-user', desc: '删除用户', positional: [{ name: '<name>', desc: '用户名' }] },
        { cmd: 'list-roles', desc: '列出角色', params: [] },
        { cmd: 'list-policies', desc: '列出策略', params: [] },
        { cmd: 'attach-user-policy', desc: '附加策略', params: [{ name: '--user-name', desc: '用户名', requiresValue: true }, { name: '--policy-arn', desc: '策略ARN', requiresValue: true }] },
      ] },
      // Lambda
      { cmd: 'lambda', desc: 'Lambda 函数', subcommands: [
        { cmd: 'list-functions', desc: '列出函数', params: [] },
        { cmd: 'invoke', desc: '调用函数', positional: [{ name: '<name>', desc: '函数名' }, { name: '<output>', desc: '输出文件' }], params: [{ name: '--payload', desc: '输入', requiresValue: true }] },
        { cmd: 'create-function', desc: '创建函数', params: [{ name: '--function-name', desc: '函数名', requiresValue: true }, { name: '--runtime', desc: '运行时', requiresValue: true, valueHint: 'python3.9|nodejs18' }, { name: '--handler', desc: '处理函数', requiresValue: true }, { name: '--zip-file', desc: '代码包', requiresValue: true }] },
        { cmd: 'delete-function', desc: '删除函数', positional: [{ name: '<name>', desc: '函数名' }] },
        { cmd: 'update-function-code', desc: '更新代码', positional: [{ name: '<name>', desc: '函数名' }], params: [{ name: '--zip-file', desc: '代码包', requiresValue: true }] },
      ] },
      // CloudFormation
      { cmd: 'cloudformation', desc: 'CloudFormation', subcommands: [
        { cmd: 'deploy', desc: '部署栈', positional: [{ name: '<template>', desc: '模板文件' }], params: [{ name: '--stack-name', desc: '栈名', requiresValue: true }, { name: '--parameter-overrides', desc: '参数', requiresValue: true, repeatable: true }, { name: '--capabilities', desc: '能力', requiresValue: true, repeatable: true }] },
        { cmd: 'delete-stack', desc: '删除栈', positional: [{ name: '<name>', desc: '栈名' }] },
        { cmd: 'describe-stacks', desc: '列出栈', params: [{ name: '--stack-name', desc: '栈名', requiresValue: true }] },
        { cmd: 'list-stacks', desc: '列出所有栈', params: [{ name: '--stack-status-filter', desc: '状态过滤', requiresValue: true, repeatable: true }] },
      ] },
      // ECR / ECS / EKS
      { cmd: 'ecr', desc: 'ECR 容器仓库', subcommands: [
        { cmd: 'login', desc: '登录', params: [] },
        { cmd: 'describe-repositories', desc: '列出仓库', params: [] },
        { cmd: 'create-repository', desc: '创建仓库', params: [{ name: '--repository-name', desc: '仓库名', requiresValue: true }] },
      ] },
      { cmd: 'ecs', desc: 'ECS 容器服务', subcommands: [
        { cmd: 'list-clusters', desc: '列出集群', params: [] },
        { cmd: 'list-tasks', desc: '列出任务', params: [{ name: '--cluster', desc: '集群', requiresValue: true }] },
        { cmd: 'describe-tasks', desc: '任务详情', params: [{ name: '--tasks', desc: '任务ID', requiresValue: true, repeatable: true }] },
      ] },
      { cmd: 'eks', desc: 'EKS Kubernetes', subcommands: [
        { cmd: 'list-clusters', desc: '列出集群', params: [] },
        { cmd: 'describe-cluster', desc: '集群详情', positional: [{ name: '<name>', desc: '集群名' }] },
        { cmd: 'update-kubeconfig', desc: '更新 kubeconfig', positional: [{ name: '<name>', desc: '集群名' }], params: [{ name: '--region', desc: '区域', requiresValue: true }] },
      ] },
      // CloudWatch
      { cmd: 'logs', desc: 'CloudWatch 日志', subcommands: [
        { cmd: 'describe-log-groups', desc: '列出日志组', params: [] },
        { cmd: 'tail', desc: '实时跟踪', positional: [{ name: '<group>', desc: '日志组' }], params: [{ name: '--follow', desc: '持续', type: 'flag' }, { name: '--since', desc: '起始时间', requiresValue: true }] },
        { cmd: 'get-log-events', desc: '获取事件', params: [{ name: '--log-group-name', desc: '日志组', requiresValue: true }, { name: '--log-stream-name', desc: '流', requiresValue: true }] },
      ] },
      // STS
      { cmd: 'sts', desc: 'STS 临时凭证', subcommands: [
        { cmd: 'get-caller-identity', desc: '当前身份', params: [] },
        { cmd: 'assume-role', desc: '扮演角色', params: [{ name: '--role-arn', desc: '角色ARN', requiresValue: true }, { name: '--role-session-name', desc: '会话名', requiresValue: true }] },
      ] },
      // configure
      { cmd: 'configure', desc: '配置', subcommands: [
        { cmd: 'list', desc: '列出配置', params: [] },
        { cmd: 'set', desc: '设置', positional: [{ name: '<key>', desc: '键' }, { name: '<value>', desc: '值' }] },
      ] },
    ],
    examples: [
      { cmd: 'aws s3 ls', desc: '列出所有 S3 桶' },
      { cmd: 'aws ec2 describe-instances --region us-east-1', desc: '查询指定区域的 EC2 实例' },
      { cmd: 'aws s3 sync ./local s3://mybucket/', desc: '同步本地目录到 S3' },
      { cmd: 'aws sts get-caller-identity', desc: '查看当前身份' },
    ],
  },

  // ============ Azure CLI ============
  {
    cmd: 'az',
    desc: 'Azure 命令行接口',
    category: 'cloud',
    platforms: ['universal'],
    params: [
      { name: '--output', desc: '输出格式', requiresValue: true, valueHint: 'json|table|tsv' },
      { name: '--query', desc: 'JMESPath 查询', requiresValue: true },
      { name: '--subscription', desc: '订阅', requiresValue: true },
      { name: '--verbose', desc: '详细日志', type: 'flag' },
      { name: '--debug', desc: '调试日志', type: 'flag' },
    ],
    subcommands: [
      { cmd: 'login', desc: '登录', params: [{ name: '--service-principal', desc: '服务主体', type: 'flag' }, { name: '--tenant', desc: '租户', requiresValue: true }] },
      { cmd: 'logout', desc: '登出', params: [] },
      { cmd: 'account', desc: '订阅管理', subcommands: [
        { cmd: 'list', desc: '列出订阅', params: [] },
        { cmd: 'set', desc: '切换订阅', positional: [{ name: '<subscription>', desc: '订阅ID' }] },
        { cmd: 'show', desc: '当前订阅', params: [] },
      ] },
      { cmd: 'group', desc: '资源组', subcommands: [
        { cmd: 'create', desc: '创建', params: [{ name: '--name', desc: '名称', requiresValue: true }, { name: '--location', desc: '区域', requiresValue: true }] },
        { cmd: 'delete', desc: '删除', positional: [{ name: '<name>', desc: '名称' }], params: [{ name: '--yes', desc: '不确认', type: 'flag' }] },
        { cmd: 'list', desc: '列出', params: [] },
      ] },
      { cmd: 'vm', desc: '虚拟机', subcommands: [
        { cmd: 'create', desc: '创建', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }, { name: '--image', desc: '镜像', requiresValue: true }, { name: '--admin-username', desc: '用户名', requiresValue: true }, { name: '--generate-ssh-keys', desc: '生成SSH密钥', type: 'flag' }] },
        { cmd: 'list', desc: '列出', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }] },
        { cmd: 'start', desc: '启动', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }] },
        { cmd: 'stop', desc: '停止', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }] },
        { cmd: 'restart', desc: '重启', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }] },
        { cmd: 'deallocate', desc: '释放', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }] },
        { cmd: 'open-port', desc: '开放端口', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }, { name: '--port', desc: '端口', requiresValue: true }] },
      ] },
      { cmd: 'storage', desc: '存储', subcommands: [
        { cmd: 'account', desc: '存储账户', subcommands: [
          { cmd: 'create', desc: '创建', params: [{ name: '--name', desc: '名称', requiresValue: true }, { name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--sku', desc: 'SKU', requiresValue: true, valueHint: 'Standard_LRS' }] },
          { cmd: 'list', desc: '列出', params: [] },
          { cmd: 'show-connection-string', desc: '连接串', params: [{ name: '--name', desc: '名称', requiresValue: true }, { name: '--resource-group', desc: '资源组', requiresValue: true }] },
        ] },
        { cmd: 'blob', desc: 'Blob', subcommands: [
          { cmd: 'upload', desc: '上传', params: [{ name: '--account-name', desc: '账户', requiresValue: true }, { name: '--container-name', desc: '容器', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }, { name: '--file', desc: '文件', requiresValue: true }] },
          { cmd: 'download', desc: '下载', params: [{ name: '--account-name', desc: '账户', requiresValue: true }, { name: '--container-name', desc: '容器', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }, { name: '--file', desc: '文件', requiresValue: true }] },
          { cmd: 'list', desc: '列出', params: [{ name: '--account-name', desc: '账户', requiresValue: true }, { name: '--container-name', desc: '容器', requiresValue: true }] },
        ] },
      ] },
      { cmd: 'aks', desc: 'AKS Kubernetes', subcommands: [
        { cmd: 'create', desc: '创建集群', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }, { name: '--node-count', desc: '节点数', requiresValue: true }, { name: '--generate-ssh-keys', desc: '生成SSH', type: 'flag' }] },
        { cmd: 'list', desc: '列出集群', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }] },
        { cmd: 'get-credentials', desc: '获取凭证', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }] },
        { cmd: 'delete', desc: '删除集群', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }, { name: '--yes', desc: '不确认', type: 'flag' }] },
      ] },
      { cmd: 'webapp', desc: 'Web App', subcommands: [
        { cmd: 'create', desc: '创建', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }, { name: '--plan', desc: '应用服务计划', requiresValue: true }] },
        { cmd: 'list', desc: '列出', params: [] },
        { cmd: 'up', desc: '快速部署', positional: [{ name: '<path>', desc: '代码目录' }] },
      ] },
      { cmd: 'acr', desc: '容器仓库', subcommands: [
        { cmd: 'create', desc: '创建', params: [{ name: '--resource-group', desc: '资源组', requiresValue: true }, { name: '--name', desc: '名称', requiresValue: true }, { name: '--sku', desc: 'SKU', requiresValue: true, valueHint: 'Basic|Standard|Premium' }] },
        { cmd: 'list', desc: '列出', params: [] },
        { cmd: 'build', desc: '构建镜像', positional: [{ name: '<registry>', desc: '仓库名' }, { name: '<path>', desc: '代码目录' }] },
      ] },
    ],
    examples: [
      { cmd: 'az login', desc: '登录 Azure' },
      { cmd: 'az vm create -g MyGroup -n MyVM --image UbuntuLTS', desc: '创建 Ubuntu 虚拟机' },
      { cmd: 'az aks get-credentials -g MyGroup -n MyAKS', desc: '获取 AKS 凭证' },
      { cmd: 'az group list --output table', desc: '以表格列出资源组' },
    ],
  },

  // ============ GCP gcloud ============
  {
    cmd: 'gcloud',
    desc: 'Google Cloud CLI',
    category: 'cloud',
    platforms: ['universal'],
    params: [
      { name: '--project', desc: '项目ID', requiresValue: true },
      { name: '--account', desc: '账号', requiresValue: true },
      { name: '--configuration', desc: '配置', requiresValue: true },
      { name: '--format', desc: '输出格式', requiresValue: true, valueHint: 'json|table|yaml' },
      { name: '--quiet', desc: '不提示', type: 'flag', short: '-q' },
    ],
    subcommands: [
      { cmd: 'auth', desc: '认证', subcommands: [
        { cmd: 'login', desc: '登录', params: [] },
        { cmd: 'logout', desc: '登出', params: [] },
        { cmd: 'list', desc: '列出账号', params: [] },
        { cmd: 'application-default', desc: '应用默认凭证', subcommands: [
          { cmd: 'login', desc: '获取凭证', params: [] },
          { cmd: 'print-access-token', desc: '打印 token', params: [] },
        ] },
      ] },
      { cmd: 'config', desc: '配置', subcommands: [
        { cmd: 'list', desc: '列出配置', params: [] },
        { cmd: 'set', desc: '设置', positional: [{ name: '<key>', desc: '键' }, { name: '<value>', desc: '值' }] },
        { cmd: 'get-value', desc: '获取', positional: [{ name: '<key>', desc: '键' }] },
      ] },
      { cmd: 'projects', desc: '项目', subcommands: [
        { cmd: 'list', desc: '列出项目', params: [] },
        { cmd: 'describe', desc: '项目详情', positional: [{ name: '<id>', desc: '项目ID' }] },
        { cmd: 'create', desc: '创建项目', positional: [{ name: '<id>', desc: '项目ID' }], params: [{ name: '--name', desc: '名称', requiresValue: true }] },
      ] },
      { cmd: 'compute', desc: 'Compute Engine', subcommands: [
        { cmd: 'instances', desc: '实例', subcommands: [
          { cmd: 'list', desc: '列出', params: [] },
          { cmd: 'create', desc: '创建', params: [{ name: '--zone', desc: '区域', requiresValue: true }, { name: '--machine-type', desc: '机型', requiresValue: true, valueHint: 'e2-medium' }, { name: '--image-family', desc: '镜像族', requiresValue: true }] },
          { cmd: 'start', desc: '启动', positional: [{ name: '<name>', desc: '实例名' }], params: [{ name: '--zone', desc: '区域', requiresValue: true }] },
          { cmd: 'stop', desc: '停止', positional: [{ name: '<name>', desc: '实例名' }], params: [{ name: '--zone', desc: '区域', requiresValue: true }] },
          { cmd: 'delete', desc: '删除', positional: [{ name: '<name>', desc: '实例名' }], params: [{ name: '--zone', desc: '区域', requiresValue: true }] },
          { cmd: 'ssh', desc: 'SSH 连接', positional: [{ name: '<name>', desc: '实例名' }], params: [{ name: '--zone', desc: '区域', requiresValue: true }] },
        ] },
        { cmd: 'firewall-rules', desc: '防火墙', subcommands: [
          { cmd: 'list', desc: '列出', params: [] },
          { cmd: 'create', desc: '创建', params: [{ name: '--allow', desc: '协议:端口', requiresValue: true }, { name: '--network', desc: '网络', requiresValue: true }] },
          { cmd: 'delete', desc: '删除', positional: [{ name: '<name>', desc: '名称' }] },
        ] },
      ] },
      { cmd: 'container', desc: 'GKE Kubernetes', subcommands: [
        { cmd: 'clusters', desc: '集群', subcommands: [
          { cmd: 'list', desc: '列出', params: [] },
          { cmd: 'create', desc: '创建', positional: [{ name: '<name>', desc: '集群名' }], params: [{ name: '--zone', desc: '区域', requiresValue: true }, { name: '--num-nodes', desc: '节点数', requiresValue: true }] },
          { cmd: 'delete', desc: '删除', positional: [{ name: '<name>', desc: '集群名' }], params: [{ name: '--zone', desc: '区域', requiresValue: true }] },
          { cmd: 'get-credentials', desc: '获取凭证', positional: [{ name: '<name>', desc: '集群名' }], params: [{ name: '--zone', desc: '区域', requiresValue: true }] },
        ] },
      ] },
      { cmd: 'storage', desc: 'Cloud Storage', subcommands: [
        { cmd: 'ls', desc: '列出', positional: [{ name: '<uri>', desc: 'gs://...' }] },
        { cmd: 'cp', desc: '复制', positional: [{ name: '<src>', desc: '源' }, { name: '<dst>', desc: '目标' }], params: [{ name: '--recursive', desc: '递归', type: 'flag', short: '-r' }] },
        { cmd: 'rm', desc: '删除', positional: [{ name: '<uri>', desc: 'gs://...' }], params: [{ name: '--recursive', desc: '递归', type: 'flag', short: '-r' }] },
        { cmd: 'mb', desc: '创建桶', positional: [{ name: '<uri>', desc: 'gs://...' }] },
        { cmd: 'rb', desc: '删除桶', positional: [{ name: '<uri>', desc: 'gs://...' }] },
      ] },
      { cmd: 'sql', desc: 'Cloud SQL', subcommands: [
        { cmd: 'instances', desc: '实例', subcommands: [
          { cmd: 'list', desc: '列出', params: [] },
          { cmd: 'create', desc: '创建', positional: [{ name: '<name>', desc: '名称' }], params: [{ name: '--database-version', desc: '版本', requiresValue: true, valueHint: 'MYSQL_8_0' }, { name: '--tier', desc: '规格', requiresValue: true, valueHint: 'db-n1-standard-1' }] },
          { cmd: 'delete', desc: '删除', positional: [{ name: '<name>', desc: '名称' }] },
        ] },
      ] },
      { cmd: 'functions', desc: 'Cloud Functions', subcommands: [
        { cmd: 'list', desc: '列出', params: [] },
        { cmd: 'deploy', desc: '部署', positional: [{ name: '<name>', desc: '函数名' }], params: [{ name: '--source', desc: '代码目录', requiresValue: true }, { name: '--entry-point', desc: '入口函数', requiresValue: true }, { name: '--runtime', desc: '运行时', requiresValue: true, valueHint: 'nodejs18|python310' }, { name: '--trigger-http', desc: 'HTTP 触发', type: 'flag' }] },
        { cmd: 'delete', desc: '删除', positional: [{ name: '<name>', desc: '函数名' }] },
      ] },
      { cmd: 'app', desc: 'App Engine', subcommands: [
        { cmd: 'deploy', desc: '部署', positional: [{ name: '<path>', desc: 'app.yaml' }] },
        { cmd: 'logs', desc: '日志', subcommands: [{ cmd: 'tail', desc: '实时', params: [] }] },
        { cmd: 'instances', desc: '实例', subcommands: [{ cmd: 'list', desc: '列出', params: [] }] },
      ] },
    ],
    examples: [
      { cmd: 'gcloud auth login', desc: '登录 GCP' },
      { cmd: 'gcloud compute instances list', desc: '列出所有 Compute 实例' },
      { cmd: 'gcloud container clusters get-credentials my-cluster --zone us-central1-a', desc: '获取 GKE 凭证' },
      { cmd: 'gcloud storage cp ./file.txt gs://mybucket/', desc: '上传文件到 GCS' },
    ],
  },

  // ============ 阿里云 aliyun CLI ============
  {
    cmd: 'aliyun',
    desc: '阿里云 CLI',
    category: 'cloud',
    platforms: ['universal'],
    params: [
      { name: '--profile', desc: '凭证配置', requiresValue: true },
      { name: '--region', desc: '区域', requiresValue: true },
      { name: '--output', desc: '输出格式', requiresValue: true, valueHint: 'json|table|tsv' },
      { name: '--force', desc: '强制', type: 'flag' },
      { name: '--quiet', desc: '静默', type: 'flag' },
    ],
    subcommands: [
      { cmd: 'configure', desc: '配置', subcommands: [
        { cmd: 'set', desc: '设置', params: [{ name: '--profile', desc: '配置名', requiresValue: true }, { name: '--mode', desc: '模式', requiresValue: true, valueHint: 'AK|StsToken|RamRoleArn' }] },
        { cmd: 'list', desc: '列出', params: [] },
      ] },
      { cmd: 'ecs', desc: 'ECS 计算', subcommands: [
        { cmd: 'DescribeInstances', desc: '列出实例', params: [{ name: '--RegionId', desc: '区域', requiresValue: true }] },
        { cmd: 'StartInstance', desc: '启动实例', params: [{ name: '--InstanceId', desc: '实例ID', requiresValue: true }] },
        { cmd: 'StopInstance', desc: '停止实例', params: [{ name: '--InstanceId', desc: '实例ID', requiresValue: true }] },
        { cmd: 'RebootInstance', desc: '重启实例', params: [{ name: '--InstanceId', desc: '实例ID', requiresValue: true }] },
        { cmd: 'CreateInstance', desc: '创建实例', params: [{ name: '--RegionId', desc: '区域', requiresValue: true }, { name: '--InstanceType', desc: '规格', requiresValue: true, valueHint: 'ecs.t6-c1m1.large' }, { name: '--ImageId', desc: '镜像ID', requiresValue: true }] },
      ] },
      { cmd: 'rds', desc: 'RDS 数据库', subcommands: [
        { cmd: 'DescribeDBInstances', desc: '列出实例', params: [] },
        { cmd: 'CreateDBInstance', desc: '创建实例', params: [{ name: '--RegionId', desc: '区域', requiresValue: true }, { name: '--Engine', desc: '引擎', requiresValue: true, valueHint: 'mysql|postgres' }, { name: '--DBInstanceClass', desc: '规格', requiresValue: true }] },
      ] },
      { cmd: 'oss', desc: 'OSS 对象存储', subcommands: [
        { cmd: 'ls', desc: '列出', params: [{ name: '--recursive', desc: '递归', type: 'flag' }] },
        { cmd: 'cp', desc: '复制', positional: [{ name: '<src>', desc: '源' }, { name: '<dst>', desc: '目标' }] },
        { cmd: 'sync', desc: '同步', positional: [{ name: '<src>', desc: '源' }, { name: '<dst>', desc: '目标' }] },
        { cmd: 'mb', desc: '创建桶', positional: [{ name: '<bucket>', desc: '桶名' }] },
        { cmd: 'rb', desc: '删除桶', positional: [{ name: '<bucket>', desc: '桶名' }] },
      ] },
      { cmd: 'ack', desc: 'ACK Kubernetes', subcommands: [
        { cmd: 'DescribeClusters', desc: '列出集群', params: [] },
        { cmd: 'DescribeClusterUserKubeconfig', desc: '获取凭证', params: [{ name: '--ClusterId', desc: '集群ID', requiresValue: true }] },
      ] },
      { cmd: 'ram', desc: 'RAM 访问控制', subcommands: [
        { cmd: 'ListUsers', desc: '列出用户', params: [] },
        { cmd: 'CreateUser', desc: '创建用户', params: [{ name: '--UserName', desc: '用户名', requiresValue: true }] },
      ] },
    ],
    examples: [
      { cmd: 'aliyun configure set --profile default --mode AK', desc: '配置 AccessKey 模式' },
      { cmd: 'aliyun ecs DescribeInstances --region cn-hangzhou', desc: '列出杭州区域 ECS 实例' },
      { cmd: 'aliyun oss cp ./file.txt oss://mybucket/', desc: '上传文件到 OSS' },
    ],
  },

  // ============ 腾讯云 tccli ============
  {
    cmd: 'tccli',
    desc: '腾讯云 CLI',
    category: 'cloud',
    platforms: ['universal'],
    params: [
      { name: '--profile', desc: '凭证配置', requiresValue: true },
      { name: '--region', desc: '区域', requiresValue: true, valueHint: 'ap-guangzhou|ap-shanghai' },
      { name: '--output', desc: '输出格式', requiresValue: true, valueHint: 'json|table|text' },
      { name: '--cli-unfold-argument', desc: '展开参数', type: 'flag' },
    ],
    subcommands: [
      { cmd: 'configure', desc: '配置', subcommands: [
        { cmd: 'list', desc: '列出', params: [] },
        { cmd: 'set', desc: '设置', positional: [{ name: '<key>', desc: '键' }, { name: '<value>', desc: '值' }] },
      ] },
      { cmd: 'cvm', desc: 'CVM 计算', subcommands: [
        { cmd: 'DescribeInstances', desc: '列出实例', params: [{ name: '--Region', desc: '区域', requiresValue: true }] },
        { cmd: 'RunInstances', desc: '创建实例', params: [{ name: '--InstanceType', desc: '规格', requiresValue: true, valueHint: 'S5.MEDIUM4' }, { name: '--ImageId', desc: '镜像ID', requiresValue: true }] },
        { cmd: 'StartInstances', desc: '启动', params: [{ name: '--InstanceIds', desc: '实例ID列表', requiresValue: true }] },
        { cmd: 'StopInstances', desc: '停止', params: [{ name: '--InstanceIds', desc: '实例ID列表', requiresValue: true }] },
      ] },
      { cmd: 'cdb', desc: 'CDB 数据库', subcommands: [
        { cmd: 'DescribeDBInstances', desc: '列出实例', params: [] },
        { cmd: 'CreateDBInstance', desc: '创建实例', params: [{ name: '--EngineVersion', desc: '版本', requiresValue: true, valueHint: '5.7|8.0' }, { name: '--Memory', desc: '内存MB', requiresValue: true }, { name: '--Volume', desc: '磁盘GB', requiresValue: true }] },
      ] },
      { cmd: 'cos', desc: 'COS 对象存储', subcommands: [
        { cmd: 'ls', desc: '列出', params: [] },
        { cmd: 'cp', desc: '复制', positional: [{ name: '<src>', desc: '源' }, { name: '<dst>', desc: '目标' }] },
        { cmd: 'sync', desc: '同步', positional: [{ name: '<src>', desc: '源' }, { name: '<dst>', desc: '目标' }] },
      ] },
      { cmd: 'tke', desc: 'TKE Kubernetes', subcommands: [
        { cmd: 'DescribeClusters', desc: '列出集群', params: [] },
        { cmd: 'DescribeClusterKubeconfig', desc: '获取凭证', params: [{ name: '--ClusterId', desc: '集群ID', requiresValue: true }] },
      ] },
      { cmd: 'vpc', desc: 'VPC 网络', subcommands: [
        { cmd: 'DescribeVpcs', desc: '列出 VPC', params: [] },
        { cmd: 'DescribeSubnets', desc: '列出子网', params: [] },
      ] },
    ],
    examples: [
      { cmd: 'tccli configure list', desc: '列出当前配置' },
      { cmd: 'tccli cvm DescribeInstances --region ap-guangzhou', desc: '列出广州区域 CVM 实例' },
      { cmd: 'tccli cos cp ./file.txt cos://mybucket/', desc: '上传文件到 COS' },
    ],
  },

  // ============ 华为云 hcloud ============
  {
    cmd: 'hcloud',
    desc: '华为云 CLI',
    category: 'cloud',
    platforms: ['universal'],
    params: [
      { name: '--cli-region', desc: '区域', requiresValue: true, valueHint: 'cn-north-4|cn-east-3' },
      { name: '--cli-profile', desc: '凭证配置', requiresValue: true },
      { name: '--cli-output', desc: '输出格式', requiresValue: true, valueHint: 'json|table' },
    ],
    subcommands: [
      { cmd: 'configure', desc: '配置', subcommands: [
        { cmd: 'list', desc: '列出', params: [] },
        { cmd: 'set', desc: '设置', positional: [{ name: '<key>', desc: '键' }, { name: '<value>', desc: '值' }] },
      ] },
      { cmd: 'ECS', desc: '弹性云服务器', subcommands: [
        { cmd: 'NovaListServers', desc: '列出实例', params: [] },
        { cmd: 'NovaStartServer', desc: '启动', params: [{ name: '--server_id', desc: '实例ID', requiresValue: true }] },
        { cmd: 'NovaStopServer', desc: '停止', params: [{ name: '--server_id', desc: '实例ID', requiresValue: true }] },
      ] },
      { cmd: 'EVS', desc: '云硬盘', subcommands: [
        { cmd: 'ListVolumes', desc: '列出卷', params: [] },
        { cmd: 'CreateVolume', desc: '创建卷', params: [{ name: '--size', desc: 'GB', requiresValue: true }] },
      ] },
      { cmd: 'VPC', desc: '虚拟私有云', subcommands: [
        { cmd: 'ListVpcs', desc: '列出 VPC', params: [] },
        { cmd: 'ListSubnets', desc: '列出子网', params: [] },
      ] },
      { cmd: 'CCE', desc: 'CCE Kubernetes', subcommands: [
        { cmd: 'ListClusters', desc: '列出集群', params: [] },
        { cmd: 'ShowCluster', desc: '集群详情', params: [{ name: '--cluster_id', desc: '集群ID', requiresValue: true }] },
      ] },
      { cmd: 'RDS', desc: 'RDS 数据库', subcommands: [
        { cmd: 'ListInstances', desc: '列出实例', params: [] },
      ] },
      { cmd: 'OBS', desc: 'OBS 对象存储', subcommands: [
        { cmd: 'ls', desc: '列出', params: [] },
        { cmd: 'cp', desc: '复制', positional: [{ name: '<src>', desc: '源' }, { name: '<dst>', desc: '目标' }] },
      ] },
    ],
    examples: [
      { cmd: 'hcloud configure list', desc: '列出配置' },
      { cmd: 'hcloud ECS NovaListServers --cli-region cn-north-4', desc: '列出北京四区域 ECS' },
      { cmd: 'hcloud OBS cp ./file.txt obs://mybucket/', desc: '上传文件到 OBS' },
    ],
  },
]
