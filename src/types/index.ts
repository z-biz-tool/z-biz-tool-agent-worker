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
  created_at: string;
  last_used_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: "todo" | "doing" | "waiting" | "review" | "done";
  assigned_agent_id: string | null;
  parent_id: string | null;
  children: string[];
  created_at: string;
  updated_at: string;
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
