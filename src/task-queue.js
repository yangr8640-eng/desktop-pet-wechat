// task-queue.js — Serial task queue for processing AI agent tasks
//
// Ensures tasks are processed one at a time, with status tracking
// and result caching for recent tasks.

const { processTask } = require('./task-processor');

// ─── Queue State ───

const tasks = [];           // pending tasks
const completedTasks = [];  // completed/failed tasks (recent 50)
let activeTask = null;
let processing = false;

// ─── Public API ───

function enqueueTask(taskData) {
  const task = {
    id: generateTaskId(),
    type: taskData.type || 'generic',
    senderName: taskData.senderName || '未知用户',
    messageText: taskData.messageText,
    raw: taskData.raw || null,
    status: 'pending',   // pending | processing | completed | failed
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    response: null,
    error: null,
    toolCalls: []
  };

  tasks.push(task);
  processNext();

  // Notify pet window about new task
  notifyPetWindow('task-queued', { id: task.id, senderName: task.senderName });

  return task.id;
}

function getQueue() {
  return {
    pending: tasks.map(t => ({ id: t.id, senderName: t.senderName, messageText: t.messageText, status: t.status, createdAt: t.createdAt })),
    active: activeTask ? { id: activeTask.id, senderName: activeTask.senderName, status: activeTask.status, startedAt: activeTask.startedAt } : null,
    completed: completedTasks.map(t => ({ id: t.id, senderName: t.senderName, status: t.status, response: t.response ? t.response.slice(0, 100) : null, completedAt: t.completedAt }))
  };
}

function getActiveCount() {
  return (activeTask ? 1 : 0) + tasks.length;
}

function getTaskStatus(taskId) {
  const all = [...tasks, activeTask, ...completedTasks].filter(Boolean);
  return all.find(t => t.id === taskId) || null;
}

// ─── Internal Processing ───

async function processNext() {
  if (processing) return;
  if (tasks.length === 0) return;

  processing = true;
  activeTask = tasks.shift();
  activeTask.status = 'processing';
  activeTask.startedAt = new Date().toISOString();

  notifyPetWindow('task-started', { id: activeTask.id, senderName: activeTask.senderName });

  try {
    const result = await processTask(activeTask.messageText, {
      onThinking: (round) => {
        notifyPetWindow('task-thinking', { id: activeTask.id, round });
      },
      onToolCall: (name, params) => {
        activeTask.toolCalls.push({ name, params, result: null, timestamp: new Date().toISOString() });
        notifyPetWindow('task-tool-call', { id: activeTask.id, tool: name });
      },
      onToolResult: (name, result) => {
        const tc = activeTask.toolCalls.find(t => t.name === name && !t.result);
        if (tc) tc.result = typeof result === 'string' ? result.slice(0, 200) : result;
        notifyPetWindow('task-tool-result', { id: activeTask.id, tool: name });
      },
      onResponse: (text) => {
        activeTask.response = text;
      },
      onError: (msg) => {
        activeTask.error = msg;
      }
    });

    if (result.success) {
      activeTask.status = 'completed';
      activeTask.response = result.response;
    } else {
      activeTask.status = 'failed';
      activeTask.error = result.error;
      activeTask.response = result.response;
    }
  } catch (err) {
    activeTask.status = 'failed';
    activeTask.error = err.message;
  }

  activeTask.completedAt = new Date().toISOString();
  completedTasks.push(activeTask);
  if (completedTasks.length > 50) completedTasks.shift();

  notifyPetWindow('task-completed', {
    id: activeTask.id,
    status: activeTask.status,
    response: activeTask.response ? activeTask.response.slice(0, 100) : null
  });

  activeTask = null;
  processing = false;

  // Process next pending task
  if (tasks.length > 0) {
    setImmediate(processNext);
  }
}

// ─── Pet window notification ───

function notifyPetWindow(event, data) {
  try {
    const { getPetWindow } = require('./windows');
    const petWindow = getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('agent-event', { event, data });
    }
  } catch { /* windows module might not be ready yet */ }
}

// ─── Helpers ───

function generateTaskId() {
  return 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

module.exports = { enqueueTask, getQueue, getActiveCount, getTaskStatus };
