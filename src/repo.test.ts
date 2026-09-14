// The same table as clone.rs `reads_what_people_copy` and `names_and_other_pages_are_not_links`.
import assert from "node:assert/strict";
import { looksLikeAddress, parseRepoLink, webLinkOf } from "./repo.ts";

const plain = { host: "github.com", owner: "mara-okafor", repo: "bakery-site", cloneUrl: "https://github.com/mara-okafor/bakery-site.git", ssh: false, treePath: null, fromCommand: false };
for (const s of [
  "https://github.com/mara-okafor/bakery-site",
  "https://github.com/mara-okafor/bakery-site/",
  "https://github.com/mara-okafor/bakery-site.git",
  "https://www.github.com/mara-okafor/bakery-site?tab=readme-ov-file#readme",
  "http://github.com/mara-okafor/bakery-site",
  "github.com/mara-okafor/bakery-site",
  "  <https://github.com/mara-okafor/bakery-site>  ",
  "https://github.com/mara-okafor/bakery-site/blob/main/README.md",
  "https://github.com/mara-okafor/bakery-site/issues/4",
]) assert.deepEqual(parseRepoLink(s), plain, s);

assert.equal(parseRepoLink("https://github.com/fieldnotes/monorepo/tree/main/apps/web")?.treePath, "main/apps/web");
const cmd = parseRepoLink("gh repo clone mara-okafor/bakery-site");
assert.ok(cmd?.fromCommand && cmd.cloneUrl === plain.cloneUrl);
const ssh = parseRepoLink("git@github.com:mara-okafor/bakery-site.git");
assert.ok(ssh?.ssh && ssh.cloneUrl === "git@github.com:mara-okafor/bakery-site.git");
assert.equal(webLinkOf(ssh!), "https://github.com/mara-okafor/bakery-site");
const lab = parseRepoLink("https://gitlab.com/group/sub/site.git");
assert.deepEqual([lab?.host, lab?.owner, lab?.repo, lab?.cloneUrl], ["gitlab.com", "group/sub", "site", "https://gitlab.com/group/sub/site.git"]);

for (const s of ["My bakery", "bakery-site", "mara-okafor/bakery-site", "https://github.com/mara-okafor", "https://github.com/orgs/fieldnotes/repositories",
  "https://github.com/settings/profile", "https://example.com/about", "http://gitlab.com/group/site.git", "https://github.com/a b/c", "gh auth login", ""]) {
  assert.equal(parseRepoLink(s), null, s);
}
assert.ok(looksLikeAddress("https://example.com/about") && looksLikeAddress("example.com/about") && looksLikeAddress("git@gitlab.com:x/y"));
for (const name of ["My bakery", "Sourdough & Co.", "bakery.com", "www.bakery.com", "My Site.co"]) assert.ok(!looksLikeAddress(name), `${name} is a name`);
console.log("repo: ok");
