import { useEffect, useMemo, useState } from "react";
import {
  Layout, Card, Button, Modal, Input, Tag, Avatar, Progress, Empty,
  Row, Col, Space, Typography, Dropdown, message, Tabs, Tooltip, Badge, Collapse,
  Select, Checkbox, Spin, Alert,
} from "antd";
import {
  PlusOutlined, DeleteOutlined, CopyOutlined, UserOutlined,
  ProjectOutlined, TeamOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined, PlayCircleOutlined, PauseCircleOutlined,
  EyeOutlined, SettingOutlined, ApiOutlined, ReloadOutlined, ThunderboltOutlined,
  FileTextOutlined, SyncOutlined,
} from "@ant-design/icons";
import { useWorkerStore } from "./stores/workerStore";
import type { Agent, Task, LocalAgentInfo } from "./types";

const { Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const STATUS_CONFIG: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  todo: { color: "default", label: "待处理", icon: <ClockCircleOutlined /> },
  doing: { color: "processing", label: "进行中", icon: <PlayCircleOutlined /> },
  waiting: { color: "warning", label: "等待中", icon: <PauseCircleOutlined /> },
  review: { color: "orange", label: "待验收", icon: <EyeOutlined /> },
  done: { color: "success", label: "已完成", icon: <CheckCircleOutlined /> },
};

const CLI_LABELS: Record<string, { label: string; color: string }> = {
  "claude-code": { label: "Claude Code", color: "#d97706" },
  hermes: { label: "Hermes", color: "#7c3aed" },
  opencode: { label: "OpenCode", color: "#0ea5e9" },
};

const AGENT_COLORS = ["#1677ff", "#52c41a", "#faad14", "#eb2f96", "#722ed1", "#13c2c2"];

export default function App() {
  const store = useWorkerStore();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [importLocalOpen, setImportLocalOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [projectForm, setProjectForm] = useState({ name: "", desc: "" });
  const [taskForm, setTaskForm] = useState({ title: "", desc: "" });
  // 高级模式:手填 Agent
  const [manualAgentForm, setManualAgentForm] = useState({ name: "", prompt: "", model: "" });
  // 查看输出弹窗
  const [outputModal, setOutputModal] = useState<{ title: string; content: string } | null>(null);

  useEffect(() => { store.loadProjects(); }, []);

  const currentProject = store.projects.find(p => p.id === store.currentProjectId);
  const agents = store.agents;
  const tasks = store.tasks;

  // 轮询:当当前项目里有 doing/waiting 状态的任务时,每 3s 拉一次最新状态。
  // agent 后台执行结束后会把 task 改成 review,UI 刷新后看到。
  useEffect(() => {
    if (!currentProject) return;
    const hasInFlight = tasks.some(t => t.status === "doing" || t.status === "waiting");
    if (!hasInFlight) return;
    const timer = setInterval(() => {
      store.selectProject(currentProject.id);
    }, 3000);
    return () => clearInterval(timer);
  }, [currentProject, tasks]);

  // ─────────── 侧栏 ───────────
  const sider = (
    <Sider width={260} style={{ background: "#fff", borderRight: "1px solid #f0f0f0", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={5} style={{ margin: 0 }}>项目列表</Title>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setNewProjectOpen(true)} />
      </div>
      {store.projects.map(p => (
        <Card
          key={p.id}
          size="small"
          hoverable
          style={{ marginBottom: 8, borderLeft: p.id === store.currentProjectId ? "3px solid #1677ff" : undefined }}
          onClick={() => store.selectProject(p.id)}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Text strong ellipsis style={{ flex: 1 }}>{p.name}</Text>
            <Dropdown menu={{
              items: [{ key: "del", label: "删除", icon: <DeleteOutlined />, danger: true }],
              onClick: () => { Modal.confirm({ title: `删除项目 "${p.name}"?`, onOk: () => store.deleteProject(p.id) }); },
            }} trigger={["contextMenu"]}>
              <Button type="text" size="small" icon={<SettingOutlined />} />
            </Dropdown>
          </div>
          <Text type="secondary" ellipsis style={{ fontSize: 12 }}>{p.description}</Text>
        </Card>
      ))}
      {store.projects.length === 0 && <Empty description="暂无项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
    </Sider>
  );

  // ─────────── 顶部统计条(跨 tab 共享) ───────────
  const statsBar = store.stats && (
    <Row gutter={16} style={{ marginBottom: 16 }}>
      <Col span={6}>
        <Card size="small">
          <Text type="secondary">总任务</Text><br />
          <Text strong style={{ fontSize: 24 }}>{store.stats.tasks.total}</Text>
        </Card>
      </Col>
      <Col span={6}>
        <Card size="small">
          <Text type="secondary">进行中</Text><br />
          <Text strong style={{ fontSize: 24, color: "#1677ff" }}>{store.stats.tasks.doing}</Text>
        </Card>
      </Col>
      <Col span={6}>
        <Card size="small">
          <Text type="secondary">Agent</Text><br />
          <Text strong style={{ fontSize: 24 }}>{store.stats.agents.total}</Text>
        </Card>
      </Col>
      <Col span={6}>
        <Card size="small">
          <Text type="secondary">完成率</Text><br />
          <Progress
            percent={store.stats.tasks.total > 0 ? Math.round(store.stats.tasks.done / store.stats.tasks.total * 100) : 0}
            size="small"
          />
        </Card>
      </Col>
    </Row>
  );

  // ─────────── Tab 1:Agent 员工 ───────────
  const renderAgentCard = (agent: Agent, i: number) => {
    const cliMeta = agent.cli_type ? CLI_LABELS[agent.cli_type] : null;
    const isLocal = agent.source === "local";
    return (
      <Card
        key={agent.id}
        size="small"
        style={{ width: 260, borderTop: cliMeta ? `3px solid ${cliMeta.color}` : undefined }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar
            style={{ backgroundColor: AGENT_COLORS[i % AGENT_COLORS.length], flexShrink: 0 }}
          >
            {agent.name[0]}
          </Avatar>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text strong ellipsis style={{ display: "block", fontSize: 13 }}>{agent.name}</Text>
            <Space size={4}>
              <Tag
                color={agent.status === "working" ? "processing" : agent.status === "idle" ? "default" : "error"}
                style={{ fontSize: 11, margin: 0 }}
              >
                {agent.status === "working" ? "工作中" : agent.status === "idle" ? "空闲" : "离线"}
              </Tag>
              {isLocal && cliMeta && (
                <Tag color={cliMeta.color} style={{ fontSize: 11, margin: 0 }}>{cliMeta.label}</Tag>
              )}
              {!isLocal && <Tag style={{ fontSize: 11, margin: 0 }}>手填</Tag>}
            </Space>
          </div>
          <Dropdown
            menu={{
              items: [
                { key: "clone", label: "克隆", icon: <CopyOutlined /> },
                { key: "del", label: "删除", icon: <DeleteOutlined />, danger: true },
              ],
              onClick: ({ key }) => {
                if (key === "del") {
                  Modal.confirm({
                    title: `删除 Agent "${agent.name}"?`,
                    onOk: () => store.deleteAgent(agent.id),
                  });
                }
                if (key === "clone") {
                  store.cloneAgent(currentProject!.id, agent.id, "");
                }
              },
            }}
            trigger={["click"]}
          >
            <Button type="text" size="small" icon={<SettingOutlined />} />
          </Dropdown>
        </div>
        {isLocal && (agent.cli_version || agent.cli_path) && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#999" }}>
            {agent.cli_version && <div>版本: {agent.cli_version}</div>}
            {agent.cli_path && (
              <div style={{ wordBreak: "break-all" }}>路径: {agent.cli_path}</div>
            )}
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: "#999" }}>
          模型: {agent.model || "default"}
        </div>
      </Card>
    );
  };

  const agentTabContent = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Text type="secondary">
          本项目当前挂载 <Text strong>{agents.length}</Text> 个 Agent。
          点「引入本地 Agent」扫描本机可用的 CLI(claude-code / hermes / opencode)。
        </Text>
        <Space>
          <Button icon={<ApiOutlined />} onClick={() => setImportLocalOpen(true)}>
            引入本地 Agent
          </Button>
        </Space>
      </div>

      {agents.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" size={8}>
              <Text type="secondary">本项目还没有 Agent</Text>
              <Button type="primary" icon={<ApiOutlined />} onClick={() => setImportLocalOpen(true)}>
                引入本地 Agent
              </Button>
            </Space>
          }
          style={{ padding: "60px 0" }}
        />
      ) : (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {agents.map((a, i) => renderAgentCard(a, i))}
        </div>
      )}

      {/* 高级模式:手填 Agent */}
      <Collapse
        ghost
        style={{ marginTop: 24 }}
        items={[{
          key: "advanced",
          label: (
            <Space>
              <ThunderboltOutlined />
              <Text type="secondary">高级模式:手填 Agent(不走本地 CLI)</Text>
            </Space>
          ),
          children: (
            <div style={{ padding: "0 12px 12px", maxWidth: 600 }}>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Input
                  placeholder="Agent 名称"
                  value={manualAgentForm.name}
                  onChange={e => setManualAgentForm({ ...manualAgentForm, name: e.target.value })}
                />
                <TextArea
                  placeholder="系统提示词"
                  rows={3}
                  value={manualAgentForm.prompt}
                  onChange={e => setManualAgentForm({ ...manualAgentForm, prompt: e.target.value })}
                />
                <Input
                  placeholder="模型(如 gpt-4, claude-3)"
                  value={manualAgentForm.model}
                  onChange={e => setManualAgentForm({ ...manualAgentForm, model: e.target.value })}
                />
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={async () => {
                    if (!manualAgentForm.name.trim()) return message.warning("请输入 Agent 名称");
                    await store.createAgent(
                      currentProject!.id,
                      manualAgentForm.name,
                      manualAgentForm.prompt,
                      manualAgentForm.model,
                    );
                    setManualAgentForm({ name: "", prompt: "", model: "" });
                  }}
                >
                  创建手填 Agent
                </Button>
              </Space>
            </div>
          ),
        }]}
      />
    </div>
  );

  // ─────────── Tab 2:任务清单 (Teambition 风格:按状态分组的纵向列表) ───────────
  const renderTaskRow = (task: Task) => {
    const agent = task.assigned_agent_id ? agents.find(a => a.id === task.assigned_agent_id) : null;
    const cfg = STATUS_CONFIG[task.status];
    const hasOutput = !!(task.output || task.agent_output);
    const outputContent = task.output || task.agent_output || "";
    return (
      <Card key={task.id} size="small" style={{ marginBottom: 8 }} hoverable>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Tag color={cfg.color} icon={cfg.icon} style={{ minWidth: 88, textAlign: "center", margin: 0 }}>
            {cfg.label}
          </Tag>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Space size={6}>
              <Text strong style={{ fontSize: 14 }}>{task.title}</Text>
              {hasOutput && (
                <Button
                  type="link"
                  size="small"
                  icon={<FileTextOutlined />}
                  style={{ padding: 0, height: "auto", fontSize: 12 }}
                  onClick={() => setOutputModal({ title: task.title, content: outputContent })}
                >
                  查看输出
                </Button>
              )}
              {task.status === "doing" && (
                <Tag icon={<SyncOutlined spin />} color="processing" style={{ margin: 0, fontSize: 11 }}>
                  执行中
                </Tag>
              )}
            </Space>
            {task.description && (
              <Paragraph type="secondary" ellipsis={{ rows: 1 }} style={{ fontSize: 12, margin: "2px 0 0" }}>
                {task.description}
              </Paragraph>
            )}
          </div>
          <div style={{ minWidth: 140 }}>
            {agent ? (
              <Space>
                <Avatar size={22} style={{ backgroundColor: AGENT_COLORS[agents.indexOf(agent) % AGENT_COLORS.length] }}>
                  {agent.name[0]}
                </Avatar>
                <Text style={{ fontSize: 12 }}>{agent.name}</Text>
              </Space>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>未分配</Text>
            )}
          </div>
          <Space size={4}>
            {/* 重试(doing / waiting 状态) */}
            {(task.status === "doing" || task.status === "waiting") && task.assigned_agent_id && (
              <Button
                size="small"
                icon={<SyncOutlined />}
                onClick={() => {
                  message.info("已重新触发执行");
                  store.retryTask(task.id);
                }}
              >
                重试
              </Button>
            )}
            {/* 改状态 */}
            <Dropdown
              menu={{
                items: Object.entries(STATUS_CONFIG)
                  .filter(([k]) => k !== task.status)
                  .map(([k, v]) => ({ key: k, label: <Space>{v.icon}{v.label}</Space> })),
                onClick: ({ key }) => store.updateTaskStatus(task.id, key),
              }}
              trigger={["click"]}
            >
              <Button size="small">改状态</Button>
            </Dropdown>
            {/* 分配 / 重新分配 */}
            {agents.length > 0 && (
              <Dropdown
                menu={{
                  items: agents.map(a => ({ key: a.id, label: a.name })),
                  onClick: ({ key }) => store.assignTask(task.id, key),
                }}
                trigger={["click"]}
              >
                <Button size="small" icon={<UserOutlined />}>
                  {agent ? "换 Agent" : "分配"}
                </Button>
              </Dropdown>
            )}
            {/* review 通过/驳回 */}
            {task.status === "review" && (
              <>
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={() => store.reviewTask(task.id, true)}
                >
                  通过
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<ExclamationCircleOutlined />}
                  onClick={() => store.reviewTask(task.id, false)}
                >
                  驳回
                </Button>
              </>
            )}
            <Dropdown
              menu={{
                items: [{ key: "del", label: "删除", icon: <DeleteOutlined />, danger: true }],
                onClick: () => {
                  Modal.confirm({
                    title: `删除任务 "${task.title}"?`,
                    onOk: () => store.deleteTask(task.id),
                  });
                },
              }}
              trigger={["click"]}
            >
              <Button type="text" size="small" icon={<DeleteOutlined />} />
            </Dropdown>
          </Space>
        </div>
      </Card>
    );
  };

  const orderedStatuses: Array<keyof typeof STATUS_CONFIG> = ["todo", "doing", "waiting", "review", "done"];
  const tasksByStatus = useMemo(() => {
    const m: Record<string, Task[]> = { todo: [], doing: [], waiting: [], review: [], done: [] };
    for (const t of tasks) (m[t.status] ||= []).push(t);
    return m;
  }, [tasks]);

  const taskTabContent = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Text type="secondary">本项目共 <Text strong>{tasks.length}</Text> 个任务</Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewTaskOpen(true)}>
          新建任务
        </Button>
      </div>
      {tasks.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有任务,点右上角「新建任务」开始"
          style={{ padding: "60px 0" }}
        />
      ) : (
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          {orderedStatuses.map(status => {
            const list = tasksByStatus[status] || [];
            const cfg = STATUS_CONFIG[status];
            return (
              <div key={status}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag>
                  <Badge count={list.length} showZero color="#d9d9d9" />
                </div>
                {list.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12, paddingLeft: 8 }}>无</Text>
                ) : (
                  list.map(renderTaskRow)
                )}
              </div>
            );
          })}
        </Space>
      )}
    </div>
  );

  // ─────────── 主内容 ───────────
  const content = currentProject ? (
    <Content style={{ padding: 16, overflow: "auto" }}>
      <div style={{ marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>{currentProject.name}</Title>
        <Text type="secondary">{currentProject.description || "—"}</Text>
      </div>
      {statsBar}
      <Tabs
        defaultActiveKey="agents"
        items={[
          {
            key: "agents",
            label: <Space><TeamOutlined />Agent 员工<Badge count={agents.length} showZero color="#d9d9d9" /></Space>,
            children: agentTabContent,
          },
          {
            key: "tasks",
            label: <Space><ProjectOutlined />任务清单<Badge count={tasks.length} showZero color="#d9d9d9" /></Space>,
            children: taskTabContent,
          },
        ]}
      />
    </Content>
  ) : (
    <Content style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Empty description="请选择或创建一个项目" image={Empty.PRESENTED_IMAGE_SIMPLE}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewProjectOpen(true)}>创建项目</Button>
      </Empty>
    </Content>
  );

  return (
    <Layout style={{ height: "100vh" }}>
      {sider}
      {content}

      {/* 新建项目弹窗 */}
      <Modal
        title="新建项目"
        open={newProjectOpen}
        onOk={async () => {
          if (!projectForm.name.trim()) return message.warning("请输入项目名称");
          await store.createProject(projectForm.name, projectForm.desc);
          setNewProjectOpen(false);
          setProjectForm({ name: "", desc: "" });
        }}
        onCancel={() => setNewProjectOpen(false)}
      >
        <Input
          placeholder="项目名称"
          value={projectForm.name}
          onChange={e => setProjectForm({ ...projectForm, name: e.target.value })}
          style={{ marginBottom: 8 }}
        />
        <TextArea
          placeholder="项目描述"
          rows={3}
          value={projectForm.desc}
          onChange={e => setProjectForm({ ...projectForm, desc: e.target.value })}
        />
      </Modal>

      {/* 引入本地 Agent 弹窗 */}
      <ImportLocalAgentModal
        open={importLocalOpen}
        onClose={() => setImportLocalOpen(false)}
        onImport={async (cli) => {
          try {
            await store.importLocalAgent(cli);
            message.success(`已引入 ${CLI_LABELS[cli.type]?.label || cli.type}`);
          } catch (e: any) {
            message.error(e?.toString() || "引入失败");
            throw e;
          }
        }}
        alreadyImported={new Set(agents.filter(a => a.cli_type).map(a => a.cli_type!))}
      />

      {/* 新建任务弹窗 */}
      <Modal
        title="新建任务"
        open={newTaskOpen}
        onOk={async () => {
          if (!taskForm.title.trim()) return message.warning("请输入任务标题");
          await store.createTask(currentProject!.id, taskForm.title, taskForm.desc);
          setNewTaskOpen(false);
          setTaskForm({ title: "", desc: "" });
        }}
        onCancel={() => setNewTaskOpen(false)}
      >
        <Input
          placeholder="任务标题"
          value={taskForm.title}
          onChange={e => setTaskForm({ ...taskForm, title: e.target.value })}
          style={{ marginBottom: 8 }}
        />
        <TextArea
          placeholder="任务描述"
          rows={4}
          value={taskForm.desc}
          onChange={e => setTaskForm({ ...taskForm, desc: e.target.value })}
        />
      </Modal>

      {/* 查看任务输出弹窗 */}
      <Modal
        title={outputModal?.title || "任务输出"}
        open={!!outputModal}
        onCancel={() => setOutputModal(null)}
        footer={<Button onClick={() => setOutputModal(null)}>关闭</Button>}
        width={720}
      >
        <pre style={{
          background: "#fafafa",
          padding: 12,
          borderRadius: 6,
          maxHeight: 480,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}>{outputModal?.content}</pre>
      </Modal>
    </Layout>
  );
}

// ─────────── 引入本地 Agent 弹窗 ───────────
function ImportLocalAgentModal(props: {
  open: boolean;
  onClose: () => void;
  onImport: (cli: LocalAgentInfo) => Promise<void>;
  alreadyImported: Set<string>;
}) {
  const { open, onClose, onImport, alreadyImported } = props;
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<LocalAgentInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [proxyOnline, setProxyOnline] = useState<boolean | null>(null);
  const [importing, setImporting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const data = await useWorkerStore.getState().discoverLocalAgents();
      setList(data);
      setProxyOnline(data.length > 0 || true); // 即便为空也可能是探测完没找到
    } catch (e) {
      setProxyOnline(false);
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const handleOk = async () => {
    if (selected.size === 0) return message.warning("请至少勾选一个");
    setImporting(true);
    try {
      for (const cli of list) {
        if (selected.has(cli.type)) {
          await onImport(cli);
        }
      }
      onClose();
    } catch {
      // 单个失败已 message.error,这里不重复
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <ApiOutlined />
          引入本地 Agent
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText={`导入选中 (${selected.size})`}
      confirmLoading={importing}
      width={640}
    >
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Text type="secondary">扫描本机已安装的 CLI:claude-code / hermes / opencode</Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
          重新探测
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
      ) : list.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="未发现本地 CLI"
          description={
            <div>
              <div>确保本机已安装 <Text code>claude</Text> / <Text code>hermes</Text> / <Text code>opencode</Text>,且 agent-proxy 在 127.0.0.1:9099 在线。</div>
              <div style={{ marginTop: 8, fontSize: 12 }}>也可以在 Tab 1 的「高级模式」手填 Agent。</div>
            </div>
          }
        />
      ) : (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          {list.map(cli => {
            const meta = CLI_LABELS[cli.type] || { label: cli.type, color: "#666" };
            const imported = alreadyImported.has(cli.type);
            const checked = selected.has(cli.type);
            return (
              <Card
                key={cli.type}
                size="small"
                style={{
                  borderColor: checked ? "#1677ff" : undefined,
                  background: imported ? "#fafafa" : checked ? "#e6f4ff" : undefined,
                  opacity: imported ? 0.6 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Checkbox
                    disabled={imported || !cli.available}
                    checked={checked || imported}
                    onChange={e => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(cli.type);
                      else next.delete(cli.type);
                      setSelected(next);
                    }}
                  />
                  <Tag color={meta.color} style={{ minWidth: 110, textAlign: "center", margin: 0 }}>
                    {meta.label}
                  </Tag>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>
                      <Text code style={{ fontSize: 12 }}>{cli.command}</Text>
                      {cli.version && <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>v{cli.version}</Text>}
                      {imported && <Tag color="green" style={{ marginLeft: 8, fontSize: 11 }}>已挂载</Tag>}
                      {!cli.available && <Tag color="red" style={{ marginLeft: 8, fontSize: 11 }}>未安装</Tag>}
                    </div>
                    {cli.path && (
                      <Text type="secondary" ellipsis style={{ fontSize: 11, display: "block" }}>{cli.path}</Text>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </Space>
      )}
    </Modal>
  );
}
