/**
 * 用户认证模块
 */

const { users, sessions, JWT_SECRET, uuidv4, crypto } = require('./sync-server');

// 创建Token
function createToken(userId, username) {
  const payload = { userId, username, iat: Date.now() };
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  const token = Buffer.from(JSON.stringify({ payload, signature }))
    .toString('base64url');
  sessions.set(token, { userId, username, createdAt: Date.now() });
  return token;
}

// 验证Token
function verifyToken(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString());
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
      sessions.delete(token);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

// 注册（支持用户名）
function register(username, password, name) {
  // 检查用户名是否已存在
  for (const [key, u] of users.entries()) {
    if (u.username === username || u.email === username) {
      return { error: '用户名已注册' };
    }
  }
  
  const userId = uuidv4();
  const userData = {
    id: userId,
    username,
    password,
    name: name || username,
    createdAt: Date.now()
  };
  
  // 用 username 作为键存储
  users.set(username, userData);
  
  const token = createToken(userId, username);
  return { 
    success: true, 
    token, 
    user: { id: userId, name: userData.name } 
  };
}

// 登录（支持用户名）
function login(username, password) {
  // 用 username 查找
  let user = users.get(username);
  
  // 如果找不到，遍历所有用户，用 name 匹配
  if (!user) {
    for (const [key, u] of users.entries()) {
      if (u.name === username || u.username === username) {
        user = u;
        break;
      }
    }
  }
  
  if (!user || user.password !== password) {
    return { error: '用户名或密码错误' };
  }
  
  const token = createToken(user.id, user.username || user.name);
  return { 
    success: true, 
    token, 
    user: { id: user.id, name: user.name, username: user.username } 
  };
}

module.exports = {
  createToken,
  verifyToken,
  register,
  login
};