// src/scene-svg.ts
var e = "#1F1D1A", t = "#FFFFFF", n = (e) => String(Math.round(e * 1e4) / 1e4), r = (e, t, r, i) => `translate(${n(e)} ${n(t)}) rotate(${n(r)})${i === void 0 ? "" : ` scale(${n(i)})`}`;
function i(e, t, r, i, a, o = {}) {
	return {
		tag: "text",
		text: e,
		attrs: {
			x: n(t),
			y: n(r),
			"font-size": n(i),
			"text-anchor": "middle",
			"dominant-baseline": "central",
			fill: a,
			...o
		}
	};
}
function a(t, n = {}) {
	return i(t.text, t.x, t.y, t.fontSize, e, n);
}
function o(e, t) {
	return i(e.text, e.dx, e.dy, e.fontSize, e.color, {
		"font-weight": "600",
		transform: r(t.x, t.y, t.rotation)
	});
}
function s(e) {
	let i = e.badgeStyle === "filled", s = [{
		tag: "path",
		attrs: {
			d: e.pathD,
			transform: r(e.x, e.y, e.rotation, e.size),
			fill: i ? e.color : t,
			"fill-rule": "evenodd",
			stroke: i ? "none" : e.color,
			"stroke-width": i ? "0" : "0.08"
		}
	}];
	return e.badge.text && s.push(o(e.badge, e)), e.label && s.push(a(e.label, { y: n(e.label.y + e.label.fontSize * .3) })), {
		tag: "g",
		elementId: e.elementId,
		attrs: {},
		children: s
	};
}
function c(a) {
	let o = a.dash !== void 0, s = a.shape === "magnetic", c = {
		d: a.d,
		fill: "none",
		stroke: a.color,
		"stroke-width": n(a.strokeWidth),
		"stroke-linecap": a.kind === "track" && !s && !o ? "square" : "round",
		"stroke-linejoin": "round"
	};
	a.dash && (c["stroke-dasharray"] = a.dash.map(n).join(" ")), a.kind === "led-strip" && (c.opacity = "0.9");
	let l = [{
		tag: "path",
		attrs: {
			d: a.d,
			fill: "none",
			stroke: "transparent",
			"stroke-width": n(Math.max(a.strokeWidth * 3, 12)),
			"stroke-linecap": "round",
			"stroke-linejoin": "round"
		}
	}, {
		tag: "path",
		attrs: c
	}];
	for (let e of a.heads) l.push({
		tag: "path",
		attrs: {
			d: s ? "M0 -0.5 A0.5 0.5 0 1 1 0 0.5 A0.5 0.5 0 1 1 0 -0.5 Z" : "M-0.5 -0.5 H0.5 V0.5 H-0.5 Z",
			transform: r(e.x, e.y, s ? 0 : e.angle, e.size),
			fill: a.color,
			stroke: t,
			"stroke-width": "0.12"
		}
	});
	if (a.label) {
		let r = a.kind === "curtain";
		l.push(i(a.label.text, a.label.x, a.label.y, a.label.fontSize, r ? a.color : e, {
			"font-weight": r ? "700" : "400",
			stroke: t,
			"stroke-width": n(a.label.fontSize * .3),
			"stroke-linejoin": "round",
			"paint-order": "stroke"
		}));
	}
	return {
		tag: "g",
		elementId: a.elementId,
		attrs: {},
		children: l
	};
}
function l(e) {
	let t = e.text.split("\n"), r = e.fontSize * 1.2, a = e.highlight ? e.fontSize * .3 : 0, o = [];
	if (e.highlight) {
		let i = Math.max(...t.map((e) => e.length)) * e.fontSize * .55 + a * 2, s = t.length * r + a * 2;
		o.push({
			tag: "path",
			attrs: {
				d: `M${n(e.x)} ${n(e.y)} h${n(i)} v${n(s)} h${n(-i)} Z`,
				fill: e.highlight
			}
		});
	}
	return t.forEach((t, n) => {
		o.push(i(t, e.x + a, e.y + a + r * (n + .5), e.fontSize, e.color, {
			"text-anchor": "start",
			"font-weight": e.bold ? "600" : "400"
		}));
	}), {
		tag: "g",
		elementId: e.elementId,
		attrs: {},
		children: o
	};
}
function u(e) {
	return e.items.map((e) => {
		switch (e.type) {
			case "marker": return s(e);
			case "path": return c(e);
			case "note": return l(e);
		}
	});
}
// src/hass-util.ts
var d = (e) => e.split(".", 1)[0] ?? "";
function f(e, t) {
	return Object.values(e.entities).filter((e) => e.device_id === t);
}
// src/visual-state.ts
var p = /* @__PURE__ */ new Set([
	"light",
	"switch",
	"cover",
	"climate",
	"binary_sensor",
	"sensor",
	"fan",
	"lock",
	"camera"
]), ee = /* @__PURE__ */ new Set([
	"door",
	"window",
	"motion",
	"occupancy",
	"smoke",
	"moisture",
	"gas"
]), te = (e) => e === "unavailable" || e === "unknown", ne = (e) => e.charAt(0).toUpperCase() + e.slice(1);
function re(e, t) {
	return {
		entityId: e,
		domain: d(e),
		state: t.state,
		attributes: t.attributes
	};
}
function ie(e, t) {
	if (e.type === "entity") {
		let n = t.states[e.id];
		return n ? [re(e.id, n)] : void 0;
	}
	if (!t.devices[e.id]) return;
	let n = [];
	for (let r of f(t, e.id)) {
		let e = t.states[r.entity_id];
		e && p.has(d(r.entity_id)) && n.push(re(r.entity_id, e));
	}
	return n;
}
function ae(e) {
	let t = e.attributes.current_position, n = typeof t == "number" ? Math.round(t) : void 0, r = n === void 0 ? e.state !== "closed" : n > 0, i;
	return i = n === void 0 ? e.state === "closed" ? "Closed" : "Open" : n === 0 ? "Closed" : n === 100 ? "Open" : `${n}%`, n === void 0 ? {
		status: r ? "on" : "off",
		text: i
	} : {
		status: r ? "on" : "off",
		position: n,
		text: i
	};
}
function oe(e) {
	let t = e.attributes.current_temperature, n = typeof t == "number" ? `${e.state} · ${t}°` : e.state;
	return {
		status: e.state === "off" ? "off" : "on",
		text: n
	};
}
function se(e) {
	let t = ne(e.state);
	return e.state === "locked" ? {
		status: "off",
		text: t
	} : {
		status: e.state === "jammed" ? "alert" : "on",
		text: t
	};
}
function ce(e) {
	let t = e.attributes.unit_of_measurement;
	return {
		status: "idle",
		text: typeof t == "string" && t ? `${e.state} ${t}` : e.state
	};
}
function le(e, t, n) {
	if (!t) return { status: "unlinked" };
	let r = ie(t, n);
	if (!r) return { status: "missing" };
	if (r.length === 0) return { status: "idle" };
	let i = r.filter((e) => !te(e.state));
	if (i.length === 0) return { status: "unavailable" };
	let a = (e) => i.find((t) => t.domain === e), o = (...e) => i.filter((t) => e.includes(t.domain)), s = a("climate");
	if (s) return oe(s);
	let c = a("cover");
	if (c) return ae(c);
	let l = a("lock");
	if (l) return se(l);
	let u = o("binary_sensor");
	if (u.find((e) => e.state === "on" && ee.has(String(e.attributes.device_class)))) return { status: "alert" };
	let d = o("light", "switch", "fan");
	if (d.length > 0) return { status: d.some((e) => e.state === "on") ? "on" : "off" };
	let f = o("sensor"), p = f.find((e) => e.attributes.device_class !== "battery") ?? f[0];
	return p ? ce(p) : u.length > 0 ? { status: u.some((e) => e.state === "on") ? "on" : "idle" } : {
		status: "idle",
		text: i[0]?.state
	};
}
// src/link-candidates.ts
var m = /* @__PURE__ */ new Set([
	"downlights",
	"surface-lights",
	"track-lights",
	"led-strips",
	"magnetic-track-lights",
	"pendant-lights",
	"spotlights",
	"misc-lighting",
	"ceiling-fans"
]);
function ue(e) {
	return e === "ceiling-fans" ? [
		"light",
		"switch",
		"fan"
	] : ["light", "switch"];
}
function de(e) {
	switch (e) {
		case "curtains-blinds": return ["cover"];
		case "aircon-controllers": return ["climate"];
		case "sensors": return ["sensor", "binary_sensor"];
		case "cameras": return ["camera"];
		case "smart-locks": return ["lock"];
		case "smart-switches":
		case "control-panels": return ["switch", "light"];
		default: return;
	}
}
function fe(e, t) {
	let n = /* @__PURE__ */ new Set([...Object.keys(t.entities), ...Object.keys(t.states)]), r = [];
	for (let i of n) {
		if (!e.includes(d(i))) continue;
		let n = t.entities[i], a = t.states[i]?.attributes.friendly_name, o = n?.area_id ?? (n?.device_id ? t.devices[n.device_id]?.area_id : null);
		r.push({
			link: {
				type: "entity",
				id: i
			},
			name: n?.name || typeof a == "string" && a || i,
			area: o && t.areas[o]?.name || "",
			detail: i
		});
	}
	return r;
}
function pe(e, t) {
	return Object.values(t.devices).filter((n) => e === void 0 || f(t, n.id).some((t) => e.includes(d(t.entity_id)))).map((e) => ({
		link: {
			type: "device",
			id: e.id
		},
		name: e.name_by_user || e.name || e.id,
		area: e.area_id && t.areas[e.area_id]?.name || ""
	}));
}
function me(e, t) {
	return (m.has(e.categoryId) ? fe(ue(e.categoryId), t) : pe(de(e.categoryId), t)).sort((e, t) => Number(e.area === "") - Number(t.area === "") || e.area.localeCompare(t.area) || e.name.localeCompare(t.name));
}
// src/api.ts
async function he(e) {
	return (await e.callWS({
		type: "config_entries/get",
		domain: "maxsen"
	})).find((e) => e.state === "loaded")?.entry_id;
}
function h(e, t) {
	return e.callWS({
		type: "maxsen/home",
		entry_id: t
	});
}
function ge(e, t, n) {
	return e.connection.subscribeMessage((e) => n(e.event), {
		type: "maxsen/subscribe",
		entry_id: t
	});
}
function _e(e, t, n) {
	return e.callWS({
		type: "maxsen/links/set",
		entry_id: t,
		updates: n
	});
}
function ve(e, t, n) {
	return e.callWS({
		type: "maxsen/quick_panel/set",
		entry_id: t,
		items: n
	});
}
function ye(e, t, n) {
	return e.callWS({
		type: "maxsen/refresh/preview",
		entry_id: t,
		...n === void 0 ? {} : { file_id: n }
	});
}
function be(e, t, n) {
	return e.callWS({
		type: "maxsen/refresh/apply",
		entry_id: t,
		preview_id: n
	});
}
function xe(e, t) {
	return e.callWS({
		type: "maxsen/scenes/create_starter",
		entry_id: t
	});
}
async function Se(e, t) {
	let n = await e.fetchWithAuth(t);
	if (!n.ok) throw Error(`Image ${t} answered ${n.status}`);
	return URL.createObjectURL(await n.blob());
}
// node_modules/@lit/reactive-element/css-tag.js
var g = globalThis, _ = g.ShadowRoot && (g.ShadyCSS === void 0 || g.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype, v = Symbol(), y = /* @__PURE__ */ new WeakMap(), b = class {
	constructor(e, t, n) {
		if (this._$cssResult$ = !0, n !== v) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
		this.cssText = e, this.t = t;
	}
	get styleSheet() {
		let e = this.o, t = this.t;
		if (_ && e === void 0) {
			let n = t !== void 0 && t.length === 1;
			n && (e = y.get(t)), e === void 0 && ((this.o = e = new CSSStyleSheet()).replaceSync(this.cssText), n && y.set(t, e));
		}
		return e;
	}
	toString() {
		return this.cssText;
	}
}, Ce = (e) => new b(typeof e == "string" ? e : e + "", void 0, v), x = (e, ...t) => new b(e.length === 1 ? e[0] : t.reduce((t, n, r) => t + ((e) => {
	if (!0 === e._$cssResult$) return e.cssText;
	if (typeof e == "number") return e;
	throw Error("Value passed to 'css' function must be a 'css' function result: " + e + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
})(n) + e[r + 1], e[0]), e, v), we = (e, t) => {
	if (_) e.adoptedStyleSheets = t.map((e) => e instanceof CSSStyleSheet ? e : e.styleSheet);
	else for (let n of t) {
		let t = document.createElement("style"), r = g.litNonce;
		r !== void 0 && t.setAttribute("nonce", r), t.textContent = n.cssText, e.appendChild(t);
	}
}, Te = _ ? (e) => e : (e) => e instanceof CSSStyleSheet ? ((e) => {
	let t = "";
	for (let n of e.cssRules) t += n.cssText;
	return Ce(t);
})(e) : e, { is: Ee, defineProperty: De, getOwnPropertyDescriptor: Oe, getOwnPropertyNames: ke, getOwnPropertySymbols: Ae, getPrototypeOf: je } = Object, S = globalThis, C = S.trustedTypes, Me = C ? C.emptyScript : "", Ne = S.reactiveElementPolyfillSupport, w = (e, t) => e, T = {
	toAttribute(e, t) {
		switch (t) {
			case Boolean:
				e = e ? Me : null;
				break;
			case Object:
			case Array: e = e == null ? e : JSON.stringify(e);
		}
		return e;
	},
	fromAttribute(e, t) {
		let n = e;
		switch (t) {
			case Boolean:
				n = e !== null;
				break;
			case Number:
				n = e === null ? null : Number(e);
				break;
			case Object:
			case Array: try {
				n = JSON.parse(e);
			} catch {
				n = null;
			}
		}
		return n;
	}
}, E = (e, t) => !Ee(e, t), Pe = {
	attribute: !0,
	type: String,
	converter: T,
	reflect: !1,
	useDefault: !1,
	hasChanged: E
};
Symbol.metadata ??= Symbol("metadata"), S.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var D = class extends HTMLElement {
	static addInitializer(e) {
		this._$Ei(), (this.l ??= []).push(e);
	}
	static get observedAttributes() {
		return this.finalize(), this._$Eh && [...this._$Eh.keys()];
	}
	static createProperty(e, t = Pe) {
		if (t.state && (t.attribute = !1), this._$Ei(), this.prototype.hasOwnProperty(e) && ((t = Object.create(t)).wrapped = !0), this.elementProperties.set(e, t), !t.noAccessor) {
			let n = Symbol(), r = this.getPropertyDescriptor(e, n, t);
			r !== void 0 && De(this.prototype, e, r);
		}
	}
	static getPropertyDescriptor(e, t, n) {
		let { get: r, set: i } = Oe(this.prototype, e) ?? {
			get() {
				return this[t];
			},
			set(e) {
				this[t] = e;
			}
		};
		return {
			get: r,
			set(t) {
				let a = r?.call(this);
				i?.call(this, t), this.requestUpdate(e, a, n);
			},
			configurable: !0,
			enumerable: !0
		};
	}
	static getPropertyOptions(e) {
		return this.elementProperties.get(e) ?? Pe;
	}
	static _$Ei() {
		if (this.hasOwnProperty(w("elementProperties"))) return;
		let e = je(this);
		e.finalize(), e.l !== void 0 && (this.l = [...e.l]), this.elementProperties = new Map(e.elementProperties);
	}
	static finalize() {
		if (this.hasOwnProperty(w("finalized"))) return;
		if (this.finalized = !0, this._$Ei(), this.hasOwnProperty(w("properties"))) {
			let e = this.properties, t = [...ke(e), ...Ae(e)];
			for (let n of t) this.createProperty(n, e[n]);
		}
		let e = this[Symbol.metadata];
		if (e !== null) {
			let t = litPropertyMetadata.get(e);
			if (t !== void 0) for (let [e, n] of t) this.elementProperties.set(e, n);
		}
		this._$Eh = /* @__PURE__ */ new Map();
		for (let [e, t] of this.elementProperties) {
			let n = this._$Eu(e, t);
			n !== void 0 && this._$Eh.set(n, e);
		}
		this.elementStyles = this.finalizeStyles(this.styles);
	}
	static finalizeStyles(e) {
		let t = [];
		if (Array.isArray(e)) {
			let n = new Set(e.flat(1 / 0).reverse());
			for (let e of n) t.unshift(Te(e));
		} else e !== void 0 && t.push(Te(e));
		return t;
	}
	static _$Eu(e, t) {
		let n = t.attribute;
		return !1 === n ? void 0 : typeof n == "string" ? n : typeof e == "string" ? e.toLowerCase() : void 0;
	}
	constructor() {
		super(), this._$Ep = void 0, this.isUpdatePending = !1, this.hasUpdated = !1, this._$Em = null, this._$Ev();
	}
	_$Ev() {
		this._$ES = new Promise((e) => this.enableUpdating = e), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((e) => e(this));
	}
	addController(e) {
		(this._$EO ??= /* @__PURE__ */ new Set()).add(e), this.renderRoot !== void 0 && this.isConnected && e.hostConnected?.();
	}
	removeController(e) {
		this._$EO?.delete(e);
	}
	_$E_() {
		let e = /* @__PURE__ */ new Map(), t = this.constructor.elementProperties;
		for (let n of t.keys()) this.hasOwnProperty(n) && (e.set(n, this[n]), delete this[n]);
		e.size > 0 && (this._$Ep = e);
	}
	createRenderRoot() {
		let e = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
		return we(e, this.constructor.elementStyles), e;
	}
	connectedCallback() {
		this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(!0), this._$EO?.forEach((e) => e.hostConnected?.());
	}
	enableUpdating(e) {}
	disconnectedCallback() {
		this._$EO?.forEach((e) => e.hostDisconnected?.());
	}
	attributeChangedCallback(e, t, n) {
		this._$AK(e, n);
	}
	_$ET(e, t) {
		let n = this.constructor.elementProperties.get(e), r = this.constructor._$Eu(e, n);
		if (r !== void 0 && !0 === n.reflect) {
			let i = (n.converter?.toAttribute === void 0 ? T : n.converter).toAttribute(t, n.type);
			this._$Em = e, i == null ? this.removeAttribute(r) : this.setAttribute(r, i), this._$Em = null;
		}
	}
	_$AK(e, t) {
		let n = this.constructor, r = n._$Eh.get(e);
		if (r !== void 0 && this._$Em !== r) {
			let e = n.getPropertyOptions(r), i = typeof e.converter == "function" ? { fromAttribute: e.converter } : e.converter?.fromAttribute === void 0 ? T : e.converter;
			this._$Em = r;
			let a = i.fromAttribute(t, e.type);
			this[r] = a ?? this._$Ej?.get(r) ?? a, this._$Em = null;
		}
	}
	requestUpdate(e, t, n, r = !1, i) {
		if (e !== void 0) {
			let a = this.constructor;
			if (!1 === r && (i = this[e]), n ??= a.getPropertyOptions(e), !((n.hasChanged ?? E)(i, t) || n.useDefault && n.reflect && i === this._$Ej?.get(e) && !this.hasAttribute(a._$Eu(e, n)))) return;
			this.C(e, t, n);
		}
		!1 === this.isUpdatePending && (this._$ES = this._$EP());
	}
	C(e, t, { useDefault: n, reflect: r, wrapped: i }, a) {
		n && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(e) && (this._$Ej.set(e, a ?? t ?? this[e]), !0 !== i || a !== void 0) || (this._$AL.has(e) || (this.hasUpdated || n || (t = void 0), this._$AL.set(e, t)), !0 === r && this._$Em !== e && (this._$Eq ??= /* @__PURE__ */ new Set()).add(e));
	}
	async _$EP() {
		this.isUpdatePending = !0;
		try {
			await this._$ES;
		} catch (e) {
			Promise.reject(e);
		}
		let e = this.scheduleUpdate();
		return e != null && await e, !this.isUpdatePending;
	}
	scheduleUpdate() {
		return this.performUpdate();
	}
	performUpdate() {
		if (!this.isUpdatePending) return;
		if (!this.hasUpdated) {
			if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
				for (let [e, t] of this._$Ep) this[e] = t;
				this._$Ep = void 0;
			}
			let e = this.constructor.elementProperties;
			if (e.size > 0) for (let [t, n] of e) {
				let { wrapped: e } = n, r = this[t];
				!0 !== e || this._$AL.has(t) || r === void 0 || this.C(t, void 0, n, r);
			}
		}
		let e = !1, t = this._$AL;
		try {
			e = this.shouldUpdate(t), e ? (this.willUpdate(t), this._$EO?.forEach((e) => e.hostUpdate?.()), this.update(t)) : this._$EM();
		} catch (t) {
			throw e = !1, this._$EM(), t;
		}
		e && this._$AE(t);
	}
	willUpdate(e) {}
	_$AE(e) {
		this._$EO?.forEach((e) => e.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = !0, this.firstUpdated(e)), this.updated(e);
	}
	_$EM() {
		this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = !1;
	}
	get updateComplete() {
		return this.getUpdateComplete();
	}
	getUpdateComplete() {
		return this._$ES;
	}
	shouldUpdate(e) {
		return !0;
	}
	update(e) {
		this._$Eq &&= this._$Eq.forEach((e) => this._$ET(e, this[e])), this._$EM();
	}
	updated(e) {}
	firstUpdated(e) {}
};
D.elementStyles = [], D.shadowRootOptions = { mode: "open" }, D[w("elementProperties")] = /* @__PURE__ */ new Map(), D[w("finalized")] = /* @__PURE__ */ new Map(), Ne?.({ ReactiveElement: D }), (S.reactiveElementVersions ??= []).push("2.1.2");
// node_modules/lit-html/lit-html.js
var O = globalThis, Fe = (e) => e, k = O.trustedTypes, Ie = k ? k.createPolicy("lit-html", { createHTML: (e) => e }) : void 0, Le = "$lit$", A = `lit$${Math.random().toFixed(9).slice(2)}$`, Re = "?" + A, ze = `<${Re}>`, j = document, M = () => j.createComment(""), N = (e) => e === null || typeof e != "object" && typeof e != "function", P = Array.isArray, Be = (e) => P(e) || typeof e?.[Symbol.iterator] == "function", F = "[ 	\n\f\r]", I = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g, Ve = /-->/g, He = />/g, L = RegExp(`>|${F}(?:([^\\s"'>=/]+)(${F}*=${F}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`, "g"), Ue = /'/g, We = /"/g, Ge = /^(?:script|style|textarea|title)$/i, Ke = (e) => (t, ...n) => ({
	_$litType$: e,
	strings: t,
	values: n
}), R = Ke(1), z = Ke(2), B = Symbol.for("lit-noChange"), V = Symbol.for("lit-nothing"), qe = /* @__PURE__ */ new WeakMap(), H = j.createTreeWalker(j, 129);
function Je(e, t) {
	if (!P(e) || !e.hasOwnProperty("raw")) throw Error("invalid template strings array");
	return Ie === void 0 ? t : Ie.createHTML(t);
}
var Ye = (e, t) => {
	let n = e.length - 1, r = [], i, a = t === 2 ? "<svg>" : t === 3 ? "<math>" : "", o = I;
	for (let t = 0; t < n; t++) {
		let n = e[t], s, c, l = -1, u = 0;
		for (; u < n.length && (o.lastIndex = u, c = o.exec(n), c !== null);) u = o.lastIndex, o === I ? c[1] === "!--" ? o = Ve : c[1] === void 0 ? c[2] === void 0 ? c[3] !== void 0 && (o = L) : (Ge.test(c[2]) && (i = RegExp("</" + c[2], "g")), o = L) : o = He : o === L ? c[0] === ">" ? (o = i ?? I, l = -1) : c[1] === void 0 ? l = -2 : (l = o.lastIndex - c[2].length, s = c[1], o = c[3] === void 0 ? L : c[3] === "\"" ? We : Ue) : o === We || o === Ue ? o = L : o === Ve || o === He ? o = I : (o = L, i = void 0);
		let d = o === L && e[t + 1].startsWith("/>") ? " " : "";
		a += o === I ? n + ze : l >= 0 ? (r.push(s), n.slice(0, l) + Le + n.slice(l) + A + d) : n + A + (l === -2 ? t : d);
	}
	return [Je(e, a + (e[n] || "<?>") + (t === 2 ? "</svg>" : t === 3 ? "</math>" : "")), r];
}, U = class e {
	constructor({ strings: t, _$litType$: n }, r) {
		let i;
		this.parts = [];
		let a = 0, o = 0, s = t.length - 1, c = this.parts, [l, u] = Ye(t, n);
		if (this.el = e.createElement(l, r), H.currentNode = this.el.content, n === 2 || n === 3) {
			let e = this.el.content.firstChild;
			e.replaceWith(...e.childNodes);
		}
		for (; (i = H.nextNode()) !== null && c.length < s;) {
			if (i.nodeType === 1) {
				if (i.hasAttributes()) for (let e of i.getAttributeNames()) if (e.endsWith(Le)) {
					let t = u[o++], n = i.getAttribute(e).split(A), r = /([.?@])?(.*)/.exec(t);
					c.push({
						type: 1,
						index: a,
						name: r[2],
						strings: n,
						ctor: r[1] === "." ? Ze : r[1] === "?" ? Qe : r[1] === "@" ? $e : K
					}), i.removeAttribute(e);
				} else e.startsWith(A) && (c.push({
					type: 6,
					index: a
				}), i.removeAttribute(e));
				if (Ge.test(i.tagName)) {
					let e = i.textContent.split(A), t = e.length - 1;
					if (t > 0) {
						i.textContent = k ? k.emptyScript : "";
						for (let n = 0; n < t; n++) i.append(e[n], M()), H.nextNode(), c.push({
							type: 2,
							index: ++a
						});
						i.append(e[t], M());
					}
				}
			} else if (i.nodeType === 8) {
				if (i.data === Re) c.push({
					type: 2,
					index: a
				});
				else {
					let e = -1;
					for (; (e = i.data.indexOf(A, e + 1)) !== -1;) c.push({
						type: 7,
						index: a
					}), e += A.length - 1;
				}
			}
			a++;
		}
	}
	static createElement(e, t) {
		let n = j.createElement("template");
		return n.innerHTML = e, n;
	}
};
function W(e, t, n = e, r) {
	if (t === B) return t;
	let i = r === void 0 ? n._$Cl : n._$Co?.[r], a = N(t) ? void 0 : t._$litDirective$;
	return i?.constructor !== a && (i?._$AO?.(!1), a === void 0 ? i = void 0 : (i = new a(e), i._$AT(e, n, r)), r === void 0 ? n._$Cl = i : (n._$Co ??= [])[r] = i), i !== void 0 && (t = W(e, i._$AS(e, t.values), i, r)), t;
}
var Xe = class {
	constructor(e, t) {
		this._$AV = [], this._$AN = void 0, this._$AD = e, this._$AM = t;
	}
	get parentNode() {
		return this._$AM.parentNode;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	u(e) {
		let { el: { content: t }, parts: n } = this._$AD, r = (e?.creationScope ?? j).importNode(t, !0);
		H.currentNode = r;
		let i = H.nextNode(), a = 0, o = 0, s = n[0];
		for (; s !== void 0;) {
			if (a === s.index) {
				let t;
				s.type === 2 ? t = new G(i, i.nextSibling, this, e) : s.type === 1 ? t = new s.ctor(i, s.name, s.strings, this, e) : s.type === 6 && (t = new et(i, this, e)), this._$AV.push(t), s = n[++o];
			}
			a !== s?.index && (i = H.nextNode(), a++);
		}
		return H.currentNode = j, r;
	}
	p(e) {
		let t = 0;
		for (let n of this._$AV) n !== void 0 && (n.strings === void 0 ? n._$AI(e[t]) : (n._$AI(e, n, t), t += n.strings.length - 2)), t++;
	}
}, G = class e {
	get _$AU() {
		return this._$AM?._$AU ?? this._$Cv;
	}
	constructor(e, t, n, r) {
		this.type = 2, this._$AH = V, this._$AN = void 0, this._$AA = e, this._$AB = t, this._$AM = n, this.options = r, this._$Cv = r?.isConnected ?? !0;
	}
	get parentNode() {
		let e = this._$AA.parentNode, t = this._$AM;
		return t !== void 0 && e?.nodeType === 11 && (e = t.parentNode), e;
	}
	get startNode() {
		return this._$AA;
	}
	get endNode() {
		return this._$AB;
	}
	_$AI(e, t = this) {
		e = W(this, e, t), N(e) ? e === V || e == null || e === "" ? (this._$AH !== V && this._$AR(), this._$AH = V) : e !== this._$AH && e !== B && this._(e) : e._$litType$ === void 0 ? e.nodeType === void 0 ? Be(e) ? this.k(e) : this._(e) : this.T(e) : this.$(e);
	}
	O(e) {
		return this._$AA.parentNode.insertBefore(e, this._$AB);
	}
	T(e) {
		this._$AH !== e && (this._$AR(), this._$AH = this.O(e));
	}
	_(e) {
		this._$AH !== V && N(this._$AH) ? this._$AA.nextSibling.data = e : this.T(j.createTextNode(e)), this._$AH = e;
	}
	$(e) {
		let { values: t, _$litType$: n } = e, r = typeof n == "number" ? this._$AC(e) : (n.el === void 0 && (n.el = U.createElement(Je(n.h, n.h[0]), this.options)), n);
		if (this._$AH?._$AD === r) this._$AH.p(t);
		else {
			let e = new Xe(r, this), n = e.u(this.options);
			e.p(t), this.T(n), this._$AH = e;
		}
	}
	_$AC(e) {
		let t = qe.get(e.strings);
		return t === void 0 && qe.set(e.strings, t = new U(e)), t;
	}
	k(t) {
		P(this._$AH) || (this._$AH = [], this._$AR());
		let n = this._$AH, r, i = 0;
		for (let a of t) i === n.length ? n.push(r = new e(this.O(M()), this.O(M()), this, this.options)) : r = n[i], r._$AI(a), i++;
		i < n.length && (this._$AR(r && r._$AB.nextSibling, i), n.length = i);
	}
	_$AR(e = this._$AA.nextSibling, t) {
		for (this._$AP?.(!1, !0, t); e !== this._$AB;) {
			let t = Fe(e).nextSibling;
			Fe(e).remove(), e = t;
		}
	}
	setConnected(e) {
		this._$AM === void 0 && (this._$Cv = e, this._$AP?.(e));
	}
}, K = class {
	get tagName() {
		return this.element.tagName;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	constructor(e, t, n, r, i) {
		this.type = 1, this._$AH = V, this._$AN = void 0, this.element = e, this.name = t, this._$AM = r, this.options = i, n.length > 2 || n[0] !== "" || n[1] !== "" ? (this._$AH = Array(n.length - 1).fill(/* @__PURE__ */ new String()), this.strings = n) : this._$AH = V;
	}
	_$AI(e, t = this, n, r) {
		let i = this.strings, a = !1;
		if (i === void 0) e = W(this, e, t, 0), a = !N(e) || e !== this._$AH && e !== B, a && (this._$AH = e);
		else {
			let r = e, o, s;
			for (e = i[0], o = 0; o < i.length - 1; o++) s = W(this, r[n + o], t, o), s === B && (s = this._$AH[o]), a ||= !N(s) || s !== this._$AH[o], s === V ? e = V : e !== V && (e += (s ?? "") + i[o + 1]), this._$AH[o] = s;
		}
		a && !r && this.j(e);
	}
	j(e) {
		e === V ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, e ?? "");
	}
}, Ze = class extends K {
	constructor() {
		super(...arguments), this.type = 3;
	}
	j(e) {
		this.element[this.name] = e === V ? void 0 : e;
	}
}, Qe = class extends K {
	constructor() {
		super(...arguments), this.type = 4;
	}
	j(e) {
		this.element.toggleAttribute(this.name, !!e && e !== V);
	}
}, $e = class extends K {
	constructor(e, t, n, r, i) {
		super(e, t, n, r, i), this.type = 5;
	}
	_$AI(e, t = this) {
		if ((e = W(this, e, t, 0) ?? V) === B) return;
		let n = this._$AH, r = e === V && n !== V || e.capture !== n.capture || e.once !== n.once || e.passive !== n.passive, i = e !== V && (n === V || r);
		r && this.element.removeEventListener(this.name, this, n), i && this.element.addEventListener(this.name, this, e), this._$AH = e;
	}
	handleEvent(e) {
		typeof this._$AH == "function" ? this._$AH.call(this.options?.host ?? this.element, e) : this._$AH.handleEvent(e);
	}
}, et = class {
	constructor(e, t, n) {
		this.element = e, this.type = 6, this._$AN = void 0, this._$AM = t, this.options = n;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	_$AI(e) {
		W(this, e);
	}
}, tt = O.litHtmlPolyfillSupport;
tt?.(U, G), (O.litHtmlVersions ??= []).push("3.3.3");
var nt = (e, t, n) => {
	let r = n?.renderBefore ?? t, i = r._$litPart$;
	if (i === void 0) {
		let e = n?.renderBefore ?? null;
		r._$litPart$ = i = new G(t.insertBefore(M(), e), e, void 0, n ?? {});
	}
	return i._$AI(e), i;
}, q = globalThis, J = class extends D {
	constructor() {
		super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
	}
	createRenderRoot() {
		let e = super.createRenderRoot();
		return this.renderOptions.renderBefore ??= e.firstChild, e;
	}
	update(e) {
		let t = this.render();
		this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(e), this._$Do = nt(t, this.renderRoot, this.renderOptions);
	}
	connectedCallback() {
		super.connectedCallback(), this._$Do?.setConnected(!0);
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._$Do?.setConnected(!1);
	}
	render() {
		return B;
	}
};
J._$litElement$ = !0, J.finalized = !0, q.litElementHydrateSupport?.({ LitElement: J });
var rt = q.litElementPolyfillSupport;
rt?.({ LitElement: J }), (q.litElementVersions ??= []).push("4.2.2");
// node_modules/lit-html/directive.js
var it = {
	ATTRIBUTE: 1,
	CHILD: 2,
	PROPERTY: 3,
	BOOLEAN_ATTRIBUTE: 4,
	EVENT: 5,
	ELEMENT: 6
}, at = (e) => (...t) => ({
	_$litDirective$: e,
	values: t
}), ot = class {
	constructor(e) {}
	get _$AU() {
		return this._$AM._$AU;
	}
	_$AT(e, t, n) {
		this._$Ct = e, this._$AM = t, this._$Ci = n;
	}
	_$AS(e, t) {
		return this.update(e, t);
	}
	update(e, t) {
		return this.render(...t);
	}
}, Y = at(class extends ot {
	constructor(e) {
		if (super(e), e.type !== it.ATTRIBUTE || e.name !== "class" || e.strings?.length > 2) throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.");
	}
	render(e) {
		return " " + Object.keys(e).filter((t) => e[t]).join(" ") + " ";
	}
	update(e, [t]) {
		if (this.st === void 0) {
			this.st = /* @__PURE__ */ new Set(), e.strings !== void 0 && (this.nt = new Set(e.strings.join(" ").split(/\s/).filter((e) => e !== "")));
			for (let e in t) t[e] && !this.nt?.has(e) && this.st.add(e);
			return this.render(t);
		}
		let n = e.element.classList;
		for (let e of this.st) e in t || (n.remove(e), this.st.delete(e));
		for (let e in t) {
			let r = !!t[e];
			r === this.st.has(e) || this.nt?.has(e) || (r ? (n.add(e), this.st.add(e)) : (n.remove(e), this.st.delete(e)));
		}
		return B;
	}
}), X = (e) => e ?? V, st = 500, ct = 8, lt = 300, ut = 30, dt = 1, ft = 6, pt = 22, mt = 4e3, ht = {
	w: 800,
	h: 600
}, gt = /* @__PURE__ */ new Set([
	"light",
	"switch",
	"fan",
	"cover"
]), _t = [
	"climate",
	"cover",
	"lock",
	"light",
	"switch",
	"fan",
	"binary_sensor",
	"sensor",
	"camera"
], vt = /* @__PURE__ */ new Set([...m, "smart-switches"]), yt = /* @__PURE__ */ new Set([
	"sensors",
	"aircon-controllers",
	"curtains-blinds",
	"smart-locks"
]), bt = "translate(0px, 0px) scale(1)", Z = (e) => Math.round(e * 100) / 100, Q = (e, t, n) => Math.min(n, Math.max(t, e)), xt = /* @__PURE__ */ new WeakMap();
function St(e) {
	let t = xt.get(e.scene);
	return t || (t = u(e.scene), xt.set(e.scene, t)), t;
}
function Ct(e, t) {
	return e.type === "entity" ? t.states[e.id] ? [e.id] : [] : f(t, e.id).map((e) => e.entity_id).filter((e) => t.states[e]);
}
function wt(e, t) {
	let n = (e) => {
		let n = t.states[e]?.attributes.device_class === "battery", r = _t.indexOf(d(e));
		return (r === -1 ? _t.length : r) + (n ? 100 : 0);
	};
	return [...e].sort((e, t) => n(e) - n(t))[0];
}
var Tt = class extends J {
	static properties = {
		hass: { attribute: !1 },
		home: { attribute: !1 },
		mode: { type: String },
		_levelId: { state: !0 },
		_planType: { state: !0 },
		_images: { state: !0 },
		_stage: { state: !0 },
		_popup: { state: !0 },
		_notice: { state: !0 }
	};
	_elements = /* @__PURE__ */ new Map();
	_packageKey = "";
	_loading = /* @__PURE__ */ new Set();
	_generation = 0;
	_pointers = /* @__PURE__ */ new Map();
	_press;
	_pinch;
	_lastTap;
	_view = {
		s: 1,
		x: 0,
		y: 0
	};
	_holdTimer;
	_noticeTimer;
	_observer;
	_observed;
	_shownPlans = "";
	constructor() {
		super(), this.mode = "use", this._planType = "smart-home", this._images = /* @__PURE__ */ new Map(), this._stage = ht;
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._dropImages(), this._cancelHold(), clearTimeout(this._noticeTimer), this._observer?.disconnect(), this._observer = void 0, this._observed = void 0, this._pointers.clear(), this._press = void 0, this._pinch = void 0;
	}
	willUpdate(e) {
		if (!e.has("home")) return;
		let t = this.home?.package, n = t ? `${t.project.id}|${t.exportedAt}|${t.savedVersion}` : "";
		n !== this._packageKey && (this._dropImages(), this._packageKey = n), this._elements = new Map((t?.levels ?? []).flatMap((e) => e.plans.flatMap((e) => e.elements.map((e) => [e.id, e]))));
		let r = this._levels();
		r.some((e) => e.id === this._levelId) || (this._levelId = r[0]?.id);
	}
	updated() {
		this._observeStage(), this._loadImages();
		let e = `${this._levelId}|${this._visible().plans.map((e) => e.id).join(",")}`;
		e !== this._shownPlans && (this._shownPlans = e, this._resetView());
	}
	_observeStage() {
		let e = this.renderRoot.querySelector(".stage") ?? void 0;
		e !== this._observed && (this._observer?.disconnect(), this._observed = e, e && typeof ResizeObserver < "u" && (this._observer ??= new ResizeObserver((e) => {
			let t = e[0]?.contentRect;
			t && t.width > 0 && t.height > 0 && (this._stage = {
				w: t.width,
				h: t.height
			});
		}), this._observer.observe(e)));
	}
	_dropImages() {
		this._generation++;
		for (let e of this._images.values()) URL.revokeObjectURL(e);
		this._images = /* @__PURE__ */ new Map(), this._loading.clear();
	}
	_loadImages() {
		let { hass: e, home: t } = this;
		if (e && t?.package) for (let n of this._visible().plans) {
			let r = n.background.imageId, i = t.image_urls[r];
			if (!i || this._images.has(r) || this._loading.has(r)) continue;
			this._loading.add(r);
			let a = this._generation;
			Se(e, i).then((e) => {
				a !== this._generation || !this.isConnected ? URL.revokeObjectURL(e) : this._images = new Map(this._images).set(r, e);
			}, () => void 0);
		}
	}
	_levels() {
		return [...this.home?.package?.levels ?? []].sort((e, t) => e.sortOrder - t.sortOrder);
	}
	_visible() {
		let e = this._levels().find((e) => e.id === this._levelId)?.plans ?? [], t = e[0];
		return !t || e.every((e) => e.background.key === t.background.key) ? {
			plans: e,
			toggle: !1
		} : {
			plans: [e.find((e) => e.type === this._planType) ?? t],
			toggle: !0
		};
	}
	_state(e) {
		let t = this._elements.get(e);
		return !t || !this.hass ? { status: "unlinked" } : le(t, this.home?.links[e], this.hass);
	}
	_local(e) {
		let t = e.currentTarget.getBoundingClientRect();
		return {
			x: e.clientX - t.left,
			y: e.clientY - t.top
		};
	}
	_stageSize() {
		let e = this.renderRoot.querySelector(".stage")?.getBoundingClientRect();
		return e && e.width > 0 && e.height > 0 ? {
			w: e.width,
			h: e.height
		} : this._stage;
	}
	_applyView() {
		let { w: e, h: t } = this._stageSize(), n = this._view;
		n.x = Q(n.x, e * (1 - n.s), 0), n.y = Q(n.y, t * (1 - n.s), 0);
		let r = this.renderRoot.querySelector(".canvas");
		r && (r.style.transform = `translate(${Z(n.x)}px, ${Z(n.y)}px) scale(${Z(n.s)})`);
	}
	_resetView() {
		this._view = {
			s: 1,
			x: 0,
			y: 0
		}, this._applyView();
	}
	_zoomAt(e, t, n, r = this._view) {
		let i = Q(n, dt, ft), a = (e - r.x) / r.s, o = (t - r.y) / r.s;
		this._view = {
			s: i,
			x: e - a * i,
			y: t - o * i
		}, this._applyView();
	}
	_elementIdAt(e) {
		let t = (e.composedPath()[0] ?? e.target)?.closest?.("[data-element-id]")?.getAttribute("data-element-id") ?? void 0;
		return t !== void 0 && this._elements.has(t) ? t : void 0;
	}
	_onDown(e) {
		let t = e.currentTarget, n = this._local(e);
		this._pointers.set(e.pointerId, n);
		try {
			t.setPointerCapture?.(e.pointerId);
		} catch {}
		if (this._pointers.size === 1) {
			let t = this._elementIdAt(e), r = {
				id: e.pointerId,
				elementId: t,
				x: n.x,
				y: n.y,
				moved: !1,
				long: !1
			};
			this._press = r, this._cancelHold(), t && this.mode === "use" && (this._holdTimer = setTimeout(() => this._onHold(r), st));
		} else if (this._pointers.size === 2) {
			this._cancelPress();
			let [e, t] = [...this._pointers.values()];
			this._pinch = {
				dist: Math.max(Math.hypot(e.x - t.x, e.y - t.y), 1),
				scale: this._view.s,
				x: this._view.x,
				y: this._view.y,
				mid: {
					x: (e.x + t.x) / 2,
					y: (e.y + t.y) / 2
				}
			};
		}
	}
	_onMove(e) {
		let t = this._pointers.get(e.pointerId);
		if (!t) return;
		let n = this._local(e);
		this._pointers.set(e.pointerId, n);
		let r = this._pinch;
		if (r && this._pointers.size >= 2) {
			let [e, t] = [...this._pointers.values()], n = {
				x: (e.x + t.x) / 2,
				y: (e.y + t.y) / 2
			}, i = {
				s: r.scale,
				x: r.x,
				y: r.y
			};
			this._zoomAt(r.mid.x, r.mid.y, r.scale * Math.hypot(e.x - t.x, e.y - t.y) / r.dist, i), this._view.x += n.x - r.mid.x, this._view.y += n.y - r.mid.y, this._applyView();
			return;
		}
		let i = this._press;
		if (i && i.id === e.pointerId && !i.moved) {
			if (Math.hypot(n.x - i.x, n.y - i.y) <= ct) return;
			i.moved = !0, this._cancelHold();
		}
		(!i || i.moved) && (this._view.x += n.x - t.x, this._view.y += n.y - t.y, this._applyView());
	}
	_onUp(e) {
		this._pointers.delete(e.pointerId), this._pointers.size < 2 && (this._pinch = void 0);
		let t = this._press;
		t && t.id === e.pointerId && (this._press = void 0, this._cancelHold(), e.type === "pointerup" && !t.moved && !t.long && this._onTap(t));
	}
	_onWheel(e) {
		e.preventDefault();
		let t = this._local(e), n = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
		this._zoomAt(t.x, t.y, this._view.s * Math.exp(-n * .0015));
	}
	_cancelHold() {
		clearTimeout(this._holdTimer), this._holdTimer = void 0;
	}
	_cancelPress() {
		this._cancelHold(), this._press = void 0;
	}
	_onTap(e) {
		if (e.elementId) this.mode === "link" ? this.dispatchEvent(new CustomEvent("maxsen-element-tap", {
			detail: { elementId: e.elementId },
			bubbles: !0,
			composed: !0
		})) : this._operate(e.elementId);
		else {
			let t = Date.now(), n = this._lastTap;
			n && t - n.t < lt && Math.hypot(e.x - n.x, e.y - n.y) < ut ? (this._lastTap = void 0, this._resetView()) : this._lastTap = {
				t,
				x: e.x,
				y: e.y
			};
		}
	}
	_onHold(e) {
		e.long = !0, this._holdTimer = void 0;
		let { hass: t, home: n } = this, r = e.elementId;
		if (!t || !n || !r) return;
		let i = this._state(r).status, a = n.links[r];
		if (!a || i === "unlinked" || i === "missing") return;
		let o = wt(Ct(a, t), t);
		o && this._moreInfo(o);
	}
	_moreInfo(e) {
		this.dispatchEvent(new CustomEvent("hass-more-info", {
			detail: { entityId: e },
			bubbles: !0,
			composed: !0
		}));
	}
	_operate(e) {
		let { hass: t, home: n } = this, r = n?.links[e], i = this._state(e).status;
		if (!t || !r || i === "unlinked" || i === "missing" || i === "unavailable") return;
		let a = Ct(r, t), o = a.filter((e) => gt.has(d(e)));
		if (o.length === 0) {
			let e = wt(a, t);
			e && this._moreInfo(e);
		} else if (r.type === "device" && o.length > 1) {
			let n = this._elements.get(e), i = t.devices[r.id];
			this._popup = {
				title: n?.label || i?.name_by_user || i?.name || n?.productName || "",
				entityIds: o
			};
		} else this._toggle(o);
	}
	async _toggle(e) {
		let t = this.hass;
		if (!t) return;
		let n = e.filter((e) => d(e) === "cover"), r = n.filter((e) => t.states[e]?.state === "closed"), i = n.filter((e) => !r.includes(e)), a = [
			[
				"homeassistant",
				"toggle",
				e.filter((e) => d(e) !== "cover")
			],
			[
				"cover",
				"open_cover",
				r
			],
			[
				"cover",
				"close_cover",
				i
			]
		];
		for (let [e, n, r] of a) if (r.length !== 0) try {
			await t.callService(e, n, { entity_id: r });
		} catch {
			this._showNotice("Could not reach that device.");
		}
	}
	_showNotice(e) {
		this._notice = e, clearTimeout(this._noticeTimer), this._noticeTimer = setTimeout(() => this._notice = void 0, mt);
	}
	_renderNode(e) {
		let t = e.attrs;
		switch (e.tag) {
			case "g": return z`<g>${(e.children ?? []).map((e) => this._renderNode(e))}</g>`;
			case "path": return z`<path
          d=${X(t.d)}
          transform=${X(t.transform)}
          fill=${X(t.fill)}
          fill-rule=${X(t["fill-rule"])}
          stroke=${X(t.stroke)}
          stroke-width=${X(t["stroke-width"])}
          stroke-linecap=${X(t["stroke-linecap"])}
          stroke-linejoin=${X(t["stroke-linejoin"])}
          stroke-dasharray=${X(t["stroke-dasharray"])}
          opacity=${X(t.opacity)}
        />`;
			case "text": return z`<text
          x=${X(t.x)}
          y=${X(t.y)}
          font-size=${X(t["font-size"])}
          font-weight=${X(t["font-weight"])}
          text-anchor=${X(t["text-anchor"])}
          dominant-baseline=${X(t["dominant-baseline"])}
          fill=${X(t.fill)}
          transform=${X(t.transform)}
          stroke=${X(t.stroke)}
          stroke-width=${X(t["stroke-width"])}
          stroke-linejoin=${X(t["stroke-linejoin"])}
          paint-order=${X(t["paint-order"])}
        >${e.text ?? ""}</text>`;
		}
	}
	_renderPill(e, t, n) {
		let r = t.length * 14 * .58 + 16.8, i = 23.8, a, o;
		if (e.type === "marker") a = e.x + e.size / 2 + 6, a + r > n && (a = e.x - e.size / 2 - 6 - r), o = e.y;
		else if (e.type === "path") {
			let t = e.points[0], n = e.points[e.points.length - 1];
			a = ((t?.x ?? 0) + (n?.x ?? 0)) / 2 - r / 2, o = ((t?.y ?? 0) + (n?.y ?? 0)) / 2 - i;
		} else return z``;
		return z`<g class="pill" transform="translate(${Z(a)} ${Z(o)})">
      <rect y=${-23.8 / 2} width=${r} height=${i} rx=${i / 2} />
      <text x=${r / 2} y="0" font-size=${14} text-anchor="middle" dominant-baseline="central">${t}</text>
    </g>`;
	}
	_renderItem(e, t, n, r) {
		let i = e.elementId, a = (t.children ?? []).map((e) => this._renderNode(e));
		if (e.type === "note" || !this._elements.has(i)) return z`<g class="static" data-element-id=${i}>${a}</g>`;
		let o = this._state(i), s = o.status === "on" && vt.has(e.categoryId) ? e.type === "path" ? "url(#maxsen-glow-path)" : "url(#maxsen-glow)" : void 0, c = o.text && yt.has(e.categoryId) ? this._renderPill(e, o.text, n.width) : V;
		return z`<g
      class=${Y({
			element: !0,
			[e.type]: !0,
			[o.status]: !0
		})}
      data-element-id=${i}
    >
      ${e.type === "marker" ? z`<circle class="hit" cx=${e.x} cy=${e.y} r=${Z(r)} fill="transparent" />` : V}
      ${o.status === "alert" && e.type === "marker" ? z`<circle class="alert-ring" cx=${e.x} cy=${e.y} r=${Math.max(e.size * .9, 18)} />` : V}
      <g class="glyph" filter=${X(s)}>${a}</g>
      ${c}
    </g>`;
	}
	_renderDrawing(e) {
		let t = e[0], n = this._images.get(t.background.imageId), r = pt / Math.min(this._stage.w / t.width, this._stage.h / t.height);
		return R`
      <svg viewBox="0 0 ${t.width} ${t.height}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="maxsen-glow" x="-300%" y="-300%" width="700%" height="700%" color-interpolation-filters="sRGB">
            <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ffb22e" flood-opacity="0.95" result="near" />
            <feDropShadow in="near" dx="0" dy="0" stdDeviation="16" flood-color="#ffb22e" flood-opacity="0.7" />
          </filter>
          <!-- A straight line has no area, so this one is sized in plan units, not by the shape. -->
          <filter id="maxsen-glow-path" filterUnits="userSpaceOnUse" x="0" y="0" width=${t.width} height=${t.height} color-interpolation-filters="sRGB">
            <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ffb22e" flood-opacity="0.95" result="near" />
            <feDropShadow in="near" dx="0" dy="0" stdDeviation="16" flood-color="#ffb22e" flood-opacity="0.7" />
          </filter>
        </defs>
        <rect width=${t.width} height=${t.height} fill="#fff" />
        ${n ? z`<image href=${n} width=${t.width} height=${t.height} preserveAspectRatio="none" />` : V}
        ${e.map((e) => {
			let t = St(e);
			return z`<g class="plan">${e.scene.items.map((n, i) => this._renderItem(n, t[i], e, r))}</g>`;
		})}
      </svg>
    `;
	}
	_renderPopup() {
		let e = this._popup, t = this.hass;
		if (!e || !t) return V;
		let n = () => this._popup = void 0;
		return R`
      <div class="popup-layer">
        <div class="popup-backdrop" @click=${n}></div>
        <div class="popup" role="dialog" aria-label=${e.title}>
          <div class="popup-title">
            <span>${e.title}</span>
            <button class="close" aria-label="Close" @click=${n}>&times;</button>
          </div>
          ${e.entityIds.map((e) => {
			let r = t.states[e], i = typeof r?.attributes.friendly_name == "string" ? r.attributes.friendly_name : e, a = r?.state === "on" || d(e) === "cover" && r?.state !== "closed";
			return R`<div class="row">
              <button class="name" @click=${() => {
				n(), this._moreInfo(e);
			}}>${i}</button>
              <span class="state">${r?.state ?? ""}</span>
              <button
                class=${Y({
				switch: !0,
				checked: a
			})}
                role="switch"
                aria-checked=${a ? "true" : "false"}
                aria-label=${`Toggle ${i}`}
                @click=${() => void this._toggle([e])}
              ><span class="knob"></span></button>
            </div>`;
		})}
        </div>
      </div>
    `;
	}
	render() {
		let e = this.home?.package;
		if (!e || e.levels.length === 0) return R`<div class="empty">No home loaded yet. An installer adds it from the Maxsen Planner.</div>`;
		let t = this._levels(), { plans: n, toggle: r } = this._visible();
		return R`
      <div class="bar">
        <div class="tabs" role="tablist">
          ${t.map((e) => R`<button
              role="tab"
              aria-selected=${e.id === this._levelId ? "true" : "false"}
              class=${Y({ active: e.id === this._levelId })}
              @click=${() => this._levelId = e.id}
            >${e.name}</button>`)}
        </div>
        ${r ? R`<div class="plan-toggle" role="group">
              ${["smart-home", "lighting"].map((e) => R`<button
                  class=${Y({ active: n[0]?.type === e })}
                  aria-pressed=${n[0]?.type === e ? "true" : "false"}
                  @click=${() => this._planType = e}
                >${e === "smart-home" ? "Smart Home" : "Lighting"}</button>`)}
            </div>` : V}
      </div>
      <div
        class="stage"
        @pointerdown=${this._onDown}
        @pointermove=${this._onMove}
        @pointerup=${this._onUp}
        @pointercancel=${this._onUp}
        @wheel=${this._onWheel}
        @contextmenu=${(e) => e.preventDefault()}
      >
        <div class="canvas" style=${`transform: ${bt}`}>
          ${n.length > 0 ? this._renderDrawing(n) : R`<div class="empty">This level has no plan.</div>`}
        </div>
      </div>
      ${this._renderPopup()}
      ${this._notice ? R`<div class="notice" role="status">${this._notice}</div>` : V}
    `;
	}
	static styles = x`
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      color: var(--primary-text-color, #1f1d1a);
      background: var(--secondary-background-color, #f4f5f7);
      font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    }
    .empty {
      margin: auto;
      padding: 32px 24px;
      max-width: 420px;
      text-align: center;
      font-size: 17px;
      line-height: 1.5;
      color: var(--secondary-text-color, #5b6168);
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 16px;
      padding: 10px 16px;
      background: var(--card-background-color, #fff);
      border-bottom: 1px solid var(--divider-color, #e3e6ea);
    }
    .tabs,
    .plan-toggle {
      display: flex;
      gap: 6px;
      overflow-x: auto;
    }
    .plan-toggle {
      padding: 3px;
      border-radius: 24px;
      background: var(--secondary-background-color, #f4f5f7);
    }
    .bar button {
      min-height: 44px;
      padding: 0 20px;
      border: 0;
      border-radius: 22px;
      background: transparent;
      color: var(--primary-text-color, #1f1d1a);
      font: inherit;
      font-size: 16px;
      white-space: nowrap;
      cursor: pointer;
    }
    .bar button.active {
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
      font-weight: 600;
    }
    .stage {
      position: relative;
      flex: 1 1 auto;
      min-height: 240px;
      overflow: hidden;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      background: var(--card-background-color, #fff);
    }
    .canvas {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .element {
      cursor: pointer;
    }
    .element.unlinked,
    .element.missing,
    .element.unavailable {
      opacity: 0.35;
    }
    .element.unlinked,
    .element.missing {
      cursor: default;
    }
    .static {
      pointer-events: none;
    }
    .alert-ring {
      fill: none;
      stroke: #e5322d;
      stroke-width: 4;
      pointer-events: none;
      transform-box: fill-box;
      transform-origin: center;
      animation: maxsen-pulse 1.6s ease-out infinite;
    }
    @keyframes maxsen-pulse {
      from {
        transform: scale(0.7);
        opacity: 0.95;
      }
      to {
        transform: scale(1.6);
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .alert-ring {
        animation: none;
      }
    }
    .pill {
      pointer-events: none;
    }
    .pill rect {
      fill: var(--card-background-color, #fff);
      stroke: var(--divider-color, #cfd3d9);
      stroke-width: 1;
      opacity: 0.95;
    }
    .pill text {
      fill: var(--primary-text-color, #1f1d1a);
      font-weight: 600;
    }
    .popup-layer {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .popup-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
    }
    .popup {
      position: relative;
      width: min(360px, calc(100% - 32px));
      max-height: calc(100% - 32px);
      overflow-y: auto;
      padding: 8px 16px 16px;
      border-radius: 16px;
      background: var(--card-background-color, #fff);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    }
    .popup-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 52px;
      font-size: 18px;
      font-weight: 600;
    }
    .popup button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    .popup .close {
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 22px;
      background: transparent;
      font-size: 28px;
      line-height: 1;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 56px;
      border-top: 1px solid var(--divider-color, #e3e6ea);
    }
    .row .name {
      flex: 1;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      font-size: 16px;
      text-align: left;
    }
    .row .state {
      color: var(--secondary-text-color, #5b6168);
      font-size: 14px;
      text-transform: capitalize;
    }
    .switch {
      position: relative;
      flex: none;
      width: 52px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 16px;
      background: var(--disabled-color, #c4c8ce);
      transition: background 0.15s;
    }
    .switch.checked {
      background: var(--primary-color, #2f6fed);
    }
    .switch .knob {
      position: absolute;
      top: 4px;
      left: 4px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.15s;
    }
    .switch.checked .knob {
      transform: translateX(20px);
    }
    .notice {
      position: absolute;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%);
      padding: 10px 18px;
      border-radius: 22px;
      background: #2b2d31;
      color: #fff;
      font-size: 15px;
    }
  `;
};
customElements.get("maxsen-floorplan-view") || customElements.define("maxsen-floorplan-view", Tt);
// src/maxsen-home-panel.ts
var Et = 900;
function Dt(e, t) {
	return e >= Et && e > t ? "side" : "stacked";
}
var Ot = class extends J {
	static properties = {
		hass: { attribute: !1 },
		narrow: { type: Boolean },
		panel: { attribute: !1 },
		embedded: { type: Boolean },
		_home: { state: !0 },
		_status: { state: !0 },
		_layout: { state: !0 }
	};
	_entryId;
	_started = !1;
	_run = 0;
	_unsubscribe;
	_observer;
	constructor() {
		super(), this.narrow = !1, this.embedded = !1, this._status = "loading", this._layout = "stacked";
	}
	connectedCallback() {
		super.connectedCallback(), typeof ResizeObserver < "u" && (this._observer = new ResizeObserver((e) => {
			let t = e[0]?.contentRect;
			t && (this._layout = Dt(t.width, t.height));
		}), this._observer.observe(this));
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._observer?.disconnect(), this._observer = void 0, this._stop();
	}
	updated(e) {
		this.hass && (this._started && e.has("panel") && this.panel?.config?.entry_id !== this._entryId && this._stop(), this._started || this._start());
	}
	_stop() {
		this._run++, this._started = !1, this._unsubscribe?.(), this._unsubscribe = void 0;
	}
	async _start() {
		let e = this.hass;
		if (!e) return;
		this._started = !0;
		let t = this._run;
		this._status = "loading";
		try {
			let n = this.panel?.config?.entry_id ?? await he(e);
			if (t !== this._run) return;
			if (this._entryId = n, !n) {
				this._status = "none";
				return;
			}
			let r = await h(e, n);
			if (t !== this._run) return;
			this._home = r, this._status = "ready";
			let i = await ge(e, n, () => void this._reload(t));
			t === this._run ? this._unsubscribe = i : i();
		} catch {
			t === this._run && (this._status = "error");
		}
	}
	async _reload(e) {
		let t = this.hass;
		if (t && this._entryId) try {
			let n = await h(t, this._entryId);
			e === this._run && (this._home = n);
		} catch {}
	}
	_retry() {
		this._stop(), this._start();
	}
	_renderBody() {
		switch (this._status) {
			case "loading": return R`<div class="message">Loading…</div>`;
			case "none": return R`<div class="message">
          Maxsen Home is not set up yet. Add it under Settings, Devices &amp; services.
        </div>`;
			case "error": return R`<div class="message">
          Could not load the home.
          <button class="retry" @click=${this._retry}>Try again</button>
        </div>`;
			case "ready": return R`
          <div class="body ${this._layout}">
            <maxsen-floorplan-view class="view" .hass=${this.hass} .home=${this._home} mode="use"></maxsen-floorplan-view>
            <div class="quick-panel-slot"></div>
          </div>
        `;
		}
	}
	render() {
		return R`${this.embedded || !this.panel ? V : R`<div class="header">
            ${this.narrow ? R`<ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>` : V}
            <div class="title">${this._home?.package?.project.title ?? "Home"}</div>
          </div>`}${this._renderBody()}`;
	}
	static styles = x`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--secondary-background-color, #f4f5f7);
      color: var(--primary-text-color, #1f1d1a);
      font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    }
    .header {
      display: flex;
      align-items: center;
      flex: none;
      height: var(--header-height, 56px);
      padding: 0 12px;
      background: var(--app-header-background-color, var(--primary-color, #2f6fed));
      color: var(--app-header-text-color, var(--text-primary-color, #fff));
    }
    .title {
      margin-left: 8px;
      font-size: 20px;
      font-weight: 500;
    }
    .body {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
    }
    .body.stacked {
      flex-direction: column;
    }
    .body.side {
      flex-direction: row;
    }
    .view {
      /* The view sizes itself to its parent elsewhere; here the panel decides. */
      flex: 1 1 0;
      height: auto;
      min-width: 0;
      min-height: 0;
    }
    .quick-panel-slot {
      flex: none;
      overflow: auto;
    }
    .quick-panel-slot:empty {
      display: none;
    }
    .side .quick-panel-slot {
      width: 340px;
      border-left: 1px solid var(--divider-color, #e3e6ea);
    }
    .stacked .quick-panel-slot {
      max-height: 40%;
      border-top: 1px solid var(--divider-color, #e3e6ea);
    }
    .message {
      margin: auto;
      padding: 32px 24px;
      max-width: 420px;
      text-align: center;
      font-size: 17px;
      line-height: 1.6;
      color: var(--secondary-text-color, #5b6168);
    }
    .retry {
      display: block;
      min-height: 44px;
      margin: 16px auto 0;
      padding: 0 24px;
      border: 0;
      border-radius: 22px;
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
      font: inherit;
      cursor: pointer;
    }
  `;
};
customElements.get("maxsen-home-panel") || customElements.define("maxsen-home-panel", Ot);
// src/maxsen-floorplan-card.ts
var $ = class extends J {
	static properties = {
		hass: { attribute: !1 },
		_panel: { state: !0 }
	};
	constructor() {
		super(), this._panel = { config: {} };
	}
	setConfig(e) {
		if (e.entry_id !== void 0 && typeof e.entry_id != "string") throw Error("entry_id must be text");
		this._panel = { config: e.entry_id === void 0 ? {} : { entry_id: e.entry_id } };
	}
	getCardSize() {
		return 8;
	}
	static getStubConfig() {
		return {};
	}
	render() {
		return R`<maxsen-home-panel embedded .hass=${this.hass} .panel=${this._panel}></maxsen-home-panel>`;
	}
	static styles = x`
    :host {
      display: block;
      height: min(560px, 80vh);
      overflow: hidden;
      border-radius: var(--ha-card-border-radius, 12px);
      background: var(--ha-card-background, var(--card-background-color, #fff));
      box-shadow: var(--ha-card-box-shadow, none);
      border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e3e6ea));
    }
  `;
};
customElements.get("maxsen-floorplan-card") || customElements.define("maxsen-floorplan-card", $), window.customCards = window.customCards ?? [], window.customCards.some((e) => e.type === "maxsen-floorplan-card") || window.customCards.push({
	type: "maxsen-floorplan-card",
	name: "Maxsen floor plan",
	description: "The floor plans of your Maxsen home, with live device state.",
	preview: !1
});
export { m as LIGHTING_CATEGORIES, $ as MaxsenFloorplanCard, Tt as MaxsenFloorplanView, Ot as MaxsenHomePanel, xe as createStarterScenes, he as findEntryId, h as getHome, Dt as layoutFor, me as linkCandidates, Se as loadImage, be as refreshApply, ye as refreshPreview, u as sceneToSvg, _e as setLinks, ve as setQuickPanel, ge as subscribe, le as visualState };
