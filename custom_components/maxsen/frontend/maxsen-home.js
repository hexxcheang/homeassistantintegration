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
function h(e, t, n) {
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
var g = /* @__PURE__ */ new Set([
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
	return (g.has(e.categoryId) ? pe(de(e.categoryId), t) : me(fe(e.categoryId), t)).sort((e, t) => Number(e.area === "") - Number(t.area === "") || e.area.localeCompare(t.area) || e.name.localeCompare(t.name));
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
function ye(e, t, n) {
	return e.callWS({
		type: "maxsen/links/set",
		entry_id: t,
		updates: n
	});
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
		type: "maxsen/refresh/preview",
		entry_id: t,
		...n === void 0 ? {} : { file_id: n }
	});
}
function Se(e, t, n) {
	return e.callWS({
		type: "maxsen/refresh/apply",
		entry_id: t,
		preview_id: n
	});
}
function Ce(e, t) {
	return e.callWS({
		type: "maxsen/scenes/create_starter",
		entry_id: t
	});
}
async function we(e, t) {
	let n = await e.fetchWithAuth(t);
	if (!n.ok) throw Error(`Image ${t} answered ${n.status}`);
	return URL.createObjectURL(await n.blob());
}
async function Te(e, t) {
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
var _ = globalThis, v = _.ShadowRoot && (_.ShadyCSS === void 0 || _.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype, Ee = Symbol(), De = /* @__PURE__ */ new WeakMap(), Oe = class {
	constructor(e, t, n) {
		if (this._$cssResult$ = !0, n !== Ee) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
		this.cssText = e, this.t = t;
	}
	get styleSheet() {
		let e = this.o, t = this.t;
		if (v && e === void 0) {
			let n = t !== void 0 && t.length === 1;
			n && (e = De.get(t)), e === void 0 && ((this.o = e = new CSSStyleSheet()).replaceSync(this.cssText), n && De.set(t, e));
		}
		return e;
	}
	toString() {
		return this.cssText;
	}
}, ke = (e) => new Oe(typeof e == "string" ? e : e + "", void 0, Ee), y = (e, ...t) => new Oe(e.length === 1 ? e[0] : t.reduce((t, n, r) => t + ((e) => {
	if (!0 === e._$cssResult$) return e.cssText;
	if (typeof e == "number") return e;
	throw Error("Value passed to 'css' function must be a 'css' function result: " + e + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
})(n) + e[r + 1], e[0]), e, Ee), Ae = (e, t) => {
	if (v) e.adoptedStyleSheets = t.map((e) => e instanceof CSSStyleSheet ? e : e.styleSheet);
	else for (let n of t) {
		let t = document.createElement("style"), r = _.litNonce;
		r !== void 0 && t.setAttribute("nonce", r), t.textContent = n.cssText, e.appendChild(t);
	}
}, je = v ? (e) => e : (e) => e instanceof CSSStyleSheet ? ((e) => {
	let t = "";
	for (let n of e.cssRules) t += n.cssText;
	return ke(t);
})(e) : e, { is: Me, defineProperty: Ne, getOwnPropertyDescriptor: Pe, getOwnPropertyNames: Fe, getOwnPropertySymbols: Ie, getPrototypeOf: Le } = Object, b = globalThis, Re = b.trustedTypes, ze = Re ? Re.emptyScript : "", Be = b.reactiveElementPolyfillSupport, x = (e, t) => e, Ve = {
	toAttribute(e, t) {
		switch (t) {
			case Boolean:
				e = e ? ze : null;
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
}, He = (e, t) => !Me(e, t), Ue = {
	attribute: !0,
	type: String,
	converter: Ve,
	reflect: !1,
	useDefault: !1,
	hasChanged: He
};
Symbol.metadata ??= Symbol("metadata"), b.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var S = class extends HTMLElement {
	static addInitializer(e) {
		this._$Ei(), (this.l ??= []).push(e);
	}
	static get observedAttributes() {
		return this.finalize(), this._$Eh && [...this._$Eh.keys()];
	}
	static createProperty(e, t = Ue) {
		if (t.state && (t.attribute = !1), this._$Ei(), this.prototype.hasOwnProperty(e) && ((t = Object.create(t)).wrapped = !0), this.elementProperties.set(e, t), !t.noAccessor) {
			let n = Symbol(), r = this.getPropertyDescriptor(e, n, t);
			r !== void 0 && Ne(this.prototype, e, r);
		}
	}
	static getPropertyDescriptor(e, t, n) {
		let { get: r, set: i } = Pe(this.prototype, e) ?? {
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
		return this.elementProperties.get(e) ?? Ue;
	}
	static _$Ei() {
		if (this.hasOwnProperty(x("elementProperties"))) return;
		let e = Le(this);
		e.finalize(), e.l !== void 0 && (this.l = [...e.l]), this.elementProperties = new Map(e.elementProperties);
	}
	static finalize() {
		if (this.hasOwnProperty(x("finalized"))) return;
		if (this.finalized = !0, this._$Ei(), this.hasOwnProperty(x("properties"))) {
			let e = this.properties, t = [...Fe(e), ...Ie(e)];
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
			for (let e of n) t.unshift(je(e));
		} else e !== void 0 && t.push(je(e));
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
		return Ae(e, this.constructor.elementStyles), e;
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
			let i = (n.converter?.toAttribute === void 0 ? Ve : n.converter).toAttribute(t, n.type);
			this._$Em = e, i == null ? this.removeAttribute(r) : this.setAttribute(r, i), this._$Em = null;
		}
	}
	_$AK(e, t) {
		let n = this.constructor, r = n._$Eh.get(e);
		if (r !== void 0 && this._$Em !== r) {
			let e = n.getPropertyOptions(r), i = typeof e.converter == "function" ? { fromAttribute: e.converter } : e.converter?.fromAttribute === void 0 ? Ve : e.converter;
			this._$Em = r;
			let a = i.fromAttribute(t, e.type);
			this[r] = a ?? this._$Ej?.get(r) ?? a, this._$Em = null;
		}
	}
	requestUpdate(e, t, n, r = !1, i) {
		if (e !== void 0) {
			let a = this.constructor;
			if (!1 === r && (i = this[e]), n ??= a.getPropertyOptions(e), !((n.hasChanged ?? He)(i, t) || n.useDefault && n.reflect && i === this._$Ej?.get(e) && !this.hasAttribute(a._$Eu(e, n)))) return;
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
S.elementStyles = [], S.shadowRootOptions = { mode: "open" }, S[x("elementProperties")] = /* @__PURE__ */ new Map(), S[x("finalized")] = /* @__PURE__ */ new Map(), Be?.({ ReactiveElement: S }), (b.reactiveElementVersions ??= []).push("2.1.2");
// node_modules/lit-html/lit-html.js
var C = globalThis, We = (e) => e, w = C.trustedTypes, Ge = w ? w.createPolicy("lit-html", { createHTML: (e) => e }) : void 0, Ke = "$lit$", T = `lit$${Math.random().toFixed(9).slice(2)}$`, E = "?" + T, qe = `<${E}>`, D = document, O = () => D.createComment(""), k = (e) => e === null || typeof e != "object" && typeof e != "function", A = Array.isArray, Je = (e) => A(e) || typeof e?.[Symbol.iterator] == "function", j = "[ 	\n\f\r]", M = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g, Ye = /-->/g, Xe = />/g, N = RegExp(`>|${j}(?:([^\\s"'>=/]+)(${j}*=${j}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`, "g"), Ze = /'/g, Qe = /"/g, $e = /^(?:script|style|textarea|title)$/i, et = (e) => (t, ...n) => ({
	_$litType$: e,
	strings: t,
	values: n
}), P = et(1), F = et(2), I = Symbol.for("lit-noChange"), L = Symbol.for("lit-nothing"), tt = /* @__PURE__ */ new WeakMap(), R = D.createTreeWalker(D, 129);
function nt(e, t) {
	if (!A(e) || !e.hasOwnProperty("raw")) throw Error("invalid template strings array");
	return Ge === void 0 ? t : Ge.createHTML(t);
}
var rt = (e, t) => {
	let n = e.length - 1, r = [], i, a = t === 2 ? "<svg>" : t === 3 ? "<math>" : "", o = M;
	for (let t = 0; t < n; t++) {
		let n = e[t], s, c, l = -1, u = 0;
		for (; u < n.length && (o.lastIndex = u, c = o.exec(n), c !== null);) u = o.lastIndex, o === M ? c[1] === "!--" ? o = Ye : c[1] === void 0 ? c[2] === void 0 ? c[3] !== void 0 && (o = N) : ($e.test(c[2]) && (i = RegExp("</" + c[2], "g")), o = N) : o = Xe : o === N ? c[0] === ">" ? (o = i ?? M, l = -1) : c[1] === void 0 ? l = -2 : (l = o.lastIndex - c[2].length, s = c[1], o = c[3] === void 0 ? N : c[3] === "\"" ? Qe : Ze) : o === Qe || o === Ze ? o = N : o === Ye || o === Xe ? o = M : (o = N, i = void 0);
		let d = o === N && e[t + 1].startsWith("/>") ? " " : "";
		a += o === M ? n + qe : l >= 0 ? (r.push(s), n.slice(0, l) + Ke + n.slice(l) + T + d) : n + T + (l === -2 ? t : d);
	}
	return [nt(e, a + (e[n] || "<?>") + (t === 2 ? "</svg>" : t === 3 ? "</math>" : "")), r];
}, it = class e {
	constructor({ strings: t, _$litType$: n }, r) {
		let i;
		this.parts = [];
		let a = 0, o = 0, s = t.length - 1, c = this.parts, [l, u] = rt(t, n);
		if (this.el = e.createElement(l, r), R.currentNode = this.el.content, n === 2 || n === 3) {
			let e = this.el.content.firstChild;
			e.replaceWith(...e.childNodes);
		}
		for (; (i = R.nextNode()) !== null && c.length < s;) {
			if (i.nodeType === 1) {
				if (i.hasAttributes()) for (let e of i.getAttributeNames()) if (e.endsWith(Ke)) {
					let t = u[o++], n = i.getAttribute(e).split(T), r = /([.?@])?(.*)/.exec(t);
					c.push({
						type: 1,
						index: a,
						name: r[2],
						strings: n,
						ctor: r[1] === "." ? ot : r[1] === "?" ? st : r[1] === "@" ? ct : V
					}), i.removeAttribute(e);
				} else e.startsWith(T) && (c.push({
					type: 6,
					index: a
				}), i.removeAttribute(e));
				if ($e.test(i.tagName)) {
					let e = i.textContent.split(T), t = e.length - 1;
					if (t > 0) {
						i.textContent = w ? w.emptyScript : "";
						for (let n = 0; n < t; n++) i.append(e[n], O()), R.nextNode(), c.push({
							type: 2,
							index: ++a
						});
						i.append(e[t], O());
					}
				}
			} else if (i.nodeType === 8) {
				if (i.data === E) c.push({
					type: 2,
					index: a
				});
				else {
					let e = -1;
					for (; (e = i.data.indexOf(T, e + 1)) !== -1;) c.push({
						type: 7,
						index: a
					}), e += T.length - 1;
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
function z(e, t, n = e, r) {
	if (t === I) return t;
	let i = r === void 0 ? n._$Cl : n._$Co?.[r], a = k(t) ? void 0 : t._$litDirective$;
	return i?.constructor !== a && (i?._$AO?.(!1), a === void 0 ? i = void 0 : (i = new a(e), i._$AT(e, n, r)), r === void 0 ? n._$Cl = i : (n._$Co ??= [])[r] = i), i !== void 0 && (t = z(e, i._$AS(e, t.values), i, r)), t;
}
var at = class {
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
		R.currentNode = r;
		let i = R.nextNode(), a = 0, o = 0, s = n[0];
		for (; s !== void 0;) {
			if (a === s.index) {
				let t;
				s.type === 2 ? t = new B(i, i.nextSibling, this, e) : s.type === 1 ? t = new s.ctor(i, s.name, s.strings, this, e) : s.type === 6 && (t = new lt(i, this, e)), this._$AV.push(t), s = n[++o];
			}
			a !== s?.index && (i = R.nextNode(), a++);
		}
		return R.currentNode = D, r;
	}
	p(e) {
		let t = 0;
		for (let n of this._$AV) n !== void 0 && (n.strings === void 0 ? n._$AI(e[t]) : (n._$AI(e, n, t), t += n.strings.length - 2)), t++;
	}
}, B = class e {
	get _$AU() {
		return this._$AM?._$AU ?? this._$Cv;
	}
	constructor(e, t, n, r) {
		this.type = 2, this._$AH = L, this._$AN = void 0, this._$AA = e, this._$AB = t, this._$AM = n, this.options = r, this._$Cv = r?.isConnected ?? !0;
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
		e = z(this, e, t), k(e) ? e === L || e == null || e === "" ? (this._$AH !== L && this._$AR(), this._$AH = L) : e !== this._$AH && e !== I && this._(e) : e._$litType$ === void 0 ? e.nodeType === void 0 ? Je(e) ? this.k(e) : this._(e) : this.T(e) : this.$(e);
	}
	O(e) {
		return this._$AA.parentNode.insertBefore(e, this._$AB);
	}
	T(e) {
		this._$AH !== e && (this._$AR(), this._$AH = this.O(e));
	}
	_(e) {
		this._$AH !== L && k(this._$AH) ? this._$AA.nextSibling.data = e : this.T(D.createTextNode(e)), this._$AH = e;
	}
	$(e) {
		let { values: t, _$litType$: n } = e, r = typeof n == "number" ? this._$AC(e) : (n.el === void 0 && (n.el = it.createElement(nt(n.h, n.h[0]), this.options)), n);
		if (this._$AH?._$AD === r) this._$AH.p(t);
		else {
			let e = new at(r, this), n = e.u(this.options);
			e.p(t), this.T(n), this._$AH = e;
		}
	}
	_$AC(e) {
		let t = tt.get(e.strings);
		return t === void 0 && tt.set(e.strings, t = new it(e)), t;
	}
	k(t) {
		A(this._$AH) || (this._$AH = [], this._$AR());
		let n = this._$AH, r, i = 0;
		for (let a of t) i === n.length ? n.push(r = new e(this.O(O()), this.O(O()), this, this.options)) : r = n[i], r._$AI(a), i++;
		i < n.length && (this._$AR(r && r._$AB.nextSibling, i), n.length = i);
	}
	_$AR(e = this._$AA.nextSibling, t) {
		for (this._$AP?.(!1, !0, t); e !== this._$AB;) {
			let t = We(e).nextSibling;
			We(e).remove(), e = t;
		}
	}
	setConnected(e) {
		this._$AM === void 0 && (this._$Cv = e, this._$AP?.(e));
	}
}, V = class {
	get tagName() {
		return this.element.tagName;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	constructor(e, t, n, r, i) {
		this.type = 1, this._$AH = L, this._$AN = void 0, this.element = e, this.name = t, this._$AM = r, this.options = i, n.length > 2 || n[0] !== "" || n[1] !== "" ? (this._$AH = Array(n.length - 1).fill(/* @__PURE__ */ new String()), this.strings = n) : this._$AH = L;
	}
	_$AI(e, t = this, n, r) {
		let i = this.strings, a = !1;
		if (i === void 0) e = z(this, e, t, 0), a = !k(e) || e !== this._$AH && e !== I, a && (this._$AH = e);
		else {
			let r = e, o, s;
			for (e = i[0], o = 0; o < i.length - 1; o++) s = z(this, r[n + o], t, o), s === I && (s = this._$AH[o]), a ||= !k(s) || s !== this._$AH[o], s === L ? e = L : e !== L && (e += (s ?? "") + i[o + 1]), this._$AH[o] = s;
		}
		a && !r && this.j(e);
	}
	j(e) {
		e === L ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, e ?? "");
	}
}, ot = class extends V {
	constructor() {
		super(...arguments), this.type = 3;
	}
	j(e) {
		this.element[this.name] = e === L ? void 0 : e;
	}
}, st = class extends V {
	constructor() {
		super(...arguments), this.type = 4;
	}
	j(e) {
		this.element.toggleAttribute(this.name, !!e && e !== L);
	}
}, ct = class extends V {
	constructor(e, t, n, r, i) {
		super(e, t, n, r, i), this.type = 5;
	}
	_$AI(e, t = this) {
		if ((e = z(this, e, t, 0) ?? L) === I) return;
		let n = this._$AH, r = e === L && n !== L || e.capture !== n.capture || e.once !== n.once || e.passive !== n.passive, i = e !== L && (n === L || r);
		r && this.element.removeEventListener(this.name, this, n), i && this.element.addEventListener(this.name, this, e), this._$AH = e;
	}
	handleEvent(e) {
		typeof this._$AH == "function" ? this._$AH.call(this.options?.host ?? this.element, e) : this._$AH.handleEvent(e);
	}
}, lt = class {
	constructor(e, t, n) {
		this.element = e, this.type = 6, this._$AN = void 0, this._$AM = t, this.options = n;
	}
	get _$AU() {
		return this._$AM._$AU;
	}
	_$AI(e) {
		z(this, e);
	}
}, ut = {
	M: Ke,
	P: T,
	A: E,
	C: 1,
	L: rt,
	R: at,
	D: Je,
	V: z,
	I: B,
	H: V,
	N: st,
	U: ct,
	B: ot,
	F: lt
}, dt = C.litHtmlPolyfillSupport;
dt?.(it, B), (C.litHtmlVersions ??= []).push("3.3.3");
var ft = (e, t, n) => {
	let r = n?.renderBefore ?? t, i = r._$litPart$;
	if (i === void 0) {
		let e = n?.renderBefore ?? null;
		r._$litPart$ = i = new B(t.insertBefore(O(), e), e, void 0, n ?? {});
	}
	return i._$AI(e), i;
}, H = globalThis, U = class extends S {
	constructor() {
		super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
	}
	createRenderRoot() {
		let e = super.createRenderRoot();
		return this.renderOptions.renderBefore ??= e.firstChild, e;
	}
	update(e) {
		let t = this.render();
		this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(e), this._$Do = ft(t, this.renderRoot, this.renderOptions);
	}
	connectedCallback() {
		super.connectedCallback(), this._$Do?.setConnected(!0);
	}
	disconnectedCallback() {
		super.disconnectedCallback(), this._$Do?.setConnected(!1);
	}
	render() {
		return I;
	}
};
U._$litElement$ = !0, U.finalized = !0, H.litElementHydrateSupport?.({ LitElement: U });
var pt = H.litElementPolyfillSupport;
pt?.({ LitElement: U }), (H.litElementVersions ??= []).push("4.2.2");
// node_modules/lit-html/directive.js
var mt = {
	ATTRIBUTE: 1,
	CHILD: 2,
	PROPERTY: 3,
	BOOLEAN_ATTRIBUTE: 4,
	EVENT: 5,
	ELEMENT: 6
}, ht = (e) => (...t) => ({
	_$litDirective$: e,
	values: t
}), gt = class {
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
}, W = ht(class extends gt {
	constructor(e) {
		if (super(e), e.type !== mt.ATTRIBUTE || e.name !== "class" || e.strings?.length > 2) throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.");
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
		return I;
	}
}), G = (e) => e ?? L, _t = /* @__PURE__ */ new Set([
	"light",
	"switch",
	"fan",
	"cover"
]), vt = [
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
function K(e, t) {
	return e.type === "entity" ? t.states[e.id] ? [e.id] : [] : p(t, e.id).map((e) => e.entity_id).filter((e) => t.states[e]);
}
function q(e, t) {
	let n = (e) => {
		let n = t.states[e]?.attributes.device_class === "battery", r = vt.indexOf(d(e));
		return (r === -1 ? vt.length : r) + (n ? 100 : 0);
	};
	return [...e].sort((e, t) => n(e) - n(t))[0];
}
async function yt(e, t) {
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
// src/floorplan-view.ts
var bt = 500, xt = 8, St = 300, Ct = 30, wt = 1, Tt = 6, Et = 22, Dt = 4e3, Ot = {
	w: 800,
	h: 600
}, kt = /* @__PURE__ */ new Set([...g, "smart-switches"]), At = /* @__PURE__ */ new Set([
	"sensors",
	"aircon-controllers",
	"curtains-blinds",
	"smart-locks"
]), jt = "translate(0px, 0px) scale(1)", J = (e) => Math.round(e * 100) / 100, Y = (e, t, n) => Math.min(n, Math.max(t, e)), Mt = /* @__PURE__ */ new WeakMap();
function Nt(e) {
	let t = Mt.get(e.scene);
	return t || (t = u(e.scene), Mt.set(e.scene, t)), t;
}
var Pt = class extends U {
	static properties = {
		hass: { attribute: !1 },
		home: { attribute: !1 },
		mode: { type: String },
		selected: { attribute: !1 },
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
		super(), this.mode = "use", this.selected = [], this._planType = "smart-home", this._images = /* @__PURE__ */ new Map(), this._stage = Ot;
	}
	connectedCallback() {
		super.connectedCallback(), this.hasUpdated && this.requestUpdate();
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
		if (this.isConnected && e && t?.package) for (let n of this._visible().plans) {
			let r = n.background.imageId, i = t.image_urls[r];
			if (!i || this._images.has(r) || this._loading.has(r)) continue;
			this._loading.add(r);
			let a = this._generation;
			we(e, i).then((e) => {
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
		return !t || !this.hass ? { status: "unlinked" } : h(t, this.home?.links[e], this.hass);
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
		n.x = Y(n.x, e * (1 - n.s), 0), n.y = Y(n.y, t * (1 - n.s), 0);
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
		let i = Y(n, wt, Tt), a = (e - r.x) / r.s, o = (t - r.y) / r.s;
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
			this._press = r, this._cancelHold(), t && this.mode === "use" && (this._holdTimer = setTimeout(() => this._onHold(r), bt));
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
			if (Math.hypot(n.x - i.x, n.y - i.y) <= xt) return;
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
			n && t - n.t < St && Math.hypot(e.x - n.x, e.y - n.y) < Ct ? (this._lastTap = void 0, this._resetView()) : this._lastTap = {
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
		let o = q(K(a, t), t);
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
		let a = K(r, t), o = a.filter((e) => _t.has(d(e)));
		if (o.length === 0) {
			let e = q(a, t);
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
		this.hass && !await yt(this.hass, e) && this._showNotice("Could not reach that device.");
	}
	_showNotice(e) {
		this._notice = e, clearTimeout(this._noticeTimer), this._noticeTimer = setTimeout(() => this._notice = void 0, Dt);
	}
	_renderNode(e) {
		let t = e.attrs;
		switch (e.tag) {
			case "g": return F`<g>${(e.children ?? []).map((e) => this._renderNode(e))}</g>`;
			case "path": return F`<path
          d=${G(t.d)}
          transform=${G(t.transform)}
          fill=${G(t.fill)}
          fill-rule=${G(t["fill-rule"])}
          stroke=${G(t.stroke)}
          stroke-width=${G(t["stroke-width"])}
          stroke-linecap=${G(t["stroke-linecap"])}
          stroke-linejoin=${G(t["stroke-linejoin"])}
          stroke-dasharray=${G(t["stroke-dasharray"])}
          opacity=${G(t.opacity)}
        />`;
			case "text": return F`<text
          x=${G(t.x)}
          y=${G(t.y)}
          font-size=${G(t["font-size"])}
          font-weight=${G(t["font-weight"])}
          text-anchor=${G(t["text-anchor"])}
          dominant-baseline=${G(t["dominant-baseline"])}
          fill=${G(t.fill)}
          transform=${G(t.transform)}
          stroke=${G(t.stroke)}
          stroke-width=${G(t["stroke-width"])}
          stroke-linejoin=${G(t["stroke-linejoin"])}
          paint-order=${G(t["paint-order"])}
        >${e.text ?? ""}</text>`;
		}
	}
	_renderPill(e, t, n) {
		let r = t.length * 14 * .58 + 16.8, i = 23.8, a, o;
		if (e.type === "marker") a = e.x + e.size / 2 + 6, a + r > n && (a = e.x - e.size / 2 - 6 - r), o = e.y;
		else if (e.type === "path") {
			let t = e.points[0], n = e.points[e.points.length - 1];
			a = ((t?.x ?? 0) + (n?.x ?? 0)) / 2 - r / 2, o = ((t?.y ?? 0) + (n?.y ?? 0)) / 2 - i;
		} else return F``;
		return F`<g class="pill" transform="translate(${J(a)} ${J(o)})">
      <rect y=${-23.8 / 2} width=${r} height=${i} rx=${i / 2} />
      <text x=${r / 2} y="0" font-size=${14} text-anchor="middle" dominant-baseline="central">${t}</text>
    </g>`;
	}
	_renderLinkMarks(e, t, n) {
		if (e.type === "note") return F``;
		let r = t === "unlinked" || t === "missing", i = W({
			"link-ring": !0,
			missing: t === "missing"
		});
		if (e.type === "marker") {
			let t = Math.max(e.size * .85, 20);
			return F`
        ${n ? F`<circle class="halo" cx=${e.x} cy=${e.y} r=${J(t + 6)} />` : L}
        ${r ? F`<circle class=${i} cx=${e.x} cy=${e.y} r=${J(t)} />` : L}
      `;
		}
		return F`
      ${n ? F`<path class="halo line" d=${e.d} stroke-width=${e.strokeWidth + 16} />` : L}
      ${r ? F`<path class=${i} d=${e.d} stroke-width=${e.strokeWidth + 8} />` : L}
    `;
	}
	_renderItem(e, t, n, r) {
		let i = e.elementId, a = (t.children ?? []).map((e) => this._renderNode(e));
		if (e.type === "note" || !this._elements.has(i)) return F`<g class="static" data-element-id=${i}>${a}</g>`;
		let o = this._state(i), s = o.status === "on" && kt.has(e.categoryId) ? e.type === "path" ? "url(#maxsen-glow-path)" : "url(#maxsen-glow)" : void 0, c = o.text && At.has(e.categoryId) ? this._renderPill(e, o.text, n.width) : L, l = this.mode === "link", u = l && this.selected.includes(i);
		return F`<g
      class=${W({
			element: !0,
			[e.type]: !0,
			[o.status]: !0,
			linking: l,
			selected: u
		})}
      data-element-id=${i}
    >
      ${e.type === "marker" ? F`<circle class="hit" cx=${e.x} cy=${e.y} r=${J(r)} fill="transparent" />` : F`<path
            class="hit"
            d=${e.d}
            fill="none"
            stroke="transparent"
            stroke-width=${J(r * 2)}
            stroke-linecap="round"
            stroke-linejoin="round"
            pointer-events="stroke"
          />`}
      ${l ? this._renderLinkMarks(e, o.status, u) : L}
      ${o.status === "alert" && e.type === "marker" ? F`<circle class="alert-ring" cx=${e.x} cy=${e.y} r=${Math.max(e.size * .9, 18)} />` : L}
      <g class="glyph" filter=${G(s)}>${a}</g>
      ${c}
    </g>`;
	}
	_renderDrawing(e) {
		let t = e[0], n = this._images.get(t.background.imageId), r = Et / Math.min(this._stage.w / t.width, this._stage.h / t.height);
		return P`
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
        ${n ? F`<image href=${n} width=${t.width} height=${t.height} preserveAspectRatio="none" />` : L}
        ${e.map((e) => {
			let t = Nt(e);
			return F`<g class="plan">${e.scene.items.map((n, i) => this._renderItem(n, t[i], e, r))}</g>`;
		})}
      </svg>
    `;
	}
	_renderPopup() {
		let e = this._popup, t = this.hass;
		if (!e || !t) return L;
		let n = () => this._popup = void 0;
		return P`
      <div class="popup-layer">
        <div class="popup-backdrop" @click=${n}></div>
        <div class="popup" role="dialog" aria-label=${e.title}>
          <div class="popup-title">
            <span>${e.title}</span>
            <button class="close" aria-label="Close" @click=${n}>&times;</button>
          </div>
          ${e.entityIds.map((e) => {
			let r = t.states[e], i = typeof r?.attributes.friendly_name == "string" ? r.attributes.friendly_name : e, a = r?.state === "on" || d(e) === "cover" && r?.state !== "closed";
			return P`<div class="row">
              <button class="name" @click=${() => {
				n(), this._moreInfo(e);
			}}>${i}</button>
              <span class="state">${r?.state ?? ""}</span>
              <button
                class=${W({
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
		if (!e || e.levels.length === 0) return P`<div class="empty">No home loaded yet. An installer adds it from the Maxsen Planner.</div>`;
		let t = this._levels(), { plans: n, toggle: r } = this._visible();
		return P`
      <div class="bar">
        <div class="tabs" role="tablist">
          ${t.map((e) => P`<button
              role="tab"
              aria-selected=${e.id === this._levelId ? "true" : "false"}
              class=${W({ active: e.id === this._levelId })}
              @click=${() => this._levelId = e.id}
            >${e.name}</button>`)}
        </div>
        ${r ? P`<div class="plan-toggle" role="group">
              ${["smart-home", "lighting"].map((e) => P`<button
                  class=${W({ active: n[0]?.type === e })}
                  aria-pressed=${n[0]?.type === e ? "true" : "false"}
                  @click=${() => this._planType = e}
                >${e === "smart-home" ? "Smart Home" : "Lighting"}</button>`)}
            </div>` : L}
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
        <div class="canvas" style=${`transform: ${jt}`}>
          ${n.length > 0 ? this._renderDrawing(n) : P`<div class="empty">This level has no plan.</div>`}
        </div>
      </div>
      ${this._renderPopup()}
      ${this._notice ? P`<div class="notice" role="status">${this._notice}</div>` : L}
    `;
	}
	static styles = y`
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
customElements.get("maxsen-floorplan-view") || customElements.define("maxsen-floorplan-view", Pt);
// node_modules/lit-html/directive-helpers.js
var { I: Ft } = ut, It = (e) => e, Lt = () => document.createComment(""), X = (e, t, n) => {
	let r = e._$AA.parentNode, i = t === void 0 ? e._$AB : t._$AA;
	if (n === void 0) n = new Ft(r.insertBefore(Lt(), i), r.insertBefore(Lt(), i), e, e.options);
	else {
		let t = n._$AB.nextSibling, a = n._$AM, o = a !== e;
		if (o) {
			let t;
			n._$AQ?.(e), n._$AM = e, n._$AP !== void 0 && (t = e._$AU) !== a._$AU && n._$AP(t);
		}
		if (t !== i || o) {
			let e = n._$AA;
			for (; e !== t;) {
				let t = It(e).nextSibling;
				It(r).insertBefore(e, i), e = t;
			}
		}
	}
	return n;
}, Z = (e, t, n = e) => (e._$AI(t, n), e), Rt = {}, zt = (e, t = Rt) => e._$AH = t, Bt = (e) => e._$AH, Vt = (e) => {
	e._$AR(), e._$AA.remove();
}, Ht = (e, t, n) => {
	let r = /* @__PURE__ */ new Map();
	for (let i = t; i <= n; i++) r.set(e[i], i);
	return r;
}, Ut = ht(class extends gt {
	constructor(e) {
		if (super(e), e.type !== mt.CHILD) throw Error("repeat() can only be used in text expressions");
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
		let i = Bt(e), { values: a, keys: o } = this.dt(t, n, r);
		if (!Array.isArray(i)) return this.ut = o, a;
		let s = this.ut ??= [], c = [], l, u, d = 0, f = i.length - 1, p = 0, m = a.length - 1;
		for (; d <= f && p <= m;) if (i[d] === null) d++;
		else if (i[f] === null) f--;
		else if (s[d] === o[p]) c[p] = Z(i[d], a[p]), d++, p++;
		else if (s[f] === o[m]) c[m] = Z(i[f], a[m]), f--, m--;
		else if (s[d] === o[m]) c[m] = Z(i[d], a[m]), X(e, c[m + 1], i[d]), d++, m--;
		else if (s[f] === o[p]) c[p] = Z(i[f], a[p]), X(e, i[d], i[f]), f--, p++;
		else if (l === void 0 && (l = Ht(o, p, m), u = Ht(s, d, f)), l.has(s[d])) {
			if (l.has(s[f])) {
				let t = u.get(o[p]), n = t === void 0 ? null : i[t];
				if (n === null) {
					let t = X(e, i[d]);
					Z(t, a[p]), c[p] = t;
				} else c[p] = Z(n, a[p]), X(e, i[d], n), i[t] = null;
				p++;
			} else Vt(i[f]), f--;
		} else Vt(i[d]), d++;
		for (; p <= m;) {
			let t = X(e, c[m + 1]);
			Z(t, a[p]), c[p++] = t;
		}
		for (; d <= f;) {
			let e = i[d++];
			e !== null && Vt(e);
		}
		return this.ut = o, zt(e, c), I;
	}
}), Wt = 2e3, Gt = "Not available", Kt = {
	on: "On",
	off: "Off",
	alert: "Alert",
	idle: "",
	unavailable: "Unavailable",
	missing: "Missing device",
	unlinked: "Not linked yet"
}, Q = (e) => `${e.type}:${e.id}`, qt = (e) => e.charAt(0).toUpperCase() + e.slice(1), Jt = (e, t) => e.name.localeCompare(t.name, void 0, { numeric: !0 });
function Yt(e) {
	return e === "All off" ? 0 : e.startsWith("All off – ") ? 1 : e === "All lights off" ? 2 : 3;
}
function Xt(e, t) {
	let n = t.findIndex((t) => e < t.top + t.height / 2);
	return n === -1 ? t.length - 1 : n;
}
function Zt(e, t, n) {
	let r = [...e], [i] = r.splice(t, 1);
	return i !== void 0 && r.splice(n, 0, i), r;
}
var Qt = class extends U {
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
		let t = Q(e), n = this.hass, r = {
			key: t,
			item: e,
			name: e.id,
			state: Gt,
			on: !1,
			disabled: !0
		};
		if (!n) return r;
		if (e.type === "element") {
			let i = this._elements.get(e.id);
			if (!i) return {
				...r,
				name: Gt
			};
			let a = h(i, this.home?.links[e.id], n);
			return {
				key: t,
				item: e,
				name: i.label || i.productName,
				state: a.text ?? Kt[a.status],
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
			state: o ? "Unavailable" : d(e.id) === "scene" ? "Scene" : qt(i.state),
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
				key: Q(t),
				item: t,
				name: this._entry(t).name,
				note: "",
				blocked: !1
			};
		}).sort((e, t) => Yt(e.name) - Yt(t.name) || Jt(e, t)), n = t.length > 0 ? [{
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
					key: Q(e),
					item: e,
					name: n.label || n.productName,
					note: i ? n.label ? n.productName : "" : "Not linked yet",
					blocked: !i
				});
			}
			r.length > 0 && n.push({
				title: e.name,
				rows: r.sort(Jt)
			});
		}
		return n;
	}
	_showFlash(e, t) {
		this._flash = {
			key: e,
			text: t
		}, clearTimeout(this._flashTimer), this._flashTimer = setTimeout(() => this._flash = void 0, Wt);
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
		let r = n.type === "element" ? this.home?.links[n.id] : void 0, i = n.type === "entity" ? [n.id] : r ? K(r, t) : [], a = i.filter((e) => _t.has(d(e)));
		if (a.length > 0) {
			await yt(t, a) || this._showFlash(e.key, "Could not reach it");
			return;
		}
		let o = q(i, t);
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
		let n = this._draft.filter((t) => Q(t) !== e.key);
		this._draft = t ? [...n, e.item] : n;
	}
	_move(e, t) {
		let n = this._draft.findIndex((t) => Q(t) === e), r = n + t;
		n === -1 || r < 0 || r >= this._draft.length || (this._draft = Zt(this._draft, n, r), this.updateComplete.then(() => {
			let n = this.renderRoot.querySelector(`.order-row[data-key="${CSS.escape(e)}"]`), r = n?.querySelector(t === -1 ? ".up" : ".down");
			(r && !r.disabled ? r : n?.querySelector(".up, .down"))?.focus();
		}));
	}
	_remove(e) {
		this._draft = this._draft.filter((t) => Q(t) !== e);
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
		let n = [...e.currentTarget.querySelectorAll(".order-row")].map((e) => e.getBoundingClientRect()), r = this._draft.findIndex((e) => Q(e) === t.key);
		if (r === -1 || n.length !== this._draft.length) return;
		let i = Xt(e.clientY, n);
		i !== r && (this._draft = Zt(this._draft, r, i));
	}
	_onUp(e) {
		this._drag?.pointerId === e.pointerId && (this._drag = void 0, this._dragging = void 0);
	}
	_renderTile(e) {
		let t = this._flash?.key === e.key ? this._flash.text : void 0;
		return P`<button
      class=${W({
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
		if (this._draft.length === 0) return P`<p class="hint">Nothing chosen yet. Tick things below.</p>`;
		let e = this._draft.length - 1;
		return P`<ol
      class="order-list"
      @pointerdown=${this._onDown}
      @pointermove=${this._onMove}
      @pointerup=${this._onUp}
      @pointercancel=${this._onUp}
    >
      ${Ut(this._draft, Q, (t, n) => {
			let r = this._entry(t);
			return P`<li
            class=${W({
				"order-row": !0,
				dragging: this._dragging === r.key
			})}
            data-key=${r.key}
          >
            <span class="handle" aria-hidden="true">&#8942;&#8942;</span>
            <span class="label">
              <span class="name">${r.name}</span>
              ${r.disabled ? P`<span class="sub">${r.state}</span>` : L}
            </span>
            <button class="up" aria-label=${`Move ${r.name} up`} ?disabled=${n === 0} @click=${() => this._move(r.key, -1)}>&#9650;</button>
            <button class="down" aria-label=${`Move ${r.name} down`} ?disabled=${n === e} @click=${() => this._move(r.key, 1)}>&#9660;</button>
            <button class="remove" aria-label=${`Remove ${r.name}`} @click=${() => this._remove(r.key)}>&times;</button>
          </li>`;
		})}
    </ol>`;
	}
	_renderGroup(e) {
		let t = new Set(this._draft.map(Q));
		return P`<section class="group">
      <h4>${e.title}</h4>
      ${e.rows.map((e) => {
			let n = t.has(e.key);
			return P`<label class=${W({
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
            ${e.note ? P`<span class="sub">${e.note}</span>` : L}
          </span>
        </label>`;
		})}
    </section>`;
	}
	_renderSheet() {
		return this._editing ? P`<div class="overlay" @keydown=${(e) => e.key === "Escape" && this._close()}>
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
        ${this._error ? P`<p class="error" role="alert">${this._error}</p>` : L}
        <footer>
          <button class="cancel" @click=${this._close}>Cancel</button>
          <button class="save primary" ?disabled=${this._saving} @click=${() => void this._save()}>Save</button>
        </footer>
      </div>
    </div>` : L;
	}
	render() {
		let e = (this.home?.quick_panel ?? []).map((e) => this._entry(e));
		return P`
      <div class="head">
        <h3>Quick panel</h3>
        <div class="actions">
          <slot name="actions"></slot>
          <button class="edit" @click=${this._open}>Edit</button>
        </div>
      </div>
      ${e.length === 0 ? P`<p class="empty">Nothing here yet. Tap Edit to choose what goes on this panel.</p>` : P`<div class="tiles">${e.map((e) => this._renderTile(e))}</div>`}
      ${this._renderSheet()}
    `;
	}
	static styles = y`
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
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px 0 16px;
    }
    .head h3 {
      font-size: 18px;
      font-weight: 600;
    }
    .actions {
      display: flex;
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
customElements.get("maxsen-quick-panel") || customElements.define("maxsen-quick-panel", Qt);
// src/link-mode.ts
var $t = 5e3, en = "Select lights together, or other devices together, not both.", $ = (e, t, n) => `${e} ${e === 1 ? t : n}`, tn = (e) => e.label || e.productName, nn = (e) => g.has(e.categoryId);
function rn(e) {
	return [
		`${$(e.added.length, "new device", "new devices")} to link`,
		`${$(e.removed.length, "device", "devices")} removed`,
		`${$(e.changed_drawings.length, "drawing", "drawings")} updated`
	].join(", ");
}
var an = class extends U {
	static properties = {
		hass: { attribute: !1 },
		home: { attribute: !1 },
		entryId: { attribute: !1 },
		_selected: { state: !0 },
		_multi: { state: !0 },
		_search: { state: !0 },
		_notice: { state: !0 },
		_busy: { state: !0 },
		_dialog: { state: !0 }
	};
	_known = /* @__PURE__ */ new Map();
	_dialogRun = 0;
	_noticeTimer;
	constructor() {
		super(), this._selected = [], this._multi = !1, this._search = "", this._busy = !1;
	}
	disconnectedCallback() {
		super.disconnectedCallback(), clearTimeout(this._noticeTimer);
	}
	willUpdate(e) {
		if (!e.has("home")) return;
		this._known = new Map((this.home?.package?.levels ?? []).flatMap((e) => e.plans.flatMap((t) => t.elements.map((t) => [t.id, {
			el: t,
			levelName: e.name
		}]))));
		let t = this._selected.filter((e) => this._known.has(e));
		t.length !== this._selected.length && this._select(t);
	}
	tap(e) {
		let t = this._known.get(e)?.el;
		if (!t) return;
		let n = this._selected;
		if (n.includes(e)) this._select(n.filter((t) => t !== e));
		else if (!this._multi) this._select([e]);
		else {
			let r = this._known.get(n[0] ?? "")?.el;
			if (r && nn(r) !== nn(t)) {
				this._say(en, !1);
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
		}));
	}
	_toggleMulti() {
		this._multi = !this._multi, !this._multi && this._selected.length > 1 && this._select(this._selected.slice(0, 1));
	}
	_say(e, t) {
		this._notice = {
			text: e,
			error: t
		}, clearTimeout(this._noticeTimer), this._noticeTimer = setTimeout(() => this._notice = void 0, $t);
	}
	async _link(e) {
		let { hass: t, entryId: n } = this;
		if (!t || !n || this._busy) return;
		let r = e === null ? this._selected.filter((e) => this.home?.links[e]) : this._selected;
		if (r.length !== 0) {
			this._busy = !0;
			try {
				await ye(t, n, Object.fromEntries(r.map((t) => [t, e])));
				let i = r.length > 1, a = e === null ? "Unlinked" : "Linked";
				this._say(i ? `${a} ${r.length} elements.` : `${a}.`, !1), this._select([]);
			} catch (e) {
				this._say(m(e, "Could not save the link. Try again."), !0);
			} finally {
				this._busy = !1;
			}
		}
	}
	async _createStarterScenes() {
		let { hass: e, entryId: t } = this;
		if (e && t && !this._busy) {
			this._busy = !0;
			try {
				await Ce(e, t), this._say("Starter scenes are ready on the quick panel.", !1);
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
				let i = await xe(n, r, e);
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
			a = await Te(r, n);
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
				await Se(e, t, n.preview_id), this._dialog = void 0, this._say("Home updated.", !1);
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
		return this.hass ? h(e, this.home?.links[e.id], this.hass).status : "unlinked";
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
		let n = [e > 0 ? `${e} not linked yet` : "", t > 0 ? $(t, "missing device", "missing devices") : ""].filter(Boolean);
		return P`<p class="counts">${n.length > 0 ? n.join(" · ") : "Everything is linked."}</p>`;
	}
	_renderSelection() {
		let e = this._selected.flatMap((e) => this._known.get(e)?.el ?? []), t = e[0];
		if (!t) return P`<p class="hint">
        ${this._multi ? "Tap several elements of the same kind, then pick one device for all of them." : "Tap an element on the drawing to link it to a device."}
      </p>`;
		let n = e.length === 1, r = n ? this._linkText(t) : void 0, i = e.some((e) => this.home?.links[e.id]);
		return P`<div class="selection">
      <div class="who">
        <div class="title">${n ? tn(t) : `${e.length} selected`}</div>
        ${r ? P`<div class=${W({
			status: !0,
			missing: r.missing
		})}>${r.text}</div>` : P`<div class="status">${e.map(tn).join(", ")}</div>`}
      </div>
      ${i ? P`<button class="unlink" ?disabled=${this._busy} @click=${() => void this._link(null)}>Unlink</button>` : L}
    </div>`;
	}
	_renderCandidates() {
		let e = this._known.get(this._selected[0] ?? "")?.el, t = this.hass;
		if (!e || !t) return L;
		let n = this._search.trim().toLowerCase().split(/\s+/).filter(Boolean), r = he(e, t).filter((e) => {
			let t = `${e.name} ${e.area} ${e.detail ?? ""}`.toLowerCase();
			return n.every((e) => t.includes(e));
		}), i = this._selected.length === 1 ? this.home?.links[e.id] : void 0;
		return P`
      <input
        class="search"
        type="search"
        placeholder="Search by name or room"
        aria-label="Search devices"
        .value=${this._search}
        @input=${(e) => this._search = e.target.value}
      />
      ${r.length === 0 ? P`<p class="none">Nothing matches.</p>` : P`<div class="candidates">
            ${r.map((e) => P`<button
                class=${W({
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
		return e.length === 0 ? L : P`<section class="not-drawn">
      <h4>Not on the drawing</h4>
      ${e.map(({ el: e, levelName: t }) => {
			let n = this._linkText(e);
			return P`<button
          class=${W({
				"not-drawn-row": !0,
				selected: this._selected.includes(e.id)
			})}
          aria-pressed=${this._selected.includes(e.id) ? "true" : "false"}
          @click=${() => this.tap(e.id)}
        >
          <span class="name">${tn(e)}</span>
          <span class=${W({
				sub: !0,
				missing: n.missing
			})}>${t} · ${n.text}</span>
        </button>`;
		})}
    </section>`;
	}
	_renderChanges(e, t) {
		return t.length === 0 ? L : P`<div class="changes">
      <h4>${e}</h4>
      <ul>
        ${t.map((e) => P`<li>${e}</li>`)}
      </ul>
    </div>`;
	}
	_renderDialog() {
		let e = this._dialog;
		if (!e) return L;
		let t = e.summary, n = (e) => `${e.label || e.productName} · ${e.levelName}`, r = t ? t.added.length + t.removed.length + t.changed_drawings.length > 0 : !1, i = e.phase === "checking" || e.phase === "applying";
		return P`<div class="overlay">
      <div class="backdrop"></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="refresh-title">
        <h3 id="refresh-title">Refresh the home</h3>
        ${e.phase === "checking" ? P`<p class="working">${e.fromFile ? "Reading the file…" : "Checking the planner…"}</p>` : L}
        ${t ? P`<p class="summary">${rn(t)}</p>
              ${r ? P`${this._renderChanges("New devices", t.added.map(n))}
                  ${this._renderChanges("Removed devices", t.removed.map(n))}
                  ${this._renderChanges("Updated drawings", t.changed_drawings.map((e) => `${e.levelName} · ${e.type === "lighting" ? "Lighting" : "Smart Home"}`))}` : P`<p class="nothing">Nothing has changed.</p>`}` : L}
        ${e.phase === "applying" ? P`<p class="working">Updating…</p>` : L}
        ${e.error ? P`<p class="error" role="alert">${e.error}</p>` : L}
        <div class="actions">
          <button class="cancel" ?disabled=${e.phase === "applying"} @click=${this._closeDialog}>
            ${t && r ? "Cancel" : "Close"}
          </button>
          ${t && r ? P`<button class="apply primary" ?disabled=${i} @click=${() => void this._apply()}>Apply</button>` : L}
        </div>
      </div>
    </div>`;
	}
	_done() {
		this.dispatchEvent(new CustomEvent("maxsen-link-done", {
			bubbles: !0,
			composed: !0
		}));
	}
	render() {
		let e = this.home?.source === "file";
		return P`
      <div class="toolbar">
        <button class="done primary" @click=${this._done}>Done</button>
        <button class="multi" aria-pressed=${this._multi ? "true" : "false"} @click=${this._toggleMulti}>
          Select several
        </button>
        <button class="starter" ?disabled=${this._busy} @click=${() => void this._createStarterScenes()}>
          Create starter scenes
        </button>
        ${e ? L : P`<button class="refresh" @click=${() => void this._preview()}>Refresh from planner</button>`}
        <button class="choose-file" @click=${() => this.renderRoot.querySelector("input[type=\"file\"]")?.click()}>
          ${e ? "Choose a newer home file" : "Use a home file instead"}
        </button>
        <input type="file" accept=".json,application/json" hidden @change=${(e) => void this._chooseFile(e)} />
      </div>
      ${this._notice ? P`<p class=${W({
			notice: !0,
			error: this._notice.error
		})} role="status">${this._notice.text}</p>` : L}
      <div class="content">
        ${this._renderCounts()} ${this._renderSelection()} ${this._renderCandidates()} ${this._renderNotDrawn()}
      </div>
      ${this._renderDialog()}
    `;
	}
	static styles = y`
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
customElements.get("maxsen-link-mode") || customElements.define("maxsen-link-mode", an);
// src/maxsen-home-panel.ts
var on = 900, sn = [], cn = [
	2e3,
	5e3,
	1e4
], ln = 3e4;
function un(e) {
	return cn[e] ?? ln;
}
function dn(e) {
	try {
		Promise.resolve(e?.()).catch(() => void 0);
	} catch {}
}
function fn(e, t) {
	return e >= on && e > t ? "side" : "stacked";
}
var pn = class extends U {
	static properties = {
		hass: { attribute: !1 },
		narrow: { type: Boolean },
		panel: { attribute: !1 },
		embedded: { type: Boolean },
		_home: { state: !0 },
		_status: { state: !0 },
		_layout: { state: !0 },
		_linking: { state: !0 },
		_selected: { state: !0 }
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
		super(), this.narrow = !1, this.embedded = !1, this._status = "loading", this._layout = "stacked", this._linking = !1, this._selected = [];
	}
	connectedCallback() {
		super.connectedCallback(), typeof ResizeObserver < "u" && (this._observer = new ResizeObserver((e) => {
			let t = e[0]?.contentRect;
			t && (this._layout = fn(t.width, t.height));
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
		this._linking = !1, this._selected = [];
	}
	updated(e) {
		this.hass && (this.isConnected && this._listen(this.hass.connection), this._started && e.has("panel") && this.panel?.config?.entry_id !== this._configuredEntryId && this._stop(), this._started || this._start());
	}
	_stop() {
		this._run++, this._started = !1, this._attempt = 0, clearTimeout(this._retryTimer), this._retryTimer = void 0, dn(this._unsubscribe), this._unsubscribe = void 0;
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
			let e = this._configuredEntryId;
			if (!e) {
				let r = await ge(t);
				if (n !== this._run) return;
				if (!r) {
					this._entryId = void 0, this._status = "none";
					return;
				}
				if (r.state !== "loaded") throw Error(`Maxsen is ${r.state}`);
				e = r.entryId;
			}
			this._entryId = e;
			let r = await _e(t, e);
			if (n !== this._run) return;
			this._home = r, this._status = "ready";
			let i = await ve(t, e, () => void this._reload(n));
			if (n !== this._run) {
				dn(i);
				return;
			}
			this._unsubscribe = i, this._attempt = 0;
		} catch {
			if (n !== this._run) return;
			e && this._home || (this._status = "error"), this._retryTimer = setTimeout(() => {
				this._retryTimer = void 0, n === this._run && this._resubscribe();
			}, un(this._attempt++));
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
			case "loading": return P`<div class="message">Loading…</div>`;
			case "none": return P`<div class="message">
          Maxsen Home is not set up yet. Add it under Settings, Devices &amp; services.
        </div>`;
			case "error": return P`<div class="message">
          Could not load the home.
          <button class="retry" @click=${this._retry}>Try again</button>
        </div>`;
			case "ready": {
				let e = this._linking;
				return P`
          <div class="body ${this._layout} ${e ? "linking" : ""}">
            <maxsen-floorplan-view
              class="view"
              .hass=${this.hass}
              .home=${this._home}
              .selected=${e ? this._selected : sn}
              mode=${e ? "link" : "use"}
              @maxsen-element-tap=${this._onElementTap}
            ></maxsen-floorplan-view>
            <div class="quick-panel-slot">
              ${e ? P`<maxsen-link-mode
                    .hass=${this.hass}
                    .home=${this._home}
                    .entryId=${this._entryId}
                    @maxsen-selection=${(e) => this._selected = e.detail.selected}
                    @maxsen-link-done=${this._closeInstaller}
                  ></maxsen-link-mode>` : P`<maxsen-quick-panel .hass=${this.hass} .home=${this._home} .entryId=${this._entryId}>
                    ${this._mayInstall() ? P`<button slot="actions" class="installer" @click=${() => this._linking = !0}>
                          Installer
                        </button>` : L}
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
		return P`${this.embedded || !this.panel ? L : P`<div class="header">
            ${this.narrow ? P`<ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>` : L}
            <div class="title">${this._home?.package?.project.title ?? "Home"}</div>
          </div>`}${this._renderBody()}`;
	}
	static styles = y`
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
customElements.get("maxsen-home-panel") || customElements.define("maxsen-home-panel", pn);
// src/maxsen-floorplan-card.ts
var mn = class extends U {
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
		return P`<maxsen-home-panel embedded .hass=${this.hass} .panel=${this._panel}></maxsen-home-panel>`;
	}
	static styles = y`
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
customElements.get("maxsen-floorplan-card") || customElements.define("maxsen-floorplan-card", mn), window.customCards = window.customCards ?? [], window.customCards.some((e) => e.type === "maxsen-floorplan-card") || window.customCards.push({
	type: "maxsen-floorplan-card",
	name: "Maxsen floor plan",
	description: "The floor plans of your Maxsen home, with live device state.",
	preview: !1
});
export { g as LIGHTING_CATEGORIES, mn as MaxsenFloorplanCard, Pt as MaxsenFloorplanView, pn as MaxsenHomePanel, an as MaxsenLinkMode, Qt as MaxsenQuickPanel, Ce as createStarterScenes, ge as findEntry, _e as getHome, fn as layoutFor, he as linkCandidates, we as loadImage, Se as refreshApply, xe as refreshPreview, un as retryDelay, u as sceneToSvg, ye as setLinks, be as setQuickPanel, ve as subscribe, rn as summaryLine, Te as uploadHomeFile, h as visualState };
