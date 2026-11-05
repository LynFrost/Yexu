import { DEFAULT_BOUNDS, boundsFromWindow, fitInWorkArea } from "../core/geometry.js";
import { readBounds, saveBounds } from "../storage/preferences.js";

const MANAGER_URL = chrome.runtime.getURL("src/ui/manager.html");
const SESSION_MANAGER = "managerWindowId";
const SESSION_TARGET = "targetWindowId";
let launchQueue = Promise.resolve();
let boundsTimer = null;

async function normalWindow(id) {
  if (!Number.isInteger(id)) return null;
  try {
    const win = await chrome.windows.get(id);
    return win.type === "normal" && !win.incognito ? win : null;
  } catch {
    return null;
  }
}

async function allNormalWindows() {
  const all = await chrome.windows.getAll({ windowTypes: ["normal"] });
  return all.filter((win) => !win.incognito);
}

async function chooseTarget(preferredId) {
  const preferred = await normalWindow(preferredId);
  if (preferred) return preferred;
  try {
    const last = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    const checked = await normalWindow(last.id);
    if (checked) return checked;
  } catch { /* The last focused window might be the manager. */ }
  const stored = await chrome.storage.session.get(SESSION_TARGET);
  const previous = await normalWindow(stored[SESSION_TARGET]);
  if (previous) return previous;
  const windows = await allNormalWindows();
  return windows.find((win) => win.focused) || windows[0] || null;
}

async function findManager() {
  const stored = await chrome.storage.session.get(SESSION_MANAGER);
  const knownId = stored[SESSION_MANAGER];
  if (Number.isInteger(knownId)) {
    try {
      const win = await chrome.windows.get(knownId, { populate: true });
      if (win.type === "popup" &&
          win.tabs?.some((tab) => tab.url?.startsWith(MANAGER_URL))) return win;
    } catch { /* Stale id. */ }
  }
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
  return windows.find((win) => win.tabs?.some((tab) => tab.url?.startsWith(MANAGER_URL))) || null;
}

async function displayInfo() {
  try { return await chrome.system.display.getInfo(); }
  catch { return []; }
}

async function setBinding(managerId, targetId, reason) {
  await chrome.storage.session.set({
    [SESSION_MANAGER]: managerId,
    [SESSION_TARGET]: targetId
  });
  try {
    await chrome.runtime.sendMessage({
      type: "TARGET_CHANGED",
      targetWindowId: targetId,
      reason: reason || ""
    });
  } catch { /* Page may not be ready yet. Session storage is authoritative. */ }
}

async function openOrFocusManager(preferredId) {
  // Select the NORMAL window before focusing or creating our popup.
  const target = await chooseTarget(preferredId);
  const current = await findManager();
  if (current) {
    await setBinding(current.id, target?.id ?? null, "");
    await chrome.windows.update(current.id, { focused: true });
    return;
  }

  const remembered = await readBounds();
  const relative = target && boundsFromWindow(target);
  const proposed = remembered || {
    width: DEFAULT_BOUNDS.width,
    height: DEFAULT_BOUNDS.height,
    left: relative ? relative.left + Math.max(0, relative.width - DEFAULT_BOUNDS.width - 24) : 80,
    top: relative ? relative.top + 56 : 80
  };
  const displayBounds = fitInWorkArea(proposed, await displayInfo()) || proposed;
  // Publish the target before the new manager page starts loading.
  await chrome.storage.session.set({ [SESSION_TARGET]: target?.id ?? null });
  const popup = await chrome.windows.create({
    url: MANAGER_URL,
    type: "popup",
    focused: true,
    ...displayBounds
  });
  if (!popup?.id) throw new Error("无法创建页序浮窗");
  await setBinding(popup.id, target?.id ?? null, "");
}

function queueOpen(preferredId) {
  launchQueue = launchQueue.catch(() => {}).then(() => openOrFocusManager(preferredId))
    .catch(async (error) => {
      console.error("Yexu: failed to open manager", error);
      await chrome.action.setBadgeText({ text: "!" }).catch(() => {});
      await chrome.action.setTitle({ title: "页序打开失败：" + (error.message || error) }).catch(() => {});
    });
}

chrome.action.onClicked.addListener((tab) => queueOpen(tab?.windowId));
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-manager") queueOpen(null);
});

async function captureBounds(id) {
  try {
    const manager = await findManager();
    if (!manager || manager.id !== id) return;
    const current = await chrome.windows.get(id);
    const bounds = boundsFromWindow(current);
    if (bounds && current.state === "normal") await saveBounds(bounds);
  } catch { /* A closed window cannot be queried. */ }
}

chrome.windows.onBoundsChanged.addListener((win) => {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    boundsTimer = null;
    void captureBounds(win.id);
  }, 220);
});

chrome.windows.onFocusChanged.addListener((focusedId) => {
  // Movement-only events vary between Edge versions; persist on focus loss too.
  void (async () => {
    const manager = await findManager();
    if (manager && focusedId !== manager.id) await captureBounds(manager.id);
  })();
});

chrome.windows.onRemoved.addListener((removedId) => {
  void (async () => {
    const state = await chrome.storage.session.get([SESSION_MANAGER, SESSION_TARGET]);
    if (removedId === state[SESSION_MANAGER]) {
      await chrome.storage.session.remove(SESSION_MANAGER);
      return;
    }
    if (removedId !== state[SESSION_TARGET]) return;
    const replacement = await chooseTarget(null);
    await setBinding(state[SESSION_MANAGER] ?? null, replacement?.id ?? null,
      replacement ? "原浏览器窗口已关闭，已绑定另一普通窗口。" : "原浏览器窗口已关闭，暂无可用普通窗口。");
  })().catch((error) => console.error("Yexu: window removal", error));
});

chrome.windows.onCreated.addListener((win) => {
  if (win.type !== "normal" || win.incognito) return;
  void (async () => {
    const state = await chrome.storage.session.get([SESSION_MANAGER, SESSION_TARGET]);
    if (!Number.isInteger(state[SESSION_MANAGER]) || await normalWindow(state[SESSION_TARGET])) return;
    await setBinding(state[SESSION_MANAGER], win.id, "已绑定新打开的浏览器窗口。");
  })().catch((error) => console.error("Yexu: window creation", error));
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "MANAGER_READY") return false;
  (async () => {
    const manager = await findManager();
    if (!sender.tab || !manager || sender.tab.windowId !== manager.id) {
      throw new Error("非法的管理窗口请求");
    }
    const state = await chrome.storage.session.get(SESSION_TARGET);
    const target = await normalWindow(state[SESSION_TARGET]);
    const actual = target || await chooseTarget(null);
    await setBinding(manager.id, actual?.id ?? null, target ? "" : "已重新检查目标浏览器窗口。");
    return { targetWindowId: actual?.id ?? null };
  })().then(respond, (error) => respond({ error: error.message }));
  return true;
});
