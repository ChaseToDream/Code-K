// server/index.js
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

// server/git-utils.js
import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import { statSync } from "node:fs";
function validateRepoPath(repoPath) {
  if (!repoPath || typeof repoPath !== "string") {
    throw new Error("\u4ED3\u5E93\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A");
  }
  const normalized = resolve(repoPath);
  if (!normalized.startsWith(sep) && !/^[A-Za-z]:[\\\/]/.test(normalized)) {
    throw new Error("\u4ED3\u5E93\u8DEF\u5F84\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84");
  }
  if (normalized.includes("\0")) {
    throw new Error("\u4ED3\u5E93\u8DEF\u5F84\u5305\u542B\u975E\u6CD5\u5B57\u7B26");
  }
  try {
    const st = statSync(normalized);
    if (!st.isDirectory()) {
      throw new Error("\u4ED3\u5E93\u8DEF\u5F84\u4E0D\u662F\u76EE\u5F55");
    }
  } catch (err) {
    throw new Error(`\u4ED3\u5E93\u8DEF\u5F84\u4E0D\u53EF\u8BBF\u95EE: ${err.message}`);
  }
  return normalized;
}
function validateGitArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error("git \u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A");
  }
  const dangerousChars = /[;&|`$(){}\[\]\\\n\r<>]/;
  for (const arg of args) {
    if (typeof arg !== "string") {
      throw new Error("git \u53C2\u6570\u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
    }
    if (dangerousChars.test(arg)) {
      throw new Error(`git \u53C2\u6570\u5305\u542B\u975E\u6CD5\u5B57\u7B26: ${arg}`);
    }
  }
}
function runGit(repoPath, args) {
  return new Promise((resolve3, reject) => {
    let validatedPath;
    try {
      validatedPath = validateRepoPath(repoPath);
      validateGitArgs(args);
    } catch (err) {
      return reject(err);
    }
    const child = spawn("git", args, {
      cwd: validatedPath,
      env: { ...process.env, LANG: "en_US.UTF-8" },
      shell: false
      // 显式禁用 shell，防止注入
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => stdout += d.toString("utf8"));
    child.stderr.on("data", (d) => stderr += d.toString("utf8"));
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) return reject(new Error(`git ${args.join(" ")} failed: ${stderr}`));
      resolve3(stdout);
    });
    child.on("error", reject);
  });
}

// server/watcher.js
var POLL_INTERVAL = 5e3;
var activeWatchers = /* @__PURE__ */ new Map();
async function getHeadCommit(repoPath) {
  try {
    const output = await runGit(repoPath, ["rev-parse", "HEAD"]);
    return output.trim();
  } catch {
    return null;
  }
}
async function getCommitWithDiff(repoPath, hash) {
  const parentHash = `${hash}~1`;
  let parentExists = true;
  try {
    await runGit(repoPath, ["cat-file", "-t", parentHash]);
  } catch {
    parentExists = false;
  }
  const logOutput = await runGit(repoPath, [
    "log",
    "-1",
    "--numstat",
    "--reverse",
    "--format=%H%x00%an%x00%at%x00%s",
    hash
  ]);
  let currentCommit = null;
  let files = [];
  for (const line of logOutput.split("\n")) {
    if (!line.trim()) continue;
    if (line.includes("\0")) {
      const [commitHash, author, timestamp, message] = line.split("\0");
      currentCommit = {
        oid: commitHash,
        message,
        author,
        timestamp: parseInt(timestamp)
      };
    } else {
      const parts = line.split("	");
      if (parts.length < 3) continue;
      const additions = parts[0] === "-" ? 0 : parseInt(parts[0]);
      const deletions = parts[1] === "-" ? 0 : parseInt(parts[1]);
      const path = parts[2];
      if (parts[0] === "-" && parts[1] === "-") continue;
      files.push({ path, additions, deletions });
    }
  }
  if (files.length === 0) {
    let numstat;
    if (!parentExists) {
      numstat = await runGit(repoPath, ["diff-tree", "--numstat", "--root", "-r", hash]);
    } else {
      numstat = await runGit(repoPath, ["diff-tree", "--numstat", "-r", parentHash, hash]);
    }
    files = parseNumstat(numstat);
  }
  return {
    commit: currentCommit,
    files
  };
}
function parseNumstat(output) {
  const files = [];
  for (const line of output.split("\n").filter(Boolean)) {
    const parts = line.split("	");
    if (parts.length < 3) continue;
    const additions = parts[0] === "-" ? 0 : parseInt(parts[0]);
    const deletions = parts[1] === "-" ? 0 : parseInt(parts[1]);
    const path = parts[2];
    if (parts[0] === "-" && parts[1] === "-") continue;
    files.push({ path, additions, deletions });
  }
  return files;
}
async function getNewCommits(repoPath, lastKnownHead) {
  try {
    const logOutput = await runGit(repoPath, [
      "log",
      `${lastKnownHead}..HEAD`,
      "--reverse",
      "--first-parent",
      "--format=%H%x00%an%x00%at%x00%s"
    ]);
    if (!logOutput.trim()) return [];
    const commits = [];
    for (const line of logOutput.split("\n").filter(Boolean)) {
      const [hash, author, timestamp, message] = line.split("\0");
      commits.push({ hash, author, timestamp: parseInt(timestamp), message });
    }
    return commits;
  } catch {
    return [];
  }
}
async function startWatching(repoId, repoPath, repoName, ws) {
  let watcher = activeWatchers.get(repoId);
  if (watcher) {
    watcher.clients.add(ws);
    console.log(`[Watcher] Client added to existing watcher for ${repoName}`);
    return;
  }
  const head = await getHeadCommit(repoPath);
  if (!head) {
    console.error(`[Watcher] Failed to get HEAD for ${repoName}`);
    return;
  }
  watcher = {
    repoPath,
    repoName,
    lastHead: head,
    clients: /* @__PURE__ */ new Set([ws]),
    intervalId: null
  };
  watcher.intervalId = setInterval(async () => {
    await checkForUpdates(repoId);
  }, POLL_INTERVAL);
  activeWatchers.set(repoId, watcher);
  console.log(`[Watcher] Started watching ${repoName} (HEAD: ${head.slice(0, 8)})`);
}
function stopWatching(ws) {
  for (const [repoId, watcher] of activeWatchers) {
    if (watcher.clients.has(ws)) {
      watcher.clients.delete(ws);
      console.log(`[Watcher] Client removed from ${watcher.repoName}`);
      if (watcher.clients.size === 0) {
        clearInterval(watcher.intervalId);
        activeWatchers.delete(repoId);
        console.log(`[Watcher] Stopped watching ${watcher.repoName} (no clients)`);
      }
    }
  }
}
async function checkForUpdates(repoId) {
  const watcher = activeWatchers.get(repoId);
  if (!watcher) return;
  const { repoPath, repoName, lastHead } = watcher;
  try {
    const currentHead = await getHeadCommit(repoPath);
    if (!currentHead || currentHead === lastHead) {
      return;
    }
    console.log(`[Watcher] New commits detected in ${repoName}: ${lastHead.slice(0, 8)} -> ${currentHead.slice(0, 8)}`);
    const newCommits = await getNewCommits(repoPath, lastHead);
    if (newCommits.length === 0) {
      watcher.lastHead = currentHead;
      return;
    }
    const commitDiffs = [];
    for (const commit of newCommits) {
      const diff = await getCommitWithDiff(repoPath, commit.hash);
      if (diff.commit) {
        commitDiffs.push(diff);
      }
    }
    watcher.lastHead = currentHead;
    const message = JSON.stringify({
      type: "commits_update",
      repoId,
      repoName,
      commits: commitDiffs,
      newHead: currentHead
    });
    for (const client of watcher.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
    console.log(`[Watcher] Pushed ${commitDiffs.length} new commits to ${watcher.clients.size} client(s)`);
  } catch (error) {
    console.error(`[Watcher] Error checking updates for ${repoName}:`, error.message);
  }
}
function cleanupAllWatchers() {
  for (const [repoId, watcher] of activeWatchers) {
    clearInterval(watcher.intervalId);
    console.log(`[Watcher] Cleaned up watcher for ${watcher.repoName}`);
  }
  activeWatchers.clear();
}

// server/routes/discover.js
import { existsSync as existsSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { homedir } from "node:os";

// server/services/scanner.js
import { existsSync, readdirSync, statSync as statSync2 } from "node:fs";
import { join } from "node:path";
function findRepos(dir, depth = 0, maxDepth = 2) {
  if (depth > maxDepth) return [];
  const repos = [];
  try {
    if (existsSync(join(dir, ".git"))) {
      repos.push({ path: dir, name: dir.split(/[\\/]/).filter(Boolean).pop() || dir });
      return repos;
    }
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        try {
          const fullPath = join(dir, entry.name);
          statSync2(fullPath);
          repos.push(...findRepos(fullPath, depth + 1, maxDepth));
        } catch {
        }
      }
    }
  } catch {
  }
  return repos;
}
function resolveRepoByName(name, searchRoots, maxResults = 10, maxScanTime = 5e3) {
  const startTime = Date.now();
  const results = [];
  function scanDir(dir, depth = 0, maxDepth = 2) {
    if (Date.now() - startTime > maxScanTime) return;
    if (depth > maxDepth || results.length >= maxResults) return;
    try {
      const dirName = dir.split(/[\\/]/).pop() || "";
      if (dirName.toLowerCase() === name.toLowerCase() && existsSync(join(dir, ".git"))) {
        results.push({ path: dir, name: dirName });
        return;
      }
      if (results.length >= maxResults) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults || Date.now() - startTime > maxScanTime) break;
        if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("node_modules") && !entry.name.startsWith(".git")) {
          try {
            scanDir(join(dir, entry.name), depth + 1, maxDepth);
          } catch {
          }
        }
      }
    } catch {
    }
  }
  for (const root of searchRoots) {
    if (results.length >= maxResults || Date.now() - startTime > maxScanTime) break;
    if (existsSync(root)) scanDir(root);
  }
  return { results, elapsed: Date.now() - startTime };
}

// server/routes/discover.js
async function handleDiscover(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const customPath = url.searchParams.get("path");
  let scanDirs = [
    homedir(),
    process.env.USERPROFILE || "",
    join2(process.env.USERPROFILE || "", "Desktop"),
    join2(process.env.USERPROFILE || "", "Documents"),
    process.env.HOME || ""
  ].filter(Boolean);
  if (customPath) {
    scanDirs = [customPath];
  }
  const uniqueDirs = [...new Set(scanDirs)];
  const allRepos = [];
  for (const dir of uniqueDirs) {
    if (existsSync2(dir)) {
      allRepos.push(...findRepos(dir));
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const uniqueRepos = allRepos.filter((r) => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });
  res.json({ repos: uniqueRepos });
}
async function handleResolve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const name = url.searchParams.get("name");
  if (!name) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "\u7F3A\u5C11\u6587\u4EF6\u5939\u540D" }));
  }
  const searchRoots = [
    join2(process.env.USERPROFILE || homedir(), "code"),
    join2(process.env.USERPROFILE || homedir(), "Code"),
    join2(process.env.USERPROFILE || homedir(), "projects"),
    join2(process.env.USERPROFILE || homedir(), "Projects"),
    join2(process.env.USERPROFILE || homedir(), "workspace"),
    join2(process.env.USERPROFILE || homedir(), "Workspace"),
    join2(process.env.USERPROFILE || homedir(), "dev"),
    join2(process.env.USERPROFILE || homedir(), "Dev"),
    join2(process.env.USERPROFILE || homedir(), "source"),
    join2(process.env.USERPROFILE || homedir(), "Source"),
    join2(process.env.USERPROFILE || homedir(), "Desktop"),
    join2(process.env.USERPROFILE || homedir(), "Documents"),
    "D:\\codeFile",
    "D:\\projects"
  ].filter(Boolean);
  const uniqueRoots = [...new Set(searchRoots)];
  const { results } = resolveRepoByName(name, uniqueRoots);
  res.json({ repos: results, searched: uniqueRoots.filter((r) => existsSync2(r)) });
}

// server/routes/repo.js
import { existsSync as existsSync3 } from "node:fs";
import { join as join3 } from "node:path";

// server/lib/kline-core.js
function generateTicker(path) {
  const parts = path.split("/");
  const filename = parts[parts.length - 1];
  const name = filename.replace(/\.[^.]+$/, "").toUpperCase();
  const ext = filename.includes(".") ? filename.split(".").pop().toUpperCase() : "";
  const shortName = name.slice(0, 6);
  return ext ? `${shortName}.${ext.slice(0, 3)}` : shortName;
}
function createCandle(open, close, volume, commit) {
  return {
    time: commit.timestamp,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume,
    commitMessage: commit.message,
    commitHash: commit.oid.slice(0, 8),
    author: commit.author
  };
}
function calcChangePercent(lastCandle) {
  return lastCandle.open > 0 ? (lastCandle.close - lastCandle.open) / lastCandle.open * 100 : lastCandle.close > 0 ? 100 : 0;
}

// server/services/parser.js
async function getCommitsWithDiff(repoPath, limit = 300) {
  const logOutput = await runGit(repoPath, [
    "log",
    `--max-count=${limit}`,
    "--first-parent",
    "--numstat",
    "--reverse",
    "--format=%H%x00%an%x00%at%x00%s"
  ]);
  const commits = [];
  let currentCommit = null;
  let currentFiles = [];
  for (const line of logOutput.split("\n")) {
    if (!line.trim()) {
      if (currentCommit) {
        commits.push({ commit: currentCommit, files: currentFiles });
        currentCommit = null;
        currentFiles = [];
      }
      continue;
    }
    if (line.includes("\0")) {
      const [hash, author, timestamp, message] = line.split("\0");
      currentCommit = {
        oid: hash,
        author,
        timestamp: parseInt(timestamp),
        message
      };
    } else {
      const parts = line.split("	");
      if (parts.length < 3) continue;
      const additions = parts[0] === "-" ? 0 : parseInt(parts[0]);
      const deletions = parts[1] === "-" ? 0 : parseInt(parts[1]);
      const path = parts[2];
      if (parts[0] === "-" && parts[1] === "-") continue;
      currentFiles.push({ path, additions, deletions });
    }
  }
  if (currentCommit) {
    commits.push({ commit: currentCommit, files: currentFiles });
  }
  return commits;
}
function buildFileStocks(commits, repoId) {
  const fileData = /* @__PURE__ */ new Map();
  const chronological = commits;
  for (let i = 0; i < chronological.length; i++) {
    const diff = chronological[i];
    const { commit, files } = diff;
    for (const file of files) {
      let state = fileData.get(file.path);
      if (!state) {
        const linesAfter = file.additions - file.deletions;
        state = {
          path: file.path,
          candles: [],
          currentLines: 0,
          firstCommitIdx: i,
          lastSeenIdx: i,
          totalAdditions: 0,
          totalDeletions: 0,
          isDelisted: false
        };
        fileData.set(file.path, state);
        const open = 0;
        const close = Math.max(0, linesAfter);
        state.candles.push(createCandle(open, close, file.additions + file.deletions, commit));
        state.currentLines = close;
        state.totalAdditions += file.additions;
        state.totalDeletions += file.deletions;
      } else {
        state.lastSeenIdx = i;
        const open = state.currentLines;
        const change = file.additions - file.deletions;
        const close = Math.max(0, open + change);
        state.candles.push(createCandle(open, close, file.additions + file.deletions, commit));
        state.currentLines = close;
        state.totalAdditions += file.additions;
        state.totalDeletions += file.deletions;
        if (close === 0 && file.deletions > 0) {
          state.isDelisted = true;
        }
      }
    }
  }
  const stocks = [];
  for (const [, state] of fileData) {
    if (state.candles.length === 0) continue;
    const firstCandle = state.candles[0];
    const lastCandle = state.candles[state.candles.length - 1];
    let status = "active";
    if (state.candles.length === 1 || state.firstCommitIdx === chronological.length - 1) {
      status = "ipo";
    }
    if (state.isDelisted) {
      status = "delisted";
    }
    stocks.push({
      path: state.path,
      ticker: generateTicker(state.path),
      candles: state.candles,
      currentLines: state.currentLines,
      status,
      firstCommit: {
        oid: firstCandle.commitHash,
        message: firstCandle.commitMessage,
        author: firstCandle.author,
        timestamp: firstCandle.time
      },
      lastCommit: {
        oid: lastCandle.commitHash,
        message: lastCandle.commitMessage,
        author: lastCandle.author,
        timestamp: lastCandle.time
      },
      totalAdditions: state.totalAdditions,
      totalDeletions: state.totalDeletions,
      changePercent: calcChangePercent(lastCandle),
      repoId
    });
  }
  stocks.sort((a, b) => b.currentLines - a.currentLines);
  return stocks;
}
function generateRepoId(repoPath) {
  return Buffer.from(repoPath).toString("base64").slice(0, 12);
}

// server/routes/repo.js
async function handleGetLog(req, res, repoPath) {
  const limit = new URL(req.url, `http://${req.headers.host}`).searchParams.get("limit") || "300";
  const commits = await getCommitsWithDiff(repoPath, parseInt(limit));
  res.json(commits.map((c) => ({
    hash: c.commit.oid,
    author: c.commit.author,
    timestamp: c.commit.timestamp,
    message: c.commit.message
  })));
}
async function handleGetDiff(req, res, repoPath) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const hash = url.searchParams.get("hash");
  const parentHash = url.searchParams.get("parentHash");
  let numstat;
  if (!parentHash) {
    numstat = await runGit(repoPath, ["diff-tree", "--numstat", "--root", "-r", hash]);
  } else {
    numstat = await runGit(repoPath, ["diff-tree", "--numstat", "-r", parentHash, hash]);
  }
  const files = [];
  for (const line of numstat.split("\n").filter(Boolean)) {
    const parts = line.split("	");
    if (parts.length < 3) continue;
    const additions = parts[0] === "-" ? 0 : parseInt(parts[0]);
    const deletions = parts[1] === "-" ? 0 : parseInt(parts[1]);
    const path = parts[2];
    if (parts[0] === "-" && parts[1] === "-") continue;
    files.push({ path, additions, deletions });
  }
  res.json(files);
}
function validateRepoPath2(req, res, repoPath) {
  if (!repoPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "\u7F3A\u5C11\u8DEF\u5F84\u53C2\u6570" }));
    return false;
  }
  if (!existsSync3(join3(repoPath, ".git"))) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "\u4E0D\u662F\u6709\u6548\u7684 Git \u4ED3\u5E93" }));
    return false;
  }
  return true;
}

// server/ws-handler.js
import { existsSync as existsSync5 } from "node:fs";
import { join as join5, resolve as resolve2, sep as sep2 } from "node:path";

// server/routes/diff.js
async function getFileContent(repoPath, commitHash, filePath) {
  try {
    const content = await runGit(repoPath, ["show", `${commitHash}:${filePath}`]);
    return content;
  } catch {
    return null;
  }
}
async function handleRequestDiff(ws, message) {
  const { repoPath, commitHash, filePath } = message;
  try {
    const newContent = await getFileContent(repoPath, commitHash, filePath);
    let oldContent = "";
    try {
      const parentHash = `${commitHash}~1`;
      oldContent = await getFileContent(repoPath, parentHash, filePath) || "";
    } catch {
      oldContent = "";
    }
    ws.send(JSON.stringify({
      type: "diff_detail",
      commitHash,
      filePath,
      oldContent,
      newContent,
      additions: 0,
      deletions: 0
    }));
  } catch (error) {
    ws.send(JSON.stringify({
      type: "error",
      message: `Failed to get diff: ${error.message}`,
      code: "DIFF_FAILED"
    }));
  }
}

// server/services/cache.js
import { existsSync as existsSync4, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync as readdirSync2 } from "node:fs";
import { join as join4, dirname } from "node:path";
import { fileURLToPath } from "node:url";
var __dirname = dirname(fileURLToPath(import.meta.url));
var CACHE_DIR = join4(__dirname, "..", "cache");
if (!existsSync4(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}
function getCachePath(repoId) {
  return join4(CACHE_DIR, `${repoId}.json`);
}
async function getHeadCommit2(repoPath) {
  try {
    const output = await runGit(repoPath, ["rev-parse", "HEAD"]);
    return output.trim();
  } catch {
    return null;
  }
}
function loadCache(repoId) {
  const cachePath = getCachePath(repoId);
  try {
    if (!existsSync4(cachePath)) return null;
    const raw = readFileSync(cachePath, "utf-8");
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp > 7 * 24 * 60 * 60 * 1e3) {
      unlinkSync(cachePath);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
function saveCache(repoId, data) {
  const cachePath = getCachePath(repoId);
  try {
    writeFileSync(cachePath, JSON.stringify({
      ...data,
      timestamp: Date.now()
    }, null, 2), { encoding: "utf-8", mode: 384 });
    console.log(`[Cache] Saved: ${repoId} (${data.commitCount} commits, ${data.stocks.length} stocks)`);
  } catch (err) {
    console.error(`[Cache] Failed to save ${repoId}:`, err.message);
  }
}
function deleteCache(repoId) {
  const cachePath = getCachePath(repoId);
  try {
    if (existsSync4(cachePath)) {
      unlinkSync(cachePath);
      console.log(`[Cache] Deleted: ${repoId}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
function clearAllCache() {
  try {
    const files = readdirSync2(CACHE_DIR);
    let count = 0;
    for (const file of files) {
      if (file.endsWith(".json")) {
        unlinkSync(join4(CACHE_DIR, file));
        count++;
      }
    }
    console.log(`[Cache] Cleared ${count} cache files`);
    return count;
  } catch {
    return 0;
  }
}
function getCacheStats() {
  try {
    const files = readdirSync2(CACHE_DIR).filter((f) => f.endsWith(".json"));
    let totalSize = 0;
    for (const file of files) {
      totalSize += readFileSync(join4(CACHE_DIR, file)).length;
    }
    return { count: files.length, totalSize };
  } catch {
    return { count: 0, totalSize: 0 };
  }
}

// server/ws-handler.js
function validateRepoPath3(repoPath) {
  if (!repoPath || typeof repoPath !== "string") return null;
  if (repoPath.includes("\0")) return null;
  const normalized = resolve2(repoPath);
  if (!normalized.startsWith(sep2) && !/^[A-Za-z]:[\\\/]/.test(normalized)) {
    return null;
  }
  try {
    if (!existsSync5(join5(normalized, ".git"))) return null;
  } catch {
    return null;
  }
  return normalized;
}
var activeParses = /* @__PURE__ */ new Map();
function setupWebSocket(wss2) {
  wss2.on("connection", (ws) => {
    console.log("[WebSocket] Client connected");
    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Received:", message.type);
        switch (message.type) {
          case "start_parse":
            await handleStartParse(ws, message);
            break;
          case "stop_parse":
            handleStopParse(ws);
            break;
          case "request_diff":
            await handleRequestDiff(ws, message);
            break;
          default:
            ws.send(JSON.stringify({
              type: "error",
              message: `Unknown message type: ${message.type}`,
              code: "UNKNOWN_TYPE"
            }));
        }
      } catch (error) {
        console.error("[WebSocket] Error processing message:", error);
        ws.send(JSON.stringify({
          type: "error",
          message: error.message,
          code: "PROCESSING_ERROR"
        }));
      }
    });
    ws.on("close", () => {
      console.log("[WebSocket] Client disconnected");
      cleanupParses(ws);
      stopWatching(ws);
    });
    ws.on("error", (error) => {
      console.error("[WebSocket] Connection error:", error);
      cleanupParses(ws);
      stopWatching(ws);
    });
  });
}
async function handleStartParse(ws, message) {
  const { repoPath: rawRepoPath, repoName, maxCommits = 300 } = message;
  const repoPath = validateRepoPath3(rawRepoPath);
  if (!repoPath) {
    ws.send(JSON.stringify({
      type: "error",
      message: "\u4E0D\u662F\u6709\u6548\u7684Git\u4ED3\u5E93\u6216\u8DEF\u5F84\u4E0D\u5408\u6CD5",
      code: "INVALID_REPO"
    }));
    return;
  }
  const repoId = generateRepoId(repoPath);
  stopExistingParse(ws);
  ws.send(JSON.stringify({
    type: "parse_started",
    repoId,
    repoName
  }));
  const cached = loadCache(repoId);
  if (cached && cached.stocks && cached.stocks.length > 0) {
    const currentHead = await getHeadCommit2(repoPath);
    if (currentHead && cached.lastHead === currentHead) {
      console.log(`[Cache] Hit for ${repoName}: ${cached.stocks.length} stocks, ${cached.commitCount} commits`);
      ws.send(JSON.stringify({
        type: "complete",
        repoId,
        repoName,
        stocks: cached.stocks,
        totalCommits: cached.commitCount,
        totalTime: 0,
        fromCache: true
      }));
      startWatching(repoId, repoPath, repoName, ws);
      return;
    }
    console.log(`[Cache] Stale for ${repoName}, will re-parse`);
  }
  const abortController = new AbortController();
  const parseTask = parseRepoAsync(ws, repoId, repoPath, repoName, maxCommits, abortController);
  activeParses.set(ws, { repoId, task: parseTask, abortController });
}
function handleStopParse(ws) {
  stopExistingParse(ws);
  ws.send(JSON.stringify({ type: "parse_stopped" }));
}
async function parseRepoAsync(ws, repoId, repoPath, repoName, maxCommits, abortController) {
  const startTime = Date.now();
  try {
    ws.send(JSON.stringify({
      type: "progress",
      repoId,
      phase: "parsing",
      current: 0,
      total: 1,
      message: "\u6B63\u5728\u83B7\u53D6\u63D0\u4EA4\u8BB0\u5F55..."
    }));
    const commits = await getCommitsWithDiff(repoPath, maxCommits);
    if (abortController.signal.aborted) return;
    ws.send(JSON.stringify({
      type: "progress",
      repoId,
      phase: "diffing",
      current: commits.length,
      total: commits.length,
      message: `\u5DF2\u83B7\u53D6 ${commits.length} \u6B21\u63D0\u4EA4\u5DEE\u5F02`
    }));
    const BATCH_SIZE = 10;
    for (let i = 0; i < commits.length; i += BATCH_SIZE) {
      if (abortController.signal.aborted) return;
      const batch = commits.slice(i, Math.min(i + BATCH_SIZE, commits.length));
      const stocks = await new Promise((resolve3) => {
        setImmediate(() => {
          resolve3(buildFileStocks(batch, repoId));
        });
      });
      ws.send(JSON.stringify({
        type: "partial",
        repoId,
        stocks,
        latestCommit: batch[batch.length - 1]
      }));
      ws.send(JSON.stringify({
        type: "progress",
        repoId,
        phase: "building",
        current: Math.min(i + BATCH_SIZE, commits.length),
        total: commits.length,
        message: `\u6B63\u5728\u751F\u6210K\u7EBF\u6570\u636E ${Math.min(i + BATCH_SIZE, commits.length)}/${commits.length}...`
      }));
      await new Promise((r) => setTimeout(r, 0));
    }
    if (abortController.signal.aborted) return;
    const finalStocks = await new Promise((resolve3) => {
      setImmediate(() => {
        resolve3(buildFileStocks(commits, repoId));
      });
    });
    ws.send(JSON.stringify({
      type: "complete",
      repoId,
      repoName,
      stocks: finalStocks,
      totalCommits: commits.length,
      totalTime: Date.now() - startTime
    }));
    console.log(`[WebSocket] Parse complete for ${repoName}: ${commits.length} commits, ${finalStocks.length} stocks, ${Date.now() - startTime}ms`);
    const currentHead = await getHeadCommit2(repoPath);
    saveCache(repoId, {
      repoName,
      repoPath,
      lastHead: currentHead,
      stocks: finalStocks,
      commitCount: commits.length
    });
    await startWatching(repoId, repoPath, repoName, ws);
  } catch (error) {
    console.error("[WebSocket] Parse error:", error);
    ws.send(JSON.stringify({
      type: "error",
      repoId,
      message: error.message,
      code: "PARSE_FAILED"
    }));
  } finally {
    activeParses.delete(ws);
  }
}
function stopExistingParse(ws) {
  const existing = activeParses.get(ws);
  if (existing) {
    existing.abortController.abort();
    activeParses.delete(ws);
  }
}
function cleanupParses(ws) {
  stopExistingParse(ws);
}

// server/index.js
var server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/discover") {
      return await handleDiscover(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/resolve") {
      return await handleResolve(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/cache/stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(getCacheStats()));
    }
    if (req.method === "DELETE" && url.pathname === "/api/cache") {
      const targetPath = url.searchParams.get("path");
      if (targetPath) {
        const repoId = generateRepoId(targetPath);
        const deleted = deleteCache(repoId);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ deleted }));
      }
      const count = clearAllCache();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ cleared: count }));
    }
    const repoPath = url.searchParams.get("path");
    if (!validateRepoPath2(req, res, repoPath)) return;
    if (req.method === "GET" && (url.pathname === "/api/repos" || url.pathname === "/api/log")) {
      await handleGetLog(req, res, repoPath);
    } else if (req.method === "GET" && url.pathname === "/api/diff") {
      await handleGetDiff(req, res, repoPath);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  } catch (err) {
    console.error("API Error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});
var wss = new WebSocketServer({ server });
setupWebSocket(wss);
var PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Code-K API \u670D\u52A1\u5668\u5DF2\u542F\u52A8: http://localhost:${PORT}`);
  console.log(`WebSocket \u670D\u52A1\u5668\u5DF2\u542F\u52A8: ws://localhost:${PORT}`);
});
process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down...");
  cleanupAllWatchers();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanupAllWatchers();
  process.exit(0);
});
//# sourceMappingURL=index.js.map
