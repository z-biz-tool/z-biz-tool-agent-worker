import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Project, Agent, Task, ProjectStats, AppConfig } from "../types";

interface WorkerState {
  projects: Project[];
  currentProjectId: string | null;
  agents: Agent[];
  tasks: Task[];
  stats: ProjectStats | null;
  config: AppConfig | null;

  loadProjects: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  createProject: (name: string, desc: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  createAgent: (projectId: string, name: string, prompt: string, model: string) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  cloneAgent: (projectId: string, sourceId: string, name: string) => Promise<void>;

  createTask: (projectId: string, title: string, desc: string, parentId?: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  assignTask: (taskId: string, agentId: string) => Promise<void>;
  reviewTask: (taskId: string, approved: boolean) => Promise<void>;

  loadConfig: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<void>;
}

export const useWorkerStore = create<WorkerState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  agents: [],
  tasks: [],
  stats: null,
  config: null,

  loadProjects: async () => {
    const projects = await invoke<Project[]>("list_projects");
    set({ projects });
  },

  selectProject: async (id) => {
    set({ currentProjectId: id });
    const [agents, tasks, stats] = await Promise.all([
      invoke<Agent[]>("list_agents", { projectId: id }),
      invoke<Task[]>("list_tasks", { projectId: id }),
      invoke<ProjectStats>("get_project_stats", { id }).catch(() => null),
    ]);
    set({ agents, tasks, stats });
  },

  createProject: async (name, desc) => {
    await invoke("create_project", { name, desc });
    await get().loadProjects();
  },

  deleteProject: async (id) => {
    await invoke("delete_project", { id });
    if (get().currentProjectId === id) set({ currentProjectId: null, agents: [], tasks: [], stats: null });
    await get().loadProjects();
  },

  createAgent: async (projectId, name, prompt, model) => {
    await invoke("create_agent", { projectId, name, prompt, model });
    await get().selectProject(projectId);
  },

  deleteAgent: async (id) => {
    await invoke("delete_agent", { id });
    const pid = get().currentProjectId;
    if (pid) await get().selectProject(pid);
  },

  cloneAgent: async (projectId, sourceId, name) => {
    await invoke("clone_agent", { projectId, sourceId, name });
    await get().selectProject(projectId);
  },

  createTask: async (projectId, title, desc, parentId) => {
    await invoke("create_task", { projectId, title, desc, parentId: parentId || null });
    await get().selectProject(projectId);
  },

  deleteTask: async (id) => {
    await invoke("delete_task", { id });
    const pid = get().currentProjectId;
    if (pid) await get().selectProject(pid);
  },

  assignTask: async (taskId, agentId) => {
    await invoke("assign_task", { taskId, agentId });
    const pid = get().currentProjectId;
    if (pid) await get().selectProject(pid);
  },

  reviewTask: async (taskId, approved) => {
    await invoke("review_task", { taskId, approved });
    const pid = get().currentProjectId;
    if (pid) await get().selectProject(pid);
  },

  loadConfig: async () => {
    const config = await invoke<AppConfig>("get_config");
    set({ config });
  },

  saveConfig: async (config) => {
    await invoke("save_config", { config });
    set({ config });
  },
}));
