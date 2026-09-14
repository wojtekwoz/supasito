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
  /** The repository this site was downloaded from (PLAN §8e.11); only such a site gets git push as its default Publish. */
  clonedFrom?: string | null;
  /** The remote's default branch, for Publish's git push. */
  defaultBranch?: string | null;
  /** Keys an example env file lists that no real env file sets. */
  envMissing?: string[];
  /** What the project's own Claude settings would run by themselves: hook commands and MCP servers. */
  claudeExtras?: { commands: number; mcpServers: number } | null;
  /** "ask": a pasted repository brought such settings, and the folder isn't trusted until the user says so; "declined". */
  claudeTrust?: "ask" | "declined" | null;
};

export type SessionInfo = {
  id: string;
  title: string;
  lastModified: number;
  createdAt?: number | null;
  gitBranch?: string | null;
  messageCount: number;
  /** The backend sessions behind this row, oldest first, when the conversation changed agent (PLAN §8d.2): each with
   *  the model it started on. Absent or empty for a plain session. */
  chain?: ChainStep[];
};
export type ChainStep = { id: string; model?: string | null };

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
/** Codex CLI, the optional second backend; `loggedIn` from `codex login status`. */
export type CodexStatus = Tool & { loggedIn?: boolean | null };
export type Toolchain = { claude: ClaudeStatus; codex?: CodexStatus | null; node: Tool; git: Tool; packageManager: (Tool & { name: string; path: string }) | null; hasBrew?: boolean; gitIdentity?: boolean };
/** `hidden` lists the interface elements switched off in Settings → Interface (keys in src/app/ui.ts).
 *  `updatesEnabled` is the once-a-day check for a newer Supasito, on unless Settings → Updates turns it off. */
export type Settings = { claudePath?: string | null; model?: string | null; permissionMode?: string | null; effort?: string | null; fastMode?: boolean | null; hidden?: string[] | null; updatesEnabled?: boolean | null;
  /** Where new and pasted sites go; null until the first one, when the dialog suggests `defaultSitesFolder` (~/Sites). */
  sitesFolder?: string | null; defaultSitesFolder?: string | null };

/** One fetched model (models.rs `Model`): `backend` says which CLI runs it; `efforts` empty = the backend's fixed list. */
export type CatalogueModel = { id: string; label: string; hint?: string; backend?: "claude" | "codex" | string; isDefault?: boolean; efforts?: string[]; defaultEffort?: string | null; fast?: boolean; hidden?: boolean };
/** What the backend fetched and when (ms since the epoch, 0 = never): Codex's list from `model/list`, the served models.json rows. */
export type Catalogue = { codex: CatalogueModel[]; codexAt: number; served: CatalogueModel[]; servedAt: number };

/** A newer Supasito, as a check found it. `notes` is the release body; `date` its publish date. */
export type UpdateInfo = { version: string; current: string; notes?: string | null; date?: string | null };
/** Per-session choices Supasito passes when it starts or restarts the claude process; unset = the Settings default. */
export type SessionOverrides = { model?: string | null; effort?: string | null; fastMode?: boolean | null;
  /** The conversation so far, when this session continues one that ran on the other agent; sent once, with the first start. */
  handoff?: string | null;
  /** The session this one continues; the backend records the link in the site as it mints the new id. */
  continues?: string | null };
/** A pasted repository link (clone.rs `RepoRef`, mirrored by src/repo.ts). `treePath` is everything after `/tree/` in a GitHub link. */
export type RepoRef = { host: string; owner: string; repo: string; cloneUrl: string; ssh: boolean; treePath: string | null; fromCommand: boolean };
/** GitHub's public card for a repository; absent for a private one, another host, or when the API did not answer. */
export type RepoInfo = { description?: string | null; private?: boolean | null; sizeKb?: number | null; defaultBranch?: string | null; language?: string | null };
/** What the dialog knows before anything downloads: the card, whether you already have it, and where a clone would go. */
/** GitHub's description and size come separately (`siteRepoInfo`), so the card never waits for them. */
export type RepoLookup = { repo: RepoRef; existingSiteId?: string | null; existingPath?: string | null; existingConversations?: number; dest?: string | null };
/** Where a site stands against its remote (remote.rs `SyncStatus`). `behind` is how many commits came in for "updated". */
export type SyncStatus = { state: "none" | "current" | "updated" | "behind" | "failed"; ahead: number; behind: number; branch?: string | null; files: string[]; depsChanged: boolean; detail?: string | null };
/** A key an example env file lists and no real env file sets; `value` is the example's when it looks real. */
export type EnvKey = { name: string; hint?: string | null; value?: string | null };
export type EnvNeeds = { example: string; file: string; keys: EnvKey[] };
export type CloneErrorKind = "private" | "missing" | "offline" | "ssh" | "branch" | "folder" | "disk" | "nogit" | "link" | "busy" | "cancelled" | "other";
/** `detail` is git's own last line; `signIn` says this build can offer Sign in to GitHub. */
export type CloneError = { kind: CloneErrorKind; detail?: string | null; signIn?: boolean };
/** `clone://progress`: check (asking the remote), download (`percent` 0…1), install. */
export type CloneProgress = { phase: "check" | "download" | "install"; percent?: number | null; amount?: string | null; line?: string | null };
export type DeviceCode = { userCode: string; verificationUri: string; interval: number; expiresIn: number };
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
  | "clone://progress"
  | "update://available"
  | "update://progress";
