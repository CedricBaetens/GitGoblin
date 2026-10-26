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
  ahead?: number;
  behind?: number;
  upstreamGone?: boolean;
}
export interface Snapshot {
  root: string;
  repositoryRoot?: string;
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
  files?: { path: string; fingerprint?: string }[];
}
export interface T3ModelSelection {
  instanceId: string;
  model: string;
  options?: { id: string; value: string | boolean }[];
}
export type T3ModelOption = {
  id: string;
  label: string;
  description?: string;
} & ({ type: 'select'; currentValue?: string; options: { id: string; label: string; description?: string; isDefault?: boolean }[] }
  | { type: 'boolean'; currentValue?: boolean });
export interface T3ModelProvider {
  instanceId: string;
  displayName?: string;
  enabled?: boolean;
  installed?: boolean;
  models: { slug: string; name: string; capabilities?: { optionDescriptors?: T3ModelOption[] } | null }[];
}
export interface T3Project {
  id: string;
  title?: string;
  name?: string;
  workspaceRoot: string;
  defaultModelSelection?: T3ModelSelection | null;
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
  modelSelection: T3ModelSelection;
  runtimeMode: string;
  interactionMode: string;
}
export interface T3ImageAttachment {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}
export interface T3Message {
  id: string;
  runId?: string | null;
  turnId?: string | null;
  updatedAt?: string;
  role: string;
  text: string;
  streaming: boolean;
  createdAt: string;
  attachments?: T3ImageAttachment[];
}
export interface T3Request {
  id: string;
  kind: string;
  status: string;
  responseCapability: { type: string; reason?: string };
}
export interface T3Skill {
  name: string;
  description?: string;
  shortDescription?: string;
  displayName?: string;
  path: string;
  enabled: boolean;
  userInvocable?: boolean;
}
export interface T3Question {
  id: string;
  header: string;
  question: string;
  options: { label: string; description?: string; value?: string }[];
  multiSelect?: boolean;
  allowCustomAnswer?: boolean;
  initialAnswer?: string;
  required?: boolean;
}
export interface T3QuestionRequest {
  id: string;
  questions: T3Question[];
  unavailableReason?: string;
}
export interface T3Run {
  id: string;
  userMessageId: string;
  status: string;
  queuePosition?: number | null;
  queueHeld?: boolean;
  startedAt?: string | null;
}
export interface T3Subagent {
  id: string;
  runId?: string | null;
  title?: string | null;
  prompt?: string;
  status: string;
  model?: string | null;
  modelSelection?: T3ModelSelection;
  progress?: string;
  result?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string;
}
export interface T3Projection {
  subagents?: T3Subagent[];
  runs?: T3Run[];
  thread: T3Thread;
  messages: T3Message[];
  runtimeRequests: T3Request[];
  turnItems: Record<string, unknown>[];
  activities?: T3Activity[];
}
export interface T3Activity {
  id: string;
  kind: string;
  summary: string;
  tone: string;
  turnId: string | null;
  createdAt: string;
  payload?: { toolCallId?: string; status?: string; title?: string; requestId?: string; questions?: T3Question[]; responseMode?: string };
}
