export type Site = {
  id: string;
  path: string;
  name: string;
  dev?: string | null;
  publish?: string | null;
  preview?: string | null;
  lastSessionId?: string | null;
  lastPort?: number | null;
  packageManager?: string | null;
  framework?: string | null;
  isGit: boolean;
  needsInstall: boolean;
};

export type SessionInfo = {
  id: string;
  title: string;
  lastModified: number;
  createdAt?: number | null;
  gitBranch?: string | null;
  messageCount: number;
};

export type DevStatus = "starting" | "ready" | "error" | "stopped";
export type DevInfo = { siteId: string; port: number; url: string; status: DevStatus; command: string };

export type Selection = {
  page: string;
  tag: string;
  id: string;
  classes: string[];
  text: string;
  selector: string;
  rect: { x: number; y: number; w: number; h: number };
  styles: Record<string, string>;
  outerHtml: string;
  source?: { file: string; loc: string } | null;
  react?: { components: string[] } | null;
};

export type PermissionRequest = {
  sessionId: string;
  requestId: string;
  request: {
    subtype: string;
    tool_name: string;
    display_name?: string;
    input: Record<string, unknown>;
    description?: string;
    permission_suggestions?: unknown[];
    tool_use_id?: string;
  };
};

export type Attachment = { id: string; name: string; mediaType: string; data: string; size: number };

export type GitStatus = { isGit: boolean; changed: number; files: string[]; branch?: string | null; remote?: string | null };
export type PublishTarget = "preview" | "production";
export type ClaudeStatus = { ok: boolean; path?: string; version?: string };
export type Settings = { claudePath?: string | null; model?: string | null; permissionMode?: string | null };
export type PublishResult = { ok: boolean; code?: number | null; url?: string | null; log: string[] };

export type EventName =
  | "agent://message"
  | "agent://permission"
  | "agent://exit"
  | "agent://stderr"
  | "dev://status"
  | "dev://log"
  | "publish://log"
  | "install://log";
