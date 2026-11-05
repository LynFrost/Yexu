// Shared pure logic. The browser's actual tab.index is always authoritative.
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function orderedTabs(tabs) {
  return [...tabs].sort((a, b) => a.index - b.index);
}

export function displayTitle(tab) {
  return (tab.title || "").trim() || tab.url || "未命名标签页";
}

export function isWebUrl(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function segmentKey(tab) {
  if (tab.pinned) return "pinned";
  return tab.groupId === undefined || tab.groupId === -1 ? "ungrouped" : "group:" + tab.groupId;
}

// Only contiguous members with identical pin/group status may exchange places.
// Separate ungrouped stretches across a group must remain separate.
export function safeSegments(tabs) {
  const list = orderedTabs(tabs);
  const segments = [];
  for (let i = 0; i < list.length;) {
    const key = segmentKey(list[i]);
    let end = i + 1;
    while (end < list.length && segmentKey(list[end]) === key) end++;
    segments.push({ start: i, end, key, tabs: list.slice(i, end), pinned: !!list[i].pinned });
    i = end;
  }
  return segments;
}

export function manualMove(tabs, sourceId, targetId, side) {
  const list = orderedTabs(tabs);
  const source = list.findIndex((tab) => tab.id === sourceId);
  const target = list.findIndex((tab) => tab.id === targetId);
  if (source < 0 || target < 0 || (side !== "before" && side !== "after")) return null;
  const segment = safeSegments(list).find((s) => source >= s.start && source < s.end);
  if (!segment || target < segment.start || target >= segment.end) return null;
  const insertion = target + (side === "after" ? 1 : 0);
  const destination = insertion > source ? insertion - 1 : insertion;
  if (destination < segment.start || destination >= segment.end || destination === source) return null;
  return { tabId: sourceId, index: destination };
}

function sortKey(tab, field) {
  if (field === "title") return displayTitle(tab);
  if (field === "domain") return hostname(tab.url);
  if (field === "url") {
    try { return new URL(tab.url).href; } catch { return tab.url || ""; }
  }
  throw new Error("不支持的排序方式");
}

export function planAutomaticSort(tabs, field, direction) {
  if (!["title", "domain", "url"].includes(field) || !["asc", "desc"].includes(direction)) {
    throw new Error("无效的排序选项");
  }
  const working = orderedTabs(tabs);
  const moves = [];
  const segments = safeSegments(working);
  for (const segment of segments) {
    if (segment.pinned || segment.tabs.length < 2) continue;
    const desired = [...segment.tabs].sort((a, b) => {
      const aWeb = isWebUrl(a.url);
      const bWeb = isWebUrl(b.url);
      if (aWeb !== bWeb) return aWeb ? -1 : 1;
      // Internal/extension/empty URLs retain their original relative order.
      if (!aWeb) return a.index - b.index;
      const primary = collator.compare(sortKey(a, field), sortKey(b, field));
      if (primary) return direction === "asc" ? primary : -primary;
      if (field === "domain") {
        const secondary = collator.compare(displayTitle(a), displayTitle(b));
        if (secondary) return direction === "asc" ? secondary : -secondary;
      }
      return a.index - b.index;
    });
    for (let dest = segment.start; dest < segment.end; dest++) {
      const wanted = desired[dest - segment.start].id;
      const from = working.findIndex((tab) => tab.id === wanted);
      if (from !== dest) {
        moves.push({ tabId: wanted, index: dest });
        const [item] = working.splice(from, 1);
        working.splice(dest, 0, item);
      }
    }
  }
  return {
    moves,
    // A protected group/pinned block must not be crossed to achieve global sorting.
    protectedBlocks: segments.filter((s) => s.pinned || s.key.startsWith("group:")).length,
    finalIds: working.map((tab) => tab.id)
  };
}
