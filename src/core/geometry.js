export const DEFAULT_BOUNDS = Object.freeze({ width: 500, height: 600 });
export const MIN_WIDTH = 360;
export const MIN_HEIGHT = 300;

export function validBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return false;
  return ["left", "top", "width", "height"].every((k) =>
    typeof bounds[k] === "number" && Number.isFinite(bounds[k])
  ) && bounds.width > 0 && bounds.height > 0;
}

function intersection(a, b) {
  const width = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return width * height;
}

export function availableDisplays(displays) {
  return (displays || []).filter((d) => d.isEnabled !== false && d.workArea &&
    d.workArea.width > 0 && d.workArea.height > 0);
}

export function displayForBounds(bounds, displays) {
  const usable = availableDisplays(displays);
  if (!usable.length) return null;
  if (validBounds(bounds)) {
    const byOverlap = [...usable].sort((a, b) =>
      intersection(bounds, b.workArea) - intersection(bounds, a.workArea));
    if (intersection(bounds, byOverlap[0].workArea) > 0) return byOverlap[0];
  }
  return usable.find((d) => d.isPrimary) || usable[0];
}

export function fitInWorkArea(bounds, displays) {
  if (!validBounds(bounds)) return null;
  const display = displayForBounds(bounds, displays);
  if (!display) return { ...bounds };
  const area = display.workArea;
  const width = Math.min(Math.max(Math.round(bounds.width), Math.min(MIN_WIDTH, area.width)), area.width);
  const height = Math.min(Math.max(Math.round(bounds.height), Math.min(MIN_HEIGHT, area.height)), area.height);
  return {
    left: Math.round(Math.max(area.left, Math.min(bounds.left, area.left + area.width - width))),
    top: Math.round(Math.max(area.top, Math.min(bounds.top, area.top + area.height - height))),
    width,
    height
  };
}

export function boundsFromWindow(win) {
  const bounds = { left: win.left, top: win.top, width: win.width, height: win.height };
  return validBounds(bounds) ? bounds : null;
}
