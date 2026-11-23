'use strict';

// A tiny DOM for running a qh view page's inline scripts in node:vm, so the click flow is tested
// without a browser. It parses only what qh view writes (no comments, no attributes holding '>')
// and supports one compound selector: tag, .class, [attr], [attr=value], :checked.

const vm = require('node:vm');

const VOID = new Set(['input', 'meta', 'br', 'link']);
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

class El {
  constructor(tag, attrs = {}, parent = null) {
    Object.assign(this, { tag, attrs, parent, children: [], text: '', className: attrs.class || '' });
    this.value = attrs.value ?? '';
    this.checked = 'checked' in attrs;
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()), v]));
  }
  hasAttribute(name) { return name in this.attrs; }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(t) { this.text = t; this.children = []; }
  matches(sel) {
    const m = sel.match(/^(\w+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)(:checked)?$/);
    if (!m) throw new Error(`mini-dom: unsupported selector ${sel}`);
    const [, tag, classes, attrs, checked] = m;
    if (tag && tag !== this.tag) return false;
    if (classes && !classes.slice(1).split('.').every((c) => this.className.split(/\s+/).includes(c))) return false;
    for (const [, k, v] of attrs.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) {
      if (!(k in this.attrs)) return false;
      if (v !== undefined && (k === 'value' ? this.value : this.attrs[k]) !== v) return false;
    }
    return !checked || this.checked;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (el) => el.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function parse(html) {
  const root = new El('#document');
  let at = root;
  for (const [, close, tag, rest, text] of html.matchAll(/<(\/?)(\w+)([^>]*)>|([^<]+)/g)) {
    if (text !== undefined) { at.children.push(Object.assign(new El('#text'), { text: unesc(text) })); continue; }
    const name = tag.toLowerCase();
    if (close) { while (at !== root && at.tag !== name) at = at.parent; if (at !== root) at = at.parent; continue; }
    const attrs = Object.fromEntries([...rest.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [k, v === undefined ? '' : unesc(v)]));
    const el = new El(name, attrs, at);
    at.children.push(el);
    if (!VOID.has(name)) at = el;
  }
  return root;
}

// Runs every inline script of the page; returns the document and what the page copied.
function load(html) {
  const document = parse(html);
  const copied = [];
  const ctx = {
    document,
    navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } },
    matchMedia: () => ({ matches: false }),
  };
  vm.createContext(ctx);
  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) if (!/\bsrc=/.test(attrs)) vm.runInContext(body, ctx);
  return { document, copied };
}

module.exports = { load };
