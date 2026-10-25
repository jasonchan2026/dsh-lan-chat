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
				h("circle", { key: "b", cx: 5.4, cy: 4.6, r: 1.5, fill: "var(--lanchat-bg, #fff)" }),
				h("circle", { key: "c", cx: 10.6, cy: 11.4, r: 1.5, fill: "var(--lanchat-bg, #fff)" }),
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
		/** 标签图标：用于「设置备注」。 */
		function IconTag(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return icon(size, [
				h("path", { key: "a", d: "M7.4 2.4H2.4v5l6.2 6.2 5-5-6.2-6.2Z" }),
				h("circle", { key: "b", cx: 4.9, cy: 4.9, r: 0.9 }),
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
.lanchat-root{
	--lanchat-bg:var(--dsw-alias-bg-l1,#fff);
	--lanchat-fg:var(--dsw-alias-label-primary,#1c1c1e);
	--lanchat-dim:var(--dsw-alias-label-secondary,#6b7280);
	--lanchat-faint:var(--dsw-alias-label-tertiary,#9ca3af);
	--lanchat-line:var(--dsw-alias-border-l2,rgba(0,0,0,.09));
	--lanchat-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
	--lanchat-accent:var(--dsw-alias-state-business-primary,#4d6bfe);
	--lanchat-accent-soft:rgba(77,107,254,.12);
	--lanchat-bubble:var(--dsw-alias-bg-l2,rgba(0,0,0,.04));
	--lanchat-danger:#e5484d;
	--lanchat-ok:#2ea043;
	box-sizing:border-box;height:100%;min-height:0;display:flex;overflow:hidden;
	background:var(--lanchat-bg);color:var(--lanchat-fg);
	font-size:13px;line-height:1.55;
	-webkit-font-smoothing:antialiased;
}
.lanchat-root *{box-sizing:border-box}
.lanchat-side{width:296px;flex:none;min-height:0;display:flex;flex-direction:column;border-right:.5px solid var(--lanchat-line);background:var(--lanchat-bg)}
.lanchat-sideHead{padding:14px 14px 8px;flex:none}
.lanchat-sideTop{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.lanchat-me{min-width:0;flex:1;display:flex;align-items:center;gap:8px}
.lanchat-meName{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lanchat-meSub{font-size:11px;color:var(--lanchat-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lanchat-iconBtn{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--lanchat-dim);border-radius:6px;cursor:pointer;padding:0}
.lanchat-iconBtn:hover{background:var(--lanchat-hover);color:var(--lanchat-fg)}
.lanchat-iconBtn:disabled{opacity:.4;cursor:default}
.lanchat-iconBtn:focus-visible{outline:2px solid var(--lanchat-accent);outline-offset:-2px}
.lanchat-tabs{display:flex;gap:2px;background:var(--lanchat-bubble);border-radius:8px;padding:2px}
.lanchat-tab{flex:1;border:none;background:transparent;color:var(--lanchat-dim);font:inherit;font-size:12px;padding:5px 6px;border-radius:6px;cursor:pointer;white-space:nowrap}
.lanchat-tab:hover{color:var(--lanchat-fg)}
.lanchat-tab.on{background:var(--lanchat-bg);color:var(--lanchat-fg);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.lanchat-search{position:relative;margin-top:8px}
.lanchat-search input{width:100%;height:30px;border:.5px solid var(--lanchat-line);background:transparent;color:inherit;font:inherit;font-size:12px;border-radius:7px;padding:0 8px 0 28px;outline:none}
.lanchat-search input:focus{border-color:var(--lanchat-accent)}
.lanchat-searchGlyph{position:absolute;left:8px;top:7px;color:var(--lanchat-faint);pointer-events:none;display:flex}
.lanchat-list{flex:1;min-height:0;overflow-y:auto;padding:4px 0 12px}
.lanchat-listEmpty{padding:28px 20px;text-align:center;color:var(--lanchat-faint);font-size:12px;line-height:1.7}
.lanchat-row{display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;border:none;background:transparent;color:inherit;font:inherit;text-align:left;width:100%}
.lanchat-row:hover{background:var(--lanchat-hover)}
.lanchat-row.on{background:var(--lanchat-accent-soft)}
.lanchat-row:focus-visible{outline:2px solid var(--lanchat-accent);outline-offset:-2px}
.lanchat-avatar{width:34px;height:34px;flex:none;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#fff;position:relative;letter-spacing:0}
.lanchat-avatar.sm{width:26px;height:26px;border-radius:7px;font-size:11px}
.lanchat-avatar.lg{width:42px;height:42px;border-radius:12px;font-size:15px}
.lanchat-dot{position:absolute;right:-2px;bottom:-2px;width:9px;height:9px;border-radius:50%;background:var(--lanchat-ok);border:2px solid var(--lanchat-bg)}
.lanchat-rowMain{flex:1;min-width:0}
.lanchat-rowTop{display:flex;align-items:baseline;gap:6px}
.lanchat-rowName{flex:1;min-width:0;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lanchat-rowTime{font-size:10px;color:var(--lanchat-faint);flex:none}
.lanchat-rowBottom{display:flex;align-items:center;gap:6px;margin-top:1px}
.lanchat-rowPreview{flex:1;min-width:0;font-size:11.5px;color:var(--lanchat-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lanchat-badge{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--lanchat-danger);color:#fff;font-size:10px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.lanchat-rowDel{opacity:0;flex:none;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--lanchat-faint);border-radius:4px;cursor:pointer;padding:0;transition:opacity .1s}
.lanchat-row:hover .lanchat-rowDel,.lanchat-rowDel:focus-visible{opacity:1}
.lanchat-rowDel:hover{color:var(--lanchat-danger);background:rgba(229,72,77,.1)}
.lanchat-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.lanchat-chatHead{flex:none;height:54px;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:.5px solid var(--lanchat-line)}
.lanchat-chatTitle{min-width:0;flex:1}
.lanchat-chatName{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lanchat-chatSub{font-size:11px;color:var(--lanchat-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lanchat-thread{flex:1;min-height:0;overflow-y:auto;padding:16px 16px 8px;display:flex;flex-direction:column;gap:2px}
.lanchat-day{align-self:center;font-size:10.5px;color:var(--lanchat-faint);background:var(--lanchat-bubble);padding:2px 8px;border-radius:9px;margin:10px 0 8px}
.lanchat-sys{align-self:center;font-size:11px;color:var(--lanchat-faint);padding:3px 0;text-align:center;max-width:80%}
.lanchat-msg{display:flex;gap:8px;margin-top:8px;max-width:100%}
.lanchat-msg.self{flex-direction:row-reverse}
.lanchat-msgBody{min-width:0;max-width:min(560px,76%);display:flex;flex-direction:column;gap:2px}
.lanchat-msg.self .lanchat-msgBody{align-items:flex-end}
.lanchat-msgWho{font-size:10.5px;color:var(--lanchat-faint);padding:0 2px}
.lanchat-bubbleMsg{padding:7px 11px;border-radius:10px;background:var(--lanchat-bubble);white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.lanchat-msg.self .lanchat-bubbleMsg{background:var(--lanchat-accent);color:#fff}
.lanchat-msgMeta{font-size:10px;color:var(--lanchat-faint);padding:0 2px;display:flex;gap:6px;align-items:center}
.lanchat-msgDel{opacity:0;flex:none;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--lanchat-faint);border-radius:4px;cursor:pointer;padding:0;transition:opacity .1s}
.lanchat-msg:hover .lanchat-msgDel,.lanchat-msgDel:focus-visible{opacity:1}
.lanchat-msgDel:hover{color:var(--lanchat-danger);background:rgba(229,72,77,.1)}
.lanchat-fileCard{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:10px;background:var(--lanchat-bubble);text-decoration:none;color:inherit;max-width:100%;min-width:180px}
.lanchat-msg.self .lanchat-fileCard{background:var(--lanchat-accent);color:#fff}
.lanchat-fileCard:hover{filter:brightness(.97)}
.lanchat-fileIcon{width:30px;height:30px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;background:var(--lanchat-accent-soft);color:var(--lanchat-accent)}
.lanchat-msg.self .lanchat-fileIcon{background:rgba(255,255,255,.22);color:#fff}
.lanchat-fileInfo{min-width:0;flex:1}
.lanchat-fileName{font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lanchat-fileSize{font-size:10.5px;opacity:.72}
.lanchat-composer{flex:none;border-top:.5px solid var(--lanchat-line);padding:10px 12px 12px}
.lanchat-inputWrap{border:.5px solid var(--lanchat-line);border-radius:10px;padding:6px 8px;display:flex;flex-direction:column;gap:4px;transition:border-color .12s}
.lanchat-inputWrap:focus-within{border-color:var(--lanchat-accent)}
.lanchat-inputWrap textarea{width:100%;border:none;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1.6;resize:none;outline:none;max-height:132px;min-height:22px;padding:2px 2px 0}
.lanchat-inputBar{display:flex;align-items:center;gap:2px}
.lanchat-sendBtn{margin-left:auto;height:26px;padding:0 12px;border-radius:7px;border:none;background:var(--lanchat-accent);color:#fff;font:inherit;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.lanchat-sendBtn:disabled{opacity:.45;cursor:default}
.lanchat-hint{font-size:10.5px;color:var(--lanchat-faint);padding:4px 2px 0;display:flex;justify-content:space-between;gap:8px}
.lanchat-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--lanchat-faint);padding:32px;text-align:center}
.lanchat-emptyIcon{width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:var(--lanchat-bubble);color:var(--lanchat-dim)}
.lanchat-emptyTitle{font-size:14px;font-weight:600;color:var(--lanchat-dim)}
.lanchat-emptyText{font-size:12px;max-width:340px;line-height:1.7}
.lanchat-banner{flex:none;margin:8px 12px 0;padding:7px 10px;border-radius:8px;background:rgba(229,72,77,.1);color:var(--lanchat-danger);font-size:11.5px;display:flex;gap:6px;align-items:flex-start}
.lanchat-section{padding:12px 14px 6px;font-size:11px;font-weight:600;color:var(--lanchat-faint);text-transform:none;letter-spacing:.02em;display:flex;align-items:center;justify-content:space-between}
.lanchat-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.lanchat-field label{font-size:11.5px;color:var(--lanchat-dim)}
.lanchat-field input{height:30px;border:.5px solid var(--lanchat-line);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12.5px;padding:0 9px;outline:none}
.lanchat-field input:focus{border-color:var(--lanchat-accent)}
.lanchat-fieldHint{font-size:10.5px;color:var(--lanchat-faint)}
.lanchat-btn{height:28px;padding:0 12px;border-radius:7px;border:.5px solid var(--lanchat-line);background:transparent;color:var(--lanchat-fg);font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.lanchat-btn:hover{background:var(--lanchat-hover)}
.lanchat-btn:disabled{opacity:.45;cursor:default}
.lanchat-btn.primary{background:var(--lanchat-accent);border-color:transparent;color:#fff;font-weight:600}
.lanchat-btn.primary:hover{filter:brightness(1.06)}
.lanchat-btn.danger{color:var(--lanchat-danger);border-color:rgba(229,72,77,.35)}
.lanchat-btn.sm{height:24px;padding:0 9px;font-size:11.5px}
.lanchat-overlay{position:absolute;inset:0;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center;z-index:40;padding:24px}
.lanchat-modal{width:min(440px,100%);max-height:100%;display:flex;flex-direction:column;background:var(--lanchat-bg);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.24);overflow:hidden}
.lanchat-modalHead{flex:none;display:flex;align-items:center;gap:8px;padding:13px 16px;border-bottom:.5px solid var(--lanchat-line);font-size:13px;font-weight:600}
.lanchat-modalBody{flex:1;min-height:0;overflow-y:auto;padding:14px 16px}
.lanchat-modalFoot{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:11px 16px;border-top:.5px solid var(--lanchat-line)}
.lanchat-checkList{display:flex;flex-direction:column;gap:1px;max-height:230px;overflow-y:auto;border:.5px solid var(--lanchat-line);border-radius:8px;padding:4px}
.lanchat-checkRow{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:6px;cursor:pointer}
.lanchat-checkRow:hover{background:var(--lanchat-hover)}
.lanchat-checkRow input{accent-color:var(--lanchat-accent);flex:none}
.lanchat-checkName{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lanchat-progress{height:4px;border-radius:2px;background:var(--lanchat-bubble);overflow:hidden;margin:8px 0}
.lanchat-progressFill{height:100%;background:var(--lanchat-accent);transition:width .2s}
.lanchat-peerRow{display:flex;align-items:center;gap:9px;padding:8px 14px}
.lanchat-peerInfo{flex:1;min-width:0}
.lanchat-peerName{font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lanchat-peerAddr{font-size:10.5px;color:var(--lanchat-faint);font-family:var(--ds-font-family-code,ui-monospace,monospace)}
.lanchat-peerAliasHint{font-size:10.5px;color:var(--lanchat-faint);font-weight:400;margin-left:4px}
.lanchat-inlineRow{display:flex;gap:6px;align-items:center}
.lanchat-inlineRow input{flex:1;min-width:0;height:28px;border:.5px solid var(--lanchat-line);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;padding:0 8px;outline:none}
.lanchat-inlineRow input:focus{border-color:var(--lanchat-accent)}
.lanchat-kv{display:flex;gap:8px;font-size:11.5px;padding:3px 0}
.lanchat-kvKey{width:88px;flex:none;color:var(--lanchat-faint)}
.lanchat-kvVal{flex:1;min-width:0;word-break:break-all;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px}
.lanchat-scrollThin::-webkit-scrollbar{width:8px;height:8px}
.lanchat-scrollThin::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18));border-radius:4px}
.lanchat-scrollThin::-webkit-scrollbar-track{background:transparent}
@media (max-width:720px){
	.lanchat-side{width:220px}
	.lanchat-msgBody{max-width:84%}
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
			// 桌面端（dsh-app://app）的请求由 Electron 主进程转发，途中会把 Origin
			// 删掉，宿主侧因此看不到同源凭据。带上这个自定义头作为桌面端标识：
			// 跨站页面要伪造它必须先过 CORS 预检，而宿主从不回 CORS 头、预检也会被
			// 同源检查拒掉，所以浏览器里根本发不出去；同源页面则是无条件放行的。
			const init = { method: config.method ?? "GET", credentials: "same-origin", headers: { "x-lan-chat-client": "desktop" } };
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
			const size = props.size === "sm" ? " lanchat-avatar sm" : props.size === "lg" ? " lanchat-avatar lg" : " lanchat-avatar";
			return h(
				"div",
				{ className: `lanchat-avatar${size === " lanchat-avatar" ? "" : size}`, style: { background: colorOf(props.seed ?? props.name) } },
				initialOf(props.name, props.group === true),
				props.online === true ? h("span", { className: "lanchat-dot" }) : null,
			);
		}

		function IconButton(props) {
			return h(
				"button",
				{
					type: "button",
					className: "lanchat-iconBtn",
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
			// 群聊才可删除。行本身是 <button>，里面不能再嵌 <button>（非法 HTML，
			// 点击事件也会互相干扰），所以删除用 span + role="button" + 阻止冒泡。
			const onRemove = props.onRemove ?? null;
			return h(
				"button",
				{ type: "button", className: `lanchat-row${props.active ? " on" : ""}`, onClick: () => props.onSelect(item.convId) },
				h(Avatar, { name: item.title, seed: item.convId, group: isGroup, online: isGroup ? false : item.online }),
				h(
					"div",
					{ className: "lanchat-rowMain" },
					h(
						"div",
						{ className: "lanchat-rowTop" },
						h("span", { className: "lanchat-rowName" }, item.title),
						h("span", { className: "lanchat-rowTime" }, relText(item.lastTs)),
					),
					h(
						"div",
						{ className: "lanchat-rowBottom" },
						h("span", { className: "lanchat-rowPreview" }, item.lastText || (isGroup ? "群聊已创建" : "还没有消息")),
						item.unread > 0 ? h("span", { className: "lanchat-badge" }, item.unread > 99 ? "99+" : String(item.unread)) : null,
					),
				),
				onRemove === null
					? null
					: h(
							"span",
							{
								className: "lanchat-rowDel",
								role: "button",
								tabIndex: 0,
								title: item.own === true ? "解散群聊" : "删除群聊（仅本机）",
								"aria-label": item.own === true ? "解散群聊" : "删除群聊",
								onClick: (event) => {
									event.stopPropagation();
									onRemove(item);
								},
								onKeyDown: (event) => {
									if (event.key !== "Enter" && event.key !== " ") return;
									event.stopPropagation();
									event.preventDefault();
									onRemove(item);
								},
							},
							h(IconClose, { size: 11 }),
						),
			);
		}

		/** 联系人行。 */
		function ContactRow(props) {
			const contact = props.contact;
			// alias 是本机给它起的备注，优先显示；没备注就显示对方自己的昵称。
			const shown = contact.alias || contact.nickname || contact.peerId;
			return h(
				"div",
				{ className: "lanchat-peerRow" },
				h(Avatar, { name: shown, seed: contact.peerId, online: contact.online }),
				h(
					"div",
					{ className: "lanchat-peerInfo" },
					h(
						"div",
						{ className: "lanchat-peerName" },
						shown,
						contact.alias && contact.nickname && contact.alias !== contact.nickname
							? h("span", { className: "lanchat-peerAliasHint" }, `（${contact.nickname}）`)
							: null,
					),
					h("div", { className: "lanchat-peerAddr" }, (contact.addrs && contact.addrs[0]) || "地址未知"),
				),
				h(
					"button",
					{ type: "button", className: "lanchat-btn sm", onClick: () => props.onOpen(contact) },
					"聊天",
				),
				h(IconButton, { title: "设置备注", onClick: () => props.onRename(contact) }, h(IconTag, { size: 14 })),
				h(IconButton, { title: "删除联系人", onClick: () => props.onRemove(contact) }, h(IconTrash, { size: 14 })),
			);
		}

		/** 发现到的节点行。 */
		function DiscoveredRow(props) {
			const peer = props.peer;
			return h(
				"div",
				{ className: "lanchat-peerRow" },
				h(Avatar, { name: peer.nickname, seed: peer.peerId, online: true }),
				h(
					"div",
					{ className: "lanchat-peerInfo" },
					h("div", { className: "lanchat-peerName" }, peer.nickname || peer.peerId),
					h("div", { className: "lanchat-peerAddr" }, `${peer.address}:${peer.port}`),
				),
				peer.added
					? h("span", { className: "lanchat-btn sm", style: { cursor: "default", opacity: 0.6 } }, "已添加")
					: h("button", { type: "button", className: "lanchat-btn sm primary", onClick: () => props.onAdd(peer) }, "添加"),
			);
		}

		/** 一条消息。 */
		function MessageRow(props) {
			const message = props.message;
			const self = message.from === props.selfPeerId;
			if (message.kind === "system") {
				return h("div", { className: "lanchat-sys" }, message.text);
			}
			const isFile = message.kind === "file" && message.file;
			return h(
				"div",
				{ className: `lanchat-msg${self ? " self" : ""}` },
				h(Avatar, { name: message.fromName || message.from, seed: message.from, size: "sm" }),
				h(
					"div",
					{ className: "lanchat-msgBody" },
					self ? null : h("div", { className: "lanchat-msgWho" }, message.fromName || message.from),
					isFile
						? h(
								"a",
								{
									className: "lanchat-fileCard",
									href: `${API}/file?id=${encodeURIComponent(message.file.id)}`,
									download: message.file.name,
									title: `下载 ${message.file.name}`,
								},
								h("span", { className: "lanchat-fileIcon" }, h(IconDownload, { size: 15 })),
								h(
									"span",
									{ className: "lanchat-fileInfo" },
									h("span", { className: "lanchat-fileName" }, message.file.name),
									h("span", { className: "lanchat-fileSize" }, sizeText(message.file.size)),
								),
							)
						: h("div", { className: "lanchat-bubbleMsg" }, message.text),
					h(
						"div",
						{ className: "lanchat-msgMeta" },
						clockText(message.ts),
						self ? h(IconCheck, { size: 11 }) : null,
						// 悬停才出现的删除按钮：只删本机这条记录，撤回不了对方那份。
						props.onDelete === undefined
							? null
							: h(
									"button",
									{
										type: "button",
										className: "lanchat-msgDel",
										title: "删除这条（仅本机）",
										onClick: () => props.onDelete(message),
									},
									h(IconTrash, { size: 11 }),
								),
					),
				),
			);
		}

		/** 模态框外壳。 */
		function Modal(props) {
			return h(
				"div",
				{ className: "lanchat-overlay", onClick: props.onClose, role: "presentation" },
				h(
					"div",
					{
						className: "lanchat-modal",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": props.title,
						onClick: (event) => event.stopPropagation(),
					},
					h(
						"div",
						{ className: "lanchat-modalHead" },
						h("span", { style: { flex: 1 } }, props.title),
						h(IconButton, { title: "关闭", onClick: props.onClose }, h(IconClose, { size: 14 })),
					),
					h("div", { className: "lanchat-modalBody" }, props.children),
					props.footer === undefined ? null : h("div", { className: "lanchat-modalFoot" }, props.footer),
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
			const [retryingListen, setRetryingListen] = React.useState(false);
			const [query, setQuery] = React.useState("");
			const [scan, setScan] = React.useState(null);
			const [showSettings, setShowSettings] = React.useState(false);
			const [showCreateGroup, setShowCreateGroup] = React.useState(false);
			const [groupName, setGroupName] = React.useState("");
			const [groupMembers, setGroupMembers] = React.useState([]);
			const [probeAddr, setProbeAddr] = React.useState("");
			const [scanCidr, setScanCidr] = React.useState("");
			// accessCode 是「要设置成什么」：留空表示不修改已有访问码。
			const [settingsDraft, setSettingsDraft] = React.useState({ nickname: "", accessCode: "", clearAccessCode: false });
			const [hasAccessCode, setHasAccessCode] = React.useState(false);
			// 联系人备注弹窗
			const [renameTarget, setRenameTarget] = React.useState(null);
			const [renameDraft, setRenameDraft] = React.useState("");
			// 单文件上限（以 MB 为单位编辑，保存时换算回字节）
			const [quotaDraft, setQuotaDraft] = React.useState("");

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
						setHasAccessCode(payload.settings.hasAccessCode === true);
						setSettingsDraft({ nickname: payload.settings.nickname ?? "", accessCode: "", clearAccessCode: false });
						setQuotaDraft(String(Math.round((payload.settings.maxFileBytes ?? 536870912) / 1048576)));
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

			// 删除一条消息（仅本机）。删完重拉，保证服务端和界面一致。
			const deleteMessage = async (message) => {
				if (!activeConv) return;
				try {
					await callApi("/messages/delete", {
						method: "POST",
						body: { convId: activeConv, messageId: message.id },
					});
					await Promise.all([loadMessages(activeConv), loadConversations()]);
				} catch (error) {
					fail(error);
				}
			};

			// 清空整个会话（仅本机）。
			const clearConversation = async (convId) => {
				try {
					await callApi("/messages/delete", { method: "POST", body: { convId, all: true } });
					await Promise.all([loadMessages(convId), loadConversations()]);
				} catch (error) {
					fail(error);
				}
			};

			// 手动重试监听局域网端口（宿主侧也在自动退避重试）。
			const retryListen = async () => {
				setRetryingListen(true);
				try {
					const payload = await callApi("/listen/retry", { method: "POST", body: {} });
					await loadState();
					if (payload.listening) {
						setNotice({ kind: "ok", text: `已在端口 ${payload.port} 上开始监听` });
						setTimeout(() => setNotice(null), 4000);
					} else {
						fail(new Error(payload.startError ?? "端口仍被占用"));
					}
				} catch (error) {
					fail(error);
				} finally {
					setRetryingListen(false);
				}
			};

			// 删除群聊：群主是「解散」（通知全员），成员是「删本机这份」。
			const removeGroup = async (item) => {
				if (!item || !item.groupId) return;
				const isOwner = item.own === true;
				const text = isOwner
					? `解散群聊「${item.title}」？\n\n你是群主，这个群会从所有成员的列表里删掉，群消息本地记录也会清空。此操作不可撤销。`
					: `从本机删除群聊「${item.title}」？\n\n只会删掉你这一份，群主的群和别人的记录都不受影响。此操作不可撤销。`;
				if (typeof window !== "undefined" && !window.confirm(text)) return;
				try {
					const payload = await callApi("/groups/remove", { method: "POST", body: { groupId: item.groupId } });
					if (activeConv === item.convId) setActiveConv(null);
					await Promise.all([loadConversations(), loadContacts()]);
					setNotice({
						kind: "ok",
						text: payload.dissolved ? `已解散群聊「${item.title}」` : `已从本机删除群聊「${item.title}」`,
					});
					setTimeout(() => setNotice(null), 4000);
				} catch (error) {
					fail(error);
				}
			};

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
					// 宿主自动重试成功后端口会变化，界面要跟着更新顶部提示。
					source.addEventListener("listening", (event) => {
						loadState();
						loadContacts();
						loadConversations();
						let payload = null;
						try {
							payload = JSON.parse(event.data);
						} catch (error) {
							return;
						}
						if (payload !== null && payload.listening === true) {
							setNotice({ kind: "ok", text: `局域网端口已恢复监听（${payload.port}）` });
							setTimeout(() => setNotice(null), 5000);
						}
					});
					// 群被群主解散：从列表撤掉，正在看这个群就退回空态。
					source.addEventListener("group-removed", (event) => {
						let payload = null;
						try {
							payload = JSON.parse(event.data);
						} catch (error) {
							return;
						}
						if (payload === null || typeof payload.groupId !== "string") return;
						if (activeRef.current === `grp:${payload.groupId}`) setActiveConv(null);
						loadConversations();
						setNotice({ kind: "ok", text: "群聊已被群主解散" });
						setTimeout(() => setNotice(null), 5000);
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

			// ---- 联系人备注（只改本机显示，不影响对方）----
			const startRename = (contact) => {
				setRenameTarget(contact);
				setRenameDraft(contact.alias || "");
			};

			const saveRename = async () => {
				if (renameTarget === null) return;
				try {
					await callApi("/contacts/alias", {
						method: "POST",
						body: { peerId: renameTarget.peerId, alias: renameDraft.trim() },
					});
					setRenameTarget(null);
					setRenameDraft("");
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
					// 上限按 MB 编辑，换算成字节；填了非法值就别提交，免得被后端夹到边界。
					const megabytes = Number(quotaDraft);
					if (!Number.isFinite(megabytes) || megabytes <= 0) {
						throw new Error("单文件上限必须是正数（MB）");
					}
					const payload = await callApi("/settings", {
						method: "POST",
						body: {
							nickname: settingsDraft.nickname,
							maxFileBytes: Math.round(megabytes * 1048576),
							...(settingsDraft.clearAccessCode
								? { accessCode: "" }
								: settingsDraft.accessCode.trim() === ""
									? {}
									: { accessCode: settingsDraft.accessCode }),
						},
					});
					setState((current) => (current === null ? current : { ...current, settings: payload.settings, self: { ...current.self, nickname: payload.settings.nickname } }));
					setQuotaDraft(String(Math.round((payload.settings.maxFileBytes ?? 536870912) / 1048576)));
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
				{ className: "lanchat-side" },
				h(
					"div",
					{ className: "lanchat-sideHead" },
					h(
						"div",
						{ className: "lanchat-sideTop" },
						h(
							"div",
							{ className: "lanchat-me" },
							h(Avatar, { name: state?.self?.nickname ?? "我", seed: selfPeerId || "me", size: "sm" }),
							h(
								"div",
								{ style: { minWidth: 0 } },
								h("div", { className: "lanchat-meName" }, state?.self?.nickname ?? "正在加载…"),
								h(
									"div",
									{ className: "lanchat-meSub" },
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
						{ className: "lanchat-tabs", role: "tablist" },
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
									className: `lanchat-tab${tab === key ? " on" : ""}`,
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
								{ className: "lanchat-search" },
								h("span", { className: "lanchat-searchGlyph" }, h(IconSearch, { size: 13 })),
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
					{ className: "lanchat-list lanchat-scrollThin" },
					tab === "chats"
						? filteredConversations.length === 0
							? h(
									"div",
									{ className: "lanchat-listEmpty" },
									conversations.length === 0 ? "还没有会话。\n去「发现」扫描网段，添加同事后即可开始聊天。" : "没有匹配的会话",
								)
							: filteredConversations.map((item) =>
									h(ConversationRow, {
										key: item.convId,
										item,
										active: item.convId === activeConv,
										onSelect: openConversation,
										onRemove: item.kind === "group" ? removeGroup : null,
									}),
								)
						: tab === "contacts"
							? filteredContacts.length === 0
								? h("div", { className: "lanchat-listEmpty" }, "还没有联系人。\n去「发现」扫描网段添加。")
								: filteredContacts.map((contact) =>
										h(ContactRow, { key: contact.peerId, contact, onOpen: openWithContact, onRemove: removeContact, onRename: startRename }),
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
						{ className: "lanchat-section" },
						h("span", null, "扫描网段"),
					),
					h(
						"div",
						{ style: { padding: "0 14px 10px" } },
						h(
							"div",
							{ className: "lanchat-inlineRow" },
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
								{ type: "button", className: "lanchat-btn primary sm", onClick: startScan, disabled: running },
								running ? `${percent}%` : "扫描",
							),
						),
						scan === null
							? null
							: h(
									"div",
									null,
									h("div", { className: "lanchat-progress" }, h("div", { className: "lanchat-progressFill", style: { width: `${percent}%` } })),
									h("div", { className: "lanchat-fieldHint" }, running ? `正在扫描 ${scan.done}/${scan.total}…` : `扫描完成，共探测 ${scan.total} 个地址`),
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
												className: "lanchat-btn sm",
												onClick: () => setScanCidr(cidr),
												title: `使用本机网段 ${cidr}`,
											},
											cidr,
										),
									),
								)
							: null,
					),
					h("div", { className: "lanchat-section" }, h("span", null, "手动探测")),
					h(
						"div",
						{ style: { padding: "0 14px 12px" } },
						h(
							"div",
							{ className: "lanchat-inlineRow" },
							h("input", {
								value: probeAddr,
								onChange: (event) => setProbeAddr(event.target.value),
								placeholder: "10.0.0.23",
								"aria-label": "对方 IP 地址",
								onKeyDown: (event) => {
									if (event.key === "Enter") probe();
								},
							}),
							h("button", { type: "button", className: "lanchat-btn sm", onClick: probe }, "探测"),
						),
					),
					h(
						"div",
						{ className: "lanchat-section" },
						h("span", null, `发现的节点${discovered.length > 0 ? ` ${discovered.length}` : ""}`),
					),
					discovered.length === 0
						? h("div", { className: "lanchat-listEmpty" }, "还没有发现其他节点。\n确认对方也启用了局域网聊天助手，且在同一网段。")
						: discovered.map((peer) => h(DiscoveredRow, { key: peer.peerId, peer, onAdd: addPeer })),
				);
			}

			const thread = h(
				"div",
				{ className: "lanchat-main" },
				state !== null && state.listening === false
					? h(
							"div",
							{ className: "lanchat-banner", style: { flexDirection: "column", gap: "6px" } },
							h(
								"span",
								null,
								state.startError && state.startError.includes("EADDRINUSE")
									? `局域网端口 ${state.settings?.port ?? ""} 被占用，当前只能看到本机数据。`
									: `局域网端口未能监听：${state.startError ?? "端口被占用"}。当前只能看到本机数据。`,
							),
							h(
								"span",
								{ style: { opacity: 0.8, fontSize: "11px" } },
								state.startError && state.startError.includes("EADDRINUSE")
									? "通常是上一次 DSH 退出时端口还没释放（也可能是另一个实例还开着）。插件会自动重试；关掉占用端口的程序后可立即点「重试」。"
									: "插件会自动重试，也可以手动点「重试」。",
							),
							h(
								"div",
								{ style: { display: "flex", gap: "6px", alignItems: "center" } },
								h(
									"button",
									{
										type: "button",
										className: "lanchat-btn sm",
										onClick: () => retryListen(),
										disabled: retryingListen === true,
									},
									retryingListen ? "重试中…" : "重试",
								),
								state.retry?.pending
									? h(
											"span",
											{ style: { fontSize: "11px", opacity: 0.8 } },
											`将在约 ${Math.max(1, Math.round((state.retry.delayMs ?? 2000) / 1000))} 秒后自动重试`,
										)
									: null,
							),
						)
					: null,
				activeItem === null
					? h(
							"div",
							{ className: "lanchat-empty" },
							h("div", { className: "lanchat-emptyIcon" }, h(IconChat, { size: 26 })),
							h("div", { className: "lanchat-emptyTitle" }, "局域网聊天助手"),
							h(
								"div",
								{ className: "lanchat-emptyText" },
								"完全离线的内网通讯工具。选择一个会话开始聊天，或到「发现」扫描网段找到同事。",
							),
						)
					: h(
							React.Fragment,
							null,
							h(
								"div",
								{ className: "lanchat-chatHead" },
								h(Avatar, {
									name: activeItem.title,
									seed: activeItem.convId,
									group: activeItem.kind === "group",
									online: activeItem.kind === "group" ? false : activeItem.online,
									size: "sm",
								}),
								h(
									"div",
									{ className: "lanchat-chatTitle" },
									h("div", { className: "lanchat-chatName" }, activeItem.title),
									h(
										"div",
										{ className: "lanchat-chatSub" },
										activeItem.kind === "group"
											? `${(activeItem.members ?? []).length} 位成员`
											: activeItem.online
												? "在线"
												: "离线",
									),
								),
								h(IconButton, { title: "刷新消息", onClick: () => loadMessages(activeConv) }, h(IconRefresh, { size: 14 })),
								h(
									IconButton,
									{
										title: "清空本会话记录",
										onClick: () => {
											if (!activeConv) return;
											if (typeof window !== "undefined" && !window.confirm("清空本机这个会话的全部消息？对方那边的记录不受影响。")) return;
											clearConversation(activeConv);
										},
									},
									h(IconTrash, { size: 14 }),
								),
								// 群聊才有「删除群聊」：群主=解散，成员=删本机这份。
								activeItem.kind === "group"
									? h(
											IconButton,
											{
												title: activeItem.own === true ? "解散群聊" : "删除群聊（仅本机）",
												onClick: () => removeGroup(activeItem),
											},
											h(IconClose, { size: 14 }),
										)
									: null,
							),
							h(
								"div",
								{ className: "lanchat-thread lanchat-scrollThin", ref: threadRef },
								messages.length === 0
									? h("div", { className: "lanchat-listEmpty" }, "还没有消息，发第一条吧。")
									: messages.map((message, index) => {
											const prev = index === 0 ? null : messages[index - 1];
											const showDay = prev === null || !sameDay(prev.ts, message.ts);
											return h(
												React.Fragment,
												{ key: message.id },
												showDay ? h("div", { className: "lanchat-day" }, dayText(message.ts)) : null,
												h(MessageRow, { message, selfPeerId, onDelete: deleteMessage }),
											);
										}),
							),
							h(
								"div",
								{ className: "lanchat-composer" },
								notice === null
									? null
									: h(
											"div",
											{
												className: "lanchat-banner",
												style:
													notice.kind === "ok"
														? { margin: "0 0 8px", background: "rgba(46,160,67,.1)", color: "var(--lanchat-ok)" }
														: { margin: "0 0 8px" },
											},
											h("span", null, notice.text),
										),
								h(
									"div",
									{ className: "lanchat-inputWrap" },
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
										{ className: "lanchat-inputBar" },
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
											{ type: "button", className: "lanchat-sendBtn", onClick: send, disabled: busy || draft.trim() === "" },
											busy ? "发送中…" : "发送",
											h(IconSend, { size: 13 }),
										),
									),
								),
								h(
									"div",
									{ className: "lanchat-hint" },
									h("span", null, "Enter 发送 · Shift+Enter 换行"),
									h("span", null, `文件上限 ${sizeText(state?.settings?.maxFileBytes ?? 536870912)}`),
								),
							),
						),
			);

			return h(
				"div",
				{ className: "lanchat-root", style: { position: "relative" } },
				loadError !== null
					? h(
							"div",
							{ className: "lanchat-banner", style: { position: "absolute", left: 0, right: 0, top: 0, zIndex: 30, margin: "8px 12px" } },
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
									h("button", { key: "c", type: "button", className: "lanchat-btn", onClick: () => setShowSettings(false) }, "取消"),
									h("button", { key: "s", type: "button", className: "lanchat-btn primary", onClick: saveSettings }, "保存"),
								],
							},
							h(
								"div",
								{ className: "lanchat-field" },
								h("label", { htmlFor: "lanchat-nick" }, "昵称"),
								h("input", {
									id: "lanchat-nick",
									value: settingsDraft.nickname,
									onChange: (event) => setSettingsDraft((current) => ({ ...current, nickname: event.target.value })),
									placeholder: "别人看到的名字",
								}),
							),
							h(
								"div",
								{ className: "lanchat-field" },
								h("label", { htmlFor: "lanchat-code" }, hasAccessCode ? "访问码（已设置）" : "访问码（可选）"),
								h("input", {
									id: "lanchat-code",
									type: "password",
									autoComplete: "new-password",
									value: settingsDraft.accessCode,
									onChange: (event) => setSettingsDraft((current) => ({ ...current, accessCode: event.target.value, clearAccessCode: false })),
									placeholder: hasAccessCode ? "留空表示不修改" : "留空表示同一网段内无需验证",
								}),
								hasAccessCode
									? h(
											"label",
											{ className: "lanchat-fieldHint", style: { display: "flex", gap: 6, alignItems: "center", cursor: "pointer" } },
											h("input", {
												type: "checkbox",
												checked: settingsDraft.clearAccessCode,
												onChange: (event) => setSettingsDraft((current) => ({ ...current, clearAccessCode: event.target.checked, accessCode: "" })),
											}),
											"清除访问码（之后同网段任何人都能连接）",
										)
									: null,
								h("div", { className: "lanchat-fieldHint" }, "设置后，对方必须先通过访问码握手才能与你通信。访问码本身不会再显示在界面上。"),
							),
							h(
								"div",
								{ className: "lanchat-field" },
								h("label", { htmlFor: "lanchat-maxfile" }, "单文件上限（MB）"),
								h("input", {
									id: "lanchat-maxfile",
									type: "number",
									min: Math.max(1, Math.round((state?.settings?.quotaMinBytes ?? 67108864) / 1048576)),
									max: Math.round((state?.settings?.quotaMaxBytes ?? 68719476736) / 1048576),
									value: quotaDraft,
									onChange: (event) => setQuotaDraft(event.target.value),
									placeholder: "512",
								}),
								h(
									"div",
									{ className: "lanchat-fieldHint" },
									`默认 512MB，可设 64MB ~ 64GB。本机已用 ${sizeText(state?.settings?.fileUsage ?? 0)} / 总配额 ${sizeText(state?.settings?.maxTotalBytes ?? 0)}。`,
								),
							),
							h(
								"div",
								{ style: { marginTop: 14, borderTop: "0.5px solid var(--lanchat-line)", paddingTop: 10 } },
								h("div", { className: "lanchat-kv" }, h("span", { className: "lanchat-kvKey" }, "我的 ID"), h("span", { className: "lanchat-kvVal" }, selfPeerId || "—")),
								h("div", { className: "lanchat-kv" }, h("span", { className: "lanchat-kvKey" }, "监听端口"), h("span", { className: "lanchat-kvVal" }, String(state?.self?.port ?? "—"))),
								h(
									"div",
									{ className: "lanchat-kv" },
									h("span", { className: "lanchat-kvKey" }, "本机地址"),
									h("span", { className: "lanchat-kvVal" }, (state?.self?.addresses ?? []).join("、") || "—"),
								),
								h(
									"div",
									{ className: "lanchat-kv" },
									h("span", { className: "lanchat-kvKey" }, "本机网段"),
									h("span", { className: "lanchat-kvVal" }, (state?.self?.subnets ?? []).join("、") || "—"),
								),
							),
						)
					: null,
				renameTarget === null
					? null
					: h(
							Modal,
							{
								title: "设置备注",
								onClose: () => setRenameTarget(null),
								footer: [
									h("button", { key: "c", type: "button", className: "lanchat-btn", onClick: () => setRenameTarget(null) }, "取消"),
									h("button", { key: "s", type: "button", className: "lanchat-btn primary", onClick: saveRename }, "保存"),
								],
							},
							h(
								"div",
								{ className: "lanchat-field" },
								h("label", { htmlFor: "lanchat-alias" }, "备注名"),
								h("input", {
									id: "lanchat-alias",
									value: renameDraft,
									onChange: (event) => setRenameDraft(event.target.value),
									placeholder: renameTarget.nickname || renameTarget.peerId,
									maxLength: 64,
								}),
								h(
									"div",
									{ className: "lanchat-fieldHint" },
									"只改你这边的显示名，不会通知对方，也不影响对方自己设的昵称。留空则恢复显示对方昵称。",
								),
							),
							h(
								"div",
								{ className: "lanchat-kv" },
								h("span", { className: "lanchat-kvKey" }, "对方昵称"),
								h("span", { className: "lanchat-kvVal" }, renameTarget.nickname || "—"),
							),
						),
				showCreateGroup
					? h(
							Modal,
							{
								title: "新建群聊",
								onClose: () => setShowCreateGroup(false),
								footer: [
									h("button", { key: "c", type: "button", className: "lanchat-btn", onClick: () => setShowCreateGroup(false) }, "取消"),
									h(
										"button",
										{ key: "s", type: "button", className: "lanchat-btn primary", onClick: createGroup, disabled: groupName.trim() === "" },
										"创建",
									),
								],
							},
							h(
								"div",
								{ className: "lanchat-field" },
								h("label", { htmlFor: "lanchat-gname" }, "群名称"),
								h("input", {
									id: "lanchat-gname",
									value: groupName,
									onChange: (event) => setGroupName(event.target.value),
									placeholder: "例如：值班小组",
								}),
							),
							h(
								"div",
								{ className: "lanchat-field" },
								h("label", null, "选择成员"),
								addedContacts.length === 0
									? h("div", { className: "lanchat-fieldHint" }, "还没有联系人。先到「发现」里扫描并添加同事。")
									: h(
											"div",
											{ className: "lanchat-checkList lanchat-scrollThin" },
											addedContacts.map((contact) =>
												h(
													"label",
													{ key: contact.peerId, className: "lanchat-checkRow" },
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
													h("span", { className: "lanchat-checkName" }, contact.nickname || contact.peerId),
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
