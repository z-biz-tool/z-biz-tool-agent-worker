const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const pty = require('node-pty');
const os = require('os');
const { EventEmitter } = require('events');

let mainWindow;
let server;

// ===== 数据目录 =====
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// ===== 事件总线 =====
const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

// ===== Agent进程管理 =====
const agentProcesses = new Map(); // agentId -> { process, taskId, output, waitingForInput }

// ===== SSE客户端管理 =====
const sseClients = new Map(); // agentId -> Set<res>

// ===== 清理ANSI转义码 =====
function stripAnsi(str) {
  return str.replace(/[\u001b\u007f\u009b][[\]#;?]*[0-9]*[a-zA-Z]/g, '')
            .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\u0007]*\u0007/g, '')
            .replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

// ===== 项目目录操作 =====
function getProjectDir(projectId) {
  return path.join(PROJECTS_DIR, projectId);
}

function ensureProjectDir(projectId) {
  const dir = getProjectDir(projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
  }
  return dir;
}

function getProjectFiles(projectId) {
  const dir = getProjectDir(projectId);
  return {
    context: path.join(dir, 'context.json'),
    meta: path.join(dir, 'meta.json'),
    agents: path.join(dir, 'agents'),
    tasks: path.join(dir, 'tasks')
  };
}

// ===== JSON读写 =====
function readJson(file, defaultVal = null) {
  try {
    if (!fs.existsSync(file)) return defaultVal;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return defaultVal; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ===== 初始化项目默认文件 =====
function initProjectFiles(projectId) {
  const files = getProjectFiles(projectId);
  ensureProjectDir(projectId);

  if (!fs.existsSync(files.context)) {
    writeJson(files.context, {
      projectId,
      name: '',
      description: '',
      goals: '',
      techStack: '',
      constraints: '',
      currentProgress: '',
      artifacts: {},
      updatedAt: new Date().toISOString(),
      updatedBy: null
    });
  }

  if (!fs.existsSync(files.meta)) {
    writeJson(files.meta, {
      id: projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}

// ===== 任务文件操作 =====
function getTaskFile(projectId, taskId) {
  return path.join(getProjectDir(projectId), 'tasks', `task_${taskId}.json`);
}

function getAgentFile(projectId, agentId) {
  return path.join(getProjectDir(projectId), 'agents', `agent_${agentId}.json`);
}

function readTasks(projectId) {
  const dir = path.join(getProjectDir(projectId), 'tasks');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.startsWith('task_') && f.endsWith('.json'));
  return files.map(f => {
    const task = readJson(path.join(dir, f));
    // 加载子任务详情
    if (task.children && task.children.length > 0) {
      task.childrenData = task.children.map(cid => {
        const childFile = path.join(dir, `task_${cid}.json`);
        return readJson(childFile, { id: cid, title: '未知任务' });
      }).filter(c => c);
    }
    return task;
  });
}

function readAgents(projectId) {
  const dir = path.join(getProjectDir(projectId), 'agents');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.startsWith('agent_') && f.endsWith('.json'));
  return files.map(f => readJson(path.join(dir, f)));
}

// ===== 事件广播 =====
function broadcastToClient(agentId, data) {
  if (sseClients.has(agentId)) {
    const dataStr = JSON.stringify(data);
    for (const client of sseClients.get(agentId)) {
      client.write(`data: ${dataStr}\n\n`);
    }
  }
}

// ===== Hermes Agent执行 =====
async function runHermesAgent(agentId, taskId, projectId) {
  const agentFile = getAgentFile(projectId, agentId);
  const agent = readJson(agentFile);
  if (!agent) throw new Error('Agent not found');

  const taskFile = getTaskFile(projectId, taskId);
  const task = readJson(taskFile);
  if (!task) throw new Error('Task not found');

  const contextFile = path.join(getProjectDir(projectId), 'context.json');
  const context = readJson(contextFile, {});

  // 构建prompt
  const systemPrompt = agent.identity.systemPrompt;
  const taskDesc = `## 任务\n${task.title}\n${task.description || ''}`;
  const contextInfo = `## 项目上下文\n当前进度：${context.currentProgress || '无'}\n技术栈：${context.techStack || '未设置'}\n目标：${context.goals || '未设置'}`;

  const fullPrompt = `${systemPrompt}\n\n${contextInfo}\n\n${taskDesc}`;

  console.log(`[Agent ${agent.name}] Starting task: ${task.title}`);

  // 使用node-pty启动Hermes
  const shell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh';
  const hermesPath = '/Users/zifang/.local/bin/hermes';
  const env = { ...process.env, PATH: '/Users/zifang/.local/bin:' + process.env.PATH };

  const proc = pty.spawn(shell, ['-c', `${hermesPath} "${fullPrompt.replace(/"/g, '\\"')}"`], {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd: getProjectDir(projectId),
    env
  });

  let output = '';
  let waitingForInput = false;

  proc.onData((data) => {
    const rawText = data.toString();
    const text = stripAnsi(rawText);
    output += text;

    // 检测等待输入
    if (text.includes('>') || text.includes('请输入') || text.includes('Continue') || text.includes('y/n') || text.includes('输入')) {
      waitingForInput = true;
    }

    // 更新任务输出
    task.agentOutput = output;
    task.waitingForInput = waitingForInput;
    writeJson(taskFile, task);

    // SSE推送
    broadcastToClient(agentId, {
      type: 'output',
      output,
      waitingForInput,
      running: true
    });
  });

  proc.onExit(({ exitCode }) => {
    console.log(`[Agent ${agent.name}] Process exited with code ${exitCode}`);
    agentProcesses.delete(agentId);

    broadcastToClient(agentId, {
      type: 'stopped',
      output,
      running: false,
      exitCode
    });

    // 任务完成处理
    if (task.parentId) {
      // 子任务完成，通知父任务验收
      eventBus.emit('TASK_COMPLETED', { taskId, projectId, exitCode });
    } else {
      // 顶层任务，直接进入review
      task.status = 'review';
      task.output = output;
      task.completedAt = new Date().toISOString();
      writeJson(taskFile, task);
    }

    // Agent状态回归
    agent.status = 'idle';
    agent.currentTaskId = null;
    writeJson(agentFile, agent);
  });

  agentProcesses.set(agentId, {
    process: proc,
    taskId,
    output,
    waitingForInput
  });

  return { success: true };
}

// ===== 事件处理：子任务完成 =====
eventBus.on('TASK_COMPLETED', async ({ taskId, projectId, exitCode }) => {
  const taskFile = getTaskFile(projectId, taskId);
  const task = readJson(taskFile);
  if (!task) return;

  const parentFile = getTaskFile(projectId, task.parentId);
  const parent = readJson(parentFile);
  if (!parent) return;

  console.log(`[Event] TASK_COMPLETED: ${taskId} -> parent: ${parent.id}`);

  // 父任务验收子任务（自动通过，可后续扩展为判断逻辑）
  if (!parent.receipts) parent.receipts = {};
  parent.receipts[taskId] = {
    taskTitle: task.title,
    output: task.output || task.agentOutput || '',
    completedAt: task.completedAt || new Date().toISOString(),
    exitCode
  };
  writeJson(parentFile, parent);

  // 检查是否所有子任务都完成
  const allChildrenDone = parent.children && parent.children.every(cid => {
    const childFile = getTaskFile(projectId, cid);
    const child = readJson(childFile);
    return child && child.status === 'done';
  });

  if (allChildrenDone && parent.children.length > 0) {
    // 所有子任务完成，父任务开始处理
    console.log(`[Event] All children done, parent ${parent.id} starting own work`);
    parent.status = 'doing';
    writeJson(parentFile, parent);

    // 父任务继续执行（使用原Agent或新Agent）
    // 这里简化处理，父任务进入review等待用户验收
    parent.status = 'review';
    parent.output = `子任务汇总：\n${Object.entries(parent.receipts).map(([tid, r]) => `- ${r.taskTitle}: 完成`).join('\n')}`;
    parent.completedAt = new Date().toISOString();
    writeJson(parentFile, parent);

    eventBus.emit('PARENT_ALL_CHILDREN_DONE', { parentId: parent.id, projectId });
  } else {
    // 还有子任务未完成，更新父任务状态
    parent.status = 'waiting';
    writeJson(parentFile, parent);
  }
});

// ===== Express服务 =====
function startServer() {
  const expressApp = express();
  expressApp.use(cors());
  expressApp.use(express.json());

  // ===== 项目API =====
  expressApp.get('/api/projects', (req, res) => {
    const dirs = fs.readdirSync(PROJECTS_DIR).filter(f => {
      const stat = fs.statSync(path.join(PROJECTS_DIR, f));
      return stat.isDirectory();
    });
    const projects = dirs.map(dir => {
      const meta = readJson(path.join(PROJECTS_DIR, dir, 'meta.json'), { id: dir });
      const context = readJson(path.join(PROJECTS_DIR, dir, 'context.json'), {});
      return { ...meta, name: context.name || dir, description: context.description || '' };
    });
    res.json(projects);
  });

  expressApp.post('/api/projects', (req, res) => {
    const { name, description } = req.body;
    const id = uuidv4();
    initProjectFiles(id);

    // 更新context
    const contextFile = path.join(getProjectDir(id), 'context.json');
    const context = readJson(contextFile);
    context.name = name;
    context.description = description || '';
    writeJson(contextFile, context);

    const meta = readJson(path.join(getProjectDir(id), 'meta.json'));
    res.json(meta);
  });

  expressApp.get('/api/projects/:id', (req, res) => {
    const { id } = req.params;
    const dir = getProjectDir(id);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });
    const meta = readJson(path.join(dir, 'meta.json'));
    const context = readJson(path.join(dir, 'context.json'));
    res.json({ ...meta, context });
  });

  expressApp.delete('/api/projects/:id', (req, res) => {
    const { id } = req.params;
    const dir = getProjectDir(id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
    res.json({ success: true });
  });

  // 项目统计指标
  expressApp.get('/api/projects/:id/stats', (req, res) => {
    const { id } = req.params;
    const tasks = readTasks(id);
    const agents = readAgents(id);
    const taskStats = {
      total: tasks.length,
      todo: tasks.filter(t => t.status === 'todo').length,
      doing: tasks.filter(t => t.status === 'doing').length,
      waiting: tasks.filter(t => t.status === 'waiting').length,
      review: tasks.filter(t => t.status === 'review').length,
      done: tasks.filter(t => t.status === 'done').length,
    };
    const agentStats = {
      total: agents.length,
      working: agents.filter(a => a.status === 'working').length,
      idle: agents.filter(a => a.status === 'idle').length,
      offline: agents.filter(a => a.status === 'offline').length,
    };
    res.json({ tasks: taskStats, agents: agentStats });
  });

  expressApp.get('/api/projects/:id/context', (req, res) => {
    const { id } = req.params;
    const contextFile = path.join(getProjectDir(id), 'context.json');
    res.json(readJson(contextFile, {}));
  });

  expressApp.put('/api/projects/:id/context', (req, res) => {
    const { id } = req.params;
    const contextFile = path.join(getProjectDir(id), 'context.json');
    const context = readJson(contextFile, {});
    const updated = { ...context, ...req.body, updatedAt: new Date().toISOString() };
    writeJson(contextFile, updated);
    res.json(updated);
  });

  // ===== Agent API =====
  expressApp.get('/api/agents', (req, res) => {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    res.json(readAgents(projectId));
  });

  expressApp.post('/api/agents', (req, res) => {
    const { projectId, name, systemPrompt, modelProvider, modelName } = req.body;
    const id = uuidv4();
    ensureProjectDir(projectId);

    const agent = {
      id,
      projectId,
      name: name || '新Agent',
      identity: {
        role: name || '通用助手',
        systemPrompt: systemPrompt || '你是一个有用的AI助手。'
      },
      model: {
        provider: modelProvider || 'hermes-local',
        modelName: modelName || 'default',
        temperature: 0.7
      },
      status: 'idle',
      currentTaskId: null,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };

    writeJson(getAgentFile(projectId, id), agent);
    res.json(agent);
  });

  expressApp.post('/api/agents/clone', (req, res) => {
    const { projectId, sourceAgentId, name } = req.body;
    const source = readJson(getAgentFile(projectId, sourceAgentId));
    if (!source) return res.status(404).json({ error: 'Source agent not found' });

    const id = uuidv4();
    const agent = {
      ...source,
      id,
      name: name || `${source.name} (副本)`,
      status: 'idle',
      currentTaskId: null,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };
    delete agent.currentTaskId;

    writeJson(getAgentFile(projectId, id), agent);
    res.json(agent);
  });

  expressApp.delete('/api/agents/:id', (req, res) => {
    const { id } = req.params;
    // 需要projectId来定位文件，但这里简化处理
    const dirs = fs.readdirSync(PROJECTS_DIR);
    for (const dir of dirs) {
      const file = path.join(PROJECTS_DIR, dir, 'agents', `agent_${id}.json`);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        break;
      }
    }
    res.json({ success: true });
  });

  expressApp.get('/api/agents/:id/status', (req, res) => {
    const { id } = req.params;
    // 查找agent
    let agent = null, projectId = null;
    const dirs = fs.readdirSync(PROJECTS_DIR);
    for (const dir of dirs) {
      const file = path.join(PROJECTS_DIR, dir, 'agents', `agent_${id}.json`);
      if (fs.existsSync(file)) {
        agent = readJson(file);
        projectId = dir;
        break;
      }
    }
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const isRunning = agentProcesses.has(id);
    res.json({
      ...agent,
      running: isRunning,
      output: isRunning ? agentProcesses.get(id).output : (agent.currentOutput || '')
    });
  });

  // ===== 任务API =====
  expressApp.get('/api/tasks', (req, res) => {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    res.json(readTasks(projectId));
  });

  expressApp.get('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const dirs = fs.readdirSync(PROJECTS_DIR);
    for (const dir of dirs) {
      const file = path.join(PROJECTS_DIR, dir, 'tasks', `task_${id}.json`);
      if (fs.existsSync(file)) {
        const task = readJson(file);
        if (task.children) {
          task.childrenData = task.children.map(cid => {
            return readJson(path.join(PROJECTS_DIR, dir, 'tasks', `task_${cid}.json`), { id: cid, title: '未知' });
          });
        }
        return res.json(task);
      }
    }
    res.status(404).json({ error: 'Task not found' });
  });

  expressApp.post('/api/tasks', (req, res) => {
    const { projectId, title, description, parentId, priority } = req.body;
    const id = uuidv4();
    ensureProjectDir(projectId);

    const task = {
      id,
      projectId,
      parentId: parentId || null,
      title: title || '新任务',
      description: description || '',
      status: 'todo',
      priority: priority || 1,
      assignedAgentId: null,
      assignedAgentName: null,
      children: [],
      receipts: {},
      output: '',
      agentOutput: '',
      artifacts: [],
      contextSnapshot: '',
      waitingForInput: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };

    writeJson(getTaskFile(projectId, id), task);

    // 如果是子任务，更新父任务的children
    if (parentId) {
      const parentFile = getTaskFile(projectId, parentId);
      const parent = readJson(parentFile);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(id);
        writeJson(parentFile, parent);
      }
    }

    res.json(task);
  });

  expressApp.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const dirs = fs.readdirSync(PROJECTS_DIR);
    let task = null, projectId = null;
    for (const dir of dirs) {
      const file = path.join(PROJECTS_DIR, dir, 'tasks', `task_${id}.json`);
      if (fs.existsSync(file)) {
        task = readJson(file);
        projectId = dir;
        break;
      }
    }
    if (!task) return res.status(404).json({ error: 'Task not found' });

    task = { ...task, ...req.body, updatedAt: new Date().toISOString() };
    writeJson(getTaskFile(projectId, id), task);

    if (task.children) {
      task.childrenData = task.children.map(cid => {
        return readJson(getTaskFile(projectId, cid), { id: cid, title: '未知' });
      });
    }
    res.json(task);
  });

  expressApp.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const dirs = fs.readdirSync(PROJECTS_DIR);
    for (const dir of dirs) {
      const file = path.join(PROJECTS_DIR, dir, 'tasks', `task_${id}.json`);
      if (fs.existsSync(file)) {
        const task = readJson(file);
        // 从父任务children中移除
        if (task.parentId) {
          const parentFile = getTaskFile(dir, task.parentId);
          const parent = readJson(parentFile);
          if (parent) {
            parent.children = (parent.children || []).filter(cid => cid !== id);
            writeJson(parentFile, parent);
          }
        }
        // 删除子任务
        if (task.children) {
          for (const cid of task.children) {
            const childFile = getTaskFile(dir, cid);
            if (fs.existsSync(childFile)) fs.unlinkSync(childFile);
          }
        }
        fs.unlinkSync(file);
        break;
      }
    }
    res.json({ success: true });
  });

  // 分配Agent到任务
  expressApp.post('/api/tasks/:id/assign', async (req, res) => {
    const { id } = req.params;
    const { agentId } = req.body;

    // 查找任务
    let task = null, projectId = null;
    const dirs = fs.readdirSync(PROJECTS_DIR);
    for (const dir of dirs) {
      const file = path.join(PROJECTS_DIR, dir, 'tasks', `task_${id}.json`);
      if (fs.existsSync(file)) {
        task = readJson(file);
        projectId = dir;
        break;
      }
    }
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // 查找Agent
    const agentFile = getAgentFile(projectId, agentId);
    const agent = readJson(agentFile);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // 更新任务状态
    task.status = 'doing';
    task.assignedAgentId = agentId;
    task.assignedAgentName = agent.name;
    task.updatedAt = new Date().toISOString();
    writeJson(getTaskFile(projectId, id), task);

    // 更新Agent状态
    agent.status = 'working';
    agent.currentTaskId = id;
    agent.lastUsedAt = new Date().toISOString();
    writeJson(agentFile, agent);

    // 启动Agent执行
    try {
      await runHermesAgent(agentId, id, projectId);
      res.json({ success: true, task, agent });
    } catch (error) {
      console.error('[Assign Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 任务验收（父任务验收子任务）
  expressApp.post('/api/tasks/:id/review', (req, res) => {
    const { id } = req.params;
    const { approved, message } = req.body;

    let task = null, projectId = null;
    const dirs = fs.readdirSync(PROJECTS_DIR);
    for (const dir of dirs) {
      const file = path.join(PROJECTS_DIR, dir, 'tasks', `task_${id}.json`);
      if (fs.existsSync(file)) {
        task = readJson(file);
        projectId = dir;
        break;
      }
    }
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (approved) {
      task.status = 'done';
      task.completedAt = new Date().toISOString();
    } else {
      task.status = 'todo';
      task.rejectedMessage = message || '验收不通过';
      // 事件：打回
      eventBus.emit('TASK_REJECTED', { taskId: id, projectId, message });
    }

    task.updatedAt = new Date().toISOString();
    writeJson(getTaskFile(projectId, id), task);
    res.json(task);
  });

  // 发送消息给运行中的Agent
  expressApp.post('/api/tasks/:id/send', (req, res) => {
    const { id } = req.params;
    const { message } = req.body;

    if (!agentProcesses.has(id)) {
      return res.json({ success: false, message: 'Agent not running' });
    }

    const agentData = agentProcesses.get(id);
    agentData.process.write(message + '\r');
    agentData.output += `\n[用户]: ${message}\n`;
    agentData.waitingForInput = false;

    res.json({ success: true });
  });

  // SSE流
  expressApp.get('/api/tasks/:id/stream', (req, res) => {
    const taskId = req.params.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 找到对应的agent
    let agentId = null;
    const dirs = fs.readdirSync(PROJECTS_DIR);
    for (const dir of dirs) {
      const taskFile = path.join(PROJECTS_DIR, dir, 'tasks', `task_${taskId}.json`);
      if (fs.existsSync(taskFile)) {
        const task = readJson(taskFile);
        agentId = task.assignedAgentId;
        break;
      }
    }

    if (!agentId) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Task not found' })}\n\n`);
      res.end();
      return;
    }

    // 注册SSE客户端
    if (!sseClients.has(agentId)) {
      sseClients.set(agentId, new Set());
    }
    sseClients.get(agentId).add(res);

    // 立即发送当前状态
    const sendUpdate = () => {
      if (agentProcesses.has(agentId)) {
        const data = agentProcesses.get(agentId);
        res.write(`data: ${JSON.stringify({ type: 'output', output: data.output, waitingForInput: data.waitingForInput, running: true })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'stopped', running: false })}\n\n`);
      }
    };
    sendUpdate();

    // 定时发送
    const interval = setInterval(sendUpdate, 1000);

    req.on('close', () => {
      clearInterval(interval);
      if (sseClients.has(agentId)) {
        sseClients.get(agentId).delete(res);
      }
    });
  });

  // 停止Agent
  expressApp.post('/api/agents/:id/stop', (req, res) => {
    const { id } = req.params;

    if (agentProcesses.has(id)) {
      agentProcesses.get(id).process.kill();
      agentProcesses.delete(id);
    }

    // 查找并更新Agent状态
    const dirs = fs.readdirSync(PROJECTS_DIR);
    for (const dir of dirs) {
      const file = path.join(PROJECTS_DIR, dir, 'agents', `agent_${id}.json`);
      if (fs.existsSync(file)) {
        const agent = readJson(file);
        agent.status = 'idle';
        agent.currentTaskId = null;
        writeJson(file, agent);

        // 重置任务状态
        if (agent.currentTaskId) {
          const taskFile = path.join(PROJECTS_DIR, dir, 'tasks', `task_${agent.currentTaskId}.json`);
          if (fs.existsSync(taskFile)) {
            const task = readJson(taskFile);
            task.status = 'todo';
            writeJson(taskFile, task);
          }
        }
        break;
      }
    }

    res.json({ success: true });
  });

  server = expressApp.listen(3001, () => {
    console.log('[Server] Running on http://localhost:3001');
  });
}

// ===== Electron窗口 =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5180');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-api-url', () => 'http://localhost:3001');
