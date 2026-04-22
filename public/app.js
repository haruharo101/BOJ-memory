const form = document.querySelector("#memory-form");
const handleInput = document.querySelector("#handle");
const message = document.querySelector("#form-message");
const memory = document.querySelector("#memory");
const intro = document.querySelector(".intro");
const backupImportTrigger = document.querySelector("#backup-import-trigger");
const backupImportInput = document.querySelector("#backup-import-input");
const graphCanvas = document.querySelector("#graph-flow");
const storyNav = document.querySelector("#story-nav");
const storyNavCurrent = document.querySelector("#story-nav-current");

const numberFormatter = new Intl.NumberFormat("ko-KR");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const apiBaseUrl = (window.BOJ_MEMORY_API_BASE_URL || "").replace(/\/$/, "");
let storyObserver;
let activeCategory = "";
let mobileNavFrame = 0;
let mobileNavCategory = "";
const storyIntersectionRatios = new WeakMap();
const numberAnimationFrames = new WeakMap();
const panelResetTimers = new WeakMap();
const tierAnimationTimers = new WeakMap();
const profileImageWidth = 1000;
const profileImageHeight = 600;
const profileRenderScale = 2;
const reportPageWidth = 1400;
const reportPageHeight = 900;
const reportRenderScale = 2;
const backupImportMaxBytes = 2 * 1024 * 1024;
const canvasFontFamily = "Pretendard, system-ui, sans-serif";
const coverFontPresets = [
  {
    id: "pretendard",
    label: "Pretendard",
    meta: "기본",
    family: "Pretendard, system-ui, sans-serif",
    loadFamily: "Pretendard",
  },
  {
    id: "a2z",
    label: "A2z",
    meta: "에이투지체",
    family: "A2z, Pretendard, system-ui, sans-serif",
    loadFamily: "A2z",
  },
  {
    id: "paperozi",
    label: "Paperozi",
    meta: "Paperlogy",
    family: "Paperozi, Pretendard, system-ui, sans-serif",
    loadFamily: "Paperozi",
  },
  {
    id: "gmarket",
    label: "Gmarket Sans",
    meta: "굵고 선명한",
    family: "GmarketSans, Pretendard, system-ui, sans-serif",
    loadFamily: "GmarketSans",
  },
];
const coverFontPresetById = new Map(coverFontPresets.map((preset) => [preset.id, preset]));
const coverFontWeights = [
  { value: 500, label: "Medium" },
  { value: 700, label: "Bold" },
  { value: 800, label: "ExtraBold" },
  { value: 900, label: "Black" },
];
const coverFontSizeRange = { min: 8, max: 96 };
const coverFontSizeInputMax = 100000000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createDefaultCoverOptions() {
  return {
    showMeta: true,
    backgroundMode: "dual",
    rearBlur: 12,
    rearOpacity: 82,
    frontBlur: 0,
    frontOpacity: 62,
  };
}

function getCoverFontPreset(fontPresetId) {
  return coverFontPresetById.get(fontPresetId) ?? coverFontPresetById.get("pretendard");
}

function normalizeTypographyRole(roleOptions, defaults) {
  const font = coverFontPresetById.has(roleOptions?.font) ? roleOptions.font : defaults.font;
  const weight = coverFontWeights.some((item) => item.value === Number(roleOptions?.weight))
    ? Number(roleOptions.weight)
    : defaults.weight;
  const parsedSize = Number(roleOptions?.size);
  const size = Number.isFinite(parsedSize)
    ? clamp(Math.round(parsedSize), coverFontSizeRange.min, coverFontSizeRange.max)
    : defaults.size;
  return { font, weight, size };
}

function sanitizeFontSizeInputValue(value) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  return String(Math.min(Number(digits.slice(0, 9)), coverFontSizeInputMax));
}

function resolveAppliedFontSizeValue(value, fallback) {
  if (!value) return fallback;
  return clamp(Number(value), coverFontSizeRange.min, coverFontSizeRange.max);
}

function createDefaultTypographyOptions() {
  return {
    handle: { font: "pretendard", weight: 900, size: 50 },
    bio: { font: "pretendard", weight: 500, size: 14 },
    ranking: { font: "pretendard", weight: 700, size: 13 },
    statLabel: { font: "pretendard", weight: 700, size: 12 },
    statValue: { font: "pretendard", weight: 900, size: 22 },
    ratingLabel: { font: "pretendard", weight: 700, size: 13 },
    ratingValue: { font: "pretendard", weight: 900, size: 38 },
    tier: { font: "pretendard", weight: 900, size: 16 },
    meta: { font: "pretendard", weight: 500, size: 11 },
  };
}

function normalizeTypographyOptions(typography = {}) {
  const defaults = createDefaultTypographyOptions();
  return {
    handle: normalizeTypographyRole(typography.handle, defaults.handle),
    bio: normalizeTypographyRole(typography.bio, defaults.bio),
    ranking: normalizeTypographyRole(typography.ranking, defaults.ranking),
    statLabel: normalizeTypographyRole(typography.statLabel, defaults.statLabel),
    statValue: normalizeTypographyRole(typography.statValue, defaults.statValue),
    ratingLabel: normalizeTypographyRole(typography.ratingLabel, defaults.ratingLabel),
    ratingValue: normalizeTypographyRole(typography.ratingValue, defaults.ratingValue),
    tier: normalizeTypographyRole(typography.tier, defaults.tier),
    meta: normalizeTypographyRole(typography.meta, defaults.meta),
  };
}

function resolveTypography(typographyOptions = createDefaultTypographyOptions()) {
  const normalized = normalizeTypographyOptions(typographyOptions);
  return Object.fromEntries(
    Object.entries(normalized).map(([key, value]) => [
      key,
      {
        ...value,
        family: getCoverFontPreset(value.font).family,
        loadFamily: getCoverFontPreset(value.font).loadFamily,
      },
    ]),
  );
}

function scaleRoleMetric(role, metric, defaultSize) {
  const roleSize = role?.size ?? defaultSize;
  return Math.max(1, Math.round(metric * (roleSize / defaultSize)));
}

function normalizeCoverOptions(coverOptions = {}) {
  const defaults = createDefaultCoverOptions();
  const backgroundMode = coverOptions.backgroundMode === "rear" ? "rear" : "dual";
  return {
    showMeta: coverOptions.showMeta ?? defaults.showMeta,
    backgroundMode,
    rearBlur: clamp(Number(coverOptions.rearBlur ?? defaults.rearBlur), 0, 32),
    rearOpacity: clamp(Number(coverOptions.rearOpacity ?? defaults.rearOpacity), 0, 100),
    frontBlur: clamp(Number(coverOptions.frontBlur ?? defaults.frontBlur), 0, 24),
    frontOpacity: clamp(Number(coverOptions.frontOpacity ?? defaults.frontOpacity), 0, 100),
  };
}

function normalizeProfileOptions(profileOptions = "left") {
  if (typeof profileOptions === "string") {
    return {
      layout: profileOptions === "right" ? "right" : "left",
      typography: createDefaultTypographyOptions(),
      cover: createDefaultCoverOptions(),
    };
  }

  return {
    layout: profileOptions?.layout === "right" ? "right" : "left",
    typography: normalizeTypographyOptions(profileOptions?.typography),
    cover: normalizeCoverOptions(profileOptions?.cover),
  };
}

function pinInitialSearchPosition() {
  if (window.location.hash) return;
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  requestAnimationFrame(() => {
    if (memory.childElementCount) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}

function syncSearchScrollLock() {
  document.body.classList.toggle("search-scroll-locked", memory.childElementCount === 0);
}

function startMemoryGraph(canvas) {
  if (!canvas) return;

  const context = canvas.getContext("2d");
  const nodes = [];
  const links = [];
  const pointer = { x: 0, y: 0, active: false };
  let width = 0;
  let height = 0;
  let animationFrame = 0;
  let nextGraphShift = 0;

  function createNode(index) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    return {
      x,
      y,
      baseX: x,
      baseY: y,
      radius: 2.4 + Math.random() * 2.8,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.2 + Math.random() * 0.72,
      targetAlpha: 0.42 + Math.random() * 0.5,
      drift: 0.45 + Math.random() * 0.9,
      nextChange: 900 + Math.random() * 5800,
      hue: index % 4,
    };
  }

  function createLink(firstIndex, secondIndex, delay = 0) {
    const targetAlpha = 0.14 + Math.random() * 0.16;
    return {
      firstIndex,
      secondIndex,
      alpha: 0,
      targetAlpha,
      nextChange: delay + 1800 + Math.random() * 7200,
    };
  }

  function targetNodeCount() {
    return Math.min(72, Math.max(32, Math.floor((width * height) / 18000)));
  }

  function initializeGraph(time = 0) {
    const nodeCount = targetNodeCount();
    nodes.length = 0;
    links.length = 0;

    for (let index = 0; index < nodeCount; index += 1) {
      nodes.push(createNode(index));
    }

    rebuildLinks(time);
  }

  function resize({ reset = false } = {}) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const previousWidth = width;
    const previousHeight = height;
    const nextWidth = window.innerWidth;
    const nextHeight = window.innerHeight;
    width = nextWidth;
    height = nextHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (reset || !nodes.length || !previousWidth || !previousHeight) {
      initializeGraph(performance.now());
      return;
    }

    const scaleX = width / previousWidth;
    const scaleY = height / previousHeight;
    for (const node of nodes) {
      node.baseX = Math.min(width, Math.max(0, node.baseX * scaleX));
      node.baseY = Math.min(height, Math.max(0, node.baseY * scaleY));
      node.x = Math.min(width, Math.max(0, node.x * scaleX));
      node.y = Math.min(height, Math.max(0, node.y * scaleY));
    }
  }

  function nearestNodeIndexes(index, limit) {
    const origin = nodes[index];
    return nodes
      .map((node, nodeIndex) => ({
        index: nodeIndex,
        distance: nodeIndex === index ? Number.POSITIVE_INFINITY : Math.hypot(origin.x - node.x, origin.y - node.y),
      }))
      .sort((first, second) => first.distance - second.distance)
      .slice(0, limit)
      .map((entry) => entry.index);
  }

  function rebuildLinks(time) {
    const seen = new Set();
    const targetCount = Math.floor(nodes.length * 0.58);
    links.length = 0;

    for (let index = 0; index < nodes.length && links.length < targetCount; index += 1) {
      if (Math.random() < 0.5) continue;

      const candidates = nearestNodeIndexes(index, 4);
      const nextIndex = candidates[Math.floor(Math.random() * candidates.length)];
      const firstIndex = Math.min(index, nextIndex);
      const secondIndex = Math.max(index, nextIndex);
      const key = `${firstIndex}:${secondIndex}`;

      if (!seen.has(key)) {
        seen.add(key);
        links.push(createLink(firstIndex, secondIndex, time));
      }
    }

    nextGraphShift = time + 4200 + Math.random() * 3600;
  }

  function updateNode(node, time) {
    if (time > node.nextChange) {
      const fadingOut = Math.random() < 0.42;
      node.targetAlpha = fadingOut ? 0.04 + Math.random() * 0.08 : 0.48 + Math.random() * 0.45;
      node.nextChange = time + 2400 + Math.random() * 7200;
    }

    node.alpha += (node.targetAlpha - node.alpha) * 0.018;

    if (node.alpha < 0.08 && node.targetAlpha < 0.12 && Math.random() < 0.006) {
      node.baseX = Math.random() * width;
      node.baseY = Math.random() * height;
      node.x = node.baseX;
      node.y = node.baseY;
      node.targetAlpha = 0.5 + Math.random() * 0.36;
    }

    const motionScale = 1;
    node.x = node.baseX + Math.cos(time * 0.00038 * node.drift + node.phase) * 14 * motionScale;
    node.y = node.baseY + Math.sin(time * 0.00031 * node.drift + node.phase) * 14 * motionScale;

    if (pointer.active) {
      const dx = pointer.x - node.x;
      const dy = pointer.y - node.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 170) {
        node.x -= dx * 0.024 * (1 - distance / 170) * motionScale;
        node.y -= dy * 0.024 * (1 - distance / 170) * motionScale;
      }
    }
  }

  function updateLink(link, time) {
    if (time > link.nextChange) {
      link.targetAlpha = link.targetAlpha > 0.03 ? 0 : 0.13 + Math.random() * 0.18;
      link.nextChange = time + 1800 + Math.random() * 6200;
    }

    link.alpha += (link.targetAlpha - link.alpha) * 0.026;
  }

  function drawLinks() {
    context.lineCap = "round";

    for (const link of links) {
      const first = nodes[link.firstIndex];
      const second = nodes[link.secondIndex];
      const alpha = Math.min(first.alpha, second.alpha) * link.alpha;
      if (alpha < 0.006) continue;

      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.strokeStyle = `rgba(58, 176, 158, ${alpha})`;
      context.lineWidth = 1.15;
      context.stroke();
    }
  }

  function drawNodes() {
    for (const node of nodes) {
      const glow = node.hue === 1 ? "119, 118, 150" : node.hue === 2 ? "245, 247, 246" : "58, 176, 158";

      context.beginPath();
      context.arc(node.x, node.y, node.radius * 2.7, 0, Math.PI * 2);
      context.fillStyle = `rgba(${glow}, ${node.alpha * 0.08})`;
      context.fill();

      context.beginPath();
      context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(${glow}, ${node.alpha})`;
      context.fill();
    }
  }

  function tick(time = 0) {
    context.clearRect(0, 0, width, height);

    if (time > nextGraphShift) {
      rebuildLinks(time);
    }

    for (const node of nodes) updateNode(node, time);
    for (const link of links) updateLink(link, time);

    drawLinks();
    drawNodes();

    animationFrame = requestAnimationFrame(tick);
  }

  function restart() {
    cancelAnimationFrame(animationFrame);
    resize({ reset: true });
    tick();
  }

  function handleResize() {
    resize();
  }

  window.addEventListener("resize", handleResize, { passive: true });
  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  });
  window.addEventListener("pointerleave", () => {
    pointer.active = false;
  });
  reducedMotion.addEventListener("change", restart);

  restart();
}

function formatNumber(value) {
  return numberFormatter.format(Number(value || 0));
}

function formatOverRating(value) {
  if (value === undefined || value === null || value === "") return "--";
  return (Number(value) / 10).toLocaleString("ko-KR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

const overRatingLightness = 0.42;

function lightenRgbColor(color, lightness = overRatingLightness) {
  const match = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!match) return color;

  const [, red, green, blue] = match.map(Number);
  const lighten = (channel) => Math.round(channel + (255 - channel) * lightness);
  return `rgb(${lighten(red)}, ${lighten(green)}, ${lighten(blue)})`;
}

function lightenOverRatingStops(stops) {
  return stops.map(([offset, color]) => [offset, lightenRgbColor(color)]);
}

function overRatingCssGradient(stops) {
  return `linear-gradient(135deg, ${stops
    .map(([offset, color]) => `${color} ${Math.round(offset * 1000) / 10}%`)
    .join(", ")})`;
}

const overRatingGradientBands = [
  {
    minimum: 160000,
    css:
      "linear-gradient(135deg, rgb(29, 255, 255), rgb(11, 176, 255), rgb(248, 71, 255), rgb(234, 13, 0), rgb(255, 251, 0), rgb(32, 216, 0))",
    stops: [
      [0, "rgb(29, 255, 255)"],
      [0.2, "rgb(11, 176, 255)"],
      [0.4, "rgb(248, 71, 255)"],
      [0.6, "rgb(234, 13, 0)"],
      [0.8, "rgb(255, 251, 0)"],
      [1, "rgb(32, 216, 0)"],
    ],
  },
  {
    minimum: 150000,
    css:
      "linear-gradient(135deg, rgb(126, 226, 179), rgb(107, 200, 254), rgb(145, 243, 127), rgb(255, 241, 39), rgb(255, 183, 92), rgb(253, 176, 172), rgb(255, 183, 92), rgb(255, 241, 39), rgb(145, 243, 127), rgb(107, 200, 254))",
    stops: [
      [0, "rgb(126, 226, 179)"],
      [0.111, "rgb(107, 200, 254)"],
      [0.222, "rgb(145, 243, 127)"],
      [0.333, "rgb(255, 241, 39)"],
      [0.444, "rgb(255, 183, 92)"],
      [0.555, "rgb(253, 176, 172)"],
      [0.666, "rgb(255, 183, 92)"],
      [0.777, "rgb(255, 241, 39)"],
      [0.888, "rgb(145, 243, 127)"],
      [1, "rgb(107, 200, 254)"],
    ],
  },
  {
    minimum: 140000,
    css:
      "linear-gradient(135deg, rgb(255, 207, 95), rgb(255, 194, 80) 28%, rgb(255, 255, 102) 31%, rgb(255, 255, 109), rgb(255, 209, 109), rgb(255, 255, 84) 58%, rgb(255, 183, 74) 64%, rgb(255, 180, 67), rgb(255, 255, 255))",
    stops: [
      [0, "rgb(255, 207, 95)"],
      [0.28, "rgb(255, 194, 80)"],
      [0.31, "rgb(255, 255, 102)"],
      [0.44, "rgb(255, 255, 109)"],
      [0.52, "rgb(255, 209, 109)"],
      [0.58, "rgb(255, 255, 84)"],
      [0.64, "rgb(255, 183, 74)"],
      [0.82, "rgb(255, 180, 67)"],
      [1, "rgb(255, 255, 255)"],
    ],
  },
  {
    minimum: 130000,
    css:
      "linear-gradient(135deg, rgb(207, 215, 247), rgb(127, 145, 249), rgb(127, 190, 249) 45%, rgb(160, 239, 255) 47%, rgb(98, 233, 248), rgb(252, 242, 130))",
    stops: [
      [0, "rgb(207, 215, 247)"],
      [0.25, "rgb(127, 145, 249)"],
      [0.45, "rgb(127, 190, 249)"],
      [0.47, "rgb(160, 239, 255)"],
      [0.68, "rgb(98, 233, 248)"],
      [1, "rgb(252, 242, 130)"],
    ],
  },
  {
    minimum: 120000,
    css:
      "linear-gradient(135deg, rgb(247, 226, 207), rgb(249, 164, 127), rgb(249, 164, 127) 45%, rgb(255, 225, 160) 47%, rgb(248, 128, 98), rgb(252, 173, 130))",
    stops: [
      [0, "rgb(247, 226, 207)"],
      [0.25, "rgb(249, 164, 127)"],
      [0.45, "rgb(249, 164, 127)"],
      [0.47, "rgb(255, 225, 160)"],
      [0.68, "rgb(248, 128, 98)"],
      [1, "rgb(252, 173, 130)"],
    ],
  },
].map((band) => {
  const stops = lightenOverRatingStops(band.stops);
  return {
    ...band,
    css: overRatingCssGradient(stops),
    stops,
  };
});

function overRatingGradientBand(value) {
  const numericValue = Number(value || 0);
  return overRatingGradientBands.find((band) => numericValue >= band.minimum) ?? null;
}

function createOverRatingCanvasGradient(context, value, x, y, width, height, fallback = "#ffffff") {
  const band = overRatingGradientBand(value);
  if (!band) return fallback;

  const gradient = context.createLinearGradient(x, y, x + width, y + height);
  for (const [offset, color] of band.stops) {
    gradient.addColorStop(offset, color);
  }
  return gradient;
}

function createOverRatingTextGradient(context, value, text, x, y, options = {}) {
  const align = options.align ?? "left";
  const textWidth = measureTextWidth(context, text, options);
  const gradientX = align === "right" ? x - textWidth : x;
  return createOverRatingCanvasGradient(context, value, gradientX, y - (options.size ?? 20), textWidth, options.size ?? 20);
}

function tierInfo(tier) {
  const tierNames = [
    "Unrated",
    "Bronze V",
    "Bronze IV",
    "Bronze III",
    "Bronze II",
    "Bronze I",
    "Silver V",
    "Silver IV",
    "Silver III",
    "Silver II",
    "Silver I",
    "Gold V",
    "Gold IV",
    "Gold III",
    "Gold II",
    "Gold I",
    "Platinum V",
    "Platinum IV",
    "Platinum III",
    "Platinum II",
    "Platinum I",
    "Diamond V",
    "Diamond IV",
    "Diamond III",
    "Diamond II",
    "Diamond I",
    "Ruby V",
    "Ruby IV",
    "Ruby III",
    "Ruby II",
    "Ruby I",
    "Master",
  ];

  if (tier === 31) return { name: tierNames[tier], family: "master" };
  if (tier >= 26) return { name: tierNames[tier], family: "ruby" };
  if (tier >= 21) return { name: tierNames[tier], family: "diamond" };
  if (tier >= 16) return { name: tierNames[tier], family: "platinum" };
  if (tier >= 11) return { name: tierNames[tier], family: "gold" };
  if (tier >= 6) return { name: tierNames[tier], family: "silver" };
  if (tier >= 1) return { name: tierNames[tier], family: "bronze" };
  return { name: tierNames[0], family: "unrated" };
}

function tierColor(level) {
  if (level === 31) return "#d8c4ff";
  if (level <= 0) return "#c7ced0";

  const palettes = {
    bronze: ["#a86945", "#b2714b", "#bc7951", "#c58258", "#ce8b60"],
    silver: ["#a7b2ba", "#b1bbc2", "#bbc5cb", "#c5cfd5", "#cfd8de"],
    gold: ["#d3a83a", "#ddb443", "#e6bf4b", "#efca55", "#f6d463"],
    platinum: ["#3ab09e", "#47bba9", "#55c6b4", "#64d1bf", "#75dbc9"],
    diamond: ["#579bdd", "#64a7e7", "#72b2ef", "#80bef6", "#90c9fc"],
    ruby: ["#dc4269", "#e54b72", "#ed557b", "#f46083", "#fb6b8c"],
  };
  const family = tierInfo(level).family;
  const palette = palettes[family];
  if (!palette) return "#c7ced0";

  const rankInFamily = ((level - 1) % 5) + 1;
  return palette[rankInFamily - 1];
}

function classDecorationLabel(value) {
  return {
    none: "",
    silver: " 은장",
    gold: " 금장",
  }[value] ?? "";
}

function classDecorationName(value) {
  return {
    gold: "금장",
    silver: "은장",
    none: "기본",
  }[value] ?? "미획득";
}

function classDecorationColor(value) {
  return {
    gold: "#f3c94f",
    silver: "#cbd5dc",
    none: "#3ab09e",
  }[value] ?? "rgba(255,255,255,0.36)";
}

function fallbackProfile(handle) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(handle)}&background=171717&color=ffffff&bold=true&size=256`;
}

function fallbackBackground() {
  return "https://static.solved.ac/profile_bg/boardgame/chess.png";
}

function fallbackBadge() {
  return "https://static.solved.ac/profile_badge/anniversary_1st.png";
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createStoryPanel(label) {
  const section = createElement("section", "story-panel");
  section.dataset.category = label;
  const inner = createElement("div", "story-panel-inner");
  inner.append(createElement("p", "story-label", label));
  section.append(inner);
  return { section, inner };
}

function createValuePanel(label, value, detail) {
  const { section, inner } = createStoryPanel(label);
  const number = createElement("p", "story-value story-number", "0");
  number.dataset.target = String(value);
  inner.append(number);
  if (detail) inner.append(createElement("p", "story-detail", detail));
  return section;
}

function createClassProgress(classStats) {
  const list = createElement("div", "class-progress-list");
  const statByClass = new Map(classStats.map((entry) => [Number(entry.class), entry]));

  for (let classNumber = 1; classNumber <= 10; classNumber += 1) {
    const stat = statByClass.get(classNumber) ?? {
      class: classNumber,
      total: 0,
      totalSolved: 0,
      essentials: 0,
      essentialSolved: 0,
      decoration: null,
    };
    const total = Number(stat.total || 0);
    const solved = Number(stat.totalSolved || 0);
    const essentials = Number(stat.essentials || 0);
    const essentialSolved = Number(stat.essentialSolved || 0);
    const progress = total ? Math.min(solved / total, 1) : 0;
    const essentialProgress = essentials ? Math.min(essentialSolved / essentials, 1) : 0;

    const row = createElement("div", `class-progress-row decoration-${stat.decoration ?? "locked"}`);
    row.style.setProperty("--progress", progress.toFixed(4));
    row.style.setProperty("--essential-progress", essentialProgress.toFixed(4));

    const head = createElement("div", "class-progress-head");
    head.append(createElement("span", "class-progress-title", `CLASS ${classNumber}`));
    head.append(createElement("span", "class-progress-decoration", classDecorationName(stat.decoration)));

    const solvedText = createElement(
      "span",
      "class-progress-count",
      `${formatNumber(solved)} / ${formatNumber(total)} solved`,
    );

    const bar = createElement("div", "class-progress-bar");
    bar.append(createElement("span", "class-progress-fill"));

    const essentialBar = createElement("div", "class-essential-bar");
    essentialBar.append(createElement("span", "class-essential-fill"));

    const essentialText = createElement(
      "span",
      "class-progress-essential",
      `essential ${formatNumber(essentialSolved)} / ${formatNumber(essentials)}`,
    );

    row.append(head, solvedText, bar, essentialBar, essentialText);
    list.append(row);
  }

  return list;
}

function createRatingDetails(user, stats, topProblems) {
  const block = createElement("div", "rating-details");
  const rankText = user.rank ? `#${formatNumber(user.rank)}` : "#--";
  const topProblemTiers = topProblems.slice(0, 100).map((problem) => Number(problem.level || 0));

  const rank = createElement("p", "rating-rank", rankText);
  rank.append(createElement("span", "", " ranking"));

  const bonuses = createElement("div", "rating-bonuses");
  const bonusItems = [
    ["TOP 100 RATING", user.ratingByProblemsSum],
    ["CLASS BONUS", user.ratingByClass],
    ["SOLVE BONUS", user.ratingBySolvedCount],
    ["CONTRIBUTION BONUS", user.ratingByVoteCount],
  ];

  for (const [label, value] of bonusItems) {
    const item = createElement("div", "rating-bonus-item");
    item.append(createElement("span", "rating-bonus-label", label));
    item.append(createElement("strong", "rating-bonus-value", `+${formatNumber(value)}`));
    bonuses.append(item);
  }

  const topTiers = createElement("div", "rating-top-tiers");
  topTiers.append(createElement("p", "rating-subtitle", "top 100 tiers"));

  const tierGrid = createElement("div", "rating-tier-grid");
  for (let index = 0; index < 100; index += 1) {
    const level = topProblemTiers[index] ?? 0;
    const info = tierInfo(level);
    const dot = createElement("span", `rating-tier-dot tier-bg-${info.family}`);
    const row = Math.floor(index / 25);
    const column = index % 25;
    dot.style.setProperty("--tier-color", tierColor(level));
    dot.style.setProperty("--dot-delay", `${row * 70 + column * 18 + ((row + column) % 3) * 12}ms`);
    dot.title = topProblems[index]
      ? `#${topProblems[index].problemId} ${topProblems[index].titleKo ?? ""} · ${info.name}`
      : "empty";
    tierGrid.append(dot);
  }

  const tierCountsByFamily = {};
  const tierCountsByLevel = {};
  for (const level of topProblemTiers) {
    const family = tierInfo(level).family;
    tierCountsByFamily[family] = (tierCountsByFamily[family] ?? 0) + 1;
    tierCountsByLevel[level] = (tierCountsByLevel[level] ?? 0) + 1;
  }
  const tierLegend = createElement("div", "rating-tier-legend");
  for (const family of ["master", "ruby", "diamond", "platinum", "gold", "silver", "bronze", "unrated"]) {
    if (!tierCountsByFamily[family]) continue;
    const row = createElement("div", `rating-tier-family tier-${family}`);
    row.append(
      createElement("span", "rating-tier-family-head", family.toUpperCase()),
      createElement("span", "rating-tier-family-count", String(tierCountsByFamily[family])),
    );

    const breakdownLevels = [];
    for (let level = 31; level >= 1; level -= 1) {
      if (tierInfo(level).family !== family) continue;
      if (!tierCountsByLevel[level]) continue;
      breakdownLevels.push(level);
    }

    if (breakdownLevels.length > 1 || (breakdownLevels.length === 1 && family !== "master" && family !== "unrated")) {
      const breakdown = createElement("div", "rating-tier-breakdown");
      for (const level of breakdownLevels) {
        const name = tierInfo(level).name;
        const shortName = name.includes(" ") ? name.split(" ").slice(1).join(" ") : name;
        breakdown.append(
          createElement("span", "rating-tier-breakdown-item", `${shortName} ${tierCountsByLevel[level]}`),
        );
      }
      row.append(breakdown);
    }

    tierLegend.append(row);
  }

  topTiers.append(tierGrid, tierLegend);
  block.append(rank, bonuses, topTiers);
  return block;
}

function createBojStatsPanel(bojStats) {
  const panel = createStoryPanel("BOJ stats");
  panel.section.classList.add("boj-stats-story-panel");

  if (!bojStats.length) {
    panel.inner.append(createElement("p", "story-detail", "BOJ 프로필 통계를 읽어오지 못했습니다."));
    return panel.section;
  }

  const priorityLabels = ["등수", "맞은 문제", "맞았습니다"];
  const priorityStats = priorityLabels.map((label) => bojStats.find((stat) => stat.label === label)).filter(Boolean);
  const restStats = bojStats.filter((stat) => !priorityLabels.includes(stat.label));

  const priorityGrid = createElement("div", "boj-stat-priority");
  for (const stat of priorityStats) {
    priorityGrid.append(createBojStatItem(stat, true));
  }

  const grid = createElement("div", "boj-stat-grid");
  for (const stat of restStats) {
    grid.append(createBojStatItem(stat, false));
  }

  panel.inner.append(priorityGrid, grid);
  return panel.section;
}

function createBojStatItem(stat, isPriority) {
  const item = createElement("div", isPriority ? "boj-stat-item is-highlight" : "boj-stat-item");
  const value = createElement("strong", "boj-stat-value story-number", "0");
  const label = createElement("span", `boj-stat-label${stat.styleClass ? ` ${stat.styleClass}` : ""}`, bojStatLabel(stat.label));
  value.dataset.target = String(stat.value);
  item.append(value, label);
  return item;
}

function bojStatLabel(label) {
  return label === "등수" ? "등수(BOJ)" : label;
}

function resultColor(styleClass) {
  return {
    "result-ac": "#009874",
    "result-pe": "#fa7268",
    "result-wa": "#dd4124",
    "result-tle": "#fa7268",
    "result-mle": "#fa7268",
    "result-ole": "#fa7268",
    "result-rte": "#5f4b8b",
    "result-ce": "#0f4c81",
    "result-del": "#838b8d",
  }[styleClass] ?? "#777696";
}

function createLanguageStatsPanel(languageStats) {
  const panel = createStoryPanel("language stats");
  panel.section.classList.add("language-stats-story-panel");

  if (!languageStats.length) {
    panel.inner.append(createElement("p", "story-detail", "BOJ 언어 통계를 읽어오지 못했습니다."));
    return panel.section;
  }

  const grid = createElement("div", "language-stat-grid");
  for (const language of languageStats) {
    grid.append(createLanguageStatCard(language));
  }

  panel.inner.append(grid);
  return panel.section;
}

function createLanguageStatCard(language) {
  const card = createElement("article", "language-stat-card");
  const statusTotal = language.statuses.reduce((total, stat) => total + Number(stat.value || 0), 0);
  let current = 0;
  const segments = language.statuses
    .filter((stat) => Number(stat.value || 0) > 0)
    .map((stat) => {
      const start = current;
      const size = statusTotal ? (Number(stat.value) / statusTotal) * 360 : 0;
      current += size;
      return `${resultColor(stat.styleClass)} ${start.toFixed(3)}deg ${current.toFixed(3)}deg`;
    });
  const pie = createElement("div", "language-pie");
  pie.style.background = segments.length ? `conic-gradient(${segments.join(", ")})` : "rgb(255 255 255 / 14%)";

  const head = createElement("div", "language-stat-head");
  head.append(createElement("h3", "language-name", language.language));
  const summary = createElement("p", "language-summary");
  summary.textContent = `${formatNumber(language.solvedProblems)} solved · ${formatNumber(language.submissions)} submits · ${language.acceptedRate}`;
  head.append(summary);

  const statusList = createElement("div", "language-status-list");
  for (const status of language.statuses) {
    const row = createElement("div", "language-status-row");
    const label = createElement("span", `language-status-label ${status.styleClass ?? ""}`, status.label);
    const value = createElement("strong", "language-status-count story-number", "0");
    value.dataset.target = String(status.value || 0);
    row.append(label, value);
    statusList.append(row);
  }

  card.append(pie, head, statusList);
  return card;
}

function drawOverviewText(context, text, x, y, options = {}) {
  context.fillStyle = options.color ?? "#ffffff";
  context.font = `${options.weight ?? 800} ${options.size ?? 42}px ${options.family ?? context.__fontFamily ?? canvasFontFamily}`;
  context.textAlign = options.align ?? "left";
  context.textBaseline = options.baseline ?? "alphabetic";
  if (options.maxWidth) {
    context.fillText(text, x, y, options.maxWidth);
    return;
  }

  context.fillText(text, x, y);
}

function measureTextWidth(context, text, options = {}) {
  context.save();
  context.font = `${options.weight ?? 800} ${options.size ?? 42}px ${options.family ?? context.__fontFamily ?? canvasFontFamily}`;
  const width = context.measureText(text).width;
  context.restore();
  return width;
}

async function ensureCanvasFonts(profileOptions = "left") {
  if (!document.fonts) return;
  const normalizedProfile = normalizeProfileOptions(profileOptions);
  const typography = resolveTypography(normalizedProfile.typography);
  const loads = new Map();
  for (const role of Object.values(typography)) {
    loads.set(`${role.weight}:16:${role.loadFamily}`, `${role.weight} 16px ${role.loadFamily}`);
    loads.set(`${role.weight}:48:${role.loadFamily}`, `${role.weight} 48px ${role.loadFamily}`);
  }

  try {
    await Promise.all([
      ...loads.values(),
    ].map((descriptor) => document.fonts.load(descriptor)).concat([
      document.fonts.ready,
    ]));
  } catch {
    // Canvas export can safely fall back to system fonts if the CDN is unavailable.
  }
}

function fitCanvasText(context, text, maxWidth, options = {}) {
  let size = options.size ?? 42;
  const minimumSize = options.minimumSize ?? 22;

  while (size > minimumSize && measureTextWidth(context, text, { ...options, size }) > maxWidth) {
    size -= 2;
  }

  return { ...options, size, maxWidth };
}

function wrapCanvasText(context, text, maxWidth, options = {}) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (currentLine && measureTextWidth(context, nextLine, options) > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
      continue;
    }

    currentLine = nextLine;
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

function drawWrappedCanvasText(context, text, x, y, maxWidth, options = {}) {
  let size = options.size ?? 14;
  const minimumSize = options.minimumSize ?? 10;
  const maxLines = options.maxLines ?? 2;
  let textOptions = { ...options, size };
  let lines = wrapCanvasText(context, text, maxWidth, textOptions);

  while (size > minimumSize && lines.length > maxLines) {
    size -= 1;
    textOptions = { ...options, size };
    lines = wrapCanvasText(context, text, maxWidth, textOptions);
  }

  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const lastIndex = lines.length - 1;
    while (
      lines[lastIndex].length > 1 &&
      measureTextWidth(context, `${lines[lastIndex]}...`, { ...textOptions, size }) > maxWidth
    ) {
      lines[lastIndex] = lines[lastIndex].slice(0, -1).trimEnd();
    }
    lines[lastIndex] = `${lines[lastIndex]}...`;
  }

  const lineHeight = textOptions.lineHeight ?? Math.round(size * 1.28);
  lines.forEach((line, index) => {
    drawOverviewText(context, line, x, y + index * lineHeight, { ...textOptions, maxWidth: undefined });
  });

  return lines.length * lineHeight;
}

function drawOverviewStat(context, label, value, x, y, width, align = "left", styles = {}) {
  const textX = align === "right" ? x + width : x;
  context.strokeStyle = "rgba(58, 176, 158, 0.42)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + width, y);
  context.stroke();
  drawOverviewText(context, label, textX, y + 18, {
    color: "rgba(255,255,255,0.62)",
    size: styles.labelSize ?? 12,
    weight: styles.labelWeight ?? 850,
    family: styles.labelFamily,
    align,
  });
  drawOverviewText(context, value, textX, y + 44, {
    color: "#ffffff",
    size: styles.valueSize ?? 22,
    weight: styles.valueWeight ?? 950,
    family: styles.valueFamily,
    align,
  });
}

function proxiedImageUrl(url) {
  if (!url) return "";
  return `${apiBaseUrl}/api/image?url=${encodeURIComponent(url)}`;
}

function loadCanvasImage(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = proxiedImageUrl(url);
  });
}

function roundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawImageCover(context, image, x, y, width, height) {
  if (!image?.naturalWidth || !image?.naturalHeight) return;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawImageContain(context, image, x, y, width, height) {
  if (!image?.naturalWidth || !image?.naturalHeight) return;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawRoundedImage(context, image, x, y, width, height, radius, mode = "cover") {
  context.save();
  roundedRect(context, x, y, width, height, radius);
  context.clip();

  if (image) {
    if (mode === "contain") {
      context.fillStyle = "rgba(255, 255, 255, 0.94)";
      context.fillRect(x, y, width, height);
      drawImageContain(context, image, x, y, width, height);
    } else {
      drawImageCover(context, image, x, y, width, height);
    }
  } else {
    context.fillStyle = "rgba(255, 255, 255, 0.14)";
    context.fillRect(x, y, width, height);
  }

  context.restore();
  context.strokeStyle = "rgba(58, 176, 158, 0.88)";
  context.lineWidth = 2;
  roundedRect(context, x, y, width, height, radius);
  context.stroke();
}

function drawProfileImageBackground(context, image, width, height, options = {}) {
  const coverOptions = normalizeCoverOptions(options);
  const baseGradient = context.createLinearGradient(0, 0, width, height);
  baseGradient.addColorStop(0, "#253237");
  baseGradient.addColorStop(0.55, "#3b444b");
  baseGradient.addColorStop(1, "#777696");
  context.fillStyle = baseGradient;
  context.fillRect(0, 0, width, height);

  if (image) {
    context.save();
    context.globalAlpha = coverOptions.rearOpacity / 100;
    context.filter = `blur(${coverOptions.rearBlur}px)`;
    drawImageCover(context, image, -24, -24, width + 48, height + 48);
    context.restore();

    if (coverOptions.backgroundMode === "dual") {
      context.save();
      context.globalAlpha = coverOptions.frontOpacity / 100;
      context.filter = `blur(${coverOptions.frontBlur}px)`;
      drawImageContain(context, image, 0, 0, width, height);
      context.restore();
    }
  }

  const shade = context.createLinearGradient(0, 0, width, height);
  shade.addColorStop(0, "rgba(20, 28, 30, 0.34)");
  shade.addColorStop(0.5, "rgba(20, 28, 30, 0.12)");
  shade.addColorStop(1, "rgba(20, 28, 30, 0.46)");
  context.fillStyle = shade;
  context.fillRect(0, 0, width, height);

  const sideShade = context.createLinearGradient(0, 0, width, 0);
  sideShade.addColorStop(0, "rgba(16, 23, 25, 0.42)");
  sideShade.addColorStop(0.38, "rgba(16, 23, 25, 0.04)");
  sideShade.addColorStop(0.74, "rgba(16, 23, 25, 0.12)");
  sideShade.addColorStop(1, "rgba(16, 23, 25, 0.62)");
  context.fillStyle = sideShade;
  context.fillRect(0, 0, width, height);
}

function drawReportBackground(context, image, width, height) {
  const baseGradient = context.createLinearGradient(0, 0, width, height);
  baseGradient.addColorStop(0, "#253237");
  baseGradient.addColorStop(0.56, "#3b444b");
  baseGradient.addColorStop(1, "#777696");
  context.fillStyle = baseGradient;
  context.fillRect(0, 0, width, height);

  if (image) {
    context.save();
    context.globalAlpha = 0.68;
    drawImageCover(context, image, 0, 0, width, height);
    context.restore();
  }

  const shade = context.createLinearGradient(0, 0, width, height);
  shade.addColorStop(0, "rgba(18, 26, 28, 0.42)");
  shade.addColorStop(0.48, "rgba(18, 26, 28, 0.2)");
  shade.addColorStop(1, "rgba(18, 26, 28, 0.58)");
  context.fillStyle = shade;
  context.fillRect(0, 0, width, height);
}

function drawOctagonPath(context, x, y, radius, rotation = Math.PI / 8) {
  context.beginPath();
  for (let point = 0; point < 8; point += 1) {
    const angle = rotation + (Math.PI * 2 * point) / 8;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (point === 0) {
      context.moveTo(px, py);
    } else {
      context.lineTo(px, py);
    }
  }
  context.closePath();
}

function drawSolvedProfileOctagons(context, width, height, seed) {
  const random = createSeededRandom(seed);
  const palette = [
    "255, 255, 255",
    "79, 218, 196",
    "150, 166, 255",
  ];
  const count = Math.max(22, Math.round((width * height) / 24000));

  context.save();
  context.globalCompositeOperation = "screen";

  for (let index = 0; index < count; index += 1) {
    const radius = 28 + random() * 86;
    const x = -radius * 0.4 + random() * (width + radius * 0.8);
    const y = -radius * 0.4 + random() * (height + radius * 0.8);
    const color = palette[index % palette.length];
    const alpha = 0.04 + random() * 0.09;
    const rotation = Math.PI / 8 + random() * 0.1 - 0.05;

    context.lineWidth = 1 + random() * 2.2;
    context.strokeStyle = `rgba(${color}, ${alpha})`;
    drawOctagonPath(context, x, y, radius, rotation);
    context.stroke();

    if (random() > 0.48) {
      context.lineWidth = 1;
      context.strokeStyle = `rgba(${color}, ${alpha * 0.52})`;
      drawOctagonPath(context, x, y, radius * (0.62 + random() * 0.18), rotation);
      context.stroke();
    }
  }

  context.globalCompositeOperation = "source-over";
  context.restore();
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = seed || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createScaledCanvas(width, height, scale = 1, fontFamily = canvasFontFamily) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.__fontFamily = fontFamily;
  return { canvas, context, width, height };
}

function drawRatingGrid(context, topProblems, x, y, options = {}) {
  const dotSize = options.dotSize ?? 7;
  const gap = options.gap ?? 3;
  const columns = options.columns ?? 25;

  for (let index = 0; index < 100; index += 1) {
    const level = Number(topProblems[index]?.level || 0);
    const dotX = x + (index % columns) * (dotSize + gap);
    const dotY = y + Math.floor(index / columns) * (dotSize + gap);
    context.fillStyle = tierColor(level);
    context.fillRect(dotX, dotY, dotSize, dotSize);
  }
}

function drawProfileRatingDots(context, topProblems, x, y) {
  drawRatingGrid(context, topProblems, x, y, { dotSize: 7, gap: 3, columns: 25 });
}

function drawInlineText(context, items, x, y, gap = 10) {
  let cursorX = x;

  for (const item of items) {
    drawOverviewText(context, item.text, cursorX, y, item.options);
    cursorX += measureTextWidth(context, item.text, item.options) + gap;
  }
}

function drawInlineTextRight(context, items, rightX, y, gap = 10) {
  const width = items.reduce((total, item, index) => {
    const itemWidth = measureTextWidth(context, item.text, item.options);
    return total + itemWidth + (index ? gap : 0);
  }, 0);

  drawInlineText(context, items, rightX - width, y, gap);
}

function drawRatingPair(context, user, stats, x, y, options = {}) {
  const columnGap = options.columnGap ?? 6;
  const acWidth = options.acWidth ?? 108;
  const overWidth = options.overWidth ?? 120;
  const labelSize = options.labelSize ?? 13;
  const ratingSize = options.ratingSize ?? 38;
  const overSize = options.overSize ?? 20;
  const valueOffset = options.valueOffset ?? 39;
  const align = options.align ?? "left";
  const overOffset = options.overOffset ?? 0;
  const overRightOffset = options.overRightOffset ?? 0;
  const totalWidth = acWidth + columnGap + overWidth;
  const startX = align === "right" ? x - totalWidth : x;
  const acX = align === "right" ? x : startX;
  const overX = align === "right" ? startX + overWidth - overRightOffset : startX + acWidth + columnGap + overOffset;
  const textAlign = align === "right" ? "right" : "left";
  const overRatingText = formatOverRating(user.overRating);
  const overTextOptions = {
    size: overSize,
    weight: 950,
    align: textAlign,
  };
  const overGradient = createOverRatingTextGradient(
    context,
    user.overRating,
    overRatingText,
    overX,
    y + valueOffset,
    overTextOptions,
  );

  drawOverviewText(context, "AC RATING", acX, y, {
    color: "rgba(255,255,255,0.76)",
    size: labelSize,
    weight: options.labelWeight ?? 950,
    family: options.labelFamily,
    align: textAlign,
  });
  drawOverviewText(context, "OVER RATING", overX, y, {
    color: "rgba(255,255,255,0.58)",
    size: Math.max(9, labelSize - 2),
    weight: options.labelWeight ?? 950,
    family: options.labelFamily,
    align: textAlign,
  });
  drawOverviewText(context, formatNumber(stats.rating), acX, y + valueOffset, {
    color: tierColor(user.tier),
    size: ratingSize,
    weight: options.valueWeight ?? 950,
    family: options.valueFamily,
    align: textAlign,
  });
  drawOverviewText(context, overRatingText, overX, y + valueOffset, {
    color: overGradient,
    family: options.valueFamily,
    weight: options.valueWeight ?? 950,
    ...overTextOptions,
  });
}

function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function encodePdfText(value) {
  return new TextEncoder().encode(value);
}

function concatBytes(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

async function createProfileCanvas(user, stats, topProblems, tier, classText, media, profileOptions = "left") {
  await ensureCanvasFonts(profileOptions);
  const normalizedProfile = normalizeProfileOptions(profileOptions);
  const profileLayout = normalizedProfile.layout;
  const coverOptions = normalizedProfile.cover;
  const typography = resolveTypography(normalizedProfile.typography);

  const { canvas, context, width, height } = createScaledCanvas(
    profileImageWidth,
    profileImageHeight,
    profileRenderScale,
    typography.bio.family,
  );
  const [backgroundImage, profileImage, badgeImage] = await Promise.all([
    loadCanvasImage(media.backgroundUrl),
    loadCanvasImage(media.profileUrl),
    loadCanvasImage(media.badgeUrl),
  ]);

  drawProfileImageBackground(context, backgroundImage, width, height, coverOptions);
  drawSolvedProfileOctagons(context, width, height, hashString(user.handle));

  const isRightLayout = profileLayout === "right";
  const contentRight = 926;
  const contentX = isRightLayout ? contentRight - 150 : 74;
  const textX = isRightLayout ? contentRight : contentX;
  const metaX = isRightLayout ? contentRight : 74;
  const handleMaxWidth = 560;
  const overviewStats = [
    ["푼 문제 수", formatNumber(stats.solvedCount)],
    ["기여한 문제 수", formatNumber(stats.contributionCount)],
    ["라이벌 수", formatNumber(stats.rivalCount)],
    ["최장 스트릭", formatNumber(stats.maxStreak ?? user.maxStreak ?? 0)],
  ];
  const statWidth = 94;
  const statGap = 118;
  const ratingPairWidth = 108 + 6 + 120;
  const statStartX = isRightLayout
    ? contentRight - (statGap * (overviewStats.length - 1) + statWidth)
    : contentX;
  const topGridX = isRightLayout ? contentRight - ratingPairWidth - 270 : contentX + 259;
  const rankingSize = 13;
  const textAlign = isRightLayout ? "right" : "left";

  drawRoundedImage(context, profileImage, contentX, 86, 92, 92, 8, "cover");
  drawRoundedImage(context, badgeImage, contentX + 110, 130, 40, 40, 7, "contain");

  drawOverviewText(context, user.handle, textX, 232, fitCanvasText(context, user.handle, handleMaxWidth, {
    color: "#ffffff",
    size: typography.handle.size,
    minimumSize: scaleRoleMetric(typography.handle, 34, 50),
    weight: typography.handle.weight,
    family: typography.handle.family,
    align: textAlign,
  }));
  drawWrappedCanvasText(context, user.bio || "one last solved.ac snapshot", textX, 260, handleMaxWidth, {
    color: "rgba(255,255,255,0.74)",
    size: typography.bio.size,
    minimumSize: scaleRoleMetric(typography.bio, 10, 14),
    maxLines: 2,
    lineHeight: scaleRoleMetric(typography.bio, 17, 14),
    weight: typography.bio.weight,
    family: typography.bio.family,
    align: textAlign,
  });

  drawOverviewText(context, `SOLVED.AC RANKING #${formatNumber(user.rank || 0)}`, textX, 294, {
    color: "rgba(255,255,255,0.72)",
    size: typography.ranking.size,
    weight: typography.ranking.weight,
    family: typography.ranking.family,
    maxWidth: handleMaxWidth,
    align: textAlign,
  });
  drawOverviewText(context, `BOJ RANKING #${media.bojRank ? formatNumber(media.bojRank) : "--"}`, textX, 312, {
    color: "rgba(255,255,255,0.72)",
    size: typography.ranking.size,
    weight: typography.ranking.weight,
    family: typography.ranking.family,
    maxWidth: handleMaxWidth,
    align: textAlign,
  });

  overviewStats.forEach(([label, value], index) => {
    drawOverviewStat(context, label, value, statStartX + statGap * index, 318, statWidth, textAlign, {
      labelFamily: typography.statLabel.family,
      labelWeight: typography.statLabel.weight,
      labelSize: typography.statLabel.size,
      valueFamily: typography.statValue.family,
      valueWeight: typography.statValue.weight,
      valueSize: typography.statValue.size,
    });
  });

  drawRatingPair(context, user, stats, textX, 389, {
    align: textAlign,
    overOffset: isRightLayout ? 0 : 18,
    overRightOffset: isRightLayout ? 27 : 0,
    labelFamily: typography.ratingLabel.family,
    labelWeight: typography.ratingLabel.weight,
    labelSize: typography.ratingLabel.size,
    valueFamily: typography.ratingValue.family,
    valueWeight: typography.ratingValue.weight,
    ratingSize: typography.ratingValue.size,
    overSize: scaleRoleMetric(typography.ratingValue, 20, 38),
  });
  const ratingTierItems = [
    {
      text: tier.name,
      options: fitCanvasText(context, tier.name, 120, {
        color: tierColor(user.tier),
        size: typography.tier.size,
        minimumSize: scaleRoleMetric(typography.tier, 13, 16),
        weight: typography.tier.weight,
        family: typography.tier.family,
      }),
    },
    {
      text: classText,
      options: fitCanvasText(context, classText, 110, {
        color: "rgba(255,255,255,0.8)",
        size: typography.tier.size,
        minimumSize: scaleRoleMetric(typography.tier, 13, 16),
        weight: typography.tier.weight,
        family: typography.tier.family,
      }),
    },
  ];
  if (isRightLayout) {
    drawInlineTextRight(context, ratingTierItems, textX, 454);
  } else {
    drawInlineText(context, ratingTierItems, textX, 454);
  }
  drawProfileRatingDots(context, topProblems, topGridX, 398);

  if (coverOptions.showMeta) {
    drawOverviewText(context, `배경 : ${media.backgroundName}`, metaX, 552, {
      color: "rgba(255,255,255,0.72)",
      size: typography.meta.size,
      weight: typography.meta.weight,
      family: typography.meta.family,
      maxWidth: 580,
      align: textAlign,
    });
    drawOverviewText(context, `뱃지 : ${media.badgeName}`, metaX, 576, {
      color: "rgba(255,255,255,0.72)",
      size: typography.meta.size,
      weight: typography.meta.weight,
      family: typography.meta.family,
      maxWidth: 580,
      align: textAlign,
    });
  }

  return canvas;
}

async function createProfileReportPage(backgroundImage, user, stats, topProblems, tier, classText, media, profileOptions) {
  const normalizedProfile = normalizeProfileOptions(profileOptions);
  const typography = resolveTypography(normalizedProfile.typography);
  const { canvas, context, width, height } = createScaledCanvas(
    reportPageWidth,
    reportPageHeight,
    reportRenderScale,
    typography.bio.family,
  );
  const profileCanvas = await createProfileCanvas(user, stats, topProblems, tier, classText, media, profileOptions);
  const { cover } = normalizedProfile;

  drawProfileImageBackground(context, backgroundImage, width, height, cover);
  drawSolvedProfileOctagons(context, width, height, hashString(`${user.handle}:profile-report`));

  const profileScale = Math.min(width / profileCanvas.width, height / profileCanvas.height);
  const drawWidth = profileCanvas.width * profileScale;
  const drawHeight = profileCanvas.height * profileScale;
  context.drawImage(profileCanvas, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

  return canvas;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function drawReportHeader(context, title, subtitle) {
  drawOverviewText(context, title, 72, 126, { color: "#ffffff", size: 48, weight: 950 });
  if (subtitle) {
    drawOverviewText(context, subtitle, 74, 160, { color: "rgba(255,255,255,0.66)", size: 16, weight: 800 });
  }
}

function createReportPage(backgroundImage, title, subtitle, seed, fontFamily = canvasFontFamily) {
  const { canvas, context, width, height } = createScaledCanvas(reportPageWidth, reportPageHeight, reportRenderScale, fontFamily);
  drawReportBackground(context, backgroundImage, width, height);
  drawReportHeader(context, title, subtitle);
  return { canvas, context, width, height };
}

function drawReportMetric(context, label, value, x, y, width = 220) {
  context.strokeStyle = "rgba(58, 176, 158, 0.46)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + width, y);
  context.stroke();
  drawOverviewText(context, label, x, y + 20, { color: "rgba(255,255,255,0.6)", size: 14, weight: 850 });
  drawOverviewText(context, value, x, y + 58, { color: "#ffffff", size: 32, weight: 950 });
}

function createClassReportPage(backgroundImage, user, classStats, fontFamily = canvasFontFamily) {
  const { canvas, context } = createReportPage(
    backgroundImage,
    "CLASS",
    "solved.ac class progress",
    hashString(`${user.handle}:class`),
    fontFamily,
  );
  const statByClass = new Map(classStats.map((entry) => [Number(entry.class), entry]));

  for (let classNumber = 1; classNumber <= 10; classNumber += 1) {
    const stat = statByClass.get(classNumber) ?? {
      class: classNumber,
      total: 0,
      totalSolved: 0,
      essentials: 0,
      essentialSolved: 0,
      decoration: null,
    };
    const y = 196 + (classNumber - 1) * 66;
    const total = Number(stat.total || 0);
    const solved = Number(stat.totalSolved || 0);
    const essentials = Number(stat.essentials || 0);
    const essentialSolved = Number(stat.essentialSolved || 0);
    const progress = total ? Math.min(solved / total, 1) : 0;
    const essentialProgress = essentials ? Math.min(essentialSolved / essentials, 1) : 0;
    const decorationColor = classDecorationColor(stat.decoration);

    drawOverviewText(context, `CLASS ${classNumber}`, 82, y, { color: "#ffffff", size: 18, weight: 950 });
    drawOverviewText(context, classDecorationName(stat.decoration), 190, y, {
      color: decorationColor,
      size: 14,
      weight: 850,
    });
    drawOverviewText(context, `${formatNumber(solved)} / ${formatNumber(total)} solved`, 1138, y, {
      color: "rgba(255,255,255,0.72)",
      size: 14,
      weight: 850,
      align: "right",
    });

    context.fillStyle = "rgba(255,255,255,0.12)";
    roundedRect(context, 82, y + 18, 1060, 12, 6);
    context.fill();
    context.fillStyle = decorationColor;
    roundedRect(context, 82, y + 18, 1060 * progress, 12, 6);
    context.fill();
    context.fillStyle = stat.decoration ? "rgba(255,255,255,0.68)" : "rgba(255,255,255,0.36)";
    roundedRect(context, 82, y + 38, 1060 * essentialProgress, 5, 3);
    context.fill();
    drawOverviewText(context, `essential ${formatNumber(essentialSolved)} / ${formatNumber(essentials)}`, 1160, y + 38, {
      color: "rgba(255,255,255,0.52)",
      size: 12,
      weight: 800,
    });
  }

  return canvas;
}

function createRatingReportPage(backgroundImage, user, stats, topProblems, tier, classText, fontFamily = canvasFontFamily) {
  const { canvas, context } = createReportPage(
    backgroundImage,
    "AC RATING",
    "solved.ac rating",
    hashString(`${user.handle}:rating`),
    fontFamily,
  );
  const leftSectionOffsetY = 96;

  drawRatingPair(context, user, stats, 82, 264 + leftSectionOffsetY, {
    columnGap: 86,
    acWidth: 210,
    overWidth: 220,
    labelSize: 18,
    ratingSize: 76,
    overSize: 36,
    valueOffset: 86,
  });
  drawInlineText(context, [
    {
      text: tier.name,
      options: fitCanvasText(context, tier.name, 160, {
        color: tierColor(user.tier),
        size: 20,
        minimumSize: 15,
        weight: 900,
      }),
    },
    {
      text: classText,
      options: fitCanvasText(context, classText, 150, {
        color: "rgba(255,255,255,0.82)",
        size: 20,
        minimumSize: 15,
        weight: 900,
      }),
    },
  ], 86, 392 + leftSectionOffsetY);
  drawOverviewText(context, `ranking #${formatNumber(user.rank || 0)}`, 86, 428 + leftSectionOffsetY, {
    color: "rgba(255,255,255,0.68)",
    size: 18,
    weight: 850,
  });

  const bonuses = [
    ["TOP 100 RATING", user.ratingByProblemsSum],
    ["CLASS BONUS", user.ratingByClass],
    ["SOLVE BONUS", user.ratingBySolvedCount],
    ["CONTRIBUTION BONUS", user.ratingByVoteCount],
  ];
  for (let index = 0; index < bonuses.length; index += 1) {
    const [label, value] = bonuses[index];
    const x = 82 + (index % 2) * 270;
    const y = 520 + leftSectionOffsetY + Math.floor(index / 2) * 92;
    drawReportMetric(context, label, `+${formatNumber(value)}`, x, y, 220);
  }

  drawOverviewText(context, "TOP 100 TIERS", 690, 350, { color: "rgba(255,255,255,0.7)", size: 16, weight: 950 });
  drawRatingGrid(context, topProblems, 690, 386, { dotSize: 18, gap: 7, columns: 25 });

  return canvas;
}

function drawBojReportStatsGrid(context, stats, startY) {
  const columnGap = 300;
  const rowGap = 74;
  for (let index = 0; index < stats.length; index += 1) {
    const stat = stats[index];
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = 82 + column * columnGap;
    const y = startY + row * rowGap;
    drawOverviewText(context, formatNumber(stat.value), x, y, { color: "#ffffff", size: 28, weight: 950 });
    drawOverviewText(context, bojStatLabel(stat.label), x, y + 30, {
      color: stat.styleClass ? resultColor(stat.styleClass) : "rgba(255,255,255,0.62)",
      size: 13,
      weight: 850,
      maxWidth: 250,
    });
  }
}

function createBojReportPages(backgroundImage, user, bojStats, fontFamily = canvasFontFamily) {
  const emptyPage = () => createReportPage(
    backgroundImage,
    "BOJ STATS",
    `${user.handle} profile numbers`,
    hashString(`${user.handle}:boj`),
    fontFamily,
  );

  if (!bojStats.length) {
    const { canvas, context } = emptyPage();
    drawOverviewText(context, "BOJ 프로필 통계를 읽어오지 못했습니다.", 82, 220, {
      color: "rgba(255,255,255,0.72)",
      size: 22,
      weight: 850,
    });
    return [canvas];
  }

  const priorityLabels = ["등수", "맞은 문제", "맞았습니다"];
  const priorityStats = priorityLabels.map((label) => bojStats.find((stat) => stat.label === label)).filter(Boolean);
  const restStats = bojStats.filter((stat) => !priorityLabels.includes(stat.label));
  const pages = [];
  const restPerPage = 20;

  for (let offset = 0; offset < Math.max(restStats.length, 1); offset += restPerPage) {
    const pageNumber = Math.floor(offset / restPerPage) + 1;
    const isFirstPage = offset === 0;
    const chunk = restStats.slice(offset, offset + restPerPage);
    const { canvas, context } = createReportPage(
      backgroundImage,
      "BOJ STATS",
      `${user.handle} profile numbers ${pageNumber}`,
      hashString(`${user.handle}:boj:${offset}`),
      fontFamily,
    );

    if (isFirstPage) {
      for (let index = 0; index < priorityStats.length; index += 1) {
        const stat = priorityStats[index];
        drawReportMetric(context, bojStatLabel(stat.label), formatNumber(stat.value), 82 + index * 300, 250, 240);
      }
      drawBojReportStatsGrid(context, chunk, 430);
    } else {
      drawBojReportStatsGrid(context, chunk, 250);
    }

    pages.push(canvas);
  }

  return pages;
}

function drawLanguagePie(context, statuses, x, y, radius) {
  const total = statuses.reduce((sum, status) => sum + Number(status.value || 0), 0);
  let start = -Math.PI / 2;

  if (!total) {
    context.fillStyle = "rgba(255,255,255,0.12)";
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    return;
  }

  for (const status of statuses) {
    const value = Number(status.value || 0);
    if (!value) continue;
    const angle = (value / total) * Math.PI * 2;
    context.fillStyle = resultColor(status.styleClass);
    context.beginPath();
    context.moveTo(x, y);
    context.arc(x, y, radius, start, start + angle);
    context.closePath();
    context.fill();
    start += angle;
  }

  context.fillStyle = "rgba(37, 50, 55, 0.82)";
  context.beginPath();
  context.arc(x, y, radius * 0.52, 0, Math.PI * 2);
  context.fill();
}

function createLanguageReportPages(backgroundImage, user, languageStats, fontFamily = canvasFontFamily) {
  if (!languageStats.length) {
    const { canvas, context } = createReportPage(
      backgroundImage,
      "LANGUAGE STATS",
      `${user.handle} languages`,
      hashString(`${user.handle}:language-empty`),
      fontFamily,
    );
    drawOverviewText(context, "BOJ 언어 통계를 읽어오지 못했습니다.", 82, 220, {
      color: "rgba(255,255,255,0.72)",
      size: 22,
      weight: 850,
    });
    return [canvas];
  }

  const pages = [];
  const perPage = 4;
  for (let offset = 0; offset < languageStats.length; offset += perPage) {
    const chunk = languageStats.slice(offset, offset + perPage);
    const { canvas, context } = createReportPage(
      backgroundImage,
      "LANGUAGE STATS",
      `${user.handle} languages ${Math.floor(offset / perPage) + 1}`,
      hashString(`${user.handle}:language:${offset}`),
      fontFamily,
    );

    const rowCount = Math.ceil(chunk.length / 2);
    const languageRowGap = 238;
    const languageStartY = rowCount === 1 ? 390 : 280;
    for (let index = 0; index < chunk.length; index += 1) {
      const language = chunk[index];
      const x = 82 + (index % 2) * 620;
      const y = languageStartY + Math.floor(index / 2) * languageRowGap;
      drawLanguagePie(context, language.statuses, x + 64, y + 64, 54);
      drawOverviewText(context, language.language, x + 150, y + 30, { color: "#ffffff", size: 24, weight: 950 });
      drawOverviewText(
        context,
        `${formatNumber(language.solvedProblems)} solved · ${formatNumber(language.submissions)} submits · ${language.acceptedRate}`,
        x + 150,
        y + 60,
        { color: "rgba(255,255,255,0.62)", size: 13, weight: 800 },
      );

      for (let statusIndex = 0; statusIndex < language.statuses.length; statusIndex += 1) {
        const status = language.statuses[statusIndex];
        const rowX = x + 150 + (statusIndex % 2) * 170;
        const rowY = y + 102 + Math.floor(statusIndex / 2) * 24;
        drawOverviewText(context, status.label, rowX, rowY, {
          color: resultColor(status.styleClass),
          size: 12,
          weight: 850,
        });
        drawOverviewText(context, formatNumber(status.value), rowX + 118, rowY, {
          color: "#ffffff",
          size: 12,
          weight: 900,
          align: "right",
        });
      }
    }

    pages.push(canvas);
  }

  return pages;
}

async function createFullReportCanvases(user, stats, topProblems, tier, classText, media, reportData, profileOptions = "left") {
  await ensureCanvasFonts(profileOptions);
  const normalizedProfile = normalizeProfileOptions(profileOptions);
  const typography = resolveTypography(normalizedProfile.typography);

  const backgroundImage = await loadCanvasImage(media.backgroundUrl);
  const profileCanvas = await createProfileReportPage(
    backgroundImage,
    user,
    stats,
    topProblems,
    tier,
    classText,
    media,
    profileOptions,
  );

  return [
    profileCanvas,
    createClassReportPage(backgroundImage, user, reportData.classStats, typography.bio.family),
    createRatingReportPage(backgroundImage, user, stats, topProblems, tier, classText, typography.bio.family),
    ...createBojReportPages(backgroundImage, user, reportData.bojStats, typography.bio.family),
    ...createLanguageReportPages(backgroundImage, user, reportData.languageStats, typography.bio.family),
  ];
}

async function createPdfBlobFromCanvases(canvases) {
  const pageImages = await Promise.all(
    canvases.map(async (canvas) => {
      const imageBlob = await canvasToBlob(canvas, "image/jpeg", 0.98);
      if (!imageBlob) return null;
      return {
        bytes: new Uint8Array(await imageBlob.arrayBuffer()),
        width: canvas.width,
        height: canvas.height,
      };
    }),
  );
  const validPages = pageImages.filter(Boolean);
  if (!validPages.length) return null;
  const pdfWidth = validPages[1]?.width ?? validPages[0].width;
  const pdfHeight = validPages[1]?.height ?? validPages[0].height;

  const chunks = [encodePdfText("%PDF-1.4\n")];
  const offsets = [];
  let byteLength = chunks[0].length;

  function push(chunk) {
    chunks.push(chunk);
    byteLength += chunk.length;
  }

  function addObject(objectNumber, body) {
    offsets[objectNumber] = byteLength;
    push(encodePdfText(`${objectNumber} 0 obj\n${body}\nendobj\n`));
  }

  const pageObjectNumbers = validPages.map((_, index) => 3 + index * 3);
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(2, `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${validPages.length} >>`);

  validPages.forEach((page, index) => {
    const pageObject = 3 + index * 3;
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const imageName = `Im${index}`;
    const scale = Math.min(pdfWidth / page.width, pdfHeight / page.height);
    const drawWidth = page.width * scale;
    const drawHeight = page.height * scale;
    const drawX = (pdfWidth - drawWidth) / 2;
    const drawY = (pdfHeight - drawHeight) / 2;
    const content = `q\n${drawWidth} 0 0 ${drawHeight} ${drawX} ${drawY} cm\n/${imageName} Do\nQ\n`;

    addObject(
      pageObject,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfWidth} ${pdfHeight}] /Resources << /XObject << /${imageName} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
    );

    offsets[imageObject] = byteLength;
    push(
      encodePdfText(
        `${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
      ),
    );
    push(page.bytes);
    push(encodePdfText("\nendstream\nendobj\n"));

    addObject(contentObject, `<< /Length ${content.length} >>\nstream\n${content}endstream`);
  });

  const xrefOffset = byteLength;
  const objectCount = 2 + validPages.length * 3;
  const xrefRows = ["xref", `0 ${objectCount + 1}`, "0000000000 65535 f "];
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    xrefRows.push(`${String(offsets[objectNumber]).padStart(10, "0")} 00000 n `);
  }
  xrefRows.push("trailer", `<< /Size ${objectCount + 1} /Root 1 0 R >>`, "startxref", String(xrefOffset), "%%EOF");
  push(encodePdfText(`${xrefRows.join("\n")}\n`));

  return new Blob([concatBytes(chunks)], { type: "application/pdf" });
}

async function downloadProfileImage(user, stats, topProblems, tier, classText, media, profileOptions = "left") {
  const canvas = await createProfileCanvas(user, stats, topProblems, tier, classText, media, profileOptions);
  const blob = await canvasToBlob(canvas);
  if (!blob) return;
  downloadBlob(blob, `BOJ memory - ${user.handle}.png`);
}

async function downloadProfilePdf(user, stats, topProblems, tier, classText, media, reportData, profileOptions = "left") {
  const canvases = await createFullReportCanvases(
    user,
    stats,
    topProblems,
    tier,
    classText,
    media,
    reportData,
    profileOptions,
  );
  const blob = await createPdfBlobFromCanvases(canvases);
  if (!blob) return;
  downloadBlob(blob, `BOJ memory - ${user.handle}.pdf`);
}

async function downloadBackupText(user) {
  const response = await fetch(`${apiBaseUrl}/api/backup?handle=${encodeURIComponent(user.handle)}`);
  const backupText = await response.text();

  if (!response.ok) {
    throw new Error(backupText || "백업 TXT를 만들지 못했습니다.");
  }

  downloadBlob(new Blob([backupText], { type: "text/plain;charset=utf-8" }), `BOJ memory - ${user.handle}.txt`);
}

function createOverviewPanel(user, stats, topProblems, tier, classText, media, reportData) {
  const overviewPanel = createStoryPanel("save to file");
  overviewPanel.section.classList.add("overview-story-panel");
  const profileOptions = normalizeProfileOptions("left");
  let previewTimer = 0;
  let previewVersion = 0;
  let setOverviewStatus = () => {};

  overviewPanel.inner.append(
    createElement("p", "story-value", "Save to file"),
    createElement("p", "story-detail", "SNS에 올릴 2000 x 1200 프로필 이미지를 저장할 수 있고, 아래에서 표지 구성을 미리 보며 조절할 수 있습니다."),
  );

  const actions = createElement("div", "overview-actions");
  const saveButton = createElement("button", "overview-button primary", "내 프로필 이미지로 만들기");
  saveButton.type = "button";
  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    saveButton.textContent = "이미지 만드는 중";
    try {
      await downloadProfileImage(user, stats, topProblems, tier, classText, media, profileOptions);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "내 프로필 이미지로 만들기";
    }
  });

  const pdfButton = createElement("button", "overview-button", "전체 PDF로 만들기");
  pdfButton.type = "button";
  pdfButton.addEventListener("click", async () => {
    pdfButton.disabled = true;
    pdfButton.textContent = "PDF 만드는 중";
    try {
      await downloadProfilePdf(user, stats, topProblems, tier, classText, media, reportData, profileOptions);
    } finally {
      pdfButton.disabled = false;
      pdfButton.textContent = "전체 PDF로 만들기";
    }
  });

  const backupButton = createElement("button", "overview-button", "백업 TXT 저장");
  backupButton.type = "button";
  backupButton.addEventListener("click", async () => {
    backupButton.disabled = true;
    backupButton.textContent = "TXT 만드는 중";
    try {
      await downloadBackupText(user);
      setOverviewStatus("백업 TXT를 저장했습니다.");
    } catch (error) {
      setOverviewStatus(error.message || "백업 TXT를 저장하지 못했습니다.");
    } finally {
      backupButton.disabled = false;
      backupButton.textContent = "백업 TXT 저장";
    }
  });

  const githubButton = createElement("button", "overview-button star", "★ Repo star");
  githubButton.type = "button";
  githubButton.addEventListener("click", () => {
    window.open("https://github.com/haruharo101/BOJ-memory", "_blank", "noopener,noreferrer");
  });

  actions.append(saveButton, pdfButton, backupButton, githubButton);

  const layoutToggle = createElement("div", "overview-layout-toggle");
  layoutToggle.append(createElement("span", "overview-layout-label", "표지 이미지의 요소들을..."));
  const layoutOptions = createElement("div", "overview-layout-options");
  layoutOptions.setAttribute("role", "radiogroup");
  layoutOptions.setAttribute("aria-label", "표지 이미지의 요소 정렬");

  for (const [value, labelText] of [
    ["left", "왼쪽 정렬"],
    ["right", "오른쪽 정렬"],
  ]) {
    const id = `profile-layout-${user.handle}-${value}`;
    const input = createElement("input");
    input.type = "radio";
    input.name = `profile-layout-${user.handle}`;
    input.id = id;
    input.value = value;
    input.checked = value === profileOptions.layout;
    input.addEventListener("change", () => {
      if (input.checked) {
        profileOptions.layout = value;
        schedulePreview();
      }
    });

    const option = createElement("label", "overview-layout-option", labelText);
    option.htmlFor = id;
    layoutOptions.append(input, option);
  }

  const controls = createElement("div", "overview-cover-controls");
  controls.append(createElement("p", "overview-cover-heading", "표지 커스터마이징"));
  const editor = createElement("div", "overview-editor");
  const controlColumn = createElement("div", "overview-control-column");
  const previewColumn = createElement("div", "overview-preview-column");

  const fontPanel = createElement("details", "overview-font-panel");
  const fontSummary = createElement("summary", "overview-font-summary");
  const fontSummaryCaret = createElement("span", "overview-font-caret", "▸");
  fontSummaryCaret.setAttribute("aria-hidden", "true");
  const fontSummaryTitle = createElement("strong", "overview-font-summary-title", "폰트 설정");
  const fontResetButton = createElement("button", "overview-font-reset", "기본값");
  fontResetButton.type = "button";
  fontSummary.append(fontSummaryCaret, fontSummaryTitle, fontResetButton);
  fontPanel.append(fontSummary);

  const fontGroup = createElement("div", "overview-font-group");
  const fontControls = [];

  function createFontRoleRow(roleKey, titleText) {
    const row = createElement("div", "overview-font-row");
    row.append(createElement("strong", "overview-font-row-title", titleText));

    const controlsRow = createElement("div", "overview-font-row-controls");
    const familyField = createElement("label", "overview-font-field");
    const familySelect = createElement("select", "overview-font-select");
    for (const preset of coverFontPresets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      option.style.fontFamily = preset.family;
      if (profileOptions.typography[roleKey].font === preset.id) option.selected = true;
      familySelect.append(option);
    }
    familySelect.addEventListener("change", () => {
      profileOptions.typography[roleKey].font = familySelect.value;
      schedulePreview();
    });
    familyField.append(familySelect);

    const weightField = createElement("label", "overview-font-field");
    const weightSelect = createElement("select", "overview-font-select");
    for (const weight of coverFontWeights) {
      const option = document.createElement("option");
      option.value = String(weight.value);
      option.textContent = weight.label;
      if (profileOptions.typography[roleKey].weight === weight.value) option.selected = true;
      weightSelect.append(option);
    }
    weightSelect.addEventListener("change", () => {
      profileOptions.typography[roleKey].weight = Number(weightSelect.value);
      schedulePreview();
    });
    weightField.append(weightSelect);

    const sizeField = createElement("label", "overview-font-field");
    const sizeInput = createElement("input", "overview-font-size-input");
    sizeInput.type = "text";
    sizeInput.inputMode = "numeric";
    sizeInput.autocomplete = "off";
    sizeInput.spellcheck = false;
    sizeInput.maxLength = 9;
    sizeInput.pattern = "[0-9]*";
    sizeInput.setAttribute("aria-label", `${titleText} 폰트 크기`);
    sizeInput.title = `${coverFontSizeRange.min}~${coverFontSizeRange.max} 적용, 입력은 최대 ${coverFontSizeInputMax}`;
    sizeInput.value = String(profileOptions.typography[roleKey].size);
    sizeInput.addEventListener("beforeinput", (event) => {
      if (event.inputType.startsWith("delete")) return;
      if (event.data && /\D/.test(event.data)) {
        event.preventDefault();
      }
    });
    sizeInput.addEventListener("input", () => {
      const fallback = createDefaultTypographyOptions()[roleKey].size;
      const nextValue = sanitizeFontSizeInputValue(sizeInput.value);
      sizeInput.value = nextValue;
      profileOptions.typography[roleKey].size = resolveAppliedFontSizeValue(nextValue, fallback);
      schedulePreview();
    });
    sizeInput.addEventListener("blur", () => {
      const fallback = createDefaultTypographyOptions()[roleKey].size;
      const nextValue = sanitizeFontSizeInputValue(sizeInput.value);
      profileOptions.typography[roleKey].size = resolveAppliedFontSizeValue(nextValue, fallback);
      sizeInput.value = nextValue;
      schedulePreview();
    });
    sizeField.append(sizeInput);

    controlsRow.append(familyField, weightField, sizeField);
    row.append(controlsRow);
    fontGroup.append(row);
    fontControls.push({ roleKey, familySelect, weightSelect, sizeInput });
  }

  function syncTypographyControls() {
    const normalizedTypography = normalizeTypographyOptions(profileOptions.typography);
    for (const control of fontControls) {
      control.familySelect.value = normalizedTypography[control.roleKey].font;
      control.weightSelect.value = String(normalizedTypography[control.roleKey].weight);
      control.sizeInput.value = String(normalizedTypography[control.roleKey].size);
    }
  }

  fontResetButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    profileOptions.typography = createDefaultTypographyOptions();
    syncTypographyControls();
    schedulePreview();
  });

  createFontRoleRow("handle", "아이디");
  createFontRoleRow("bio", "상태메시지");
  createFontRoleRow("ranking", "랭킹");
  createFontRoleRow("statLabel", "통계 라벨");
  createFontRoleRow("statValue", "통계 값");
  createFontRoleRow("ratingLabel", "레이팅 라벨");
  createFontRoleRow("ratingValue", "레이팅 값");
  createFontRoleRow("tier", "티어 / 클래스");
  createFontRoleRow("meta", "배경 / 뱃지");
  fontPanel.append(fontGroup);

  const showMetaRow = createElement("label", "overview-check");
  const showMetaInput = createElement("input");
  showMetaInput.type = "checkbox";
  showMetaInput.checked = profileOptions.cover.showMeta;
  showMetaInput.addEventListener("change", () => {
    profileOptions.cover.showMeta = showMetaInput.checked;
    schedulePreview();
  });
  showMetaRow.append(showMetaInput, createElement("span", "overview-check-label", "배경 / 뱃지 정보 표시"));

  const backgroundModeGroup = createElement("div", "overview-layout-toggle");
  backgroundModeGroup.append(createElement("span", "overview-layout-label", "표지 배경 구성"));
  const backgroundModeOptions = createElement("div", "overview-layout-options");
  backgroundModeOptions.setAttribute("role", "radiogroup");
  backgroundModeOptions.setAttribute("aria-label", "표지 배경 구성");

  for (const [value, labelText] of [
    ["rear", "뒷배경만"],
    ["dual", "앞 / 뒷배경"],
  ]) {
    const id = `profile-background-mode-${user.handle}-${value}`;
    const input = createElement("input");
    input.type = "radio";
    input.name = `profile-background-mode-${user.handle}`;
    input.id = id;
    input.value = value;
    input.checked = value === profileOptions.cover.backgroundMode;
    input.addEventListener("change", () => {
      if (input.checked) {
        profileOptions.cover.backgroundMode = value;
        syncFrontLayerState();
        schedulePreview();
      }
    });

    const option = createElement("label", "overview-layout-option", labelText);
    option.htmlFor = id;
    backgroundModeOptions.append(input, option);
  }
  backgroundModeGroup.append(backgroundModeOptions);

  const sliders = createElement("div", "overview-cover-sliders");
  const sliderRows = [];

  function createSliderRow(key, labelText, { min, max, step, suffix }) {
    const row = createElement("label", "overview-slider-row");
    row.dataset.key = key;
    const head = createElement("div", "overview-slider-head");
    const label = createElement("span", "overview-slider-label", labelText);
    const valueText = createElement("strong", "overview-slider-value", "");
    head.append(label, valueText);

    const input = createElement("input", "overview-slider-input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(profileOptions.cover[key]);

    const sync = () => {
      valueText.textContent = `${input.value}${suffix}`;
    };

    input.addEventListener("input", () => {
      profileOptions.cover[key] = Number(input.value);
      sync();
      schedulePreview();
    });

    sync();
    row.append(head, input);
    sliders.append(row);
    sliderRows.push({ key, row, input, valueText, sync });
  }

  createSliderRow("rearBlur", "뒷배경 블러", { min: 0, max: 32, step: 1, suffix: "px" });
  createSliderRow("rearOpacity", "뒷배경 불투명도", { min: 0, max: 100, step: 1, suffix: "%" });
  createSliderRow("frontBlur", "앞배경 블러", { min: 0, max: 24, step: 1, suffix: "px" });
  createSliderRow("frontOpacity", "앞배경 불투명도", { min: 0, max: 100, step: 1, suffix: "%" });

  function syncFrontLayerState() {
    const disabled = profileOptions.cover.backgroundMode !== "dual";
    for (const item of sliderRows) {
      if (!item.key.startsWith("front")) continue;
      item.row.classList.toggle("is-disabled", disabled);
      item.input.disabled = disabled;
    }
  }

  const previewPanel = createElement("div", "overview-preview");
  const previewHead = createElement("div", "overview-preview-head");
  previewHead.append(createElement("span", "overview-layout-label", "미리보기"));
  const previewFrame = createElement("div", "overview-preview-frame");
  const previewCanvas = createElement("canvas", "overview-preview-canvas");
  const previewSize = createElement("span", "overview-preview-size", "실제 저장 표지 기준");
  previewCanvas.width = profileImageWidth;
  previewCanvas.height = profileImageHeight;
  previewCanvas.setAttribute("aria-label", `${user.handle} 표지 미리보기`);
  const previewContext = previewCanvas.getContext("2d");
  const previewStatus = createElement("p", "overview-preview-status", "미리보기를 준비하는 중입니다.");
  setOverviewStatus = (text) => {
    previewStatus.textContent = text;
  };
  previewFrame.append(previewCanvas, previewSize);
  previewPanel.append(previewHead, previewFrame, previewStatus);

  async function refreshPreview() {
    const currentVersion = ++previewVersion;
    previewStatus.textContent = "미리보기를 만드는 중입니다.";

    try {
      const canvas = await createProfileCanvas(
        user,
        stats,
        topProblems,
        tier,
        classText,
        media,
        {
          layout: profileOptions.layout,
          typography: normalizeTypographyOptions(profileOptions.typography),
          cover: { ...profileOptions.cover },
        },
      );
      if (currentVersion !== previewVersion || !previewContext) return;

      previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      previewContext.imageSmoothingEnabled = true;
      previewContext.imageSmoothingQuality = "high";
      previewContext.drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height);
      previewStatus.textContent = "지금 설정으로 저장됩니다.";
    } catch {
      if (currentVersion !== previewVersion) return;
      previewStatus.textContent = "미리보기를 만들지 못했습니다.";
    }
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      refreshPreview();
    }, 140);
  }

  controls.append(fontPanel, showMetaRow, backgroundModeGroup, sliders);
  layoutToggle.append(layoutOptions);
  controlColumn.append(actions, layoutToggle, controls);
  previewColumn.append(previewPanel);
  editor.append(controlColumn, previewColumn);
  overviewPanel.inner.append(editor);
  syncFrontLayerState();
  schedulePreview();
  return overviewPanel.section;
}

function animateNumber(element) {
  const currentFrame = numberAnimationFrames.get(element);
  if (currentFrame) cancelAnimationFrame(currentFrame);
  const target = Number(element.dataset.target || 0);
  const formatter = element.dataset.format === "over-rating" ? formatOverRating : formatNumber;
  const duration = Math.min(1250, 560 + String(Math.floor(target)).length * 110);
  const startTime = performance.now();
  element.textContent = formatter(0);

  function frame(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = progress === 1 ? 1 : 1 - 2 ** (-10 * progress);
    const value = Math.round(target * eased);
    element.textContent = formatter(value);

    if (progress < 1) {
      numberAnimationFrames.set(element, requestAnimationFrame(frame));
      return;
    }

    element.textContent = formatter(target);
    numberAnimationFrames.delete(element);
  }

  numberAnimationFrames.set(element, requestAnimationFrame(frame));
}

function observeStory() {
  storyObserver?.disconnect();
  storyObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
        storyIntersectionRatios.set(entry.target, ratio);
        if (!entry.isIntersecting && entry.intersectionRatio < 0.02) continue;

        entry.target.classList.add("is-visible");
      }

      const observedTargets = [intro, ...memory.querySelectorAll(".story-panel")].filter(Boolean);
      let bestTarget = null;
      let bestScore = 0;

      for (const target of observedTargets) {
        const ratio = storyIntersectionRatios.get(target) ?? 0;
        if (ratio < 0.02) continue;

        const rect = target.getBoundingClientRect();
        const viewportCenter = window.innerHeight / 2;
        const targetCenter = rect.top + rect.height / 2;
        const centerDistance = Math.abs(viewportCenter - targetCenter);
        const centerScore = Math.max(0, 1 - centerDistance / Math.max(window.innerHeight, 1));
        const score = ratio * 100 + centerScore;

        if (score > bestScore) {
          bestScore = score;
          bestTarget = target;
        }
      }

      if (bestTarget && setActiveCategory(bestTarget.dataset.category)) {
        for (const number of bestTarget.querySelectorAll(".story-number")) {
          animateNumber(number);
        }
      }
    },
    { threshold: [0.02, 0.08, 0.18] },
  );

  for (const panel of memory.querySelectorAll(".story-panel")) {
    storyObserver.observe(panel);
  }

  if (intro) storyObserver.observe(intro);
}

function categorySelector(category) {
  return `[data-category="${String(category).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function storyTargetForCategory(category) {
  if (intro?.dataset.category === category) return intro;
  return memory.querySelector(`.story-panel${categorySelector(category)}`);
}

function renderStoryNav(categories) {
  storyNav.style.setProperty("--story-count", categories.length);
  storyNav.replaceChildren(
    ...categories.map((category) => {
      const item = createElement("button", "story-nav-item", category);
      item.type = "button";
      item.dataset.navCategory = category;
      item.addEventListener("click", () => {
        storyTargetForCategory(category)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      return item;
    }),
  );
  syncStoryNavState(activeCategory || categories[0] || "");
}

function syncStoryNavState(category) {
  for (const item of storyNav.querySelectorAll(".story-nav-item")) {
    item.classList.toggle("is-active", item.dataset.navCategory === category);
  }

  if (storyNavCurrent) {
    if (category) {
      storyNavCurrent.textContent = category;
    }
    storyNavCurrent.classList.toggle("is-visible", storyNav.childElementCount > 0);
  }
}

function scheduleStoryNavState(category) {
  if (window.innerWidth > 820) {
    if (mobileNavFrame) {
      cancelAnimationFrame(mobileNavFrame);
      mobileNavFrame = 0;
    }
    syncStoryNavState(category);
    return;
  }

  mobileNavCategory = category;
  if (mobileNavFrame) return;

  mobileNavFrame = requestAnimationFrame(() => {
    syncStoryNavState(mobileNavCategory);
    mobileNavFrame = 0;
  });
}

function setActiveCategory(category) {
  const changed = activeCategory !== category;
  activeCategory = category;
  scheduleStoryNavState(category);

  for (const panel of memory.querySelectorAll(".story-panel")) {
    if (panel.dataset.category === category) continue;

    const wasCurrent = panel.classList.contains("is-current");
    panel.classList.remove("is-current");

    if (wasCurrent && panel.classList.contains("rating-story-panel")) {
      const previousTimer = panelResetTimers.get(panel);
      if (previousTimer) clearTimeout(previousTimer);

      panel.classList.add("is-leaving");
      const timer = setTimeout(() => {
        panel.classList.remove("is-leaving");
        panelResetTimers.delete(panel);
      }, 900);
      panelResetTimers.set(panel, timer);
    }
  }

  const currentPanel = memory.querySelector(`.story-panel${categorySelector(category)}`);
  if (currentPanel) {
    const previousTimer = panelResetTimers.get(currentPanel);
    if (previousTimer) clearTimeout(previousTimer);

    currentPanel.classList.remove("is-leaving");
    requestAnimationFrame(() => currentPanel.classList.add("is-current"));

    if (currentPanel.classList.contains("rating-story-panel") && !currentPanel.classList.contains("has-tier-animation-played")) {
      const previousTierTimer = tierAnimationTimers.get(currentPanel);
      if (previousTierTimer) clearTimeout(previousTierTimer);

      const tierTimer = setTimeout(() => {
        currentPanel.classList.add("has-tier-animation-played");
        tierAnimationTimers.delete(currentPanel);
      }, 1320);
      tierAnimationTimers.set(currentPanel, tierTimer);
    }
  }

  return changed;
}

function renderMemory(payload) {
  const { user, badge, background, classStats = [], topProblems = [], bojStats = [], languageStats = [], stats } = payload;
  const backgroundData = background?.background ?? background;
  const badgeData = badge?.badge ?? badge;
  const tier = tierInfo(user.tier);
  const profileUrl = user.profileImageUrl || fallbackProfile(user.handle);
  const backgroundUrl =
    backgroundData?.backgroundImageUrl || backgroundData?.fallbackBackgroundImageUrl || fallbackBackground();
  const badgeUrl = badgeData?.badgeImageUrl || fallbackBadge();
  const classText = user.class ? `CLASS ${user.class}${classDecorationLabel(user.classDecoration)}` : "CLASS 없음";
  const bojRank = bojStats.find((stat) => stat.label === "등수")?.value;
  const categories = [
    "search",
    "user info",
    "class",
    "AC RATING",
    "BOJ stats",
    "language stats",
    "save to file",
  ];

  const story = createElement("article", "story");

  const userPanel = createStoryPanel("user info");
  userPanel.section.classList.add("user-story-panel");
  const backgroundFrame = createElement("figure", "user-background");
  const backgroundImage = createElement("img", "user-background-image");
  backgroundImage.src = backgroundUrl;
  backgroundImage.alt = backgroundData?.displayName ? `${backgroundData.displayName} 배경` : "배경";
  backgroundFrame.style.setProperty("--user-background-url", `url(${JSON.stringify(backgroundUrl)})`);
  backgroundFrame.append(backgroundImage);
  userPanel.section.prepend(backgroundFrame);

  const userMedia = createElement("div", "user-media-row");
  const profileImage = createElement("img", "story-avatar");
  profileImage.src = profileUrl;
  profileImage.alt = `${user.handle} 프로필 사진`;

  const badgeFrame = createElement("figure", "user-badge");
  const badgeImage = createElement("img", "user-badge-image");
  badgeImage.src = badgeUrl;
  badgeImage.alt = badgeData?.displayName ? `${badgeData.displayName} 뱃지` : "뱃지";
  badgeFrame.append(badgeImage);
  userMedia.append(profileImage, badgeFrame);

  userPanel.inner.append(userMedia, createElement("h2", "story-title", user.handle));
  if (user.bio) userPanel.inner.append(createElement("p", "story-detail", user.bio));
  const userRankings = createElement("div", "user-ranking-row");
  userRankings.append(
    createElement("span", "user-ranking-text", `solved.ac ranking #${formatNumber(user.rank || 0)}`),
    createElement("span", "user-ranking-text", `BOJ ranking #${bojRank ? formatNumber(bojRank) : "--"}`),
  );
  userPanel.inner.append(userRankings);

  const userStats = createElement("div", "user-summary-stats");
  const summaryItems = [
    ["푼 문제 수", stats.solvedCount],
    ["기여한 문제 수", stats.contributionCount],
    ["라이벌 수", stats.rivalCount],
    ["최장 스트릭", stats.maxStreak ?? user.maxStreak ?? 0],
  ];

  for (const [label, value] of summaryItems) {
    const item = createElement("div", "user-summary-item");
    const number = createElement("strong", "user-summary-value story-number", "0");
    number.dataset.target = String(value);
    item.append(number, createElement("span", "user-summary-label", label));
    userStats.append(item);
  }

  userPanel.inner.append(userStats);
  const userMeta = createElement("div", "user-meta-list");
  userMeta.append(
    createElement("p", "user-meta-text", `배경 : ${backgroundData?.displayName || user.backgroundId || "배경 없음"}`),
    createElement("p", "user-meta-text", `뱃지 : ${badgeData?.displayName || user.badgeId || "장착한 뱃지 없음"}`),
  );
  userPanel.inner.append(userMeta);
  story.append(userPanel.section);

  const classPanel = createStoryPanel("class");
  classPanel.section.classList.add("class-story-panel");
  classPanel.inner.append(createElement("p", "story-value", classText), createClassProgress(classStats));
  story.append(classPanel.section);

  const ratingPanel = createStoryPanel("AC RATING");
  const ratingValue = createElement("p", `story-value story-number tier-${tier.family}`, "0");
  ratingValue.dataset.target = String(stats.rating);
  ratingPanel.section.classList.add("rating-story-panel");
  const ratingHeadline = createElement("div", "rating-headline");
  const overRating = createElement("div", "over-rating-chip");
  const overRatingBand = overRatingGradientBand(user.overRating);
  if (overRatingBand) {
    overRating.classList.add("has-over-rating-gradient");
    overRating.style.setProperty("--over-rating-gradient", overRatingBand.css);
  }
  const overRatingValue = createElement("strong", "over-rating-value story-number", "0.0");
  overRatingValue.dataset.target = String(user.overRating || 0);
  overRatingValue.dataset.format = "over-rating";
  overRating.append(
    createElement("span", "over-rating-label", "OVER RATING"),
    overRatingValue,
  );
  ratingHeadline.append(ratingValue, overRating);
  ratingPanel.inner.append(
    ratingHeadline,
    createElement("p", `story-detail tier-${tier.family}`, tier.name),
    createRatingDetails(user, stats, topProblems),
  );
  story.append(ratingPanel.section);

  story.append(createBojStatsPanel(bojStats));
  story.append(createLanguageStatsPanel(languageStats));
  story.append(
    createOverviewPanel(user, stats, topProblems, tier, classText, {
      profileUrl,
      backgroundUrl,
      badgeUrl,
      backgroundName: backgroundData?.displayName || user.backgroundId || "배경 없음",
      badgeName: badgeData?.displayName || user.badgeId || "장착한 뱃지 없음",
      bojRank,
    }, {
      classStats,
      bojStats,
      languageStats,
    }),
  );

  memory.replaceChildren(story);
  syncSearchScrollLock();
  activeCategory = "";
  renderStoryNav(categories);
  observeStory();
  memory.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadMemory(handle) {
  const response = await fetch(`${apiBaseUrl}/api/memory?handle=${encodeURIComponent(handle)}`);
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error("API 서버에서 JSON 응답을 받지 못했습니다. 잠시 후 다시 시도해주세요.");
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || "기록을 가져오지 못했습니다.");
  }

  return payload;
}

async function loadBackupFile(file) {
  if (!(file instanceof File)) {
    throw new Error("불러올 백업 TXT 파일을 선택해주세요.");
  }

  const fileName = String(file.name || "");
  if (!/\.txt$/i.test(fileName)) {
    throw new Error("TXT 형식의 백업 파일만 불러올 수 있습니다.");
  }

  if (file.size > backupImportMaxBytes) {
    throw new Error("백업 TXT 파일 크기가 너무 큽니다.");
  }

  const backupText = await file.text();
  const response = await fetch(`${apiBaseUrl}/api/backup/import`, {
    method: "POST",
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
    body: backupText,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || "백업 TXT를 불러오지 못했습니다.");
  }

  return payload;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const handle = handleInput.value.trim();

  if (!handle) return;

  form.querySelector("button").disabled = true;
  message.textContent = `${handle}의 기록을 꺼내는 중입니다.`;

  try {
    const payload = await loadMemory(handle);
    renderMemory(payload);
    message.textContent = "기록을 불러왔습니다.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    form.querySelector("button").disabled = false;
  }
});

backupImportTrigger?.addEventListener("click", () => {
  backupImportInput?.click();
});

backupImportInput?.addEventListener("change", async () => {
  const [file] = backupImportInput.files ?? [];
  if (!file) return;

  backupImportTrigger.disabled = true;
  backupImportTrigger.classList.add("is-loading");
  backupImportTrigger.textContent = "TXT 불러오는 중";
  message.textContent = `${file.name} 백업 TXT를 검증하는 중입니다.`;

  try {
    const result = await loadBackupFile(file);
    handleInput.value = result.payload.user.handle;
    renderMemory(result.payload);
    message.textContent = result.verification?.signatureVerified
      ? "서버 서명까지 확인된 백업 TXT를 불러왔습니다."
      : "형식과 무결성을 통과한 백업 TXT를 불러왔습니다.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    backupImportTrigger.disabled = false;
    backupImportTrigger.classList.remove("is-loading");
    backupImportTrigger.textContent = "백업 TXT 불러오기";
    backupImportInput.value = "";
  }
});

window.addEventListener("pageshow", pinInitialSearchPosition);
pinInitialSearchPosition();
syncSearchScrollLock();
startMemoryGraph(graphCanvas);
