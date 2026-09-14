// The dialog's instant answer to "is this a link or a name?" and the ⌘V shortcut. A mirror of clone.rs
// `parse_repo_url`; the backend parses again before it runs anything, and both test files use the same table.
import type { RepoRef } from "./types";

/** First path segments on github.com that are pages, not owners. */
const RESERVED = new Set(["about", "apps", "codespaces", "collections", "dashboard", "enterprise", "explore", "features", "issues", "join", "login", "logout", "marketplace", "new", "notifications", "organizations", "orgs", "pricing", "pulls", "search", "settings", "sponsors", "topics", "trending", "users"]);

const validName = (s: string) => s !== "." && s !== ".." && /^[A-Za-z0-9._-]+$/.test(s);
const stripGit = (s: string) => (s.endsWith(".git") ? s.slice(0, -4) : s);
const github = (owner: string, repo: string, treePath: string | null = null): RepoRef =>
  ({ host: "github.com", owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git`, ssh: false, treePath, fromCommand: false });

export function parseRepoLink(input: string): RepoRef | null {
  const t = input.trim().replace(/^[<>"']+|[<>"']+$/g, "");
  if (!t) return null;
  if (t.startsWith("gh repo clone ")) {
    const target = t.slice("gh repo clone ".length).trim().split(/\s+/)[0] ?? "";
    let r: RepoRef | null = null;
    if (target.includes(".") && (target.includes("github.com") || target.startsWith("git@"))) r = parseRepoLink(target);
    else {
      const i = target.indexOf("/");
      if (i < 0) return null;
      const owner = target.slice(0, i), repo = stripGit(target.slice(i + 1));
      if (validName(owner) && validName(repo)) r = github(owner, repo);
    }
    return r ? { ...r, fromCommand: true } : null;
  }
  if (/\s/.test(t)) return null;
  if (t.startsWith("git@")) {
    const rest = t.slice(4);
    const c = rest.indexOf(":");
    if (c < 0) return null;
    const host = rest.slice(0, c).toLowerCase();
    const path = stripGit(rest.slice(c + 1).replace(/\/+$/, ""));
    const k = path.lastIndexOf("/");
    if (k < 0) return null;
    const owner = path.slice(0, k), repo = path.slice(k + 1);
    if (!host || !validName(repo) || owner.split("/").some((x) => !validName(x))) return null;
    return { host, owner, repo, cloneUrl: `git@${host}:${owner}/${repo}.git`, ssh: true, treePath: null, fromCommand: false };
  }
  const https = t.startsWith("https://");
  const rest = (https ? t.slice(8) : t.startsWith("http://") ? t.slice(7) : t).split(/[?#]/)[0] ?? "";
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  let host = rest.slice(0, slash).toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  const segs = rest.slice(slash + 1).split("/").filter(Boolean);
  if (host === "github.com") {
    if (segs.length < 2) return null;
    const owner = segs[0]!, repo = stripGit(segs[1]!);
    if (RESERVED.has(owner.toLowerCase()) || !validName(owner) || !validName(repo)) return null;
    return github(owner, repo, segs.length > 3 && segs[2] === "tree" ? segs.slice(3).join("/") : null);
  }
  // Any other host counts only as an https address that says it is a git repository.
  if (!https || segs.length < 2) return null;
  const last = segs[segs.length - 1]!;
  if (!last.endsWith(".git")) return null;
  const repo = last.slice(0, -4), ownerSegs = segs.slice(0, -1);
  if (!validName(repo) || ownerSegs.some((x) => !validName(x))) return null;
  return { host, owner: ownerSegs.join("/"), repo, cloneUrl: `https://${host}/${segs.join("/")}`, ssh: false, treePath: null, fromCommand: false };
}

/** The same repository over https: what "Use the web link instead" pastes for an SSH link. */
export const webLinkOf = (r: RepoRef) => (r.host === "github.com" ? `https://github.com/${r.owner}/${r.repo}` : `https://${r.host}/${r.owner}/${r.repo}.git`);

/** Something shaped like a web address that is not a repository, so the dialog can say so instead of offering it as a name:
 *  a scheme, an SSH address, or a host followed by a path. A bare domain ("bakery.com") is a fine site name, and people often
 *  name a site after its domain. */
export const looksLikeAddress = (s: string) => {
  const t = s.trim();
  return /:\/\/|^git@/i.test(t) || /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S/i.test(t);
};
