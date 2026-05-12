/**
 * 数据同步模块
 * 会话、任务、记忆的云存储和同步
 */

const { sessionData, taskData, memoryData, uuidv4 } = require('./sync-server');

// ==================== 会话同步 ====================

function createSession(userId, session) {
  const sessionId = session.id || `session_${uuidv4()}`;
  
  sessionData.set(sessionId, {
    ...session,
    id: sessionId,
    userId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  
  return { success: true, sessionId };
}

function getSession(sessionId) {
  return sessionData.get(sessionId) || null;
}

function getUserSessions(userId) {
  const sessions = [];
  for (const [id, session] of sessionData) {
    if (session.userId === userId) {
      sessions.push(session);
    }
  }
  return { sessions };
}

function updateSession(sessionId, updates) {
  const session = sessionData.get(sessionId);
  if (!session) {
    return { error: '会话不存在' };
  }
  
  Object.assign(session, updates, { updatedAt: Date.now() });
  sessionData.set(sessionId, session); // 持久化
  return { success: true };
}

// ==================== 任务同步 ====================

function createTask(userId, task) {
  const taskId = task.id || `task_${uuidv4()}`;
  
  taskData.set(taskId, {
    ...task,
    id: taskId,
    userId,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  
  return { success: true, taskId };
}

function getTask(taskId) {
  return taskData.get(taskId) || null;
}

function getUserTasks(userId) {
  const tasks = [];
  for (const [id, task] of taskData) {
    if (task.userId === userId) {
      tasks.push(task);
    }
  }
  return { tasks };
}

function updateTask(taskId, updates) {
  const task = taskData.get(taskId);
  if (!task) {
    return { error: '任务不存在' };
  }
  
  Object.assign(task, updates, { updatedAt: Date.now() });
  taskData.set(taskId, task); // 持久化
  return { success: true };
}

// ==================== 记忆同步 ====================

function saveMemory(userId, content, metadata = {}) {
  const memoryId = `memory_${uuidv4()}`;
  
  memoryData.set(memoryId, {
    id: memoryId,
    userId,
    content,
    metadata,
    createdAt: Date.now()
  });
  
  return { success: true, memoryId };
}

function getUserMemories(userId, limit = 100) {
  const memories = [];
  for (const [id, memory] of memoryData) {
    if (memory.userId === userId) {
      memories.push(memory);
    }
  }
  return { memories: memories.slice(0, limit) };
}

module.exports = {
  createSession,
  getSession,
  getUserSessions,
  updateSession,
  createTask,
  getTask,
  getUserTasks,
  updateTask,
  saveMemory,
  getUserMemories
};