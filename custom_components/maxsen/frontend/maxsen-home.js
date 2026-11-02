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
function f(e) {
	return !e.entity_category && !e.hidden;
}
function p(e, t) {
	return Object.values(e.entities).filter((e) => e.device_id === t && f(e));
}
function m(e, t = "Something went wrong. Try again.") {
	if (typeof e == "object" && e && "message" in e) {
		let { message: t } = e;
		if (typeof t == "string" && t) return t;
	}
	return t;
}
function ee(e, t) {
	if (e.type === "entity") {
		let n = t.states[e.id];
		if (!n) return;
		let r = n.attributes.friendly_name;
		return typeof r == "string" && r || t.entities[e.id]?.name || e.id;
	}
	let n = t.devices[e.id];
	return n ? n.name_by_user || n.name || e.id : void 0;
}
function h(e) {
	try {
		Promise.resolve(e?.()).catch(() => void 0);
	} catch {}
}
// src/visual-state.ts
var te = /* @__PURE__ */ new Set([
	"light",
	"switch",
	"cover",
	"climate",
	"binary_sensor",
	"sensor",
	"fan",
	"lock",
	"camera"
]), ne = /* @__PURE__ */ new Set([
	"door",
	"window",
	"motion",
	"occupancy",
	"smoke",
	"moisture",
	"gas"
]), re = (e) => e === "unavailable" || e === "unknown", ie = (e) => e.charAt(0).toUpperCase() + e.slice(1);
function ae(e, t) {
	return {
		entityId: e,
		domain: d(e),
		state: t.state,
		attributes: t.attributes
	};
}
function oe(e, t) {
	if (e.type === "entity") {
		let n = t.states[e.id];
		return n ? [ae(e.id, n)] : void 0;
	}
	if (!t.devices[e.id]) return;
	let n = [];
	for (let r of p(t, e.id)) {
		let e = t.states[r.entity_id];
		e && te.has(d(r.entity_id)) && n.push(ae(r.entity_id, e));
	}
	return n;
}
function se(e) {
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
function ce(e) {
	let t = e.attributes.current_temperature, n = typeof t == "number" ? `${e.state} · ${t}°` : e.state;
	return {
		status: e.state === "off" ? "off" : "on",
		text: n
	};
}
function le(e) {
	let t = ie(e.state);
	return e.state === "locked" ? {
		status: "off",
		text: t
	} : {
		status: e.state === "jammed" ? "alert" : "on",
		text: t
	};
}
function ue(e) {
	let t = e.attributes.unit_of_measurement;
	return {
		status: "idle",
		text: typeof t == "string" && t ? `${e.state} ${t}` : e.state
	};
}
function g(e, t, n) {
	if (!t) return { status: "unlinked" };
	let r = oe(t, n);
	if (!r) return { status: "missing" };
	if (r.length === 0) return { status: "idle" };
	let i = r.filter((e) => !re(e.state));
	if (i.length === 0) return { status: "unavailable" };
	let a = (e) => i.find((t) => t.domain === e), o = (...e) => i.filter((t) => e.includes(t.domain)), s = a("climate");
	if (s) return ce(s);
	let c = a("cover");
	if (c) return se(c);
	let l = a("lock");
	if (l) return le(l);
	let u = o("binary_sensor");
	if (u.find((e) => e.state === "on" && ne.has(String(e.attributes.device_class)))) return { status: "alert" };
	let d = o("light", "switch", "fan");
	if (d.length > 0) return { status: d.some((e) => e.state === "on") ? "on" : "off" };
	let f = o("sensor"), p = f.find((e) => e.attributes.device_class !== "battery") ?? f[0];
	return p ? ue(p) : u.length > 0 ? { status: u.some((e) => e.state === "on") ? "on" : "idle" } : {
		status: "idle",
		text: i[0]?.state
	};
}
// src/link-candidates.ts
var _ = /* @__PURE__ */ new Set([
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
function de(e) {
	return e === "ceiling-fans" ? [
		"light",
		"switch",
		"fan"
	] : ["light", "switch"];
}
function fe(e) {
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
function pe(e, t) {
	let n = /* @__PURE__ */ new Set([...Object.keys(t.entities), ...Object.keys(t.states)]), r = [];
	for (let i of n) {
		if (!e.includes(d(i))) continue;
		let n = t.entities[i];
		if (n && !f(n)) continue;
		let a = t.states[i]?.attributes.friendly_name, o = n?.area_id ?? (n?.device_id ? t.devices[n.device_id]?.area_id : null);
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
function me(e, t) {
	return Object.values(t.devices).filter((n) => e === void 0 || p(t, n.id).some((t) => e.includes(d(t.entity_id)))).map((e) => ({
		link: {
			type: "device",
			id: e.id
		},
		name: e.name_by_user || e.name || e.id,
		area: e.area_id && t.areas[e.area_id]?.name || ""
	}));
}
function he(e, t) {
	return (_.has(e.categoryId) ? pe(de(e.categoryId), t) : me(fe(e.categoryId), t)).sort((e, t) => Number(e.area === "") - Number(t.area === "") || e.area.localeCompare(t.area) || e.name.localeCompare(t.name));
}
// src/api.ts
async function ge(e) {
	let t = await e.callWS({
		type: "config_entries/get",
		domain: "maxsen"
	}), n = t.find((e) => e.state === "loaded") ?? t[0];
	return n && {
		entryId: n.entry_id,
		state: n.state
	};
}
function _e(e, t) {
	return e.callWS({
		type: "maxsen/home",
		entry_id: t
	});
}
function ve(e, t, n) {
	return e.connection.subscribeMessage((e) => n(e.event), {
		type: "maxsen/subscribe",
		entry_id: t
	}, { resubscribe: !1 });
}
function v(e, t, n, r = {}) {
	return e.callWS({
		type: "maxsen/links/set",
		entry_id: t,
		updates: n,
		...r.nameDevice ? { name_device: !0 } : {}
	});
}
function ye(e, t, n, r) {
	return e.connection.subscribeMessage(r, {
		type: "maxsen/identify/subscribe",
		entry_id: t,
		mode: n.mode,
		kinds: n.kinds,
		...n.gangs ? { gangs: n.gangs } : {},
		include_other: n.includeOther ?? !1
	}, { resubscribe: !1 });
}
function be(e, t, n) {
	return e.callWS({
		type: "maxsen/quick_panel/set",
		entry_id: t,
		items: n
	});
}
function xe(e, t, n) {
	return e.callWS({
		type: "maxsen/display/set",
		entry_id: t,
		background: n
	});
}
function Se(e, t, n) {
	return e.callWS({
		type: "maxsen/refresh/preview",
		entry_id: t,
		...n === void 0 ? {} : { file_id: n }
	});
}
function Ce(e, t, n) {
	return e.callWS({
		type: "maxsen/refresh/apply",
		entry_id: t,
		preview_id: n
	});
}
function we(e, t) {
	return e.callWS({
		type: "maxsen/scenes/create_starter",
		entry_id: t
	});
}
async function Te(e, t) {
	let n = await e.fetchWithAuth(t);
	if (!n.ok) throw Error(`Image ${t} answered ${n.status}`);
	return URL.createObjectURL(await n.blob());
}
async function Ee(e, t) {
	let n = new FormData();
	n.append("file", t);
	let r = await e.fetchWithAuth("/api/file_upload", {
		method: "POST",
		body: n
	});
	if (!r.ok) throw Error(`Upload answered ${r.status}`);
	let { file_id: i } = await r.json();
	if (typeof i != "string" || !i) throw Error("Upload gave no file id");
	return i;
}
// node_modules/@lit/reactive-element/css-tag.js
var y = globalThis, De = y.ShadowRoot && (y.ShadyCSS === void 0 || y.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype, b = Symbol(), Oe = /* @__PURE__ */ new WeakMap(), ke = class {
	constructor(e, t, n) {
		if (this._$cssResult$ = !0, n !== b) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
		this.cssText = e, this.t = t;
	}
	get styleSheet() {
		let e = this.o, t = this.t;
		if (De && e === void 0) {
			let n = t !== void 0 && t.length === 1;
			n && (e = Oe.get(t)), e === void 0 && ((this.o = e = new CSSStyleSheet()).replaceSync(this.cssText), n && Oe.set(t, e));
		}
		return e;
	}
	toString() {
		return this.cssText;
	}
}, Ae = (e) => new ke(typeof e == "string" ? e : e + "", void 0, b), x = (e, ...t) => new ke(e.length === 1 ? e[0] : t.reduce((t, n, r) => t + ((e) => {
	if (!0 === e._$cssResult$) return e.cssText;
	if (typeof e == "number") return e;
	throw Error("Value passed to 'css' function must be a 'css' function result: " + e + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
})(n) + e[r + 1], e[0]), e, b), je = (e, t) => {
	if (De) e.adoptedStyleSheets = t.map((e) => e instanceof CSSStyleSheet ? e : e.styleSheet);
	else for (let n of t) {
		let t = document.createElement("style"), r = y.litNonce;
		r !== void 0 && t.setAttribute("nonce", r), t.textContent = n.cssText, e.appendChild(t);
	}
}, Me = De ? (e) => e : (e) => e instanceof CSSStyleSheet ? ((e) => {
	let t = "";
	for (let n of e.cssRules) t += n.cssText;
	return Ae(t);
})(e) : e, { is: Ne, defineProperty: Pe, getOwnPropertyDescriptor: Fe, getOwnPropertyNames: Ie, getOwnPropertySymbols: Le, getPrototypeOf: Re } = Object, S = globalThis, ze = S.trustedTypes, Be = ze ? ze.emptyScript : "", Ve = S.reactiveElementPolyfillSupport, C = (e, t) => e, He = {
	toAttribute(e, t) {
		switch (t) {
			case Boolean:
				e = e ? Be : null;
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
}, Ue = (e, t) => !Ne(e, t), We = {
	attribute: !0,
	type: String,
	converter: He,
	reflect: !1,
	useDefault: !1,
	hasChanged: Ue
};
Symbol.metadata ??= Symbol("metadata"), S.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var w = class extends HTMLElement {
	static addInitializer(e) {
		this._$Ei(), (this.l ??= []).push(e);
	}
	static get observedAttributes() {
		return this.finalize(), this._$Eh && [...this._$Eh.keys()];
	}
	static createProperty(e, t = We) {
		if (t.state && (t.attribute = !1), this._$Ei(), this.prototype.hasOwnProperty(e) && ((t = Object.create(t)).wrapped = !0), this.elementProperties.set(e, t), !t.noAccessor) {
			let n = Symbol(), r = this.getPropertyDescriptor(e, n, t);
			r !== void 0 && Pe(this.prototype, e, r);
		}
	}
	static getPropertyDescriptor(e, t, n) {
		let { get: r, set: i } = Fe(this.prototype, e) ?? {
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
		return this.elementProperties.get(e) ?? We;
	}
	static _$Ei() {
		if (this.hasOwnProperty(C("elementProperties"))) return;
		let e = Re(this);
		e.finalize(), e.l !== void 0 && (this.l = [...e.l]), this.elementProperties = new Map(e.elementProperties);
	}
	static finalize() {
		if (this.hasOwnProperty(C("finalized"))) return;
		if (this.finalized = !0, this._$Ei(), this.hasOwnProperty(C("properties"))) {
			let e = this.properties, t = [...Ie(e), ...Le(e)];
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
			for (let e of n) t.unshift(Me(e));
		} else e !== void 0 && t.push(Me(e));
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
		return je(e, this.constructor.elementStyles), e;
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
			let i = (n.converter?.toAttribute === void 0 ? He : n.converter).toAttribute(t, n.type);
			this._$Em = e, i == null ? this.removeAttribute(r) : this.setAttribute(r, i), this._$Em = null;
		}
	}
	_$AK(e, t) {
		let n = this.constructor, r = n._$Eh.get(e);
		if (r !== void 0 && this._$Em !== r) {
			let e = n.getPropertyOptions(r), i = typeof e.converter == "function" ? { fromAttribute: e.converter } : e.converter?.fromAttribute === void 0 ? He : e.converter;
			this._$Em = r;
			let a = i.fromAttribute(t, e.type);
			this[r] = a ?? this._$Ej?.get(r) ?? a, this._$Em = null;
		}
	}
	requestUpdate(e, t, n, r = !1, i) {
		if (e !== void 0) {
			let a = this.constructor;
			if (!1 === r && (i = this[e]), n ??= a.getPropertyOptions(e), !((n.hasChanged ?? Ue)(i, t) || n.useDefault && n.reflect && i === this._$Ej?.get(e) && !this.hasAttribute(a._$Eu(e, n)))) return;
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
w.elementStyles = [], w.shadowRootOptions = { mode: "open" }, w[C("elementProperties")] = /* @__PURE__ */ new Map(), w[C("finalized")] = /* @__PURE__ */ new Map(), Ve?.({ ReactiveElement: w }), (S.reactiveElementVersions ??= []).push("2.1.2");
// node_modules/lit-html/lit-html.js
var Ge = globalThis, Ke = (e) => e, T = Ge.trustedTypes, qe = T ? T.createPolicy("lit-html", { createHTML: (e) => e }) : void 0, Je = "$lit$", E = `lit$${Math.random().toFixed(9).slice(2)}$`, Ye = "?" + E, Xe = `<${Ye}>`, D = document, O = () => D.createComment(""), k = (e) => e === null || typeof e != "object" && typeof e != "function", A = Array.isArray, Ze = (e) => A(e) || typeof e?.[Symbol.iterator] == "function", Qe = "[ 	\n\f\r]", j = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g, $e = /-->/g, et = />/g, M = RegExp(`>|${Qe}(?:([^\\s"'>=/]+)(${Qe}*=${Qe}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`, "g"), tt = /'/g, nt = /"/g, rt = /^(?:script|style|textarea|title)$/i, it = (e) => (t, ...n) => ({
	_$litType$: e,
	strings: t,
	values: n
}), N = it(1), P = it(2), F = Symbol.for("lit-noChange"), I = Symbol.for("lit-nothing"), at = /* @__PURE__ */ new WeakMap(), L = D.createTreeWalker(D, 129);
function ot(e, t) {
	if (!A(e) || !e.hasOwnProperty("raw")) throw Error("invalid template strings array");
	return qe === void 0 ? t : qe.createHTML(t);
}
var st = (e, t) => {
	let n = e.length - 1, r = [], i, a = t === 2 ? "<svg>" : t === 3 ? "<math>" : "", o = j;
	for (let t = 0; t < n; t++) {
		let n = e[t], s, c, l = -1, u = 0;
		for (; u < n.length && (o.lastIndex = u, c = o.exec(n), c !== null);) u = o.lastIndex, o === j ? c[1] === "!--" ? o = $e : c[1] === void 0 ? c[2] === void 0 ? c[3] !== void 0 && (o = M) : (rt.test(c[2]) && (i = RegExp("</" + c[2], "g")), o = M) : o = et : o === M ? c[0] === ">" ? (o = i ?? j, l = -1) : c[1] === void 0 ? l = -2 : (l = o.lastIndex - c[2].length, s = c[1], o = c[3] === void 0 ? M : c[3] === "\"" ? nt : tt) : o === nt || o === tt ? o = M : o === $e || o === et ? o = j : (o = M, i = void 0);
		let d = o === M && e[t + 1].startsWith("/>") ? " " : "";
		a += o === j ? n + Xe : l >= 0 ? (r.push(s), n.slice(0, l) + Je + n.slice(l) + E + d) : n + E + (l === -2 ? t : d);
	}
	return [ot(e, a + (e[n] || "<?>") + (t === 2 ? "</svg>" : t === 3 ? "</math>" : "")), r];
}, ct = class e {
	constructor({ strings: t, _$litType$: n }, r) {
		let i;
		this.parts = [];
		let a = 0, o = 0, s = t.length - 1, c = this.parts, [l, u] = st(t, n);
		if (this.el = e.createElement(l, r), L.currentNode = this.el.content, n === 2 || n === 3) {
			let e = this.el.content.firstChild;
			e.replaceWith(...e.childNodes);
		}
		for (; (i = L.nextNode()) !== null && c.length < s;) {
			if (i.nodeType === 1) {
				if (i.hasAttributes()) for (let e of i.getAttributeNames()) if (e.endsWith(Je)) {
					let t = u[o++], n = i.getAttribute(e).split(E), r = /([.?@])?(.*)/.exec(t);
					c.push({
						type: 1,
						index: a,
						name: r[2],
						strings: n,
						ctor: r[1] === "." ? ut : r[1] === "?" ? dt : r[1] === "@" ? ft : B
					}), i.removeAttribute(e);
				} else e.startsWith(E) && (c.push({
					type: 6,
					index: a
				}), i.removeAttribute(e));
				if (rt.test(i.tagName)) {
					let e = i.textContent.split(E), t = e.length - 1;
					if (t > 0) {
						i.textContent = T ? T.emptyScript : "";
						for (let n = 0; n < t; n++) i.append(e[n], O()), L.nextNode(), c.push({
							type: 2,
							index: ++a
						});
						i.append(e[t], O());
					}
				}
			} else if (i.nodeType === 8) {
				if (i.data === Ye) c.push({
					type: 2,
					index: a
				});
				else {
					let e = -1;
					for (; (e = i.data.indexOf(E, e + 1)) !== -1;) c.push({
						type: 7,
						index: a
					}), e += E.length - 1;
				}
			}
			a++;
		}
	}
	static createElement(e, t) {
		let n = D.createElement("template");
		return n.innerHTML = e, n;
	}
};
function R(e, t, n = e, r) {
	if (t === F) return t;
	let i = r === void 0 ? n._$Cl : n._$Co?.[r], a = k(t) ? void 0 : t._$litDirective$;
	return i?.constructor !== a && (i?._$AO?.(!1), a === void 0 ? i = void 0 : (i = new a(e), i._$AT(e, n, r)), r === void 0 ? n._$Cl = i : (n._$Co ??= [])[r] = i), i !== void 0 && (t = R(e, i._$AS(e, t.values), i, r)), t;
}
var lt = class {
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
		let { el: { content: t }, parts: n } = this._$AD, r = (e?.creationScope ?? D).importNode(t, !0);
		L.currentNode = r;
		let i = L.nextNode(), a = 0, o = 0, s = n[0];
		for (; s !== void 0;) {
			if (a === s.index) {
				let t;
				s.type === 2 ? t = new z(i, i.nextSibling, this, e) : s.type === 1 ? t = new s.ctor(i, s.name, s.strings, this, e) : s.type === 6 && (t = new pt(i, this, e)), this._$AV.push(t), s = n[++o];
			}
			a !== s?.index && (i = L.nextNode(), a++);
		}
		return L.currentNode = D, r;
	}
	p(e) {
		let t = 0;
		for (let n of this._$AV) n !== void 0 && (n.strings === void 0 ? n._$AI(e[t]) : (n._$AI(e, n, t), t += n.strings.length - 2)), t++;
	}
}, z = class e {
	get _$AU() {
		return this._$AM?._$AU ?? this._$Cv;
	}
	constructor(e, t, n, r) {
		this.type = 2, this._$AH = I, this._$AN = void 0, this._$AA = e, this._$AB = t, this._$AM = n, this.options = r, this._$Cv = r?.isConnected ?? !0;
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
		e = R(this, e, t), k(e) ? e === I || e == null || e === "" ? (this._$AH !== I && this._$AR(), this._$AH = I) : e !== this._$AH && e !== F && this._(e) : e._$litType$ === void 0 ? e.nodeType === void 0 ? Ze(e) ? this.k(e) : this._(e) : this.T(e) : this.$(e);
	}
	O(e) {
		return this._$AA.parentNode.insertBefore(e, this._$AB);
	}
	T(e) {
		this._$AH !== e && (this._$AR(), this._$AH = this.O(e));
	}
	_(e) {
		this._$AH !== I && k(this._$AH) ? this._$AA.nextSibling.data = e : this.T(D.createTextNode(e)), this._$AH = e;
	}
	$(e) {
		let { values: t, _$litType$: n } = e, r = typeof n == "number" ? this._$AC(e) : (n.el === void 0 && (n.el = ct.createElement(ot(n.h, n.h[0]), this.options)), n);
		if (this._$AH?._$AD === r) this._$AH.p(t);
		else {
			let e = new lt(r, this), n = e.u(this.options);
			e.p(t), this.T(n), this._$AH = e;
		}
	}
	_$AC(e) {
		let t = at.get(e.strings);
		return t === void 0 && at.set(e.strings, t = new ct(e)), t;
	}
	k(t) {
		A(this._$AH) || (this._$AH = [], this._$AR());
		let n = this._$AH, r, i = 0;
		for (let a of t) i === n.length ? n.push(r = new e(this.O(O()), this.O(O()), this, this.options)) : r = n[i], r._$AI(a), i++;
		i < n.length && (this._$AR(r && r._$AB.nextSibling, i), n.length = i);
	}
	_$AR(e = this._$AA.nextSibling, t) {
		for (this._$AP?.(!1, !0, t); e !== this._$AB;) {
			let t = Ke(e).nextSibling;
			Ke(e).remove(), e = t;
		}
	}
	setConnected(e) {
		this._$AM === void 0 && (this._$Cv = e, this._$AP?.(e));
	}
}, B = class {
	get tagName() {
		return this.element.tagName;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	constructor(e, t, n, r, i) {
		this.type = 1, this._$AH = I, this._$AN = void 0, this.element = e, this.name = t, this._$AM = r, this.options = i, n.length > 2 || n[0] !== "" || n[1] !== "" ? (this._$AH = Array(n.length - 1).fill(/* @__PURE__ */ new String()), this.strings = n) : this._$AH = I;
	}
	_$AI(e, t = this, n, r) {
		let i = this.strings, a = !1;
		if (i === void 0) e = R(this, e, t, 0), a = !k(e) || e !== this._$AH && e !== F, a && (this._$AH = e);
		else {
			let r = e, o, s;
			for (e = i[0], o = 0; o < i.length - 1; o++) s = R(this, r[n + o], t, o), s === F && (s = this._$AH[o]), a ||= !k(s) || s !== this._$AH[o], s === I ? e = I : e !== I && (e += (s ?? "") + i[o + 1]), this._$AH[o] = s;
		}
		a && !r && this.j(e);
	}
	j(e) {
		e === I ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, e ?? "");
	}
}, ut = class extends B {
	constructor() {
		super(...arguments), this.type = 3;
	}
	j(e) {
		this.element[this.name] = e === I ? void 0 : e;
	}
}, dt = class extends B {
	constructor() {
		super(...arguments), this.type = 4;
	}
	j(e) {
		this.element.toggleAttribute(this.name, !!e && e !== I);
	}
}, ft = class extends B {
	constructor(e, t, n, r, i) {
		super(e, t, n, r, i), this.type = 5;
	}
	_$AI(e, t = this) {
		if ((e = R(this, e, t, 0) ?? I) === F) return;
		let n = this._$AH, r = e === I && n !== I || e.capture !== n.capture || e.once !== n.once || e.passive !== n.passive, i = e !== I && (n === I || r);
		r && this.element.removeEventListener(this.name, this, n), i && this.element.addEventListener(this.name, this, e), this._$AH = e;
	}
	handleEvent(e) {
		typeof this._$AH == "function" ? this._$AH.call(this.options?.host ?? this.element, e) : this._$AH.handleEvent(e);
	}
}, pt = class {
	constructor(e, t, n) {
		this.element = e, this.type = 6, this._$AN = void 0, this._$AM = t, this.options = n;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	_$AI(e) {
		R(this, e);
	}
}, mt = {
	M: Je,
	P: E,
	A: Ye,
	C: 1,
	L: st,
	R: lt,
	D: Ze,
	V: R,
	I: z,
	H: B,
	N: dt,
	U: ft,
	B: ut,
	F: pt
}, ht = Ge.litHtmlPolyfillSupport;
ht?.(ct, z), (Ge.litHtmlVersions ??= []).push("3.3.3");
var gt = (e, t, n) => {
	let r = n?.renderBefore ?? t, i = r._$litPart$;
	if (i === void 0) {
		let e = n?.renderBefore ?? null;
		r._$litPart$ = i = new z(t.insertBefore(O(), e), e, void 0, n ?? {});
	}
	return i._$AI(e), i;
}, _t = globalThis, V = class extends w {
	constructor() {
		super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
	}
	createRenderRoot() {
		let e = super.createRenderRoot();
		return this.renderOptions.renderBefore ??= e.firstChild, e;
	}
	update(e) {
		let t = this.render();
		this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(e), this._$Do = gt(t, this.renderRoot, this.renderOptions);
	}
	connectedCallback() {
		super.connectedCallback(), this._$Do?.setConnected(!0);
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._$Do?.setConnected(!1);
	}
	render() {
		return F;
	}
};
V._$litElement$ = !0, V.finalized = !0, _t.litElementHydrateSupport?.({ LitElement: V });
var vt = _t.litElementPolyfillSupport;
vt?.({ LitElement: V }), (_t.litElementVersions ??= []).push("4.2.2");
// node_modules/lit-html/directive.js
var H = {
	ATTRIBUTE: 1,
	CHILD: 2,
	PROPERTY: 3,
	BOOLEAN_ATTRIBUTE: 4,
	EVENT: 5,
	ELEMENT: 6
}, yt = (e) => (...t) => ({
	_$litDirective$: e,
	values: t
}), bt = class {
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
}, U = yt(class extends bt {
	constructor(e) {
		if (super(e), e.type !== H.ATTRIBUTE || e.name !== "class" || e.strings?.length > 2) throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.");
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
		return F;
	}
}), W = (e) => e ?? I, xt = "important", St = " !" + xt, Ct = yt(class extends bt {
	constructor(e) {
		if (super(e), e.type !== H.ATTRIBUTE || e.name !== "style" || e.strings?.length > 2) throw Error("The `styleMap` directive must be used in the `style` attribute and must be the only part in the attribute.");
	}
	render(e) {
		return Object.keys(e).reduce((t, n) => {
			let r = e[n];
			return r == null ? t : t + `${n = n.includes("-") ? n : n.replace(/(?:^(webkit|moz|ms|o)|)(?=[A-Z])/g, "-$&").toLowerCase()}:${r};`;
		}, "");
	}
	update(e, [t]) {
		let { style: n } = e.element;
		if (this.ft === void 0) return this.ft = new Set(Object.keys(t)), this.render(t);
		for (let e of this.ft) t[e] ?? (this.ft.delete(e), e.includes("-") ? n.removeProperty(e) : n[e] = null);
		for (let e in t) {
			let r = t[e];
			if (r != null) {
				this.ft.add(e);
				let t = typeof r == "string" && r.endsWith(St);
				e.includes("-") || t ? n.setProperty(e, t ? r.slice(0, -11) : r, t ? xt : "") : n[e] = r;
			}
		}
		return F;
	}
});
// src/hit-test.ts
function wt(e, t) {
	return Math.hypot(Math.max(t.x - e.x, 0, e.x - (t.x + t.w)), Math.max(t.y - e.y, 0, e.y - (t.y + t.h)));
}
function Tt(e, t, n) {
	let r = n.x - t.x, i = n.y - t.y, a = r * r + i * i, o = a === 0 ? 0 : Math.max(0, Math.min(1, ((e.x - t.x) * r + (e.y - t.y) * i) / a));
	return Math.hypot(e.x - (t.x + o * r), e.y - (t.y + o * i));
}
function Et(e, t, n = !1) {
	let r = t[0];
	if (!r) return Infinity;
	if (t.length === 1) return Math.hypot(e.x - r.x, e.y - r.y);
	let i = Infinity, a = n ? t.length : t.length - 1;
	for (let n = 0; n < a; n++) i = Math.min(i, Tt(e, t[n], t[(n + 1) % t.length]));
	return i;
}
function Dt(e, t) {
	let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map();
	for (let i of t) {
		let t = "points" in i ? Et(e, i.points, i.closed) : "w" in i ? wt(e, i) : Math.hypot(e.x - i.x, e.y - i.y);
		t > i.hitRadius || (n.set(i.elementId, Math.min(t, n.get(i.elementId) ?? Infinity)), !("w" in i) && i.glyphRadius !== void 0 && t <= i.glyphRadius && r.set(i.elementId, Math.min(t, r.get(i.elementId) ?? Infinity)));
	}
	let i = (e, t) => e[1] - t[1], a = [...r].sort(i).map(([e]) => e);
	if (a.length === 1) return a;
	let o = [...n].filter(([e]) => !r.has(e)).sort(i);
	return [...a, ...o.map(([e]) => e)];
}
// src/operate.ts
var Ot = /* @__PURE__ */ new Set([
	"light",
	"switch",
	"fan",
	"cover"
]), kt = [
	"climate",
	"cover",
	"lock",
	"light",
	"switch",
	"fan",
	"binary_sensor",
	"sensor",
	"camera"
];
function At(e, t) {
	return e.type === "entity" ? t.states[e.id] ? [e.id] : [] : p(t, e.id).map((e) => e.entity_id).filter((e) => t.states[e]);
}
function jt(e, t) {
	let n = (e) => {
		let n = t.states[e]?.attributes.device_class === "battery", r = kt.indexOf(d(e));
		return (r === -1 ? kt.length : r) + (n ? 100 : 0);
	};
	return [...e].sort((e, t) => n(e) - n(t))[0];
}
async function Mt(e, t) {
	let n = t.filter((e) => d(e) === "cover"), r = n.filter((t) => e.states[t]?.state === "closed"), i = n.filter((e) => !r.includes(e)), a = [
		[
			"homeassistant",
			"toggle",
			t.filter((e) => d(e) !== "cover")
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
	], o = !0;
	for (let [t, n, r] of a) if (r.length !== 0) try {
		await e.callService(t, n, { entity_id: r });
	} catch {
		o = !1;
	}
	return o;
}
// src/view-geometry.ts
var Nt = .15, Pt = .58, G = (e) => Math.round(e * 100) / 100;
function K(e, t, n, r, i) {
	e.minX = Math.min(e.minX, t), e.minY = Math.min(e.minY, n), e.maxX = Math.max(e.maxX, r), e.maxY = Math.max(e.maxY, i);
}
function Ft(e, t, n, r, i) {
	let a = t.length * i * Pt / 2;
	K(e, n - a, r - i / 2, n + a, r + i / 2);
}
function It(e, t) {
	switch (t.type) {
		case "marker": {
			let n = t.size / 2;
			K(e, t.x - n, t.y - n, t.x + n, t.y + n), t.label && Ft(e, t.label.text, t.label.x, t.label.y, t.label.fontSize);
			return;
		}
		case "path": {
			let n = t.strokeWidth / 2;
			for (let r of t.points) K(e, r.x - n, r.y - n, r.x + n, r.y + n);
			for (let n of t.heads) K(e, n.x - n.size / 2, n.y - n.size / 2, n.x + n.size / 2, n.y + n.size / 2);
			t.label && Ft(e, t.label.text, t.label.x, t.label.y, t.label.fontSize);
			return;
		}
		case "note": {
			let n = t.text.split("\n"), r = Math.max(...n.map((e) => e.length));
			K(e, t.x, t.y, t.x + r * t.fontSize * Pt, t.y + n.length * t.fontSize * 1.2);
			return;
		}
	}
}
function Lt(e, t, n, r) {
	let i = (t - e) * r, a = e - i, o = t + i, s = n * Nt;
	if (o - a < s) {
		let e = (a + o) / 2;
		a = e - s / 2, o = e + s / 2, a < 0 && ([a, o] = [0, o - a]), o > n && ([a, o] = [a - (o - n), n]);
	}
	return [Math.max(a, 0), Math.min(o, n)];
}
function Rt(e, t, n, r = .08) {
	let i = {
		x: 0,
		y: 0,
		w: t,
		h: n
	};
	if (e.length === 0) return i;
	let a = {
		minX: Infinity,
		minY: Infinity,
		maxX: -Infinity,
		maxY: -Infinity
	};
	for (let t of e) It(a, t);
	if (!Number.isFinite(a.minX + a.minY + a.maxX + a.maxY)) return i;
	let [o, s] = Lt(a.minX, a.maxX, t, r), [c, l] = Lt(a.minY, a.maxY, n, r);
	return {
		x: G(o),
		y: G(c),
		w: G(s - o),
		h: G(l - c)
	};
}
function zt(e) {
	let t = e.some((e) => e.type === "smart-home"), n = e.some((e) => e.type === "lighting");
	return !t || !n ? [] : e.every((t) => t.background.key === e[0]?.background.key) ? [
		"all",
		"smart-home",
		"lighting"
	] : ["smart-home", "lighting"];
}
function Bt(e, t, n, r, i) {
	let a = Math.max(i, Math.min(e.x - t.w / 2, n.w - t.w - i)), o = e.y + r, s = e.y - r - t.h, c;
	return c = o + t.h <= n.h - i ? o : s >= i ? s : Math.max(i, n.h - t.h - i), {
		x: a,
		y: c
	};
}
// src/floorplan-view.ts
var Vt = 500, Ht = 8, Ut = 300, Wt = 30, Gt = 1, Kt = 6, qt = 22, Jt = 4, q = 14, Yt = .58, Xt = 4e3, Zt = 280, Qt = 48, $t = 8, en = 14, tn = {
	w: 800,
	h: 600
}, nn = /* @__PURE__ */ new Set([..._, "smart-switches"]), rn = /* @__PURE__ */ new Set([
	"sensors",
	"aircon-controllers",
	"curtains-blinds",
	"smart-locks"
]), an = {
	all: "All",
	"smart-home": "Smart Home",
	lighting: "Lighting"
}, on = {
	unlinked: "Not linked",
	missing: "Device missing",
	unavailable: "Unavailable",
	on: "On",
	off: "Off",
	alert: "Alert",
	idle: "Idle"
};
function sn(e, t, n) {
	let r = t.length * q * Yt + q * 1.2, i = q * 1.7;
	if (e.type === "marker") {
		let t = e.x + e.size / 2 + 6;
		return t + r > n && (t = e.x - e.size / 2 - 6 - r), {
			x: t,
			y: e.y - i / 2,
			w: r,
			h: i
		};
	}
	let a = e.points[0], o = e.points[e.points.length - 1];
	return {
		x: ((a?.x ?? 0) + (o?.x ?? 0)) / 2 - r / 2,
		y: ((a?.y ?? 0) + (o?.y ?? 0)) / 2 - i * 1.5,
		w: r,
		h: i
	};
}
function cn(e, t) {
	let n = t.text.length * t.fontSize * Yt, r = t.fontSize * 1.3, i = e.type === "marker" ? t.y + t.fontSize * .3 : t.y;
	return {
		x: t.x - n / 2,
		y: i - r / 2,
		w: n,
		h: r
	};
}
var ln = 0, un = "translate(0px, 0px) scale(1)", J = (e) => Math.round(e * 100) / 100, dn = (e, t, n) => Math.min(n, Math.max(t, e)), fn = /* @__PURE__ */ new WeakMap();
function pn(e) {
	let t = fn.get(e.scene);
	return t || (t = u(e.scene), fn.set(e.scene, t)), t;
}
var mn = class extends V {
	static properties = {
		hass: { attribute: !1 },
		home: { attribute: !1 },
		mode: { type: String },
		selected: { attribute: !1 },
		current: { type: String },
		_levelId: { state: !0 },
		_layer: { state: !0 },
		_whole: { state: !0 },
		_images: { state: !0 },
		_stage: { state: !0 },
		_popup: { state: !0 },
		_picker: { state: !0 },
		_notice: { state: !0 }
	};
	_elements = /* @__PURE__ */ new Map();
	_pickDown;
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
	_returnFocus;
	_shownPlans = "";
	_softFilterId = `maxsen-soft-${++ln}`;
	constructor() {
		super(), this.mode = "use", this.selected = [], this.current = void 0, this._layer = "all", this._whole = !1, this._images = /* @__PURE__ */ new Map(), this._stage = tn;
	}
	connectedCallback() {
		super.connectedCallback(), this.hasUpdated && this.requestUpdate();
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._dropImages(), this._cancelHold(), this._closePicker(!1), clearTimeout(this._noticeTimer), this._observer?.disconnect(), this._observer = void 0, this._observed = void 0, this._pointers.clear(), this._press = void 0, this._pinch = void 0;
	}
	willUpdate(e) {
		e.has("home") && this._onHome(), e.has("current") && this.current && this._reveal(this.current);
	}
	_reveal(e) {
		for (let t of this._levels()) {
			let n = t.plans.find((t) => t.elements.some((t) => t.id === e));
			if (n) {
				this._levelId !== t.id && (this._closePicker(), this._levelId = t.id), this._layer !== "all" && this._layer !== n.type && (this._layer = "all");
				return;
			}
		}
	}
	_onHome() {
		let e = this.home?.package, t = e ? `${e.project.id}|${e.exportedAt}|${e.savedVersion}` : "";
		t !== this._packageKey && (this._dropImages(), this._packageKey = t), this._elements = new Map((e?.levels ?? []).flatMap((e) => e.plans.flatMap((e) => e.elements.map((e) => [e.id, e]))));
		let n = this._levels();
		n.some((e) => e.id === this._levelId) || (this._levelId = n[0]?.id);
	}
	updated(e) {
		this._observeStage(), this._loadImages(), this._picker && e.get("_picker") === void 0 && e.has("_picker") && this.renderRoot.querySelector(".picker .pick")?.focus();
		let t = `${this._levelId}|${this._visible().plans.map((e) => e.id).join(",")}|${this._whole}`;
		t !== this._shownPlans && (this._shownPlans = t, this._resetView());
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
		if (this.isConnected && e && t?.package) for (let n of this._visible().plans) {
			let r = n.background.imageId, i = t.image_urls[r];
			if (!i || this._images.has(r) || this._loading.has(r)) continue;
			this._loading.add(r);
			let a = this._generation;
			Te(e, i).then((e) => {
				a !== this._generation || !this.isConnected ? URL.revokeObjectURL(e) : this._images = new Map(this._images).set(r, e);
			}, () => void 0);
		}
	}
	_levels() {
		return [...this.home?.package?.levels ?? []].sort((e, t) => e.sortOrder - t.sortOrder);
	}
	_visible() {
		let e = this._levels().find((e) => e.id === this._levelId)?.plans ?? [], t = zt(e);
		if (t.length === 0) return {
			plans: e,
			options: t,
			layer: "all"
		};
		let n = t.includes(this._layer) ? this._layer : t[0];
		return {
			plans: n === "all" ? e : e.filter((e) => e.type === n),
			options: t,
			layer: n
		};
	}
	_boxes(e) {
		let t = e[0], n = {
			x: 0,
			y: 0,
			w: t.width,
			h: t.height
		}, r = Rt(e.flatMap((e) => e.scene.items), t.width, t.height);
		return {
			fitted: r,
			whole: n,
			shown: this._whole ? n : r
		};
	}
	_items() {
		return new Map(this._visible().plans.flatMap((e) => e.scene.items.map((e) => [e.elementId, e])));
	}
	_state(e) {
		let t = this._elements.get(e);
		return !t || !this.hass ? { status: "unlinked" } : g(t, this.home?.links[e], this.hass);
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
		n.x = dn(n.x, e * (1 - n.s), 0), n.y = dn(n.y, t * (1 - n.s), 0);
		let r = this.renderRoot.querySelector(".canvas");
		r && (r.style.transform = `translate(${J(n.x)}px, ${J(n.y)}px) scale(${J(n.s)})`);
	}
	_resetView() {
		this._view = {
			s: 1,
			x: 0,
			y: 0
		}, this._applyView();
	}
	_zoomAt(e, t, n, r = this._view) {
		let i = dn(n, Gt, Kt), a = (e - r.x) / r.s, o = (t - r.y) / r.s;
		this._view = {
			s: i,
			x: e - a * i,
			y: t - o * i
		}, this._applyView();
	}
	_touchAreas() {
		let { plans: e } = this._visible();
		if (e.length === 0) return [];
		let t = this._boxes(e).shown, n = this._stageSize(), r = Math.min(n.w / t.w, n.h / t.h), i = (n.w - t.w * r) / 2, a = (n.h - t.h * r) / 2, o = this._view, s = (e) => (i + (e - t.x) * r) * o.s + o.x, c = (e) => (a + (e - t.y) * r) * o.s + o.y, l = (e, t) => ({
			elementId: e,
			x: s(t.x),
			y: c(t.y),
			w: t.w * r * o.s,
			h: t.h * r * o.s,
			hitRadius: Jt
		}), u = this.mode === "link", d = [];
		for (let t of e) for (let e of t.scene.items) {
			if (e.type === "note" || !this._elements.has(e.elementId)) continue;
			let n = this._state(e.elementId);
			if (!u && (n.status === "unlinked" || n.status === "missing")) continue;
			let i = n.text;
			i && rn.has(e.categoryId) && d.push(l(e.elementId, sn(e, i, t.width))), e.label && d.push(l(e.elementId, cn(e, e.label))), d.push(e.type === "marker" ? {
				elementId: e.elementId,
				x: s(e.x),
				y: c(e.y),
				hitRadius: Math.max(qt, e.size / 2 * r * o.s),
				glyphRadius: e.size / 2 * r * o.s
			} : {
				elementId: e.elementId,
				points: e.points.map((e) => ({
					x: s(e.x),
					y: c(e.y)
				})),
				closed: e.closed,
				hitRadius: Math.max(qt, e.strokeWidth / 2 * r * o.s),
				glyphRadius: e.strokeWidth / 2 * r * o.s
			});
		}
		return d.reverse();
	}
	_onDown(e) {
		let t = e.currentTarget, n = this._local(e);
		this._pointers.set(e.pointerId, n);
		try {
			t.setPointerCapture?.(e.pointerId);
		} catch {}
		if (this._pointers.size === 1) {
			let t = Dt(n, this._touchAreas()), r = this.mode === "use" ? t.filter((e) => this._state(e).status !== "unavailable") : t, i = {
				id: e.pointerId,
				hits: t,
				tapHits: r,
				x: n.x,
				y: n.y,
				moved: !1,
				long: !1
			};
			this._press = i, this._cancelHold(), t.length > 0 && this.mode === "use" && (this._holdTimer = setTimeout(() => this._onHold(i), Vt));
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
		if (!(i && i.id === e.pointerId && i.long)) {
			if (i && i.id === e.pointerId && !i.moved) {
				if (Math.hypot(n.x - i.x, n.y - i.y) <= Ht) return;
				i.moved = !0, this._cancelHold();
			}
			(!i || i.moved) && (this._view.x += n.x - t.x, this._view.y += n.y - t.y, this._applyView());
		}
	}
	_onUp(e) {
		this._pointers.delete(e.pointerId), this._pointers.size < 2 && (this._pinch = void 0);
		let t = this._press;
		t && t.id === e.pointerId && (this._press = void 0, this._cancelHold(), e.type === "pointerup" && !t.moved && !t.long && this._onTap(t));
	}
	_onWheel(e) {
		e.preventDefault(), this._closePicker();
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
		let [t, ...n] = e.tapHits;
		if (t === void 0) {
			if (e.hits.length > 0) return;
			let t = Date.now(), n = this._lastTap;
			n && t - n.t < Ut && Math.hypot(e.x - n.x, e.y - n.y) < Wt ? (this._lastTap = void 0, this._whole = !1, this._resetView()) : this._lastTap = {
				t,
				x: e.x,
				y: e.y
			};
		} else n.length > 0 ? this._openPicker(e, "tap", e.tapHits) : this._tapElement(t);
	}
	_onHold(e) {
		e.long = !0, this._holdTimer = void 0;
		let [t, ...n] = e.hits;
		t !== void 0 && (n.length > 0 ? this._openPicker(e, "details", e.hits) : this._showDetails(t));
	}
	_tapElement(e) {
		this.mode === "link" ? this.dispatchEvent(new CustomEvent("maxsen-element-tap", {
			detail: { elementId: e },
			bubbles: !0,
			composed: !0
		})) : this._operate(e);
	}
	_showDetails(e) {
		let { hass: t, home: n } = this;
		if (!t || !n) return;
		let r = this._state(e).status, i = n.links[e];
		if (!i || r === "unlinked" || r === "missing") return;
		let a = jt(At(i, t), t);
		a && this._moreInfo(a);
	}
	_openPicker(e, t, n) {
		let r = this.renderRoot.activeElement;
		this._returnFocus = r instanceof HTMLElement ? r : void 0, this._picker = {
			x: e.x,
			y: e.y,
			ids: n,
			intent: t
		}, this._pickDown = void 0, window.addEventListener("keydown", this._onPickerKey);
	}
	_closePicker(e = !0) {
		if (window.removeEventListener("keydown", this._onPickerKey), !this._picker) return;
		this._picker = void 0, this._pickDown = void 0;
		let t = this._returnFocus;
		this._returnFocus = void 0, e && (t?.isConnected ? t : this.renderRoot.querySelector(".stage"))?.focus();
	}
	_onPickerKey = (e) => {
		e.key === "Escape" && this._closePicker();
	};
	_onPickClick(e, t) {
		let n = this._pickDown;
		this._pickDown = void 0, (e.detail === 0 || n === t) && this._choose(t);
	}
	_choose(e) {
		let t = this._picker?.intent;
		this._closePicker(), t === "details" ? this._showDetails(e) : this._tapElement(e);
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
		let a = At(r, t), o = a.filter((e) => Ot.has(d(e)));
		if (o.length === 0) {
			let e = jt(a, t);
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
		this.hass && !await Mt(this.hass, e) && this._showNotice("Could not reach that device.");
	}
	_showNotice(e) {
		this._notice = e, clearTimeout(this._noticeTimer), this._noticeTimer = setTimeout(() => this._notice = void 0, Xt);
	}
	_renderNode(e) {
		let t = e.attrs;
		switch (e.tag) {
			case "g": return P`<g>${(e.children ?? []).map((e) => this._renderNode(e))}</g>`;
			case "path": return P`<path
          d=${W(t.d)}
          transform=${W(t.transform)}
          fill=${W(t.fill)}
          fill-rule=${W(t["fill-rule"])}
          stroke=${W(t.stroke)}
          stroke-width=${W(t["stroke-width"])}
          stroke-linecap=${W(t["stroke-linecap"])}
          stroke-linejoin=${W(t["stroke-linejoin"])}
          stroke-dasharray=${W(t["stroke-dasharray"])}
          opacity=${W(t.opacity)}
        />`;
			case "text": return P`<text
          x=${W(t.x)}
          y=${W(t.y)}
          font-size=${W(t["font-size"])}
          font-weight=${W(t["font-weight"])}
          text-anchor=${W(t["text-anchor"])}
          dominant-baseline=${W(t["dominant-baseline"])}
          fill=${W(t.fill)}
          transform=${W(t.transform)}
          stroke=${W(t.stroke)}
          stroke-width=${W(t["stroke-width"])}
          stroke-linejoin=${W(t["stroke-linejoin"])}
          paint-order=${W(t["paint-order"])}
        >${e.text ?? ""}</text>`;
		}
	}
	_renderPill(e, t, n) {
		if (e.type === "note") return P``;
		let { x: r, y: i, w: a, h: o } = sn(e, t, n);
		return P`<g class="pill" transform="translate(${J(r)} ${J(i + o / 2)})">
      <rect y=${-o / 2} width=${a} height=${o} rx=${o / 2} />
      <text x=${a / 2} y="0" font-size=${q} text-anchor="middle" dominant-baseline="central">${t}</text>
    </g>`;
	}
	_renderLinkMarks(e, t, n) {
		if (e.type === "note") return P``;
		let r = t === "unlinked" || t === "missing", i = U({
			"link-ring": !0,
			missing: t === "missing"
		});
		if (e.type === "marker") {
			let t = Math.max(e.size * .85, 20);
			return P`
        ${n ? P`<circle class="halo" cx=${e.x} cy=${e.y} r=${J(t + 6)} />` : I}
        ${r ? P`<circle class=${i} cx=${e.x} cy=${e.y} r=${J(t)} />` : I}
      `;
		}
		return P`
      ${n ? P`<path class="halo line" d=${e.d} stroke-width=${e.strokeWidth + 16} />` : I}
      ${r ? P`<path class=${i} d=${e.d} stroke-width=${e.strokeWidth + 8} />` : I}
    `;
	}
	_renderCurrentRing(e) {
		if (e.type === "note") return P``;
		if (e.type === "marker") {
			let t = Math.max(e.size * .85, 20);
			return P`<circle class="current-ring" cx=${e.x} cy=${e.y} r=${J(t + 10)} />`;
		}
		return P`<path class="current-ring" d=${e.d} stroke-width=${e.strokeWidth + 20} />`;
	}
	_renderItem(e, t, n) {
		let r = e.elementId, i = (t.children ?? []).map((e) => this._renderNode(e));
		if (e.type === "note" || !this._elements.has(r)) return P`<g class="static" data-element-id=${r}>${i}</g>`;
		let a = this._state(r), o = a.status === "on" && nn.has(e.categoryId) ? e.type === "path" ? "url(#maxsen-glow-path)" : "url(#maxsen-glow)" : void 0, s = a.text && rn.has(e.categoryId) ? this._renderPill(e, a.text, n.width) : I, c = this.mode === "link", l = c && this.selected.includes(r), u = this.current === r;
		return P`<g
      class=${U({
			element: !0,
			[e.type]: !0,
			[a.status]: !0,
			linking: c,
			selected: l,
			current: u
		})}
      data-element-id=${r}
    >
      ${c ? this._renderLinkMarks(e, a.status, l) : I}
      ${u ? this._renderCurrentRing(e) : I}
      ${a.status === "alert" && e.type === "marker" ? P`<circle class="alert-ring" cx=${e.x} cy=${e.y} r=${Math.max(e.size * .9, 18)} />` : I}
      <g class="glyph" filter=${W(o)}>${i}</g>
      ${s}
    </g>`;
	}
	_renderDrawing(e, t) {
		let n = e[0], r = this._images.get(n.background.imageId), i = this.home?.display?.background !== "original";
		return N`
      <svg viewBox="${t.x} ${t.y} ${t.w} ${t.h}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="maxsen-glow" x="-300%" y="-300%" width="700%" height="700%" color-interpolation-filters="sRGB">
            <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ffb22e" flood-opacity="0.95" result="near" />
            <feDropShadow in="near" dx="0" dy="0" stdDeviation="16" flood-color="#ffb22e" flood-opacity="0.7" />
          </filter>
          <!-- Greyscale, then the CSS contrast(0.55) brightness(1.25) as one linear step. An SVG filter,
               because WebKit does not apply CSS filter functions to SVG children. -->
          <filter id=${this._softFilterId} color-interpolation-filters="sRGB">
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="linear" slope="0.6875" intercept="0.28125" />
              <feFuncG type="linear" slope="0.6875" intercept="0.28125" />
              <feFuncB type="linear" slope="0.6875" intercept="0.28125" />
            </feComponentTransfer>
          </filter>
          <!-- A straight line has no area, so this one is sized in plan units, not by the shape. -->
          <filter id="maxsen-glow-path" filterUnits="userSpaceOnUse" x="0" y="0" width=${n.width} height=${n.height} color-interpolation-filters="sRGB">
            <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ffb22e" flood-opacity="0.95" result="near" />
            <feDropShadow in="near" dx="0" dy="0" stdDeviation="16" flood-color="#ffb22e" flood-opacity="0.7" />
          </filter>
        </defs>
        <rect width=${n.width} height=${n.height} fill="#fff" />
        ${r ? P`<image
              class=${U({
			background: !0,
			soft: i
		})}
              href=${r}
              filter=${W(i ? `url(#${this._softFilterId})` : void 0)}
              width=${n.width}
              height=${n.height}
              preserveAspectRatio="none"
            />` : I}
        ${e.map((e) => {
			let t = pn(e);
			return P`<g class="plan">${e.scene.items.map((n, r) => this._renderItem(n, t[r], e))}</g>`;
		})}
      </svg>
    `;
	}
	_renderPicker() {
		let e = this._picker;
		if (!e) return I;
		let t = this._items(), n = e.ids.flatMap((e) => {
			let n = t.get(e), r = this._elements.get(e);
			return n && r && n.type !== "note" ? [{
				id: e,
				el: r,
				color: n.color,
				state: this._state(e)
			}] : [];
		});
		if (n.length === 0) return I;
		let r = this._stageSize(), i = {
			w: Math.min(Zt, r.w - 16),
			h: Math.min(n.length * Qt + 8, r.h - 16)
		}, a = Bt(e, i, r, en, $t), o = (e) => this.mode === "link" || e !== "unlinked" && e !== "missing";
		return N`
      <div class="picker-layer">
        <div
          class="picker-backdrop"
          @pointerdown=${(e) => {
			e.stopPropagation(), this._closePicker();
		}}
        ></div>
        <div
          class="picker"
          role="dialog"
          aria-label=${e.intent === "details" ? "Choose a device to open" : "Choose a device"}
          style=${Ct({
			left: `${J(a.x)}px`,
			top: `${J(a.y)}px`,
			width: `${J(i.w)}px`,
			maxHeight: `${J(i.h)}px`
		})}
          @pointerdown=${(e) => e.stopPropagation()}
          @wheel=${(e) => e.stopPropagation()}
          @keydown=${this._onPickerKey}
        >
          ${n.map(({ id: e, el: t, color: n, state: r }) => N`<button
              type="button"
              class=${U({
			pick: !0,
			dim: !o(r.status)
		})}
              aria-disabled=${o(r.status) ? "false" : "true"}
              @pointerdown=${() => this._pickDown = e}
              @click=${(t) => this._onPickClick(t, e)}
            >
              <span class="dot" style=${Ct({ background: n })}></span>
              <span class="pick-name">${t.label || t.productName}</span>
              <span class="pick-state">${r.text ?? on[r.status]}</span>
            </button>`)}
        </div>
      </div>
    `;
	}
	_renderPopup() {
		let e = this._popup, t = this.hass;
		if (!e || !t) return I;
		let n = () => this._popup = void 0;
		return N`
      <div class="popup-layer">
        <div class="popup-backdrop" @click=${n}></div>
        <div class="popup" role="dialog" aria-label=${e.title}>
          <div class="popup-title">
            <span>${e.title}</span>
            <button class="close" aria-label="Close" @click=${n}>&times;</button>
          </div>
          ${e.entityIds.map((e) => {
			let r = t.states[e], i = typeof r?.attributes.friendly_name == "string" ? r.attributes.friendly_name : e, a = r?.state === "on" || d(e) === "cover" && r?.state !== "closed";
			return N`<div class="row">
              <button class="name" @click=${() => {
				n(), this._moreInfo(e);
			}}>${i}</button>
              <span class="state">${r?.state ?? ""}</span>
              <button
                class=${U({
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
		if (!e || e.levels.length === 0) return N`<div class="empty">No home loaded yet. An installer adds it from the Maxsen Planner.</div>`;
		let t = this._levels(), { plans: n, options: r, layer: i } = this._visible(), a = n.length > 0 ? this._boxes(n) : void 0, o = a !== void 0 && (a.fitted.w < a.whole.w || a.fitted.h < a.whole.h);
		return N`
      <div class="bar">
        <div class="tabs" role="tablist">
          ${t.map((e) => N`<button
              role="tab"
              aria-selected=${e.id === this._levelId ? "true" : "false"}
              class=${U({ active: e.id === this._levelId })}
              @click=${() => {
			this._closePicker(), this._levelId = e.id, this._whole = !1;
		}}
            >${e.name}</button>`)}
        </div>
        <div class="controls">
          ${r.length > 0 ? N`<div class="plan-toggle" role="group" aria-label="Layer">
                ${r.map((e) => N`<button
                    class=${U({ active: i === e })}
                    aria-pressed=${i === e ? "true" : "false"}
                    @click=${() => {
			this._closePicker(), this._layer = e;
		}}
                  >${an[e]}</button>`)}
              </div>` : I}
          ${o ? N`<button
                class="fit"
                @click=${() => {
			this._closePicker(), this._whole = !this._whole;
		}}
              >
                ${this._whole ? "Fit to rooms" : "Whole drawing"}
              </button>` : I}
        </div>
      </div>
      <div
        class="stage"
        tabindex="-1"
        @pointerdown=${this._onDown}
        @pointermove=${this._onMove}
        @pointerup=${this._onUp}
        @pointercancel=${this._onUp}
        @wheel=${this._onWheel}
        @contextmenu=${(e) => e.preventDefault()}
      >
        <div class="canvas" style=${`transform: ${un}`}>
          ${a ? this._renderDrawing(n, a.shown) : N`<div class="empty">This level has no plan.</div>`}
        </div>
        ${this._renderPicker()}
      </div>
      ${this._renderPopup()}
      ${this._notice ? N`<div class="notice" role="status">${this._notice}</div>` : I}
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
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
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
    .bar button.fit {
      border: 1px solid var(--divider-color, #cfd3d9);
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
    .stage:focus {
      outline: none;
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
    /* The plan's own drawing is the point: fade the background so the markers stand out. */
    image.soft {
      opacity: 0.6;
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
    .element.linking {
      cursor: pointer;
    }
    .element.linking.unlinked,
    .element.linking.missing {
      opacity: 0.8;
    }
    .halo {
      fill: color-mix(in srgb, var(--primary-color, #2f6fed) 22%, transparent);
      stroke: var(--primary-color, #2f6fed);
      pointer-events: none;
    }
    circle.halo {
      stroke-width: 4;
    }
    /* A line's width is set on the element, in plan units. */
    .halo.line {
      fill: none;
      stroke: color-mix(in srgb, var(--primary-color, #2f6fed) 45%, transparent);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .link-ring {
      fill: none;
      stroke: #6b7280;
      stroke-dasharray: 7 5;
      pointer-events: none;
    }
    path.link-ring {
      stroke-dasharray: 6 6;
      opacity: 0.55;
    }
    circle.link-ring {
      stroke-width: 3;
    }
    .link-ring.missing {
      stroke: #e5322d;
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
    .current-ring {
      fill: none;
      stroke: var(--primary-color, #2f6fed);
      stroke-width: 7;
      pointer-events: none;
      transform-box: fill-box;
      transform-origin: center;
      animation: maxsen-current 1.2s ease-in-out infinite;
    }
    /* A line is drawn wide, so it only fades: scaling would move it off its path. */
    path.current-ring {
      stroke: color-mix(in srgb, var(--primary-color, #2f6fed) 60%, transparent);
      stroke-linecap: round;
      stroke-linejoin: round;
      animation-name: maxsen-current-line;
    }
    @keyframes maxsen-current {
      0%,
      100% {
        transform: scale(1);
        opacity: 1;
      }
      50% {
        transform: scale(1.15);
        opacity: 0.4;
      }
    }
    @keyframes maxsen-current-line {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.35;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .alert-ring,
      .current-ring {
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
    .picker-layer {
      position: absolute;
      inset: 0;
    }
    .picker-backdrop {
      position: absolute;
      inset: 0;
    }
    .picker {
      position: absolute;
      box-sizing: border-box;
      overflow-y: auto;
      padding: 4px 0;
      border-radius: 14px;
      background: var(--card-background-color, #fff);
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.3),
        0 0 0 1px var(--divider-color, #e3e6ea);
    }
    .pick {
      display: flex;
      align-items: center;
      gap: 12px;
      box-sizing: border-box;
      width: 100%;
      min-height: 48px;
      padding: 0 16px;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 16px;
      text-align: left;
      cursor: pointer;
    }
    .pick + .pick {
      border-top: 1px solid var(--divider-color, #e3e6ea);
    }
    .pick:focus-visible {
      outline: 2px solid var(--primary-color, #2f6fed);
      outline-offset: -2px;
    }
    .pick.dim {
      opacity: 0.45;
    }
    .dot {
      flex: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .pick-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pick-state {
      flex: none;
      color: var(--secondary-text-color, #5b6168);
      font-size: 14px;
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
customElements.get("maxsen-floorplan-view") || customElements.define("maxsen-floorplan-view", mn);
// node_modules/lit-html/directive-helpers.js
var { I: hn } = mt, gn = (e) => e, _n = () => document.createComment(""), Y = (e, t, n) => {
	let r = e._$AA.parentNode, i = t === void 0 ? e._$AB : t._$AA;
	if (n === void 0) n = new hn(r.insertBefore(_n(), i), r.insertBefore(_n(), i), e, e.options);
	else {
		let t = n._$AB.nextSibling, a = n._$AM, o = a !== e;
		if (o) {
			let t;
			n._$AQ?.(e), n._$AM = e, n._$AP !== void 0 && (t = e._$AU) !== a._$AU && n._$AP(t);
		}
		if (t !== i || o) {
			let e = n._$AA;
			for (; e !== t;) {
				let t = gn(e).nextSibling;
				gn(r).insertBefore(e, i), e = t;
			}
		}
	}
	return n;
}, X = (e, t, n = e) => (e._$AI(t, n), e), vn = {}, yn = (e, t = vn) => e._$AH = t, bn = (e) => e._$AH, xn = (e) => {
	e._$AR(), e._$AA.remove();
}, Sn = (e, t, n) => {
	let r = /* @__PURE__ */ new Map();
	for (let i = t; i <= n; i++) r.set(e[i], i);
	return r;
}, Cn = yt(class extends bt {
	constructor(e) {
		if (super(e), e.type !== H.CHILD) throw Error("repeat() can only be used in text expressions");
	}
	dt(e, t, n) {
		let r;
		n === void 0 ? n = t : t !== void 0 && (r = t);
		let i = [], a = [], o = 0;
		for (let t of e) i[o] = r ? r(t, o) : o, a[o] = n(t, o), o++;
		return {
			values: a,
			keys: i
		};
	}
	render(e, t, n) {
		return this.dt(e, t, n).values;
	}
	update(e, [t, n, r]) {
		let i = bn(e), { values: a, keys: o } = this.dt(t, n, r);
		if (!Array.isArray(i)) return this.ut = o, a;
		let s = this.ut ??= [], c = [], l, u, d = 0, f = i.length - 1, p = 0, m = a.length - 1;
		for (; d <= f && p <= m;) if (i[d] === null) d++;
		else if (i[f] === null) f--;
		else if (s[d] === o[p]) c[p] = X(i[d], a[p]), d++, p++;
		else if (s[f] === o[m]) c[m] = X(i[f], a[m]), f--, m--;
		else if (s[d] === o[m]) c[m] = X(i[d], a[m]), Y(e, c[m + 1], i[d]), d++, m--;
		else if (s[f] === o[p]) c[p] = X(i[f], a[p]), Y(e, i[d], i[f]), f--, p++;
		else if (l === void 0 && (l = Sn(o, p, m), u = Sn(s, d, f)), l.has(s[d])) {
			if (l.has(s[f])) {
				let t = u.get(o[p]), n = t === void 0 ? null : i[t];
				if (n === null) {
					let t = Y(e, i[d]);
					X(t, a[p]), c[p] = t;
				} else c[p] = X(n, a[p]), Y(e, i[d], n), i[t] = null;
				p++;
			} else xn(i[f]), f--;
		} else xn(i[d]), d++;
		for (; p <= m;) {
			let t = Y(e, c[m + 1]);
			X(t, a[p]), c[p++] = t;
		}
		for (; d <= f;) {
			let e = i[d++];
			e !== null && xn(e);
		}
		return this.ut = o, yn(e, c), F;
	}
}), wn = 2e3, Tn = "Not available", En = {
	on: "On",
	off: "Off",
	alert: "Alert",
	idle: "",
	unavailable: "Unavailable",
	missing: "Missing device",
	unlinked: "Not linked yet"
}, Z = (e) => `${e.type}:${e.id}`, Dn = (e) => e.charAt(0).toUpperCase() + e.slice(1), On = (e, t) => e.name.localeCompare(t.name, void 0, { numeric: !0 });
function kn(e) {
	return e === "All off" ? 0 : e.startsWith("All off – ") ? 1 : e === "All lights off" ? 2 : 3;
}
function An(e, t) {
	let n = t.findIndex((t) => e < t.top + t.height / 2);
	return n === -1 ? t.length - 1 : n;
}
function jn(e, t, n) {
	let r = [...e], [i] = r.splice(t, 1);
	return i !== void 0 && r.splice(n, 0, i), r;
}
var Mn = class extends V {
	static properties = {
		hass: { attribute: !1 },
		home: { attribute: !1 },
		entryId: { attribute: !1 },
		_editing: { state: !0 },
		_draft: { state: !0 },
		_saving: { state: !0 },
		_error: { state: !0 },
		_flash: { state: !0 },
		_dragging: { state: !0 }
	};
	_elements = /* @__PURE__ */ new Map();
	_drag;
	_flashTimer;
	constructor() {
		super(), this._editing = !1, this._draft = [], this._saving = !1;
	}
	disconnectedCallback() {
		super.disconnectedCallback(), clearTimeout(this._flashTimer);
	}
	willUpdate(e) {
		e.has("home") && (this._elements = new Map((this.home?.package?.levels ?? []).flatMap((e) => e.plans.flatMap((e) => e.elements.map((e) => [e.id, e])))));
	}
	_entry(e) {
		let t = Z(e), n = this.hass, r = {
			key: t,
			item: e,
			name: e.id,
			state: Tn,
			on: !1,
			disabled: !0
		};
		if (!n) return r;
		if (e.type === "element") {
			let i = this._elements.get(e.id);
			if (!i) return {
				...r,
				name: Tn
			};
			let a = g(i, this.home?.links[e.id], n);
			return {
				key: t,
				item: e,
				name: i.label || i.productName,
				state: a.text ?? En[a.status],
				on: a.status === "on",
				disabled: a.status === "unlinked" || a.status === "missing" || a.status === "unavailable"
			};
		}
		let i = n.states[e.id];
		if (!i) return r;
		let a = i.attributes.friendly_name, o = i.state === "unavailable";
		return {
			key: t,
			item: e,
			name: typeof a == "string" && a || e.id,
			state: o ? "Unavailable" : d(e.id) === "scene" ? "Scene" : Dn(i.state),
			on: i.state === "on",
			disabled: o
		};
	}
	_groups() {
		let e = this.hass;
		if (!e) return [];
		let t = Object.keys(e.states).filter((e) => d(e) === "scene").map((e) => {
			let t = {
				type: "entity",
				id: e
			};
			return {
				key: Z(t),
				item: t,
				name: this._entry(t).name,
				note: "",
				blocked: !1
			};
		}).sort((e, t) => kn(e.name) - kn(t.name) || On(e, t)), n = t.length > 0 ? [{
			title: "Scenes",
			rows: t
		}] : [], r = [...this.home?.package?.levels ?? []].sort((e, t) => e.sortOrder - t.sortOrder);
		for (let e of r) {
			let t = /* @__PURE__ */ new Set(), r = [];
			for (let n of e.plans.flatMap((e) => e.elements)) {
				if (t.has(n.id)) continue;
				t.add(n.id);
				let e = {
					type: "element",
					id: n.id
				}, i = this.home?.links[n.id] !== void 0;
				r.push({
					key: Z(e),
					item: e,
					name: n.label || n.productName,
					note: i ? n.label ? n.productName : "" : "Not linked yet",
					blocked: !i
				});
			}
			r.length > 0 && n.push({
				title: e.name,
				rows: r.sort(On)
			});
		}
		return n;
	}
	_showFlash(e, t) {
		this._flash = {
			key: e,
			text: t
		}, clearTimeout(this._flashTimer), this._flashTimer = setTimeout(() => this._flash = void 0, wn);
	}
	_moreInfo(e) {
		this.dispatchEvent(new CustomEvent("hass-more-info", {
			detail: { entityId: e },
			bubbles: !0,
			composed: !0
		}));
	}
	async _press(e) {
		let t = this.hass;
		if (!t || e.disabled) return;
		let { item: n } = e;
		if (n.type === "entity" && d(n.id) === "scene") {
			try {
				await t.callService("scene", "turn_on", { entity_id: n.id }), this._showFlash(e.key, "Done");
			} catch {
				this._showFlash(e.key, "Could not run it");
			}
			return;
		}
		let r = n.type === "element" ? this.home?.links[n.id] : void 0, i = n.type === "entity" ? [n.id] : r ? At(r, t) : [], a = i.filter((e) => Ot.has(d(e)));
		if (a.length > 0) {
			await Mt(t, a) || this._showFlash(e.key, "Could not reach it");
			return;
		}
		let o = jt(i, t);
		o && this._moreInfo(o);
	}
	_open() {
		this._draft = (this.home?.quick_panel ?? []).map(({ type: e, id: t }) => ({
			type: e,
			id: t
		})), this._error = void 0, this._saving = !1, this._editing = !0, this.updateComplete.then(() => this.renderRoot.querySelector(".sheet .close")?.focus());
	}
	_close() {
		this._editing = !1, this._drag = void 0, this._dragging = void 0;
	}
	_toggleRow(e, t) {
		let n = this._draft.filter((t) => Z(t) !== e.key);
		this._draft = t ? [...n, e.item] : n;
	}
	_move(e, t) {
		let n = this._draft.findIndex((t) => Z(t) === e), r = n + t;
		n === -1 || r < 0 || r >= this._draft.length || (this._draft = jn(this._draft, n, r), this.updateComplete.then(() => {
			let n = this.renderRoot.querySelector(`.order-row[data-key="${CSS.escape(e)}"]`), r = n?.querySelector(t === -1 ? ".up" : ".down");
			(r && !r.disabled ? r : n?.querySelector(".up, .down"))?.focus();
		}));
	}
	_remove(e) {
		this._draft = this._draft.filter((t) => Z(t) !== e);
	}
	async _save() {
		let { hass: e, entryId: t } = this;
		if (e && t && !this._saving) {
			this._saving = !0, this._error = void 0;
			try {
				await be(e, t, this._draft), this._close();
			} catch (e) {
				this._error = m(e, "Could not save. Try again.");
			} finally {
				this._saving = !1;
			}
		}
	}
	_onDown(e) {
		let t = (e.composedPath()[0] ?? e.target)?.closest?.(".handle")?.closest("[data-key]")?.getAttribute("data-key");
		if (t) {
			this._drag = {
				pointerId: e.pointerId,
				key: t
			}, this._dragging = t;
			try {
				e.currentTarget.setPointerCapture?.(e.pointerId);
			} catch {}
			e.preventDefault();
		}
	}
	_onMove(e) {
		let t = this._drag;
		if (!t || t.pointerId !== e.pointerId) return;
		let n = [...e.currentTarget.querySelectorAll(".order-row")].map((e) => e.getBoundingClientRect()), r = this._draft.findIndex((e) => Z(e) === t.key);
		if (r === -1 || n.length !== this._draft.length) return;
		let i = An(e.clientY, n);
		i !== r && (this._draft = jn(this._draft, r, i));
	}
	_onUp(e) {
		this._drag?.pointerId === e.pointerId && (this._drag = void 0, this._dragging = void 0);
	}
	_renderTile(e) {
		let t = this._flash?.key === e.key ? this._flash.text : void 0;
		return N`<button
      class=${U({
			tile: !0,
			on: e.on,
			off: !e.on
		})}
      ?disabled=${e.disabled}
      @click=${() => void this._press(e)}
    >
      <span class="name">${e.name}</span>
      <span class="state">${t ?? e.state}</span>
    </button>`;
	}
	_renderOrder() {
		if (this._draft.length === 0) return N`<p class="hint">Nothing chosen yet. Tick things below.</p>`;
		let e = this._draft.length - 1;
		return N`<ol
      class="order-list"
      @pointerdown=${this._onDown}
      @pointermove=${this._onMove}
      @pointerup=${this._onUp}
      @pointercancel=${this._onUp}
    >
      ${Cn(this._draft, Z, (t, n) => {
			let r = this._entry(t);
			return N`<li
            class=${U({
				"order-row": !0,
				dragging: this._dragging === r.key
			})}
            data-key=${r.key}
          >
            <span class="handle" aria-hidden="true">&#8942;&#8942;</span>
            <span class="label">
              <span class="name">${r.name}</span>
              ${r.disabled ? N`<span class="sub">${r.state}</span>` : I}
            </span>
            <button class="up" aria-label=${`Move ${r.name} up`} ?disabled=${n === 0} @click=${() => this._move(r.key, -1)}>&#9650;</button>
            <button class="down" aria-label=${`Move ${r.name} down`} ?disabled=${n === e} @click=${() => this._move(r.key, 1)}>&#9660;</button>
            <button class="remove" aria-label=${`Remove ${r.name}`} @click=${() => this._remove(r.key)}>&times;</button>
          </li>`;
		})}
    </ol>`;
	}
	_renderGroup(e) {
		let t = new Set(this._draft.map(Z));
		return N`<section class="group">
      <h4>${e.title}</h4>
      ${e.rows.map((e) => {
			let n = t.has(e.key);
			return N`<label class=${U({
				"check-row": !0,
				blocked: e.blocked && !n
			})}>
          <input
            type="checkbox"
            data-key=${e.key}
            .checked=${n}
            ?disabled=${e.blocked && !n}
            @change=${(t) => this._toggleRow(e, t.target.checked)}
          />
          <span class="label">
            <span class="name">${e.name}</span>
            ${e.note ? N`<span class="sub">${e.note}</span>` : I}
          </span>
        </label>`;
		})}
    </section>`;
	}
	_renderSheet() {
		return this._editing ? N`<div class="overlay" @keydown=${(e) => e.key === "Escape" && this._close()}>
      <div class="backdrop" @click=${this._close}></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <header>
          <h3 id="edit-title">Edit quick panel</h3>
          <button class="close" aria-label="Close" @click=${this._close}>&times;</button>
        </header>
        <div class="body">
          <section class="order">
            <h4>On the quick panel</h4>
            ${this._renderOrder()}
          </section>
          <section class="choose">
            <h4 class="section-title">Choose</h4>
            ${this._groups().map((e) => this._renderGroup(e))}
          </section>
        </div>
        ${this._error ? N`<p class="error" role="alert">${this._error}</p>` : I}
        <footer>
          <button class="cancel" @click=${this._close}>Cancel</button>
          <button class="save primary" ?disabled=${this._saving} @click=${() => void this._save()}>Save</button>
        </footer>
      </div>
    </div>` : I;
	}
	render() {
		let e = (this.home?.quick_panel ?? []).map((e) => this._entry(e));
		return N`
      <div class="head">
        <h3>Quick panel</h3>
        <div class="actions">
          <slot name="actions"></slot>
          <button class="edit" @click=${this._open}>Edit</button>
        </div>
      </div>
      ${e.length === 0 ? N`<p class="empty">Nothing here yet. Tap Edit to choose what goes on this panel.</p>` : N`<div class="tiles">${e.map((e) => this._renderTile(e))}</div>`}
      ${this._renderSheet()}
    `;
	}
	static styles = x`
    :host {
      display: block;
      color: var(--primary-text-color, #1f1d1a);
      font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    }
    h3,
    h4,
    p {
      margin: 0;
    }
    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    button:disabled {
      cursor: default;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0 8px;
      padding: 8px 12px 0 16px;
    }
    .head h3 {
      font-size: 18px;
      font-weight: 600;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .edit {
      min-height: 44px;
      padding: 0 20px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: transparent;
      font-size: 16px;
    }
    .empty,
    .hint {
      padding: 12px 16px;
      font-size: 16px;
      line-height: 1.5;
      color: var(--secondary-text-color, #5b6168);
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
      padding: 8px 12px 12px;
    }
    .tile {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      min-height: 68px;
      padding: 8px 14px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 14px;
      background: var(--card-background-color, #fff);
      text-align: left;
    }
    .tile.on {
      border-color: var(--primary-color, #2f6fed);
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 14%, var(--card-background-color, #fff));
    }
    .tile:disabled {
      opacity: 0.5;
    }
    .tile .name {
      font-size: 16px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .tile .state {
      font-size: 14px;
      color: var(--secondary-text-color, #5b6168);
    }

    .overlay {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
    }
    .sheet {
      position: relative;
      display: flex;
      flex-direction: column;
      width: min(560px, 100%);
      max-height: 92%;
      border-radius: 16px 16px 0 0;
      background: var(--card-background-color, #fff);
      box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.25);
    }
    @media (min-width: 700px) {
      .overlay {
        align-items: center;
      }
      .sheet {
        border-radius: 16px;
      }
    }
    .sheet header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px 4px 20px;
      border-bottom: 1px solid var(--divider-color, #e3e6ea);
    }
    .sheet header h3 {
      font-size: 18px;
    }
    .sheet button {
      min-height: 44px;
      min-width: 44px;
      border: 0;
      border-radius: 22px;
      background: transparent;
    }
    .sheet .close {
      font-size: 28px;
      line-height: 1;
    }
    .sheet .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 8px 0;
    }
    .sheet h4 {
      padding: 12px 12px 4px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--secondary-text-color, #5b6168);
    }
    .order-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .order-row,
    .check-row {
      display: flex;
      align-items: center;
      gap: 4px;
      min-height: 48px;
      padding: 0 4px 0 8px;
      border-radius: 10px;
    }
    .order-row {
      background: var(--secondary-background-color, #f4f5f7);
      margin-bottom: 4px;
    }
    .order-row.dragging {
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 18%, var(--card-background-color, #fff));
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    }
    .handle {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      min-height: 44px;
      color: var(--secondary-text-color, #5b6168);
      font-size: 18px;
      letter-spacing: -4px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .label {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      padding: 6px 0;
    }
    .label .name {
      font-size: 16px;
      overflow-wrap: anywhere;
    }
    .label .sub {
      font-size: 13px;
      color: var(--secondary-text-color, #5b6168);
    }
    .check-row {
      cursor: pointer;
    }
    .check-row.blocked {
      opacity: 0.55;
      cursor: default;
    }
    .check-row input {
      flex: none;
      width: 22px;
      height: 22px;
      margin: 0 12px 0 4px;
      accent-color: var(--primary-color, #2f6fed);
    }
    .error {
      margin: 0;
      padding: 10px 20px;
      font-size: 15px;
      color: var(--error-color, #c62828);
    }
    .sheet footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid var(--divider-color, #e3e6ea);
    }
    .sheet footer button {
      padding: 0 22px;
      font-size: 16px;
    }
    .sheet footer .primary {
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
      font-weight: 600;
    }
    .sheet footer .primary:disabled {
      opacity: 0.6;
    }
  `;
};
customElements.get("maxsen-quick-panel") || customElements.define("maxsen-quick-panel", Mn);
// src/walk.ts
var Nn = /(\d+)\s*-?\s*g(?:ang)?\b/i, Pn = "Pick it from the list";
function Fn(e, t) {
	let n = Nn.exec(e) ?? Nn.exec(t);
	return n ? Number(n[1]) : null;
}
function In(e) {
	return e.label || e.productName;
}
function Ln(e) {
	let t = e.id, n = e.categoryId;
	if (_.has(n)) return {
		kind: "lights",
		elementId: t,
		prompt: "Press the gang that turns this on",
		mode: "entity",
		kinds: ["light_gang"]
	};
	switch (n) {
		case "smart-switches":
		case "control-panels": return {
			kind: "device",
			elementId: t,
			prompt: `Press any button on the switch at ${In(e)}`,
			mode: "device",
			kinds: ["switch"],
			gangs: Fn(e.productName, e.variantName)
		};
		case "curtains-blinds": return {
			kind: "device",
			elementId: t,
			prompt: "Press open or close on the curtain switch",
			mode: "device",
			kinds: ["cover"],
			gangs: null
		};
		case "sensors": return {
			kind: "device",
			elementId: t,
			prompt: "Wave at the sensor, or open the door it's on",
			mode: "device",
			kinds: ["binary_sensor"],
			gangs: null
		};
		default: return {
			kind: "pick",
			elementId: t,
			prompt: Pn
		};
	}
}
function Rn(e) {
	if (e.type === "marker") return {
		x: e.x,
		y: e.y
	};
	if (e.type === "path" && e.points.length > 0) {
		let t = e.points.map((e) => e.x), n = e.points.map((e) => e.y);
		return {
			x: (Math.min(...t) + Math.max(...t)) / 2,
			y: (Math.min(...n) + Math.max(...n)) / 2
		};
	}
}
function zn(e, t) {
	let n = e.package;
	if (!n) return [];
	let r = [], i = [...n.levels].sort((e, t) => e.sortOrder - t.sortOrder);
	for (let e of i) {
		let n = /* @__PURE__ */ new Map(), i = [];
		for (let r of e.plans) {
			for (let e of r.scene.items) {
				let t = Rn(e);
				t && !n.has(e.elementId) && n.set(e.elementId, t);
			}
			for (let e of r.elements) t(e) && i.push(e);
		}
		for (let t of [!1, !0]) {
			let a = i.filter((e) => _.has(e.categoryId) === t), o = a.filter((e) => n.has(e.id)), s = a.filter((e) => !n.has(e.id));
			o.sort((e, t) => {
				let r = n.get(e.id), i = n.get(t.id);
				return r.y - i.y || r.x - i.x;
			});
			for (let t of [...o, ...s]) r.push({
				el: t,
				levelName: e.name
			});
		}
	}
	return r;
}
function Bn(e) {
	return zn(e, (t) => !e.links[t.id]).map(({ el: e }) => Ln(e));
}
var Vn = class {
	queue;
	cursor = 0;
	history = [];
	skipped = /* @__PURE__ */ new Set();
	_total;
	constructor(e) {
		this.queue = Bn(e), this._total = this.queue.length;
	}
	get current() {
		return this.queue[this.cursor];
	}
	get done() {
		return this._total - this.queue.length;
	}
	get total() {
		return this._total;
	}
	linked(e, t) {
		let n = new Set(e), r = this.queue.filter((e) => n.has(e.elementId));
		this.history.push({
			elementIds: [...e],
			link: t,
			steps: r
		}), this.removeAndAdvance(n);
	}
	skip() {
		let e = this.queue[this.cursor];
		e && (this.queue.splice(this.cursor, 1), this.queue.push(e), this.skipped.add(e.elementId), this.cursor >= this.queue.length - 1 && (this.cursor = 0));
	}
	back() {
		this.cursor > 0 && --this.cursor;
	}
	undo() {
		let e = this.history.pop();
		if (!e) return;
		let t = e.steps.filter((e) => !this.queue.some((t) => t.elementId === e.elementId));
		for (let e of t) this.skipped.delete(e.elementId);
		return this.queue.unshift(...t), this.cursor = 0, {
			elementIds: e.elementIds,
			link: e.link
		};
	}
	jump(e) {
		let t = this.queue.findIndex((t) => t.elementId === e);
		t >= 0 && (this.cursor = t);
	}
	refresh(e) {
		let t = new Map(Bn(e).map((e) => [e.elementId, e])), n = this.queue, r = n.filter((e) => t.has(e.elementId)), i = new Set(n.map((e) => e.elementId)), a = [...t.values()].filter((e) => !i.has(e.elementId)), o = (e) => this.skipped.has(e.elementId), s = [
			...r.filter((e) => !o(e)),
			...a,
			...r.filter(o)
		].map((e) => t.get(e.elementId)), c;
		for (let e = this.cursor; e < n.length; e++) {
			let r = n[e].elementId;
			if (t.has(r)) {
				c = r;
				break;
			}
		}
		this.queue = s;
		let l = c === void 0 ? -1 : s.findIndex((e) => e.elementId === c);
		this.cursor = l >= 0 ? l : 0, this._total = Math.max(this._total, s.length);
		for (let e of [...this.skipped]) t.has(e) || this.skipped.delete(e);
	}
	removeAndAdvance(e) {
		let t = 0;
		for (let n = 0; n < this.cursor; n++) e.has(this.queue[n].elementId) || t++;
		this.queue = this.queue.filter((t) => !e.has(t.elementId));
		for (let t of e) this.skipped.delete(t);
		this.cursor = t, this.cursor >= this.queue.length && (this.cursor = 0);
	}
}, Hn = 2e3, Un = 100, Wn = 3e3, Gn = 6e4, Kn = 2, qn = 4, Jn = 8, Yn = /* @__PURE__ */ new Set(["switch", "light"]), Xn = /* @__PURE__ */ new Set(["cover"]), Zn = /* @__PURE__ */ new Set(["smart-switches", "control-panels"]), Qn = (e) => e.label || e.productName;
function $n(e) {
	if (e.categoryId === "curtains-blinds") return {
		lights: !1,
		domains: Xn
	};
	if (Zn.has(e.categoryId)) return {
		lights: !1,
		domains: Yn
	};
	if (_.has(e.categoryId)) return {
		lights: !0,
		domains: Yn
	};
}
var er = class {
	hass;
	home;
	active;
	memos = /* @__PURE__ */ new Map();
	constructor(e, t) {
		this.hass = e, this.home = t;
	}
	steps() {
		let { hass: e, home: t } = this, n = /* @__PURE__ */ new Map();
		for (let { el: e, levelName: r } of zn(t, (e) => !!t.links[e.id])) {
			let i = $n(e), a = t.links[e.id];
			if (!i || !a) continue;
			let o = this.entitiesOf(a, i.domains);
			o.forEach((t, a) => {
				let s = n.get(t);
				s || (s = {
					entityId: t,
					lights: [],
					others: [],
					levelName: r,
					gang: void 0
				}, n.set(t, s)), (i.lights ? s.lights : s.others).push(e), !i.lights && o.length > 1 && (s.gang = {
					index: a + 1,
					count: o.length
				});
			});
		}
		return [...n.values()].map((e) => this.stepOf(e));
	}
	entitiesOf(e, t) {
		return e.type === "entity" ? t.has(d(e.id)) ? [e.id] : [] : p(this.hass, e.id).map((e) => e.entity_id).filter((e) => t.has(d(e))).sort((e, t) => e.localeCompare(t, "en", { numeric: !0 }));
	}
	stepOf(e) {
		let t = e.lights.length > 0 ? e.lights : e.others, n = t.map(Qn), r = e.gang ? `gang ${e.gang.index} of ${e.gang.count}` : "", i;
		if (e.lights.length === 0) i = `${n[0]}${r ? ` · ${r}` : ""}`;
		else {
			i = n.length === 1 ? n[0] : `${n[0]} and ${n.length - 1} more`;
			let t = e.others[0];
			t && (i += ` · via ${Qn(t)}${r ? `, ${r}` : ""}`);
		}
		return {
			label: i,
			levelName: e.levelName,
			entityIds: [e.entityId],
			elementIds: t.map((e) => e.id),
			highlightIds: [...t, ...e.lights.length > 0 ? e.others : []].map((e) => e.id)
		};
	}
	unavailable(e) {
		return e.entityIds.filter((e) => {
			let t = this.hass.states[e]?.state;
			return t === void 0 || t === "unavailable" || t === "unknown";
		});
	}
	run(e) {
		if (this.active) return Promise.resolve({ status: "busy" });
		let t = this.unavailable(e);
		if (t.length > 0) return Promise.resolve({
			status: "unavailable",
			entityIds: t
		});
		let n = e.entityIds.join(","), r = this.memos.get(n);
		r || (r = e.entityIds.map((e) => this.remember(e)), this.memos.set(n, r));
		let i = {
			cancelled: !1,
			skipSettle: !1,
			timer: void 0,
			wake: void 0,
			done: Promise.resolve()
		};
		return this.active = i, i.done = this.execute(r, i).finally(() => {
			this.active === i && (this.active = void 0);
		}), i.done;
	}
	async abort(e = !0) {
		let t = this.active;
		t && (t.cancelled = !0, e || (t.skipSettle = !0), clearTimeout(t.timer), t.wake?.(), await t.done);
	}
	remember(e) {
		let t = this.hass.states[e];
		return {
			id: e,
			domain: d(e),
			state: t?.state ?? "",
			attributes: t?.attributes ?? {}
		};
	}
	async execute(e, t) {
		let n, r = await Promise.allSettled(e.map((e) => this.switchAway(e)));
		for (let e of r) e.status === "rejected" && (n ??= m(e.reason, "Home Assistant refused."));
		n === void 0 && await this.wait(t);
		let i = (await Promise.allSettled(e.map((e) => this.putBack(e)))).every((e) => e.status === "fulfilled");
		return await Promise.all(e.map((e) => this.settled(e, t))), n === void 0 ? t.cancelled ? {
			status: "cancelled",
			restored: i
		} : {
			status: "done",
			restored: i
		} : {
			status: "failed",
			message: n,
			restored: i
		};
	}
	wait(e) {
		return e.cancelled ? Promise.resolve() : new Promise((t) => {
			e.wake = t, e.timer = setTimeout(t, Hn);
		});
	}
	async settled(e, t) {
		let n = e.domain === "cover" ? Gn : Wn;
		for (let r = 0; r < n && !t.skipSettle && !this.isBack(e); r += Un) await new Promise((e) => setTimeout(e, Un));
	}
	isBack(e) {
		let t = this.hass.states[e.id];
		if (!t) return !0;
		if (e.domain !== "cover") return t.state === e.state;
		if (t.state === "opening" || t.state === "closing") return !1;
		let n = e.state === "closed" || e.state === "closing";
		if (t.state !== (n ? "closed" : "open")) return !1;
		let r = e.attributes.current_position, i = t.attributes.current_position;
		return typeof r == "number" && typeof i == "number" && this.supports(e, qn, !0) ? Math.abs(i - r) <= Kn : !0;
	}
	async switchAway(e) {
		let t = { entity_id: e.id };
		e.domain === "cover" ? await this.hass.callService("cover", e.state === "closed" ? "open_cover" : "close_cover", t) : await this.hass.callService(e.domain, e.state === "on" ? "turn_off" : "turn_on", t);
	}
	async putBack(e) {
		let t = { entity_id: e.id };
		if (e.domain !== "cover") {
			await this.hass.callService(e.domain, e.state === "on" ? "turn_on" : "turn_off", t);
			return;
		}
		let n;
		if (this.supports(e, Jn, !0)) try {
			await this.hass.callService("cover", "stop_cover", t);
		} catch (e) {
			n = e;
		}
		let r = e.attributes.current_position, i = e.state === "closed" || e.state === "closing";
		if (this.supports(e, qn, typeof r == "number")) {
			let e = typeof r == "number" ? r : i ? 0 : 100;
			await this.hass.callService("cover", "set_cover_position", {
				...t,
				position: e
			});
		} else await this.hass.callService("cover", i ? "close_cover" : "open_cover", t);
		if (n !== void 0) throw n;
	}
	supports(e, t, n) {
		let r = e.attributes.supported_features;
		return typeof r == "number" ? (r & t) !== 0 : n;
	}
}, tr = 5e3, nr = "Select lights together, or other devices together, not both.", rr = 2e3, ir = "Two devices reacted. Press once more.", ar = "The walk stopped. Open Installer to carry on.", or = "Identifying stopped because installer mode was switched off.", sr = "Tap the other lights that came on", cr = "Nothing to check yet. Link a switch, light or curtain first.", lr = (e) => typeof e.name == "string", ur = (e, t) => (e ?? null) === (t ?? null) || e != null && t != null && e.type === t.type && e.id === t.id, Q = (e, t, n) => `${e} ${e === 1 ? t : n}`, $ = (e) => e.label || e.productName, dr = (e) => _.has(e.categoryId);
function fr(e) {
	return [
		`${Q(e.added.length, "new device", "new devices")} to link`,
		`${Q(e.removed.length, "device", "devices")} removed`,
		`${Q(e.changed_drawings.length, "drawing", "drawings")} updated`
	].join(", ");
}
var pr = class extends V {
	static properties = {
		hass: { attribute: !1 },
		home: { attribute: !1 },
		entryId: { attribute: !1 },
		_selected: { state: !0 },
		_multi: { state: !0 },
		_search: { state: !0 },
		_notice: { state: !0 },
		_busy: { state: !0 },
		_dialog: { state: !0 },
		_walk: { state: !0 },
		_phase: { state: !0 },
		_toast: { state: !0 },
		_group: { state: !0 },
		_ambiguous: { state: !0 },
		_includeOther: { state: !0 },
		_armed: { state: !0 },
		_check: { state: !0 }
	};
	_known = /* @__PURE__ */ new Map();
	_dialogRun = 0;
	_noticeTimer;
	_toastTimer;
	_stopListen;
	_listenToken = 0;
	_singleKey = "";
	_subscribing = Promise.resolve();
	_singleFor;
	_expected = /* @__PURE__ */ new Map();
	_announced;
	_connection;
	constructor() {
		super(), this._selected = [], this._multi = !1, this._search = "", this._busy = !1, this._phase = "waiting", this._ambiguous = !1, this._includeOther = !1, this._armed = !1;
	}
	connectedCallback() {
		super.connectedCallback(), this._bindConnection();
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._bindConnection(), clearTimeout(this._noticeTimer), this._stopListening(), this._clearToast();
		let e = this._check;
		this._check = void 0, document.removeEventListener("visibilitychange", this._onVisibility), e && (e.token++, e.all.abort(!1)), this._walk = void 0, this._group = void 0, this._armed = !1, this._singleKey = "", this._singleFor = void 0, this._expected.clear();
	}
	willUpdate(e) {
		if (e.has("hass") && (this._bindConnection(), this._check && this.hass && (this._check.all.hass = this.hass)), !e.has("home")) return;
		this._known = new Map((this.home?.package?.levels ?? []).flatMap((e) => e.plans.flatMap((t) => t.elements.map((t) => [t.id, {
			el: t,
			levelName: e.name
		}]))));
		let t = this._selected.filter((e) => this._known.has(e));
		t.length !== this._selected.length && this._select(t), this._homeChanged();
	}
	updated() {
		let e = this._check, t = e ? e.phase === "summary" || e.phase === "ending" ? void 0 : e.steps[e.index]?.elementIds[0] : this._walk?.current?.elementId;
		t !== this._announced && (this._announced = t, this.dispatchEvent(new CustomEvent("maxsen-current", {
			detail: { elementId: t },
			bubbles: !0,
			composed: !0
		})));
	}
	tap(e) {
		let t = this._known.get(e)?.el;
		if (!t || this._check) return;
		if (this._walk) {
			this._tapInWalk(t);
			return;
		}
		let n = this._selected;
		if (n.includes(e)) this._select(n.filter((t) => t !== e));
		else if (!this._multi) this._select([e]);
		else {
			let r = this._known.get(n[0] ?? "")?.el;
			if (r && dr(r) !== dr(t)) {
				this._say(nr, !1);
				return;
			}
			this._select([...n, e]);
		}
	}
	_select(e) {
		this._selected = e, e.length === 0 && (this._search = ""), this.dispatchEvent(new CustomEvent("maxsen-selection", {
			detail: { selected: e },
			bubbles: !0,
			composed: !0
		})), this._syncSingle();
	}
	_toggleMulti() {
		this._multi = !this._multi, !this._multi && this._selected.length > 1 && this._select(this._selected.slice(0, 1)), this._syncSingle();
	}
	_say(e, t) {
		this._notice = {
			text: e,
			error: t
		}, clearTimeout(this._noticeTimer), this._noticeTimer = setTimeout(() => this._notice = void 0, tr);
	}
	async _link(e, t = {}) {
		let { hass: n, entryId: r } = this;
		if (!n || !r || this._busy) return !1;
		let i = e === null ? this._selected.filter((e) => this.home?.links[e]) : this._selected;
		if (i.length === 0) return !1;
		let a = Object.fromEntries(i.map((e) => [e, this._walkHome()?.links[e] ?? null]));
		this._busy = !0;
		try {
			await v(n, r, Object.fromEntries(i.map((t) => [t, e])), { nameDevice: e?.type === "device" });
			let o = this._walk?.current, s = o?.kind === "pick" && i.includes(o.elementId);
			if (this._select([]), e && (s || t.undoable)) this._showToast({
				link: e,
				name: t.name ?? e.id,
				ids: i,
				previous: a
			});
			else {
				let n = i.length > 1, r = e === null ? "Unlinked" : "Linked";
				this._say(n ? `${r} ${i.length} elements.` : t.name ? `${r}: ${t.name}` : `${r}.`, !1);
			}
			return !0;
		} catch (e) {
			return this._say(m(e, "Could not save the link. Try again."), !0), !1;
		} finally {
			this._busy = !1;
		}
	}
	_bindConnection() {
		let e = this.isConnected ? this.hass?.connection : void 0;
		e !== this._connection && (this._connection?.removeEventListener?.("ready", this._onReconnect), this._connection = e, e?.addEventListener?.("ready", this._onReconnect));
	}
	_onReconnect = () => {
		this._listenToken++, this._stopListen = void 0;
		let e = this._walk?.current;
		this._walk ? this._phase === "waiting" && e && e.kind !== "pick" && this._listenForStep(e) : this._singleKey !== "" && (this._singleKey = "", this._syncSingle());
	};
	_listen(e, t) {
		if (this._stopListening(), this._check) return;
		let { hass: n, entryId: r } = this;
		if (!n || !r) return;
		let i = this._listenToken;
		this._subscribing = ye(n, r, e, (e) => {
			i === this._listenToken && t(e);
		}).then((e) => {
			i === this._listenToken ? this._stopListen = e : h(e);
		}, (e) => {
			i === this._listenToken && (this._say(m(e, "Could not listen for a press. Try again."), !0), this._walk || (this._armed = !1, this._singleKey = ""));
		});
	}
	_stopListening() {
		this._listenToken++, h(this._stopListen), this._stopListen = void 0;
	}
	_identifyOptions(e) {
		return {
			mode: e.mode,
			kinds: e.kinds,
			gangs: e.kind === "device" ? e.gangs : null,
			includeOther: this._includeOther
		};
	}
	_linkOf(e) {
		return "device_id" in e ? {
			type: "device",
			id: e.device_id
		} : {
			type: "entity",
			id: e.entity_id
		};
	}
	_nameOf(e, t) {
		return (this.hass && ee(e, this.hass)) ?? t;
	}
	_toggleIncludeOther() {
		this._includeOther = !this._includeOther, this._ambiguous = !1;
		let e = this._walk?.current;
		this._walk ? this._phase === "waiting" && e && e.kind !== "pick" && this._listenForStep(e) : (this._singleKey = "", this._syncSingle());
	}
	_syncSingle() {
		if (this._check) return;
		let e = !this._walk && !this._multi && this._selected.length === 1 ? this._selected[0] : void 0;
		e !== this._singleFor && (this._singleFor = e, this._armed = e !== void 0 && !this.home?.links[e]);
		let t;
		if (e !== void 0 && this._armed) {
			let n = this._known.get(e)?.el, r = n && Ln(n);
			r && r.kind !== "pick" && (t = r);
		}
		let n = t ? `${t.elementId}|${this._includeOther}` : "";
		n !== this._singleKey && (this._singleKey = n, this._ambiguous = !1, t ? this._listen(this._identifyOptions(t), (e) => void this._onSinglePress(t, e)) : this._stopListening());
	}
	_setArmed(e) {
		this._armed = e, this._syncSingle();
	}
	async _onSinglePress(e, t) {
		if ("stopped" in t) {
			this._stopListening(), this._armed = !1, this._singleKey = "", this._say(or, !0);
			return;
		}
		if ("ambiguous" in t) {
			this._ambiguous = !0;
			return;
		}
		if (!lr(t)) return;
		this._stopListening(), this._ambiguous = !1;
		let n = this._linkOf(t);
		this._selected.length === 1 && this._selected[0] === e.elementId && (await this._link(n, {
			name: this._nameOf(n, t.name),
			undoable: !0
		}) || (this._singleKey = "", this._syncSingle()));
	}
	_startWalk(e) {
		let t = this._walkHome();
		if (!t || this._walk) return;
		let n = new Vn(t);
		n.current ? (e && n.jump(e), this._walk = n, e || this._expected.clear(), this._select([]), this._beginStep()) : this._say("Every element is linked.", !1);
	}
	_beginStep() {
		let e = this._walk, t = e?.current;
		this._clearToast(), this._group = void 0, this._ambiguous = !1, this._phase = "waiting", this.requestUpdate(), !e || !t ? this._endWalk("Every element is linked.", !1) : t.kind === "pick" ? (this._stopListening(), this._select([t.elementId])) : (this._select([]), this._listenForStep(t));
	}
	_listenForStep(e) {
		this._ambiguous = !1, this._listen(this._identifyOptions(e), (t) => void this._onWalkPress(e, t));
	}
	_endWalk(e, t = !1) {
		this._stopListening(), this._clearToast(), this._walk = void 0, this._group = void 0, this._phase = "waiting", this._ambiguous = !1, this._expected.clear(), this._select([]), e && this._say(e, t);
	}
	_clearToast() {
		clearTimeout(this._toastTimer), this._toastTimer = void 0, this._toast = void 0;
	}
	async _onWalkPress(e, t) {
		let n = this._walk;
		if ("stopped" in t) {
			this._endWalk(ar, !0);
			return;
		}
		if ("ambiguous" in t) {
			this._ambiguous = !0;
			return;
		}
		let { hass: r, entryId: i } = this;
		if (!lr(t) || !n || !r || !i) return;
		this._stopListening(), this._ambiguous = !1;
		let a = this._linkOf(t), o = e.elementId, s = { [o]: this._walkHome()?.links[o] ?? null };
		this._phase = "linking";
		try {
			await v(r, i, { [o]: a }, { nameDevice: e.kind === "device" });
		} catch (t) {
			if (this._walk !== n) return;
			this._say(m(t, "Could not save the link. Try again."), !0), this._phase = "waiting", this._listenForStep(e);
			return;
		}
		this._walk === n && (e.kind === "device" ? this._showToast({
			link: a,
			name: t.name,
			ids: [o],
			previous: s
		}) : (this._group = {
			elementId: o,
			link: a,
			name: t.name,
			others: [],
			previous: s
		}, this._phase = "others"));
	}
	_showToast(e) {
		this._toast = e, this._walk && (this._phase = "linked"), clearTimeout(this._toastTimer), this._toastTimer = setTimeout(() => this._toastOver(), rr);
	}
	_toastOver() {
		this._walk ? this._advance() : this._clearToast();
	}
	_advance() {
		let e = this._toast;
		e && this._walk && this._afterLinked(e.ids, e.link);
	}
	_afterLinked(e, t) {
		let n = this._walk;
		if (!n) return;
		n.linked(e, t);
		for (let n of e) this._expected.set(n, t);
		let r = this._walkHome();
		r && n.refresh(r), this._beginStep();
	}
	async _doneGroup() {
		let { hass: e, entryId: t } = this, n = this._group, r = this._walk;
		if (!e || !t || !n || !r || this._busy) return;
		let i = { ...n.previous };
		if (n.others.length > 0) {
			for (let e of n.others) i[e] = this._walkHome()?.links[e] ?? null;
			this._busy = !0;
			try {
				await v(e, t, Object.fromEntries(n.others.map((e) => [e, n.link])));
			} catch (e) {
				this._say(m(e, "Could not save the links. Try again."), !0);
				return;
			} finally {
				this._busy = !1;
			}
			if (this._walk !== r) return;
		}
		this._group = void 0, this._select([]), this._showToast({
			link: n.link,
			name: n.name,
			ids: [n.elementId, ...n.others],
			previous: i
		});
	}
	async _undo() {
		let { hass: e, entryId: t } = this, n = this._walk, r = this._toast ?? this._group;
		if (!e || !t || !r || this._busy) return;
		let i = this._toast;
		clearTimeout(this._toastTimer), this._busy = !0;
		try {
			await v(e, t, r.previous);
		} catch (e) {
			this._say(m(e, "Could not undo the link. Try again."), !0), this._walk === n && i && this._toastOver();
			return;
		} finally {
			this._busy = !1;
		}
		if (this._walk === n) {
			if (!n) this._clearToast();
			else {
				for (let [e, t] of Object.entries(r.previous)) this._expected.set(e, t);
				this._beginStep();
			}
		}
	}
	_skip() {
		let e = this._walk;
		e && this._phase === "waiting" && (e.skip(), this._beginStep());
	}
	_back() {
		let e = this._walk;
		e && this._phase === "waiting" && (e.back(), this._beginStep());
	}
	_tapInWalk(e) {
		let t = this._walk;
		if (!t) return;
		let n = this._group;
		if (this._phase === "others" && n) {
			if (!dr(e) || e.id === n.elementId) return;
			let t = n.others.includes(e.id) ? n.others.filter((t) => t !== e.id) : [...n.others, e.id];
			this._group = {
				...n,
				others: t
			}, this._select(t);
			return;
		}
		if (this._phase !== "waiting") return;
		let r = t.current?.elementId;
		t.jump(e.id), t.current?.elementId !== r && this._beginStep();
	}
	_walkHome() {
		let e = this.home;
		if (!e || this._expected.size === 0) return e;
		let t = { ...e.links };
		for (let [e, n] of this._expected) n ? t[e] = n : delete t[e];
		return {
			...e,
			links: t
		};
	}
	_homeChanged() {
		let e = this.home;
		if (!e) return;
		for (let [t, n] of [...this._expected]) ur(e.links[t], n) && this._expected.delete(t);
		let t = this._walk;
		if (!t || this._phase !== "waiting" || this._check) return;
		let n = t.current?.elementId, r = this._walkHome();
		r && t.refresh(r), t.current?.elementId === n && t.current || this._beginStep();
	}
	_canCheck() {
		return !!this.home?.package && !this._check && !this._busy && (!this._walk || this._phase === "waiting");
	}
	async _startCheck() {
		let { hass: e } = this, t = this._walkHome();
		if (!e || !t || !this._canCheck()) return;
		let n = new er(e, t), r = n.steps();
		if (r.length === 0) {
			this._say(cr, !1);
			return;
		}
		let i = {
			all: n,
			steps: r,
			index: 0,
			phase: "running",
			ok: 0,
			wrong: 0,
			untested: 0,
			wrongElements: [],
			token: 0
		};
		document.addEventListener("visibilitychange", this._onVisibility), this._check = i, this._stopListening(), this._armed = !1, this._singleKey = "", this._singleFor = void 0, this._ambiguous = !1, this._select([]), await this._subscribing, this._check === i && this._runCheckStep();
	}
	_onVisibility = () => {
		let e = this._check;
		document.visibilityState === "hidden" && e && e.phase === "running" && e.all.abort();
	};
	async _runCheckStep() {
		let e = this._check;
		if (!e) return;
		let t = this._walkHome()?.links ?? {};
		for (; e.index < e.steps.length && e.steps[e.index].elementIds.every((e) => !t[e]);) e.index++;
		let n = e.steps[e.index];
		if (!n) {
			e.phase = "summary", this._select([]), this.requestUpdate();
			return;
		}
		let r = ++e.token;
		e.phase = "running", e.problem = void 0, this._select(n.highlightIds), this.requestUpdate();
		let i = await e.all.run(n), a = "restored" in i && !i.restored;
		if (this._check !== e || e.token !== r) a && this.isConnected && this._say(`Could not put ${n.label} back. Check it by hand.`, !0);
		else {
			if (a) e.phase = "problem", e.problem = `Could not put ${n.label} back. Check it by hand.`;
			else if (i.status === "done") e.phase = "asking";
			else if (i.status === "cancelled") e.phase = "problem", e.problem = `${n.label} was put back when the screen turned off. Run it again.`;
			else if (i.status === "unavailable") e.phase = "problem", e.problem = `${n.label} is unavailable, so it was not switched.`;
			else if (i.status === "failed") e.phase = "problem", e.problem = `Could not switch ${n.label}: ${i.message}`;
			else return;
			this.requestUpdate();
		}
	}
	_checkOk() {
		let e = this._check;
		e && e.phase === "asking" && (e.ok++, e.index++, this._runCheckStep());
	}
	async _checkWrong() {
		let { hass: e, entryId: t } = this, n = this._check, r = n?.steps[n.index];
		if (!e || !t || !n || !r || n.phase !== "asking" || this._busy) return;
		let i = this._walkHome()?.links ?? {}, a = r.elementIds.filter((e) => i[e]);
		this._busy = !0;
		try {
			a.length > 0 && await v(e, t, Object.fromEntries(a.map((e) => [e, null])));
		} catch (e) {
			this._say(m(e, "Could not unlink. Try again."), !0);
			return;
		} finally {
			this._busy = !1;
		}
		for (let e of a) this._expected.set(e, null);
		this._check === n && (n.wrong++, n.wrongElements.push(...a), n.index++, this._runCheckStep());
	}
	_checkAgain() {
		let e = this._check;
		!e || e.phase !== "asking" && e.phase !== "problem" || this._runCheckStep();
	}
	_checkSkip() {
		let e = this._check;
		e && e.phase === "problem" && (e.untested++, e.index++, this._runCheckStep());
	}
	_checkSummary(e) {
		let t = `${e.ok} OK, ${e.wrong} to relink`;
		return e.untested > 0 ? `${t}, ${e.untested} not tested` : t;
	}
	async _endCheck(e = !1) {
		let t = this._check;
		if (!t || t.phase === "ending" || (t.phase = "ending", t.token++, this.requestUpdate(), await t.all.abort(), this._check !== t)) return;
		this._check = void 0, document.removeEventListener("visibilitychange", this._onVisibility), this._select([]);
		let [n] = t.wrongElements, r = this._walk;
		if (r) {
			let e = this._walkHome();
			e && r.refresh(e), n && r.jump(n), this._beginStep();
		} else n && this._startWalk(n);
		e && this._say(`Check all stopped. ${this._checkSummary(t)}.`, !1);
	}
	async _toggleOriginal() {
		let { hass: e, entryId: t } = this;
		if (!e || !t || this._busy) return;
		let n = this.home?.display?.background === "original" ? "soft" : "original";
		this._busy = !0;
		try {
			await xe(e, t, n), this._say(n === "original" ? "Showing the original background." : "Showing the soft background.", !1);
		} catch (e) {
			this._say(m(e, "Could not change the background. Try again."), !0);
		} finally {
			this._busy = !1;
		}
	}
	async _createStarterScenes() {
		let { hass: e, entryId: t } = this;
		if (e && t && !this._busy) {
			this._busy = !0;
			try {
				await we(e, t), this._say("Starter scenes are ready on the quick panel.", !1);
			} catch (e) {
				this._say(m(e, "Could not create the scenes. Try again."), !0);
			} finally {
				this._busy = !1;
			}
		}
	}
	_openDialog(e) {
		let t = this._dialog === void 0;
		this._dialog = e, t && this.updateComplete.then(() => this.renderRoot.querySelector(".dialog .cancel")?.focus());
	}
	_closeDialog = () => {
		this._dialogRun++, this._dialog = void 0;
	};
	async _preview(e, t = ++this._dialogRun) {
		let { hass: n, entryId: r } = this;
		if (n && r) {
			this._openDialog({
				phase: "checking",
				fromFile: e !== void 0
			});
			try {
				let i = await Se(n, r, e);
				t === this._dialogRun && (this._dialog = {
					phase: "ready",
					summary: i
				});
			} catch (e) {
				t === this._dialogRun && (this._dialog = {
					phase: "error",
					error: m(e, "Could not check for changes. Try again.")
				});
			}
		}
	}
	async _chooseFile(e) {
		let t = e.target, n = t.files?.[0];
		t.value = "";
		let { hass: r } = this;
		if (!n || !r) return;
		let i = ++this._dialogRun;
		this._openDialog({
			phase: "checking",
			fromFile: !0
		});
		let a;
		try {
			a = await Ee(r, n);
		} catch {
			i === this._dialogRun && (this._dialog = {
				phase: "error",
				error: "Could not upload that file. Try again."
			});
			return;
		}
		i === this._dialogRun && await this._preview(a, i);
	}
	async _apply() {
		let { hass: e, entryId: t } = this, n = this._dialog?.summary;
		if (e && t && n) {
			this._dialog = {
				phase: "applying",
				summary: n
			};
			try {
				await Ce(e, t, n.preview_id), this._dialog = void 0, this._say("Home updated.", !1);
			} catch (e) {
				this._dialog = {
					phase: "ready",
					summary: n,
					error: m(e, "Could not update the home. Try again.")
				};
			}
		}
	}
	_status(e) {
		return this.hass ? g(e, this.home?.links[e.id], this.hass).status : "unlinked";
	}
	_linkText(e) {
		let t = this._status(e);
		if (t === "unlinked") return {
			text: "Not linked yet",
			missing: !1
		};
		let n = this.home?.links[e.id], r = n && this.hass ? ee(n, this.hass) : void 0;
		return t === "missing" || r === void 0 ? {
			text: "Missing device",
			missing: !0
		} : {
			text: `Linked to ${r}`,
			missing: !1
		};
	}
	_renderCounts() {
		let e = 0, t = 0;
		for (let { el: n } of this._known.values()) {
			let r = this._status(n);
			r === "unlinked" ? e++ : r === "missing" && t++;
		}
		let n = [e > 0 ? `${e} not linked yet` : "", t > 0 ? Q(t, "missing device", "missing devices") : ""].filter(Boolean);
		return N`<p class="counts">${n.length > 0 ? n.join(" · ") : "Everything is linked."}</p>`;
	}
	_renderSelection() {
		let e = this._selected.flatMap((e) => this._known.get(e)?.el ?? []), t = e[0];
		if (!t) return N`<p class="hint">
        ${this._multi ? "Tap several elements of the same kind, then pick one device for all of them." : "Tap an element on the drawing to link it to a device."}
      </p>`;
		let n = e.length === 1, r = n ? this._linkText(t) : void 0, i = e.some((e) => this.home?.links[e.id]);
		return N`<div class="selection">
      <div class="who">
        <div class="title">${n ? $(t) : `${e.length} selected`}</div>
        ${r ? N`<div class=${U({
			status: !0,
			missing: r.missing
		})}>${r.text}</div>` : N`<div class="status">${e.map($).join(", ")}</div>`}
      </div>
      ${i ? N`<button class="unlink" ?disabled=${this._busy} @click=${() => void this._link(null)}>Unlink</button>` : I}
    </div>`;
	}
	_renderCandidates() {
		let e = this._known.get(this._selected[0] ?? "")?.el, t = this.hass;
		if (!e || !t) return I;
		let n = this._search.trim().toLowerCase().split(/\s+/).filter(Boolean), r = he(e, t).filter((e) => {
			let t = `${e.name} ${e.area} ${e.detail ?? ""}`.toLowerCase();
			return n.every((e) => t.includes(e));
		}), i = this._selected.length === 1 ? this.home?.links[e.id] : void 0;
		return N`
      <input
        class="search"
        type="search"
        placeholder="Search by name or room"
        aria-label="Search devices"
        .value=${this._search}
        @input=${(e) => this._search = e.target.value}
      />
      ${r.length === 0 ? N`<p class="none">Nothing matches.</p>` : N`<div class="candidates">
            ${r.map((e) => N`<button
                class=${U({
			candidate: !0,
			current: i?.type === e.link.type && i.id === e.link.id
		})}
                data-link-id=${e.link.id}
                ?disabled=${this._busy}
                @click=${() => void this._link(e.link)}
              >
                <span class="name">${e.name}</span>
                <span class="sub">${[e.area, e.detail].filter(Boolean).join(" · ")}</span>
              </button>`)}
          </div>`}
    `;
	}
	_renderNotDrawn() {
		let e = [...this._known.values()].filter(({ el: e }) => !e.drawn);
		return e.length === 0 ? I : N`<section class="not-drawn">
      <h4>Not on the drawing</h4>
      ${e.map(({ el: e, levelName: t }) => {
			let n = this._linkText(e);
			return N`<button
          class=${U({
				"not-drawn-row": !0,
				selected: this._selected.includes(e.id)
			})}
          aria-pressed=${this._selected.includes(e.id) ? "true" : "false"}
          @click=${() => this.tap(e.id)}
        >
          <span class="name">${$(e)}</span>
          <span class=${U({
				sub: !0,
				missing: n.missing
			})}>${t} · ${n.text}</span>
        </button>`;
		})}
    </section>`;
	}
	_renderChanges(e, t) {
		return t.length === 0 ? I : N`<div class="changes">
      <h4>${e}</h4>
      <ul>
        ${t.map((e) => N`<li>${e}</li>`)}
      </ul>
    </div>`;
	}
	_renderDialog() {
		let e = this._dialog;
		if (!e) return I;
		let t = e.summary, n = (e) => `${e.label || e.productName} · ${e.levelName}`, r = t ? t.added.length + t.removed.length + t.changed_drawings.length > 0 : !1, i = e.phase === "checking" || e.phase === "applying";
		return N`<div class="overlay">
      <div class="backdrop"></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="refresh-title">
        <h3 id="refresh-title">Refresh the home</h3>
        ${e.phase === "checking" ? N`<p class="working">${e.fromFile ? "Reading the file…" : "Checking the planner…"}</p>` : I}
        ${t ? N`<p class="summary">${fr(t)}</p>
              ${r ? N`${this._renderChanges("New devices", t.added.map(n))}
                  ${this._renderChanges("Removed devices", t.removed.map(n))}
                  ${this._renderChanges("Updated drawings", t.changed_drawings.map((e) => `${e.levelName} · ${e.type === "lighting" ? "Lighting" : "Smart Home"}`))}` : N`<p class="nothing">Nothing has changed.</p>`}` : I}
        ${e.phase === "applying" ? N`<p class="working">Updating…</p>` : I}
        ${e.error ? N`<p class="error" role="alert">${e.error}</p>` : I}
        <div class="actions">
          <button class="cancel" ?disabled=${e.phase === "applying"} @click=${this._closeDialog}>
            ${t && r ? "Cancel" : "Close"}
          </button>
          ${t && r ? N`<button class="apply primary" ?disabled=${i} @click=${() => void this._apply()}>Apply</button>` : I}
        </div>
      </div>
    </div>`;
	}
	_renderIncludeOther() {
		return N`<button
      class="include-other"
      role="switch"
      aria-checked=${this._includeOther ? "true" : "false"}
      @click=${() => this._toggleIncludeOther()}
    >
      <span class="track"><span class="knob"></span></span>
      <span>Include other devices</span>
    </button>`;
	}
	_renderListen(e) {
		return N`<button
      class="listen"
      role="switch"
      aria-checked=${e ? "true" : "false"}
      @click=${() => this._setArmed(!e)}
    >
      <span class="track"><span class="knob"></span></span>
      <span>Listen</span>
    </button>`;
	}
	_renderPressHint() {
		if (this._walk || this._multi) return I;
		let e = this._selected.length === 1 ? this._selected[0] : void 0, t = this._known.get(e ?? "")?.el;
		return !e || !t || Ln(t).kind === "pick" ? I : this._armed ? N`<div class="press-hint">
        <p class="hint">Press the device now</p>
        ${this._ambiguous ? N`<p class="press-warning" role="alert">${ir}</p>` : I}
        ${this._renderListen(!0)} ${this._renderIncludeOther()}
      </div>` : this.home?.links[e] ? N`<button class="press-relink" @click=${() => this._setArmed(!0)}>Press to relink</button>` : N`<div class="press-tools">${this._renderListen(!1)}</div>`;
	}
	_renderPressToast() {
		let e = this._toast;
		return this._walk || !e ? I : N`<div class="press-toast" role="status">
      <span class="walk-linked">Linked: ${this._nameOf(e.link, e.name)}</span>
      <button class="press-undo" ?disabled=${this._busy} @click=${() => void this._undo()}>Undo</button>
    </div>`;
	}
	_renderWalk() {
		let e = this._walk, t = e?.current;
		if (!e || !t) return I;
		let n = this._known.get(t.elementId), r = this._walkHome()?.links ?? {}, i = 0;
		for (let e of this._known.keys()) r[e] && i++;
		let a = this._phase === "waiting", o = this._toast, s = this._group;
		return N`<section class="walk" aria-label="Linking walk">
      <div class="walk-head">
        <span class="walk-progress">${i} / ${this._known.size} linked</span>
        <button class="walk-stop" @click=${() => this._endWalk()}>Stop</button>
      </div>
      ${n ? N`<div class="walk-for">${$(n.el)} · ${n.levelName}</div>` : I}
      ${o ? N`<div class="walk-toast" role="status">
            <span class="walk-linked">Linked: ${this._nameOf(o.link, o.name)}</span>
            <button class="walk-undo" ?disabled=${this._busy} @click=${() => void this._undo()}>Undo</button>
          </div>` : N`<p class="walk-prompt" role="status">${this._phase === "others" ? sr : t.prompt}</p>`}
      ${this._ambiguous ? N`<p class="walk-warning" role="alert">${ir}</p>` : I}
      <div class="walk-actions">
        ${s ? N`<button class="walk-done primary" ?disabled=${this._busy} @click=${() => void this._doneGroup()}>Link these lights</button>
              <button class="walk-undo" ?disabled=${this._busy} @click=${() => void this._undo()}>Undo</button>` : I}
        <button class="walk-back" ?disabled=${!a} @click=${() => this._back()}>Back</button>
        <button class="walk-skip" ?disabled=${!a} @click=${() => this._skip()}>Skip</button>
      </div>
      ${this._renderIncludeOther()}
    </section>`;
	}
	_renderCheck() {
		let e = this._check;
		if (!e) return I;
		let t = e.steps[e.index], n = e.phase, r = n === "summary";
		return N`<section class="check" aria-label="Check all">
      <div class="check-head">
        <span class="check-progress">${r ? "Done" : `${e.index + 1} / ${e.steps.length}`}</span>
        ${r ? I : N`<button class="check-stop" ?disabled=${n === "ending" || this._busy} @click=${() => void this._endCheck(!0)}>Stop</button>`}
      </div>
      ${r ? N`<p class="check-summary" role="status">${this._checkSummary(e)}</p>
            <div class="check-actions">
              <button class="check-close primary" @click=${() => void this._endCheck()}>
                ${e.wrongElements.length > 0 ? "Relink now" : "Close"}
              </button>
            </div>` : N`${t ? N`<div class="check-for">${t.label} · ${t.levelName}</div>` : I}
            ${n === "problem" ? N`<p class="check-prompt check-problem" role="alert">${e.problem}</p>` : N`<p class="check-prompt" role="status">
                  ${n === "asking" ? "Was it the right one?" : n === "ending" ? "Putting it back…" : "Watch now. It switches for 2 seconds, then goes back."}
                </p>`}
            <div class="check-actions">
              ${n === "asking" ? N`<button class="check-ok primary" ?disabled=${this._busy} @click=${() => this._checkOk()}>OK</button>
                    <button class="check-wrong" ?disabled=${this._busy} @click=${() => void this._checkWrong()}>Wrong</button>` : I}
              ${n === "asking" || n === "problem" ? N`<button class="check-again" ?disabled=${this._busy} @click=${() => this._checkAgain()}>Again</button>` : I}
              ${n === "problem" ? N`<button class="check-skip" @click=${() => this._checkSkip()}>Skip</button>` : I}
            </div>`}
    </section>`;
	}
	_done() {
		this.dispatchEvent(new CustomEvent("maxsen-link-done", {
			bubbles: !0,
			composed: !0
		}));
	}
	_renderTools() {
		let e = this.home?.source === "file", t = this.home?.display?.background === "original";
		return N`
      ${this._walk ? I : N`<button class="start-walk" ?disabled=${!this.home?.package} @click=${() => this._startWalk()}>
            Start linking walk
          </button>`}
      <button class="check-all" ?disabled=${!this._canCheck()} @click=${() => void this._startCheck()}>
        Check all
      </button>
      <button class="multi" aria-pressed=${this._multi ? "true" : "false"} @click=${this._toggleMulti}>
        Select several
      </button>
      <button class="starter" ?disabled=${this._busy} @click=${() => void this._createStarterScenes()}>
        Create starter scenes
      </button>
      ${e ? I : N`<button class="refresh" @click=${() => void this._preview()}>Refresh from planner</button>`}
      <button class="choose-file" @click=${() => this.renderRoot.querySelector("input[type=\"file\"]")?.click()}>
        ${e ? "Choose a newer home file" : "Use a home file instead"}
      </button>
      <button
        class="original-background"
        role="switch"
        aria-checked=${t ? "true" : "false"}
        ?disabled=${this._busy}
        @click=${() => void this._toggleOriginal()}
      >
        <span class="track"><span class="knob"></span></span>
        <span>Original background</span>
      </button>
      <input type="file" accept=".json,application/json" hidden @change=${(e) => void this._chooseFile(e)} />
    `;
	}
	render() {
		let e = this._walk !== void 0, t = this._walk?.current?.kind === "pick" && this._phase === "waiting", n = this._check !== void 0;
		return N`
      ${n ? this._renderCheck() : this._renderWalk()}
      <div class="toolbar">
        ${this._group ? I : N`<button class="done primary" @click=${this._done}>Done</button>`}
        ${n ? I : this._renderTools()}
      </div>
      ${this._notice ? N`<p class=${U({
			notice: !0,
			error: this._notice.error
		})} role="status">${this._notice.text}</p>` : I}
      ${n ? I : N`<div class="content">
            ${this._renderPressToast()} ${e ? I : this._renderCounts()}
            ${!e || t ? this._renderSelection() : I} ${this._renderPressHint()}
            ${!e || t ? this._renderCandidates() : I}
            ${this._renderNotDrawn()}
          </div>`}
      ${this._renderDialog()}
    `;
	}
	static styles = x`
    :host {
      display: block;
      color: var(--primary-text-color, #1f1d1a);
      font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    }
    h3,
    h4,
    p {
      margin: 0;
    }
    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    button:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .toolbar {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--divider-color, #e3e6ea);
    }
    .toolbar button {
      min-height: 44px;
      padding: 0 16px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 14px;
      background: transparent;
      font-size: 15px;
      line-height: 1.2;
    }
    .toolbar button[aria-pressed='true'] {
      border-color: var(--primary-color, #2f6fed);
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 16%, transparent);
      font-weight: 600;
    }
    .toolbar button.original-background {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 12px;
      text-align: left;
    }
    .original-background .track,
    .listen .track,
    .include-other .track {
      position: relative;
      flex: none;
      width: 44px;
      height: 26px;
      border-radius: 13px;
      background: var(--disabled-color, #c4c8ce);
      transition: background 0.15s;
    }
    .original-background[aria-checked='true'] .track,
    .listen[aria-checked='true'] .track,
    .include-other[aria-checked='true'] .track {
      background: var(--primary-color, #2f6fed);
    }
    .original-background .knob,
    .listen .knob,
    .include-other .knob {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.15s;
    }
    .original-background[aria-checked='true'] .knob,
    .listen[aria-checked='true'] .knob,
    .include-other[aria-checked='true'] .knob {
      transform: translateX(18px);
    }
    .listen {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      text-align: left;
      font-size: 15px;
    }
    .press-relink {
      min-height: 44px;
      padding: 0 18px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: var(--card-background-color, #fff);
      font-size: 16px;
    }
    .press-toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 12%, transparent);
      font-size: 17px;
      font-weight: 600;
    }
    .press-undo {
      min-height: 44px;
      padding: 0 18px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: var(--card-background-color, #fff);
      font-size: 16px;
    }
    .include-other {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      text-align: left;
      font-size: 15px;
    }
    .walk,
    .check {
      /* The prompt stays in view while the rest of the tools scroll under it. */
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--divider-color, #e3e6ea);
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 8%, var(--card-background-color, #fff));
    }
    .walk-head,
    .check-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .walk-progress,
    .check-progress {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--secondary-text-color, #5b6168);
    }
    .walk-for,
    .check-for {
      font-size: 15px;
      color: var(--secondary-text-color, #5b6168);
      overflow-wrap: anywhere;
    }
    .walk-prompt,
    .check-prompt,
    .check-summary {
      font-size: 19px;
      font-weight: 600;
      line-height: 1.35;
    }
    .walk-toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 19px;
      font-weight: 600;
      line-height: 1.35;
    }
    .walk-linked {
      overflow-wrap: anywhere;
    }
    .walk-warning,
    .press-warning {
      font-size: 16px;
      font-weight: 600;
      color: var(--error-color, #b3261e);
    }
    .check-problem {
      color: var(--error-color, #b3261e);
    }
    .walk-actions,
    .check-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .walk button:not(.include-other),
    .check button,
    .press-hint button:not(.include-other):not(.listen) {
      min-height: 44px;
      padding: 0 18px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: var(--card-background-color, #fff);
      font-size: 16px;
    }
    .walk button.primary,
    .check button.primary {
      border-color: var(--primary-color, #2f6fed);
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
    }
    .press-hint {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 8%, transparent);
    }
    .press-hint .hint {
      font-size: 17px;
      font-weight: 600;
      color: var(--primary-text-color, #1f1d1a);
    }
    .primary {
      border-color: var(--primary-color, #2f6fed);
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
      font-weight: 600;
    }
    .toolbar button.primary {
      border-color: var(--primary-color, #2f6fed);
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
    }
    .notice {
      margin: 8px 12px 0;
      padding: 10px 14px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 12%, transparent);
      font-size: 15px;
    }
    .notice.error {
      background: color-mix(in srgb, var(--error-color, #c62828) 12%, transparent);
      color: var(--error-color, #b3261e);
    }
    .content {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
    }
    .counts,
    .hint,
    .none {
      font-size: 15px;
      line-height: 1.5;
      color: var(--secondary-text-color, #5b6168);
    }
    .selection {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 10%, transparent);
    }
    .who {
      flex: 1;
      min-width: 0;
    }
    .title {
      font-size: 17px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .status,
    .sub {
      font-size: 14px;
      color: var(--secondary-text-color, #5b6168);
      overflow-wrap: anywhere;
    }
    .missing {
      color: var(--error-color, #c62828);
      font-weight: 600;
    }
    .unlink {
      min-height: 44px;
      padding: 0 16px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: var(--card-background-color, #fff);
    }
    .search {
      box-sizing: border-box;
      width: 100%;
      min-height: 44px;
      padding: 0 14px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: var(--card-background-color, #fff);
      color: inherit;
      font: inherit;
      font-size: 16px;
    }
    .candidates,
    .not-drawn {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .candidate,
    .not-drawn-row {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 52px;
      padding: 6px 14px;
      border: 1px solid var(--divider-color, #e3e6ea);
      border-radius: 12px;
      background: var(--card-background-color, #fff);
      text-align: left;
    }
    .candidate.current,
    .not-drawn-row.selected {
      border-color: var(--primary-color, #2f6fed);
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 12%, var(--card-background-color, #fff));
    }
    .candidate .name,
    .not-drawn-row .name {
      font-size: 16px;
      overflow-wrap: anywhere;
    }
    h4 {
      padding: 8px 0 2px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--secondary-text-color, #5b6168);
    }

    .overlay {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
    }
    .dialog {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-sizing: border-box;
      width: min(480px, 100%);
      max-height: 100%;
      overflow-y: auto;
      padding: 20px;
      border-radius: 16px;
      background: var(--card-background-color, #fff);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .dialog h3 {
      font-size: 20px;
    }
    .dialog .summary {
      font-size: 17px;
      font-weight: 600;
      line-height: 1.4;
    }
    .dialog .working,
    .dialog .nothing {
      font-size: 16px;
      color: var(--secondary-text-color, #5b6168);
    }
    .dialog .error {
      font-size: 16px;
      color: var(--error-color, #c62828);
    }
    .dialog ul {
      margin: 0;
      padding-left: 20px;
      font-size: 15px;
      line-height: 1.6;
    }
    .dialog .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 6px;
    }
    .dialog button {
      min-height: 44px;
      min-width: 88px;
      padding: 0 20px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: transparent;
      font-size: 16px;
    }
    .dialog .primary {
      border-color: var(--primary-color, #2f6fed);
      background: var(--primary-color, #2f6fed);
    }
  `;
};
customElements.get("maxsen-link-mode") || customElements.define("maxsen-link-mode", pr);
// src/maxsen-home-panel.ts
var mr = 900, hr = [], gr = [
	2e3,
	5e3,
	1e4
], _r = 3e4, vr = class extends Error {};
function yr(e) {
	let t = typeof e == "object" && e ? e.code : void 0;
	return t === "not_found" || t === "unknown_command";
}
function br(e) {
	return gr[e] ?? _r;
}
function xr(e, t) {
	return e >= mr && e > t ? "side" : "stacked";
}
var Sr = class extends V {
	static properties = {
		hass: { attribute: !1 },
		narrow: { type: Boolean },
		panel: { attribute: !1 },
		embedded: { type: Boolean },
		_home: { state: !0 },
		_status: { state: !0 },
		_layout: { state: !0 },
		_linking: { state: !0 },
		_selected: { state: !0 },
		_current: { state: !0 }
	};
	_entryId;
	_configuredEntryId;
	_started = !1;
	_run = 0;
	_unsubscribe;
	_observer;
	_attempt = 0;
	_retryTimer;
	_connection;
	constructor() {
		super(), this.narrow = !1, this.embedded = !1, this._status = "loading", this._layout = "stacked", this._linking = !1, this._selected = [], this._current = void 0;
	}
	connectedCallback() {
		super.connectedCallback(), typeof ResizeObserver < "u" && (this._observer = new ResizeObserver((e) => {
			let t = e[0]?.contentRect;
			t && (this._layout = xr(t.width, t.height));
		}), this._observer.observe(this)), this.hass && this._listen(this.hass.connection);
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._observer?.disconnect(), this._observer = void 0, this._listen(void 0), this._stop();
	}
	_onReconnect = () => {
		this._started && (this._attempt = 0, this._resubscribe());
	};
	_listen(e) {
		e !== this._connection && (this._connection?.removeEventListener?.("ready", this._onReconnect), this._connection = e, e?.addEventListener?.("ready", this._onReconnect));
	}
	_mayInstall() {
		return !!(this.hass?.user?.is_admin && this._home?.installer_mode);
	}
	willUpdate() {
		this._linking && !this._mayInstall() && this._closeInstaller();
	}
	_closeInstaller() {
		this._linking = !1, this._selected = [], this._current = void 0;
	}
	updated(e) {
		this.hass && (this.isConnected && this._listen(this.hass.connection), this._started && e.has("panel") && this.panel?.config?.entry_id !== this._configuredEntryId && this._stop(), this._started || this._start());
	}
	_stop() {
		this._run++, this._started = !1, this._attempt = 0, clearTimeout(this._retryTimer), this._retryTimer = void 0, h(this._unsubscribe), this._unsubscribe = void 0;
	}
	_resubscribe() {
		let e = this._attempt;
		this._unsubscribe = void 0, this._stop(), this._attempt = e, this._start(!0);
	}
	async _start(e = !1) {
		let t = this.hass;
		if (!t) return;
		this._started = !0;
		let n = this._run;
		this._configuredEntryId = this.panel?.config?.entry_id, e || (this._status = "loading");
		try {
			let r = this._configuredEntryId;
			if (!r) {
				let i = await ge(t);
				if (n !== this._run) return;
				if (!i) {
					if (e && this._home) throw Error("No Maxsen entry listed yet");
					this._entryId = void 0, this._status = "none";
					return;
				}
				if (i.state !== "loaded") throw new vr(`Maxsen is ${i.state}`);
				r = i.entryId;
			}
			this._entryId = r;
			let i = await _e(t, r).catch((e) => {
				throw yr(e) ? new vr("Maxsen is not answering yet") : e;
			});
			if (n !== this._run) return;
			this._home = i, this._status = "ready";
			let a = await ve(t, r, () => void this._reload(n));
			if (n !== this._run) {
				h(a);
				return;
			}
			this._unsubscribe = a, this._attempt = 0;
		} catch (t) {
			if (n !== this._run) return;
			e && this._home || (this._status = t instanceof vr && this._attempt < gr.length ? "starting" : "error"), this._retryTimer = setTimeout(() => {
				this._retryTimer = void 0, n === this._run && this._resubscribe();
			}, br(this._attempt++));
		}
	}
	async _reload(e) {
		let t = this.hass;
		if (t && this._entryId) try {
			let n = await _e(t, this._entryId);
			e === this._run && (this._home = n);
		} catch {}
	}
	_retry() {
		this._stop(), this._start();
	}
	_renderBody() {
		switch (this._status) {
			case "loading": return N`<div class="message">Loading…</div>`;
			case "starting": return N`<div class="message">Home Assistant is starting…</div>`;
			case "none": return N`<div class="message">
          Maxsen Home is not set up yet. Add it under Settings, Devices &amp; services.
        </div>`;
			case "error": return N`<div class="message">
          Could not load the home.
          <button class="retry" @click=${this._retry}>Try again</button>
        </div>`;
			case "ready": {
				let e = this._linking;
				return N`
          <div class="body ${this._layout} ${e ? "linking" : ""}">
            <maxsen-floorplan-view
              class="view"
              .hass=${this.hass}
              .home=${this._home}
              .selected=${e ? this._selected : hr}
              .current=${e ? this._current : void 0}
              mode=${e ? "link" : "use"}
              @maxsen-element-tap=${this._onElementTap}
            ></maxsen-floorplan-view>
            <div class="quick-panel-slot">
              ${e ? N`<maxsen-link-mode
                    .hass=${this.hass}
                    .home=${this._home}
                    .entryId=${this._entryId}
                    @maxsen-selection=${(e) => this._selected = e.detail.selected}
                    @maxsen-current=${(e) => this._current = e.detail.elementId}
                    @maxsen-link-done=${this._closeInstaller}
                  ></maxsen-link-mode>` : N`<maxsen-quick-panel .hass=${this.hass} .home=${this._home} .entryId=${this._entryId}>
                    ${this._mayInstall() ? N`<button slot="actions" class="installer" @click=${() => this._linking = !0}>
                          Installer
                        </button>` : I}
                  </maxsen-quick-panel>`}
            </div>
          </div>
        `;
			}
		}
	}
	_onElementTap(e) {
		this.shadowRoot?.querySelector("maxsen-link-mode")?.tap(e.detail.elementId);
	}
	render() {
		return N`${this.embedded || !this.panel ? I : N`<div class="header">
            ${this.narrow ? N`<ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>` : I}
            <div class="title">${this._home?.package?.project.title ?? "Home"}</div>
          </div>`}${this._renderBody()}`;
	}
	static styles = x`
    :host {
      /* The sheets and dialogs of the quick panel and link tools cover the panel, not the page. */
      position: relative;
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
    .side .quick-panel-slot {
      width: 340px;
      border-left: 1px solid var(--divider-color, #e3e6ea);
    }
    .side.linking .quick-panel-slot {
      width: 380px;
    }
    .stacked .quick-panel-slot {
      max-height: 40%;
      border-top: 1px solid var(--divider-color, #e3e6ea);
    }
    .stacked.linking .quick-panel-slot {
      max-height: 55%;
    }
    .installer {
      min-height: 44px;
      padding: 0 20px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 16px;
      cursor: pointer;
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
customElements.get("maxsen-home-panel") || customElements.define("maxsen-home-panel", Sr);
// src/maxsen-floorplan-card.ts
var Cr = class extends V {
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
		return N`<maxsen-home-panel embedded .hass=${this.hass} .panel=${this._panel}></maxsen-home-panel>`;
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
customElements.get("maxsen-floorplan-card") || customElements.define("maxsen-floorplan-card", Cr), window.customCards = window.customCards ?? [], window.customCards.some((e) => e.type === "maxsen-floorplan-card") || window.customCards.push({
	type: "maxsen-floorplan-card",
	name: "Maxsen floor plan",
	description: "The floor plans of your Maxsen home, with live device state.",
	preview: !1
});
export { _ as LIGHTING_CATEGORIES, Cr as MaxsenFloorplanCard, mn as MaxsenFloorplanView, Sr as MaxsenHomePanel, pr as MaxsenLinkMode, Mn as MaxsenQuickPanel, we as createStarterScenes, ge as findEntry, _e as getHome, ye as identify, xr as layoutFor, he as linkCandidates, Te as loadImage, Ce as refreshApply, Se as refreshPreview, br as retryDelay, u as sceneToSvg, xe as setDisplay, v as setLinks, be as setQuickPanel, ve as subscribe, fr as summaryLine, Ee as uploadHomeFile, g as visualState };
