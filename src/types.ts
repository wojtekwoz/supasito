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
  /** Starred in the rail (app state, not supasito.json). */
  favorite?: boolean;
  /** Last selected, ms since the epoch; 0 or missing for sites from before the switcher. */
  lastOpened?: number;
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
/** The process listening on a port, as `lsof`/`ps` see it; `siteId` when it is another site's dev server. */
export type PortHolder = { pid: number; pgid: number; name: string; command: string; cwd?: string | null; siteId?: string | null };
/** Why a dev server is in `error`, when the backend knows more than the log tail shows. */
export type DevProblem = { kind: "port"; port: number; holder?: PortHolder | null };
export type DevInfo = { siteId: string; port: number; url: string; status: DevStatus; command: string; problem?: DevProblem | null };

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
export type Tool = { ok: boolean; path?: string | null; version?: string | null };
/** `loggedIn` comes from `claude auth status`; null when the CLI is too old to answer. */
/** The user's own defaults from `~/.claude/settings.json` (`model`, `effortLevel`), so "your Claude Code default" can say what it is. */
export type ClaudeDefaults = { model?: string | null; effort?: string | null };
export type ClaudeStatus = Tool & { loggedIn?: boolean | null; authMethod?: string | null; defaults?: ClaudeDefaults | null };
/** What this Mac has. `packageManager` is the one New site will use: pnpm if present, else npm.
 *  `hasBrew` decides whether the checklist offers `brew install …`; `gitIdentity` is false when
 *  `git config user.email` is unset, which would otherwise only surface as a failed Publish. */
export type Toolchain = { claude: ClaudeStatus; node: Tool; git: Tool; packageManager: (Tool & { name: string; path: string }) | null; hasBrew?: boolean; gitIdentity?: boolean };
/** `hidden` lists the interface elements switched off in Settings → Interface (keys in src/app/ui.ts).
 *  `updatesEnabled` is the once-a-day check for a newer Supasito, on unless Settings → Updates turns it off. */
export type Settings = { claudePath?: string | null; model?: string | null; permissionMode?: string | null; effort?: string | null; fastMode?: boolean | null; hidden?: string[] | null; updatesEnabled?: boolean | null };

/** A newer Supasito, as a check found it. `notes` is the release body; `date` its publish date. */
export type UpdateInfo = { version: string; current: string; notes?: string | null; date?: string | null };
/** Per-session choices Supasito passes when it starts or restarts the claude process; unset = the Settings default. */
export type SessionOverrides = { model?: string | null; effort?: string | null; fastMode?: boolean | null };
export type PublishResult = { ok: boolean; code?: number | null; url?: string | null; log: string[] };

export type RestoreReport = { restored: string[]; deleted: string[]; skipped: string[] };

export type EventName =
  | "agent://message"
  | "agent://permission"
  | "agent://exit"
  | "agent://stderr"
  | "agent://fs"
  | "agent://control_error"
  | "dev://status"
  | "dev://log"
  | "publish://log"
  | "install://log"
  | "update://available"
  | "update://progress";
