import { useState, useEffect, useRef } from 'react';
import './index.css';

const API_URL = 'http://localhost:3001';

// ===== 类型定义 =====
interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

interface Agent {
  id: string;
  projectId: string;
  name: string;
  identity: { role: string; systemPrompt: string };
  model: { provider: string; modelName: string };
  status: 'idle' | 'working' | 'offline';
  currentTaskId?: string;
  running?: boolean;
  output?: string;
}

interface Task {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  description?: string;
  status: 'todo' | 'doing' | 'waiting' | 'review' | 'done';
  priority: number;
  assignedAgentId?: string;
  assignedAgentName?: string;
  children: string[];
  childrenData?: Task[];
  receipts?: Record<string, any>;
  output?: string;
  agentOutput?: string;
  waitingForInput?: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ===== 项目列表 =====
interface ProjectStats {
  tasks: { total: number; todo: number; doing: number; waiting: number; review: number; done: number };
  agents: { total: number; working: number; idle: number; offline: number };
}

function ProjectList({ onSelect }: { onSelect: (p: Project) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Record<string, ProjectStats>>({});
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_URL}/api/projects`);
      const data = await res.json();
      setProjects(data);
      // 并行拉每个项目的 stats
      const statsResults = await Promise.all(data.map(async (p: Project) => {
        try {
          const r = await fetch(`${API_URL}/api/projects/${p.id}/stats`);
          const s = await r.json();
          return [p.id, s] as [string, ProjectStats];
        } catch (_) {
          return null;
        }
      }));
      const newStats: Record<string, ProjectStats> = {};
      statsResults.forEach(r => { if (r) newStats[r[0]] = r[1]; });
      setStats(prev => ({ ...prev, ...newStats }));
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchProjects(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch(`${API_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: description.trim() })
    });
    setShowModal(false);
    setName('');
    setDescription('');
    fetchProjects();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除项目？')) return;
    await fetch(`${API_URL}/api/projects/${id}`, { method: 'DELETE' });
    fetchProjects();
  };

  return (
    <div className="project-list">
      <header className="header">
        <h1>牛马鞭笞干活中心</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ 新建项目</button>
      </header>
      {projects.length === 0 ? (
        <div className="empty-state">暂无项目</div>
      ) : (
        <div className="project-table-wrap">
          <table className="project-table">
            <thead>
              <tr>
                <th>项目名称</th>
                <th>任务进展</th>
                <th>员工状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => {
                const s = stats[p.id];
                const taskDone = s?.tasks?.done ?? 0;
                const taskTotal = s?.tasks?.total ?? 0;
                const taskDoing = s?.tasks?.doing ?? 0;
                const agentWorking = s?.agents?.working ?? 0;
                const agentTotal = s?.agents?.total ?? 0;
                const date = new Date(p.createdAt).toLocaleDateString('zh-CN');
                return (
                  <tr key={p.id} className="project-row">
                    <td>
                      <div className="pt-name">{p.name || p.id}</div>
                      {p.description && <div className="pt-desc">{p.description}</div>}
                    </td>
                    <td>
                      <div className="pt-stat">
                        <span className={taskDoing > 0 ? 'stat-doing' : ''}>
                          {taskDoing > 0 ? `${taskDoing} 进行中` : taskTotal === 0 ? '无任务' : '暂无进行中'}
                        </span>
                        {taskTotal > 0 && (
                          <>
                            <span className="pt-progress">
                              <span className="pt-progress-bar" style={{ width: `${(taskDone / taskTotal) * 100}%` }} />
                            </span>
                            <span className="pt-task-count">{taskDone}/{taskTotal}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      {agentTotal === 0 ? (
                        <span className="stat-empty">无员工</span>
                      ) : (
                        <span className={agentWorking > 0 ? 'stat-doing' : 'stat-idle'}>
                          {agentWorking > 0 ? `${agentWorking}/${agentTotal} 工作中` : `${agentTotal} 人空闲`}
                        </span>
                      )}
                    </td>
                    <td className="pt-date">{date}</td>
                    <td>
                      <div className="pt-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => onSelect(p)}>进入</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id)}>删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>新建项目</h2>
            <form onSubmit={handleCreate}>
              <input placeholder="项目名称" value={name} onChange={e => setName(e.target.value)} autoFocus />
              <textarea placeholder="项目描述（可选）" value={description} onChange={e => setDescription(e.target.value)} />
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
                <button type="submit" className="btn btn-primary">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 左侧Agent面板 =====
function AgentPanel({ projectId, onAgentSelect }: { projectId: string; onAgentSelect: (agentId: string | null) => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newModel, setNewModel] = useState('default');

  const fetchAgents = async () => {
    try {
      const res = await fetch(`${API_URL}/api/agents?projectId=${projectId}`);
      setAgents(await res.json());
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchAgents(); }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await fetch(`${API_URL}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        name: newName.trim(),
        systemPrompt: newPrompt.trim() || '你是一个有用的AI助手。',
        modelName: newModel
      })
    });
    setShowCreate(false);
    setNewName('');
    setNewPrompt('');
    fetchAgents();
  };

  const handleClone = async (agentId: string) => {
    const source = agents.find(a => a.id === agentId);
    if (!source) return;
    await fetch(`${API_URL}/api/agents/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, sourceAgentId: agentId, name: `${source.name} (副本)` })
    });
    fetchAgents();
  };

  const handleDelete = async (agentId: string) => {
    if (!confirm('确认删除该Agent？')) return;
    await fetch(`${API_URL}/api/agents/${agentId}`, { method: 'DELETE' });
    fetchAgents();
  };

  return (
    <div className="agent-panel">
      <div className="panel-header">
        <h3>员工列表</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ 制造</button>
      </div>

      {agents.length === 0 && (
        <div className="empty-state">暂无员工，点击制造</div>
      )}

      {agents.map(agent => (
        <div key={agent.id} className={`agent-card ${selectedAgentId === agent.id ? 'selected' : ''}`}
          onClick={() => {
            const newId = agent.id === selectedAgentId ? null : agent.id;
            setSelectedAgentId(newId);
            onAgentSelect(newId);
          }}>
          <div className="agent-header">
            <div className="agent-avatar">{agent.name.charAt(0)}</div>
            <div className="agent-info">
              <div className="agent-name">{agent.name}</div>
              <div className={`agent-status ${agent.status}`}>
                <span className="status-dot" />
                {agent.status === 'idle' ? '空闲' : agent.status === 'working' ? '工作中' : '离线'}
              </div>
            </div>
          </div>
          {selectedAgentId === agent.id && (
            <div className="agent-actions" onClick={e => e.stopPropagation()}>
              <button className="btn btn-sm btn-secondary" onClick={() => handleClone(agent.id)}>克隆</button>
              <button className="btn btn-sm btn-danger" onClick={() => handleDelete(agent.id)}>删除</button>
            </div>
          )}
        </div>
      ))}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>制造员工</h2>
            <form onSubmit={handleCreate}>
              <input placeholder="员工名称" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
              <input placeholder="模型名称" value={newModel} onChange={e => setNewModel(e.target.value)} />
              <textarea placeholder="系统提示词（可选）" value={newPrompt} onChange={e => setNewPrompt(e.target.value)} />
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>取消</button>
                <button type="submit" className="btn btn-primary">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedAgentId && (
        <div className="assign-hint">选中任务后点击分配</div>
      )}
    </div>
  );
}

// ===== 任务看板 =====
function TaskBoard({
  projectId,
  selectedAgentId,
  onAssignAgent
}: {
  projectId: string;
  selectedAgentId: string | null;
  onAssignAgent: (taskId: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const hasAgentSelected = selectedAgentId !== null;

  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newParentId, setNewParentId] = useState<string | null>(null);

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${API_URL}/api/tasks?projectId=${projectId}`);
      setTasks(await res.json());
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await fetch(`${API_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        title: newTitle.trim(),
        description: newDesc.trim(),
        parentId: newParentId
      })
    });
    setShowAddTask(false);
    setNewTitle('');
    setNewDesc('');
    setNewParentId(null);
    fetchTasks();
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('确认删除该任务？')) return;
    await fetch(`${API_URL}/api/tasks/${taskId}`, { method: 'DELETE' });
    fetchTasks();
  };

  const handleReview = async (taskId: string, approved: boolean) => {
    await fetch(`${API_URL}/api/tasks/${taskId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved })
    });
    fetchTasks();
  };

  const toggleExpand = (taskId: string) => {
    const next = new Set(expandedTasks);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    setExpandedTasks(next);
  };

  // 顶层任务（无父）
  const rootTasks = tasks.filter(t => !t.parentId);

  const columns = [
    { id: 'todo', title: '待处理' },
    { id: 'doing', title: '进行中' },
    { id: 'waiting', title: '等待子任务' },
    { id: 'review', title: '待验收' },
    { id: 'done', title: '已完成' }
  ];

  const getColumnTasks = (status: string) => rootTasks.filter(t => t.status === status);

  return (
    <div className="task-board">
      <div className="board-header">
        <h2>任务看板</h2>
        <button className="btn btn-primary" onClick={() => setShowAddTask(true)}>+ 添加任务</button>
      </div>

      <div className="board-columns">
        {columns.map(col => (
          <div key={col.id} className="board-column">
            <div className="column-header">
              <span>{col.title}</span>
              <span className="task-count">{getColumnTasks(col.id).length}</span>
            </div>
            <div className="column-tasks">
              {getColumnTasks(col.id).map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  allTasks={tasks}
                  expanded={expandedTasks.has(task.id)}
                  onToggleExpand={() => toggleExpand(task.id)}
                  onAssign={() => onAssignAgent(task.id)}
                  onReview={(approved) => handleReview(task.id, approved)}
                  onDelete={() => handleDelete(task.id)}
                  selected={selectedTaskId === task.id}
                  onSelect={() => setSelectedTaskId(task.id === selectedTaskId ? null : task.id)}
                  hasAgentSelected={hasAgentSelected}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {showAddTask && (
        <div className="modal-overlay" onClick={() => setShowAddTask(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>添加任务</h2>
            <form onSubmit={handleCreate}>
              <input placeholder="任务标题" value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus />
              <textarea placeholder="任务描述" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
              <select value={newParentId || ''} onChange={e => setNewParentId(e.target.value || null)}>
                <option value="">顶级任务</option>
                {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddTask(false)}>取消</button>
                <button type="submit" className="btn btn-primary">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 任务卡片 =====
function TaskCard({
  task,
  allTasks,
  expanded,
  onToggleExpand,
  onAssign,
  onReview,
  onDelete,
  selected,
  onSelect,
  hasAgentSelected
}: {
  task: Task;
  allTasks: Task[];
  expanded: boolean;
  onToggleExpand: () => void;
  onAssign: () => void;
  onReview: (approved: boolean) => void;
  onDelete: () => void;
  selected: boolean;
  onSelect: () => void;
  hasAgentSelected: boolean;
}) {
  const hasChildren = task.children && task.children.length > 0;
  const childTasks = hasChildren
    ? task.children.map(cid => allTasks.find(t => t.id === cid)).filter(Boolean) as Task[]
    : [];

  return (
    <div className={`task-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="task-card-header">
        {hasChildren && (
          <button className="expand-btn" onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}>
            {expanded ? '▼' : '▶'}
          </button>
        )}
        <div className="task-title">
          {task.title}
          {task.status === 'doing' && task.assignedAgentName && (
            <span className="task-agent-badge">⟿ {task.assignedAgentName}</span>
          )}
        </div>
        {task.assignedAgentName && task.status !== 'doing' && <span className="task-agent">{task.assignedAgentName}</span>}
      </div>

      {task.description && <p className="task-desc">{task.description}</p>}

      {hasChildren && expanded && (
        <div className="task-children">
          {childTasks.map(child => (
            <div key={child.id} className={`child-task ${child.status}`}>
              <span className="child-title">{child.title}</span>
              <span className={`child-status ${child.status}`}>{child.status}</span>
            </div>
          ))}
        </div>
      )}

      <div className="task-actions" onClick={e => e.stopPropagation()}>
        {task.status === 'todo' && (
          <button className="btn btn-sm btn-primary" onClick={onAssign}>
            {hasAgentSelected ? '分配执行' : '查看详情'}
          </button>
        )}
        {task.status === 'review' && (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => onReview(true)}>通过</button>
            <button className="btn btn-sm btn-danger" onClick={() => onReview(false)}>打回</button>
          </>
        )}
        {(task.status === 'doing' || task.status === 'waiting') && task.assignedAgentId && (
          <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); onSelect(); }}>
            查看执行
          </button>
        )}
        <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>删除</button>
      </div>
    </div>
  );
}

// ===== 任务详情弹窗 =====
function TaskDetailModal({
  taskId,
  onClose
}: {
  taskId: string;
  onClose: () => void;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [output, setOutput] = useState('');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTask();
    fetchOutput();
    const interval = setInterval(fetchOutput, 1000);
    return () => clearInterval(interval);
  }, [taskId]);

  const fetchTask = async () => {
    try {
      const res = await fetch(`${API_URL}/api/tasks/${taskId}`);
      setTask(await res.json());
    } catch (e) { console.error(e); }
  };

  const fetchOutput = async () => {
    if (!task?.assignedAgentId) return;
    try {
      const res = await fetch(`${API_URL}/api/agents/${task.assignedAgentId}/status`);
      const data = await res.json();
      setOutput(data.output || '');
      setIsLoading(data.running && data.waitingForInput);
    } catch (e) { /* ignore */ }
  };

  const handleSend = async () => {
    if (!input.trim() || !task?.assignedAgentId) return;
    await fetch(`${API_URL}/api/tasks/${taskId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input })
    });
    setInput('');
  };

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  if (!task) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <h2>{task.title}</h2>
        <div className="task-meta-info">
          <span>状态: <strong>{task.status}</strong></span>
          {task.assignedAgentName && <span>执行者: <strong>{task.assignedAgentName}</strong></span>}
        </div>

        {task.description && (
          <div className="task-detail-desc">
            <strong>描述：</strong>
            <p>{task.description}</p>
          </div>
        )}

        {task.children && task.children.length > 0 && (
          <div className="task-detail-children">
            <strong>子任务：</strong>
            {task.children.map(cid => {
              const child = task.childrenData?.find(c => c?.id === cid);
              return child ? (
                <div key={cid} className={`child-status ${child.status}`}>
                  {child.title} - {child.status}
                </div>
              ) : null;
            })}
          </div>
        )}

        {task.receipts && Object.keys(task.receipts).length > 0 && (
          <div className="task-receipts">
            <strong>子任务回执：</strong>
            {Object.entries(task.receipts).map(([tid, r]: [string, any]) => (
              <div key={tid} className="receipt-item">
                {r.taskTitle} - 已完成
              </div>
            ))}
          </div>
        )}

        <div className="output-area">
          <strong>执行输出：</strong>
          <div className="output-content" ref={outputRef}>
            <pre>{output || '等待执行...'}</pre>
            {isLoading && <div className="loading-indicator">等待输入...</div>}
          </div>
        </div>

        <div className="chat-input-area">
          <input
            placeholder="输入消息..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && handleSend()}
            disabled={!task.assignedAgentId}
          />
          <button className="btn btn-primary" onClick={handleSend} disabled={!task.assignedAgentId}>发送</button>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ===== 主应用 =====
export default function App() {
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const handleAssignAgent = async (taskId: string) => {
    if (!selectedAgentId || !currentProject) return;
    await fetch(`${API_URL}/api/tasks/${taskId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: selectedAgentId })
    });
    setSelectedAgentId(null);
  };

  if (!currentProject) {
    return <ProjectList onSelect={setCurrentProject} />;
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <button className="btn btn-secondary" onClick={() => setCurrentProject(null)}>← 返回</button>
          <h2>{currentProject.name}</h2>
        </div>
        {selectedAgentId && (
          <div className="assign-mode">
            <span>分配模式：选择一个任务执行</span>
            <button className="btn btn-sm btn-secondary" onClick={() => setSelectedAgentId(null)}>取消</button>
          </div>
        )}
      </header>

      <div className="app-body">
        <AgentPanel
          projectId={currentProject.id}
          onAgentSelect={(agentId) => setSelectedAgentId(agentId)}
        />

        <TaskBoard
          projectId={currentProject.id}
          selectedAgentId={selectedAgentId}
          onAssignAgent={(taskId) => {
            if (selectedAgentId) {
              handleAssignAgent(taskId);
            } else {
              setSelectedTaskId(taskId);
            }
          }}
        />
      </div>

      {selectedTaskId && (
        <TaskDetailModal
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}
