/**
 * 主题配色回归测试。
 *
 * 起因：2.2.0 之前面板把 `--dsw-alias-bg-l1` / `--dsw-alias-bg-l2` 当作背景色，
 * 但 DSH 主题里**并没有这两个变量**（真正存在的是 `--dsw-alias-bg-base` 和
 * `--dsw-alias-bg-layer-1/2/3`）。于是 var() 永远回退到写死的 #fff：浅色下看
 * 不出来，深色主题下文字变近白、底色仍是纯白，整块面板糊成灰白一片。
 *
 * 这类问题跑功能测试发现不了——DOM 结构、接口、事件全都正常，只是颜色不对。
 * 所以这里单独做两件事：
 *   1. 静态校验插件 CSS 引用的每个 DSH token 都真实存在于主题里（挡住变量名写错）；
 *   2. 用 DSH 真实的明 / 暗两套 token 取值，算 WCAG 对比度，挡住「能解析但看不清」。
 *
 * THEME 表里的取值来自 DSH Desktop 0.2.1-rc.3 的 design-platform.css。DSH 升级
 * 换了调色板时，这个测试会先失败，提醒我们同步核对。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "lib", "client.js"), "utf8");
const cssRaw = source.match(/const CSS = `([\s\S]*?)`;/)?.[1] ?? "";
if (cssRaw === "") throw new Error("没能从 lib/client.js 里解析出 CSS 块");
// 注释里会提到历史变量名，扫描前先剥掉，否则会被算成"还在引用"。
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

/* ------------------------------------------------------------------ */
/* DSH 真实主题取值（light / dark）                                      */
/* ------------------------------------------------------------------ */

const THEME = {
	"--dsw-alias-bg-base": { light: "#ffffff", dark: "#151517" },
	"--dsw-alias-bg-layer-1": { light: "#ffffff", dark: "#232324" },
	"--dsw-alias-bg-layer-2": { light: "#ffffff", dark: "#2c2c2e" },
	"--dsw-alias-bg-layer-3": { light: "#ffffff", dark: "#353638" },
	"--dsw-alias-bg-skeleton": { light: "rgba(0,0,0,.04)", dark: "rgba(255,255,255,.08)" },
	"--dsw-alias-bg-mask-1": { light: "rgba(0,0,0,.24)", dark: "rgba(0,0,0,.5)" },
	"--dsw-alias-label-primary": { light: "#0f1115", dark: "#f9fafb" },
	"--dsw-alias-label-secondary": { light: "#61666b", dark: "#cfd3d6" },
	"--dsw-alias-label-tertiary": { light: "#81858c", dark: "#adb2b8" },
	"--dsw-alias-label-primary-foreground": { light: "#ffffff", dark: "#0f1115" },
	"--dsw-alias-border-l2": { light: "rgba(0,0,0,.1)", dark: "rgba(255,255,255,.12)" },
	"--dsw-alias-border-l3": { light: "rgba(0,0,0,.12)", dark: "rgba(255,255,255,.16)" },
	"--dsw-alias-interactive-bg-hover": { light: "rgba(38,49,72,.06)", dark: "rgba(255,255,255,.08)" },
	"--dsw-alias-state-business-primary": { light: "#4176e6", dark: "#7aaaff" },
	"--dsw-alias-state-error-primary": { light: "#ec1313", dark: "#f25a5a" },
	"--dsw-alias-state-success-primary": { light: "#22c55e", dark: "#22c55e" },
	"--dsw-alias-scrollbar-bg-l2": { light: "#e5e5e5", dark: "#545557" },
};

/* ------------------------------------------------------------------ */
/* 颜色工具                                                             */
/* ------------------------------------------------------------------ */

/** 解析 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba()，返回 [r,g,b,a]。 */
function parseColor(text) {
	const value = text.trim();
	let match = /^#([0-9a-f]{3,8})$/i.exec(value);
	if (match !== null) {
		let hex = match[1];
		if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
		if (hex.length !== 6 && hex.length !== 8) return null;
		const r = parseInt(hex.slice(0, 2), 16);
		const g = parseInt(hex.slice(2, 4), 16);
		const b = parseInt(hex.slice(4, 6), 16);
		const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
		return [r, g, b, a];
	}
	match = /^rgba?\(([^)]+)\)$/i.exec(value);
	if (match !== null) {
		const parts = match[1].split(/[,/\s]+/).filter(Boolean);
		if (parts.length < 3) return null;
		const channel = (piece) => {
			const n = parseFloat(piece);
			return piece.trim().endsWith("%") ? (n / 100) * 255 : n;
		};
		const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
		return [channel(parts[0]), channel(parts[1]), channel(parts[2]), Number.isFinite(alpha) ? alpha : 1];
	}
	return null;
}

/** 把带 alpha 的前景色合成到不透明背景上。 */
function composite(foreground, background) {
	const [r, g, b, a] = foreground;
	const [br, bg, bb] = background;
	return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

/** WCAG 相对亮度。 */
function luminance([r, g, b]) {
	const channel = (value) => {
		const scaled = value / 255;
		return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度。前景允许半透明，会先合成到背景上。 */
function contrast(foreground, background) {
	const solid = composite(foreground, background);
	const [lighter, darker] = [luminance(solid), luminance(background)].sort((a, b) => b - a);
	return (lighter + 0.05) / (darker + 0.05);
}

/* ------------------------------------------------------------------ */
/* 解析插件 CSS 中的 --lanchat-* 定义                                    */
/* ------------------------------------------------------------------ */

const DEFINITIONS = new Map();
for (const match of css.matchAll(/(--lanchat-[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
	DEFINITIONS.set(match[1], match[2].trim());
}
if (DEFINITIONS.size === 0) throw new Error("CSS 里没有找到任何 --lanchat-* 定义");

/** 变量名 → 颜色：插件自己的变量查 DEFINITIONS，其余查 THEME。 */
function lookup(name, theme, depth) {
	if (name.startsWith("--lanchat-")) {
		const definition = DEFINITIONS.get(name);
		return definition === undefined ? null : resolve(definition, theme, depth + 1);
	}
	const themed = THEME[name];
	return themed === undefined ? null : parseColor(themed[theme]);
}

/** 递归解析 var() 与单色 color-mix()，返回颜色数组或 null。 */
function resolve(value, theme, depth = 0) {
	if (depth > 12) return null;
	const text = value.trim();

	// 直接给一个变量名（测试里就是这么调用的）。
	if (/^--[a-z0-9-]+$/i.test(text)) return lookup(text, theme, depth);

	const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(transparent|.+)\)$/i.exec(text);
	if (mix !== null) {
		const base = resolve(mix[1], theme, depth + 1);
		if (base === null) return null;
		const ratio = parseFloat(mix[2]) / 100;
		if (mix[3].toLowerCase() === "transparent") return [base[0], base[1], base[2], base[3] * ratio];
		const other = resolve(mix[3], theme, depth + 1);
		if (other === null) return null;
		return [
			base[0] * ratio + other[0] * (1 - ratio),
			base[1] * ratio + other[1] * (1 - ratio),
			base[2] * ratio + other[2] * (1 - ratio),
			base[3] * ratio + other[3] * (1 - ratio),
		];
	}

	const variable = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i.exec(text);
	if (variable !== null) {
		const resolved = lookup(variable[1], theme, depth);
		if (resolved !== null) return resolved;
		return variable[2] === undefined ? null : resolve(variable[2], theme, depth + 1);
	}

	return parseColor(text);
}

/* ------------------------------------------------------------------ */
/* 断言                                                                */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];
function check(name, condition, detail) {
	if (condition) {
		passed += 1;
		return;
	}
	failures.push(`${name}${detail === undefined ? "" : ` — ${detail}`}`);
}

// 1. CSS 引用的每个 DSH token 都必须真实存在。
const referenced = new Set([...css.matchAll(/--dsw-alias-[a-z0-9-]+/gi)].map((m) => m[0]));
check("CSS 引用了 DSH token", referenced.size > 0, `找到 ${referenced.size} 个`);
for (const token of [...referenced].sort()) {
	check(`token 存在: ${token}`, THEME[token] !== undefined, "DSH 主题里没有这个变量，var() 会静默回退到写死的兜底值");
}

// 2. 曾经踩过的坑单独留一条，防止有人又改回去。
for (const gone of ["--dsw-alias-bg-l1", "--dsw-alias-bg-l2"]) {
	check(`不再引用不存在的 ${gone}`, !referenced.has(gone), "DSH 用的是 --dsw-alias-bg-base / --dsw-alias-bg-layer-N");
}

// 3. 两套主题都要能解析出全部变量。
for (const theme of ["light", "dark"]) {
	for (const name of DEFINITIONS.keys()) {
		const value = resolve(name, theme);
		check(`${theme} 可解析 ${name}`, value !== null, `原始值 ${DEFINITIONS.get(name)}`);
	}
}

// 4. 对比度。基础阅读文本按 4.5，弱化小字按 3，按钮文字按 4。
const CONTRAST_TARGETS = [
	{ name: "正文 fg", foreground: "--lanchat-fg", background: "--lanchat-bg", minimum: 7 },
	{ name: "次级 dim", foreground: "--lanchat-dim", background: "--lanchat-bg", minimum: 4.5 },
	{ name: "弱化 faint", foreground: "--lanchat-faint", background: "--lanchat-bg", minimum: 3 },
	{ name: "气泡内正文", foreground: "--lanchat-fg", background: "--lanchat-bubble", minimum: 6 },
	{ name: "弹窗正文", foreground: "--lanchat-fg", background: "--lanchat-raised", minimum: 7 },
	{ name: "强调块上文字", foreground: "--lanchat-on-accent", background: "--lanchat-accent", minimum: 4 },
	{ name: "危险色提示", foreground: "--lanchat-danger", background: "--lanchat-bg", minimum: 4 },
];

const ratios = {};
const PAGE = { light: [255, 255, 255, 1], dark: [21, 21, 23, 1] };
for (const theme of ["light", "dark"]) {
	const page = PAGE[theme];
	for (const target of CONTRAST_TARGETS) {
		const foreground = resolve(target.foreground, theme);
		const backdrop = resolve(target.background, theme);
		if (foreground === null || backdrop === null) {
			check(`${theme} ${target.name} 可解析`, false, `${target.foreground} on ${target.background}`);
			continue;
		}
		// 背景自身若半透明（如气泡底色），先按它合成到页面底色上。
		const solid = backdrop[3] === 1 ? backdrop : composite(backdrop, page);
		const ratio = contrast(foreground, solid);
		ratios[`${theme}/${target.name}`] = Number(ratio.toFixed(2));
		check(`${theme} ${target.name} 对比度 ≥ ${target.minimum}`, ratio >= target.minimum, `实际 ${ratio.toFixed(2)}`);
	}
}

// 6. 面板底色本身必须贴合页面底色，否则深色主题下会显出一块白板。
for (const theme of ["light", "dark"]) {
	const panel = resolve("--lanchat-bg", theme);
	check(`${theme} 面板底色不透明`, panel !== null && panel[3] === 1, "面板底色必须能算出实色");
	if (panel === null) continue;
	const againstPage = contrast(panel, PAGE[theme]);
	check(`${theme} 面板贴合页面底色`, againstPage < 2.2, `与页面底色对比 ${againstPage.toFixed(2)}，太大说明深浅反了`);
}

// 5. 明暗两套必须真的不一样——这条直接对应「深色主题下还是白底」的原始缺陷。
const lightBackground = resolve("--lanchat-bg", "light");
const darkBackground = resolve("--lanchat-bg", "dark");
check(
	"深色背景确实变暗",
	lightBackground !== null && darkBackground !== null && luminance(darkBackground) < 0.1 && luminance(lightBackground) > 0.5,
	`light=${JSON.stringify(lightBackground)} dark=${JSON.stringify(darkBackground)}`,
);
check(
	"明暗背景不同色",
	lightBackground !== null && darkBackground !== null && contrast(lightBackground, darkBackground) > 5,
	"两套主题解析出同一个背景色，说明变量没有跟随主题",
);

/* ------------------------------------------------------------------ */

if (failures.length > 0) {
	console.error(`主题配色测试失败 ${failures.length} 项：`);
	for (const failure of failures) console.error(`  ✗ ${failure}`);
	process.exit(1);
}

console.log(`主题配色测试通过：${passed} 项`);
console.log(`  扫描 DSH token ${referenced.size} 个、插件变量 ${DEFINITIONS.size} 个，明暗两套共 ${Object.keys(ratios).length} 组对比度`);
for (const [key, ratio] of Object.entries(ratios)) console.log(`  ${key.padEnd(26)} ${ratio}`);
