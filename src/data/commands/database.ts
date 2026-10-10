import type { CommandSpec } from '@/lib/command-intelligence/types'

// 数据库相关命令
export const databaseCommands: CommandSpec[] = [
  // 1. MySQL 客户端
  {
    cmd: 'mysql',
    desc: 'MySQL客户端',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-u', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-p', desc: '密码', requiresValue: true, valueHint: '<password>' },
      { name: '-h', desc: '主机', requiresValue: true, valueHint: '<host>' },
      { name: '-P', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-e', desc: '执行SQL', requiresValue: true, valueHint: '<sql>' },
      { name: '-D', desc: '指定数据库', requiresValue: true, valueHint: '<db>' },
      { name: '--defaults-file', desc: '配置文件', requiresValue: true, valueHint: '<file>' },
    ],
    positional: [{ name: '<database>', desc: '数据库', type: 'value' }],
    examples: [
      { cmd: 'mysql -u root -p', desc: '登录MySQL' },
      { cmd: 'mysql -u root -p db < data.sql', desc: '导入数据' },
      { cmd: 'mysql -h 127.0.0.1 -P 3306 -u root -p -e "SHOW DATABASES"', desc: '远程执行查询' },
    ],
  },
  // 2. MySQL 备份
  {
    cmd: 'mysqldump',
    desc: 'MySQL备份',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-u', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-p', desc: '密码', requiresValue: true, valueHint: '<password>' },
      { name: '-h', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '-P', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '--all-databases', desc: '所有数据库', type: 'flag' },
      { name: '--databases', desc: '指定多个库', type: 'flag' },
      { name: '--single-transaction', desc: '一致性快照', type: 'flag' },
      { name: '--no-data', desc: '仅结构', type: 'flag' },
      { name: '--routines', desc: '存储过程', type: 'flag' },
      { name: '--triggers', desc: '触发器', type: 'flag' },
      { name: '--events', desc: '事件', type: 'flag' },
      { name: '-r', desc: '输出文件', requiresValue: true, valueHint: '<file>' },
    ],
    positional: [{ name: '<database>', desc: '数据库', type: 'value' }],
    examples: [
      { cmd: 'mysqldump -u root -p --all-databases > all.sql', desc: '备份所有库' },
      { cmd: 'mysqldump -u root -p --single-transaction db > db.sql', desc: '一致性备份单库' },
    ],
  },
  // 3. MySQL 管理（子命令）
  {
    cmd: 'mysqladmin',
    desc: 'MySQL管理',
    category: 'database',
    platforms: ['universal'],
    usage: 'mysqladmin [OPTIONS] COMMAND',
    subcommands: [
      { cmd: 'status', desc: '状态', params: [] },
      { cmd: 'version', desc: '版本', params: [] },
      { cmd: 'processlist', desc: '进程列表', params: [] },
      { cmd: 'shutdown', desc: '关闭服务', params: [] },
      { cmd: 'flush-hosts', desc: '清空主机缓存', params: [] },
      { cmd: 'flush-logs', desc: '刷新日志', params: [] },
      { cmd: 'kill', desc: '终止进程', params: [], positional: [{ name: '<pid>', desc: '进程ID', type: 'value' }] },
      { cmd: 'create', desc: '创建数据库', params: [], positional: [{ name: '<dbname>', desc: '数据库名', type: 'value' }] },
      { cmd: 'drop', desc: '删除数据库', params: [], positional: [{ name: '<dbname>', desc: '数据库名', type: 'value' }] },
    ],
    params: [
      { name: '-u', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-p', desc: '密码', requiresValue: true, valueHint: '<password>' },
      { name: '-h', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '-P', desc: '端口', requiresValue: true, valueHint: '<port>' },
    ],
    examples: [
      { cmd: 'mysqladmin -u root -p status', desc: '查看状态' },
      { cmd: 'mysqladmin -u root -p shutdown', desc: '关闭服务' },
    ],
  },
  // 4. 显示数据库/表
  {
    cmd: 'mysqlshow',
    desc: '显示数据库/表',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-u', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-p', desc: '密码', requiresValue: true, valueHint: '<password>' },
      { name: '-h', desc: '服务器', requiresValue: true, valueHint: '<host>' },
    ],
    positional: [
      { name: '<database>', desc: '数据库', type: 'value' },
      { name: '<table>', desc: '表', type: 'value' },
    ],
    examples: [
      { cmd: 'mysqlshow -u root -p', desc: '列出所有数据库' },
      { cmd: 'mysqlshow -u root -p db user', desc: '查看 db 库的 user 表' },
    ],
  },
  // 5. PostgreSQL 客户端
  {
    cmd: 'psql',
    desc: 'PostgreSQL客户端',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-U', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-h', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-d', desc: '数据库', requiresValue: true, valueHint: '<db>' },
      { name: '-f', desc: '执行文件', requiresValue: true, valueHint: '<file>' },
      { name: '-c', desc: '执行命令', requiresValue: true, valueHint: '<sql>' },
      { name: '-w', desc: '无密码提示', type: 'flag' },
    ],
    positional: [{ name: '<database>', desc: '数据库', type: 'value' }],
    examples: [
      { cmd: 'psql -U postgres -h localhost', desc: '连接 PG' },
      { cmd: 'psql -U postgres -d db -c "SELECT * FROM users;"', desc: '执行查询' },
    ],
  },
  // 6. PG 备份
  {
    cmd: 'pg_dump',
    desc: 'PG备份',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-U', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-h', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-d', desc: '数据库', requiresValue: true, valueHint: '<db>' },
      { name: '-f', desc: '输出文件', requiresValue: true, valueHint: '<file>' },
      { name: '-F', desc: '格式', requiresValue: true, valueHint: 'c|d|t|p' },
      { name: '-t', desc: '指定表', requiresValue: true, valueHint: '<table>' },
      { name: '--schema-only', desc: '仅结构', type: 'flag' },
      { name: '--data-only', desc: '仅数据', type: 'flag' },
      { name: '--no-owner', desc: '忽略所有者', type: 'flag' },
    ],
    positional: [{ name: '<database>', desc: '数据库', type: 'value' }],
    examples: [
      { cmd: 'pg_dump -U postgres db > db.sql', desc: '备份纯文本' },
      { cmd: 'pg_dump -U postgres -F c -f db.backup db', desc: '自定义格式备份' },
    ],
  },
  // 7. PG 恢复
  {
    cmd: 'pg_restore',
    desc: 'PG恢复',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-U', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-h', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-d', desc: '数据库', requiresValue: true, valueHint: '<db>' },
      { name: '-F', desc: '格式', requiresValue: true, valueHint: 'c|d|t' },
      { name: '-c', desc: '清理重建', type: 'flag' },
      { name: '-j', desc: '并行', requiresValue: true, valueHint: '<n>' },
    ],
    positional: [{ name: '<file>', desc: '备份文件', type: 'file' }],
    examples: [
      { cmd: 'pg_restore -U postgres -d db -c db.backup', desc: '恢复到 db 库' },
      { cmd: 'pg_restore -U postgres -d db -j 4 db.backup', desc: '并行恢复' },
    ],
  },
  // 8. PG 全量备份
  {
    cmd: 'pg_dumpall',
    desc: 'PG全量备份',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-U', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-h', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '-f', desc: '输出文件', requiresValue: true, valueHint: '<file>' },
      { name: '--globals-only', desc: '仅全局对象', type: 'flag' },
      { name: '--roles-only', desc: '仅角色', type: 'flag' },
      { name: '--tablespaces-only', desc: '仅表空间', type: 'flag' },
    ],
    examples: [
      { cmd: 'pg_dumpall -U postgres > all.sql', desc: '全量备份' },
      { cmd: 'pg_dumpall -U postgres --roles-only > roles.sql', desc: '仅备份角色' },
    ],
  },
  // 9. 创建 PG 数据库
  {
    cmd: 'createdb',
    desc: '创建PG数据库',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-U', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-h', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-O', desc: '所有者', requiresValue: true, valueHint: '<owner>' },
    ],
    positional: [{ name: '<dbname>', desc: '数据库名', type: 'value' }],
    examples: [{ cmd: 'createdb -U postgres mydb', desc: '创建 mydb' }],
  },
  // 10. 删除 PG 数据库
  {
    cmd: 'dropdb',
    desc: '删除PG数据库',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-U', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-h', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-i', desc: '确认', type: 'flag' },
    ],
    positional: [{ name: '<dbname>', desc: '数据库名', type: 'value' }],
    examples: [{ cmd: 'dropdb -U postgres -i mydb', desc: '交互式删除 mydb' }],
  },
  // 11. Redis 客户端
  {
    cmd: 'redis-cli',
    desc: 'Redis客户端',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-h', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '-p', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-a', desc: '密码', requiresValue: true, valueHint: '<password>' },
      { name: '-n', desc: '数据库号', requiresValue: true, valueHint: '<db>' },
      { name: '--rdb', desc: '备份', requiresValue: true, valueHint: '<file>' },
      { name: '--scan', desc: '扫描键', type: 'flag' },
      { name: '--bigkeys', desc: '查找大键', type: 'flag' },
      { name: '-c', desc: '集群模式', type: 'flag' },
    ],
    positional: [{ name: '<command>', desc: '命令', type: 'vararg' }],
    examples: [
      { cmd: 'redis-cli -h 127.0.0.1 -p 6379', desc: '连接 Redis' },
      { cmd: 'redis-cli -a password --bigkeys', desc: '查找大键' },
      { cmd: 'redis-cli SET key value', desc: '执行命令' },
    ],
  },
  // 12. Redis 服务
  {
    cmd: 'redis-server',
    desc: 'Redis服务',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '--port', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '--daemonize', desc: '守护进程', requiresValue: true, valueHint: 'yes|no' },
      { name: '--dir', desc: '工作目录', requiresValue: true, valueHint: '<dir>' },
      { name: '--dbfilename', desc: '数据文件', requiresValue: true, valueHint: '<file>' },
      { name: '--requirepass', desc: '密码', requiresValue: true, valueHint: '<password>' },
    ],
    positional: [{ name: '<configfile>', desc: '配置文件', type: 'file' }],
    examples: [
      { cmd: 'redis-server --daemonize yes', desc: '后台启动' },
      { cmd: 'redis-server /etc/redis/redis.conf', desc: '使用配置文件启动' },
    ],
  },
  // 13. MongoDB 客户端
  {
    cmd: 'mongo',
    desc: 'MongoDB客户端',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '--host', desc: '主机', requiresValue: true, valueHint: '<host>' },
      { name: '--port', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-u', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-p', desc: '密码', requiresValue: true, valueHint: '<password>' },
      { name: '--authenticationDatabase', desc: '认证库', requiresValue: true, valueHint: '<db>' },
    ],
    positional: [{ name: '<dbname>', desc: '数据库', type: 'value' }],
    examples: [
      { cmd: 'mongo --host 127.0.0.1 --port 27017', desc: '连接 MongoDB' },
      { cmd: 'mongo -u admin -p secret --authenticationDatabase admin', desc: '带认证连接' },
    ],
  },
  // 14. MongoDB 备份
  {
    cmd: 'mongodump',
    desc: 'MongoDB备份',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '--host', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '--port', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-u', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-p', desc: '密码', requiresValue: true, valueHint: '<password>' },
      { name: '--db', desc: '数据库', requiresValue: true, valueHint: '<db>' },
      { name: '--collection', desc: '集合', requiresValue: true, valueHint: '<coll>' },
      { name: '--out', desc: '输出目录', requiresValue: true, valueHint: '<dir>' },
      { name: '--archive', desc: '归档文件', requiresValue: true, valueHint: '<file>' },
      { name: '--gzip', desc: 'gzip 压缩', type: 'flag' },
    ],
    examples: [
      { cmd: 'mongodump --db mydb --out /backup', desc: '备份到目录' },
      { cmd: 'mongodump --archive=db.gz --gzip', desc: '压缩归档备份' },
    ],
  },
  // 15. MongoDB 恢复
  {
    cmd: 'mongorestore',
    desc: 'MongoDB恢复',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '--host', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '--port', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-u', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-p', desc: '密码', requiresValue: true, valueHint: '<password>' },
      { name: '--db', desc: '数据库', requiresValue: true, valueHint: '<db>' },
      { name: '--drop', desc: '恢复前删除', type: 'flag' },
      { name: '--archive', desc: '归档文件', requiresValue: true, valueHint: '<file>' },
      { name: '--gzip', desc: 'gzip 解压', type: 'flag' },
    ],
    positional: [{ name: '<dir|file>', desc: '目录或文件', type: 'path' }],
    examples: [
      { cmd: 'mongorestore /backup', desc: '从目录恢复' },
      { cmd: 'mongorestore --archive=db.gz --gzip --drop', desc: '从归档恢复并先清空' },
    ],
  },
  // 16. SQLite 客户端
  {
    cmd: 'sqlite3',
    desc: 'SQLite客户端',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-batch', desc: '批处理模式', type: 'flag' },
      { name: '-init', desc: '初始化文件', requiresValue: true, valueHint: '<file>' },
      { name: '-cmd', desc: '执行命令', requiresValue: true, valueHint: '<sql>' },
      { name: '-header', desc: '显示表头', type: 'flag' },
      { name: '-column', desc: '列对齐', type: 'flag' },
      { name: '-csv', desc: 'CSV 格式', type: 'flag' },
      { name: '-json', desc: 'JSON 格式', type: 'flag' },
    ],
    positional: [{ name: '<database>', desc: '数据库文件', type: 'file' }],
    examples: [
      { cmd: 'sqlite3 test.db', desc: '打开数据库' },
      { cmd: 'sqlite3 test.db -header -column "SELECT * FROM users;"', desc: '查询并格式化输出' },
    ],
  },
  // 17. InfluxDB 客户端
  {
    cmd: 'influx',
    desc: 'InfluxDB客户端',
    category: 'database',
    platforms: ['universal'],
    params: [
      { name: '-host', desc: '主机', requiresValue: true, valueHint: '<host>' },
      { name: '-port', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '-username', desc: '用户名', requiresValue: true, valueHint: '<user>' },
      { name: '-password', desc: '密码', requiresValue: true, valueHint: '<password>' },
      { name: '-database', desc: '数据库', requiresValue: true, valueHint: '<db>' },
      { name: '-execute', desc: '执行命令', requiresValue: true, valueHint: '<query>' },
      { name: '-format', desc: '输出格式', requiresValue: true, valueHint: 'json|csv|column' },
    ],
    examples: [
      { cmd: 'influx -host 127.0.0.1 -port 8086', desc: '连接 InfluxDB' },
      { cmd: 'influx -execute "SHOW DATABASES"', desc: '列出数据库' },
    ],
  },
  // 18. CockroachDB（子命令）
  {
    cmd: 'cockroach',
    desc: 'CockroachDB',
    category: 'database',
    platforms: ['universal'],
    usage: 'cockroach COMMAND',
    subcommands: [
      { cmd: 'start', desc: '启动节点', params: [] },
      { cmd: 'init', desc: '初始化集群', params: [] },
      { cmd: 'sql', desc: 'SQL 客户端', params: [] },
      { cmd: 'backup', desc: '备份', params: [] },
      { cmd: 'restore', desc: '恢复', params: [] },
      { cmd: 'user', desc: '用户管理', params: [] },
      { cmd: 'node', desc: '节点管理', params: [] },
    ],
    params: [
      { name: '--insecure', desc: '无认证', type: 'flag' },
      { name: '--host', desc: '服务器', requiresValue: true, valueHint: '<host>' },
      { name: '--port', desc: '端口', requiresValue: true, valueHint: '<port>' },
      { name: '--certs-dir', desc: '证书目录', requiresValue: true, valueHint: '<dir>' },
    ],
    examples: [
      { cmd: 'cockroach start --insecure --host=127.0.0.1', desc: '无认证启动节点' },
      { cmd: 'cockroach sql --insecure', desc: '进入 SQL 客户端' },
      { cmd: 'cockroach node status --insecure', desc: '查看节点状态' },
    ],
  },
]
