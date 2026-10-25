window.__ModuleLoader__.load({
	id: "dsh-lan-chat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		/** 侧边栏条目 / 主面板共用的 id（必须一致，否则 layout.selectPanel 会抛错）。 */
		const PANEL_ID = "lan-chat";
		/** 侧边栏排序：排在会话、插件之后。 */
		const PANEL_ORDER = 6;
		/** locale 命名空间。 */
		const NS = "lan-chat";
		/** 宿主路由前缀。 */
		const API = "/lan-chat";

		const PANEL_TITLE = "局域网聊天助手";

		// ------------------------------------------------------------------
		// 图标（内联 SVG，不依赖 ui-primitives 的导出是否齐全）
		// ------------------------------------------------------------------

		function icon(size, children, extra) {
			return h(
				"svg",
				Object.assign(
					{
						width: size,
						height: size,
						viewBox: "0 0 16 16",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: 1.4,
						strokeLinecap: "round",
						strokeLinejoin: "round",
						"aria-hidden": "true",
						focusable: "false",
					},
					extra,
				),
				children,
			);
		}

		function IconChat(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [
				h("path", { key: "a", d: "M13.5 8.5a5 5 0 0 1-5 5H4.2L2 15V8.5a5 5 0 0 1 5-5h1.5a5 5 0 0 1 5 5Z" }),
				h("path", { key: "b", d: "M5.6 7.4h4.8M5.6 9.8h3.2" }),
			]);
		}
		function IconUsers(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [
				h("circle", { key: "a", cx: 6, cy: 5.4, r: 2.4 }),
				h("path", { key: "b", d: "M1.8 13.6c0-2.2 1.9-3.6 4.2-3.6s4.2 1.4 4.2 3.6" }),
				h("path", { key: "c", d: "M10.6 3.3a2.3 2.3 0 0 1 0 4.3M11.6 10.2c1.6.3 2.6 1.5 2.6 3.4" }),
			]);
		}
		function IconRadar(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [
				h("circle", { key: "a", cx: 8, cy: 8, r: 6.2 }),
				h("circle", { key: "b", cx: 8, cy: 8, r: 3.4 }),
				h("circle", { key: "c", cx: 8, cy: 8, r: 0.9, fill: "currentColor", stroke: "none" }),
				h("path", { key: "d", d: "M8 8 12 4.2" }),
			]);
		}
		function IconPlus(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [h("path", { key: "a", d: "M8 3v10M3 8h10" })]);
		}
		function IconClip(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [
				h("path", { key: "a", d: "M12.6 7.3 8.2 11.7a3 3 0 0 1-4.2-4.2l4.9-4.9a2 2 0 0 1 2.8 2.8l-4.9 4.9a1 1 0 0 1-1.4-1.4l4.2-4.2" }),
			]);
		}
		function IconSend(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [h("path", { key: "a", d: "M14 2 7 9M14 2l-4.4 12-2.6-5-5-2.6L14 2Z" })]);
		}
		function IconSliders(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [
				h("path", { key: "a", d: "M2 4.6h12M2 11.4h12" }),
				h("circle", { key: "b", cx: 5.4, cy: 4.6, r: 1.5, fill: "var(--lc-bg, #fff)" }),
				h("circle", { key: "c", cx: 10.6, cy: 11.4, r: 1.5, fill: "var(--lc-bg, #fff)" }),
			]);
		}
		function IconRefresh(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [
				h("path", { key: "a", d: "M13.2 8a5.2 5.2 0 1 1-1.6-3.7" }),
				h("path", { key: "b", d: "M13.4 2v3.2h-3.2" }),
			]);
		}
		function IconSearch(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [
				h("circle", { key: "a", cx: 7.2, cy: 7.2, r: 4.4 }),
				h("path", { key: "b", d: "m10.6 10.6 3 3" }),
			]);
		}
		function IconClose(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [h("path", { key: "a", d: "m4 4 8 8M12 4l-8 8" })]);
		}
		function IconDownload(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [
				h("path", { key: "a", d: "M8 2.5v7.5M5 7.4 8 10.4l3-3" }),
				h("path", { key: "b", d: "M3 12.5h10" }),
			]);
		}
		function IconTrash(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [
				h("path", { key: "a", d: "M2.6 4.4h10.8M6 4.4V2.9h4v1.5M4.2 4.4l.6 8.1h6.4l.6-8.1" }),
			]);
		}
		function IconChevron(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [h("path", { key: "a", d: "M10 3.5 5.5 8l4.5 4.5" })]);
		}
		function IconCheck(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [h("path", { key: "a", d: "m3 8.4 3.2 3.2L13 4.8" })]);
		}

		// ------------------------------------------------------------------
		// 样式
		// ------------------------------------------------------------------

		const STYLE_ID = "dsh-lan-chat-style";

		const CSS = `
.lc-root{
	--lc-bg:var(--dsw-alias-bg-l1,#fff);
	--lc-fg:var(--dsw-alias-label-primary,#1c1c1e);
	--lc-dim:var(--dsw-alias-label-secondary,#6b7280);
	--lc-faint:var(--dsw-alias-label-tertiary,#9ca3af);
	--lc-line:var(--dsw-alias-border-l2,rgba(0,0,0,.09));
	--lc-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
	--lc-accent:var(--dsw-alias-state-business-primary,#4d6bfe);
	--lc-accent-soft:rgba(77,107,254,.12);
	--lc-bubble:var(--dsw-alias-bg-l2,rgba(0,0,0,.04));
	--lc-danger:#e5484d;
	--lc-ok:#2ea043;
	box-sizing:border-box;height:100%;min-height:0;display:flex;overflow:hidden;
	background:var(--lc-bg);color:var(--lc-fg);
	font-size:13px;line-height:1.55;
	-webkit-font-smoothing:antialiased;
}
.lc-root *{box-sizing:border-box}
.lc-side{width:296px;flex:none;min-height:0;display:flex;flex-direction:column;border-right:.5px solid var(--lc-line);background:var(--lc-bg)}
.lc-sideHead{padding:14px 14px 8px;flex:none}
.lc-sideTop{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.lc-me{min-width:0;flex:1;display:flex;align-items:center;gap:8px}
.lc-meName{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-meSub{font-size:11px;color:var(--lc-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-iconBtn{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--lc-dim);border-radius:6px;cursor:pointer;padding:0}
.lc-iconBtn:hover{background:var(--lc-hover);color:var(--lc-fg)}
.lc-iconBtn:disabled{opacity:.4;cursor:default}
.lc-iconBtn:focus-visible{outline:2px solid var(--lc-accent);outline-offset:-2px}
.lc-tabs{display:flex;gap:2px;background:var(--lc-bubble);border-radius:8px;padding:2px}
.lc-tab{flex:1;border:none;background:transparent;color:var(--lc-dim);font:inherit;font-size:12px;padding:5px 6px;border-radius:6px;cursor:pointer;white-space:nowrap}
.lc-tab:hover{color:var(--lc-fg)}
.lc-tab.on{background:var(--lc-bg);color:var(--lc-fg);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.lc-search{position:relative;margin-top:8px}
.lc-search input{width:100%;height:30px;border:.5px solid var(--lc-line);background:transparent;color:inherit;font:inherit;font-size:12px;border-radius:7px;padding:0 8px 0 28px;outline:none}
.lc-search input:focus{border-color:var(--lc-accent)}
.lc-searchGlyph{position:absolute;left:8px;top:7px;color:var(--lc-faint);pointer-events:none;display:flex}
.lc-list{flex:1;min-height:0;overflow-y:auto;padding:4px 0 12px}
.lc-listEmpty{padding:28px 20px;text-align:center;color:var(--lc-faint);font-size:12px;line-height:1.7}
.lc-row{display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;border:none;background:transparent;color:inherit;font:inherit;text-align:left;width:100%}
.lc-row:hover{background:var(--lc-hover)}
.lc-row.on{background:var(--lc-accent-soft)}
.lc-row:focus-visible{outline:2px solid var(--lc-accent);outline-offset:-2px}
.lc-avatar{width:34px;height:34px;flex:none;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#fff;position:relative;letter-spacing:0}
.lc-avatar.sm{width:26px;height:26px;border-radius:7px;font-size:11px}
.lc-avatar.lg{width:42px;height:42px;border-radius:12px;font-size:15px}
.lc-dot{position:absolute;right:-2px;bottom:-2px;width:9px;height:9px;border-radius:50%;background:var(--lc-ok);border:2px solid var(--lc-bg)}
.lc-rowMain{flex:1;min-width:0}
.lc-rowTop{display:flex;align-items:baseline;gap:6px}
.lc-rowName{flex:1;min-width:0;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-rowTime{font-size:10px;color:var(--lc-faint);flex:none}
.lc-rowBottom{display:flex;align-items:center;gap:6px;margin-top:1px}
.lc-rowPreview{flex:1;min-width:0;font-size:11.5px;color:var(--lc-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-badge{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--lc-danger);color:#fff;font-size:10px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.lc-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.lc-chatHead{flex:none;height:54px;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:.5px solid var(--lc-line)}
.lc-chatTitle{min-width:0;flex:1}
.lc-chatName{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-chatSub{font-size:11px;color:var(--lc-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-thread{flex:1;min-height:0;overflow-y:auto;padding:16px 16px 8px;display:flex;flex-direction:column;gap:2px}
.lc-day{align-self:center;font-size:10.5px;color:var(--lc-faint);background:var(--lc-bubble);padding:2px 8px;border-radius:9px;margin:10px 0 8px}
.lc-sys{align-self:center;font-size:11px;color:var(--lc-faint);padding:3px 0;text-align:center;max-width:80%}
.lc-msg{display:flex;gap:8px;margin-top:8px;max-width:100%}
.lc-msg.self{flex-direction:row-reverse}
.lc-msgBody{min-width:0;max-width:min(560px,76%);display:flex;flex-direction:column;gap:2px}
.lc-msg.self .lc-msgBody{align-items:flex-end}
.lc-msgWho{font-size:10.5px;color:var(--lc-faint);padding:0 2px}
.lc-bubbleMsg{padding:7px 11px;border-radius:10px;background:var(--lc-bubble);white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.lc-msg.self .lc-bubbleMsg{background:var(--lc-accent);color:#fff}
.lc-msgMeta{font-size:10px;color:var(--lc-faint);padding:0 2px;display:flex;gap:6px;align-items:center}
.lc-fileCard{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:10px;background:var(--lc-bubble);text-decoration:none;color:inherit;max-width:100%;min-width:180px}
.lc-msg.self .lc-fileCard{background:var(--lc-accent);color:#fff}
.lc-fileCard:hover{filter:brightness(.97)}
.lc-fileIcon{width:30px;height:30px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;background:var(--lc-accent-soft);color:var(--lc-accent)}
.lc-msg.self .lc-fileIcon{background:rgba(255,255,255,.22);color:#fff}
.lc-fileInfo{min-width:0;flex:1}
.lc-fileName{font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-fileSize{font-size:10.5px;opacity:.72}
.lc-composer{flex:none;border-top:.5px solid var(--lc-line);padding:10px 12px 12px}
.lc-inputWrap{border:.5px solid var(--lc-line);border-radius:10px;padding:6px 8px;display:flex;flex-direction:column;gap:4px;transition:border-color .12s}
.lc-inputWrap:focus-within{border-color:var(--lc-accent)}
.lc-inputWrap textarea{width:100%;border:none;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1.6;resize:none;outline:none;max-height:132px;min-height:22px;padding:2px 2px 0}
.lc-inputBar{display:flex;align-items:center;gap:2px}
.lc-sendBtn{margin-left:auto;height:26px;padding:0 12px;border-radius:7px;border:none;background:var(--lc-accent);color:#fff;font:inherit;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.lc-sendBtn:disabled{opacity:.45;cursor:default}
.lc-hint{font-size:10.5px;color:var(--lc-faint);padding:4px 2px 0;display:flex;justify-content:space-between;gap:8px}
.lc-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--lc-faint);padding:32px;text-align:center}
.lc-emptyIcon{width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:var(--lc-bubble);color:var(--lc-dim)}
.lc-emptyTitle{font-size:14px;font-weight:600;color:var(--lc-dim)}
.lc-emptyText{font-size:12px;max-width:340px;line-height:1.7}
.lc-banner{flex:none;margin:8px 12px 0;padding:7px 10px;border-radius:8px;background:rgba(229,72,77,.1);color:var(--lc-danger);font-size:11.5px;display:flex;gap:6px;align-items:flex-start}
.lc-section{padding:12px 14px 6px;font-size:11px;font-weight:600;color:var(--lc-faint);text-transform:none;letter-spacing:.02em;display:flex;align-items:center;justify-content:space-between}
.lc-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.lc-field label{font-size:11.5px;color:var(--lc-dim)}
.lc-field input{height:30px;border:.5px solid var(--lc-line);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12.5px;padding:0 9px;outline:none}
.lc-field input:focus{border-color:var(--lc-accent)}
.lc-fieldHint{font-size:10.5px;color:var(--lc-faint)}
.lc-btn{height:28px;padding:0 12px;border-radius:7px;border:.5px solid var(--lc-line);background:transparent;color:var(--lc-fg);font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.lc-btn:hover{background:var(--lc-hover)}
.lc-btn:disabled{opacity:.45;cursor:default}
.lc-btn.primary{background:var(--lc-accent);border-color:transparent;color:#fff;font-weight:600}
.lc-btn.primary:hover{filter:brightness(1.06)}
.lc-btn.danger{color:var(--lc-danger);border-color:rgba(229,72,77,.35)}
.lc-btn.sm{height:24px;padding:0 9px;font-size:11.5px}
.lc-overlay{position:absolute;inset:0;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center;z-index:40;padding:24px}
.lc-modal{width:min(440px,100%);max-height:100%;display:flex;flex-direction:column;background:var(--lc-bg);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.24);overflow:hidden}
.lc-modalHead{flex:none;display:flex;align-items:center;gap:8px;padding:13px 16px;border-bottom:.5px solid var(--lc-line);font-size:13px;font-weight:600}
.lc-modalBody{flex:1;min-height:0;overflow-y:auto;padding:14px 16px}
.lc-modalFoot{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:11px 16px;border-top:.5px solid var(--lc-line)}
.lc-checkList{display:flex;flex-direction:column;gap:1px;max-height:230px;overflow-y:auto;border:.5px solid var(--lc-line);border-radius:8px;padding:4px}
.lc-checkRow{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:6px;cursor:pointer}
.lc-checkRow:hover{background:var(--lc-hover)}
.lc-checkRow input{accent-color:var(--lc-accent);flex:none}
.lc-checkName{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-progress{height:4px;border-radius:2px;background:var(--lc-bubble);overflow:hidden;margin:8px 0}
.lc-progressFill{height:100%;background:var(--lc-accent);transition:width .2s}
.lc-peerRow{display:flex;align-items:center;gap:9px;padding:8px 14px}
.lc-peerInfo{flex:1;min-width:0}
.lc-peerName{font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-peerAddr{font-size:10.5px;color:var(--lc-faint);font-family:var(--ds-font-family-code,ui-monospace,monospace)}
.lc-inlineRow{display:flex;gap:6px;align-items:center}
.lc-inlineRow input{flex:1;min-width:0;height:28px;border:.5px solid var(--lc-line);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;padding:0 8px;outline:none}
.lc-inlineRow input:focus{border-color:var(--lc-accent)}
.lc-kv{display:flex;gap:8px;font-size:11.5px;padding:3px 0}
.lc-kvKey{width:88px;flex:none;color:var(--lc-faint)}
.lc-kvVal{flex:1;min-width:0;word-break:break-all;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px}
.lc-scrollThin::-webkit-scrollbar{width:8px;height:8px}
.lc-scrollThin::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18));border-radius:4px}
.lc-scrollThin::-webkit-scrollbar-track{background:transparent}
@media (max-width:720px){
	.lc-side{width:220px}
	.lc-msgBody{max-width:84%}
}
`;

		function ensureStyle() {
			if (typeof document === "undefined") return;
			if (typeof document.getElementById !== "function") return;
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			(document.head ?? document.documentElement)?.appendChild?.(style);
		}

		// ------------------------------------------------------------------
		// 小工具
		// ------------------------------------------------------------------

		/** 会话内稳定的头像底色。 */
		const AVATAR_COLORS = ["#4d6bfe", "#0d9488", "#c2410c", "#7c3aed", "#b91c1c", "#0369a1", "#4d7c0f", "#a16207", "#be185d", "#475569"];
		function colorOf(seed) {
			const text = String(seed ?? "");
			let hash = 0;
			for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
			return AVATAR_COLORS[hash % AVATAR_COLORS.length];
		}
		function initialOf(name, isGroup) {
			const text = String(name ?? "").trim();
			if (text === "") return "?";
			if (isGroup) return "群";
			const first = Array.from(text)[0] ?? "?";
			return first.toUpperCase();
		}
		function sizeText(bytes) {
			const value = Number(bytes) || 0;
			if (value < 1024) return `${value} B`;
			if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
			if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
			return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
		}
		function clockText(ts) {
			const date = new Date(Number(ts) || Date.now());
			const hh = String(date.getHours()).padStart(2, "0");
			const mm = String(date.getMinutes()).padStart(2, "0");
			return `${hh}:${mm}`;
		}
		function dayText(ts) {
			const date = new Date(Number(ts) || Date.now());
			const now = new Date();
			const startOf = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
			const days = Math.round((startOf(now) - startOf(date)) / 86400000);
			if (days === 0) return "今天";
			if (days === 1) return "昨天";
			if (days > 1 && days < 7) return `${days} 天前`;
			return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		}
		function relText(ts) {
			if (!ts) return "";
			const diff = Date.now() - Number(ts);
			if (diff < 60000) return "刚刚";
			if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
			if (diff < 86400000) return clockText(ts);
			if (diff < 7 * 86400000) return dayText(ts);
			const date = new Date(Number(ts));
			return `${date.getMonth() + 1}/${date.getDate()}`;
		}
		function sameDay(a, b) {
			const left = new Date(Number(a));
			const right = new Date(Number(b));
			return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
		}

		// ------------------------------------------------------------------
		// HTTP
		// ------------------------------------------------------------------

		class ApiError extends Error {}

		async function callApi(path, options) {
			const config = options ?? {};
			const init = { method: config.method ?? "GET", credentials: "same-origin", headers: {} };
			if (config.body !== undefined) {
				init.headers["content-type"] = "application/json";
				init.body = JSON.stringify(config.body);
			}
			if (config.raw !== undefined) {
				init.headers["content-type"] = "application/octet-stream";
				init.body = config.raw;
			}
			let response;
			try {
				response = await fetch(`${API}${path}`, init);
			} catch (error) {
				throw new ApiError(`无法连接宿主：${error instanceof Error ? error.message : String(error)}`);
			}
			let payload = null;
			try {
				payload = await response.json();
			} catch (error) {
				/* 非 JSON 响应 */
			}
			if (!response.ok || payload === null || payload.ok === false) {
				const message = (payload && typeof payload === "object" && typeof payload.error === "string" && payload.error) || `HTTP ${response.status}`;
				throw new ApiError(message);
			}
			return payload;
		}

		// ------------------------------------------------------------------
		// 组件
		// ------------------------------------------------------------------

		function Avatar(props) {
			const size = props.size === "sm" ? " lc-avatar sm" : props.size === "lg" ? " lc-avatar lg" : " lc-avatar";
			return h(
				"div",
				{ className: `lc-avatar${size === " lc-avatar" ? "" : size}`, style: { background: colorOf(props.seed ?? props.name) } },
				initialOf(props.name, props.group === true),
				props.online === true ? h("span", { className: "lc-dot" }) : null,
			);
		}

		function IconButton(props) {
			return h(
				"button",
				{
					type: "button",
					className: "lc-iconBtn",
					onClick: props.onClick,
					disabled: props.disabled === true,
					title: props.title,
					"aria-label": props.title ?? props.label,
				},
				props.children,
			);
		}

		/** 会话行。 */
		function ConversationRow(props) {
			const item = props.item;
			const isGroup = item.kind === "group";
			return h(
				"button",
				{ type: "button", className: `lc-row${props.active ? " on" : ""}`, onClick: () => props.onSelect(item.convId) },
				h(Avatar, { name: item.title, seed: item.convId, group: isGroup, online: isGroup ? false : item.online }),
				h(
					"div",
					{ className: "lc-rowMain" },
					h(
						"div",
						{ className: "lc-rowTop" },
						h("span", { className: "lc-rowName" }, item.title),
						h("span", { className: "lc-rowTime" }, relText(item.lastTs)),
					),
					h(
						"div",
						{ className: "lc-rowBottom" },
						h("span", { className: "lc-rowPreview" }, item.lastText || (isGroup ? "群聊已创建" : "还没有消息")),
						item.unread > 0 ? h("span", { className: "lc-badge" }, item.unread > 99 ? "99+" : String(item.unread)) : null,
					),
				),
			);
		}

		/** 联系人行。 */
		function ContactRow(props) {
			const contact = props.contact;
			return h(
				"div",
				{ className: "lc-peerRow" },
				h(Avatar, { name: contact.nickname, seed: contact.peerId, online: contact.online }),
				h(
					"div",
					{ className: "lc-peerInfo" },
					h("div", { className: "lc-peerName" }, contact.nickname || contact.peerId),
					h("div", { className: "lc-peerAddr" }, (contact.addrs && contact.addrs[0]) || "地址未知"),
				),
				h(
					"button",
					{ type: "button", className: "lc-btn sm", onClick: () => props.onOpen(contact) },
					"聊天",
				),
				h(IconButton, { title: "删除联系人", onClick: () => props.onRemove(contact) }, h(IconTrash, { size: 14 })),
			);
		}

		/** 发现到的节点行。 */
		function DiscoveredRow(props) {
			const peer = props.peer;
			return h(
				"div",
				{ className: "lc-peerRow" },
				h(Avatar, { name: peer.nickname, seed: peer.peerId, online: true }),
				h(
					"div",
					{ className: "lc-peerInfo" },
					h("div", { className: "lc-peerName" }, peer.nickname || peer.peerId),
					h("div", { className: "lc-peerAddr" }, `${peer.address}:${peer.port}`),
				),
				peer.added
					? h("span", { className: "lc-btn sm", style: { cursor: "default", opacity: 0.6 } }, "已添加")
					: h("button", { type: "button", className: "lc-btn sm primary", onClick: () => props.onAdd(peer) }, "添加"),
			);
		}

		/** 一条消息。 */
		function MessageRow(props) {
			const message = props.message;
			const self = message.from === props.selfPeerId;
			if (message.kind === "system") {
				return h("div", { className: "lc-sys" }, message.text);
			}
			const isFile = message.kind === "file" && message.file;
			return h(
				"div",
				{ className: `lc-msg${self ? " self" : ""}` },
				h(Avatar, { name: message.fromName || message.from, seed: message.from, size: "sm" }),
				h(
					"div",
					{ className: "lc-msgBody" },
					self ? null : h("div", { className: "lc-msgWho" }, message.fromName || message.from),
					isFile
						? h(
								"a",
								{
									className: "lc-fileCard",
									href: `${API}/file?id=${encodeURIComponent(message.file.id)}`,
									download: message.file.name,
									title: `下载 ${message.file.name}`,
								},
								h("span", { className: "lc-fileIcon" }, h(IconDownload, { size: 15 })),
								h(
									"span",
									{ className: "lc-fileInfo" },
									h("span", { className: "lc-fileName" }, message.file.name),
									h("span", { className: "lc-fileSize" }, sizeText(message.file.size)),
								),
							)
						: h("div", { className: "lc-bubbleMsg" }, message.text),
					h("div", { className: "lc-msgMeta" }, clockText(message.ts), self ? h(IconCheck, { size: 11 }) : null),
				),
			);
		}

		/** 模态框外壳。 */
		function Modal(props) {
			return h(
				"div",
				{ className: "lc-overlay", onClick: props.onClose, role: "presentation" },
				h(
					"div",
					{
						className: "lc-modal",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": props.title,
						onClick: (event) => event.stopPropagation(),
					},
					h(
						"div",
						{ className: "lc-modalHead" },
						h("span", { style: { flex: 1 } }, props.title),
						h(IconButton, { title: "关闭", onClick: props.onClose }, h(IconClose, { size: 14 })),
					),
					h("div", { className: "lc-modalBody" }, props.children),
					props.footer === undefined ? null : h("div", { className: "lc-modalFoot" }, props.footer),
				),
			);
		}

		// ------------------------------------------------------------------
		// 主面板
		// ------------------------------------------------------------------

		function MainPanel() {
			ensureStyle();

			const [tab, setTab] = React.useState("chats");
			const [state, setState] = React.useState(null);
			const [loadError, setLoadError] = React.useState(null);
			const [conversations, setConversations] = React.useState([]);
			const [contacts, setContacts] = React.useState([]);
			const [discovered, setDiscovered] = React.useState([]);
			const [subnets, setSubnets] = React.useState([]);
			const [activeConv, setActiveConv] = React.useState(null);
			const [messages, setMessages] = React.useState([]);
			const [draft, setDraft] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState(null);
			const [query, setQuery] = React.useState("");
			const [scan, setScan] = React.useState(null);
			const [showSettings, setShowSettings] = React.useState(false);
			const [showCreateGroup, setShowCreateGroup] = React.useState(false);
			const [groupName, setGroupName] = React.useState("");
			const [groupMembers, setGroupMembers] = React.useState([]);
			const [probeAddr, setProbeAddr] = React.useState("");
			const [scanCidr, setScanCidr] = React.useState("");
			const [settingsDraft, setSettingsDraft] = React.useState({ nickname: "", accessCode: "" });

			const threadRef = React.useRef(null);
			const fileRef = React.useRef(null);
			const activeRef = React.useRef(null);
			activeRef.current = activeConv;

			/** 统一错误提示。 */
			const fail = React.useCallback((error) => {
				const text = error instanceof Error ? error.message : String(error);
				setNotice({ kind: "error", text });
				setTimeout(() => setNotice(null), 6000);
			}, []);

			// ---- 数据加载 ----

			const loadState = React.useCallback(async () => {
				try {
					const payload = await callApi("/state");
					setState(payload);
					setLoadError(null);
					return payload;
				} catch (error) {
					setLoadError(error instanceof Error ? error.message : String(error));
					return null;
				}
			}, []);

			const loadConversations = React.useCallback(async () => {
				try {
					const payload = await callApi("/conversations");
					setConversations(payload.conversations ?? []);
				} catch (error) {
					/* 会话列表加载失败不打断界面 */
				}
			}, []);

			const loadContacts = React.useCallback(async () => {
				try {
					const payload = await callApi("/contacts");
					setContacts(payload.contacts ?? []);
				} catch (error) {
					/* ignore */
				}
			}, []);

			const loadDiscovered = React.useCallback(async () => {
				try {
					const payload = await callApi("/discover");
					setDiscovered(payload.peers ?? []);
					setSubnets(payload.subnets ?? []);
					setScanCidr((current) => (current === "" ? (payload.subnets ?? [])[0] ?? "" : current));
				} catch (error) {
					/* ignore */
				}
			}, []);

			const loadMessages = React.useCallback(async (convId) => {
				if (!convId) return;
				try {
					const payload = await callApi(`/messages?convId=${encodeURIComponent(convId)}&limit=300`);
					setMessages(payload.messages ?? []);
				} catch (error) {
					fail(error);
				}
			}, [fail]);

			const refreshAll = React.useCallback(async () => {
				await Promise.all([loadState(), loadConversations(), loadContacts()]);
			}, [loadState, loadConversations, loadContacts]);

			// 首次加载
			React.useEffect(() => {
				let cancelled = false;
				(async () => {
					const payload = await loadState();
					if (cancelled) return;
					if (payload?.settings) {
						setSettingsDraft({ nickname: payload.settings.nickname ?? "", accessCode: payload.settings.accessCode ?? "" });
					}
					await Promise.all([loadConversations(), loadContacts(), loadDiscovered()]);
				})();
				return () => {
					cancelled = true;
				};
			}, [loadState, loadConversations, loadContacts, loadDiscovered]);

			// 打开会话
			const openConversation = React.useCallback(
				async (convId) => {
					setActiveConv(convId);
					setTab("chats");
					await loadMessages(convId);
					try {
						await callApi("/read", { method: "POST", body: { convId, ts: Date.now() } });
					} catch (error) {
						/* ignore */
					}
					setConversations((rows) => rows.map((row) => (row.convId === convId ? { ...row, unread: 0 } : row)));
				},
				[loadMessages],
			);

			// 实时事件（SSE）
			React.useEffect(() => {
				if (typeof EventSource !== "function") return undefined;
				let source = null;
				let retry = null;
				let closed = false;
				let pollTimer = null;

				const start = () => {
					if (closed) return;
					try {
						source = new EventSource(`${API}/events`);
					} catch (error) {
						scheduleRetry();
						return;
					}
					source.addEventListener("message", (event) => {
						let payload = null;
						try {
							payload = JSON.parse(event.data);
						} catch (error) {
							return;
						}
						if (payload === null || typeof payload !== "object") return;
						const convId = payload.convId;
						if (convId === activeRef.current) {
							setMessages((rows) => (rows.some((row) => row.id === payload.id) ? rows : [...rows, payload]));
							callApi("/read", { method: "POST", body: { convId, ts: Date.now() } }).catch(() => {});
						}
						loadConversations();
					});
					source.addEventListener("presence", () => {
						loadContacts();
						loadConversations();
					});
					source.addEventListener("discovered", () => {
						loadDiscovered();
					});
					source.addEventListener("error", () => {
						// EventSource 自带重连；这里只兜底轮询
						if (source !== null) {
							try {
								source.close();
							} catch (error) {
								/* ignore */
							}
							source = null;
						}
						scheduleRetry();
					});
				};

				const scheduleRetry = () => {
					if (closed) return;
					if (retry !== null) return;
					retry = setTimeout(() => {
						retry = null;
						start();
					}, 3000);
				};

				start();
				// 低频兜底轮询：SSE 断线时也能看到新消息
				pollTimer = setInterval(() => {
					if (source !== null) return;
					loadConversations();
					if (activeRef.current) loadMessages(activeRef.current);
				}, 8000);

				return () => {
					closed = true;
					if (retry !== null) clearTimeout(retry);
					if (pollTimer !== null) clearInterval(pollTimer);
					if (source !== null) {
						try {
							source.close();
						} catch (error) {
							/* ignore */
						}
					}
				};
			}, [loadConversations, loadContacts, loadDiscovered, loadMessages]);

			// 滚动到底
			React.useEffect(() => {
				const node = threadRef.current;
				if (node === null) return;
				node.scrollTop = node.scrollHeight;
			}, [messages, activeConv]);

			// ---- 动作 ----

			const send = async () => {
				const text = draft.trim();
				if (text === "" || activeConv === null || busy) return;
				setBusy(true);
				try {
					const payload = await callApi("/send", { method: "POST", body: { convId: activeConv, text } });
					setDraft("");
					if (payload.message) {
						setMessages((rows) => (rows.some((row) => row.id === payload.message.id) ? rows : [...rows, payload.message]));
					}
					loadConversations();
				} catch (error) {
					fail(error);
				} finally {
					setBusy(false);
				}
			};

			const upload = async (file) => {
				if (activeConv === null || file === undefined) return;
				setBusy(true);
				try {
					const buffer = await file.arrayBuffer();
					const query = `convId=${encodeURIComponent(activeConv)}&name=${encodeURIComponent(file.name)}&mime=${encodeURIComponent(file.type || "application/octet-stream")}`;
					const payload = await callApi(`/upload?${query}`, { method: "POST", raw: buffer });
					if (payload.message) {
						setMessages((rows) => (rows.some((row) => row.id === payload.message.id) ? rows : [...rows, payload.message]));
					}
					loadConversations();
				} catch (error) {
					fail(error);
				} finally {
					setBusy(false);
					if (fileRef.current !== null) fileRef.current.value = "";
				}
			};

			const startScan = async () => {
				if (scan !== null && scan.running) return;
				try {
					const payload = await callApi("/scan", { method: "POST", body: { cidr: scanCidr.trim() } });
					setScan({ scanId: payload.scanId, total: payload.total, done: 0, running: true });
					setDiscovered((rows) => rows);
				} catch (error) {
					fail(error);
				}
			};

			// 扫描轮询
			React.useEffect(() => {
				if (scan === null || !scan.running) return undefined;
				let cancelled = false;
				const timer = setInterval(async () => {
					try {
						const payload = await callApi(`/scan/status?scanId=${encodeURIComponent(scan.scanId)}`);
						if (cancelled) return;
						setScan({ scanId: scan.scanId, total: payload.total, done: payload.done, running: payload.finished !== true });
						if (payload.finished) {
							loadDiscovered();
						}
					} catch (error) {
						if (!cancelled) setScan({ ...scan, running: false });
					}
				}, 700);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [scan, loadDiscovered]);

			const addPeer = async (peer) => {
				try {
					await callApi("/contacts/add", {
						method: "POST",
						body: { peerId: peer.peerId, nickname: peer.nickname, addrs: [peer.address], port: peer.port },
					});
					await Promise.all([loadContacts(), loadDiscovered(), loadConversations()]);
					setNotice({ kind: "ok", text: `已添加 ${peer.nickname || peer.peerId}` });
					setTimeout(() => setNotice(null), 3000);
				} catch (error) {
					fail(error);
				}
			};

			const probe = async () => {
				const address = probeAddr.trim();
				if (address === "") return;
				try {
					const payload = await callApi("/probe", { method: "POST", body: { address } });
					await loadDiscovered();
					setProbeAddr("");
					setNotice({ kind: "ok", text: `发现 ${payload.peer.nickname || payload.peer.peerId}（${address}）` });
					setTimeout(() => setNotice(null), 3000);
				} catch (error) {
					fail(error);
				}
			};

			const removeContact = async (contact) => {
				try {
					await callApi("/contacts/remove", { method: "POST", body: { peerId: contact.peerId } });
					await Promise.all([loadContacts(), loadConversations()]);
				} catch (error) {
					fail(error);
				}
			};

			const openWithContact = async (contact) => {
				const convId = dmConvId(state?.self?.peerId, contact.peerId);
				await openConversation(convId);
			};

			const createGroup = async () => {
				const name = groupName.trim();
				if (name === "") return;
				try {
					const payload = await callApi("/groups/create", { method: "POST", body: { name, members: groupMembers } });
					setShowCreateGroup(false);
					setGroupName("");
					setGroupMembers([]);
					await loadConversations();
					await openConversation(payload.convId);
				} catch (error) {
					fail(error);
				}
			};

			const saveSettings = async () => {
				try {
					const payload = await callApi("/settings", {
						method: "POST",
						body: { nickname: settingsDraft.nickname, accessCode: settingsDraft.accessCode },
					});
					setState((current) => (current === null ? current : { ...current, settings: payload.settings, self: { ...current.self, nickname: payload.settings.nickname } }));
					setShowSettings(false);
					await loadConversations();
				} catch (error) {
					fail(error);
				}
			};

			// ---- 派生数据 ----

			const selfPeerId = state?.self?.peerId ?? "";
			const activeItem = conversations.find((row) => row.convId === activeConv) ?? null;
			const lowerQuery = query.trim().toLowerCase();
			const filteredConversations = lowerQuery === ""
				? conversations
				: conversations.filter((row) => String(row.title ?? "").toLowerCase().includes(lowerQuery) || String(row.lastText ?? "").toLowerCase().includes(lowerQuery));
			const addedContacts = contacts.filter((row) => row.added === true);
			const filteredContacts = lowerQuery === "" ? addedContacts : addedContacts.filter((row) => String(row.nickname ?? "").toLowerCase().includes(lowerQuery) || String(row.peerId ?? "").toLowerCase().includes(lowerQuery));
			const onlineCount = addedContacts.filter((row) => row.online).length;

			// ---- 渲染 ----

			const sidebar = h(
				"div",
				{ className: "lc-side" },
				h(
					"div",
					{ className: "lc-sideHead" },
					h(
						"div",
						{ className: "lc-sideTop" },
						h(
							"div",
							{ className: "lc-me" },
							h(Avatar, { name: state?.self?.nickname ?? "我", seed: selfPeerId || "me", size: "sm" }),
							h(
								"div",
								{ style: { minWidth: 0 } },
								h("div", { className: "lc-meName" }, state?.self?.nickname ?? "正在加载…"),
								h(
									"div",
									{ className: "lc-meSub" },
									state === null
										? ""
										: state.listening
											? `在线 · 端口 ${state.self.port}`
											: "未监听（仅本机可见）",
								),
							),
						),
						h(IconButton, { title: "新建群聊", onClick: () => setShowCreateGroup(true) }, h(IconPlus, { size: 15 })),
						h(IconButton, { title: "刷新", onClick: () => refreshAll() }, h(IconRefresh, { size: 14 })),
						h(IconButton, { title: "设置", onClick: () => setShowSettings(true) }, h(IconSliders, { size: 15 })),
					),
					h(
						"div",
						{ className: "lc-tabs", role: "tablist" },
						[
							["chats", `会话${conversations.length > 0 ? ` ${conversations.length}` : ""}`],
							["contacts", `联系人${addedContacts.length > 0 ? ` ${onlineCount}/${addedContacts.length}` : ""}`],
							["discover", "发现"],
						].map(([key, label]) =>
							h(
								"button",
								{
									key,
									type: "button",
									role: "tab",
									"aria-selected": tab === key,
									className: `lc-tab${tab === key ? " on" : ""}`,
									onClick: () => {
										setTab(key);
										if (key === "discover") loadDiscovered();
										if (key === "contacts") loadContacts();
									},
								},
								label,
							),
						),
					),
					tab === "discover"
						? null
						: h(
								"div",
								{ className: "lc-search" },
								h("span", { className: "lc-searchGlyph" }, h(IconSearch, { size: 13 })),
								h("input", {
									value: query,
									onChange: (event) => setQuery(event.target.value),
									placeholder: tab === "chats" ? "搜索会话" : "搜索联系人",
									"aria-label": tab === "chats" ? "搜索会话" : "搜索联系人",
								}),
							),
				),
				h(
					"div",
					{ className: "lc-list lc-scrollThin" },
					tab === "chats"
						? filteredConversations.length === 0
							? h(
									"div",
									{ className: "lc-listEmpty" },
									conversations.length === 0 ? "还没有会话。\n去「发现」扫描网段，添加同事后即可开始聊天。" : "没有匹配的会话",
								)
							: filteredConversations.map((item) =>
									h(ConversationRow, {
										key: item.convId,
										item,
										active: item.convId === activeConv,
										onSelect: openConversation,
									}),
								)
						: tab === "contacts"
							? filteredContacts.length === 0
								? h("div", { className: "lc-listEmpty" }, "还没有联系人。\n去「发现」扫描网段添加。")
								: filteredContacts.map((contact) =>
										h(ContactRow, { key: contact.peerId, contact, onOpen: openWithContact, onRemove: removeContact }),
									)
							: renderDiscover(),
				),
			);

			function renderDiscover() {
				const running = scan !== null && scan.running;
				const percent = scan === null || scan.total === 0 ? 0 : Math.round((scan.done / scan.total) * 100);
				return h(
					"div",
					null,
					h(
						"div",
						{ className: "lc-section" },
						h("span", null, "扫描网段"),
					),
					h(
						"div",
						{ style: { padding: "0 14px 10px" } },
						h(
							"div",
							{ className: "lc-inlineRow" },
							h("input", {
								value: scanCidr,
								onChange: (event) => setScanCidr(event.target.value),
								placeholder: "192.168.1.0/24",
								"aria-label": "扫描网段",
								onKeyDown: (event) => {
									if (event.key === "Enter") startScan();
								},
							}),
							h(
								"button",
								{ type: "button", className: "lc-btn primary sm", onClick: startScan, disabled: running },
								running ? `${percent}%` : "扫描",
							),
						),
						scan === null
							? null
							: h(
									"div",
									null,
									h("div", { className: "lc-progress" }, h("div", { className: "lc-progressFill", style: { width: `${percent}%` } })),
									h("div", { className: "lc-fieldHint" }, running ? `正在扫描 ${scan.done}/${scan.total}…` : `扫描完成，共探测 ${scan.total} 个地址`),
								),
						subnets.length > 0
							? h(
									"div",
									{ style: { display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 } },
									subnets.map((cidr) =>
										h(
											"button",
											{
												key: cidr,
												type: "button",
												className: "lc-btn sm",
												onClick: () => setScanCidr(cidr),
												title: `使用本机网段 ${cidr}`,
											},
											cidr,
										),
									),
								)
							: null,
					),
					h("div", { className: "lc-section" }, h("span", null, "手动探测")),
					h(
						"div",
						{ style: { padding: "0 14px 12px" } },
						h(
							"div",
							{ className: "lc-inlineRow" },
							h("input", {
								value: probeAddr,
								onChange: (event) => setProbeAddr(event.target.value),
								placeholder: "10.0.0.23",
								"aria-label": "对方 IP 地址",
								onKeyDown: (event) => {
									if (event.key === "Enter") probe();
								},
							}),
							h("button", { type: "button", className: "lc-btn sm", onClick: probe }, "探测"),
						),
					),
					h(
						"div",
						{ className: "lc-section" },
						h("span", null, `发现的节点${discovered.length > 0 ? ` ${discovered.length}` : ""}`),
					),
					discovered.length === 0
						? h("div", { className: "lc-listEmpty" }, "还没有发现其他节点。\n确认对方也启用了局域网聊天助手，且在同一网段。")
						: discovered.map((peer) => h(DiscoveredRow, { key: peer.peerId, peer, onAdd: addPeer })),
				);
			}

			const thread = h(
				"div",
				{ className: "lc-main" },
				state !== null && state.listening === false
					? h(
							"div",
							{ className: "lc-banner" },
							h("span", null, `局域网端口未能监听：${state.startError ?? "端口被占用"}。当前只能看到本机数据。`),
						)
					: null,
				activeItem === null
					? h(
							"div",
							{ className: "lc-empty" },
							h("div", { className: "lc-emptyIcon" }, h(IconChat, { size: 26 })),
							h("div", { className: "lc-emptyTitle" }, "局域网聊天助手"),
							h(
								"div",
								{ className: "lc-emptyText" },
								"完全离线的内网通讯工具。选择一个会话开始聊天，或到「发现」扫描网段找到同事。",
							),
						)
					: h(
							React.Fragment,
							null,
							h(
								"div",
								{ className: "lc-chatHead" },
								h(Avatar, {
									name: activeItem.title,
									seed: activeItem.convId,
									group: activeItem.kind === "group",
									online: activeItem.kind === "group" ? false : activeItem.online,
									size: "sm",
								}),
								h(
									"div",
									{ className: "lc-chatTitle" },
									h("div", { className: "lc-chatName" }, activeItem.title),
									h(
										"div",
										{ className: "lc-chatSub" },
										activeItem.kind === "group"
											? `${(activeItem.members ?? []).length} 位成员`
											: activeItem.online
												? "在线"
												: "离线",
									),
								),
								h(IconButton, { title: "刷新消息", onClick: () => loadMessages(activeConv) }, h(IconRefresh, { size: 14 })),
							),
							h(
								"div",
								{ className: "lc-thread lc-scrollThin", ref: threadRef },
								messages.length === 0
									? h("div", { className: "lc-listEmpty" }, "还没有消息，发第一条吧。")
									: messages.map((message, index) => {
											const prev = index === 0 ? null : messages[index - 1];
											const showDay = prev === null || !sameDay(prev.ts, message.ts);
											return h(
												React.Fragment,
												{ key: message.id },
												showDay ? h("div", { className: "lc-day" }, dayText(message.ts)) : null,
												h(MessageRow, { message, selfPeerId }),
											);
										}),
							),
							h(
								"div",
								{ className: "lc-composer" },
								notice === null
									? null
									: h(
											"div",
											{
												className: "lc-banner",
												style:
													notice.kind === "ok"
														? { margin: "0 0 8px", background: "rgba(46,160,67,.1)", color: "var(--lc-ok)" }
														: { margin: "0 0 8px" },
											},
											h("span", null, notice.text),
										),
								h(
									"div",
									{ className: "lc-inputWrap" },
									h("textarea", {
										value: draft,
										rows: 1,
										placeholder: `发消息给 ${activeItem.title}…`,
										"aria-label": "消息内容",
										onChange: (event) => {
											setDraft(event.target.value);
											const node = event.target;
											node.style.height = "auto";
											node.style.height = `${Math.min(node.scrollHeight, 132)}px`;
										},
										onKeyDown: (event) => {
											if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
												event.preventDefault();
												send();
											}
										},
									}),
									h(
										"div",
										{ className: "lc-inputBar" },
										h(IconButton, { title: "发送文件", onClick: () => fileRef.current?.click(), disabled: busy }, h(IconClip, { size: 15 })),
										h("input", {
											ref: fileRef,
											type: "file",
											style: { display: "none" },
											onChange: (event) => {
												const file = event.target.files?.[0];
												if (file !== undefined) upload(file);
											},
										}),
										h(
											"button",
											{ type: "button", className: "lc-sendBtn", onClick: send, disabled: busy || draft.trim() === "" },
											busy ? "发送中…" : "发送",
											h(IconSend, { size: 13 }),
										),
									),
								),
								h("div", { className: "lc-hint" }, h("span", null, "Enter 发送 · Shift+Enter 换行"), h("span", null, "文件上限 512MB")),
							),
						),
			);

			return h(
				"div",
				{ className: "lc-root", style: { position: "relative" } },
				loadError !== null
					? h(
							"div",
							{ className: "lc-banner", style: { position: "absolute", left: 0, right: 0, top: 0, zIndex: 30, margin: "8px 12px" } },
							h("span", null, `宿主未就绪：${loadError}`),
						)
					: null,
				sidebar,
				thread,
				showSettings
					? h(
							Modal,
							{
								title: "局域网聊天设置",
								onClose: () => setShowSettings(false),
								footer: [
									h("button", { key: "c", type: "button", className: "lc-btn", onClick: () => setShowSettings(false) }, "取消"),
									h("button", { key: "s", type: "button", className: "lc-btn primary", onClick: saveSettings }, "保存"),
								],
							},
							h(
								"div",
								{ className: "lc-field" },
								h("label", { htmlFor: "lc-nick" }, "昵称"),
								h("input", {
									id: "lc-nick",
									value: settingsDraft.nickname,
									onChange: (event) => setSettingsDraft((current) => ({ ...current, nickname: event.target.value })),
									placeholder: "别人看到的名字",
								}),
							),
							h(
								"div",
								{ className: "lc-field" },
								h("label", { htmlFor: "lc-code" }, "访问码（可选）"),
								h("input", {
									id: "lc-code",
									value: settingsDraft.accessCode,
									onChange: (event) => setSettingsDraft((current) => ({ ...current, accessCode: event.target.value })),
									placeholder: "留空表示同一网段内无需验证",
								}),
								h("div", { className: "lc-fieldHint" }, "设置后，对方必须填入相同访问码才能与你通信。"),
							),
							h(
								"div",
								{ style: { marginTop: 14, borderTop: "0.5px solid var(--lc-line)", paddingTop: 10 } },
								h("div", { className: "lc-kv" }, h("span", { className: "lc-kvKey" }, "我的 ID"), h("span", { className: "lc-kvVal" }, selfPeerId || "—")),
								h("div", { className: "lc-kv" }, h("span", { className: "lc-kvKey" }, "监听端口"), h("span", { className: "lc-kvVal" }, String(state?.self?.port ?? "—"))),
								h(
									"div",
									{ className: "lc-kv" },
									h("span", { className: "lc-kvKey" }, "本机地址"),
									h("span", { className: "lc-kvVal" }, (state?.self?.addresses ?? []).join("、") || "—"),
								),
								h(
									"div",
									{ className: "lc-kv" },
									h("span", { className: "lc-kvKey" }, "本机网段"),
									h("span", { className: "lc-kvVal" }, (state?.self?.subnets ?? []).join("、") || "—"),
								),
							),
						)
					: null,
				showCreateGroup
					? h(
							Modal,
							{
								title: "新建群聊",
								onClose: () => setShowCreateGroup(false),
								footer: [
									h("button", { key: "c", type: "button", className: "lc-btn", onClick: () => setShowCreateGroup(false) }, "取消"),
									h(
										"button",
										{ key: "s", type: "button", className: "lc-btn primary", onClick: createGroup, disabled: groupName.trim() === "" },
										"创建",
									),
								],
							},
							h(
								"div",
								{ className: "lc-field" },
								h("label", { htmlFor: "lc-gname" }, "群名称"),
								h("input", {
									id: "lc-gname",
									value: groupName,
									onChange: (event) => setGroupName(event.target.value),
									placeholder: "例如：值班小组",
								}),
							),
							h(
								"div",
								{ className: "lc-field" },
								h("label", null, "选择成员"),
								addedContacts.length === 0
									? h("div", { className: "lc-fieldHint" }, "还没有联系人。先到「发现」里扫描并添加同事。")
									: h(
											"div",
											{ className: "lc-checkList lc-scrollThin" },
											addedContacts.map((contact) =>
												h(
													"label",
													{ key: contact.peerId, className: "lc-checkRow" },
													h("input", {
														type: "checkbox",
														checked: groupMembers.includes(contact.peerId),
														onChange: (event) => {
															setGroupMembers((current) =>
																event.target.checked ? [...new Set([...current, contact.peerId])] : current.filter((id) => id !== contact.peerId),
															);
														},
													}),
													h(Avatar, { name: contact.nickname, seed: contact.peerId, size: "sm", online: contact.online }),
													h("span", { className: "lc-checkName" }, contact.nickname || contact.peerId),
												),
											),
										),
							),
						)
					: null,
			);
		}

		/** 两个 peerId 的 DM 会话 id（与宿主 store.dmConvId 保持一致）。 */
		function dmConvId(a, b) {
			const left = String(a ?? "");
			const right = String(b ?? "");
			if (left === "" || right === "") return "";
			const [x, y] = [left, right].sort();
			return `dm:${x}|${y}`;
		}

		// ------------------------------------------------------------------
		// 侧边栏入口
		// ------------------------------------------------------------------

		function SidebarIcon(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return h(IconChat, { size });
		}

		function apply(ctx) {
			ensureStyle();

			const dispose = () => {
				/* 由 effect 清理 */
			};

			ctx.effect(() => {
				const offs = [];
				const push = (value) => {
					if (typeof value === "function") offs.push(value);
				};
				try {
					push(
						ctx.slots.inject("main", () =>
							ctx.slots.register(
								{
									name: "main",
									key: PANEL_ID,
									locale: NS,
									inject: () => ({}),
								},
								MainPanel,
							),
						),
					);
					push(
						ctx.slots.inject("sidebar.panellist", () =>
							ctx.slots.register(
								{
									name: "sidebar.panellist",
									id: PANEL_ID,
									order: PANEL_ORDER,
									label: () => PANEL_TITLE,
									locale: NS,
								},
								SidebarIcon,
							),
						),
					);
				} catch (error) {
					console.warn("dsh-lan-chat: 注册界面失败", error);
				}
				return () => {
					for (const off of offs) {
						try {
							off();
						} catch (error) {
							/* ignore */
						}
					}
					offs.length = 0;
				};
			}, "dsh-lan-chat: sidebar entry");

			return dispose;
		}

		/** 只需要 slots；layout 通过 ctx.get 按需取。 */
		const inject = ["slots"];

		exports.apply = apply;
		exports.inject = inject;
		exports.PANEL_ID = PANEL_ID;
		exports.__test = { dmConvId, colorOf, initialOf, sizeText, relText, dayText, sameDay, clockText };
		return module.exports;
	},
});
