import { displayTitle, hostname, orderedTabs, manualMove, planAutomaticSort } from "../core/tabs.js";
import { boundsFromWindow, displayForBounds, fitInWorkArea, MIN_WIDTH, MIN_HEIGHT } from "../core/geometry.js";
import { keepOpenPreference, saveKeepOpen, saveBounds } from "../storage/preferences.js";

const els = {
  list: document.querySelector("#tab-list"),
  search: document.querySelector("#search"),
  count: document.querySelector("#tab-count"),
  target: document.querySelector("#target-label"),
  keep: document.querySelector("#keep-open"),
  field: document.querySelector("#sort-field"),
  direction: document.querySelector("#sort-direction"),
  sort: document.querySelector("#sort-button"),
  fit: document.querySelector("#fit-button"),
  status: document.querySelector("#status")
};
let targetWindowId = null;
let tabs = [];
let busy = false;
let refreshPending = false;
let refreshVersion = 0;
let dragId = null;
let dropTarget = null;
let suppressClickUntil = 0;
let boundsTimer = 0;
let refreshTimer = 0;

function message(value, error = false) {
  els.status.textContent = value || "";
  els.status.dataset.error = String(error);
}

function fail(prefix, error) {
  const detail = error?.message || String(error);
  message(prefix + "：" + detail, true);
}

function filtered() {
  const term = els.search.value.trim().toLocaleLowerCase();
  if (!term) return tabs;
  return tabs.filter((tab) =>
    displayTitle(tab).toLocaleLowerCase().includes(term) ||
    (tab.url || "").toLocaleLowerCase().includes(term));
}

function canSort() {
  return !busy && !els.search.value.trim() && targetWindowId !== null;
}

function updateControls() {
  const allowed = canSort();
  els.search.disabled = busy;
  els.sort.disabled = !allowed || els.field.value === "manual";
  els.direction.disabled = !allowed || els.field.value === "manual";
  els.fit.disabled = busy || targetWindowId === null;
  els.field.disabled = busy || targetWindowId === null;
}

function iconFor(tab) {
  const url = tab.url && /^(https?:|file:)/i.test(tab.url)
    ? chrome.runtime.getURL("_favicon/?pageUrl=" + encodeURIComponent(tab.url) + "&size=32")
    : /^data:image\//i.test(tab.favIconUrl || "") ? tab.favIconUrl : "";
  if (!url) {
    const span = document.createElement("span");
    span.className = "favicon-fallback";
    span.textContent = "🌐";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  const image = document.createElement("img");
  image.className = "favicon";
  image.alt = "";
  image.src = url;
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => image.replaceWith(iconFor({})), { once: true });
  return image;
}

function renderRow(tab) {
  const row = document.createElement("div");
  row.className = "tab-row" + (tab.active ? " active" : "");
  row.dataset.id = String(tab.id);
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", "切换到：" + displayTitle(tab));
  row.title = displayTitle(tab) + "\n" + (tab.url || "");
  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.textContent = "⋮⋮";
  handle.title = "拖动调整浏览器真实标签顺序；也可用方向键";
  handle.tabIndex = canSort() ? 0 : -1;
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", "调整标签顺序：" + displayTitle(tab));
  handle.setAttribute("aria-disabled", String(!canSort()));
  handle.draggable = canSort();
  row.append(handle, iconFor(tab));
  const detail = document.createElement("div");
  detail.className = "tab-text";
  const title = document.createElement("div");
  title.className = "tab-title";
  title.textContent = displayTitle(tab);
  detail.append(title);
  const domain = hostname(tab.url);
  if (domain) {
    const sub = document.createElement("div");
    sub.className = "tab-domain";
    sub.textContent = domain;
    detail.append(sub);
  }
  row.append(detail);
  const marker = document.createElement("span");
  marker.className = "marker";
  marker.textContent = tab.active ? "当前" : tab.pinned ? "固定" : tab.groupId >= 0 ? "分组" : "";
  row.append(marker);
  row.addEventListener("click", () => {
    if (Date.now() < suppressClickUntil) return;
    void activate(tab.id);
  });
  row.addEventListener("keydown", (event) => {
    if (event.target !== row) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void activate(tab.id);
    }
  });
  handle.addEventListener("click", (event) => event.stopPropagation());
  handle.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (!canSort()) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const currentIndex = tabs.findIndex((item) => item.id === tab.id);
    const neighbor = tabs[currentIndex + direction];
    if (neighbor) void reorder(tab.id, neighbor.id, direction < 0 ? "before" : "after");
  });
  handle.addEventListener("dragstart", (event) => {
    event.stopPropagation();
    if (!canSort()) { event.preventDefault(); return; }
    dragId = tab.id;
    dropTarget = null;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(tab.id));
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragover", (event) => {
    if (dragId === null || !canSort()) return;
    const side = event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2
      ? "before" : "after";
    if (!manualMove(tabs, dragId, tab.id, side)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearDropMarks();
    dropTarget = { targetId: tab.id, side };
    row.classList.add(side === "before" ? "drop-before" : "drop-after");
  });
  row.addEventListener("drop", (event) => {
    if (dragId === null || !dropTarget || dropTarget.targetId !== tab.id) return;
    event.preventDefault();
    event.stopPropagation();
    const move = { ...dropTarget, sourceId: dragId };
    resetDrag();
    void reorder(move.sourceId, move.targetId, move.side);
  });
  handle.addEventListener("dragend", () => resetDrag());
  return row;
}

function clearDropMarks() {
  els.list.querySelectorAll(".drop-before,.drop-after").forEach((row) =>
    row.classList.remove("drop-before", "drop-after"));
}

function resetDrag() {
  dragId = null;
  dropTarget = null;
  suppressClickUntil = Date.now() + 350;
  clearDropMarks();
  els.list.querySelectorAll(".is-dragging").forEach((row) => row.classList.remove("is-dragging"));
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && dragId !== null) {
    resetDrag();
    message("已取消拖动");
  }
});

function render() {
  const visible = filtered();
  els.count.textContent = "当前窗口：" + tabs.length + " 个标签" +
    (visible.length !== tabs.length ? " · 显示 " + visible.length + " 个" : "");
  els.target.textContent = targetWindowId === null ? "未绑定普通窗口" : "窗口 #" + targetWindowId;
  els.list.replaceChildren();
  if (targetWindowId === null) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "暂无可用的普通浏览器窗口。打开普通窗口后可重新唤起页序。";
    els.list.append(empty);
  } else if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = tabs.length ? "没有匹配的标签页" : "当前浏览器窗口没有标签页";
    els.list.append(empty);
  } else {
    const frag = document.createDocumentFragment();
    visible.forEach((tab) => frag.append(renderRow(tab)));
    els.list.append(frag);
  }
  updateControls();
}

async function recoverTarget(notice) {
  const normals = (await chrome.windows.getAll({ windowTypes: ["normal"] }))
    .filter((win) => !win.incognito);
  const last = normals.find((win) => win.focused) || normals[0];
  targetWindowId = last?.id ?? null;
  if (notice) message(last ? notice + "，已重新绑定普通窗口。" : notice + "，暂无其他普通窗口。", true);
}

async function readActualTabs() {
  if (targetWindowId === null) return [];
  const win = await chrome.windows.get(targetWindowId);
  if (win.type !== "normal" || win.incognito) throw new Error("目标不是普通浏览器窗口");
  return orderedTabs(await chrome.tabs.query({ windowId: targetWindowId }));
}

async function refresh() {
  if (busy) { refreshPending = true; return; }
  const version = ++refreshVersion;
  try {
    const actual = await readActualTabs();
    if (version !== refreshVersion) return;
    tabs = actual;
    render();
  } catch (error) {
    try {
      await recoverTarget("原浏览器窗口已关闭或无法访问");
      tabs = await readActualTabs();
      render();
    } catch (another) {
      tabs = [];
      targetWindowId = null;
      render();
      fail("读取失败", another);
    }
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refreshTimer = 0; void refresh(); }, 50);
}

async function exclusive(fn) {
  if (busy) return;
  busy = true;
  render();
  try { await fn(); }
  catch (error) { fail("操作失败", error); }
  finally {
    busy = false;
    await refresh();
    if (refreshPending) {
      refreshPending = false;
      await refresh();
    }
  }
}

async function activate(id) {
  if (busy || targetWindowId === null) return;
  await exclusive(async () => {
    const actual = await readActualTabs();
    if (!actual.some((tab) => tab.id === id)) throw new Error("目标标签已关闭，请重试");
    await chrome.tabs.update(id, { active: true });
    await chrome.windows.update(targetWindowId, { focused: true });
    if (!els.keep.checked) {
      await chrome.windows.remove((await chrome.windows.getCurrent()).id);
    } else {
      message("已切换，页序仍保持打开（不是系统级置顶）。");
    }
  });
}

async function reorder(sourceId, targetId, side) {
  resetDrag();
  if (!canSort()) return;
  const initial = manualMove(tabs, sourceId, targetId, side);
  if (!initial) {
    message("不能跨越固定标签或标签组边界移动；仅允许同一安全区段排序。", true);
    return;
  }
  await exclusive(async () => {
    const actual = await readActualTabs();
    const move = manualMove(actual, sourceId, targetId, side);
    if (!move) throw new Error("标签排列已变化或目标越过安全边界");
    await chrome.tabs.move(move.tabId, { index: move.index });
    const after = await readActualTabs();
    const original = actual.findIndex((t) => t.id === sourceId);
    const expected = [...actual];
    const [item] = expected.splice(original, 1);
    expected.splice(move.index, 0, item);
    if (after.map((t) => t.id).join(",") !== expected.map((t) => t.id).join(",")) {
      throw new Error("浏览器未按预期移动标签，已按实际顺序重新同步");
    }
    message("已更新浏览器中的实际标签顺序。");
  });
}

async function performSort() {
  if (!canSort() || els.field.value === "manual") return;
  await exclusive(async () => {
    const original = await readActualTabs();
    const plan = planAutomaticSort(original, els.field.value, els.direction.value);
    if (!plan.moves.length) {
      message("无需调整。" + (plan.protectedBlocks ? " 固定标签及标签组边界已保留。" : ""));
      return;
    }
    for (const move of plan.moves) {
      // Re-check window and live arrangement to prevent writing against stale tabs.
      const before = await readActualTabs();
      if (!before.some((tab) => tab.id === move.tabId)) throw new Error("排序期间有标签关闭");
      await chrome.tabs.move(move.tabId, { index: move.index });
      const afterMove = await readActualTabs();
      if (afterMove.findIndex((tab) => tab.id === move.tabId) !== move.index) {
        throw new Error("标签移动未达到预期位置，已停止并重新同步");
      }
    }
    const actual = await readActualTabs();
    if (actual.map((t) => t.id).join(",") !== plan.finalIds.join(",")) {
      throw new Error("排序过程中浏览器顺序发生变化，已按真实顺序恢复显示");
    }
    message("排序完成，实际移动 " + plan.moves.length + " 次。" +
      (plan.protectedBlocks ? " 固定标签和标签组保持原区段。" : ""));
  });
}

async function windowAndDisplays() {
  const win = await chrome.windows.getCurrent();
  let displays = [];
  try { displays = await chrome.system.display.getInfo(); }
  catch { /* Constrain using available window geometry as fallback. */ }
  return { win, displays };
}

function measureHeightAtWidth(width) {
  const measuring = els.list.cloneNode(false);
  measuring.classList.add("measurement-list");
  measuring.style.width = width + "px";
  // Fit uses ALL tabs, not the currently filtered subset.
  tabs.forEach((tab) => {
    const row = renderRow(tab);
    row.removeAttribute("tabindex");
    measuring.append(row);
  });
  document.body.append(measuring);
  const height = Math.ceil(measuring.scrollHeight);
  measuring.remove();
  return height;
}

async function fitWindow() {
  if (busy || targetWindowId === null) return;
  await exclusive(async () => {
    const all = await readActualTabs();
    tabs = all;
    const { win, displays } = await windowAndDisplays();
    if (!Number.isInteger(win.id)) throw new Error("无法读取当前浮窗");
    const previous = boundsFromWindow(win);
    if (!previous) throw new Error("无法获取当前窗口边界");
    const display = displayForBounds(previous, displays);
    const area = display?.workArea || {
      left: previous.left, top: previous.top,
      width: Math.max(previous.width, 900), height: Math.max(previous.height, 700)
    };
    const maxOuterWidth = Math.max(Math.min(MIN_WIDTH, area.width), Math.floor(area.width * .8));
    const maxOuterHeight = Math.max(Math.min(MIN_HEIGHT, area.height), Math.floor(area.height * .85));
    const outerX = Math.max(0, win.width - document.documentElement.clientWidth);
    const outerY = Math.max(0, win.height - document.documentElement.clientHeight);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const style = getComputedStyle(document.querySelector(".tab-title") || document.body);
    ctx.font = [style.fontWeight, style.fontSize, style.fontFamily].join(" ");
    const longest = all.reduce((max, tab) =>
      Math.max(max, ctx.measureText(displayTitle(tab)).width), 0);
    const wantedClient = Math.ceil(longest + 90);
    const outerWidth = Math.max(MIN_WIDTH,
      Math.min(maxOuterWidth, wantedClient + outerX));
    const clientWidth = Math.max(250, outerWidth - outerX);
    // The natural row heights are measured using the actual UI font and line wrapping.
    const tabsHeight = measureHeightAtWidth(clientWidth);
    const toolbar = els.list.previousElementSibling.getBoundingClientRect().height;
    const footer = els.list.nextElementSibling.getBoundingClientRect().height;
    const outerHeight = Math.min(maxOuterHeight,
      Math.max(MIN_HEIGHT, Math.ceil(tabsHeight + toolbar + footer + outerY + 8)));
    const requested = fitInWorkArea({
      left: previous.left, top: previous.top, width: outerWidth, height: outerHeight
    }, displays) || { left: previous.left, top: previous.top, width: outerWidth, height: outerHeight };
    const updated = await chrome.windows.update(win.id, requested);
    const actualBounds = boundsFromWindow(updated) || requested;
    await saveBounds(actualBounds);
    message("已依据全部 " + all.length + " 个标签适配尺寸；超出屏幕高度的内容可滚动。");
  });
}

els.search.addEventListener("input", render);
els.keep.addEventListener("change", () =>
  saveKeepOpen(els.keep.checked).catch((error) => fail("保存选项失败", error)));
els.field.addEventListener("change", updateControls);
els.sort.addEventListener("click", () => void performSort());
els.fit.addEventListener("click", () => void fitWindow());

function relevantEvent(tab) {
  return tab && tab.windowId === targetWindowId;
}
chrome.tabs.onCreated.addListener((tab) => { if (relevantEvent(tab)) scheduleRefresh(); });
chrome.tabs.onRemoved.addListener((_id, info) => {
  if (info.windowId === targetWindowId) scheduleRefresh();
});
chrome.tabs.onMoved.addListener((_id, info) => {
  if (info.windowId === targetWindowId) scheduleRefresh();
});
chrome.tabs.onActivated.addListener((info) => {
  if (info.windowId === targetWindowId) scheduleRefresh();
});
chrome.tabs.onUpdated.addListener((_id, _changes, tab) => {
  if (relevantEvent(tab)) scheduleRefresh();
});
chrome.tabs.onAttached.addListener((_id, info) => {
  if (info.newWindowId === targetWindowId) scheduleRefresh();
});
chrome.tabs.onDetached.addListener((_id, info) => {
  if (info.oldWindowId === targetWindowId) scheduleRefresh();
});
chrome.tabs.onReplaced.addListener(() => scheduleRefresh());
chrome.tabGroups.onUpdated.addListener((group) => {
  if (group.windowId === targetWindowId) scheduleRefresh();
});
chrome.windows.onRemoved.addListener((id) => {
  if (id === targetWindowId) scheduleRefresh();
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "TARGET_CHANGED") return;
  targetWindowId = Number.isInteger(msg.targetWindowId) ? msg.targetWindowId : null;
  if (msg.reason) message(msg.reason, true);
  scheduleRefresh();
});
chrome.windows.onBoundsChanged.addListener((win) => {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(async () => {
    boundsTimer = 0;
    const manager = await chrome.windows.getCurrent().catch(() => null);
    if (manager?.id !== win.id || win.state !== "normal") return;
    const current = await chrome.windows.get(win.id).catch(() => null);
    const bounds = current && boundsFromWindow(current);
    if (bounds) await saveBounds(bounds).catch(() => {});
  }, 350);
});

async function init() {
  try {
    els.keep.checked = await keepOpenPreference();
    const result = await chrome.runtime.sendMessage({ type: "MANAGER_READY" });
    if (result?.error) throw new Error(result.error);
    targetWindowId = Number.isInteger(result?.targetWindowId) ? result.targetWindowId : null;
    await refresh();
  } catch (error) {
    fail("初始化失败", error);
    await recoverTarget("未能恢复上次绑定");
    await refresh();
  }
}
void init();
