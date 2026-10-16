export interface FileStatus {
  path: string;
  oldPath?: string;
  index: string;
  worktree: string;
  conflict: boolean;
}
export interface GitRef {
  name: string;
  id: string;
  current: boolean;
  upstream: string;
}
export interface Snapshot {
  root: string;
  branch: string;
  head: string;
  files: FileStatus[];
  refs: GitRef[];
  worktrees: { path: string; branch: string }[];
  operation: string;
  stashes: string;
  remotes: string;
}
export interface Commit {
  id: string;
  parents: string;
  author: string;
  date: string;
  refs: string;
  subject: string;
}
export interface Diff {
  text: string;
  fingerprint: string;
}
export interface GitRequest {
  repo: string;
  action: string;
  path?: string;
  target?: string;
  text?: string;
  mode?: string;
  fingerprint?: string;
  wholeFile?: boolean;
  offset?: number;
  limit?: number;
}
export interface T3Project {
  id: string;
  title?: string;
  name?: string;
  workspaceRoot: string;
  defaultModelSelection?: { instanceId: string; model: string } | null;
}
export interface T3Thread {
  settledOverride?: "settled" | "active" | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  createdAt?: string;
  unsettledAt?: string | null;
  pinnedAt?: string | null;
  pinOrderKey?: string | null;
  activeOrderKey?: string | null;
  id: string;
  projectId: string;
  title: string;
  branch: string | null;
  worktreePath: string | null;
  status: string;
  activeRunId: string | null;
  modelSelection: { instanceId: string; model: string };
  runtimeMode: string;
  interactionMode: string;
}
export interface T3Message {
  id: string;
  role: string;
  text: string;
  streaming: boolean;
  createdAt: string;
}
export interface T3Request {
  id: string;
  kind: string;
  status: string;
  responseCapability: { type: string; reason?: string };
}
export interface T3Projection {
  thread: T3Thread;
  messages: T3Message[];
  runtimeRequests: T3Request[];
  turnItems: Record<string, unknown>[];
}
