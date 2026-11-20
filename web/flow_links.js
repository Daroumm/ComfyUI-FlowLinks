import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

/**
 * ComfyUI-FlowLinks
 *
 * Animated "water pipe" workflow links + per-type neon node glow.
 *
 * - Links connected to the currently executing node flow faster; the flow
 *   rate follows the real generation speed (steps/s) reported by the frontend.
 * - Faster flow = longer, brighter water segments; bubbles ride the stream.
 * - When a node finishes, its outgoing links ease to a stop (data delivered);
 *   links touching a failed node turn red.
 * - Node glow: every node type gets its own hue (golden-angle spread), the
 *   executing node pulses, and the title bar gets a matching gradient.
 * - Settings live in the "Flow" panel at the bottom-right of the canvas.
 */

const EXT_NAME = "Muse.FlowLinks";
const CFG_KEY = "muse-flow-links-config";

const cfg = Object.assign(
  {
    enabled: true,
    speedMul: 1,
    pipeWidth: 7,
    glow: true,
    idleSpeed: 0.12,
    bubbles: true,
    nodeGlow: true,
    nodePulse: true,
    titleGradient: true,
  },
  (() => {
    try {
      return JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
    } catch (e) {
      return {};
    }
  })()
);

function saveCfg() {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch (e) {
    /* ignore */
  }
}

let executingNodeId = null;
let errorNodeId = null;
let progressRate = 0; // smoothed steps/s of the executing node
let lastProgress = { node: null, value: 0, time: 0 };
const doneNodes = new Set(); // nodes finished in the current run
const linkState = new Map(); // linkId -> {phase, last, speed, origin, target}

function nowSec() {
  return performance.now() / 1000;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

api.addEventListener("execution_start", () => {
  doneNodes.clear();
  errorNodeId = null;
  progressRate = 0;
  lastProgress = { node: null, value: 0, time: 0 };
});
api.addEventListener("executing", (e) => {
  const d = e.detail;
  // Two detail shapes exist: a bare node id (legacy) or {node, display_node, prompt_id}.
  const next =
    d && typeof d === "object" ? (d.node ?? d.display_node ?? null) : (d ?? null);
  if (executingNodeId && String(executingNodeId) !== String(next)) {
    doneNodes.add(String(executingNodeId));
  }
  executingNodeId = next;
  if (!executingNodeId) {
    progressRate = 0;
    lastProgress = { node: null, value: 0, time: 0 };
  }
});
api.addEventListener("execution_success", () => {
  executingNodeId = null;
  progressRate = 0;
});
api.addEventListener("execution_error", (e) => {
  errorNodeId = String(e.detail?.node_id ?? executingNodeId ?? "");
  executingNodeId = null;
  progressRate = 0;
});
api.addEventListener("execution_interrupted", () => {
  executingNodeId = null;
  progressRate = 0;
});
api.addEventListener("progress", (e) => {
  const d = e.detail || {};
  const t = nowSec();
  if (d.node != null && lastProgress.node === d.node && t > lastProgress.time) {
    const inst = (d.value - lastProgress.value) / (t - lastProgress.time);
    if (isFinite(inst) && inst >= 0) {
      progressRate = progressRate * 0.6 + inst * 0.4;
    }
  }
  lastProgress = { node: d.node, value: d.value || 0, time: t };
});
// Fallback for newer frontends: progress_state = {nodes: {id: {value, max, state}}}
api.addEventListener("progress_state", (e) => {
  const nodes = e.detail?.nodes;
  if (!nodes) return;
  const t = nowSec();
  for (const [id, n] of Object.entries(nodes)) {
    if (n?.state === "running" && typeof n.value === "number") {
      if (lastProgress.node === id && t > lastProgress.time) {
        const inst = (n.value - lastProgress.value) / (t - lastProgress.time);
        if (isFinite(inst) && inst >= 0) {
          progressRate = progressRate * 0.6 + inst * 0.4;
        }
      }
      lastProgress = { node: id, value: n.value, time: t };
      if (!executingNodeId) executingNodeId = id;
    }
    if (n?.state === "finished") doneNodes.add(String(id));
  }
});

function isActiveLink(st) {
  if (!executingNodeId) return false;
  return (
    String(st.origin) === String(executingNodeId) ||
    String(st.target) === String(executingNodeId)
  );
}

function isErrorLink(st) {
  if (!errorNodeId) return false;
  return (
    String(st.origin) === errorNodeId || String(st.target) === errorNodeId
  );
}

function targetSpeedFor(st) {
  if (!cfg.enabled) return 0;
  let s;
  if (!executingNodeId) {
    s = cfg.idleSpeed; // idle drift
  } else if (isActiveLink(st)) {
    const factor = progressRate > 0 ? clamp(progressRate / 2, 0.6, 3) : 1.4;
    s = 0.9 * factor; // active link: follows generation speed
  } else if (doneNodes.has(String(st.origin))) {
    s = 0.05; // delivered: ease to a stop
  } else {
    s = 0.25; // not reached yet: slow flow
  }
  return s * cfg.speedMul;
}

function getState(id) {
  let st = linkState.get(id);
  if (!st) {
    if (linkState.size > 5000) linkState.clear(); // cap memory on long sessions
    st = {
      phase: Math.random(),
      last: nowSec(),
      speed: cfg.idleSpeed,
      origin: null,
      target: null,
    };
    linkState.set(id, st);
  }
  return st;
}

// Replacement for CanvasPathRenderer.drawFlowAnimation: the water-pipe renderer.
function flowAnimation(ctx, path, linkData, renderCtx) {
  if (!cfg.enabled || !renderCtx.animation || linkData.disabled) return;
  const st = getState(String(linkData.id));
  const t = nowSec();
  const dt = Math.min(0.1, Math.max(0, t - st.last));
  st.last = t;
  const target = targetSpeedFor(st);
  st.speed += (target - st.speed) * Math.min(1, dt * 3);
  st.phase = (st.phase + dt * st.speed) % 1;

  const active = isActiveLink(st);
  const errored = isErrorLink(st);
  let color = "#38bdf8";
  try {
    color = this.determineLinkColor(linkData, renderCtx, false) || color;
  } catch (e) {
    /* keep the default link color */
  }
  if (errored) color = "#f87171";

  const baseW = renderCtx.style?.connectionWidth || 3;
  // Speed tiers: faster flow -> longer segments, tighter gaps.
  const dashLen = clamp(10 + st.speed * 12, 10, 30);
  const gapLen = clamp(14 - st.speed * 5, 7, 14);
  const period = dashLen + gapLen;
  const offset = -st.phase * period * 6;
  const pulse = errored ? 0.55 + 0.35 * Math.sin(t * 6) : 1;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // 1) Pipe wall: wide translucent stroke.
  ctx.globalAlpha = (active ? 0.3 : 0.16) * pulse;
  ctx.strokeStyle = color;
  ctx.lineWidth = baseW + cfg.pipeWidth;
  ctx.shadowColor = color;
  ctx.shadowBlur = cfg.glow ? (active ? 10 : 5) : 0;
  ctx.stroke(path);
  // 2) Water: bright dashed segments moving forward.
  ctx.globalAlpha = (active ? 0.95 : 0.5) * pulse;
  ctx.lineWidth = Math.max(2, baseW + 1);
  ctx.shadowBlur = cfg.glow ? (active ? 8 : 4) : 0;
  ctx.setLineDash([dashLen, gapLen]);
  ctx.lineDashOffset = offset;
  ctx.strokeStyle = color;
  ctx.stroke(path);
  // 3) Highlight: thinner white dashes on top.
  ctx.globalAlpha = (active ? 0.55 : 0.25) * pulse;
  ctx.lineWidth = Math.max(1, baseW - 1);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke(path);
  ctx.setLineDash([]);
  // 4) Bubbles: small dots riding the stream (fast flow only).
  if (cfg.bubbles && st.speed > 0.3 && !errored) {
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 3; i++) {
      const tt = (st.phase * 1.15 + i * 0.37) % 1;
      let p;
      try {
        p = this.computeConnectionPoint(linkData, tt, renderCtx);
      } catch (e) {
        continue;
      }
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t * 3 + i * 2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.4 + (i % 2) * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Wrap LitegraphLinkAdapter.renderLinkDirect: record link endpoints, force flow on.
function wrapRenderLinkDirect(orig) {
  return function (
    ctx,
    start,
    end,
    link,
    skipBorder,
    flow,
    color,
    startDir,
    endDir,
    renderCtx,
    options
  ) {
    if (link && link.id != null) {
      const st = getState(String(link.id));
      st.origin = link.origin_id;
      st.target = link.target_id;
    }
    return orig.call(
      this,
      ctx,
      start,
      end,
      link,
      skipBorder,
      true,
      color,
      startDir,
      endDir,
      renderCtx,
      options
    );
  };
}

// Rounded-rect path (topOnly rounds just the top corners, for title bars).
function roundRectPath(ctx, x, y, w, h, r, topOnly) {
  const rb = topOnly ? 0 : r;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, rb);
  ctx.arcTo(x, y + h, x, y, rb);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Brighten colors that are too dark to glow (some nodes ship dark title colors).
function brighten(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color || ""));
  if (!m) return color;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum >= 0.35) return color;
  const k = lum > 0.02 ? 0.5 / lum : 4;
  r = Math.min(255, Math.round(r * k + 40));
  g = Math.min(255, Math.round(g * k + 40));
  b = Math.min(255, Math.round(b * k + 40));
  return `rgb(${r},${g},${b})`;
}

// Per-type color: hash the node type to a hue (golden-angle spread) so every
// type gets a distinct color; same-type nodes share it, with a slight
// per-id lightness variation so individual frames still differ a bit.
function typeHueColor(node) {
  const t = String(node.type || "");
  if (!t) return null;
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  const hue = Math.round((h * 137.508) % 360);
  const idNum = parseInt(String(node.id), 10);
  const dl = Number.isFinite(idNum) ? ((idNum * 7) % 13) - 6 : 0;
  return `hsl(${hue}, 85%, ${62 + dl}%)`;
}

// Node color priority: per-type > output-type > node color (brightened) > default blue; red on error.
function nodeColorFor(canvas, node) {
  const id = String(node.id);
  if (errorNodeId && id === errorNodeId) return "#f87171";
  const tc = typeHueColor(node);
  if (tc) return tc;
  const outType = node.outputs?.[0]?.type;
  const color =
    (outType && canvas?.default_connection_color_byType?.[outType]) ||
    (outType && window.LiteGraph?.LGraphCanvas?.link_type_colors?.[outType]) ||
    node.color ||
    "#38bdf8";
  return brighten(color);
}

// Node glow (overlay version): draw glowing frames on a transparent canvas
// stacked above the graph canvas. Nodes with DOM widgets (Load Image, text
// encoders, ...) would cover frames drawn on the graph canvas itself, so the
// overlay draws above everything and every node gets its frame.
let overlayCanvas = null;
let overlayCtx = null;
function setupOverlay() {
  try {
    const gc = app.canvas?.canvas;
    if (!gc || !gc.parentElement) return false;
    overlayCanvas = document.createElement("canvas");
    overlayCanvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:50;";
    gc.parentElement.appendChild(overlayCanvas);
    overlayCtx = overlayCanvas.getContext("2d");
    return !!overlayCtx;
  } catch (e) {
    return false;
  }
}
function graphToScreen(x, y) {
  const c = app.canvas;
  if (c && typeof c.convertOffsetToCanvas === "function") {
    return c.convertOffsetToCanvas([x, y]);
  }
  const ds = c?.ds || { scale: 1, offset: [0, 0] };
  return [(x + ds.offset[0]) * ds.scale, (y + ds.offset[1]) * ds.scale];
}
function drawOverlayGlow() {
  if (!overlayCtx || !overlayCanvas) return;
  const gc = app.canvas?.canvas;
  const graph = app.graph;
  if (!gc || !graph || !Array.isArray(graph._nodes)) return;
  // Self-heal: if the frontend rebuilds the canvas element, re-attach the overlay.
  if (!overlayCanvas.isConnected || overlayCanvas.parentElement !== gc.parentElement) {
    try {
      gc.parentElement.appendChild(overlayCanvas);
    } catch (e) {
      return;
    }
  }
  const dpr = window.devicePixelRatio || 1;
  const cw = gc.clientWidth;
  const ch = gc.clientHeight;
  if (overlayCanvas.width !== Math.round(cw * dpr)) {
    overlayCanvas.width = Math.round(cw * dpr);
    overlayCanvas.height = Math.round(ch * dpr);
  }
  const ctx = overlayCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!cfg.enabled || !cfg.nodeGlow) return;
  const scale = app.canvas?.ds?.scale || 1;
  const titleH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const t = nowSec();
  for (const node of graph._nodes) {
    if (!node || !node.size || !node.pos) continue;
    const id = String(node.id);
    const isExec = executingNodeId != null && id === String(executingNodeId);
    const isDone = doneNodes.has(id);
    const color = nodeColorFor(app.canvas, node);
    const collapsed = !!node.flags?.collapsed;
    const gx = node.pos[0];
    const gy = node.pos[1] - titleH;
    const gw = node.size[0];
    const gh = collapsed ? titleH : node.size[1] + titleH;
    const [sx, sy] = graphToScreen(gx, gy);
    const sw = gw * scale;
    const sh = gh * scale;
    if (sx + sw < 0 || sy + sh < 0 || sx > cw || sy > ch) continue;
    const pulse = isExec && cfg.nodePulse ? 0.65 + 0.35 * Math.sin(t * 5) : 1;
    ctx.save();
    if (cfg.titleGradient && !collapsed) {
      const g = ctx.createLinearGradient(sx, 0, sx + sw, 0);
      g.addColorStop(0, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = g;
      roundRectPath(ctx, sx, sy, sw, titleH * scale, 8 * scale, true);
      ctx.fill();
    }
    ctx.globalAlpha = isDone && !isExec ? 0.45 : 0.95;
    ctx.strokeStyle = color;
    ctx.lineWidth = (isExec ? 5.0 : 3.6) * Math.max(0.6, scale);
    ctx.shadowColor = color;
    ctx.shadowBlur = (isExec ? 26 : 14) * pulse * Math.max(0.6, scale);
    roundRectPath(ctx, sx - 3, sy - 3, sw + 6, sh + 6, 10 * scale);
    ctx.stroke();
    ctx.restore();
  }
}

// Canvas fallback for node glow (when the overlay is unavailable): draw after drawNode.
function drawNodeGlow(canvas, node, ctx) {
  if (!cfg.enabled || !cfg.nodeGlow || !node || !node.size || !node.pos) return;
  const color = nodeColorFor(canvas, node);
  const titleH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const w = node.size[0];
  const collapsed = !!node.flags?.collapsed;
  const x = node.pos[0];
  const y = node.pos[1] - titleH;
  const hh = collapsed ? titleH : node.size[1] + titleH;
  const id = String(node.id);
  const isExec = executingNodeId != null && id === String(executingNodeId);
  const isDone = doneNodes.has(id);
  const t = nowSec();
  const pulse = isExec && cfg.nodePulse ? 0.65 + 0.35 * Math.sin(t * 5) : 1;
  ctx.save();
  if (cfg.titleGradient && !collapsed) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = g;
    roundRectPath(ctx, x, y, w, titleH, 8, true);
    ctx.fill();
  }
  ctx.globalAlpha = isDone && !isExec ? 0.4 : 0.95;
  ctx.strokeStyle = color;
  ctx.lineWidth = isExec ? 5.0 : 3.6;
  ctx.shadowColor = color;
  ctx.shadowBlur = (isExec ? 26 : 14) * pulse;
  roundRectPath(ctx, x - 3, y - 3, w + 6, hh + 6, 10);
  ctx.stroke();
  ctx.restore();
}

// Wrap LGraphCanvas.drawNode: paint the glow layer right after the node itself.
function wrapDrawNode(orig) {
  return function (node, ctx) {
    const r = orig.call(this, node, ctx);
    try {
      drawNodeGlow(this, node, ctx);
    } catch (e) {
      /* glow errors must never break node rendering */
    }
    return r;
  };
}

// UI strings follow the ComfyUI language (Comfy.Locale setting). The locale
// only changes on page reload in ComfyUI, so detecting once at panel build
// time is enough.
const STRINGS = {
  en: {
    button: "Flow",
    title: "FlowLinks Settings",
    enabled: "Enable flow",
    speedMul: "Flow speed",
    pipeWidth: "Pipe width",
    glow: "Glow",
    bubbles: "Bubbles",
    idleSpeed: "Idle speed",
    nodeGlow: "Node glow",
    nodePulse: "Pulse while running",
    titleGradient: "Title gradient",
  },
  zh: {
    button: "流水",
    title: "流水连线设置",
    enabled: "启用流水",
    speedMul: "流速倍率",
    pipeWidth: "管径",
    glow: "辉光",
    bubbles: "气泡",
    idleSpeed: "空闲流速",
    nodeGlow: "节点荧光",
    nodePulse: "执行脉冲",
    titleGradient: "标题渐变",
  },
};

function detectLocale() {
  try {
    const v =
      app?.extensionManager?.setting?.get?.("Comfy.Locale") ??
      app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    if (typeof v === "string" && v) return v.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch (e) {
    /* fall through to browser language */
  }
  return (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}

// Settings panel (bottom-right). Deliberately independent of the frontend
// settings API so it works across frontend versions.
function buildPanel() {
  if (document.getElementById("muse-flow-btn")) return;
  const t = STRINGS[detectLocale()];
  const btn = document.createElement("button");
  btn.id = "muse-flow-btn";
  btn.textContent = t.button;
  btn.style.cssText =
    "position:fixed;right:12px;bottom:12px;z-index:9999;padding:6px 12px;border-radius:16px;border:1px solid rgba(255,255,255,.25);background:rgba(15,23,42,.85);color:#e2e8f0;font-size:12px;cursor:pointer;";
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:12px;bottom:48px;z-index:9999;width:220px;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(15,23,42,.92);color:#e2e8f0;font-size:12px;display:none;";
  const row = (label, input) => {
    const d = document.createElement("div");
    d.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;margin:6px 0;";
    const s = document.createElement("span");
    s.textContent = label;
    d.appendChild(s);
    d.appendChild(input);
    return d;
  };
  const mkCheck = (key) => {
    const i = document.createElement("input");
    i.type = "checkbox";
    i.checked = !!cfg[key];
    i.onchange = () => {
      cfg[key] = i.checked;
      saveCfg();
    };
    return i;
  };
  const mkRange = (key, min, max, step) => {
    const i = document.createElement("input");
    i.type = "range";
    i.min = min;
    i.max = max;
    i.step = step;
    i.value = cfg[key];
    i.style.width = "110px";
    i.oninput = () => {
      cfg[key] = parseFloat(i.value);
      saveCfg();
    };
    return i;
  };
  const title = document.createElement("div");
  title.textContent = t.title;
  title.style.cssText = "font-weight:600;margin-bottom:4px;";
  panel.appendChild(title);
  panel.appendChild(row(t.enabled, mkCheck("enabled")));
  panel.appendChild(row(t.speedMul, mkRange("speedMul", 0.2, 3, 0.1)));
  panel.appendChild(row(t.pipeWidth, mkRange("pipeWidth", 2, 14, 1)));
  panel.appendChild(row(t.glow, mkCheck("glow")));
  panel.appendChild(row(t.bubbles, mkCheck("bubbles")));
  panel.appendChild(row(t.idleSpeed, mkRange("idleSpeed", 0, 0.5, 0.02)));
  panel.appendChild(row(t.nodeGlow, mkCheck("nodeGlow")));
  panel.appendChild(row(t.nodePulse, mkCheck("nodePulse")));
  panel.appendChild(row(t.titleGradient, mkCheck("titleGradient")));
  btn.onclick = () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  };
  document.body.appendChild(btn);
  document.body.appendChild(panel);
}

app.registerExtension({
  name: EXT_NAME,
  async setup() {
    const canvas = app.canvas;
    // Link flow: a takeover failure must not take down node glow or the panel.
    try {
      const adapter = canvas?.linkRenderer;
      const renderer = adapter?.pathRenderer;
      if (adapter && renderer) {
        const adapterProto = Object.getPrototypeOf(adapter);
        const rendererProto = Object.getPrototypeOf(renderer);
        if (!adapterProto.__museFlowPatched) {
          adapterProto.__museFlowPatched = true;
          adapterProto.renderLinkDirect = wrapRenderLinkDirect(
            adapterProto.renderLinkDirect
          );
        }
        if (!rendererProto.__museFlowPatched) {
          rendererProto.__museFlowPatched = true;
          rendererProto.drawFlowAnimation = flowAnimation;
        }
      } else {
        console.warn("[FlowLinks] linkRenderer/pathRenderer not found; link flow disabled (node glow unaffected)");
      }
    } catch (e) {
      console.warn("[FlowLinks] failed to take over link rendering (node glow unaffected)", e);
    }
    // Node glow: overlay first; fall back to the drawNode wrap if unavailable.
    const overlayOk = setupOverlay();
    if (!overlayOk) {
      const canvasProto = Object.getPrototypeOf(canvas);
      if (canvasProto && typeof canvasProto.drawNode === "function") {
        if (!canvasProto.__museNodeGlowPatched) {
          canvasProto.__museNodeGlowPatched = true;
          canvasProto.drawNode = wrapDrawNode(canvasProto.drawNode);
        }
      } else {
        console.warn("[FlowLinks] neither overlay nor drawNode available; node glow disabled");
      }
    }
    buildPanel();
    // Drive the animation with a rAF loop (~30fps, paused when hidden).
    // Re-read app.canvas every frame so tab switches never break rendering.
    let lastFrame = 0;
    const loop = (ts) => {
      requestAnimationFrame(loop);
      if (document.hidden) return;
      if (ts - lastFrame < 33) return;
      lastFrame = ts;
      try {
        drawOverlayGlow();
      } catch (e) {
        /* overlay errors must never break the canvas */
      }
      const c = app.canvas;
      if (c) {
        try {
          c.setDirty(true, true);
        } catch (e) {
          /* ignore */
        }
      }
    };
    requestAnimationFrame(loop);
    console.log("[FlowLinks] v0.1.0-beta.1 enabled");
  },
});
