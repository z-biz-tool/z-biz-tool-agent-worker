export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  project_id: string;
  name: string;
  system_prompt: string;
  model: string;
  status: "idle" | "working" | "offline";
  current_task_id: string | null;
  /** "local" = 来自本地 CLI(claude-code / hermes / opencode), "manual" = 手填 */
  source: "local" | "manual";
  cli_type: string | null;
  local_agent_id: string | null;
  cli_version: string | null;
  cli_path: string | null;
  created_at: string;
  last_used_at: string;
}

export interface LocalAgentInfo {
  type: "claude-code" | "hermes" | "opencode" | string;
  command: string;
  path: string | null;
  available: boolean;
  version: string | null;
  registered: boolean;
  agent_id: string | null;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: "todo" | "doing" | "waiting" | "review" | "done";
  assigned_agent_id: string | null;
  assigned_agent_name?: string | null;
  parent_id: string | null;
  children: string[];
  /** agent 执行后的最终输出,Markdown / 纯文本 / JSON 都可能 */
  output: string | null;
  /** 同 output,保留字段名以兼容后端 model */
  agent_output?: string | null;
  /** 等待用户输入标记 */
  waiting_for_input?: boolean | null;
  /** Agent 附件 receipts */
  receipts?: unknown;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface TaskMessage {
  id: string;
  task_id: string;
  role: "user" | "agent";
  content: string;
  created_at: string;
}

export interface ProjectStats {
  tasks: { total: number; todo: number; doing: number; waiting: number; review: number; done: number };
  agents: { total: number; working: number; idle: number; offline: number };
}

export interface AppConfig {
  theme: string;
  default_model: string;
  api_url: string;
}
