# 晨翼Agent v1.0 云端服务文档

## 一、服务端架构

### 1.1 技术选型

| 组件 | 技术方案 | 说明 |
|------|----------|------|
| 运行时 | Node.js 20 LTS | 开发效率高，WebSocket生态成熟 |
| WebSocket | ws 库 | 轻量高性能，支持大并发 |
| HTTP框架 | Fastify | 比Express快2倍 |
| 数据库 | PostgreSQL | 关系型，支持JSON |
| 缓存 | Redis | 设备在线状态、会话 |
| 消息队列 | BullMQ | 任务调度 |

### 1.2 服务架构

```
┌─────────────────────────────────────────────────────┐
│                    云端服务                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ API Gateway │  │ WS Gateway  │  │ Task Worker │ │
│  │  (Fastify)  │  │    (ws)     │  │  (BullMQ)   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │        │
│  ┌──────┴────────────────┴────────────────┴──────┐ │
│  │              Message Router                    │ │
│  └───────────────────────┬───────────────────────┘ │
│                          │                         │
│  ┌───────────────────────┴───────────────────────┐ │
│  │     PostgreSQL + Redis + BullMQ               │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## 二、WebSocket 服务设计

### 2.1 连接管理

```javascript
// 连接存储结构
const connections = new Map(); // deviceId -> WebSocket

// 连接处理
wss.on('connection', (ws, req) => {
  const token = req.url.split('token=')[1];
  const user = verifyToken(token);
  
  ws.userId = user.id;
  ws.deviceId = null;
  ws.isAlive = true;
  
  ws.on('message', handleMessage);
  ws.on('pong', () => ws.isAlive = true);
});

// 心跳检测
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
```

### 2.2 消息路由

```javascript
async function handleMessage(ws, raw) {
  const msg = JSON.parse(raw);
  
  switch (msg.type) {
    case 'register':
      await handleRegister(ws, msg);
      break;
    case 'control':
      await handleControl(ws, msg);
      break;
    case 'task_result':
      await handleTaskResult(ws, msg);
      break;
    case 'sync':
      await handleSync(ws, msg);
      break;
  }
}

// 跨设备消息转发
async function handleControl(ws, msg) {
  const targetWs = connections.get(msg.target);
  if (targetWs) {
    targetWs.send(JSON.stringify(msg));
  } else {
    ws.send(JSON.stringify({
      type: 'error',
      requestId: msg.requestId,
      data: { message: '目标设备离线' }
    }));
  }
}
```
## 三、设备管理系统

### 3.1 设备注册流程

```javascript
async function handleRegister(ws, msg) {
  const { deviceId, deviceType, deviceName, capabilities } = msg.data;
  
  // 保存到数据库
  await db.query(`
    INSERT INTO devices (id, user_id, type, name, capabilities, last_seen)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET last_seen = NOW()
  `, [deviceId, ws.userId, deviceType, deviceName, capabilities]);
  
  // 更新连接映射
  ws.deviceId = deviceId;
  connections.set(deviceId, ws);
  
  // 更新Redis在线状态
  await redis.set(`device:${deviceId}:online`, '1', 'EX', 120);
  
  // 响应
  ws.send(JSON.stringify({
    type: 'register_ack',
    data: { success: true, deviceId }
  }));
}
```

### 3.2 设备状态管理

```javascript
// Redis存储设备状态
const deviceStatus = {
  online: 'device:{id}:online',      // TTL 120s
  status: 'device:{id}:status',       // idle/busy
  battery: 'device:{id}:battery',     // 0-100
  network: 'device:{id}:network'      // wifi/mobile
};

// 状态同步
async function handleSync(ws, msg) {
  const { status, battery, network } = msg.data;
  
  await redis.multi()
    .set(`device:${ws.deviceId}:status`, status)
    .set(`device:${ws.deviceId}:battery`, battery)
    .set(`device:${ws.deviceId}:network`, network)
    .exec();
  
  // 广播给订阅该设备的用户
  broadcastToUser(ws.userId, {
    type: 'device_update',
    data: msg.data
  });
}
```

## 四、用户认证系统

### 4.1 JWT Token 结构

```javascript
const jwt = require('jsonwebtoken');

// 生成Token
function generateToken(user) {
  return jwt.sign(
    { 
      userId: user.id, 
      email: user.email,
      role: user.role 
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// 验证Token
function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}
```

### 4.2 登录接口

```javascript
// POST /api/v1/auth/login
async function login(req, reply) {
  const { email, password } = req.body;
  
  const user = await db.query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  
  if (!user || !verifyPassword(password, user.password_hash)) {
    return reply.code(401).send({ error: '邮箱或密码错误' });
  }
  
  const token = generateToken(user);
  
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email }
  };
}
```

## 五、任务调度系统

### 5.1 任务队列设计

```javascript
const { Queue, Worker } = require('bullmq');

// 任务队列
const taskQueue = new Queue('tasks', {
  connection: redis
});

// 任务下发
async function dispatchTask(task) {
  const targetWs = connections.get(task.targetDeviceId);
  
  if (targetWs) {
    // 设备在线，直接发送
    targetWs.send(JSON.stringify({
      type: 'task',
      taskId: task.id,
      data: task.payload
    }));
    
    // 更新任务状态
    await db.query(
      'UPDATE tasks SET status = $1 WHERE id = $2',
      ['running', task.id]
    );
  } else {
    // 设备离线，加入队列等待
    await taskQueue.add('pending_task', task, {
      delay: 60000 // 1分钟后重试
    });
  }
}

// 任务结果处理
async function handleTaskResult(ws, msg) {
  const { taskId, success, result } = msg.data;
  
  await db.query(
    'UPDATE tasks SET status = $1, result = $2 WHERE id = $3',
    [success ? 'completed' : 'failed', result, taskId]
  );
  
  // 通知任务创建者
  const task = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  notifyUser(task.creator_id, {
    type: 'task_completed',
    data: { taskId, success, result }
  });
}
```

### 5.2 任务优先级

```javascript
// 优先级队列
const PRIORITY = {
  HIGH: 1,    // 紧急任务
  NORMAL: 5,  // 普通任务
  LOW: 10     // 后台任务
};

await taskQueue.add('task', taskData, {
  priority: PRIORITY.NORMAL
});
```

## 六、数据库设计

### 6.1 用户表

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 6.2 设备表

```sql
CREATE TABLE devices (
  id VARCHAR(64) PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  type VARCHAR(20) NOT NULL,  -- android/electron
  name VARCHAR(100),
  capabilities JSONB,
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_last_seen ON devices(last_seen);
```

### 6.3 任务表

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES users(id),
  target_device_id VARCHAR(64) REFERENCES devices(id),
  command VARCHAR(50) NOT NULL,
  params JSONB,
  status VARCHAR(20) DEFAULT 'pending',
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_device ON tasks(target_device_id);
```

## 七、部署方案

### 7.1 Docker Compose

```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/chenyi
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:15
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=chenyi
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

### 7.2 环境变量

```bash
# .env
DATABASE_URL=postgres://user:pass@localhost:5432/chenyi
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
PORT=3000
```
