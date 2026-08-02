import { useEffect, useState } from "react";
import {
  Layout, Card, Button, Modal, Input, Tag, Avatar, Progress, Empty,
  Row, Col, Space, Typography, Dropdown, message, Tabs, Tooltip, Badge,
} from "antd";
import {
  PlusOutlined, DeleteOutlined, CopyOutlined, UserOutlined,
  ProjectOutlined, TeamOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined, PlayCircleOutlined, PauseCircleOutlined,
  EyeOutlined, SettingOutlined,
} from "@ant-design/icons";
import { useWorkerStore } from "./stores/workerStore";
import type { Agent, Task } from "./types";

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

const AGENT_COLORS = ["#1677ff", "#52c41a", "#faad14", "#eb2f96", "#722ed1", "#13c2c2"];

export default function App() {
  const store = useWorkerStore();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [projectForm, setProjectForm] = useState({ name: "", desc: "" });
  const [agentForm, setAgentForm] = useState({ name: "", prompt: "", model: "" });
  const [taskForm, setTaskForm] = useState({ title: "", desc: "" });

  useEffect(() => { store.loadProjects(); }, []);

  const currentProject = store.projects.find(p => p.id === store.currentProjectId);

  // 项目列表侧栏
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

  // 看板列
  const renderColumn = (status: string) => {
    const cfg = STATUS_CONFIG[status];
    const tasks = store.tasks.filter(t => t.status === status);
    return (
      <div style={{ flex: 1, minWidth: 200, background: "#fafafa", borderRadius: 8, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Space><Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag><Badge count={tasks.length} /></Space>
        </div>
        {tasks.map(task => {
          const agent = task.assigned_agent_id ? store.agents.find(a => a.id === task.assigned_agent_id) : null;
          return (
            <Card key={task.id} size="small" style={{ marginBottom: 8 }} hoverable>
              <Text strong style={{ fontSize: 13 }}>{task.title}</Text>
              {task.description && <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ fontSize: 12, margin: "4px 0" }}>{task.description}</Paragraph>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                {agent ? (
                  <Tooltip title={agent.name}>
                    <Avatar size={20} style={{ backgroundColor: AGENT_COLORS[store.agents.indexOf(agent) % AGENT_COLORS.length] }}>
                      {agent.name[0]}
                    </Avatar>
                  </Tooltip>
                ) : <span />}
                <Space size={4}>
                  {task.status === "review" && (
                    <>
                      <Button size="small" type="primary" icon={<CheckCircleOutlined />}
                        onClick={() => store.reviewTask(task.id, true)}>通过</Button>
                      <Button size="small" danger icon={<ExclamationCircleOutlined />}
                        onClick={() => store.reviewTask(task.id, false)}>驳回</Button>
                    </>
                  )}
                  {!task.assigned_agent_id && task.status === "todo" && store.agents.length > 0 && (
                    <Dropdown menu={{
                      items: store.agents.map(a => ({ key: a.id, label: a.name })),
                      onClick: ({ key }) => store.assignTask(task.id, key),
                    }} trigger={["click"]}>
                      <Button size="small" icon={<UserOutlined />}>分配</Button>
                    </Dropdown>
                  )}
                  <Dropdown menu={{
                    items: [{ key: "del", label: "删除", danger: true }],
                    onClick: () => store.deleteTask(task.id),
                  }} trigger={["contextMenu"]}>
                    <Button type="text" size="small" icon={<SettingOutlined />} />
                  </Dropdown>
                </Space>
              </div>
            </Card>
          );
        })}
      </div>
    );
  };

  // 主内容
  const content = currentProject ? (
    <Content style={{ padding: 16, overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{currentProject.name}</Title>
          <Text type="secondary">{currentProject.description}</Text>
        </div>
        <Space>
          <Button icon={<TeamOutlined />} onClick={() => setNewAgentOpen(true)}>添加Agent</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewTaskOpen(true)}>新建任务</Button>
        </Space>
      </div>

      {/* 统计条 */}
      {store.stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card size="small"><Text type="secondary">总任务</Text><br/><Text strong style={{ fontSize: 24 }}>{store.stats.tasks.total}</Text></Card></Col>
          <Col span={6}><Card size="small"><Text type="secondary">进行中</Text><br/><Text strong style={{ fontSize: 24, color: "#1677ff" }}>{store.stats.tasks.doing}</Text></Card></Col>
          <Col span={6}><Card size="small"><Text type="secondary">Agent</Text><br/><Text strong style={{ fontSize: 24 }}>{store.stats.agents.total}</Text></Card></Col>
          <Col span={6}><Card size="small"><Text type="secondary">完成率</Text><br/><Progress percent={store.stats.tasks.total > 0 ? Math.round(store.stats.tasks.done / store.stats.tasks.total * 100) : 0} size="small" /></Card></Col>
        </Row>
      )}

      {/* Agent栏 */}
      {store.agents.length > 0 && (
        <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {store.agents.map((agent, i) => (
            <Card key={agent.id} size="small" style={{ width: 180 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar style={{ backgroundColor: AGENT_COLORS[i % AGENT_COLORS.length] }}>{agent.name[0]}</Avatar>
                <div style={{ flex: 1 }}>
                  <Text strong ellipsis style={{ display: "block", fontSize: 13 }}>{agent.name}</Text>
                  <Tag color={agent.status === "working" ? "processing" : agent.status === "idle" ? "default" : "error"} style={{ fontSize: 11 }}>
                    {agent.status === "working" ? "工作中" : agent.status === "idle" ? "空闲" : "离线"}
                  </Tag>
                </div>
                <Dropdown menu={{
                  items: [
                    { key: "clone", label: "克隆", icon: <CopyOutlined /> },
                    { key: "del", label: "删除", icon: <DeleteOutlined />, danger: true },
                  ],
                  onClick: ({ key }) => {
                    if (key === "del") store.deleteAgent(agent.id);
                    if (key === "clone") store.cloneAgent(currentProject.id, agent.id, "");
                  },
                }} trigger={["click"]}>
                  <Button type="text" size="small" icon={<SettingOutlined />} />
                </Dropdown>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 看板 */}
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
        {["todo", "doing", "waiting", "review", "done"].map(renderColumn)}
      </div>
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
      <Modal title="新建项目" open={newProjectOpen} onOk={async () => {
        if (!projectForm.name.trim()) return message.warning("请输入项目名称");
        await store.createProject(projectForm.name, projectForm.desc);
        setNewProjectOpen(false); setProjectForm({ name: "", desc: "" });
      }} onCancel={() => setNewProjectOpen(false)}>
        <Input placeholder="项目名称" value={projectForm.name} onChange={e => setProjectForm({ ...projectForm, name: e.target.value })} style={{ marginBottom: 8 }} />
        <TextArea placeholder="项目描述" rows={3} value={projectForm.desc} onChange={e => setProjectForm({ ...projectForm, desc: e.target.value })} />
      </Modal>

      {/* 新建Agent弹窗 */}
      <Modal title="添加Agent" open={newAgentOpen} onOk={async () => {
        if (!agentForm.name.trim()) return message.warning("请输入Agent名称");
        await store.createAgent(currentProject!.id, agentForm.name, agentForm.prompt, agentForm.model);
        setNewAgentOpen(false); setAgentForm({ name: "", prompt: "", model: "" });
      }} onCancel={() => setNewAgentOpen(false)}>
        <Input placeholder="Agent名称" value={agentForm.name} onChange={e => setAgentForm({ ...agentForm, name: e.target.value })} style={{ marginBottom: 8 }} />
        <TextArea placeholder="系统提示词" rows={4} value={agentForm.prompt} onChange={e => setAgentForm({ ...agentForm, prompt: e.target.value })} style={{ marginBottom: 8 }} />
        <Input placeholder="模型 (如 gpt-4, claude-3)" value={agentForm.model} onChange={e => setAgentForm({ ...agentForm, model: e.target.value })} />
      </Modal>

      {/* 新建任务弹窗 */}
      <Modal title="新建任务" open={newTaskOpen} onOk={async () => {
        if (!taskForm.title.trim()) return message.warning("请输入任务标题");
        await store.createTask(currentProject!.id, taskForm.title, taskForm.desc);
        setNewTaskOpen(false); setTaskForm({ title: "", desc: "" });
      }} onCancel={() => setNewTaskOpen(false)}>
        <Input placeholder="任务标题" value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} style={{ marginBottom: 8 }} />
        <TextArea placeholder="任务描述" rows={4} value={taskForm.desc} onChange={e => setTaskForm({ ...taskForm, desc: e.target.value })} />
      </Modal>
    </Layout>
  );
}
