"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const node_path = require("node:path");
const node_fs = require("node:fs");
const node_crypto = require("node:crypto");
const require$$0 = require("process");
const require$$0$1 = require("buffer");
const node_child_process = require("node:child_process");
const node_stream = require("node:stream");
const node_url = require("node:url");
const POOL_SIZE_MULTIPLIER = 128;
let pool, poolOffset;
function fillPool(bytes) {
  if (!pool || pool.length < bytes) {
    pool = Buffer.allocUnsafe(bytes * POOL_SIZE_MULTIPLIER);
    node_crypto.webcrypto.getRandomValues(pool);
    poolOffset = 0;
  } else if (poolOffset + bytes > pool.length) {
    node_crypto.webcrypto.getRandomValues(pool);
    poolOffset = 0;
  }
  poolOffset += bytes;
}
function random(bytes) {
  fillPool(bytes |= 0);
  return pool.subarray(poolOffset - bytes, poolOffset);
}
function customRandom(alphabet, defaultSize, getRandom) {
  let mask = (2 << 31 - Math.clz32(alphabet.length - 1 | 1)) - 1;
  let step = Math.ceil(1.6 * mask * defaultSize / alphabet.length);
  return (size = defaultSize) => {
    let id = "";
    while (true) {
      let bytes = getRandom(step);
      let i = step;
      while (i--) {
        id += alphabet[bytes[i] & mask] || "";
        if (id.length >= size) return id;
      }
    }
  };
}
function customAlphabet(alphabet, size = 21) {
  return customRandom(alphabet, size, random);
}
const gen = customAlphabet("0123456789abcdefghjkmnpqrstvwxyz", 16);
const newId = (prefix) => `${prefix}_${gen()}`;
function slugify$1(input, max = 60) {
  const s = input.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
  return s || "untitled";
}
function agentsMd(collectionName) {
  return `# ${collectionName}

This folder is a QRabbit reading collection. You are a tutor and research assistant helping the reader understand the sources here. Prefer explaining over doing.

## Layout

- \`sources/<id>/\` — one folder per source. \`source.pdf\` (or \`source.md\`) is the original; \`text.md\` is the extracted text with \`<!-- page N -->\` markers; \`source.json\` has the title and page count.
- \`threads/\` — the reader's conversations as Markdown files. Do not modify them; the app owns them.
- \`notes/\` — you may write notes here when asked.
- \`.qrabbit/\` — the app's index and state. Ignore it.

## How to answer

- Cite pages as [p.N], using the page markers in \`text.md\`.
- Write maths as LaTeX: \`$…$\` inline, \`$$…$$\` for display.
- The extracted text of equations is unreliable. When a quoted passage or \`text.md\` looks garbled, read the relevant page of \`source.pdf\` directly.
- Keep answers scoped to the question. The reader will branch if they want more.
- Do not modify \`sources/\` or \`threads/\`.
`;
}
function writeAtomic(path, data) {
  node_fs.mkdirSync(node_path.dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  node_fs.writeFileSync(tmp, data);
  node_fs.renameSync(tmp, path);
}
function readJson(path) {
  if (!node_fs.existsSync(path)) return null;
  try {
    return JSON.parse(node_fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
function writeJson(path, value) {
  writeAtomic(path, JSON.stringify(value, null, 2) + "\n");
}
function readText(path) {
  return node_fs.existsSync(path) ? node_fs.readFileSync(path, "utf8") : null;
}
const MANIFEST = "qrabbit.json";
const DIRS = { sources: "sources", threads: "threads", notes: "notes", state: ".qrabbit" };
function initCollection(dir, name) {
  node_fs.mkdirSync(dir, { recursive: true });
  for (const d of Object.values(DIRS)) node_fs.mkdirSync(node_path.join(dir, d), { recursive: true });
  const existing = readJson(node_path.join(dir, MANIFEST));
  const manifest = existing ?? {
    id: newId("col"),
    name: name ?? node_path.basename(dir),
    created: (/* @__PURE__ */ new Date()).toISOString(),
    settings: {}
  };
  if (!existing) writeJson(node_path.join(dir, MANIFEST), manifest);
  const agents = node_path.join(dir, "AGENTS.md");
  if (!node_fs.existsSync(agents)) {
    writeAtomic(agents, agentsMd(manifest.name));
    writeAtomic(node_path.join(dir, "CLAUDE.md"), agentsMd(manifest.name));
  }
  const gitignore = node_path.join(dir, ".gitignore");
  if (!node_fs.existsSync(gitignore)) writeAtomic(gitignore, `${DIRS.state}/index.sqlite
${DIRS.state}/*.tmp
`);
  return manifest;
}
function openCollection(dir) {
  const manifest = initCollection(dir);
  return { info: { path: dir, name: manifest.name, id: manifest.id, lastOpened: (/* @__PURE__ */ new Date()).toISOString() }, manifest };
}
const SOURCE_JSON = "source.json";
const TEXT_MD = "text.md";
function sourceDir(collection, id) {
  return node_path.join(collection, DIRS.sources, id);
}
function listSources(collection) {
  const root = node_path.join(collection, DIRS.sources);
  if (!node_fs.existsSync(root)) return [];
  const out = [];
  for (const name of node_fs.readdirSync(root)) {
    const dir = node_path.join(root, name);
    if (!node_fs.statSync(dir).isDirectory()) continue;
    const info = readJson(node_path.join(dir, SOURCE_JSON));
    if (info) out.push({ ...info, id: name, hasText: node_fs.existsSync(node_path.join(dir, TEXT_MD)) });
  }
  return out.sort((a, b) => a.added < b.added ? 1 : -1);
}
function uniqueId(collection, base) {
  let id = base;
  let n = 2;
  while (node_fs.existsSync(sourceDir(collection, id))) id = `${base}-${n++}`;
  return id;
}
function importFile(collection, filePath) {
  const ext = node_path.extname(filePath).toLowerCase();
  const kind = ext === ".pdf" ? "pdf" : ext === ".md" || ext === ".markdown" || ext === ".txt" ? "markdown" : null;
  if (!kind) throw new Error(`Unsupported source type: ${ext || "(no extension)"}`);
  const title = node_path.basename(filePath, node_path.extname(filePath));
  const id = uniqueId(collection, slugify$1(title));
  const dir = sourceDir(collection, id);
  node_fs.mkdirSync(dir, { recursive: true });
  const file2 = kind === "pdf" ? "source.pdf" : "source.md";
  node_fs.copyFileSync(filePath, node_path.join(dir, file2));
  const info = { id, kind, title, file: file2, added: (/* @__PURE__ */ new Date()).toISOString(), hasText: false };
  if (kind === "markdown") {
    const text2 = node_fs.readFileSync(filePath, "utf8");
    writeAtomic(node_path.join(dir, TEXT_MD), `<!-- page 1 -->
${text2}`);
    info.pages = 1;
    info.hasText = true;
  }
  writeJson(node_path.join(dir, SOURCE_JSON), info);
  return info;
}
function readSourceBytes(collection, id) {
  const info = readJson(node_path.join(sourceDir(collection, id), SOURCE_JSON));
  if (!info) throw new Error(`Unknown source: ${id}`);
  return new Uint8Array(node_fs.readFileSync(node_path.join(sourceDir(collection, id), info.file)));
}
function readSourceText(collection, id) {
  return readText(node_path.join(sourceDir(collection, id), TEXT_MD));
}
function saveSourceText(collection, id, text2, pages, title) {
  const dir = sourceDir(collection, id);
  const info = readJson(node_path.join(dir, SOURCE_JSON));
  if (!info) throw new Error(`Unknown source: ${id}`);
  writeAtomic(node_path.join(dir, TEXT_MD), text2);
  const next = { ...info, id, pages, hasText: true, title: title?.trim() ? title.trim() : info.title };
  writeJson(node_path.join(dir, SOURCE_JSON), next);
  return next;
}
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var dist = {};
var composer = {};
var directives = {};
var identity = {};
var hasRequiredIdentity;
function requireIdentity() {
  if (hasRequiredIdentity) return identity;
  hasRequiredIdentity = 1;
  const ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
  const DOC = /* @__PURE__ */ Symbol.for("yaml.document");
  const MAP = /* @__PURE__ */ Symbol.for("yaml.map");
  const PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
  const SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
  const SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
  const NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
  const isAlias = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === ALIAS;
  const isDocument = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === DOC;
  const isMap = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === MAP;
  const isPair = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === PAIR;
  const isScalar = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === SCALAR;
  const isSeq = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === SEQ;
  function isCollection(node2) {
    if (node2 && typeof node2 === "object")
      switch (node2[NODE_TYPE]) {
        case MAP:
        case SEQ:
          return true;
      }
    return false;
  }
  function isNode(node2) {
    if (node2 && typeof node2 === "object")
      switch (node2[NODE_TYPE]) {
        case ALIAS:
        case MAP:
        case SCALAR:
        case SEQ:
          return true;
      }
    return false;
  }
  const hasAnchor = (node2) => (isScalar(node2) || isCollection(node2)) && !!node2.anchor;
  identity.ALIAS = ALIAS;
  identity.DOC = DOC;
  identity.MAP = MAP;
  identity.NODE_TYPE = NODE_TYPE;
  identity.PAIR = PAIR;
  identity.SCALAR = SCALAR;
  identity.SEQ = SEQ;
  identity.hasAnchor = hasAnchor;
  identity.isAlias = isAlias;
  identity.isCollection = isCollection;
  identity.isDocument = isDocument;
  identity.isMap = isMap;
  identity.isNode = isNode;
  identity.isPair = isPair;
  identity.isScalar = isScalar;
  identity.isSeq = isSeq;
  return identity;
}
var visit = {};
var hasRequiredVisit;
function requireVisit() {
  if (hasRequiredVisit) return visit;
  hasRequiredVisit = 1;
  var identity2 = requireIdentity();
  const BREAK = /* @__PURE__ */ Symbol("break visit");
  const SKIP = /* @__PURE__ */ Symbol("skip children");
  const REMOVE = /* @__PURE__ */ Symbol("remove node");
  function visit$1(node2, visitor) {
    const visitor_ = initVisitor(visitor);
    if (identity2.isDocument(node2)) {
      const cd = visit_(null, node2.contents, visitor_, Object.freeze([node2]));
      if (cd === REMOVE)
        node2.contents = null;
    } else
      visit_(null, node2, visitor_, Object.freeze([]));
  }
  visit$1.BREAK = BREAK;
  visit$1.SKIP = SKIP;
  visit$1.REMOVE = REMOVE;
  function visit_(key, node2, visitor, path) {
    const ctrl = callVisitor(key, node2, visitor, path);
    if (identity2.isNode(ctrl) || identity2.isPair(ctrl)) {
      replaceNode(key, path, ctrl);
      return visit_(key, ctrl, visitor, path);
    }
    if (typeof ctrl !== "symbol") {
      if (identity2.isCollection(node2)) {
        path = Object.freeze(path.concat(node2));
        for (let i = 0; i < node2.items.length; ++i) {
          const ci = visit_(i, node2.items[i], visitor, path);
          if (typeof ci === "number")
            i = ci - 1;
          else if (ci === BREAK)
            return BREAK;
          else if (ci === REMOVE) {
            node2.items.splice(i, 1);
            i -= 1;
          }
        }
      } else if (identity2.isPair(node2)) {
        path = Object.freeze(path.concat(node2));
        const ck = visit_("key", node2.key, visitor, path);
        if (ck === BREAK)
          return BREAK;
        else if (ck === REMOVE)
          node2.key = null;
        const cv = visit_("value", node2.value, visitor, path);
        if (cv === BREAK)
          return BREAK;
        else if (cv === REMOVE)
          node2.value = null;
      }
    }
    return ctrl;
  }
  async function visitAsync(node2, visitor) {
    const visitor_ = initVisitor(visitor);
    if (identity2.isDocument(node2)) {
      const cd = await visitAsync_(null, node2.contents, visitor_, Object.freeze([node2]));
      if (cd === REMOVE)
        node2.contents = null;
    } else
      await visitAsync_(null, node2, visitor_, Object.freeze([]));
  }
  visitAsync.BREAK = BREAK;
  visitAsync.SKIP = SKIP;
  visitAsync.REMOVE = REMOVE;
  async function visitAsync_(key, node2, visitor, path) {
    const ctrl = await callVisitor(key, node2, visitor, path);
    if (identity2.isNode(ctrl) || identity2.isPair(ctrl)) {
      replaceNode(key, path, ctrl);
      return visitAsync_(key, ctrl, visitor, path);
    }
    if (typeof ctrl !== "symbol") {
      if (identity2.isCollection(node2)) {
        path = Object.freeze(path.concat(node2));
        for (let i = 0; i < node2.items.length; ++i) {
          const ci = await visitAsync_(i, node2.items[i], visitor, path);
          if (typeof ci === "number")
            i = ci - 1;
          else if (ci === BREAK)
            return BREAK;
          else if (ci === REMOVE) {
            node2.items.splice(i, 1);
            i -= 1;
          }
        }
      } else if (identity2.isPair(node2)) {
        path = Object.freeze(path.concat(node2));
        const ck = await visitAsync_("key", node2.key, visitor, path);
        if (ck === BREAK)
          return BREAK;
        else if (ck === REMOVE)
          node2.key = null;
        const cv = await visitAsync_("value", node2.value, visitor, path);
        if (cv === BREAK)
          return BREAK;
        else if (cv === REMOVE)
          node2.value = null;
      }
    }
    return ctrl;
  }
  function initVisitor(visitor) {
    if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
      return Object.assign({
        Alias: visitor.Node,
        Map: visitor.Node,
        Scalar: visitor.Node,
        Seq: visitor.Node
      }, visitor.Value && {
        Map: visitor.Value,
        Scalar: visitor.Value,
        Seq: visitor.Value
      }, visitor.Collection && {
        Map: visitor.Collection,
        Seq: visitor.Collection
      }, visitor);
    }
    return visitor;
  }
  function callVisitor(key, node2, visitor, path) {
    if (typeof visitor === "function")
      return visitor(key, node2, path);
    if (identity2.isMap(node2))
      return visitor.Map?.(key, node2, path);
    if (identity2.isSeq(node2))
      return visitor.Seq?.(key, node2, path);
    if (identity2.isPair(node2))
      return visitor.Pair?.(key, node2, path);
    if (identity2.isScalar(node2))
      return visitor.Scalar?.(key, node2, path);
    if (identity2.isAlias(node2))
      return visitor.Alias?.(key, node2, path);
    return void 0;
  }
  function replaceNode(key, path, node2) {
    const parent = path[path.length - 1];
    if (identity2.isCollection(parent)) {
      parent.items[key] = node2;
    } else if (identity2.isPair(parent)) {
      if (key === "key")
        parent.key = node2;
      else
        parent.value = node2;
    } else if (identity2.isDocument(parent)) {
      parent.contents = node2;
    } else {
      const pt = identity2.isAlias(parent) ? "alias" : "scalar";
      throw new Error(`Cannot replace node with ${pt} parent`);
    }
  }
  visit.visit = visit$1;
  visit.visitAsync = visitAsync;
  return visit;
}
var hasRequiredDirectives;
function requireDirectives() {
  if (hasRequiredDirectives) return directives;
  hasRequiredDirectives = 1;
  var identity2 = requireIdentity();
  var visit2 = requireVisit();
  const escapeChars = {
    "!": "%21",
    ",": "%2C",
    "[": "%5B",
    "]": "%5D",
    "{": "%7B",
    "}": "%7D"
  };
  const escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
  class Directives {
    constructor(yaml, tags2) {
      this.docStart = null;
      this.docEnd = false;
      this.yaml = Object.assign({}, Directives.defaultYaml, yaml);
      this.tags = Object.assign({}, Directives.defaultTags, tags2);
    }
    clone() {
      const copy = new Directives(this.yaml, this.tags);
      copy.docStart = this.docStart;
      return copy;
    }
    /**
     * During parsing, get a Directives instance for the current document and
     * update the stream state according to the current version's spec.
     */
    atDocument() {
      const res = new Directives(this.yaml, this.tags);
      switch (this.yaml.version) {
        case "1.1":
          this.atNextDocument = true;
          break;
        case "1.2":
          this.atNextDocument = false;
          this.yaml = {
            explicit: Directives.defaultYaml.explicit,
            version: "1.2"
          };
          this.tags = Object.assign({}, Directives.defaultTags);
          break;
      }
      return res;
    }
    /**
     * @param onError - May be called even if the action was successful
     * @returns `true` on success
     */
    add(line, onError) {
      if (this.atNextDocument) {
        this.yaml = { explicit: Directives.defaultYaml.explicit, version: "1.1" };
        this.tags = Object.assign({}, Directives.defaultTags);
        this.atNextDocument = false;
      }
      const parts = line.trim().split(/[ \t]+/);
      const name = parts.shift();
      switch (name) {
        case "%TAG": {
          if (parts.length !== 2) {
            onError(0, "%TAG directive should contain exactly two parts");
            if (parts.length < 2)
              return false;
          }
          const [handle, prefix] = parts;
          this.tags[handle] = prefix;
          return true;
        }
        case "%YAML": {
          this.yaml.explicit = true;
          if (parts.length !== 1) {
            onError(0, "%YAML directive should contain exactly one part");
            return false;
          }
          const [version2] = parts;
          if (version2 === "1.1" || version2 === "1.2") {
            this.yaml.version = version2;
            return true;
          } else {
            const isValid = /^\d+\.\d+$/.test(version2);
            onError(6, `Unsupported YAML version ${version2}`, isValid);
            return false;
          }
        }
        default:
          onError(0, `Unknown directive ${name}`, true);
          return false;
      }
    }
    /**
     * Resolves a tag, matching handles to those defined in %TAG directives.
     *
     * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
     *   `'!local'` tag, or `null` if unresolvable.
     */
    tagName(source, onError) {
      if (source === "!")
        return "!";
      if (source[0] !== "!") {
        onError(`Not a valid tag: ${source}`);
        return null;
      }
      if (source[1] === "<") {
        const verbatim = source.slice(2, -1);
        if (verbatim === "!" || verbatim === "!!") {
          onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
          return null;
        }
        if (source[source.length - 1] !== ">")
          onError("Verbatim tags must end with a >");
        return verbatim;
      }
      const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
      if (!suffix)
        onError(`The ${source} tag has no suffix`);
      const prefix = this.tags[handle];
      if (prefix) {
        try {
          return prefix + decodeURIComponent(suffix);
        } catch (error2) {
          onError(String(error2));
          return null;
        }
      }
      if (handle === "!")
        return source;
      onError(`Could not resolve tag: ${source}`);
      return null;
    }
    /**
     * Given a fully resolved tag, returns its printable string form,
     * taking into account current tag prefixes and defaults.
     */
    tagString(tag) {
      for (const [handle, prefix] of Object.entries(this.tags)) {
        if (tag.startsWith(prefix))
          return handle + escapeTagName(tag.substring(prefix.length));
      }
      return tag[0] === "!" ? tag : `!<${tag}>`;
    }
    toString(doc) {
      const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
      const tagEntries = Object.entries(this.tags);
      let tagNames;
      if (doc && tagEntries.length > 0 && identity2.isNode(doc.contents)) {
        const tags2 = {};
        visit2.visit(doc.contents, (_key, node2) => {
          if (identity2.isNode(node2) && node2.tag)
            tags2[node2.tag] = true;
        });
        tagNames = Object.keys(tags2);
      } else
        tagNames = [];
      for (const [handle, prefix] of tagEntries) {
        if (handle === "!!" && prefix === "tag:yaml.org,2002:")
          continue;
        if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
          lines.push(`%TAG ${handle} ${prefix}`);
      }
      return lines.join("\n");
    }
  }
  Directives.defaultYaml = { explicit: false, version: "1.2" };
  Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
  directives.Directives = Directives;
  return directives;
}
var Document = {};
var Alias = {};
var anchors = {};
var hasRequiredAnchors;
function requireAnchors() {
  if (hasRequiredAnchors) return anchors;
  hasRequiredAnchors = 1;
  var identity2 = requireIdentity();
  var visit2 = requireVisit();
  function anchorIsValid(anchor2) {
    if (/[\x00-\x19\s,[\]{}]/.test(anchor2)) {
      const sa = JSON.stringify(anchor2);
      const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
      throw new Error(msg);
    }
    return true;
  }
  function anchorNames(root) {
    const anchors2 = /* @__PURE__ */ new Set();
    visit2.visit(root, {
      Value(_key, node2) {
        if (node2.anchor)
          anchors2.add(node2.anchor);
      }
    });
    return anchors2;
  }
  function findNewAnchor(prefix, exclude) {
    for (let i = 1; true; ++i) {
      const name = `${prefix}${i}`;
      if (!exclude.has(name))
        return name;
    }
  }
  function createNodeAnchors(doc, prefix) {
    const aliasObjects = [];
    const sourceObjects = /* @__PURE__ */ new Map();
    let prevAnchors = null;
    return {
      onAnchor: (source) => {
        aliasObjects.push(source);
        prevAnchors ?? (prevAnchors = anchorNames(doc));
        const anchor2 = findNewAnchor(prefix, prevAnchors);
        prevAnchors.add(anchor2);
        return anchor2;
      },
      /**
       * With circular references, the source node is only resolved after all
       * of its child nodes are. This is why anchors are set only after all of
       * the nodes have been created.
       */
      setAnchors: () => {
        for (const source of aliasObjects) {
          const ref = sourceObjects.get(source);
          if (typeof ref === "object" && ref.anchor && (identity2.isScalar(ref.node) || identity2.isCollection(ref.node))) {
            ref.node.anchor = ref.anchor;
          } else {
            const error2 = new Error("Failed to resolve repeated object (this should not happen)");
            error2.source = source;
            throw error2;
          }
        }
      },
      sourceObjects
    };
  }
  anchors.anchorIsValid = anchorIsValid;
  anchors.anchorNames = anchorNames;
  anchors.createNodeAnchors = createNodeAnchors;
  anchors.findNewAnchor = findNewAnchor;
  return anchors;
}
var Node = {};
var applyReviver = {};
var hasRequiredApplyReviver;
function requireApplyReviver() {
  if (hasRequiredApplyReviver) return applyReviver;
  hasRequiredApplyReviver = 1;
  function applyReviver$1(reviver, obj, key, val) {
    if (val && typeof val === "object") {
      if (Array.isArray(val)) {
        for (let i = 0, len = val.length; i < len; ++i) {
          const v0 = val[i];
          const v1 = applyReviver$1(reviver, val, String(i), v0);
          if (v1 === void 0)
            delete val[i];
          else if (v1 !== v0)
            val[i] = v1;
        }
      } else if (val instanceof Map) {
        for (const k of Array.from(val.keys())) {
          const v0 = val.get(k);
          const v1 = applyReviver$1(reviver, val, k, v0);
          if (v1 === void 0)
            val.delete(k);
          else if (v1 !== v0)
            val.set(k, v1);
        }
      } else if (val instanceof Set) {
        for (const v0 of Array.from(val)) {
          const v1 = applyReviver$1(reviver, val, v0, v0);
          if (v1 === void 0)
            val.delete(v0);
          else if (v1 !== v0) {
            val.delete(v0);
            val.add(v1);
          }
        }
      } else {
        for (const [k, v0] of Object.entries(val)) {
          const v1 = applyReviver$1(reviver, val, k, v0);
          if (v1 === void 0)
            delete val[k];
          else if (v1 !== v0)
            val[k] = v1;
        }
      }
    }
    return reviver.call(obj, key, val);
  }
  applyReviver.applyReviver = applyReviver$1;
  return applyReviver;
}
var toJS = {};
var hasRequiredToJS;
function requireToJS() {
  if (hasRequiredToJS) return toJS;
  hasRequiredToJS = 1;
  var identity2 = requireIdentity();
  function toJS$1(value, arg, ctx) {
    if (Array.isArray(value))
      return value.map((v, i) => toJS$1(v, String(i), ctx));
    if (value && typeof value.toJSON === "function") {
      if (!ctx || !identity2.hasAnchor(value))
        return value.toJSON(arg, ctx);
      const data = { aliasCount: 0, count: 1, res: void 0 };
      ctx.anchors.set(value, data);
      ctx.onCreate = (res2) => {
        data.res = res2;
        delete ctx.onCreate;
      };
      const res = value.toJSON(arg, ctx);
      if (ctx.onCreate)
        ctx.onCreate(res);
      return res;
    }
    if (typeof value === "bigint" && !ctx?.keep)
      return Number(value);
    return value;
  }
  toJS.toJS = toJS$1;
  return toJS;
}
var hasRequiredNode;
function requireNode() {
  if (hasRequiredNode) return Node;
  hasRequiredNode = 1;
  var applyReviver2 = requireApplyReviver();
  var identity2 = requireIdentity();
  var toJS2 = requireToJS();
  class NodeBase {
    constructor(type) {
      Object.defineProperty(this, identity2.NODE_TYPE, { value: type });
    }
    /** Create a copy of this node.  */
    clone() {
      const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
      if (this.range)
        copy.range = this.range.slice();
      return copy;
    }
    /** A plain JavaScript representation of this node. */
    toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
      if (!identity2.isDocument(doc))
        throw new TypeError("A document argument is required");
      const ctx = {
        anchors: /* @__PURE__ */ new Map(),
        doc,
        keep: true,
        mapAsMap: mapAsMap === true,
        mapKeyWarned: false,
        maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
      };
      const res = toJS2.toJS(this, "", ctx);
      if (typeof onAnchor === "function")
        for (const { count, res: res2 } of ctx.anchors.values())
          onAnchor(res2, count);
      return typeof reviver === "function" ? applyReviver2.applyReviver(reviver, { "": res }, "", res) : res;
    }
  }
  Node.NodeBase = NodeBase;
  return Node;
}
var hasRequiredAlias;
function requireAlias() {
  if (hasRequiredAlias) return Alias;
  hasRequiredAlias = 1;
  var anchors2 = requireAnchors();
  var visit2 = requireVisit();
  var identity2 = requireIdentity();
  var Node2 = requireNode();
  var toJS2 = requireToJS();
  let Alias$1 = class Alias extends Node2.NodeBase {
    constructor(source) {
      super(identity2.ALIAS);
      this.source = source;
      Object.defineProperty(this, "tag", {
        set() {
          throw new Error("Alias nodes cannot have tags");
        }
      });
    }
    /**
     * Resolve the value of this alias within `doc`, finding the last
     * instance of the `source` anchor before this node.
     */
    resolve(doc, ctx) {
      let nodes;
      if (ctx?.aliasResolveCache) {
        nodes = ctx.aliasResolveCache;
      } else {
        nodes = [];
        visit2.visit(doc, {
          Node: (_key, node2) => {
            if (identity2.isAlias(node2) || identity2.hasAnchor(node2))
              nodes.push(node2);
          }
        });
        if (ctx)
          ctx.aliasResolveCache = nodes;
      }
      let found = void 0;
      for (const node2 of nodes) {
        if (node2 === this)
          break;
        if (node2.anchor === this.source)
          found = node2;
      }
      return found;
    }
    toJSON(_arg, ctx) {
      if (!ctx)
        return { source: this.source };
      const { anchors: anchors3, doc, maxAliasCount } = ctx;
      const source = this.resolve(doc, ctx);
      if (!source) {
        const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
        throw new ReferenceError(msg);
      }
      let data = anchors3.get(source);
      if (!data) {
        toJS2.toJS(source, null, ctx);
        data = anchors3.get(source);
      }
      if (!data || data.res === void 0) {
        const msg = "This should not happen: Alias anchor was not resolved?";
        throw new ReferenceError(msg);
      }
      if (maxAliasCount >= 0) {
        data.count += 1;
        if (data.aliasCount === 0)
          data.aliasCount = getAliasCount(doc, source, anchors3);
        if (data.count * data.aliasCount > maxAliasCount) {
          const msg = "Excessive alias count indicates a resource exhaustion attack";
          throw new ReferenceError(msg);
        }
      }
      return data.res;
    }
    toString(ctx, _onComment, _onChompKeep) {
      const src = `*${this.source}`;
      if (ctx) {
        anchors2.anchorIsValid(this.source);
        if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new Error(msg);
        }
        if (ctx.implicitKey)
          return `${src} `;
      }
      return src;
    }
  };
  function getAliasCount(doc, node2, anchors3) {
    if (identity2.isAlias(node2)) {
      const source = node2.resolve(doc);
      const anchor2 = anchors3 && source && anchors3.get(source);
      return anchor2 ? anchor2.count * anchor2.aliasCount : 0;
    } else if (identity2.isCollection(node2)) {
      let count = 0;
      for (const item of node2.items) {
        const c = getAliasCount(doc, item, anchors3);
        if (c > count)
          count = c;
      }
      return count;
    } else if (identity2.isPair(node2)) {
      const kc = getAliasCount(doc, node2.key, anchors3);
      const vc = getAliasCount(doc, node2.value, anchors3);
      return Math.max(kc, vc);
    }
    return 1;
  }
  Alias.Alias = Alias$1;
  return Alias;
}
var Collection = {};
var createNode = {};
var Scalar = {};
var hasRequiredScalar;
function requireScalar() {
  if (hasRequiredScalar) return Scalar;
  hasRequiredScalar = 1;
  var identity2 = requireIdentity();
  var Node2 = requireNode();
  var toJS2 = requireToJS();
  const isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
  let Scalar$1 = class Scalar extends Node2.NodeBase {
    constructor(value) {
      super(identity2.SCALAR);
      this.value = value;
    }
    toJSON(arg, ctx) {
      return ctx?.keep ? this.value : toJS2.toJS(this.value, arg, ctx);
    }
    toString() {
      return String(this.value);
    }
  };
  Scalar$1.BLOCK_FOLDED = "BLOCK_FOLDED";
  Scalar$1.BLOCK_LITERAL = "BLOCK_LITERAL";
  Scalar$1.PLAIN = "PLAIN";
  Scalar$1.QUOTE_DOUBLE = "QUOTE_DOUBLE";
  Scalar$1.QUOTE_SINGLE = "QUOTE_SINGLE";
  Scalar.Scalar = Scalar$1;
  Scalar.isScalarValue = isScalarValue;
  return Scalar;
}
var hasRequiredCreateNode;
function requireCreateNode() {
  if (hasRequiredCreateNode) return createNode;
  hasRequiredCreateNode = 1;
  var Alias2 = requireAlias();
  var identity2 = requireIdentity();
  var Scalar2 = requireScalar();
  const defaultTagPrefix = "tag:yaml.org,2002:";
  function findTagObject(value, tagName, tags2) {
    if (tagName) {
      const match = tags2.filter((t) => t.tag === tagName);
      const tagObj = match.find((t) => !t.format) ?? match[0];
      if (!tagObj)
        throw new Error(`Tag ${tagName} not found`);
      return tagObj;
    }
    return tags2.find((t) => t.identify?.(value) && !t.format);
  }
  function createNode$1(value, tagName, ctx) {
    if (identity2.isDocument(value))
      value = value.contents;
    if (identity2.isNode(value))
      return value;
    if (identity2.isPair(value)) {
      const map2 = ctx.schema[identity2.MAP].createNode?.(ctx.schema, null, ctx);
      map2.items.push(value);
      return map2;
    }
    if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
      value = value.valueOf();
    }
    const { aliasDuplicateObjects, onAnchor, onTagObj, schema: schema2, sourceObjects } = ctx;
    let ref = void 0;
    if (aliasDuplicateObjects && value && typeof value === "object") {
      ref = sourceObjects.get(value);
      if (ref) {
        ref.anchor ?? (ref.anchor = onAnchor(value));
        return new Alias2.Alias(ref.anchor);
      } else {
        ref = { anchor: null, node: null };
        sourceObjects.set(value, ref);
      }
    }
    if (tagName?.startsWith("!!"))
      tagName = defaultTagPrefix + tagName.slice(2);
    let tagObj = findTagObject(value, tagName, schema2.tags);
    if (!tagObj) {
      if (value && typeof value.toJSON === "function") {
        value = value.toJSON();
      }
      if (!value || typeof value !== "object") {
        const node3 = new Scalar2.Scalar(value);
        if (ref)
          ref.node = node3;
        return node3;
      }
      tagObj = value instanceof Map ? schema2[identity2.MAP] : Symbol.iterator in Object(value) ? schema2[identity2.SEQ] : schema2[identity2.MAP];
    }
    if (onTagObj) {
      onTagObj(tagObj);
      delete ctx.onTagObj;
    }
    const node2 = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar2.Scalar(value);
    if (tagName)
      node2.tag = tagName;
    else if (!tagObj.default)
      node2.tag = tagObj.tag;
    if (ref)
      ref.node = node2;
    return node2;
  }
  createNode.createNode = createNode$1;
  return createNode;
}
var hasRequiredCollection;
function requireCollection() {
  if (hasRequiredCollection) return Collection;
  hasRequiredCollection = 1;
  var createNode2 = requireCreateNode();
  var identity2 = requireIdentity();
  var Node2 = requireNode();
  function collectionFromPath(schema2, path, value) {
    let v = value;
    for (let i = path.length - 1; i >= 0; --i) {
      const k = path[i];
      if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
        const a = [];
        a[k] = v;
        v = a;
      } else {
        v = /* @__PURE__ */ new Map([[k, v]]);
      }
    }
    return createNode2.createNode(v, void 0, {
      aliasDuplicateObjects: false,
      keepUndefined: false,
      onAnchor: () => {
        throw new Error("This should not happen, please report a bug.");
      },
      schema: schema2,
      sourceObjects: /* @__PURE__ */ new Map()
    });
  }
  const isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
  let Collection$1 = class Collection extends Node2.NodeBase {
    constructor(type, schema2) {
      super(type);
      Object.defineProperty(this, "schema", {
        value: schema2,
        configurable: true,
        enumerable: false,
        writable: true
      });
    }
    /**
     * Create a copy of this collection.
     *
     * @param schema - If defined, overwrites the original's schema
     */
    clone(schema2) {
      const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
      if (schema2)
        copy.schema = schema2;
      copy.items = copy.items.map((it) => identity2.isNode(it) || identity2.isPair(it) ? it.clone(schema2) : it);
      if (this.range)
        copy.range = this.range.slice();
      return copy;
    }
    /**
     * Adds a value to the collection. For `!!map` and `!!omap` the value must
     * be a Pair instance or a `{ key, value }` object, which may not have a key
     * that already exists in the map.
     */
    addIn(path, value) {
      if (isEmptyPath(path))
        this.add(value);
      else {
        const [key, ...rest] = path;
        const node2 = this.get(key, true);
        if (identity2.isCollection(node2))
          node2.addIn(rest, value);
        else if (node2 === void 0 && this.schema)
          this.set(key, collectionFromPath(this.schema, rest, value));
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
    }
    /**
     * Removes a value from the collection.
     * @returns `true` if the item was found and removed.
     */
    deleteIn(path) {
      const [key, ...rest] = path;
      if (rest.length === 0)
        return this.delete(key);
      const node2 = this.get(key, true);
      if (identity2.isCollection(node2))
        return node2.deleteIn(rest);
      else
        throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
    }
    /**
     * Returns item at `key`, or `undefined` if not found. By default unwraps
     * scalar values from their surrounding node; to disable set `keepScalar` to
     * `true` (collections are always returned intact).
     */
    getIn(path, keepScalar) {
      const [key, ...rest] = path;
      const node2 = this.get(key, true);
      if (rest.length === 0)
        return !keepScalar && identity2.isScalar(node2) ? node2.value : node2;
      else
        return identity2.isCollection(node2) ? node2.getIn(rest, keepScalar) : void 0;
    }
    hasAllNullValues(allowScalar) {
      return this.items.every((node2) => {
        if (!identity2.isPair(node2))
          return false;
        const n = node2.value;
        return n == null || allowScalar && identity2.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
      });
    }
    /**
     * Checks if the collection includes a value with the key `key`.
     */
    hasIn(path) {
      const [key, ...rest] = path;
      if (rest.length === 0)
        return this.has(key);
      const node2 = this.get(key, true);
      return identity2.isCollection(node2) ? node2.hasIn(rest) : false;
    }
    /**
     * Sets a value in this collection. For `!!set`, `value` needs to be a
     * boolean to add/remove the item from the set.
     */
    setIn(path, value) {
      const [key, ...rest] = path;
      if (rest.length === 0) {
        this.set(key, value);
      } else {
        const node2 = this.get(key, true);
        if (identity2.isCollection(node2))
          node2.setIn(rest, value);
        else if (node2 === void 0 && this.schema)
          this.set(key, collectionFromPath(this.schema, rest, value));
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
    }
  };
  Collection.Collection = Collection$1;
  Collection.collectionFromPath = collectionFromPath;
  Collection.isEmptyPath = isEmptyPath;
  return Collection;
}
var Pair = {};
var stringifyPair = {};
var stringify = {};
var stringifyComment = {};
var hasRequiredStringifyComment;
function requireStringifyComment() {
  if (hasRequiredStringifyComment) return stringifyComment;
  hasRequiredStringifyComment = 1;
  const stringifyComment$1 = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
  function indentComment(comment, indent) {
    if (/^\n+$/.test(comment))
      return comment.substring(1);
    return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
  }
  const lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
  stringifyComment.indentComment = indentComment;
  stringifyComment.lineComment = lineComment;
  stringifyComment.stringifyComment = stringifyComment$1;
  return stringifyComment;
}
var stringifyString = {};
var foldFlowLines = {};
var hasRequiredFoldFlowLines;
function requireFoldFlowLines() {
  if (hasRequiredFoldFlowLines) return foldFlowLines;
  hasRequiredFoldFlowLines = 1;
  const FOLD_FLOW = "flow";
  const FOLD_BLOCK = "block";
  const FOLD_QUOTED = "quoted";
  function foldFlowLines$1(text2, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
    if (!lineWidth || lineWidth < 0)
      return text2;
    if (lineWidth < minContentWidth)
      minContentWidth = 0;
    const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
    if (text2.length <= endStep)
      return text2;
    const folds = [];
    const escapedFolds = {};
    let end = lineWidth - indent.length;
    if (typeof indentAtStart === "number") {
      if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
        folds.push(0);
      else
        end = lineWidth - indentAtStart;
    }
    let split = void 0;
    let prev = void 0;
    let overflow = false;
    let i = -1;
    let escStart = -1;
    let escEnd = -1;
    if (mode === FOLD_BLOCK) {
      i = consumeMoreIndentedLines(text2, i, indent.length);
      if (i !== -1)
        end = i + endStep;
    }
    for (let ch; ch = text2[i += 1]; ) {
      if (mode === FOLD_QUOTED && ch === "\\") {
        escStart = i;
        switch (text2[i + 1]) {
          case "x":
            i += 3;
            break;
          case "u":
            i += 5;
            break;
          case "U":
            i += 9;
            break;
          default:
            i += 1;
        }
        escEnd = i;
      }
      if (ch === "\n") {
        if (mode === FOLD_BLOCK)
          i = consumeMoreIndentedLines(text2, i, indent.length);
        end = i + indent.length + endStep;
        split = void 0;
      } else {
        if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
          const next = text2[i + 1];
          if (next && next !== " " && next !== "\n" && next !== "	")
            split = i;
        }
        if (i >= end) {
          if (split) {
            folds.push(split);
            end = split + endStep;
            split = void 0;
          } else if (mode === FOLD_QUOTED) {
            while (prev === " " || prev === "	") {
              prev = ch;
              ch = text2[i += 1];
              overflow = true;
            }
            const j = i > escEnd + 1 ? i - 2 : escStart - 1;
            if (escapedFolds[j])
              return text2;
            folds.push(j);
            escapedFolds[j] = true;
            end = j + endStep;
            split = void 0;
          } else {
            overflow = true;
          }
        }
      }
      prev = ch;
    }
    if (overflow && onOverflow)
      onOverflow();
    if (folds.length === 0)
      return text2;
    if (onFold)
      onFold();
    let res = text2.slice(0, folds[0]);
    for (let i2 = 0; i2 < folds.length; ++i2) {
      const fold = folds[i2];
      const end2 = folds[i2 + 1] || text2.length;
      if (fold === 0)
        res = `
${indent}${text2.slice(0, end2)}`;
      else {
        if (mode === FOLD_QUOTED && escapedFolds[fold])
          res += `${text2[fold]}\\`;
        res += `
${indent}${text2.slice(fold + 1, end2)}`;
      }
    }
    return res;
  }
  function consumeMoreIndentedLines(text2, i, indent) {
    let end = i;
    let start = i + 1;
    let ch = text2[start];
    while (ch === " " || ch === "	") {
      if (i < start + indent) {
        ch = text2[++i];
      } else {
        do {
          ch = text2[++i];
        } while (ch && ch !== "\n");
        end = i;
        start = i + 1;
        ch = text2[start];
      }
    }
    return end;
  }
  foldFlowLines.FOLD_BLOCK = FOLD_BLOCK;
  foldFlowLines.FOLD_FLOW = FOLD_FLOW;
  foldFlowLines.FOLD_QUOTED = FOLD_QUOTED;
  foldFlowLines.foldFlowLines = foldFlowLines$1;
  return foldFlowLines;
}
var hasRequiredStringifyString;
function requireStringifyString() {
  if (hasRequiredStringifyString) return stringifyString;
  hasRequiredStringifyString = 1;
  var Scalar2 = requireScalar();
  var foldFlowLines2 = requireFoldFlowLines();
  const getFoldOptions = (ctx, isBlock) => ({
    indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
    lineWidth: ctx.options.lineWidth,
    minContentWidth: ctx.options.minContentWidth
  });
  const containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
  function lineLengthOverLimit(str, lineWidth, indentLength) {
    if (!lineWidth || lineWidth < 0)
      return false;
    const limit = lineWidth - indentLength;
    const strLen = str.length;
    if (strLen <= limit)
      return false;
    for (let i = 0, start = 0; i < strLen; ++i) {
      if (str[i] === "\n") {
        if (i - start > limit)
          return true;
        start = i + 1;
        if (strLen - start <= limit)
          return false;
      }
    }
    return true;
  }
  function doubleQuotedString(value, ctx) {
    const json = JSON.stringify(value);
    if (ctx.options.doubleQuotedAsJSON)
      return json;
    const { implicitKey } = ctx;
    const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
    const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
    let str = "";
    let start = 0;
    for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
      if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
        str += json.slice(start, i) + "\\ ";
        i += 1;
        start = i;
        ch = "\\";
      }
      if (ch === "\\")
        switch (json[i + 1]) {
          case "u":
            {
              str += json.slice(start, i);
              const code = json.substr(i + 2, 4);
              switch (code) {
                case "0000":
                  str += "\\0";
                  break;
                case "0007":
                  str += "\\a";
                  break;
                case "000b":
                  str += "\\v";
                  break;
                case "001b":
                  str += "\\e";
                  break;
                case "0085":
                  str += "\\N";
                  break;
                case "00a0":
                  str += "\\_";
                  break;
                case "2028":
                  str += "\\L";
                  break;
                case "2029":
                  str += "\\P";
                  break;
                default:
                  if (code.substr(0, 2) === "00")
                    str += "\\x" + code.substr(2);
                  else
                    str += json.substr(i, 6);
              }
              i += 5;
              start = i + 1;
            }
            break;
          case "n":
            if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
              i += 1;
            } else {
              str += json.slice(start, i) + "\n\n";
              while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                str += "\n";
                i += 2;
              }
              str += indent;
              if (json[i + 2] === " ")
                str += "\\";
              i += 1;
              start = i + 1;
            }
            break;
          default:
            i += 1;
        }
    }
    str = start ? str + json.slice(start) : json;
    return implicitKey ? str : foldFlowLines2.foldFlowLines(str, indent, foldFlowLines2.FOLD_QUOTED, getFoldOptions(ctx, false));
  }
  function singleQuotedString(value, ctx) {
    if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
      return doubleQuotedString(value, ctx);
    const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
    const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
    return ctx.implicitKey ? res : foldFlowLines2.foldFlowLines(res, indent, foldFlowLines2.FOLD_FLOW, getFoldOptions(ctx, false));
  }
  function quotedString(value, ctx) {
    const { singleQuote } = ctx.options;
    let qs;
    if (singleQuote === false)
      qs = doubleQuotedString;
    else {
      const hasDouble = value.includes('"');
      const hasSingle = value.includes("'");
      if (hasDouble && !hasSingle)
        qs = singleQuotedString;
      else if (hasSingle && !hasDouble)
        qs = doubleQuotedString;
      else
        qs = singleQuote ? singleQuotedString : doubleQuotedString;
    }
    return qs(value, ctx);
  }
  let blockEndNewlines;
  try {
    blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
  } catch {
    blockEndNewlines = /\n+(?!\n|$)/g;
  }
  function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
    const { blockQuote, commentString, lineWidth } = ctx.options;
    if (!blockQuote || /\n[\t ]+$/.test(value) || /^\s*$/.test(value)) {
      return quotedString(value, ctx);
    }
    const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
    const literal2 = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar2.Scalar.BLOCK_FOLDED ? false : type === Scalar2.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
    if (!value)
      return literal2 ? "|\n" : ">\n";
    let chomp;
    let endStart;
    for (endStart = value.length; endStart > 0; --endStart) {
      const ch = value[endStart - 1];
      if (ch !== "\n" && ch !== "	" && ch !== " ")
        break;
    }
    let end = value.substring(endStart);
    const endNlPos = end.indexOf("\n");
    if (endNlPos === -1) {
      chomp = "-";
    } else if (value === end || endNlPos !== end.length - 1) {
      chomp = "+";
      if (onChompKeep)
        onChompKeep();
    } else {
      chomp = "";
    }
    if (end) {
      value = value.slice(0, -end.length);
      if (end[end.length - 1] === "\n")
        end = end.slice(0, -1);
      end = end.replace(blockEndNewlines, `$&${indent}`);
    }
    let startWithSpace = false;
    let startEnd;
    let startNlPos = -1;
    for (startEnd = 0; startEnd < value.length; ++startEnd) {
      const ch = value[startEnd];
      if (ch === " ")
        startWithSpace = true;
      else if (ch === "\n")
        startNlPos = startEnd;
      else
        break;
    }
    let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
    if (start) {
      value = value.substring(start.length);
      start = start.replace(/\n+/g, `$&${indent}`);
    }
    const indentSize = indent ? "2" : "1";
    let header = (startWithSpace ? indentSize : "") + chomp;
    if (comment) {
      header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
      if (onComment)
        onComment();
    }
    if (!literal2) {
      const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
      let literalFallback = false;
      const foldOptions = getFoldOptions(ctx, true);
      if (blockQuote !== "folded" && type !== Scalar2.Scalar.BLOCK_FOLDED) {
        foldOptions.onOverflow = () => {
          literalFallback = true;
        };
      }
      const body = foldFlowLines2.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines2.FOLD_BLOCK, foldOptions);
      if (!literalFallback)
        return `>${header}
${indent}${body}`;
    }
    value = value.replace(/\n+/g, `$&${indent}`);
    return `|${header}
${indent}${start}${value}${end}`;
  }
  function plainString(item, ctx, onComment, onChompKeep) {
    const { type, value } = item;
    const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
    if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
      return quotedString(value, ctx);
    }
    if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
      return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
    }
    if (!implicitKey && !inFlow && type !== Scalar2.Scalar.PLAIN && value.includes("\n")) {
      return blockString(item, ctx, onComment, onChompKeep);
    }
    if (containsDocumentMarker(value)) {
      if (indent === "") {
        ctx.forceBlockIndent = true;
        return blockString(item, ctx, onComment, onChompKeep);
      } else if (implicitKey && indent === indentStep) {
        return quotedString(value, ctx);
      }
    }
    const str = value.replace(/\n+/g, `$&
${indent}`);
    if (actualString) {
      const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
      const { compat, tags: tags2 } = ctx.doc.schema;
      if (tags2.some(test) || compat?.some(test))
        return quotedString(value, ctx);
    }
    return implicitKey ? str : foldFlowLines2.foldFlowLines(str, indent, foldFlowLines2.FOLD_FLOW, getFoldOptions(ctx, false));
  }
  function stringifyString$1(item, ctx, onComment, onChompKeep) {
    const { implicitKey, inFlow } = ctx;
    const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
    let { type } = item;
    if (type !== Scalar2.Scalar.QUOTE_DOUBLE) {
      if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
        type = Scalar2.Scalar.QUOTE_DOUBLE;
    }
    const _stringify = (_type) => {
      switch (_type) {
        case Scalar2.Scalar.BLOCK_FOLDED:
        case Scalar2.Scalar.BLOCK_LITERAL:
          return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
        case Scalar2.Scalar.QUOTE_DOUBLE:
          return doubleQuotedString(ss.value, ctx);
        case Scalar2.Scalar.QUOTE_SINGLE:
          return singleQuotedString(ss.value, ctx);
        case Scalar2.Scalar.PLAIN:
          return plainString(ss, ctx, onComment, onChompKeep);
        default:
          return null;
      }
    };
    let res = _stringify(type);
    if (res === null) {
      const { defaultKeyType, defaultStringType } = ctx.options;
      const t = implicitKey && defaultKeyType || defaultStringType;
      res = _stringify(t);
      if (res === null)
        throw new Error(`Unsupported default string type ${t}`);
    }
    return res;
  }
  stringifyString.stringifyString = stringifyString$1;
  return stringifyString;
}
var hasRequiredStringify;
function requireStringify() {
  if (hasRequiredStringify) return stringify;
  hasRequiredStringify = 1;
  var anchors2 = requireAnchors();
  var identity2 = requireIdentity();
  var stringifyComment2 = requireStringifyComment();
  var stringifyString2 = requireStringifyString();
  function createStringifyContext(doc, options) {
    const opt = Object.assign({
      blockQuote: true,
      commentString: stringifyComment2.stringifyComment,
      defaultKeyType: null,
      defaultStringType: "PLAIN",
      directives: null,
      doubleQuotedAsJSON: false,
      doubleQuotedMinMultiLineLength: 40,
      falseStr: "false",
      flowCollectionPadding: true,
      indentSeq: true,
      lineWidth: 80,
      minContentWidth: 20,
      nullStr: "null",
      simpleKeys: false,
      singleQuote: null,
      trueStr: "true",
      verifyAliasOrder: true
    }, doc.schema.toStringOptions, options);
    let inFlow;
    switch (opt.collectionStyle) {
      case "block":
        inFlow = false;
        break;
      case "flow":
        inFlow = true;
        break;
      default:
        inFlow = null;
    }
    return {
      anchors: /* @__PURE__ */ new Set(),
      doc,
      flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
      indent: "",
      indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
      inFlow,
      options: opt
    };
  }
  function getTagObject(tags2, item) {
    if (item.tag) {
      const match = tags2.filter((t) => t.tag === item.tag);
      if (match.length > 0)
        return match.find((t) => t.format === item.format) ?? match[0];
    }
    let tagObj = void 0;
    let obj;
    if (identity2.isScalar(item)) {
      obj = item.value;
      let match = tags2.filter((t) => t.identify?.(obj));
      if (match.length > 1) {
        const testMatch = match.filter((t) => t.test);
        if (testMatch.length > 0)
          match = testMatch;
      }
      tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
    } else {
      obj = item;
      tagObj = tags2.find((t) => t.nodeClass && obj instanceof t.nodeClass);
    }
    if (!tagObj) {
      const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
      throw new Error(`Tag not resolved for ${name} value`);
    }
    return tagObj;
  }
  function stringifyProps(node2, tagObj, { anchors: anchors$1, doc }) {
    if (!doc.directives)
      return "";
    const props = [];
    const anchor2 = (identity2.isScalar(node2) || identity2.isCollection(node2)) && node2.anchor;
    if (anchor2 && anchors2.anchorIsValid(anchor2)) {
      anchors$1.add(anchor2);
      props.push(`&${anchor2}`);
    }
    const tag = node2.tag ?? (tagObj.default ? null : tagObj.tag);
    if (tag)
      props.push(doc.directives.tagString(tag));
    return props.join(" ");
  }
  function stringify$1(item, ctx, onComment, onChompKeep) {
    if (identity2.isPair(item))
      return item.toString(ctx, onComment, onChompKeep);
    if (identity2.isAlias(item)) {
      if (ctx.doc.directives)
        return item.toString(ctx);
      if (ctx.resolvedAliases?.has(item)) {
        throw new TypeError(`Cannot stringify circular structure without alias nodes`);
      } else {
        if (ctx.resolvedAliases)
          ctx.resolvedAliases.add(item);
        else
          ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
        item = item.resolve(ctx.doc);
      }
    }
    let tagObj = void 0;
    const node2 = identity2.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
    tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node2));
    const props = stringifyProps(node2, tagObj, ctx);
    if (props.length > 0)
      ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
    const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node2, ctx, onComment, onChompKeep) : identity2.isScalar(node2) ? stringifyString2.stringifyString(node2, ctx, onComment, onChompKeep) : node2.toString(ctx, onComment, onChompKeep);
    if (!props)
      return str;
    return identity2.isScalar(node2) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
  }
  stringify.createStringifyContext = createStringifyContext;
  stringify.stringify = stringify$1;
  return stringify;
}
var hasRequiredStringifyPair;
function requireStringifyPair() {
  if (hasRequiredStringifyPair) return stringifyPair;
  hasRequiredStringifyPair = 1;
  var identity2 = requireIdentity();
  var Scalar2 = requireScalar();
  var stringify2 = requireStringify();
  var stringifyComment2 = requireStringifyComment();
  function stringifyPair$1({ key, value }, ctx, onComment, onChompKeep) {
    const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
    let keyComment = identity2.isNode(key) && key.comment || null;
    if (simpleKeys) {
      if (keyComment) {
        throw new Error("With simple keys, key nodes cannot have comments");
      }
      if (identity2.isCollection(key) || !identity2.isNode(key) && typeof key === "object") {
        const msg = "With simple keys, collection cannot be used as a key value";
        throw new Error(msg);
      }
    }
    let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity2.isCollection(key) || (identity2.isScalar(key) ? key.type === Scalar2.Scalar.BLOCK_FOLDED || key.type === Scalar2.Scalar.BLOCK_LITERAL : typeof key === "object"));
    ctx = Object.assign({}, ctx, {
      allNullValues: false,
      implicitKey: !explicitKey && (simpleKeys || !allNullValues),
      indent: indent + indentStep
    });
    let keyCommentDone = false;
    let chompKeep = false;
    let str = stringify2.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
    if (!explicitKey && !ctx.inFlow && str.length > 1024) {
      if (simpleKeys)
        throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
      explicitKey = true;
    }
    if (ctx.inFlow) {
      if (allNullValues || value == null) {
        if (keyCommentDone && onComment)
          onComment();
        return str === "" ? "?" : explicitKey ? `? ${str}` : str;
      }
    } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
      str = `? ${str}`;
      if (keyComment && !keyCommentDone) {
        str += stringifyComment2.lineComment(str, ctx.indent, commentString(keyComment));
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    if (keyCommentDone)
      keyComment = null;
    if (explicitKey) {
      if (keyComment)
        str += stringifyComment2.lineComment(str, ctx.indent, commentString(keyComment));
      str = `? ${str}
${indent}:`;
    } else {
      str = `${str}:`;
      if (keyComment)
        str += stringifyComment2.lineComment(str, ctx.indent, commentString(keyComment));
    }
    let vsb, vcb, valueComment;
    if (identity2.isNode(value)) {
      vsb = !!value.spaceBefore;
      vcb = value.commentBefore;
      valueComment = value.comment;
    } else {
      vsb = false;
      vcb = null;
      valueComment = null;
      if (value && typeof value === "object")
        value = doc.createNode(value);
    }
    ctx.implicitKey = false;
    if (!explicitKey && !keyComment && identity2.isScalar(value))
      ctx.indentAtStart = str.length + 1;
    chompKeep = false;
    if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity2.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
      ctx.indent = ctx.indent.substring(2);
    }
    let valueCommentDone = false;
    const valueStr = stringify2.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
    let ws = " ";
    if (keyComment || vsb || vcb) {
      ws = vsb ? "\n" : "";
      if (vcb) {
        const cs = commentString(vcb);
        ws += `
${stringifyComment2.indentComment(cs, ctx.indent)}`;
      }
      if (valueStr === "" && !ctx.inFlow) {
        if (ws === "\n")
          ws = "\n\n";
      } else {
        ws += `
${ctx.indent}`;
      }
    } else if (!explicitKey && identity2.isCollection(value)) {
      const vs0 = valueStr[0];
      const nl0 = valueStr.indexOf("\n");
      const hasNewline = nl0 !== -1;
      const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
      if (hasNewline || !flow) {
        let hasPropsLine = false;
        if (hasNewline && (vs0 === "&" || vs0 === "!")) {
          let sp0 = valueStr.indexOf(" ");
          if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
            sp0 = valueStr.indexOf(" ", sp0 + 1);
          }
          if (sp0 === -1 || nl0 < sp0)
            hasPropsLine = true;
        }
        if (!hasPropsLine)
          ws = `
${ctx.indent}`;
      }
    } else if (valueStr === "" || valueStr[0] === "\n") {
      ws = "";
    }
    str += ws + valueStr;
    if (ctx.inFlow) {
      if (valueCommentDone && onComment)
        onComment();
    } else if (valueComment && !valueCommentDone) {
      str += stringifyComment2.lineComment(str, ctx.indent, commentString(valueComment));
    } else if (chompKeep && onChompKeep) {
      onChompKeep();
    }
    return str;
  }
  stringifyPair.stringifyPair = stringifyPair$1;
  return stringifyPair;
}
var addPairToJSMap = {};
var log = {};
var hasRequiredLog;
function requireLog() {
  if (hasRequiredLog) return log;
  hasRequiredLog = 1;
  var node_process = require$$0;
  function debug(logLevel, ...messages) {
    if (logLevel === "debug")
      console.log(...messages);
  }
  function warn(logLevel, warning) {
    if (logLevel === "debug" || logLevel === "warn") {
      if (typeof node_process.emitWarning === "function")
        node_process.emitWarning(warning);
      else
        console.warn(warning);
    }
  }
  log.debug = debug;
  log.warn = warn;
  return log;
}
var merge$1 = {};
var hasRequiredMerge;
function requireMerge() {
  if (hasRequiredMerge) return merge$1;
  hasRequiredMerge = 1;
  var identity2 = requireIdentity();
  var Scalar2 = requireScalar();
  const MERGE_KEY = "<<";
  const merge2 = {
    identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
    default: "key",
    tag: "tag:yaml.org,2002:merge",
    test: /^<<$/,
    resolve: () => Object.assign(new Scalar2.Scalar(Symbol(MERGE_KEY)), {
      addToJSMap: addMergeToJSMap
    }),
    stringify: () => MERGE_KEY
  };
  const isMergeKey = (ctx, key) => (merge2.identify(key) || identity2.isScalar(key) && (!key.type || key.type === Scalar2.Scalar.PLAIN) && merge2.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge2.tag && tag.default);
  function addMergeToJSMap(ctx, map2, value) {
    value = ctx && identity2.isAlias(value) ? value.resolve(ctx.doc) : value;
    if (identity2.isSeq(value))
      for (const it of value.items)
        mergeValue(ctx, map2, it);
    else if (Array.isArray(value))
      for (const it of value)
        mergeValue(ctx, map2, it);
    else
      mergeValue(ctx, map2, value);
  }
  function mergeValue(ctx, map2, value) {
    const source = ctx && identity2.isAlias(value) ? value.resolve(ctx.doc) : value;
    if (!identity2.isMap(source))
      throw new Error("Merge sources must be maps or map aliases");
    const srcMap = source.toJSON(null, ctx, Map);
    for (const [key, value2] of srcMap) {
      if (map2 instanceof Map) {
        if (!map2.has(key))
          map2.set(key, value2);
      } else if (map2 instanceof Set) {
        map2.add(key);
      } else if (!Object.prototype.hasOwnProperty.call(map2, key)) {
        Object.defineProperty(map2, key, {
          value: value2,
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
    }
    return map2;
  }
  merge$1.addMergeToJSMap = addMergeToJSMap;
  merge$1.isMergeKey = isMergeKey;
  merge$1.merge = merge2;
  return merge$1;
}
var hasRequiredAddPairToJSMap;
function requireAddPairToJSMap() {
  if (hasRequiredAddPairToJSMap) return addPairToJSMap;
  hasRequiredAddPairToJSMap = 1;
  var log2 = requireLog();
  var merge2 = requireMerge();
  var stringify2 = requireStringify();
  var identity2 = requireIdentity();
  var toJS2 = requireToJS();
  function addPairToJSMap$1(ctx, map2, { key, value }) {
    if (identity2.isNode(key) && key.addToJSMap)
      key.addToJSMap(ctx, map2, value);
    else if (merge2.isMergeKey(ctx, key))
      merge2.addMergeToJSMap(ctx, map2, value);
    else {
      const jsKey = toJS2.toJS(key, "", ctx);
      if (map2 instanceof Map) {
        map2.set(jsKey, toJS2.toJS(value, jsKey, ctx));
      } else if (map2 instanceof Set) {
        map2.add(jsKey);
      } else {
        const stringKey = stringifyKey(key, jsKey, ctx);
        const jsValue = toJS2.toJS(value, stringKey, ctx);
        if (stringKey in map2)
          Object.defineProperty(map2, stringKey, {
            value: jsValue,
            writable: true,
            enumerable: true,
            configurable: true
          });
        else
          map2[stringKey] = jsValue;
      }
    }
    return map2;
  }
  function stringifyKey(key, jsKey, ctx) {
    if (jsKey === null)
      return "";
    if (typeof jsKey !== "object")
      return String(jsKey);
    if (identity2.isNode(key) && ctx?.doc) {
      const strCtx = stringify2.createStringifyContext(ctx.doc, {});
      strCtx.anchors = /* @__PURE__ */ new Set();
      for (const node2 of ctx.anchors.keys())
        strCtx.anchors.add(node2.anchor);
      strCtx.inFlow = true;
      strCtx.inStringifyKey = true;
      const strKey = key.toString(strCtx);
      if (!ctx.mapKeyWarned) {
        let jsonStr = JSON.stringify(strKey);
        if (jsonStr.length > 40)
          jsonStr = jsonStr.substring(0, 36) + '..."';
        log2.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
        ctx.mapKeyWarned = true;
      }
      return strKey;
    }
    return JSON.stringify(jsKey);
  }
  addPairToJSMap.addPairToJSMap = addPairToJSMap$1;
  return addPairToJSMap;
}
var hasRequiredPair;
function requirePair() {
  if (hasRequiredPair) return Pair;
  hasRequiredPair = 1;
  var createNode2 = requireCreateNode();
  var stringifyPair2 = requireStringifyPair();
  var addPairToJSMap2 = requireAddPairToJSMap();
  var identity2 = requireIdentity();
  function createPair(key, value, ctx) {
    const k = createNode2.createNode(key, void 0, ctx);
    const v = createNode2.createNode(value, void 0, ctx);
    return new Pair$1(k, v);
  }
  let Pair$1 = class Pair2 {
    constructor(key, value = null) {
      Object.defineProperty(this, identity2.NODE_TYPE, { value: identity2.PAIR });
      this.key = key;
      this.value = value;
    }
    clone(schema2) {
      let { key, value } = this;
      if (identity2.isNode(key))
        key = key.clone(schema2);
      if (identity2.isNode(value))
        value = value.clone(schema2);
      return new Pair2(key, value);
    }
    toJSON(_, ctx) {
      const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
      return addPairToJSMap2.addPairToJSMap(ctx, pair, this);
    }
    toString(ctx, onComment, onChompKeep) {
      return ctx?.doc ? stringifyPair2.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
    }
  };
  Pair.Pair = Pair$1;
  Pair.createPair = createPair;
  return Pair;
}
var Schema = {};
var map = {};
var YAMLMap = {};
var stringifyCollection = {};
var hasRequiredStringifyCollection;
function requireStringifyCollection() {
  if (hasRequiredStringifyCollection) return stringifyCollection;
  hasRequiredStringifyCollection = 1;
  var identity2 = requireIdentity();
  var stringify2 = requireStringify();
  var stringifyComment2 = requireStringifyComment();
  function stringifyCollection$1(collection, ctx, options) {
    const flow = ctx.inFlow ?? collection.flow;
    const stringify3 = flow ? stringifyFlowCollection : stringifyBlockCollection;
    return stringify3(collection, ctx, options);
  }
  function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
    const { indent, options: { commentString } } = ctx;
    const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
    let chompKeep = false;
    const lines = [];
    for (let i = 0; i < items.length; ++i) {
      const item = items[i];
      let comment2 = null;
      if (identity2.isNode(item)) {
        if (!chompKeep && item.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
        if (item.comment)
          comment2 = item.comment;
      } else if (identity2.isPair(item)) {
        const ik = identity2.isNode(item.key) ? item.key : null;
        if (ik) {
          if (!chompKeep && ik.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
        }
      }
      chompKeep = false;
      let str2 = stringify2.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
      if (comment2)
        str2 += stringifyComment2.lineComment(str2, itemIndent, commentString(comment2));
      if (chompKeep && comment2)
        chompKeep = false;
      lines.push(blockItemPrefix + str2);
    }
    let str;
    if (lines.length === 0) {
      str = flowChars.start + flowChars.end;
    } else {
      str = lines[0];
      for (let i = 1; i < lines.length; ++i) {
        const line = lines[i];
        str += line ? `
${indent}${line}` : "\n";
      }
    }
    if (comment) {
      str += "\n" + stringifyComment2.indentComment(commentString(comment), indent);
      if (onComment)
        onComment();
    } else if (chompKeep && onChompKeep)
      onChompKeep();
    return str;
  }
  function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
    const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
    itemIndent += indentStep;
    const itemCtx = Object.assign({}, ctx, {
      indent: itemIndent,
      inFlow: true,
      type: null
    });
    let reqNewline = false;
    let linesAtValue = 0;
    const lines = [];
    for (let i = 0; i < items.length; ++i) {
      const item = items[i];
      let comment = null;
      if (identity2.isNode(item)) {
        if (item.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, item.commentBefore, false);
        if (item.comment)
          comment = item.comment;
      } else if (identity2.isPair(item)) {
        const ik = identity2.isNode(item.key) ? item.key : null;
        if (ik) {
          if (ik.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, ik.commentBefore, false);
          if (ik.comment)
            reqNewline = true;
        }
        const iv = identity2.isNode(item.value) ? item.value : null;
        if (iv) {
          if (iv.comment)
            comment = iv.comment;
          if (iv.commentBefore)
            reqNewline = true;
        } else if (item.value == null && ik?.comment) {
          comment = ik.comment;
        }
      }
      if (comment)
        reqNewline = true;
      let str = stringify2.stringify(item, itemCtx, () => comment = null);
      if (i < items.length - 1)
        str += ",";
      if (comment)
        str += stringifyComment2.lineComment(str, itemIndent, commentString(comment));
      if (!reqNewline && (lines.length > linesAtValue || str.includes("\n")))
        reqNewline = true;
      lines.push(str);
      linesAtValue = lines.length;
    }
    const { start, end } = flowChars;
    if (lines.length === 0) {
      return start + end;
    } else {
      if (!reqNewline) {
        const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
        reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
      }
      if (reqNewline) {
        let str = start;
        for (const line of lines)
          str += line ? `
${indentStep}${indent}${line}` : "\n";
        return `${str}
${indent}${end}`;
      } else {
        return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
      }
    }
  }
  function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
    if (comment && chompKeep)
      comment = comment.replace(/^\n+/, "");
    if (comment) {
      const ic = stringifyComment2.indentComment(commentString(comment), indent);
      lines.push(ic.trimStart());
    }
  }
  stringifyCollection.stringifyCollection = stringifyCollection$1;
  return stringifyCollection;
}
var hasRequiredYAMLMap;
function requireYAMLMap() {
  if (hasRequiredYAMLMap) return YAMLMap;
  hasRequiredYAMLMap = 1;
  var stringifyCollection2 = requireStringifyCollection();
  var addPairToJSMap2 = requireAddPairToJSMap();
  var Collection2 = requireCollection();
  var identity2 = requireIdentity();
  var Pair2 = requirePair();
  var Scalar2 = requireScalar();
  function findPair(items, key) {
    const k = identity2.isScalar(key) ? key.value : key;
    for (const it of items) {
      if (identity2.isPair(it)) {
        if (it.key === key || it.key === k)
          return it;
        if (identity2.isScalar(it.key) && it.key.value === k)
          return it;
      }
    }
    return void 0;
  }
  let YAMLMap$1 = class YAMLMap extends Collection2.Collection {
    static get tagName() {
      return "tag:yaml.org,2002:map";
    }
    constructor(schema2) {
      super(identity2.MAP, schema2);
      this.items = [];
    }
    /**
     * A generic collection parsing method that can be extended
     * to other node classes that inherit from YAMLMap
     */
    static from(schema2, obj, ctx) {
      const { keepUndefined, replacer } = ctx;
      const map2 = new this(schema2);
      const add = (key, value) => {
        if (typeof replacer === "function")
          value = replacer.call(obj, key, value);
        else if (Array.isArray(replacer) && !replacer.includes(key))
          return;
        if (value !== void 0 || keepUndefined)
          map2.items.push(Pair2.createPair(key, value, ctx));
      };
      if (obj instanceof Map) {
        for (const [key, value] of obj)
          add(key, value);
      } else if (obj && typeof obj === "object") {
        for (const key of Object.keys(obj))
          add(key, obj[key]);
      }
      if (typeof schema2.sortMapEntries === "function") {
        map2.items.sort(schema2.sortMapEntries);
      }
      return map2;
    }
    /**
     * Adds a value to the collection.
     *
     * @param overwrite - If not set `true`, using a key that is already in the
     *   collection will throw. Otherwise, overwrites the previous value.
     */
    add(pair, overwrite) {
      let _pair;
      if (identity2.isPair(pair))
        _pair = pair;
      else if (!pair || typeof pair !== "object" || !("key" in pair)) {
        _pair = new Pair2.Pair(pair, pair?.value);
      } else
        _pair = new Pair2.Pair(pair.key, pair.value);
      const prev = findPair(this.items, _pair.key);
      const sortEntries = this.schema?.sortMapEntries;
      if (prev) {
        if (!overwrite)
          throw new Error(`Key ${_pair.key} already set`);
        if (identity2.isScalar(prev.value) && Scalar2.isScalarValue(_pair.value))
          prev.value.value = _pair.value;
        else
          prev.value = _pair.value;
      } else if (sortEntries) {
        const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
        if (i === -1)
          this.items.push(_pair);
        else
          this.items.splice(i, 0, _pair);
      } else {
        this.items.push(_pair);
      }
    }
    delete(key) {
      const it = findPair(this.items, key);
      if (!it)
        return false;
      const del = this.items.splice(this.items.indexOf(it), 1);
      return del.length > 0;
    }
    get(key, keepScalar) {
      const it = findPair(this.items, key);
      const node2 = it?.value;
      return (!keepScalar && identity2.isScalar(node2) ? node2.value : node2) ?? void 0;
    }
    has(key) {
      return !!findPair(this.items, key);
    }
    set(key, value) {
      this.add(new Pair2.Pair(key, value), true);
    }
    /**
     * @param ctx - Conversion context, originally set in Document#toJS()
     * @param {Class} Type - If set, forces the returned collection type
     * @returns Instance of Type, Map, or Object
     */
    toJSON(_, ctx, Type) {
      const map2 = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
      if (ctx?.onCreate)
        ctx.onCreate(map2);
      for (const item of this.items)
        addPairToJSMap2.addPairToJSMap(ctx, map2, item);
      return map2;
    }
    toString(ctx, onComment, onChompKeep) {
      if (!ctx)
        return JSON.stringify(this);
      for (const item of this.items) {
        if (!identity2.isPair(item))
          throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
      }
      if (!ctx.allNullValues && this.hasAllNullValues(false))
        ctx = Object.assign({}, ctx, { allNullValues: true });
      return stringifyCollection2.stringifyCollection(this, ctx, {
        blockItemPrefix: "",
        flowChars: { start: "{", end: "}" },
        itemIndent: ctx.indent || "",
        onChompKeep,
        onComment
      });
    }
  };
  YAMLMap.YAMLMap = YAMLMap$1;
  YAMLMap.findPair = findPair;
  return YAMLMap;
}
var hasRequiredMap;
function requireMap() {
  if (hasRequiredMap) return map;
  hasRequiredMap = 1;
  var identity2 = requireIdentity();
  var YAMLMap2 = requireYAMLMap();
  const map$1 = {
    collection: "map",
    default: true,
    nodeClass: YAMLMap2.YAMLMap,
    tag: "tag:yaml.org,2002:map",
    resolve(map2, onError) {
      if (!identity2.isMap(map2))
        onError("Expected a mapping for this tag");
      return map2;
    },
    createNode: (schema2, obj, ctx) => YAMLMap2.YAMLMap.from(schema2, obj, ctx)
  };
  map.map = map$1;
  return map;
}
var seq = {};
var YAMLSeq = {};
var hasRequiredYAMLSeq;
function requireYAMLSeq() {
  if (hasRequiredYAMLSeq) return YAMLSeq;
  hasRequiredYAMLSeq = 1;
  var createNode2 = requireCreateNode();
  var stringifyCollection2 = requireStringifyCollection();
  var Collection2 = requireCollection();
  var identity2 = requireIdentity();
  var Scalar2 = requireScalar();
  var toJS2 = requireToJS();
  let YAMLSeq$1 = class YAMLSeq extends Collection2.Collection {
    static get tagName() {
      return "tag:yaml.org,2002:seq";
    }
    constructor(schema2) {
      super(identity2.SEQ, schema2);
      this.items = [];
    }
    add(value) {
      this.items.push(value);
    }
    /**
     * Removes a value from the collection.
     *
     * `key` must contain a representation of an integer for this to succeed.
     * It may be wrapped in a `Scalar`.
     *
     * @returns `true` if the item was found and removed.
     */
    delete(key) {
      const idx = asItemIndex(key);
      if (typeof idx !== "number")
        return false;
      const del = this.items.splice(idx, 1);
      return del.length > 0;
    }
    get(key, keepScalar) {
      const idx = asItemIndex(key);
      if (typeof idx !== "number")
        return void 0;
      const it = this.items[idx];
      return !keepScalar && identity2.isScalar(it) ? it.value : it;
    }
    /**
     * Checks if the collection includes a value with the key `key`.
     *
     * `key` must contain a representation of an integer for this to succeed.
     * It may be wrapped in a `Scalar`.
     */
    has(key) {
      const idx = asItemIndex(key);
      return typeof idx === "number" && idx < this.items.length;
    }
    /**
     * Sets a value in this collection. For `!!set`, `value` needs to be a
     * boolean to add/remove the item from the set.
     *
     * If `key` does not contain a representation of an integer, this will throw.
     * It may be wrapped in a `Scalar`.
     */
    set(key, value) {
      const idx = asItemIndex(key);
      if (typeof idx !== "number")
        throw new Error(`Expected a valid index, not ${key}.`);
      const prev = this.items[idx];
      if (identity2.isScalar(prev) && Scalar2.isScalarValue(value))
        prev.value = value;
      else
        this.items[idx] = value;
    }
    toJSON(_, ctx) {
      const seq2 = [];
      if (ctx?.onCreate)
        ctx.onCreate(seq2);
      let i = 0;
      for (const item of this.items)
        seq2.push(toJS2.toJS(item, String(i++), ctx));
      return seq2;
    }
    toString(ctx, onComment, onChompKeep) {
      if (!ctx)
        return JSON.stringify(this);
      return stringifyCollection2.stringifyCollection(this, ctx, {
        blockItemPrefix: "- ",
        flowChars: { start: "[", end: "]" },
        itemIndent: (ctx.indent || "") + "  ",
        onChompKeep,
        onComment
      });
    }
    static from(schema2, obj, ctx) {
      const { replacer } = ctx;
      const seq2 = new this(schema2);
      if (obj && Symbol.iterator in Object(obj)) {
        let i = 0;
        for (let it of obj) {
          if (typeof replacer === "function") {
            const key = obj instanceof Set ? it : String(i++);
            it = replacer.call(obj, key, it);
          }
          seq2.items.push(createNode2.createNode(it, void 0, ctx));
        }
      }
      return seq2;
    }
  };
  function asItemIndex(key) {
    let idx = identity2.isScalar(key) ? key.value : key;
    if (idx && typeof idx === "string")
      idx = Number(idx);
    return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
  }
  YAMLSeq.YAMLSeq = YAMLSeq$1;
  return YAMLSeq;
}
var hasRequiredSeq;
function requireSeq() {
  if (hasRequiredSeq) return seq;
  hasRequiredSeq = 1;
  var identity2 = requireIdentity();
  var YAMLSeq2 = requireYAMLSeq();
  const seq$1 = {
    collection: "seq",
    default: true,
    nodeClass: YAMLSeq2.YAMLSeq,
    tag: "tag:yaml.org,2002:seq",
    resolve(seq2, onError) {
      if (!identity2.isSeq(seq2))
        onError("Expected a sequence for this tag");
      return seq2;
    },
    createNode: (schema2, obj, ctx) => YAMLSeq2.YAMLSeq.from(schema2, obj, ctx)
  };
  seq.seq = seq$1;
  return seq;
}
var string$1 = {};
var hasRequiredString;
function requireString() {
  if (hasRequiredString) return string$1;
  hasRequiredString = 1;
  var stringifyString2 = requireStringifyString();
  const string2 = {
    identify: (value) => typeof value === "string",
    default: true,
    tag: "tag:yaml.org,2002:str",
    resolve: (str) => str,
    stringify(item, ctx, onComment, onChompKeep) {
      ctx = Object.assign({ actualString: true }, ctx);
      return stringifyString2.stringifyString(item, ctx, onComment, onChompKeep);
    }
  };
  string$1.string = string2;
  return string$1;
}
var tags = {};
var _null = {};
var hasRequired_null;
function require_null() {
  if (hasRequired_null) return _null;
  hasRequired_null = 1;
  var Scalar2 = requireScalar();
  const nullTag = {
    identify: (value) => value == null,
    createNode: () => new Scalar2.Scalar(null),
    default: true,
    tag: "tag:yaml.org,2002:null",
    test: /^(?:~|[Nn]ull|NULL)?$/,
    resolve: () => new Scalar2.Scalar(null),
    stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
  };
  _null.nullTag = nullTag;
  return _null;
}
var bool$1 = {};
var hasRequiredBool$1;
function requireBool$1() {
  if (hasRequiredBool$1) return bool$1;
  hasRequiredBool$1 = 1;
  var Scalar2 = requireScalar();
  const boolTag = {
    identify: (value) => typeof value === "boolean",
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
    resolve: (str) => new Scalar2.Scalar(str[0] === "t" || str[0] === "T"),
    stringify({ source, value }, ctx) {
      if (source && boolTag.test.test(source)) {
        const sv = source[0] === "t" || source[0] === "T";
        if (value === sv)
          return source;
      }
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
  };
  bool$1.boolTag = boolTag;
  return bool$1;
}
var float$1 = {};
var stringifyNumber = {};
var hasRequiredStringifyNumber;
function requireStringifyNumber() {
  if (hasRequiredStringifyNumber) return stringifyNumber;
  hasRequiredStringifyNumber = 1;
  function stringifyNumber$1({ format, minFractionDigits, tag, value }) {
    if (typeof value === "bigint")
      return String(value);
    const num = typeof value === "number" ? value : Number(value);
    if (!isFinite(num))
      return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
    let n = JSON.stringify(value);
    if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^\d/.test(n)) {
      let i = n.indexOf(".");
      if (i < 0) {
        i = n.length;
        n += ".";
      }
      let d = minFractionDigits - (n.length - i - 1);
      while (d-- > 0)
        n += "0";
    }
    return n;
  }
  stringifyNumber.stringifyNumber = stringifyNumber$1;
  return stringifyNumber;
}
var hasRequiredFloat$1;
function requireFloat$1() {
  if (hasRequiredFloat$1) return float$1;
  hasRequiredFloat$1 = 1;
  var Scalar2 = requireScalar();
  var stringifyNumber2 = requireStringifyNumber();
  const floatNaN = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
    resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    stringify: stringifyNumber2.stringifyNumber
  };
  const floatExp = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    format: "EXP",
    test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
    resolve: (str) => parseFloat(str),
    stringify(node2) {
      const num = Number(node2.value);
      return isFinite(num) ? num.toExponential() : stringifyNumber2.stringifyNumber(node2);
    }
  };
  const float2 = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
    resolve(str) {
      const node2 = new Scalar2.Scalar(parseFloat(str));
      const dot = str.indexOf(".");
      if (dot !== -1 && str[str.length - 1] === "0")
        node2.minFractionDigits = str.length - dot - 1;
      return node2;
    },
    stringify: stringifyNumber2.stringifyNumber
  };
  float$1.float = float2;
  float$1.floatExp = floatExp;
  float$1.floatNaN = floatNaN;
  return float$1;
}
var int$2 = {};
var hasRequiredInt$1;
function requireInt$1() {
  if (hasRequiredInt$1) return int$2;
  hasRequiredInt$1 = 1;
  var stringifyNumber2 = requireStringifyNumber();
  const intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
  const intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
  function intStringify(node2, radix, prefix) {
    const { value } = node2;
    if (intIdentify(value) && value >= 0)
      return prefix + value.toString(radix);
    return stringifyNumber2.stringifyNumber(node2);
  }
  const intOct = {
    identify: (value) => intIdentify(value) && value >= 0,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "OCT",
    test: /^0o[0-7]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
    stringify: (node2) => intStringify(node2, 8, "0o")
  };
  const int2 = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    test: /^[-+]?[0-9]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
    stringify: stringifyNumber2.stringifyNumber
  };
  const intHex = {
    identify: (value) => intIdentify(value) && value >= 0,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "HEX",
    test: /^0x[0-9a-fA-F]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
    stringify: (node2) => intStringify(node2, 16, "0x")
  };
  int$2.int = int2;
  int$2.intHex = intHex;
  int$2.intOct = intOct;
  return int$2;
}
var schema$2 = {};
var hasRequiredSchema$3;
function requireSchema$3() {
  if (hasRequiredSchema$3) return schema$2;
  hasRequiredSchema$3 = 1;
  var map2 = requireMap();
  var _null2 = require_null();
  var seq2 = requireSeq();
  var string2 = requireString();
  var bool2 = requireBool$1();
  var float2 = requireFloat$1();
  var int2 = requireInt$1();
  const schema2 = [
    map2.map,
    seq2.seq,
    string2.string,
    _null2.nullTag,
    bool2.boolTag,
    int2.intOct,
    int2.int,
    int2.intHex,
    float2.floatNaN,
    float2.floatExp,
    float2.float
  ];
  schema$2.schema = schema2;
  return schema$2;
}
var schema$1 = {};
var hasRequiredSchema$2;
function requireSchema$2() {
  if (hasRequiredSchema$2) return schema$1;
  hasRequiredSchema$2 = 1;
  var Scalar2 = requireScalar();
  var map2 = requireMap();
  var seq2 = requireSeq();
  function intIdentify(value) {
    return typeof value === "bigint" || Number.isInteger(value);
  }
  const stringifyJSON = ({ value }) => JSON.stringify(value);
  const jsonScalars = [
    {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify: stringifyJSON
    },
    {
      identify: (value) => value == null,
      createNode: () => new Scalar2.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^null$/,
      resolve: () => null,
      stringify: stringifyJSON
    },
    {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^true$|^false$/,
      resolve: (str) => str === "true",
      stringify: stringifyJSON
    },
    {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^-?(?:0|[1-9][0-9]*)$/,
      resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
      stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
    },
    {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
      resolve: (str) => parseFloat(str),
      stringify: stringifyJSON
    }
  ];
  const jsonError = {
    default: true,
    tag: "",
    test: /^/,
    resolve(str, onError) {
      onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
      return str;
    }
  };
  const schema2 = [map2.map, seq2.seq].concat(jsonScalars, jsonError);
  schema$1.schema = schema2;
  return schema$1;
}
var binary = {};
var hasRequiredBinary;
function requireBinary() {
  if (hasRequiredBinary) return binary;
  hasRequiredBinary = 1;
  var node_buffer = require$$0$1;
  var Scalar2 = requireScalar();
  var stringifyString2 = requireStringifyString();
  const binary$1 = {
    identify: (value) => value instanceof Uint8Array,
    // Buffer inherits from Uint8Array
    default: false,
    tag: "tag:yaml.org,2002:binary",
    /**
     * Returns a Buffer in node and an Uint8Array in browsers
     *
     * To use the resulting buffer as an image, you'll want to do something like:
     *
     *   const blob = new Blob([buffer], { type: 'image/jpeg' })
     *   document.querySelector('#photo').src = URL.createObjectURL(blob)
     */
    resolve(src, onError) {
      if (typeof node_buffer.Buffer === "function") {
        return node_buffer.Buffer.from(src, "base64");
      } else if (typeof atob === "function") {
        const str = atob(src.replace(/[\n\r]/g, ""));
        const buffer = new Uint8Array(str.length);
        for (let i = 0; i < str.length; ++i)
          buffer[i] = str.charCodeAt(i);
        return buffer;
      } else {
        onError("This environment does not support reading binary tags; either Buffer or atob is required");
        return src;
      }
    },
    stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
      if (!value)
        return "";
      const buf = value;
      let str;
      if (typeof node_buffer.Buffer === "function") {
        str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
      } else if (typeof btoa === "function") {
        let s = "";
        for (let i = 0; i < buf.length; ++i)
          s += String.fromCharCode(buf[i]);
        str = btoa(s);
      } else {
        throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
      }
      type ?? (type = Scalar2.Scalar.BLOCK_LITERAL);
      if (type !== Scalar2.Scalar.QUOTE_DOUBLE) {
        const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
        const n = Math.ceil(str.length / lineWidth);
        const lines = new Array(n);
        for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
          lines[i] = str.substr(o, lineWidth);
        }
        str = lines.join(type === Scalar2.Scalar.BLOCK_LITERAL ? "\n" : " ");
      }
      return stringifyString2.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
    }
  };
  binary.binary = binary$1;
  return binary;
}
var omap = {};
var pairs = {};
var hasRequiredPairs;
function requirePairs() {
  if (hasRequiredPairs) return pairs;
  hasRequiredPairs = 1;
  var identity2 = requireIdentity();
  var Pair2 = requirePair();
  var Scalar2 = requireScalar();
  var YAMLSeq2 = requireYAMLSeq();
  function resolvePairs(seq2, onError) {
    if (identity2.isSeq(seq2)) {
      for (let i = 0; i < seq2.items.length; ++i) {
        let item = seq2.items[i];
        if (identity2.isPair(item))
          continue;
        else if (identity2.isMap(item)) {
          if (item.items.length > 1)
            onError("Each pair must have its own sequence indicator");
          const pair = item.items[0] || new Pair2.Pair(new Scalar2.Scalar(null));
          if (item.commentBefore)
            pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
          if (item.comment) {
            const cn = pair.value ?? pair.key;
            cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
          }
          item = pair;
        }
        seq2.items[i] = identity2.isPair(item) ? item : new Pair2.Pair(item);
      }
    } else
      onError("Expected a sequence for this tag");
    return seq2;
  }
  function createPairs(schema2, iterable, ctx) {
    const { replacer } = ctx;
    const pairs2 = new YAMLSeq2.YAMLSeq(schema2);
    pairs2.tag = "tag:yaml.org,2002:pairs";
    let i = 0;
    if (iterable && Symbol.iterator in Object(iterable))
      for (let it of iterable) {
        if (typeof replacer === "function")
          it = replacer.call(iterable, String(i++), it);
        let key, value;
        if (Array.isArray(it)) {
          if (it.length === 2) {
            key = it[0];
            value = it[1];
          } else
            throw new TypeError(`Expected [key, value] tuple: ${it}`);
        } else if (it && it instanceof Object) {
          const keys = Object.keys(it);
          if (keys.length === 1) {
            key = keys[0];
            value = it[key];
          } else {
            throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
          }
        } else {
          key = it;
        }
        pairs2.items.push(Pair2.createPair(key, value, ctx));
      }
    return pairs2;
  }
  const pairs$1 = {
    collection: "seq",
    default: false,
    tag: "tag:yaml.org,2002:pairs",
    resolve: resolvePairs,
    createNode: createPairs
  };
  pairs.createPairs = createPairs;
  pairs.pairs = pairs$1;
  pairs.resolvePairs = resolvePairs;
  return pairs;
}
var hasRequiredOmap;
function requireOmap() {
  if (hasRequiredOmap) return omap;
  hasRequiredOmap = 1;
  var identity2 = requireIdentity();
  var toJS2 = requireToJS();
  var YAMLMap2 = requireYAMLMap();
  var YAMLSeq2 = requireYAMLSeq();
  var pairs2 = requirePairs();
  class YAMLOMap extends YAMLSeq2.YAMLSeq {
    constructor() {
      super();
      this.add = YAMLMap2.YAMLMap.prototype.add.bind(this);
      this.delete = YAMLMap2.YAMLMap.prototype.delete.bind(this);
      this.get = YAMLMap2.YAMLMap.prototype.get.bind(this);
      this.has = YAMLMap2.YAMLMap.prototype.has.bind(this);
      this.set = YAMLMap2.YAMLMap.prototype.set.bind(this);
      this.tag = YAMLOMap.tag;
    }
    /**
     * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
     * but TypeScript won't allow widening the signature of a child method.
     */
    toJSON(_, ctx) {
      if (!ctx)
        return super.toJSON(_);
      const map2 = /* @__PURE__ */ new Map();
      if (ctx?.onCreate)
        ctx.onCreate(map2);
      for (const pair of this.items) {
        let key, value;
        if (identity2.isPair(pair)) {
          key = toJS2.toJS(pair.key, "", ctx);
          value = toJS2.toJS(pair.value, key, ctx);
        } else {
          key = toJS2.toJS(pair, "", ctx);
        }
        if (map2.has(key))
          throw new Error("Ordered maps must not include duplicate keys");
        map2.set(key, value);
      }
      return map2;
    }
    static from(schema2, iterable, ctx) {
      const pairs$1 = pairs2.createPairs(schema2, iterable, ctx);
      const omap2 = new this();
      omap2.items = pairs$1.items;
      return omap2;
    }
  }
  YAMLOMap.tag = "tag:yaml.org,2002:omap";
  const omap$1 = {
    collection: "seq",
    identify: (value) => value instanceof Map,
    nodeClass: YAMLOMap,
    default: false,
    tag: "tag:yaml.org,2002:omap",
    resolve(seq2, onError) {
      const pairs$1 = pairs2.resolvePairs(seq2, onError);
      const seenKeys = [];
      for (const { key } of pairs$1.items) {
        if (identity2.isScalar(key)) {
          if (seenKeys.includes(key.value)) {
            onError(`Ordered maps must not include duplicate keys: ${key.value}`);
          } else {
            seenKeys.push(key.value);
          }
        }
      }
      return Object.assign(new YAMLOMap(), pairs$1);
    },
    createNode: (schema2, iterable, ctx) => YAMLOMap.from(schema2, iterable, ctx)
  };
  omap.YAMLOMap = YAMLOMap;
  omap.omap = omap$1;
  return omap;
}
var schema = {};
var bool = {};
var hasRequiredBool;
function requireBool() {
  if (hasRequiredBool) return bool;
  hasRequiredBool = 1;
  var Scalar2 = requireScalar();
  function boolStringify({ value, source }, ctx) {
    const boolObj = value ? trueTag : falseTag;
    if (source && boolObj.test.test(source))
      return source;
    return value ? ctx.options.trueStr : ctx.options.falseStr;
  }
  const trueTag = {
    identify: (value) => value === true,
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
    resolve: () => new Scalar2.Scalar(true),
    stringify: boolStringify
  };
  const falseTag = {
    identify: (value) => value === false,
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
    resolve: () => new Scalar2.Scalar(false),
    stringify: boolStringify
  };
  bool.falseTag = falseTag;
  bool.trueTag = trueTag;
  return bool;
}
var float = {};
var hasRequiredFloat;
function requireFloat() {
  if (hasRequiredFloat) return float;
  hasRequiredFloat = 1;
  var Scalar2 = requireScalar();
  var stringifyNumber2 = requireStringifyNumber();
  const floatNaN = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
    resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    stringify: stringifyNumber2.stringifyNumber
  };
  const floatExp = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    format: "EXP",
    test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
    resolve: (str) => parseFloat(str.replace(/_/g, "")),
    stringify(node2) {
      const num = Number(node2.value);
      return isFinite(num) ? num.toExponential() : stringifyNumber2.stringifyNumber(node2);
    }
  };
  const float$12 = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
    resolve(str) {
      const node2 = new Scalar2.Scalar(parseFloat(str.replace(/_/g, "")));
      const dot = str.indexOf(".");
      if (dot !== -1) {
        const f = str.substring(dot + 1).replace(/_/g, "");
        if (f[f.length - 1] === "0")
          node2.minFractionDigits = f.length;
      }
      return node2;
    },
    stringify: stringifyNumber2.stringifyNumber
  };
  float.float = float$12;
  float.floatExp = floatExp;
  float.floatNaN = floatNaN;
  return float;
}
var int$1 = {};
var hasRequiredInt;
function requireInt() {
  if (hasRequiredInt) return int$1;
  hasRequiredInt = 1;
  var stringifyNumber2 = requireStringifyNumber();
  const intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
  function intResolve(str, offset, radix, { intAsBigInt }) {
    const sign = str[0];
    if (sign === "-" || sign === "+")
      offset += 1;
    str = str.substring(offset).replace(/_/g, "");
    if (intAsBigInt) {
      switch (radix) {
        case 2:
          str = `0b${str}`;
          break;
        case 8:
          str = `0o${str}`;
          break;
        case 16:
          str = `0x${str}`;
          break;
      }
      const n2 = BigInt(str);
      return sign === "-" ? BigInt(-1) * n2 : n2;
    }
    const n = parseInt(str, radix);
    return sign === "-" ? -1 * n : n;
  }
  function intStringify(node2, radix, prefix) {
    const { value } = node2;
    if (intIdentify(value)) {
      const str = value.toString(radix);
      return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
    }
    return stringifyNumber2.stringifyNumber(node2);
  }
  const intBin = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "BIN",
    test: /^[-+]?0b[0-1_]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
    stringify: (node2) => intStringify(node2, 2, "0b")
  };
  const intOct = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "OCT",
    test: /^[-+]?0[0-7_]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
    stringify: (node2) => intStringify(node2, 8, "0")
  };
  const int2 = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    test: /^[-+]?[0-9][0-9_]*$/,
    resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
    stringify: stringifyNumber2.stringifyNumber
  };
  const intHex = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "HEX",
    test: /^[-+]?0x[0-9a-fA-F_]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
    stringify: (node2) => intStringify(node2, 16, "0x")
  };
  int$1.int = int2;
  int$1.intBin = intBin;
  int$1.intHex = intHex;
  int$1.intOct = intOct;
  return int$1;
}
var set = {};
var hasRequiredSet;
function requireSet() {
  if (hasRequiredSet) return set;
  hasRequiredSet = 1;
  var identity2 = requireIdentity();
  var Pair2 = requirePair();
  var YAMLMap2 = requireYAMLMap();
  class YAMLSet extends YAMLMap2.YAMLMap {
    constructor(schema2) {
      super(schema2);
      this.tag = YAMLSet.tag;
    }
    add(key) {
      let pair;
      if (identity2.isPair(key))
        pair = key;
      else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
        pair = new Pair2.Pair(key.key, null);
      else
        pair = new Pair2.Pair(key, null);
      const prev = YAMLMap2.findPair(this.items, pair.key);
      if (!prev)
        this.items.push(pair);
    }
    /**
     * If `keepPair` is `true`, returns the Pair matching `key`.
     * Otherwise, returns the value of that Pair's key.
     */
    get(key, keepPair) {
      const pair = YAMLMap2.findPair(this.items, key);
      return !keepPair && identity2.isPair(pair) ? identity2.isScalar(pair.key) ? pair.key.value : pair.key : pair;
    }
    set(key, value) {
      if (typeof value !== "boolean")
        throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
      const prev = YAMLMap2.findPair(this.items, key);
      if (prev && !value) {
        this.items.splice(this.items.indexOf(prev), 1);
      } else if (!prev && value) {
        this.items.push(new Pair2.Pair(key));
      }
    }
    toJSON(_, ctx) {
      return super.toJSON(_, ctx, Set);
    }
    toString(ctx, onComment, onChompKeep) {
      if (!ctx)
        return JSON.stringify(this);
      if (this.hasAllNullValues(true))
        return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
      else
        throw new Error("Set items must all have null values");
    }
    static from(schema2, iterable, ctx) {
      const { replacer } = ctx;
      const set2 = new this(schema2);
      if (iterable && Symbol.iterator in Object(iterable))
        for (let value of iterable) {
          if (typeof replacer === "function")
            value = replacer.call(iterable, value, value);
          set2.items.push(Pair2.createPair(value, null, ctx));
        }
      return set2;
    }
  }
  YAMLSet.tag = "tag:yaml.org,2002:set";
  const set$1 = {
    collection: "map",
    identify: (value) => value instanceof Set,
    nodeClass: YAMLSet,
    default: false,
    tag: "tag:yaml.org,2002:set",
    createNode: (schema2, iterable, ctx) => YAMLSet.from(schema2, iterable, ctx),
    resolve(map2, onError) {
      if (identity2.isMap(map2)) {
        if (map2.hasAllNullValues(true))
          return Object.assign(new YAMLSet(), map2);
        else
          onError("Set items must all have null values");
      } else
        onError("Expected a mapping for this tag");
      return map2;
    }
  };
  set.YAMLSet = YAMLSet;
  set.set = set$1;
  return set;
}
var timestamp = {};
var hasRequiredTimestamp;
function requireTimestamp() {
  if (hasRequiredTimestamp) return timestamp;
  hasRequiredTimestamp = 1;
  var stringifyNumber2 = requireStringifyNumber();
  function parseSexagesimal(str, asBigInt) {
    const sign = str[0];
    const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
    const num = (n) => asBigInt ? BigInt(n) : Number(n);
    const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
    return sign === "-" ? num(-1) * res : res;
  }
  function stringifySexagesimal(node2) {
    let { value } = node2;
    let num = (n) => n;
    if (typeof value === "bigint")
      num = (n) => BigInt(n);
    else if (isNaN(value) || !isFinite(value))
      return stringifyNumber2.stringifyNumber(node2);
    let sign = "";
    if (value < 0) {
      sign = "-";
      value *= num(-1);
    }
    const _60 = num(60);
    const parts = [value % _60];
    if (value < 60) {
      parts.unshift(0);
    } else {
      value = (value - parts[0]) / _60;
      parts.unshift(value % _60);
      if (value >= 60) {
        value = (value - parts[0]) / _60;
        parts.unshift(value);
      }
    }
    return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
  }
  const intTime = {
    identify: (value) => typeof value === "bigint" || Number.isInteger(value),
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "TIME",
    test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
    resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
    stringify: stringifySexagesimal
  };
  const floatTime = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    format: "TIME",
    test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
    resolve: (str) => parseSexagesimal(str, false),
    stringify: stringifySexagesimal
  };
  const timestamp$1 = {
    identify: (value) => value instanceof Date,
    default: true,
    tag: "tag:yaml.org,2002:timestamp",
    // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
    // may be omitted altogether, resulting in a date format. In such a case, the time part is
    // assumed to be 00:00:00Z (start of day, UTC).
    test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
    resolve(str) {
      const match = str.match(timestamp$1.test);
      if (!match)
        throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
      const [, year, month, day, hour, minute, second] = match.map(Number);
      const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
      let date2 = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
      const tz = match[8];
      if (tz && tz !== "Z") {
        let d = parseSexagesimal(tz, false);
        if (Math.abs(d) < 30)
          d *= 60;
        date2 -= 6e4 * d;
      }
      return new Date(date2);
    },
    stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
  };
  timestamp.floatTime = floatTime;
  timestamp.intTime = intTime;
  timestamp.timestamp = timestamp$1;
  return timestamp;
}
var hasRequiredSchema$1;
function requireSchema$1() {
  if (hasRequiredSchema$1) return schema;
  hasRequiredSchema$1 = 1;
  var map2 = requireMap();
  var _null2 = require_null();
  var seq2 = requireSeq();
  var string2 = requireString();
  var binary2 = requireBinary();
  var bool2 = requireBool();
  var float2 = requireFloat();
  var int2 = requireInt();
  var merge2 = requireMerge();
  var omap2 = requireOmap();
  var pairs2 = requirePairs();
  var set2 = requireSet();
  var timestamp2 = requireTimestamp();
  const schema$12 = [
    map2.map,
    seq2.seq,
    string2.string,
    _null2.nullTag,
    bool2.trueTag,
    bool2.falseTag,
    int2.intBin,
    int2.intOct,
    int2.int,
    int2.intHex,
    float2.floatNaN,
    float2.floatExp,
    float2.float,
    binary2.binary,
    merge2.merge,
    omap2.omap,
    pairs2.pairs,
    set2.set,
    timestamp2.intTime,
    timestamp2.floatTime,
    timestamp2.timestamp
  ];
  schema.schema = schema$12;
  return schema;
}
var hasRequiredTags;
function requireTags() {
  if (hasRequiredTags) return tags;
  hasRequiredTags = 1;
  var map2 = requireMap();
  var _null2 = require_null();
  var seq2 = requireSeq();
  var string2 = requireString();
  var bool2 = requireBool$1();
  var float2 = requireFloat$1();
  var int2 = requireInt$1();
  var schema2 = requireSchema$3();
  var schema$12 = requireSchema$2();
  var binary2 = requireBinary();
  var merge2 = requireMerge();
  var omap2 = requireOmap();
  var pairs2 = requirePairs();
  var schema$22 = requireSchema$1();
  var set2 = requireSet();
  var timestamp2 = requireTimestamp();
  const schemas = /* @__PURE__ */ new Map([
    ["core", schema2.schema],
    ["failsafe", [map2.map, seq2.seq, string2.string]],
    ["json", schema$12.schema],
    ["yaml11", schema$22.schema],
    ["yaml-1.1", schema$22.schema]
  ]);
  const tagsByName = {
    binary: binary2.binary,
    bool: bool2.boolTag,
    float: float2.float,
    floatExp: float2.floatExp,
    floatNaN: float2.floatNaN,
    floatTime: timestamp2.floatTime,
    int: int2.int,
    intHex: int2.intHex,
    intOct: int2.intOct,
    intTime: timestamp2.intTime,
    map: map2.map,
    merge: merge2.merge,
    null: _null2.nullTag,
    omap: omap2.omap,
    pairs: pairs2.pairs,
    seq: seq2.seq,
    set: set2.set,
    timestamp: timestamp2.timestamp
  };
  const coreKnownTags = {
    "tag:yaml.org,2002:binary": binary2.binary,
    "tag:yaml.org,2002:merge": merge2.merge,
    "tag:yaml.org,2002:omap": omap2.omap,
    "tag:yaml.org,2002:pairs": pairs2.pairs,
    "tag:yaml.org,2002:set": set2.set,
    "tag:yaml.org,2002:timestamp": timestamp2.timestamp
  };
  function getTags(customTags, schemaName, addMergeTag) {
    const schemaTags = schemas.get(schemaName);
    if (schemaTags && !customTags) {
      return addMergeTag && !schemaTags.includes(merge2.merge) ? schemaTags.concat(merge2.merge) : schemaTags.slice();
    }
    let tags2 = schemaTags;
    if (!tags2) {
      if (Array.isArray(customTags))
        tags2 = [];
      else {
        const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
        throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
      }
    }
    if (Array.isArray(customTags)) {
      for (const tag of customTags)
        tags2 = tags2.concat(tag);
    } else if (typeof customTags === "function") {
      tags2 = customTags(tags2.slice());
    }
    if (addMergeTag)
      tags2 = tags2.concat(merge2.merge);
    return tags2.reduce((tags3, tag) => {
      const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
      if (!tagObj) {
        const tagName = JSON.stringify(tag);
        const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
        throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
      }
      if (!tags3.includes(tagObj))
        tags3.push(tagObj);
      return tags3;
    }, []);
  }
  tags.coreKnownTags = coreKnownTags;
  tags.getTags = getTags;
  return tags;
}
var hasRequiredSchema;
function requireSchema() {
  if (hasRequiredSchema) return Schema;
  hasRequiredSchema = 1;
  var identity2 = requireIdentity();
  var map2 = requireMap();
  var seq2 = requireSeq();
  var string2 = requireString();
  var tags2 = requireTags();
  const sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  let Schema$1 = class Schema2 {
    constructor({ compat, customTags, merge: merge2, resolveKnownTags, schema: schema2, sortMapEntries, toStringDefaults }) {
      this.compat = Array.isArray(compat) ? tags2.getTags(compat, "compat") : compat ? tags2.getTags(null, compat) : null;
      this.name = typeof schema2 === "string" && schema2 || "core";
      this.knownTags = resolveKnownTags ? tags2.coreKnownTags : {};
      this.tags = tags2.getTags(customTags, this.name, merge2);
      this.toStringOptions = toStringDefaults ?? null;
      Object.defineProperty(this, identity2.MAP, { value: map2.map });
      Object.defineProperty(this, identity2.SCALAR, { value: string2.string });
      Object.defineProperty(this, identity2.SEQ, { value: seq2.seq });
      this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
    }
    clone() {
      const copy = Object.create(Schema2.prototype, Object.getOwnPropertyDescriptors(this));
      copy.tags = this.tags.slice();
      return copy;
    }
  };
  Schema.Schema = Schema$1;
  return Schema;
}
var stringifyDocument = {};
var hasRequiredStringifyDocument;
function requireStringifyDocument() {
  if (hasRequiredStringifyDocument) return stringifyDocument;
  hasRequiredStringifyDocument = 1;
  var identity2 = requireIdentity();
  var stringify2 = requireStringify();
  var stringifyComment2 = requireStringifyComment();
  function stringifyDocument$1(doc, options) {
    const lines = [];
    let hasDirectives = options.directives === true;
    if (options.directives !== false && doc.directives) {
      const dir = doc.directives.toString(doc);
      if (dir) {
        lines.push(dir);
        hasDirectives = true;
      } else if (doc.directives.docStart)
        hasDirectives = true;
    }
    if (hasDirectives)
      lines.push("---");
    const ctx = stringify2.createStringifyContext(doc, options);
    const { commentString } = ctx.options;
    if (doc.commentBefore) {
      if (lines.length !== 1)
        lines.unshift("");
      const cs = commentString(doc.commentBefore);
      lines.unshift(stringifyComment2.indentComment(cs, ""));
    }
    let chompKeep = false;
    let contentComment = null;
    if (doc.contents) {
      if (identity2.isNode(doc.contents)) {
        if (doc.contents.spaceBefore && hasDirectives)
          lines.push("");
        if (doc.contents.commentBefore) {
          const cs = commentString(doc.contents.commentBefore);
          lines.push(stringifyComment2.indentComment(cs, ""));
        }
        ctx.forceBlockIndent = !!doc.comment;
        contentComment = doc.contents.comment;
      }
      const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
      let body = stringify2.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
      if (contentComment)
        body += stringifyComment2.lineComment(body, "", commentString(contentComment));
      if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
        lines[lines.length - 1] = `--- ${body}`;
      } else
        lines.push(body);
    } else {
      lines.push(stringify2.stringify(doc.contents, ctx));
    }
    if (doc.directives?.docEnd) {
      if (doc.comment) {
        const cs = commentString(doc.comment);
        if (cs.includes("\n")) {
          lines.push("...");
          lines.push(stringifyComment2.indentComment(cs, ""));
        } else {
          lines.push(`... ${cs}`);
        }
      } else {
        lines.push("...");
      }
    } else {
      let dc = doc.comment;
      if (dc && chompKeep)
        dc = dc.replace(/^\n+/, "");
      if (dc) {
        if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
          lines.push("");
        lines.push(stringifyComment2.indentComment(commentString(dc), ""));
      }
    }
    return lines.join("\n") + "\n";
  }
  stringifyDocument.stringifyDocument = stringifyDocument$1;
  return stringifyDocument;
}
var hasRequiredDocument;
function requireDocument() {
  if (hasRequiredDocument) return Document;
  hasRequiredDocument = 1;
  var Alias2 = requireAlias();
  var Collection2 = requireCollection();
  var identity2 = requireIdentity();
  var Pair2 = requirePair();
  var toJS2 = requireToJS();
  var Schema2 = requireSchema();
  var stringifyDocument2 = requireStringifyDocument();
  var anchors2 = requireAnchors();
  var applyReviver2 = requireApplyReviver();
  var createNode2 = requireCreateNode();
  var directives2 = requireDirectives();
  let Document$1 = class Document2 {
    constructor(value, replacer, options) {
      this.commentBefore = null;
      this.comment = null;
      this.errors = [];
      this.warnings = [];
      Object.defineProperty(this, identity2.NODE_TYPE, { value: identity2.DOC });
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
        replacer = void 0;
      }
      const opt = Object.assign({
        intAsBigInt: false,
        keepSourceTokens: false,
        logLevel: "warn",
        prettyErrors: true,
        strict: true,
        stringKeys: false,
        uniqueKeys: true,
        version: "1.2"
      }, options);
      this.options = opt;
      let { version: version2 } = opt;
      if (options?._directives) {
        this.directives = options._directives.atDocument();
        if (this.directives.yaml.explicit)
          version2 = this.directives.yaml.version;
      } else
        this.directives = new directives2.Directives({ version: version2 });
      this.setSchema(version2, options);
      this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
    }
    /**
     * Create a deep copy of this Document and its contents.
     *
     * Custom Node values that inherit from `Object` still refer to their original instances.
     */
    clone() {
      const copy = Object.create(Document2.prototype, {
        [identity2.NODE_TYPE]: { value: identity2.DOC }
      });
      copy.commentBefore = this.commentBefore;
      copy.comment = this.comment;
      copy.errors = this.errors.slice();
      copy.warnings = this.warnings.slice();
      copy.options = Object.assign({}, this.options);
      if (this.directives)
        copy.directives = this.directives.clone();
      copy.schema = this.schema.clone();
      copy.contents = identity2.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
      if (this.range)
        copy.range = this.range.slice();
      return copy;
    }
    /** Adds a value to the document. */
    add(value) {
      if (assertCollection(this.contents))
        this.contents.add(value);
    }
    /** Adds a value to the document. */
    addIn(path, value) {
      if (assertCollection(this.contents))
        this.contents.addIn(path, value);
    }
    /**
     * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
     *
     * If `node` already has an anchor, `name` is ignored.
     * Otherwise, the `node.anchor` value will be set to `name`,
     * or if an anchor with that name is already present in the document,
     * `name` will be used as a prefix for a new unique anchor.
     * If `name` is undefined, the generated anchor will use 'a' as a prefix.
     */
    createAlias(node2, name) {
      if (!node2.anchor) {
        const prev = anchors2.anchorNames(this);
        node2.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        !name || prev.has(name) ? anchors2.findNewAnchor(name || "a", prev) : name;
      }
      return new Alias2.Alias(node2.anchor);
    }
    createNode(value, replacer, options) {
      let _replacer = void 0;
      if (typeof replacer === "function") {
        value = replacer.call({ "": value }, "", value);
        _replacer = replacer;
      } else if (Array.isArray(replacer)) {
        const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
        const asStr = replacer.filter(keyToStr).map(String);
        if (asStr.length > 0)
          replacer = replacer.concat(asStr);
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
        replacer = void 0;
      }
      const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
      const { onAnchor, setAnchors, sourceObjects } = anchors2.createNodeAnchors(
        this,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        anchorPrefix || "a"
      );
      const ctx = {
        aliasDuplicateObjects: aliasDuplicateObjects ?? true,
        keepUndefined: keepUndefined ?? false,
        onAnchor,
        onTagObj,
        replacer: _replacer,
        schema: this.schema,
        sourceObjects
      };
      const node2 = createNode2.createNode(value, tag, ctx);
      if (flow && identity2.isCollection(node2))
        node2.flow = true;
      setAnchors();
      return node2;
    }
    /**
     * Convert a key and a value into a `Pair` using the current schema,
     * recursively wrapping all values as `Scalar` or `Collection` nodes.
     */
    createPair(key, value, options = {}) {
      const k = this.createNode(key, null, options);
      const v = this.createNode(value, null, options);
      return new Pair2.Pair(k, v);
    }
    /**
     * Removes a value from the document.
     * @returns `true` if the item was found and removed.
     */
    delete(key) {
      return assertCollection(this.contents) ? this.contents.delete(key) : false;
    }
    /**
     * Removes a value from the document.
     * @returns `true` if the item was found and removed.
     */
    deleteIn(path) {
      if (Collection2.isEmptyPath(path)) {
        if (this.contents == null)
          return false;
        this.contents = null;
        return true;
      }
      return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
    }
    /**
     * Returns item at `key`, or `undefined` if not found. By default unwraps
     * scalar values from their surrounding node; to disable set `keepScalar` to
     * `true` (collections are always returned intact).
     */
    get(key, keepScalar) {
      return identity2.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
    }
    /**
     * Returns item at `path`, or `undefined` if not found. By default unwraps
     * scalar values from their surrounding node; to disable set `keepScalar` to
     * `true` (collections are always returned intact).
     */
    getIn(path, keepScalar) {
      if (Collection2.isEmptyPath(path))
        return !keepScalar && identity2.isScalar(this.contents) ? this.contents.value : this.contents;
      return identity2.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
    }
    /**
     * Checks if the document includes a value with the key `key`.
     */
    has(key) {
      return identity2.isCollection(this.contents) ? this.contents.has(key) : false;
    }
    /**
     * Checks if the document includes a value at `path`.
     */
    hasIn(path) {
      if (Collection2.isEmptyPath(path))
        return this.contents !== void 0;
      return identity2.isCollection(this.contents) ? this.contents.hasIn(path) : false;
    }
    /**
     * Sets a value in this document. For `!!set`, `value` needs to be a
     * boolean to add/remove the item from the set.
     */
    set(key, value) {
      if (this.contents == null) {
        this.contents = Collection2.collectionFromPath(this.schema, [key], value);
      } else if (assertCollection(this.contents)) {
        this.contents.set(key, value);
      }
    }
    /**
     * Sets a value in this document. For `!!set`, `value` needs to be a
     * boolean to add/remove the item from the set.
     */
    setIn(path, value) {
      if (Collection2.isEmptyPath(path)) {
        this.contents = value;
      } else if (this.contents == null) {
        this.contents = Collection2.collectionFromPath(this.schema, Array.from(path), value);
      } else if (assertCollection(this.contents)) {
        this.contents.setIn(path, value);
      }
    }
    /**
     * Change the YAML version and schema used by the document.
     * A `null` version disables support for directives, explicit tags, anchors, and aliases.
     * It also requires the `schema` option to be given as a `Schema` instance value.
     *
     * Overrides all previously set schema options.
     */
    setSchema(version2, options = {}) {
      if (typeof version2 === "number")
        version2 = String(version2);
      let opt;
      switch (version2) {
        case "1.1":
          if (this.directives)
            this.directives.yaml.version = "1.1";
          else
            this.directives = new directives2.Directives({ version: "1.1" });
          opt = { resolveKnownTags: false, schema: "yaml-1.1" };
          break;
        case "1.2":
        case "next":
          if (this.directives)
            this.directives.yaml.version = version2;
          else
            this.directives = new directives2.Directives({ version: version2 });
          opt = { resolveKnownTags: true, schema: "core" };
          break;
        case null:
          if (this.directives)
            delete this.directives;
          opt = null;
          break;
        default: {
          const sv = JSON.stringify(version2);
          throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
        }
      }
      if (options.schema instanceof Object)
        this.schema = options.schema;
      else if (opt)
        this.schema = new Schema2.Schema(Object.assign(opt, options));
      else
        throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
    }
    // json & jsonArg are only used from toJSON()
    toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
      const ctx = {
        anchors: /* @__PURE__ */ new Map(),
        doc: this,
        keep: !json,
        mapAsMap: mapAsMap === true,
        mapKeyWarned: false,
        maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
      };
      const res = toJS2.toJS(this.contents, jsonArg ?? "", ctx);
      if (typeof onAnchor === "function")
        for (const { count, res: res2 } of ctx.anchors.values())
          onAnchor(res2, count);
      return typeof reviver === "function" ? applyReviver2.applyReviver(reviver, { "": res }, "", res) : res;
    }
    /**
     * A JSON representation of the document `contents`.
     *
     * @param jsonArg Used by `JSON.stringify` to indicate the array index or
     *   property name.
     */
    toJSON(jsonArg, onAnchor) {
      return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
    }
    /** A YAML representation of the document. */
    toString(options = {}) {
      if (this.errors.length > 0)
        throw new Error("Document with errors cannot be stringified");
      if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
        const s = JSON.stringify(options.indent);
        throw new Error(`"indent" option must be a positive integer, not ${s}`);
      }
      return stringifyDocument2.stringifyDocument(this, options);
    }
  };
  function assertCollection(contents) {
    if (identity2.isCollection(contents))
      return true;
    throw new Error("Expected a YAML collection as document contents");
  }
  Document.Document = Document$1;
  return Document;
}
var errors = {};
var hasRequiredErrors;
function requireErrors() {
  if (hasRequiredErrors) return errors;
  hasRequiredErrors = 1;
  class YAMLError extends Error {
    constructor(name, pos, code, message) {
      super();
      this.name = name;
      this.code = code;
      this.message = message;
      this.pos = pos;
    }
  }
  class YAMLParseError extends YAMLError {
    constructor(pos, code, message) {
      super("YAMLParseError", pos, code, message);
    }
  }
  class YAMLWarning extends YAMLError {
    constructor(pos, code, message) {
      super("YAMLWarning", pos, code, message);
    }
  }
  const prettifyError = (src, lc) => (error2) => {
    if (error2.pos[0] === -1)
      return;
    error2.linePos = error2.pos.map((pos) => lc.linePos(pos));
    const { line, col } = error2.linePos[0];
    error2.message += ` at line ${line}, column ${col}`;
    let ci = col - 1;
    let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
    if (ci >= 60 && lineStr.length > 80) {
      const trimStart = Math.min(ci - 39, lineStr.length - 79);
      lineStr = "…" + lineStr.substring(trimStart);
      ci -= trimStart - 1;
    }
    if (lineStr.length > 80)
      lineStr = lineStr.substring(0, 79) + "…";
    if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
      let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
      if (prev.length > 80)
        prev = prev.substring(0, 79) + "…\n";
      lineStr = prev + lineStr;
    }
    if (/[^ ]/.test(lineStr)) {
      let count = 1;
      const end = error2.linePos[1];
      if (end && end.line === line && end.col > col) {
        count = Math.max(1, Math.min(end.col - col, 80 - ci));
      }
      const pointer = " ".repeat(ci) + "^".repeat(count);
      error2.message += `:

${lineStr}
${pointer}
`;
    }
  };
  errors.YAMLError = YAMLError;
  errors.YAMLParseError = YAMLParseError;
  errors.YAMLWarning = YAMLWarning;
  errors.prettifyError = prettifyError;
  return errors;
}
var composeDoc = {};
var composeNode = {};
var composeCollection = {};
var resolveBlockMap = {};
var resolveProps = {};
var hasRequiredResolveProps;
function requireResolveProps() {
  if (hasRequiredResolveProps) return resolveProps;
  hasRequiredResolveProps = 1;
  function resolveProps$1(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
    let spaceBefore = false;
    let atNewline = startOnNewline;
    let hasSpace = startOnNewline;
    let comment = "";
    let commentSep = "";
    let hasNewline = false;
    let reqSpace = false;
    let tab = null;
    let anchor2 = null;
    let tag = null;
    let newlineAfterProp = null;
    let comma = null;
    let found = null;
    let start = null;
    for (const token of tokens) {
      if (reqSpace) {
        if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
          onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
        reqSpace = false;
      }
      if (tab) {
        if (atNewline && token.type !== "comment" && token.type !== "newline") {
          onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
        }
        tab = null;
      }
      switch (token.type) {
        case "space":
          if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
            tab = token;
          }
          hasSpace = true;
          break;
        case "comment": {
          if (!hasSpace)
            onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
          const cb = token.source.substring(1) || " ";
          if (!comment)
            comment = cb;
          else
            comment += commentSep + cb;
          commentSep = "";
          atNewline = false;
          break;
        }
        case "newline":
          if (atNewline) {
            if (comment)
              comment += token.source;
            else if (!found || indicator !== "seq-item-ind")
              spaceBefore = true;
          } else
            commentSep += token.source;
          atNewline = true;
          hasNewline = true;
          if (anchor2 || tag)
            newlineAfterProp = token;
          hasSpace = true;
          break;
        case "anchor":
          if (anchor2)
            onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
          if (token.source.endsWith(":"))
            onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
          anchor2 = token;
          start ?? (start = token.offset);
          atNewline = false;
          hasSpace = false;
          reqSpace = true;
          break;
        case "tag": {
          if (tag)
            onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
          tag = token;
          start ?? (start = token.offset);
          atNewline = false;
          hasSpace = false;
          reqSpace = true;
          break;
        }
        case indicator:
          if (anchor2 || tag)
            onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
          if (found)
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
          found = token;
          atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
          hasSpace = false;
          break;
        case "comma":
          if (flow) {
            if (comma)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
            comma = token;
            atNewline = false;
            hasSpace = false;
            break;
          }
        // else fallthrough
        default:
          onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
          atNewline = false;
          hasSpace = false;
      }
    }
    const last = tokens[tokens.length - 1];
    const end = last ? last.offset + last.source.length : offset;
    if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
      onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
    }
    if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
      onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
    return {
      comma,
      found,
      spaceBefore,
      comment,
      hasNewline,
      anchor: anchor2,
      tag,
      newlineAfterProp,
      end,
      start: start ?? end
    };
  }
  resolveProps.resolveProps = resolveProps$1;
  return resolveProps;
}
var utilContainsNewline = {};
var hasRequiredUtilContainsNewline;
function requireUtilContainsNewline() {
  if (hasRequiredUtilContainsNewline) return utilContainsNewline;
  hasRequiredUtilContainsNewline = 1;
  function containsNewline(key) {
    if (!key)
      return null;
    switch (key.type) {
      case "alias":
      case "scalar":
      case "double-quoted-scalar":
      case "single-quoted-scalar":
        if (key.source.includes("\n"))
          return true;
        if (key.end) {
          for (const st of key.end)
            if (st.type === "newline")
              return true;
        }
        return false;
      case "flow-collection":
        for (const it of key.items) {
          for (const st of it.start)
            if (st.type === "newline")
              return true;
          if (it.sep) {
            for (const st of it.sep)
              if (st.type === "newline")
                return true;
          }
          if (containsNewline(it.key) || containsNewline(it.value))
            return true;
        }
        return false;
      default:
        return true;
    }
  }
  utilContainsNewline.containsNewline = containsNewline;
  return utilContainsNewline;
}
var utilFlowIndentCheck = {};
var hasRequiredUtilFlowIndentCheck;
function requireUtilFlowIndentCheck() {
  if (hasRequiredUtilFlowIndentCheck) return utilFlowIndentCheck;
  hasRequiredUtilFlowIndentCheck = 1;
  var utilContainsNewline2 = requireUtilContainsNewline();
  function flowIndentCheck(indent, fc, onError) {
    if (fc?.type === "flow-collection") {
      const end = fc.end[0];
      if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline2.containsNewline(fc)) {
        const msg = "Flow end indicator should be more indented than parent";
        onError(end, "BAD_INDENT", msg, true);
      }
    }
  }
  utilFlowIndentCheck.flowIndentCheck = flowIndentCheck;
  return utilFlowIndentCheck;
}
var utilMapIncludes = {};
var hasRequiredUtilMapIncludes;
function requireUtilMapIncludes() {
  if (hasRequiredUtilMapIncludes) return utilMapIncludes;
  hasRequiredUtilMapIncludes = 1;
  var identity2 = requireIdentity();
  function mapIncludes(ctx, items, search) {
    const { uniqueKeys } = ctx.options;
    if (uniqueKeys === false)
      return false;
    const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity2.isScalar(a) && identity2.isScalar(b) && a.value === b.value;
    return items.some((pair) => isEqual(pair.key, search));
  }
  utilMapIncludes.mapIncludes = mapIncludes;
  return utilMapIncludes;
}
var hasRequiredResolveBlockMap;
function requireResolveBlockMap() {
  if (hasRequiredResolveBlockMap) return resolveBlockMap;
  hasRequiredResolveBlockMap = 1;
  var Pair2 = requirePair();
  var YAMLMap2 = requireYAMLMap();
  var resolveProps2 = requireResolveProps();
  var utilContainsNewline2 = requireUtilContainsNewline();
  var utilFlowIndentCheck2 = requireUtilFlowIndentCheck();
  var utilMapIncludes2 = requireUtilMapIncludes();
  const startColMsg = "All mapping items must start at the same column";
  function resolveBlockMap$1({ composeNode: composeNode2, composeEmptyNode }, ctx, bm, onError, tag) {
    const NodeClass = tag?.nodeClass ?? YAMLMap2.YAMLMap;
    const map2 = new NodeClass(ctx.schema);
    if (ctx.atRoot)
      ctx.atRoot = false;
    let offset = bm.offset;
    let commentEnd = null;
    for (const collItem of bm.items) {
      const { start, key, sep, value } = collItem;
      const keyProps = resolveProps2.resolveProps(start, {
        indicator: "explicit-key-ind",
        next: key ?? sep?.[0],
        offset,
        onError,
        parentIndent: bm.indent,
        startOnNewline: true
      });
      const implicitKey = !keyProps.found;
      if (implicitKey) {
        if (key) {
          if (key.type === "block-seq")
            onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
          else if ("indent" in key && key.indent !== bm.indent)
            onError(offset, "BAD_INDENT", startColMsg);
        }
        if (!keyProps.anchor && !keyProps.tag && !sep) {
          commentEnd = keyProps.end;
          if (keyProps.comment) {
            if (map2.comment)
              map2.comment += "\n" + keyProps.comment;
            else
              map2.comment = keyProps.comment;
          }
          continue;
        }
        if (keyProps.newlineAfterProp || utilContainsNewline2.containsNewline(key)) {
          onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
        }
      } else if (keyProps.found?.indent !== bm.indent) {
        onError(offset, "BAD_INDENT", startColMsg);
      }
      ctx.atKey = true;
      const keyStart = keyProps.end;
      const keyNode = key ? composeNode2(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
      if (ctx.schema.compat)
        utilFlowIndentCheck2.flowIndentCheck(bm.indent, key, onError);
      ctx.atKey = false;
      if (utilMapIncludes2.mapIncludes(ctx, map2.items, keyNode))
        onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
      const valueProps = resolveProps2.resolveProps(sep ?? [], {
        indicator: "map-value-ind",
        next: value,
        offset: keyNode.range[2],
        onError,
        parentIndent: bm.indent,
        startOnNewline: !key || key.type === "block-scalar"
      });
      offset = valueProps.end;
      if (valueProps.found) {
        if (implicitKey) {
          if (value?.type === "block-map" && !valueProps.hasNewline)
            onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
          if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
            onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
        }
        const valueNode = value ? composeNode2(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck2.flowIndentCheck(bm.indent, value, onError);
        offset = valueNode.range[2];
        const pair = new Pair2.Pair(keyNode, valueNode);
        if (ctx.options.keepSourceTokens)
          pair.srcToken = collItem;
        map2.items.push(pair);
      } else {
        if (implicitKey)
          onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
        if (valueProps.comment) {
          if (keyNode.comment)
            keyNode.comment += "\n" + valueProps.comment;
          else
            keyNode.comment = valueProps.comment;
        }
        const pair = new Pair2.Pair(keyNode);
        if (ctx.options.keepSourceTokens)
          pair.srcToken = collItem;
        map2.items.push(pair);
      }
    }
    if (commentEnd && commentEnd < offset)
      onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
    map2.range = [bm.offset, offset, commentEnd ?? offset];
    return map2;
  }
  resolveBlockMap.resolveBlockMap = resolveBlockMap$1;
  return resolveBlockMap;
}
var resolveBlockSeq = {};
var hasRequiredResolveBlockSeq;
function requireResolveBlockSeq() {
  if (hasRequiredResolveBlockSeq) return resolveBlockSeq;
  hasRequiredResolveBlockSeq = 1;
  var YAMLSeq2 = requireYAMLSeq();
  var resolveProps2 = requireResolveProps();
  var utilFlowIndentCheck2 = requireUtilFlowIndentCheck();
  function resolveBlockSeq$1({ composeNode: composeNode2, composeEmptyNode }, ctx, bs, onError, tag) {
    const NodeClass = tag?.nodeClass ?? YAMLSeq2.YAMLSeq;
    const seq2 = new NodeClass(ctx.schema);
    if (ctx.atRoot)
      ctx.atRoot = false;
    if (ctx.atKey)
      ctx.atKey = false;
    let offset = bs.offset;
    let commentEnd = null;
    for (const { start, value } of bs.items) {
      const props = resolveProps2.resolveProps(start, {
        indicator: "seq-item-ind",
        next: value,
        offset,
        onError,
        parentIndent: bs.indent,
        startOnNewline: true
      });
      if (!props.found) {
        if (props.anchor || props.tag || value) {
          if (value && value.type === "block-seq")
            onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
          else
            onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
        } else {
          commentEnd = props.end;
          if (props.comment)
            seq2.comment = props.comment;
          continue;
        }
      }
      const node2 = value ? composeNode2(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
      if (ctx.schema.compat)
        utilFlowIndentCheck2.flowIndentCheck(bs.indent, value, onError);
      offset = node2.range[2];
      seq2.items.push(node2);
    }
    seq2.range = [bs.offset, offset, commentEnd ?? offset];
    return seq2;
  }
  resolveBlockSeq.resolveBlockSeq = resolveBlockSeq$1;
  return resolveBlockSeq;
}
var resolveFlowCollection = {};
var resolveEnd = {};
var hasRequiredResolveEnd;
function requireResolveEnd() {
  if (hasRequiredResolveEnd) return resolveEnd;
  hasRequiredResolveEnd = 1;
  function resolveEnd$1(end, offset, reqSpace, onError) {
    let comment = "";
    if (end) {
      let hasSpace = false;
      let sep = "";
      for (const token of end) {
        const { source, type } = token;
        switch (type) {
          case "space":
            hasSpace = true;
            break;
          case "comment": {
            if (reqSpace && !hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += sep + cb;
            sep = "";
            break;
          }
          case "newline":
            if (comment)
              sep += source;
            hasSpace = true;
            break;
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
        }
        offset += source.length;
      }
    }
    return { comment, offset };
  }
  resolveEnd.resolveEnd = resolveEnd$1;
  return resolveEnd;
}
var hasRequiredResolveFlowCollection;
function requireResolveFlowCollection() {
  if (hasRequiredResolveFlowCollection) return resolveFlowCollection;
  hasRequiredResolveFlowCollection = 1;
  var identity2 = requireIdentity();
  var Pair2 = requirePair();
  var YAMLMap2 = requireYAMLMap();
  var YAMLSeq2 = requireYAMLSeq();
  var resolveEnd2 = requireResolveEnd();
  var resolveProps2 = requireResolveProps();
  var utilContainsNewline2 = requireUtilContainsNewline();
  var utilMapIncludes2 = requireUtilMapIncludes();
  const blockMsg = "Block collections are not allowed within flow collections";
  const isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
  function resolveFlowCollection$1({ composeNode: composeNode2, composeEmptyNode }, ctx, fc, onError, tag) {
    const isMap = fc.start.source === "{";
    const fcName = isMap ? "flow map" : "flow sequence";
    const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap2.YAMLMap : YAMLSeq2.YAMLSeq);
    const coll = new NodeClass(ctx.schema);
    coll.flow = true;
    const atRoot = ctx.atRoot;
    if (atRoot)
      ctx.atRoot = false;
    if (ctx.atKey)
      ctx.atKey = false;
    let offset = fc.offset + fc.start.source.length;
    for (let i = 0; i < fc.items.length; ++i) {
      const collItem = fc.items[i];
      const { start, key, sep, value } = collItem;
      const props = resolveProps2.resolveProps(start, {
        flow: fcName,
        indicator: "explicit-key-ind",
        next: key ?? sep?.[0],
        offset,
        onError,
        parentIndent: fc.indent,
        startOnNewline: false
      });
      if (!props.found) {
        if (!props.anchor && !props.tag && !sep && !value) {
          if (i === 0 && props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
          else if (i < fc.items.length - 1)
            onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
          if (props.comment) {
            if (coll.comment)
              coll.comment += "\n" + props.comment;
            else
              coll.comment = props.comment;
          }
          offset = props.end;
          continue;
        }
        if (!isMap && ctx.options.strict && utilContainsNewline2.containsNewline(key))
          onError(
            key,
            // checked by containsNewline()
            "MULTILINE_IMPLICIT_KEY",
            "Implicit keys of flow sequence pairs need to be on a single line"
          );
      }
      if (i === 0) {
        if (props.comma)
          onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
      } else {
        if (!props.comma)
          onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
        if (props.comment) {
          let prevItemComment = "";
          loop: for (const st of start) {
            switch (st.type) {
              case "comma":
              case "space":
                break;
              case "comment":
                prevItemComment = st.source.substring(1);
                break loop;
              default:
                break loop;
            }
          }
          if (prevItemComment) {
            let prev = coll.items[coll.items.length - 1];
            if (identity2.isPair(prev))
              prev = prev.value ?? prev.key;
            if (prev.comment)
              prev.comment += "\n" + prevItemComment;
            else
              prev.comment = prevItemComment;
            props.comment = props.comment.substring(prevItemComment.length + 1);
          }
        }
      }
      if (!isMap && !sep && !props.found) {
        const valueNode = value ? composeNode2(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
        coll.items.push(valueNode);
        offset = valueNode.range[2];
        if (isBlock(value))
          onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
      } else {
        ctx.atKey = true;
        const keyStart = props.end;
        const keyNode = key ? composeNode2(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
        if (isBlock(key))
          onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
        ctx.atKey = false;
        const valueProps = resolveProps2.resolveProps(sep ?? [], {
          flow: fcName,
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (valueProps.found) {
          if (!isMap && !props.found && ctx.options.strict) {
            if (sep)
              for (const st of sep) {
                if (st === valueProps.found)
                  break;
                if (st.type === "newline") {
                  onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                  break;
                }
              }
            if (props.start < valueProps.found.offset - 1024)
              onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
          }
        } else if (value) {
          if ("source" in value && value.source && value.source[0] === ":")
            onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
          else
            onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
        }
        const valueNode = value ? composeNode2(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
        if (valueNode) {
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else if (valueProps.comment) {
          if (keyNode.comment)
            keyNode.comment += "\n" + valueProps.comment;
          else
            keyNode.comment = valueProps.comment;
        }
        const pair = new Pair2.Pair(keyNode, valueNode);
        if (ctx.options.keepSourceTokens)
          pair.srcToken = collItem;
        if (isMap) {
          const map2 = coll;
          if (utilMapIncludes2.mapIncludes(ctx, map2.items, keyNode))
            onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
          map2.items.push(pair);
        } else {
          const map2 = new YAMLMap2.YAMLMap(ctx.schema);
          map2.flow = true;
          map2.items.push(pair);
          const endRange = (valueNode ?? keyNode).range;
          map2.range = [keyNode.range[0], endRange[1], endRange[2]];
          coll.items.push(map2);
        }
        offset = valueNode ? valueNode.range[2] : valueProps.end;
      }
    }
    const expectedEnd = isMap ? "}" : "]";
    const [ce, ...ee] = fc.end;
    let cePos = offset;
    if (ce && ce.source === expectedEnd)
      cePos = ce.offset + ce.source.length;
    else {
      const name = fcName[0].toUpperCase() + fcName.substring(1);
      const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
      onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
      if (ce && ce.source.length !== 1)
        ee.unshift(ce);
    }
    if (ee.length > 0) {
      const end = resolveEnd2.resolveEnd(ee, cePos, ctx.options.strict, onError);
      if (end.comment) {
        if (coll.comment)
          coll.comment += "\n" + end.comment;
        else
          coll.comment = end.comment;
      }
      coll.range = [fc.offset, cePos, end.offset];
    } else {
      coll.range = [fc.offset, cePos, cePos];
    }
    return coll;
  }
  resolveFlowCollection.resolveFlowCollection = resolveFlowCollection$1;
  return resolveFlowCollection;
}
var hasRequiredComposeCollection;
function requireComposeCollection() {
  if (hasRequiredComposeCollection) return composeCollection;
  hasRequiredComposeCollection = 1;
  var identity2 = requireIdentity();
  var Scalar2 = requireScalar();
  var YAMLMap2 = requireYAMLMap();
  var YAMLSeq2 = requireYAMLSeq();
  var resolveBlockMap2 = requireResolveBlockMap();
  var resolveBlockSeq2 = requireResolveBlockSeq();
  var resolveFlowCollection2 = requireResolveFlowCollection();
  function resolveCollection(CN, ctx, token, onError, tagName, tag) {
    const coll = token.type === "block-map" ? resolveBlockMap2.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq2.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection2.resolveFlowCollection(CN, ctx, token, onError, tag);
    const Coll = coll.constructor;
    if (tagName === "!" || tagName === Coll.tagName) {
      coll.tag = Coll.tagName;
      return coll;
    }
    if (tagName)
      coll.tag = tagName;
    return coll;
  }
  function composeCollection$1(CN, ctx, token, props, onError) {
    const tagToken = props.tag;
    const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
    if (token.type === "block-seq") {
      const { anchor: anchor2, newlineAfterProp: nl } = props;
      const lastProp = anchor2 && tagToken ? anchor2.offset > tagToken.offset ? anchor2 : tagToken : anchor2 ?? tagToken;
      if (lastProp && (!nl || nl.offset < lastProp.offset)) {
        const message = "Missing newline after block sequence props";
        onError(lastProp, "MISSING_CHAR", message);
      }
    }
    const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
    if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap2.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq2.YAMLSeq.tagName && expType === "seq") {
      return resolveCollection(CN, ctx, token, onError, tagName);
    }
    let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
    if (!tag) {
      const kt = ctx.schema.knownTags[tagName];
      if (kt && kt.collection === expType) {
        ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
        tag = kt;
      } else {
        if (kt) {
          onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
        } else {
          onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
        }
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
    }
    const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
    const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
    const node2 = identity2.isNode(res) ? res : new Scalar2.Scalar(res);
    node2.range = coll.range;
    node2.tag = tagName;
    if (tag?.format)
      node2.format = tag.format;
    return node2;
  }
  composeCollection.composeCollection = composeCollection$1;
  return composeCollection;
}
var composeScalar = {};
var resolveBlockScalar = {};
var hasRequiredResolveBlockScalar;
function requireResolveBlockScalar() {
  if (hasRequiredResolveBlockScalar) return resolveBlockScalar;
  hasRequiredResolveBlockScalar = 1;
  var Scalar2 = requireScalar();
  function resolveBlockScalar$1(ctx, scalar, onError) {
    const start = scalar.offset;
    const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
    if (!header)
      return { value: "", type: null, comment: "", range: [start, start, start] };
    const type = header.mode === ">" ? Scalar2.Scalar.BLOCK_FOLDED : Scalar2.Scalar.BLOCK_LITERAL;
    const lines = scalar.source ? splitLines(scalar.source) : [];
    let chompStart = lines.length;
    for (let i = lines.length - 1; i >= 0; --i) {
      const content = lines[i][1];
      if (content === "" || content === "\r")
        chompStart = i;
      else
        break;
    }
    if (chompStart === 0) {
      const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
      let end2 = start + header.length;
      if (scalar.source)
        end2 += scalar.source.length;
      return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
    }
    let trimIndent = scalar.indent + header.indent;
    let offset = scalar.offset + header.length;
    let contentStart = 0;
    for (let i = 0; i < chompStart; ++i) {
      const [indent, content] = lines[i];
      if (content === "" || content === "\r") {
        if (header.indent === 0 && indent.length > trimIndent)
          trimIndent = indent.length;
      } else {
        if (indent.length < trimIndent) {
          const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
          onError(offset + indent.length, "MISSING_CHAR", message);
        }
        if (header.indent === 0)
          trimIndent = indent.length;
        contentStart = i;
        if (trimIndent === 0 && !ctx.atRoot) {
          const message = "Block scalar values in collections must be indented";
          onError(offset, "BAD_INDENT", message);
        }
        break;
      }
      offset += indent.length + content.length + 1;
    }
    for (let i = lines.length - 1; i >= chompStart; --i) {
      if (lines[i][0].length > trimIndent)
        chompStart = i + 1;
    }
    let value = "";
    let sep = "";
    let prevMoreIndented = false;
    for (let i = 0; i < contentStart; ++i)
      value += lines[i][0].slice(trimIndent) + "\n";
    for (let i = contentStart; i < chompStart; ++i) {
      let [indent, content] = lines[i];
      offset += indent.length + content.length + 1;
      const crlf = content[content.length - 1] === "\r";
      if (crlf)
        content = content.slice(0, -1);
      if (content && indent.length < trimIndent) {
        const src = header.indent ? "explicit indentation indicator" : "first line";
        const message = `Block scalar lines must not be less indented than their ${src}`;
        onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
        indent = "";
      }
      if (type === Scalar2.Scalar.BLOCK_LITERAL) {
        value += sep + indent.slice(trimIndent) + content;
        sep = "\n";
      } else if (indent.length > trimIndent || content[0] === "	") {
        if (sep === " ")
          sep = "\n";
        else if (!prevMoreIndented && sep === "\n")
          sep = "\n\n";
        value += sep + indent.slice(trimIndent) + content;
        sep = "\n";
        prevMoreIndented = true;
      } else if (content === "") {
        if (sep === "\n")
          value += "\n";
        else
          sep = "\n";
      } else {
        value += sep + content;
        sep = " ";
        prevMoreIndented = false;
      }
    }
    switch (header.chomp) {
      case "-":
        break;
      case "+":
        for (let i = chompStart; i < lines.length; ++i)
          value += "\n" + lines[i][0].slice(trimIndent);
        if (value[value.length - 1] !== "\n")
          value += "\n";
        break;
      default:
        value += "\n";
    }
    const end = start + header.length + scalar.source.length;
    return { value, type, comment: header.comment, range: [start, end, end] };
  }
  function parseBlockScalarHeader({ offset, props }, strict, onError) {
    if (props[0].type !== "block-scalar-header") {
      onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
      return null;
    }
    const { source } = props[0];
    const mode = source[0];
    let indent = 0;
    let chomp = "";
    let error2 = -1;
    for (let i = 1; i < source.length; ++i) {
      const ch = source[i];
      if (!chomp && (ch === "-" || ch === "+"))
        chomp = ch;
      else {
        const n = Number(ch);
        if (!indent && n)
          indent = n;
        else if (error2 === -1)
          error2 = offset + i;
      }
    }
    if (error2 !== -1)
      onError(error2, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
    let hasSpace = false;
    let comment = "";
    let length = source.length;
    for (let i = 1; i < props.length; ++i) {
      const token = props[i];
      switch (token.type) {
        case "space":
          hasSpace = true;
        // fallthrough
        case "newline":
          length += token.source.length;
          break;
        case "comment":
          if (strict && !hasSpace) {
            const message = "Comments must be separated from other tokens by white space characters";
            onError(token, "MISSING_CHAR", message);
          }
          length += token.source.length;
          comment = token.source.substring(1);
          break;
        case "error":
          onError(token, "UNEXPECTED_TOKEN", token.message);
          length += token.source.length;
          break;
        /* istanbul ignore next should not happen */
        default: {
          const message = `Unexpected token in block scalar header: ${token.type}`;
          onError(token, "UNEXPECTED_TOKEN", message);
          const ts = token.source;
          if (ts && typeof ts === "string")
            length += ts.length;
        }
      }
    }
    return { mode, indent, chomp, comment, length };
  }
  function splitLines(source) {
    const split = source.split(/\n( *)/);
    const first = split[0];
    const m = first.match(/^( *)/);
    const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
    const lines = [line0];
    for (let i = 1; i < split.length; i += 2)
      lines.push([split[i], split[i + 1]]);
    return lines;
  }
  resolveBlockScalar.resolveBlockScalar = resolveBlockScalar$1;
  return resolveBlockScalar;
}
var resolveFlowScalar = {};
var hasRequiredResolveFlowScalar;
function requireResolveFlowScalar() {
  if (hasRequiredResolveFlowScalar) return resolveFlowScalar;
  hasRequiredResolveFlowScalar = 1;
  var Scalar2 = requireScalar();
  var resolveEnd2 = requireResolveEnd();
  function resolveFlowScalar$1(scalar, strict, onError) {
    const { offset, type, source, end } = scalar;
    let _type;
    let value;
    const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
    switch (type) {
      case "scalar":
        _type = Scalar2.Scalar.PLAIN;
        value = plainValue(source, _onError);
        break;
      case "single-quoted-scalar":
        _type = Scalar2.Scalar.QUOTE_SINGLE;
        value = singleQuotedValue(source, _onError);
        break;
      case "double-quoted-scalar":
        _type = Scalar2.Scalar.QUOTE_DOUBLE;
        value = doubleQuotedValue(source, _onError);
        break;
      /* istanbul ignore next should not happen */
      default:
        onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
        return {
          value: "",
          type: null,
          comment: "",
          range: [offset, offset + source.length, offset + source.length]
        };
    }
    const valueEnd = offset + source.length;
    const re = resolveEnd2.resolveEnd(end, valueEnd, strict, onError);
    return {
      value,
      type: _type,
      comment: re.comment,
      range: [offset, valueEnd, re.offset]
    };
  }
  function plainValue(source, onError) {
    let badChar = "";
    switch (source[0]) {
      /* istanbul ignore next should not happen */
      case "	":
        badChar = "a tab character";
        break;
      case ",":
        badChar = "flow indicator character ,";
        break;
      case "%":
        badChar = "directive indicator character %";
        break;
      case "|":
      case ">": {
        badChar = `block scalar indicator ${source[0]}`;
        break;
      }
      case "@":
      case "`": {
        badChar = `reserved character ${source[0]}`;
        break;
      }
    }
    if (badChar)
      onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
    return foldLines(source);
  }
  function singleQuotedValue(source, onError) {
    if (source[source.length - 1] !== "'" || source.length === 1)
      onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
    return foldLines(source.slice(1, -1)).replace(/''/g, "'");
  }
  function foldLines(source) {
    let first, line;
    try {
      first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
      line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
    } catch {
      first = /(.*?)[ \t]*\r?\n/sy;
      line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
    }
    let match = first.exec(source);
    if (!match)
      return source;
    let res = match[1];
    let sep = " ";
    let pos = first.lastIndex;
    line.lastIndex = pos;
    while (match = line.exec(source)) {
      if (match[1] === "") {
        if (sep === "\n")
          res += sep;
        else
          sep = "\n";
      } else {
        res += sep + match[1];
        sep = " ";
      }
      pos = line.lastIndex;
    }
    const last = /[ \t]*(.*)/sy;
    last.lastIndex = pos;
    match = last.exec(source);
    return res + sep + (match?.[1] ?? "");
  }
  function doubleQuotedValue(source, onError) {
    let res = "";
    for (let i = 1; i < source.length - 1; ++i) {
      const ch = source[i];
      if (ch === "\r" && source[i + 1] === "\n")
        continue;
      if (ch === "\n") {
        const { fold, offset } = foldNewline(source, i);
        res += fold;
        i = offset;
      } else if (ch === "\\") {
        let next = source[++i];
        const cc = escapeCodes[next];
        if (cc)
          res += cc;
        else if (next === "\n") {
          next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
        } else if (next === "\r" && source[i + 1] === "\n") {
          next = source[++i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
        } else if (next === "x" || next === "u" || next === "U") {
          const length = { x: 2, u: 4, U: 8 }[next];
          res += parseCharCode(source, i + 1, length, onError);
          i += length;
        } else {
          const raw = source.substr(i - 1, 2);
          onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
          res += raw;
        }
      } else if (ch === " " || ch === "	") {
        const wsStart = i;
        let next = source[i + 1];
        while (next === " " || next === "	")
          next = source[++i + 1];
        if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
          res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
      } else {
        res += ch;
      }
    }
    if (source[source.length - 1] !== '"' || source.length === 1)
      onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
    return res;
  }
  function foldNewline(source, offset) {
    let fold = "";
    let ch = source[offset + 1];
    while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[offset + 2] !== "\n")
        break;
      if (ch === "\n")
        fold += "\n";
      offset += 1;
      ch = source[offset + 1];
    }
    if (!fold)
      fold = " ";
    return { fold, offset };
  }
  const escapeCodes = {
    "0": "\0",
    // null character
    a: "\x07",
    // bell character
    b: "\b",
    // backspace
    e: "\x1B",
    // escape character
    f: "\f",
    // form feed
    n: "\n",
    // line feed
    r: "\r",
    // carriage return
    t: "	",
    // horizontal tab
    v: "\v",
    // vertical tab
    N: "",
    // Unicode next line
    _: " ",
    // Unicode non-breaking space
    L: "\u2028",
    // Unicode line separator
    P: "\u2029",
    // Unicode paragraph separator
    " ": " ",
    '"': '"',
    "/": "/",
    "\\": "\\",
    "	": "	"
  };
  function parseCharCode(source, offset, length, onError) {
    const cc = source.substr(offset, length);
    const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
    const code = ok ? parseInt(cc, 16) : NaN;
    if (isNaN(code)) {
      const raw = source.substr(offset - 2, length + 2);
      onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
      return raw;
    }
    return String.fromCodePoint(code);
  }
  resolveFlowScalar.resolveFlowScalar = resolveFlowScalar$1;
  return resolveFlowScalar;
}
var hasRequiredComposeScalar;
function requireComposeScalar() {
  if (hasRequiredComposeScalar) return composeScalar;
  hasRequiredComposeScalar = 1;
  var identity2 = requireIdentity();
  var Scalar2 = requireScalar();
  var resolveBlockScalar2 = requireResolveBlockScalar();
  var resolveFlowScalar2 = requireResolveFlowScalar();
  function composeScalar$1(ctx, token, tagToken, onError) {
    const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar2.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar2.resolveFlowScalar(token, ctx.options.strict, onError);
    const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
    let tag;
    if (ctx.options.stringKeys && ctx.atKey) {
      tag = ctx.schema[identity2.SCALAR];
    } else if (tagName)
      tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
    else if (token.type === "scalar")
      tag = findScalarTagByTest(ctx, value, token, onError);
    else
      tag = ctx.schema[identity2.SCALAR];
    let scalar;
    try {
      const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
      scalar = identity2.isScalar(res) ? res : new Scalar2.Scalar(res);
    } catch (error2) {
      const msg = error2 instanceof Error ? error2.message : String(error2);
      onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
      scalar = new Scalar2.Scalar(value);
    }
    scalar.range = range;
    scalar.source = value;
    if (type)
      scalar.type = type;
    if (tagName)
      scalar.tag = tagName;
    if (tag.format)
      scalar.format = tag.format;
    if (comment)
      scalar.comment = comment;
    return scalar;
  }
  function findScalarTagByName(schema2, value, tagName, tagToken, onError) {
    if (tagName === "!")
      return schema2[identity2.SCALAR];
    const matchWithTest = [];
    for (const tag of schema2.tags) {
      if (!tag.collection && tag.tag === tagName) {
        if (tag.default && tag.test)
          matchWithTest.push(tag);
        else
          return tag;
      }
    }
    for (const tag of matchWithTest)
      if (tag.test?.test(value))
        return tag;
    const kt = schema2.knownTags[tagName];
    if (kt && !kt.collection) {
      schema2.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
      return kt;
    }
    onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
    return schema2[identity2.SCALAR];
  }
  function findScalarTagByTest({ atKey, directives: directives2, schema: schema2 }, value, token, onError) {
    const tag = schema2.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema2[identity2.SCALAR];
    if (schema2.compat) {
      const compat = schema2.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema2[identity2.SCALAR];
      if (tag.tag !== compat.tag) {
        const ts = directives2.tagString(tag.tag);
        const cs = directives2.tagString(compat.tag);
        const msg = `Value may be parsed as either ${ts} or ${cs}`;
        onError(token, "TAG_RESOLVE_FAILED", msg, true);
      }
    }
    return tag;
  }
  composeScalar.composeScalar = composeScalar$1;
  return composeScalar;
}
var utilEmptyScalarPosition = {};
var hasRequiredUtilEmptyScalarPosition;
function requireUtilEmptyScalarPosition() {
  if (hasRequiredUtilEmptyScalarPosition) return utilEmptyScalarPosition;
  hasRequiredUtilEmptyScalarPosition = 1;
  function emptyScalarPosition(offset, before, pos) {
    if (before) {
      pos ?? (pos = before.length);
      for (let i = pos - 1; i >= 0; --i) {
        let st = before[i];
        switch (st.type) {
          case "space":
          case "comment":
          case "newline":
            offset -= st.source.length;
            continue;
        }
        st = before[++i];
        while (st?.type === "space") {
          offset += st.source.length;
          st = before[++i];
        }
        break;
      }
    }
    return offset;
  }
  utilEmptyScalarPosition.emptyScalarPosition = emptyScalarPosition;
  return utilEmptyScalarPosition;
}
var hasRequiredComposeNode;
function requireComposeNode() {
  if (hasRequiredComposeNode) return composeNode;
  hasRequiredComposeNode = 1;
  var Alias2 = requireAlias();
  var identity2 = requireIdentity();
  var composeCollection2 = requireComposeCollection();
  var composeScalar2 = requireComposeScalar();
  var resolveEnd2 = requireResolveEnd();
  var utilEmptyScalarPosition2 = requireUtilEmptyScalarPosition();
  const CN = { composeNode: composeNode$1, composeEmptyNode };
  function composeNode$1(ctx, token, props, onError) {
    const atKey = ctx.atKey;
    const { spaceBefore, comment, anchor: anchor2, tag } = props;
    let node2;
    let isSrcToken = true;
    switch (token.type) {
      case "alias":
        node2 = composeAlias(ctx, token, onError);
        if (anchor2 || tag)
          onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
        break;
      case "scalar":
      case "single-quoted-scalar":
      case "double-quoted-scalar":
      case "block-scalar":
        node2 = composeScalar2.composeScalar(ctx, token, tag, onError);
        if (anchor2)
          node2.anchor = anchor2.source.substring(1);
        break;
      case "block-map":
      case "block-seq":
      case "flow-collection":
        node2 = composeCollection2.composeCollection(CN, ctx, token, props, onError);
        if (anchor2)
          node2.anchor = anchor2.source.substring(1);
        break;
      default: {
        const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
        onError(token, "UNEXPECTED_TOKEN", message);
        node2 = composeEmptyNode(ctx, token.offset, void 0, null, props, onError);
        isSrcToken = false;
      }
    }
    if (anchor2 && node2.anchor === "")
      onError(anchor2, "BAD_ALIAS", "Anchor cannot be an empty string");
    if (atKey && ctx.options.stringKeys && (!identity2.isScalar(node2) || typeof node2.value !== "string" || node2.tag && node2.tag !== "tag:yaml.org,2002:str")) {
      const msg = "With stringKeys, all keys must be strings";
      onError(tag ?? token, "NON_STRING_KEY", msg);
    }
    if (spaceBefore)
      node2.spaceBefore = true;
    if (comment) {
      if (token.type === "scalar" && token.source === "")
        node2.comment = comment;
      else
        node2.commentBefore = comment;
    }
    if (ctx.options.keepSourceTokens && isSrcToken)
      node2.srcToken = token;
    return node2;
  }
  function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor: anchor2, tag, end }, onError) {
    const token = {
      type: "scalar",
      offset: utilEmptyScalarPosition2.emptyScalarPosition(offset, before, pos),
      indent: -1,
      source: ""
    };
    const node2 = composeScalar2.composeScalar(ctx, token, tag, onError);
    if (anchor2) {
      node2.anchor = anchor2.source.substring(1);
      if (node2.anchor === "")
        onError(anchor2, "BAD_ALIAS", "Anchor cannot be an empty string");
    }
    if (spaceBefore)
      node2.spaceBefore = true;
    if (comment) {
      node2.comment = comment;
      node2.range[2] = end;
    }
    return node2;
  }
  function composeAlias({ options }, { offset, source, end }, onError) {
    const alias = new Alias2.Alias(source.substring(1));
    if (alias.source === "")
      onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
    if (alias.source.endsWith(":"))
      onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
    const valueEnd = offset + source.length;
    const re = resolveEnd2.resolveEnd(end, valueEnd, options.strict, onError);
    alias.range = [offset, valueEnd, re.offset];
    if (re.comment)
      alias.comment = re.comment;
    return alias;
  }
  composeNode.composeEmptyNode = composeEmptyNode;
  composeNode.composeNode = composeNode$1;
  return composeNode;
}
var hasRequiredComposeDoc;
function requireComposeDoc() {
  if (hasRequiredComposeDoc) return composeDoc;
  hasRequiredComposeDoc = 1;
  var Document2 = requireDocument();
  var composeNode2 = requireComposeNode();
  var resolveEnd2 = requireResolveEnd();
  var resolveProps2 = requireResolveProps();
  function composeDoc$1(options, directives2, { offset, start, value, end }, onError) {
    const opts = Object.assign({ _directives: directives2 }, options);
    const doc = new Document2.Document(void 0, opts);
    const ctx = {
      atKey: false,
      atRoot: true,
      directives: doc.directives,
      options: doc.options,
      schema: doc.schema
    };
    const props = resolveProps2.resolveProps(start, {
      indicator: "doc-start",
      next: value ?? end?.[0],
      offset,
      onError,
      parentIndent: 0,
      startOnNewline: true
    });
    if (props.found) {
      doc.directives.docStart = true;
      if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
        onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
    }
    doc.contents = value ? composeNode2.composeNode(ctx, value, props, onError) : composeNode2.composeEmptyNode(ctx, props.end, start, null, props, onError);
    const contentEnd = doc.contents.range[2];
    const re = resolveEnd2.resolveEnd(end, contentEnd, false, onError);
    if (re.comment)
      doc.comment = re.comment;
    doc.range = [offset, contentEnd, re.offset];
    return doc;
  }
  composeDoc.composeDoc = composeDoc$1;
  return composeDoc;
}
var hasRequiredComposer;
function requireComposer() {
  if (hasRequiredComposer) return composer;
  hasRequiredComposer = 1;
  var node_process = require$$0;
  var directives2 = requireDirectives();
  var Document2 = requireDocument();
  var errors2 = requireErrors();
  var identity2 = requireIdentity();
  var composeDoc2 = requireComposeDoc();
  var resolveEnd2 = requireResolveEnd();
  function getErrorPos(src) {
    if (typeof src === "number")
      return [src, src + 1];
    if (Array.isArray(src))
      return src.length === 2 ? src : [src[0], src[1]];
    const { offset, source } = src;
    return [offset, offset + (typeof source === "string" ? source.length : 1)];
  }
  function parsePrelude(prelude) {
    let comment = "";
    let atComment = false;
    let afterEmptyLine = false;
    for (let i = 0; i < prelude.length; ++i) {
      const source = prelude[i];
      switch (source[0]) {
        case "#":
          comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
          atComment = true;
          afterEmptyLine = false;
          break;
        case "%":
          if (prelude[i + 1]?.[0] !== "#")
            i += 1;
          atComment = false;
          break;
        default:
          if (!atComment)
            afterEmptyLine = true;
          atComment = false;
      }
    }
    return { comment, afterEmptyLine };
  }
  class Composer {
    constructor(options = {}) {
      this.doc = null;
      this.atDirectives = false;
      this.prelude = [];
      this.errors = [];
      this.warnings = [];
      this.onError = (source, code, message, warning) => {
        const pos = getErrorPos(source);
        if (warning)
          this.warnings.push(new errors2.YAMLWarning(pos, code, message));
        else
          this.errors.push(new errors2.YAMLParseError(pos, code, message));
      };
      this.directives = new directives2.Directives({ version: options.version || "1.2" });
      this.options = options;
    }
    decorate(doc, afterDoc) {
      const { comment, afterEmptyLine } = parsePrelude(this.prelude);
      if (comment) {
        const dc = doc.contents;
        if (afterDoc) {
          doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
        } else if (afterEmptyLine || doc.directives.docStart || !dc) {
          doc.commentBefore = comment;
        } else if (identity2.isCollection(dc) && !dc.flow && dc.items.length > 0) {
          let it = dc.items[0];
          if (identity2.isPair(it))
            it = it.key;
          const cb = it.commentBefore;
          it.commentBefore = cb ? `${comment}
${cb}` : comment;
        } else {
          const cb = dc.commentBefore;
          dc.commentBefore = cb ? `${comment}
${cb}` : comment;
        }
      }
      if (afterDoc) {
        Array.prototype.push.apply(doc.errors, this.errors);
        Array.prototype.push.apply(doc.warnings, this.warnings);
      } else {
        doc.errors = this.errors;
        doc.warnings = this.warnings;
      }
      this.prelude = [];
      this.errors = [];
      this.warnings = [];
    }
    /**
     * Current stream status information.
     *
     * Mostly useful at the end of input for an empty stream.
     */
    streamInfo() {
      return {
        comment: parsePrelude(this.prelude).comment,
        directives: this.directives,
        errors: this.errors,
        warnings: this.warnings
      };
    }
    /**
     * Compose tokens into documents.
     *
     * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
     * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
     */
    *compose(tokens, forceDoc = false, endOffset = -1) {
      for (const token of tokens)
        yield* this.next(token);
      yield* this.end(forceDoc, endOffset);
    }
    /** Advance the composer by one CST token. */
    *next(token) {
      if (node_process.env.LOG_STREAM)
        console.dir(token, { depth: null });
      switch (token.type) {
        case "directive":
          this.directives.add(token.source, (offset, message, warning) => {
            const pos = getErrorPos(token);
            pos[0] += offset;
            this.onError(pos, "BAD_DIRECTIVE", message, warning);
          });
          this.prelude.push(token.source);
          this.atDirectives = true;
          break;
        case "document": {
          const doc = composeDoc2.composeDoc(this.options, this.directives, token, this.onError);
          if (this.atDirectives && !doc.directives.docStart)
            this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
          this.decorate(doc, false);
          if (this.doc)
            yield this.doc;
          this.doc = doc;
          this.atDirectives = false;
          break;
        }
        case "byte-order-mark":
        case "space":
          break;
        case "comment":
        case "newline":
          this.prelude.push(token.source);
          break;
        case "error": {
          const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
          const error2 = new errors2.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
          if (this.atDirectives || !this.doc)
            this.errors.push(error2);
          else
            this.doc.errors.push(error2);
          break;
        }
        case "doc-end": {
          if (!this.doc) {
            const msg = "Unexpected doc-end without preceding document";
            this.errors.push(new errors2.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
            break;
          }
          this.doc.directives.docEnd = true;
          const end = resolveEnd2.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
          this.decorate(this.doc, true);
          if (end.comment) {
            const dc = this.doc.comment;
            this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
          }
          this.doc.range[2] = end.offset;
          break;
        }
        default:
          this.errors.push(new errors2.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
      }
    }
    /**
     * Call at end of input to yield any remaining document.
     *
     * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
     * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
     */
    *end(forceDoc = false, endOffset = -1) {
      if (this.doc) {
        this.decorate(this.doc, true);
        yield this.doc;
        this.doc = null;
      } else if (forceDoc) {
        const opts = Object.assign({ _directives: this.directives }, this.options);
        const doc = new Document2.Document(void 0, opts);
        if (this.atDirectives)
          this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
        doc.range = [0, endOffset, endOffset];
        this.decorate(doc, false);
        yield doc;
      }
    }
  }
  composer.Composer = Composer;
  return composer;
}
var cst = {};
var cstScalar = {};
var hasRequiredCstScalar;
function requireCstScalar() {
  if (hasRequiredCstScalar) return cstScalar;
  hasRequiredCstScalar = 1;
  var resolveBlockScalar2 = requireResolveBlockScalar();
  var resolveFlowScalar2 = requireResolveFlowScalar();
  var errors2 = requireErrors();
  var stringifyString2 = requireStringifyString();
  function resolveAsScalar(token, strict = true, onError) {
    if (token) {
      const _onError = (pos, code, message) => {
        const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
        if (onError)
          onError(offset, code, message);
        else
          throw new errors2.YAMLParseError([offset, offset + 1], code, message);
      };
      switch (token.type) {
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
          return resolveFlowScalar2.resolveFlowScalar(token, strict, _onError);
        case "block-scalar":
          return resolveBlockScalar2.resolveBlockScalar({ options: { strict } }, token, _onError);
      }
    }
    return null;
  }
  function createScalarToken(value, context) {
    const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
    const source = stringifyString2.stringifyString({ type, value }, {
      implicitKey,
      indent: indent > 0 ? " ".repeat(indent) : "",
      inFlow,
      options: { blockQuote: true, lineWidth: -1 }
    });
    const end = context.end ?? [
      { type: "newline", offset: -1, indent, source: "\n" }
    ];
    switch (source[0]) {
      case "|":
      case ">": {
        const he = source.indexOf("\n");
        const head = source.substring(0, he);
        const body = source.substring(he + 1) + "\n";
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, end))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        return { type: "block-scalar", offset, indent, props, source: body };
      }
      case '"':
        return { type: "double-quoted-scalar", offset, indent, source, end };
      case "'":
        return { type: "single-quoted-scalar", offset, indent, source, end };
      default:
        return { type: "scalar", offset, indent, source, end };
    }
  }
  function setScalarValue(token, value, context = {}) {
    let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
    let indent = "indent" in token ? token.indent : null;
    if (afterKey && typeof indent === "number")
      indent += 2;
    if (!type)
      switch (token.type) {
        case "single-quoted-scalar":
          type = "QUOTE_SINGLE";
          break;
        case "double-quoted-scalar":
          type = "QUOTE_DOUBLE";
          break;
        case "block-scalar": {
          const header = token.props[0];
          if (header.type !== "block-scalar-header")
            throw new Error("Invalid block scalar header");
          type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
          break;
        }
        default:
          type = "PLAIN";
      }
    const source = stringifyString2.stringifyString({ type, value }, {
      implicitKey: implicitKey || indent === null,
      indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
      inFlow,
      options: { blockQuote: true, lineWidth: -1 }
    });
    switch (source[0]) {
      case "|":
      case ">":
        setBlockScalarValue(token, source);
        break;
      case '"':
        setFlowScalarValue(token, source, "double-quoted-scalar");
        break;
      case "'":
        setFlowScalarValue(token, source, "single-quoted-scalar");
        break;
      default:
        setFlowScalarValue(token, source, "scalar");
    }
  }
  function setBlockScalarValue(token, source) {
    const he = source.indexOf("\n");
    const head = source.substring(0, he);
    const body = source.substring(he + 1) + "\n";
    if (token.type === "block-scalar") {
      const header = token.props[0];
      if (header.type !== "block-scalar-header")
        throw new Error("Invalid block scalar header");
      header.source = head;
      token.source = body;
    } else {
      const { offset } = token;
      const indent = "indent" in token ? token.indent : -1;
      const props = [
        { type: "block-scalar-header", offset, indent, source: head }
      ];
      if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
        props.push({ type: "newline", offset: -1, indent, source: "\n" });
      for (const key of Object.keys(token))
        if (key !== "type" && key !== "offset")
          delete token[key];
      Object.assign(token, { type: "block-scalar", indent, props, source: body });
    }
  }
  function addEndtoBlockProps(props, end) {
    if (end)
      for (const st of end)
        switch (st.type) {
          case "space":
          case "comment":
            props.push(st);
            break;
          case "newline":
            props.push(st);
            return true;
        }
    return false;
  }
  function setFlowScalarValue(token, source, type) {
    switch (token.type) {
      case "scalar":
      case "double-quoted-scalar":
      case "single-quoted-scalar":
        token.type = type;
        token.source = source;
        break;
      case "block-scalar": {
        const end = token.props.slice(1);
        let oa = source.length;
        if (token.props[0].type === "block-scalar-header")
          oa -= token.props[0].source.length;
        for (const tok of end)
          tok.offset += oa;
        delete token.props;
        Object.assign(token, { type, source, end });
        break;
      }
      case "block-map":
      case "block-seq": {
        const offset = token.offset + source.length;
        const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
        delete token.items;
        Object.assign(token, { type, source, end: [nl] });
        break;
      }
      default: {
        const indent = "indent" in token ? token.indent : -1;
        const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type, indent, source, end });
      }
    }
  }
  cstScalar.createScalarToken = createScalarToken;
  cstScalar.resolveAsScalar = resolveAsScalar;
  cstScalar.setScalarValue = setScalarValue;
  return cstScalar;
}
var cstStringify = {};
var hasRequiredCstStringify;
function requireCstStringify() {
  if (hasRequiredCstStringify) return cstStringify;
  hasRequiredCstStringify = 1;
  const stringify2 = (cst2) => "type" in cst2 ? stringifyToken(cst2) : stringifyItem(cst2);
  function stringifyToken(token) {
    switch (token.type) {
      case "block-scalar": {
        let res = "";
        for (const tok of token.props)
          res += stringifyToken(tok);
        return res + token.source;
      }
      case "block-map":
      case "block-seq": {
        let res = "";
        for (const item of token.items)
          res += stringifyItem(item);
        return res;
      }
      case "flow-collection": {
        let res = token.start.source;
        for (const item of token.items)
          res += stringifyItem(item);
        for (const st of token.end)
          res += st.source;
        return res;
      }
      case "document": {
        let res = stringifyItem(token);
        if (token.end)
          for (const st of token.end)
            res += st.source;
        return res;
      }
      default: {
        let res = token.source;
        if ("end" in token && token.end)
          for (const st of token.end)
            res += st.source;
        return res;
      }
    }
  }
  function stringifyItem({ start, key, sep, value }) {
    let res = "";
    for (const st of start)
      res += st.source;
    if (key)
      res += stringifyToken(key);
    if (sep)
      for (const st of sep)
        res += st.source;
    if (value)
      res += stringifyToken(value);
    return res;
  }
  cstStringify.stringify = stringify2;
  return cstStringify;
}
var cstVisit = {};
var hasRequiredCstVisit;
function requireCstVisit() {
  if (hasRequiredCstVisit) return cstVisit;
  hasRequiredCstVisit = 1;
  const BREAK = /* @__PURE__ */ Symbol("break visit");
  const SKIP = /* @__PURE__ */ Symbol("skip children");
  const REMOVE = /* @__PURE__ */ Symbol("remove item");
  function visit2(cst2, visitor) {
    if ("type" in cst2 && cst2.type === "document")
      cst2 = { start: cst2.start, value: cst2.value };
    _visit(Object.freeze([]), cst2, visitor);
  }
  visit2.BREAK = BREAK;
  visit2.SKIP = SKIP;
  visit2.REMOVE = REMOVE;
  visit2.itemAtPath = (cst2, path) => {
    let item = cst2;
    for (const [field, index] of path) {
      const tok = item?.[field];
      if (tok && "items" in tok) {
        item = tok.items[index];
      } else
        return void 0;
    }
    return item;
  };
  visit2.parentCollection = (cst2, path) => {
    const parent = visit2.itemAtPath(cst2, path.slice(0, -1));
    const field = path[path.length - 1][0];
    const coll = parent?.[field];
    if (coll && "items" in coll)
      return coll;
    throw new Error("Parent collection not found");
  };
  function _visit(path, item, visitor) {
    let ctrl = visitor(item, path);
    if (typeof ctrl === "symbol")
      return ctrl;
    for (const field of ["key", "value"]) {
      const token = item[field];
      if (token && "items" in token) {
        for (let i = 0; i < token.items.length; ++i) {
          const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
          if (typeof ci === "number")
            i = ci - 1;
          else if (ci === BREAK)
            return BREAK;
          else if (ci === REMOVE) {
            token.items.splice(i, 1);
            i -= 1;
          }
        }
        if (typeof ctrl === "function" && field === "key")
          ctrl = ctrl(item, path);
      }
    }
    return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
  }
  cstVisit.visit = visit2;
  return cstVisit;
}
var hasRequiredCst;
function requireCst() {
  if (hasRequiredCst) return cst;
  hasRequiredCst = 1;
  var cstScalar2 = requireCstScalar();
  var cstStringify2 = requireCstStringify();
  var cstVisit2 = requireCstVisit();
  const BOM = "\uFEFF";
  const DOCUMENT = "";
  const FLOW_END = "";
  const SCALAR = "";
  const isCollection = (token) => !!token && "items" in token;
  const isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
  function prettyToken(token) {
    switch (token) {
      case BOM:
        return "<BOM>";
      case DOCUMENT:
        return "<DOC>";
      case FLOW_END:
        return "<FLOW_END>";
      case SCALAR:
        return "<SCALAR>";
      default:
        return JSON.stringify(token);
    }
  }
  function tokenType(source) {
    switch (source) {
      case BOM:
        return "byte-order-mark";
      case DOCUMENT:
        return "doc-mode";
      case FLOW_END:
        return "flow-error-end";
      case SCALAR:
        return "scalar";
      case "---":
        return "doc-start";
      case "...":
        return "doc-end";
      case "":
      case "\n":
      case "\r\n":
        return "newline";
      case "-":
        return "seq-item-ind";
      case "?":
        return "explicit-key-ind";
      case ":":
        return "map-value-ind";
      case "{":
        return "flow-map-start";
      case "}":
        return "flow-map-end";
      case "[":
        return "flow-seq-start";
      case "]":
        return "flow-seq-end";
      case ",":
        return "comma";
    }
    switch (source[0]) {
      case " ":
      case "	":
        return "space";
      case "#":
        return "comment";
      case "%":
        return "directive-line";
      case "*":
        return "alias";
      case "&":
        return "anchor";
      case "!":
        return "tag";
      case "'":
        return "single-quoted-scalar";
      case '"':
        return "double-quoted-scalar";
      case "|":
      case ">":
        return "block-scalar-header";
    }
    return null;
  }
  cst.createScalarToken = cstScalar2.createScalarToken;
  cst.resolveAsScalar = cstScalar2.resolveAsScalar;
  cst.setScalarValue = cstScalar2.setScalarValue;
  cst.stringify = cstStringify2.stringify;
  cst.visit = cstVisit2.visit;
  cst.BOM = BOM;
  cst.DOCUMENT = DOCUMENT;
  cst.FLOW_END = FLOW_END;
  cst.SCALAR = SCALAR;
  cst.isCollection = isCollection;
  cst.isScalar = isScalar;
  cst.prettyToken = prettyToken;
  cst.tokenType = tokenType;
  return cst;
}
var lexer = {};
var hasRequiredLexer;
function requireLexer() {
  if (hasRequiredLexer) return lexer;
  hasRequiredLexer = 1;
  var cst2 = requireCst();
  function isEmpty(ch) {
    switch (ch) {
      case void 0:
      case " ":
      case "\n":
      case "\r":
      case "	":
        return true;
      default:
        return false;
    }
  }
  const hexDigits = new Set("0123456789ABCDEFabcdef");
  const tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
  const flowIndicatorChars = new Set(",[]{}");
  const invalidAnchorChars = new Set(" ,[]{}\n\r	");
  const isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
  class Lexer {
    constructor() {
      this.atEnd = false;
      this.blockScalarIndent = -1;
      this.blockScalarKeep = false;
      this.buffer = "";
      this.flowKey = false;
      this.flowLevel = 0;
      this.indentNext = 0;
      this.indentValue = 0;
      this.lineEndPos = null;
      this.next = null;
      this.pos = 0;
    }
    /**
     * Generate YAML tokens from the `source` string. If `incomplete`,
     * a part of the last line may be left as a buffer for the next call.
     *
     * @returns A generator of lexical tokens
     */
    *lex(source, incomplete = false) {
      if (source) {
        if (typeof source !== "string")
          throw TypeError("source is not a string");
        this.buffer = this.buffer ? this.buffer + source : source;
        this.lineEndPos = null;
      }
      this.atEnd = !incomplete;
      let next = this.next ?? "stream";
      while (next && (incomplete || this.hasChars(1)))
        next = yield* this.parseNext(next);
    }
    atLineEnd() {
      let i = this.pos;
      let ch = this.buffer[i];
      while (ch === " " || ch === "	")
        ch = this.buffer[++i];
      if (!ch || ch === "#" || ch === "\n")
        return true;
      if (ch === "\r")
        return this.buffer[i + 1] === "\n";
      return false;
    }
    charAt(n) {
      return this.buffer[this.pos + n];
    }
    continueScalar(offset) {
      let ch = this.buffer[offset];
      if (this.indentNext > 0) {
        let indent = 0;
        while (ch === " ")
          ch = this.buffer[++indent + offset];
        if (ch === "\r") {
          const next = this.buffer[indent + offset + 1];
          if (next === "\n" || !next && !this.atEnd)
            return offset + indent + 1;
        }
        return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
      }
      if (ch === "-" || ch === ".") {
        const dt = this.buffer.substr(offset, 3);
        if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
          return -1;
      }
      return offset;
    }
    getLine() {
      let end = this.lineEndPos;
      if (typeof end !== "number" || end !== -1 && end < this.pos) {
        end = this.buffer.indexOf("\n", this.pos);
        this.lineEndPos = end;
      }
      if (end === -1)
        return this.atEnd ? this.buffer.substring(this.pos) : null;
      if (this.buffer[end - 1] === "\r")
        end -= 1;
      return this.buffer.substring(this.pos, end);
    }
    hasChars(n) {
      return this.pos + n <= this.buffer.length;
    }
    setNext(state) {
      this.buffer = this.buffer.substring(this.pos);
      this.pos = 0;
      this.lineEndPos = null;
      this.next = state;
      return null;
    }
    peek(n) {
      return this.buffer.substr(this.pos, n);
    }
    *parseNext(next) {
      switch (next) {
        case "stream":
          return yield* this.parseStream();
        case "line-start":
          return yield* this.parseLineStart();
        case "block-start":
          return yield* this.parseBlockStart();
        case "doc":
          return yield* this.parseDocument();
        case "flow":
          return yield* this.parseFlowCollection();
        case "quoted-scalar":
          return yield* this.parseQuotedScalar();
        case "block-scalar":
          return yield* this.parseBlockScalar();
        case "plain-scalar":
          return yield* this.parsePlainScalar();
      }
    }
    *parseStream() {
      let line = this.getLine();
      if (line === null)
        return this.setNext("stream");
      if (line[0] === cst2.BOM) {
        yield* this.pushCount(1);
        line = line.substring(1);
      }
      if (line[0] === "%") {
        let dirEnd = line.length;
        let cs = line.indexOf("#");
        while (cs !== -1) {
          const ch = line[cs - 1];
          if (ch === " " || ch === "	") {
            dirEnd = cs - 1;
            break;
          } else {
            cs = line.indexOf("#", cs + 1);
          }
        }
        while (true) {
          const ch = line[dirEnd - 1];
          if (ch === " " || ch === "	")
            dirEnd -= 1;
          else
            break;
        }
        const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
        yield* this.pushCount(line.length - n);
        this.pushNewline();
        return "stream";
      }
      if (this.atLineEnd()) {
        const sp = yield* this.pushSpaces(true);
        yield* this.pushCount(line.length - sp);
        yield* this.pushNewline();
        return "stream";
      }
      yield cst2.DOCUMENT;
      return yield* this.parseLineStart();
    }
    *parseLineStart() {
      const ch = this.charAt(0);
      if (!ch && !this.atEnd)
        return this.setNext("line-start");
      if (ch === "-" || ch === ".") {
        if (!this.atEnd && !this.hasChars(4))
          return this.setNext("line-start");
        const s = this.peek(3);
        if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
          yield* this.pushCount(3);
          this.indentValue = 0;
          this.indentNext = 0;
          return s === "---" ? "doc" : "stream";
        }
      }
      this.indentValue = yield* this.pushSpaces(false);
      if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
        this.indentNext = this.indentValue;
      return yield* this.parseBlockStart();
    }
    *parseBlockStart() {
      const [ch0, ch1] = this.peek(2);
      if (!ch1 && !this.atEnd)
        return this.setNext("block-start");
      if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
        const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
        this.indentNext = this.indentValue + 1;
        this.indentValue += n;
        return yield* this.parseBlockStart();
      }
      return "doc";
    }
    *parseDocument() {
      yield* this.pushSpaces(true);
      const line = this.getLine();
      if (line === null)
        return this.setNext("doc");
      let n = yield* this.pushIndicators();
      switch (line[n]) {
        case "#":
          yield* this.pushCount(line.length - n);
        // fallthrough
        case void 0:
          yield* this.pushNewline();
          return yield* this.parseLineStart();
        case "{":
        case "[":
          yield* this.pushCount(1);
          this.flowKey = false;
          this.flowLevel = 1;
          return "flow";
        case "}":
        case "]":
          yield* this.pushCount(1);
          return "doc";
        case "*":
          yield* this.pushUntil(isNotAnchorChar);
          return "doc";
        case '"':
        case "'":
          return yield* this.parseQuotedScalar();
        case "|":
        case ">":
          n += yield* this.parseBlockScalarHeader();
          n += yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - n);
          yield* this.pushNewline();
          return yield* this.parseBlockScalar();
        default:
          return yield* this.parsePlainScalar();
      }
    }
    *parseFlowCollection() {
      let nl, sp;
      let indent = -1;
      do {
        nl = yield* this.pushNewline();
        if (nl > 0) {
          sp = yield* this.pushSpaces(false);
          this.indentValue = indent = sp;
        } else {
          sp = 0;
        }
        sp += yield* this.pushSpaces(true);
      } while (nl + sp > 0);
      const line = this.getLine();
      if (line === null)
        return this.setNext("flow");
      if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
        const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
        if (!atFlowEndMarker) {
          this.flowLevel = 0;
          yield cst2.FLOW_END;
          return yield* this.parseLineStart();
        }
      }
      let n = 0;
      while (line[n] === ",") {
        n += yield* this.pushCount(1);
        n += yield* this.pushSpaces(true);
        this.flowKey = false;
      }
      n += yield* this.pushIndicators();
      switch (line[n]) {
        case void 0:
          return "flow";
        case "#":
          yield* this.pushCount(line.length - n);
          return "flow";
        case "{":
        case "[":
          yield* this.pushCount(1);
          this.flowKey = false;
          this.flowLevel += 1;
          return "flow";
        case "}":
        case "]":
          yield* this.pushCount(1);
          this.flowKey = true;
          this.flowLevel -= 1;
          return this.flowLevel ? "flow" : "doc";
        case "*":
          yield* this.pushUntil(isNotAnchorChar);
          return "flow";
        case '"':
        case "'":
          this.flowKey = true;
          return yield* this.parseQuotedScalar();
        case ":": {
          const next = this.charAt(1);
          if (this.flowKey || isEmpty(next) || next === ",") {
            this.flowKey = false;
            yield* this.pushCount(1);
            yield* this.pushSpaces(true);
            return "flow";
          }
        }
        // fallthrough
        default:
          this.flowKey = false;
          return yield* this.parsePlainScalar();
      }
    }
    *parseQuotedScalar() {
      const quote = this.charAt(0);
      let end = this.buffer.indexOf(quote, this.pos + 1);
      if (quote === "'") {
        while (end !== -1 && this.buffer[end + 1] === "'")
          end = this.buffer.indexOf("'", end + 2);
      } else {
        while (end !== -1) {
          let n = 0;
          while (this.buffer[end - 1 - n] === "\\")
            n += 1;
          if (n % 2 === 0)
            break;
          end = this.buffer.indexOf('"', end + 1);
        }
      }
      const qb = this.buffer.substring(0, end);
      let nl = qb.indexOf("\n", this.pos);
      if (nl !== -1) {
        while (nl !== -1) {
          const cs = this.continueScalar(nl + 1);
          if (cs === -1)
            break;
          nl = qb.indexOf("\n", cs);
        }
        if (nl !== -1) {
          end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
        }
      }
      if (end === -1) {
        if (!this.atEnd)
          return this.setNext("quoted-scalar");
        end = this.buffer.length;
      }
      yield* this.pushToIndex(end + 1, false);
      return this.flowLevel ? "flow" : "doc";
    }
    *parseBlockScalarHeader() {
      this.blockScalarIndent = -1;
      this.blockScalarKeep = false;
      let i = this.pos;
      while (true) {
        const ch = this.buffer[++i];
        if (ch === "+")
          this.blockScalarKeep = true;
        else if (ch > "0" && ch <= "9")
          this.blockScalarIndent = Number(ch) - 1;
        else if (ch !== "-")
          break;
      }
      return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
    }
    *parseBlockScalar() {
      let nl = this.pos - 1;
      let indent = 0;
      let ch;
      loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
        switch (ch) {
          case " ":
            indent += 1;
            break;
          case "\n":
            nl = i2;
            indent = 0;
            break;
          case "\r": {
            const next = this.buffer[i2 + 1];
            if (!next && !this.atEnd)
              return this.setNext("block-scalar");
            if (next === "\n")
              break;
          }
          // fallthrough
          default:
            break loop;
        }
      }
      if (!ch && !this.atEnd)
        return this.setNext("block-scalar");
      if (indent >= this.indentNext) {
        if (this.blockScalarIndent === -1)
          this.indentNext = indent;
        else {
          this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
        }
        do {
          const cs = this.continueScalar(nl + 1);
          if (cs === -1)
            break;
          nl = this.buffer.indexOf("\n", cs);
        } while (nl !== -1);
        if (nl === -1) {
          if (!this.atEnd)
            return this.setNext("block-scalar");
          nl = this.buffer.length;
        }
      }
      let i = nl + 1;
      ch = this.buffer[i];
      while (ch === " ")
        ch = this.buffer[++i];
      if (ch === "	") {
        while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
          ch = this.buffer[++i];
        nl = i - 1;
      } else if (!this.blockScalarKeep) {
        do {
          let i2 = nl - 1;
          let ch2 = this.buffer[i2];
          if (ch2 === "\r")
            ch2 = this.buffer[--i2];
          const lastChar = i2;
          while (ch2 === " ")
            ch2 = this.buffer[--i2];
          if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
            nl = i2;
          else
            break;
        } while (true);
      }
      yield cst2.SCALAR;
      yield* this.pushToIndex(nl + 1, true);
      return yield* this.parseLineStart();
    }
    *parsePlainScalar() {
      const inFlow = this.flowLevel > 0;
      let end = this.pos - 1;
      let i = this.pos - 1;
      let ch;
      while (ch = this.buffer[++i]) {
        if (ch === ":") {
          const next = this.buffer[i + 1];
          if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
            break;
          end = i;
        } else if (isEmpty(ch)) {
          let next = this.buffer[i + 1];
          if (ch === "\r") {
            if (next === "\n") {
              i += 1;
              ch = "\n";
              next = this.buffer[i + 1];
            } else
              end = i;
          }
          if (next === "#" || inFlow && flowIndicatorChars.has(next))
            break;
          if (ch === "\n") {
            const cs = this.continueScalar(i + 1);
            if (cs === -1)
              break;
            i = Math.max(i, cs - 2);
          }
        } else {
          if (inFlow && flowIndicatorChars.has(ch))
            break;
          end = i;
        }
      }
      if (!ch && !this.atEnd)
        return this.setNext("plain-scalar");
      yield cst2.SCALAR;
      yield* this.pushToIndex(end + 1, true);
      return inFlow ? "flow" : "doc";
    }
    *pushCount(n) {
      if (n > 0) {
        yield this.buffer.substr(this.pos, n);
        this.pos += n;
        return n;
      }
      return 0;
    }
    *pushToIndex(i, allowEmpty) {
      const s = this.buffer.slice(this.pos, i);
      if (s) {
        yield s;
        this.pos += s.length;
        return s.length;
      } else if (allowEmpty)
        yield "";
      return 0;
    }
    *pushIndicators() {
      switch (this.charAt(0)) {
        case "!":
          return (yield* this.pushTag()) + (yield* this.pushSpaces(true)) + (yield* this.pushIndicators());
        case "&":
          return (yield* this.pushUntil(isNotAnchorChar)) + (yield* this.pushSpaces(true)) + (yield* this.pushIndicators());
        case "-":
        // this is an error
        case "?":
        // this is an error outside flow collections
        case ":": {
          const inFlow = this.flowLevel > 0;
          const ch1 = this.charAt(1);
          if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
            if (!inFlow)
              this.indentNext = this.indentValue + 1;
            else if (this.flowKey)
              this.flowKey = false;
            return (yield* this.pushCount(1)) + (yield* this.pushSpaces(true)) + (yield* this.pushIndicators());
          }
        }
      }
      return 0;
    }
    *pushTag() {
      if (this.charAt(1) === "<") {
        let i = this.pos + 2;
        let ch = this.buffer[i];
        while (!isEmpty(ch) && ch !== ">")
          ch = this.buffer[++i];
        return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
      } else {
        let i = this.pos + 1;
        let ch = this.buffer[i];
        while (ch) {
          if (tagChars.has(ch))
            ch = this.buffer[++i];
          else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
            ch = this.buffer[i += 3];
          } else
            break;
        }
        return yield* this.pushToIndex(i, false);
      }
    }
    *pushNewline() {
      const ch = this.buffer[this.pos];
      if (ch === "\n")
        return yield* this.pushCount(1);
      else if (ch === "\r" && this.charAt(1) === "\n")
        return yield* this.pushCount(2);
      else
        return 0;
    }
    *pushSpaces(allowTabs) {
      let i = this.pos - 1;
      let ch;
      do {
        ch = this.buffer[++i];
      } while (ch === " " || allowTabs && ch === "	");
      const n = i - this.pos;
      if (n > 0) {
        yield this.buffer.substr(this.pos, n);
        this.pos = i;
      }
      return n;
    }
    *pushUntil(test) {
      let i = this.pos;
      let ch = this.buffer[i];
      while (!test(ch))
        ch = this.buffer[++i];
      return yield* this.pushToIndex(i, false);
    }
  }
  lexer.Lexer = Lexer;
  return lexer;
}
var lineCounter = {};
var hasRequiredLineCounter;
function requireLineCounter() {
  if (hasRequiredLineCounter) return lineCounter;
  hasRequiredLineCounter = 1;
  class LineCounter {
    constructor() {
      this.lineStarts = [];
      this.addNewLine = (offset) => this.lineStarts.push(offset);
      this.linePos = (offset) => {
        let low = 0;
        let high = this.lineStarts.length;
        while (low < high) {
          const mid = low + high >> 1;
          if (this.lineStarts[mid] < offset)
            low = mid + 1;
          else
            high = mid;
        }
        if (this.lineStarts[low] === offset)
          return { line: low + 1, col: 1 };
        if (low === 0)
          return { line: 0, col: offset };
        const start = this.lineStarts[low - 1];
        return { line: low, col: offset - start + 1 };
      };
    }
  }
  lineCounter.LineCounter = LineCounter;
  return lineCounter;
}
var parser = {};
var hasRequiredParser;
function requireParser() {
  if (hasRequiredParser) return parser;
  hasRequiredParser = 1;
  var node_process = require$$0;
  var cst2 = requireCst();
  var lexer2 = requireLexer();
  function includesToken(list, type) {
    for (let i = 0; i < list.length; ++i)
      if (list[i].type === type)
        return true;
    return false;
  }
  function findNonEmptyIndex(list) {
    for (let i = 0; i < list.length; ++i) {
      switch (list[i].type) {
        case "space":
        case "comment":
        case "newline":
          break;
        default:
          return i;
      }
    }
    return -1;
  }
  function isFlowToken(token) {
    switch (token?.type) {
      case "alias":
      case "scalar":
      case "single-quoted-scalar":
      case "double-quoted-scalar":
      case "flow-collection":
        return true;
      default:
        return false;
    }
  }
  function getPrevProps(parent) {
    switch (parent.type) {
      case "document":
        return parent.start;
      case "block-map": {
        const it = parent.items[parent.items.length - 1];
        return it.sep ?? it.start;
      }
      case "block-seq":
        return parent.items[parent.items.length - 1].start;
      /* istanbul ignore next should not happen */
      default:
        return [];
    }
  }
  function getFirstKeyStartProps(prev) {
    if (prev.length === 0)
      return [];
    let i = prev.length;
    loop: while (--i >= 0) {
      switch (prev[i].type) {
        case "doc-start":
        case "explicit-key-ind":
        case "map-value-ind":
        case "seq-item-ind":
        case "newline":
          break loop;
      }
    }
    while (prev[++i]?.type === "space") {
    }
    return prev.splice(i, prev.length);
  }
  function fixFlowSeqItems(fc) {
    if (fc.start.type === "flow-seq-start") {
      for (const it of fc.items) {
        if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
          if (it.key)
            it.value = it.key;
          delete it.key;
          if (isFlowToken(it.value)) {
            if (it.value.end)
              Array.prototype.push.apply(it.value.end, it.sep);
            else
              it.value.end = it.sep;
          } else
            Array.prototype.push.apply(it.start, it.sep);
          delete it.sep;
        }
      }
    }
  }
  class Parser {
    /**
     * @param onNewLine - If defined, called separately with the start position of
     *   each new line (in `parse()`, including the start of input).
     */
    constructor(onNewLine) {
      this.atNewLine = true;
      this.atScalar = false;
      this.indent = 0;
      this.offset = 0;
      this.onKeyLine = false;
      this.stack = [];
      this.source = "";
      this.type = "";
      this.lexer = new lexer2.Lexer();
      this.onNewLine = onNewLine;
    }
    /**
     * Parse `source` as a YAML stream.
     * If `incomplete`, a part of the last line may be left as a buffer for the next call.
     *
     * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
     *
     * @returns A generator of tokens representing each directive, document, and other structure.
     */
    *parse(source, incomplete = false) {
      if (this.onNewLine && this.offset === 0)
        this.onNewLine(0);
      for (const lexeme of this.lexer.lex(source, incomplete))
        yield* this.next(lexeme);
      if (!incomplete)
        yield* this.end();
    }
    /**
     * Advance the parser by the `source` of one lexical token.
     */
    *next(source) {
      this.source = source;
      if (node_process.env.LOG_TOKENS)
        console.log("|", cst2.prettyToken(source));
      if (this.atScalar) {
        this.atScalar = false;
        yield* this.step();
        this.offset += source.length;
        return;
      }
      const type = cst2.tokenType(source);
      if (!type) {
        const message = `Not a YAML token: ${source}`;
        yield* this.pop({ type: "error", offset: this.offset, message, source });
        this.offset += source.length;
      } else if (type === "scalar") {
        this.atNewLine = false;
        this.atScalar = true;
        this.type = "scalar";
      } else {
        this.type = type;
        yield* this.step();
        switch (type) {
          case "newline":
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine)
              this.onNewLine(this.offset + source.length);
            break;
          case "space":
            if (this.atNewLine && source[0] === " ")
              this.indent += source.length;
            break;
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
            if (this.atNewLine)
              this.indent += source.length;
            break;
          case "doc-mode":
          case "flow-error-end":
            return;
          default:
            this.atNewLine = false;
        }
        this.offset += source.length;
      }
    }
    /** Call at end of input to push out any remaining constructions */
    *end() {
      while (this.stack.length > 0)
        yield* this.pop();
    }
    get sourceToken() {
      const st = {
        type: this.type,
        offset: this.offset,
        indent: this.indent,
        source: this.source
      };
      return st;
    }
    *step() {
      const top = this.peek(1);
      if (this.type === "doc-end" && (!top || top.type !== "doc-end")) {
        while (this.stack.length > 0)
          yield* this.pop();
        this.stack.push({
          type: "doc-end",
          offset: this.offset,
          source: this.source
        });
        return;
      }
      if (!top)
        return yield* this.stream();
      switch (top.type) {
        case "document":
          return yield* this.document(top);
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
          return yield* this.scalar(top);
        case "block-scalar":
          return yield* this.blockScalar(top);
        case "block-map":
          return yield* this.blockMap(top);
        case "block-seq":
          return yield* this.blockSequence(top);
        case "flow-collection":
          return yield* this.flowCollection(top);
        case "doc-end":
          return yield* this.documentEnd(top);
      }
      yield* this.pop();
    }
    peek(n) {
      return this.stack[this.stack.length - n];
    }
    *pop(error2) {
      const token = error2 ?? this.stack.pop();
      if (!token) {
        const message = "Tried to pop an empty stack";
        yield { type: "error", offset: this.offset, source: "", message };
      } else if (this.stack.length === 0) {
        yield token;
      } else {
        const top = this.peek(1);
        if (token.type === "block-scalar") {
          token.indent = "indent" in top ? top.indent : 0;
        } else if (token.type === "flow-collection" && top.type === "document") {
          token.indent = 0;
        }
        if (token.type === "flow-collection")
          fixFlowSeqItems(token);
        switch (top.type) {
          case "document":
            top.value = token;
            break;
          case "block-scalar":
            top.props.push(token);
            break;
          case "block-map": {
            const it = top.items[top.items.length - 1];
            if (it.value) {
              top.items.push({ start: [], key: token, sep: [] });
              this.onKeyLine = true;
              return;
            } else if (it.sep) {
              it.value = token;
            } else {
              Object.assign(it, { key: token, sep: [] });
              this.onKeyLine = !it.explicitKey;
              return;
            }
            break;
          }
          case "block-seq": {
            const it = top.items[top.items.length - 1];
            if (it.value)
              top.items.push({ start: [], value: token });
            else
              it.value = token;
            break;
          }
          case "flow-collection": {
            const it = top.items[top.items.length - 1];
            if (!it || it.value)
              top.items.push({ start: [], key: token, sep: [] });
            else if (it.sep)
              it.value = token;
            else
              Object.assign(it, { key: token, sep: [] });
            return;
          }
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.pop(token);
        }
        if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
          const last = token.items[token.items.length - 1];
          if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
            if (top.type === "document")
              top.end = last.start;
            else
              top.items.push({ start: last.start });
            token.items.splice(-1, 1);
          }
        }
      }
    }
    *stream() {
      switch (this.type) {
        case "directive-line":
          yield { type: "directive", offset: this.offset, source: this.source };
          return;
        case "byte-order-mark":
        case "space":
        case "comment":
        case "newline":
          yield this.sourceToken;
          return;
        case "doc-mode":
        case "doc-start": {
          const doc = {
            type: "document",
            offset: this.offset,
            start: []
          };
          if (this.type === "doc-start")
            doc.start.push(this.sourceToken);
          this.stack.push(doc);
          return;
        }
      }
      yield {
        type: "error",
        offset: this.offset,
        message: `Unexpected ${this.type} token in YAML stream`,
        source: this.source
      };
    }
    *document(doc) {
      if (doc.value)
        return yield* this.lineEnd(doc);
      switch (this.type) {
        case "doc-start": {
          if (findNonEmptyIndex(doc.start) !== -1) {
            yield* this.pop();
            yield* this.step();
          } else
            doc.start.push(this.sourceToken);
          return;
        }
        case "anchor":
        case "tag":
        case "space":
        case "comment":
        case "newline":
          doc.start.push(this.sourceToken);
          return;
      }
      const bv = this.startBlockValue(doc);
      if (bv)
        this.stack.push(bv);
      else {
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML document`,
          source: this.source
        };
      }
    }
    *scalar(scalar) {
      if (this.type === "map-value-ind") {
        const prev = getPrevProps(this.peek(2));
        const start = getFirstKeyStartProps(prev);
        let sep;
        if (scalar.end) {
          sep = scalar.end;
          sep.push(this.sourceToken);
          delete scalar.end;
        } else
          sep = [this.sourceToken];
        const map2 = {
          type: "block-map",
          offset: scalar.offset,
          indent: scalar.indent,
          items: [{ start, key: scalar, sep }]
        };
        this.onKeyLine = true;
        this.stack[this.stack.length - 1] = map2;
      } else
        yield* this.lineEnd(scalar);
    }
    *blockScalar(scalar) {
      switch (this.type) {
        case "space":
        case "comment":
        case "newline":
          scalar.props.push(this.sourceToken);
          return;
        case "scalar":
          scalar.source = this.source;
          this.atNewLine = true;
          this.indent = 0;
          if (this.onNewLine) {
            let nl = this.source.indexOf("\n") + 1;
            while (nl !== 0) {
              this.onNewLine(this.offset + nl);
              nl = this.source.indexOf("\n", nl) + 1;
            }
          }
          yield* this.pop();
          break;
        /* istanbul ignore next should not happen */
        default:
          yield* this.pop();
          yield* this.step();
      }
    }
    *blockMap(map2) {
      const it = map2.items[map2.items.length - 1];
      switch (this.type) {
        case "newline":
          this.onKeyLine = false;
          if (it.value) {
            const end = "end" in it.value ? it.value.end : void 0;
            const last = Array.isArray(end) ? end[end.length - 1] : void 0;
            if (last?.type === "comment")
              end?.push(this.sourceToken);
            else
              map2.items.push({ start: [this.sourceToken] });
          } else if (it.sep) {
            it.sep.push(this.sourceToken);
          } else {
            it.start.push(this.sourceToken);
          }
          return;
        case "space":
        case "comment":
          if (it.value) {
            map2.items.push({ start: [this.sourceToken] });
          } else if (it.sep) {
            it.sep.push(this.sourceToken);
          } else {
            if (this.atIndentedComment(it.start, map2.indent)) {
              const prev = map2.items[map2.items.length - 2];
              const end = prev?.value?.end;
              if (Array.isArray(end)) {
                Array.prototype.push.apply(end, it.start);
                end.push(this.sourceToken);
                map2.items.pop();
                return;
              }
            }
            it.start.push(this.sourceToken);
          }
          return;
      }
      if (this.indent >= map2.indent) {
        const atMapIndent = !this.onKeyLine && this.indent === map2.indent;
        const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
        let start = [];
        if (atNextItem && it.sep && !it.value) {
          const nl = [];
          for (let i = 0; i < it.sep.length; ++i) {
            const st = it.sep[i];
            switch (st.type) {
              case "newline":
                nl.push(i);
                break;
              case "space":
                break;
              case "comment":
                if (st.indent > map2.indent)
                  nl.length = 0;
                break;
              default:
                nl.length = 0;
            }
          }
          if (nl.length >= 2)
            start = it.sep.splice(nl[1]);
        }
        switch (this.type) {
          case "anchor":
          case "tag":
            if (atNextItem || it.value) {
              start.push(this.sourceToken);
              map2.items.push({ start });
              this.onKeyLine = true;
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "explicit-key-ind":
            if (!it.sep && !it.explicitKey) {
              it.start.push(this.sourceToken);
              it.explicitKey = true;
            } else if (atNextItem || it.value) {
              start.push(this.sourceToken);
              map2.items.push({ start, explicitKey: true });
            } else {
              this.stack.push({
                type: "block-map",
                offset: this.offset,
                indent: this.indent,
                items: [{ start: [this.sourceToken], explicitKey: true }]
              });
            }
            this.onKeyLine = true;
            return;
          case "map-value-ind":
            if (it.explicitKey) {
              if (!it.sep) {
                if (includesToken(it.start, "newline")) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else {
                  const start2 = getFirstKeyStartProps(it.start);
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                  });
                }
              } else if (it.value) {
                map2.items.push({ start: [], key: null, sep: [this.sourceToken] });
              } else if (includesToken(it.sep, "map-value-ind")) {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start, key: null, sep: [this.sourceToken] }]
                });
              } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                const start2 = getFirstKeyStartProps(it.start);
                const key = it.key;
                const sep = it.sep;
                sep.push(this.sourceToken);
                delete it.key;
                delete it.sep;
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: start2, key, sep }]
                });
              } else if (start.length > 0) {
                it.sep = it.sep.concat(start, this.sourceToken);
              } else {
                it.sep.push(this.sourceToken);
              }
            } else {
              if (!it.sep) {
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              } else if (it.value || atNextItem) {
                map2.items.push({ start, key: null, sep: [this.sourceToken] });
              } else if (includesToken(it.sep, "map-value-ind")) {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [], key: null, sep: [this.sourceToken] }]
                });
              } else {
                it.sep.push(this.sourceToken);
              }
            }
            this.onKeyLine = true;
            return;
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar": {
            const fs = this.flowScalar(this.type);
            if (atNextItem || it.value) {
              map2.items.push({ start, key: fs, sep: [] });
              this.onKeyLine = true;
            } else if (it.sep) {
              this.stack.push(fs);
            } else {
              Object.assign(it, { key: fs, sep: [] });
              this.onKeyLine = true;
            }
            return;
          }
          default: {
            const bv = this.startBlockValue(map2);
            if (bv) {
              if (bv.type === "block-seq") {
                if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                  yield* this.pop({
                    type: "error",
                    offset: this.offset,
                    message: "Unexpected block-seq-ind on same line with key",
                    source: this.source
                  });
                  return;
                }
              } else if (atMapIndent) {
                map2.items.push({ start });
              }
              this.stack.push(bv);
              return;
            }
          }
        }
      }
      yield* this.pop();
      yield* this.step();
    }
    *blockSequence(seq2) {
      const it = seq2.items[seq2.items.length - 1];
      switch (this.type) {
        case "newline":
          if (it.value) {
            const end = "end" in it.value ? it.value.end : void 0;
            const last = Array.isArray(end) ? end[end.length - 1] : void 0;
            if (last?.type === "comment")
              end?.push(this.sourceToken);
            else
              seq2.items.push({ start: [this.sourceToken] });
          } else
            it.start.push(this.sourceToken);
          return;
        case "space":
        case "comment":
          if (it.value)
            seq2.items.push({ start: [this.sourceToken] });
          else {
            if (this.atIndentedComment(it.start, seq2.indent)) {
              const prev = seq2.items[seq2.items.length - 2];
              const end = prev?.value?.end;
              if (Array.isArray(end)) {
                Array.prototype.push.apply(end, it.start);
                end.push(this.sourceToken);
                seq2.items.pop();
                return;
              }
            }
            it.start.push(this.sourceToken);
          }
          return;
        case "anchor":
        case "tag":
          if (it.value || this.indent <= seq2.indent)
            break;
          it.start.push(this.sourceToken);
          return;
        case "seq-item-ind":
          if (this.indent !== seq2.indent)
            break;
          if (it.value || includesToken(it.start, "seq-item-ind"))
            seq2.items.push({ start: [this.sourceToken] });
          else
            it.start.push(this.sourceToken);
          return;
      }
      if (this.indent > seq2.indent) {
        const bv = this.startBlockValue(seq2);
        if (bv) {
          this.stack.push(bv);
          return;
        }
      }
      yield* this.pop();
      yield* this.step();
    }
    *flowCollection(fc) {
      const it = fc.items[fc.items.length - 1];
      if (this.type === "flow-error-end") {
        let top;
        do {
          yield* this.pop();
          top = this.peek(1);
        } while (top && top.type === "flow-collection");
      } else if (fc.end.length === 0) {
        switch (this.type) {
          case "comma":
          case "explicit-key-ind":
            if (!it || it.sep)
              fc.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
          case "map-value-ind":
            if (!it || it.value)
              fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
            else if (it.sep)
              it.sep.push(this.sourceToken);
            else
              Object.assign(it, { key: null, sep: [this.sourceToken] });
            return;
          case "space":
          case "comment":
          case "newline":
          case "anchor":
          case "tag":
            if (!it || it.value)
              fc.items.push({ start: [this.sourceToken] });
            else if (it.sep)
              it.sep.push(this.sourceToken);
            else
              it.start.push(this.sourceToken);
            return;
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar": {
            const fs = this.flowScalar(this.type);
            if (!it || it.value)
              fc.items.push({ start: [], key: fs, sep: [] });
            else if (it.sep)
              this.stack.push(fs);
            else
              Object.assign(it, { key: fs, sep: [] });
            return;
          }
          case "flow-map-end":
          case "flow-seq-end":
            fc.end.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(fc);
        if (bv)
          this.stack.push(bv);
        else {
          yield* this.pop();
          yield* this.step();
        }
      } else {
        const parent = this.peek(2);
        if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
          yield* this.pop();
          yield* this.step();
        } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
          const prev = getPrevProps(parent);
          const start = getFirstKeyStartProps(prev);
          fixFlowSeqItems(fc);
          const sep = fc.end.splice(1, fc.end.length);
          sep.push(this.sourceToken);
          const map2 = {
            type: "block-map",
            offset: fc.offset,
            indent: fc.indent,
            items: [{ start, key: fc, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map2;
        } else {
          yield* this.lineEnd(fc);
        }
      }
    }
    flowScalar(type) {
      if (this.onNewLine) {
        let nl = this.source.indexOf("\n") + 1;
        while (nl !== 0) {
          this.onNewLine(this.offset + nl);
          nl = this.source.indexOf("\n", nl) + 1;
        }
      }
      return {
        type,
        offset: this.offset,
        indent: this.indent,
        source: this.source
      };
    }
    startBlockValue(parent) {
      switch (this.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
          return this.flowScalar(this.type);
        case "block-scalar-header":
          return {
            type: "block-scalar",
            offset: this.offset,
            indent: this.indent,
            props: [this.sourceToken],
            source: ""
          };
        case "flow-map-start":
        case "flow-seq-start":
          return {
            type: "flow-collection",
            offset: this.offset,
            indent: this.indent,
            start: this.sourceToken,
            items: [],
            end: []
          };
        case "seq-item-ind":
          return {
            type: "block-seq",
            offset: this.offset,
            indent: this.indent,
            items: [{ start: [this.sourceToken] }]
          };
        case "explicit-key-ind": {
          this.onKeyLine = true;
          const prev = getPrevProps(parent);
          const start = getFirstKeyStartProps(prev);
          start.push(this.sourceToken);
          return {
            type: "block-map",
            offset: this.offset,
            indent: this.indent,
            items: [{ start, explicitKey: true }]
          };
        }
        case "map-value-ind": {
          this.onKeyLine = true;
          const prev = getPrevProps(parent);
          const start = getFirstKeyStartProps(prev);
          return {
            type: "block-map",
            offset: this.offset,
            indent: this.indent,
            items: [{ start, key: null, sep: [this.sourceToken] }]
          };
        }
      }
      return null;
    }
    atIndentedComment(start, indent) {
      if (this.type !== "comment")
        return false;
      if (this.indent <= indent)
        return false;
      return start.every((st) => st.type === "newline" || st.type === "space");
    }
    *documentEnd(docEnd) {
      if (this.type !== "doc-mode") {
        if (docEnd.end)
          docEnd.end.push(this.sourceToken);
        else
          docEnd.end = [this.sourceToken];
        if (this.type === "newline")
          yield* this.pop();
      }
    }
    *lineEnd(token) {
      switch (this.type) {
        case "comma":
        case "doc-start":
        case "doc-end":
        case "flow-seq-end":
        case "flow-map-end":
        case "map-value-ind":
          yield* this.pop();
          yield* this.step();
          break;
        case "newline":
          this.onKeyLine = false;
        // fallthrough
        case "space":
        case "comment":
        default:
          if (token.end)
            token.end.push(this.sourceToken);
          else
            token.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
      }
    }
  }
  parser.Parser = Parser;
  return parser;
}
var publicApi = {};
var hasRequiredPublicApi;
function requirePublicApi() {
  if (hasRequiredPublicApi) return publicApi;
  hasRequiredPublicApi = 1;
  var composer2 = requireComposer();
  var Document2 = requireDocument();
  var errors2 = requireErrors();
  var log2 = requireLog();
  var identity2 = requireIdentity();
  var lineCounter2 = requireLineCounter();
  var parser2 = requireParser();
  function parseOptions(options) {
    const prettyErrors = options.prettyErrors !== false;
    const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter2.LineCounter() || null;
    return { lineCounter: lineCounter$1, prettyErrors };
  }
  function parseAllDocuments(source, options = {}) {
    const { lineCounter: lineCounter3, prettyErrors } = parseOptions(options);
    const parser$1 = new parser2.Parser(lineCounter3?.addNewLine);
    const composer$1 = new composer2.Composer(options);
    const docs = Array.from(composer$1.compose(parser$1.parse(source)));
    if (prettyErrors && lineCounter3)
      for (const doc of docs) {
        doc.errors.forEach(errors2.prettifyError(source, lineCounter3));
        doc.warnings.forEach(errors2.prettifyError(source, lineCounter3));
      }
    if (docs.length > 0)
      return docs;
    return Object.assign([], { empty: true }, composer$1.streamInfo());
  }
  function parseDocument(source, options = {}) {
    const { lineCounter: lineCounter3, prettyErrors } = parseOptions(options);
    const parser$1 = new parser2.Parser(lineCounter3?.addNewLine);
    const composer$1 = new composer2.Composer(options);
    let doc = null;
    for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
      if (!doc)
        doc = _doc;
      else if (doc.options.logLevel !== "silent") {
        doc.errors.push(new errors2.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
        break;
      }
    }
    if (prettyErrors && lineCounter3) {
      doc.errors.forEach(errors2.prettifyError(source, lineCounter3));
      doc.warnings.forEach(errors2.prettifyError(source, lineCounter3));
    }
    return doc;
  }
  function parse2(src, reviver, options) {
    let _reviver = void 0;
    if (typeof reviver === "function") {
      _reviver = reviver;
    } else if (options === void 0 && reviver && typeof reviver === "object") {
      options = reviver;
    }
    const doc = parseDocument(src, options);
    if (!doc)
      return null;
    doc.warnings.forEach((warning) => log2.warn(doc.options.logLevel, warning));
    if (doc.errors.length > 0) {
      if (doc.options.logLevel !== "silent")
        throw doc.errors[0];
      else
        doc.errors = [];
    }
    return doc.toJS(Object.assign({ reviver: _reviver }, options));
  }
  function stringify2(value, replacer, options) {
    let _replacer = null;
    if (typeof replacer === "function" || Array.isArray(replacer)) {
      _replacer = replacer;
    } else if (options === void 0 && replacer) {
      options = replacer;
    }
    if (typeof options === "string")
      options = options.length;
    if (typeof options === "number") {
      const indent = Math.round(options);
      options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
    }
    if (value === void 0) {
      const { keepUndefined } = options ?? replacer ?? {};
      if (!keepUndefined)
        return void 0;
    }
    if (identity2.isDocument(value) && !_replacer)
      return value.toString(options);
    return new Document2.Document(value, _replacer, options).toString(options);
  }
  publicApi.parse = parse2;
  publicApi.parseAllDocuments = parseAllDocuments;
  publicApi.parseDocument = parseDocument;
  publicApi.stringify = stringify2;
  return publicApi;
}
var hasRequiredDist;
function requireDist() {
  if (hasRequiredDist) return dist;
  hasRequiredDist = 1;
  var composer2 = requireComposer();
  var Document2 = requireDocument();
  var Schema2 = requireSchema();
  var errors2 = requireErrors();
  var Alias2 = requireAlias();
  var identity2 = requireIdentity();
  var Pair2 = requirePair();
  var Scalar2 = requireScalar();
  var YAMLMap2 = requireYAMLMap();
  var YAMLSeq2 = requireYAMLSeq();
  var cst2 = requireCst();
  var lexer2 = requireLexer();
  var lineCounter2 = requireLineCounter();
  var parser2 = requireParser();
  var publicApi2 = requirePublicApi();
  var visit2 = requireVisit();
  dist.Composer = composer2.Composer;
  dist.Document = Document2.Document;
  dist.Schema = Schema2.Schema;
  dist.YAMLError = errors2.YAMLError;
  dist.YAMLParseError = errors2.YAMLParseError;
  dist.YAMLWarning = errors2.YAMLWarning;
  dist.Alias = Alias2.Alias;
  dist.isAlias = identity2.isAlias;
  dist.isCollection = identity2.isCollection;
  dist.isDocument = identity2.isDocument;
  dist.isMap = identity2.isMap;
  dist.isNode = identity2.isNode;
  dist.isPair = identity2.isPair;
  dist.isScalar = identity2.isScalar;
  dist.isSeq = identity2.isSeq;
  dist.Pair = Pair2.Pair;
  dist.Scalar = Scalar2.Scalar;
  dist.YAMLMap = YAMLMap2.YAMLMap;
  dist.YAMLSeq = YAMLSeq2.YAMLSeq;
  dist.CST = cst2;
  dist.Lexer = lexer2.Lexer;
  dist.LineCounter = lineCounter2.LineCounter;
  dist.Parser = parser2.Parser;
  dist.parse = publicApi2.parse;
  dist.parseAllDocuments = publicApi2.parseAllDocuments;
  dist.parseDocument = publicApi2.parseDocument;
  dist.stringify = publicApi2.stringify;
  dist.visit = visit2.visit;
  dist.visitAsync = visit2.visitAsync;
  return dist;
}
var distExports = requireDist();
const YAML = /* @__PURE__ */ getDefaultExportFromCjs(distExports);
const HEADING = /^## (user|assistant|system)\s+<!--\s*(\S+)\s+(\S+)\s*-->\s*$/;
function parseThreadFile(text2, file2) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text2);
  if (!m) throw new Error(`Thread file has no frontmatter: ${file2}`);
  const fm = YAML.parse(m[1]);
  const body = m[2] ?? "";
  const messages = [];
  let cur = null;
  const lines = [];
  const flush = () => {
    if (cur) {
      let text22 = lines.join("\n").replace(/^\n+|\n+$/g, "");
      if (cur.quote) text22 = text22.replace(/^(?:>.*(?:\n|$))+\n*/, "");
      cur.body = text22;
      messages.push(cur);
    }
    lines.length = 0;
  };
  for (const line of body.split(/\r?\n/)) {
    const h = HEADING.exec(line);
    if (h) {
      flush();
      const id = h[2];
      cur = { id, role: h[1], at: h[3], body: "" };
      const quote = fm.anchors?.[id];
      if (quote) cur.quote = quote;
      const ctx = fm.context?.[id];
      if (ctx) cur.context = ctx;
    } else if (cur) {
      lines.push(line);
    }
  }
  flush();
  const meta = {
    id: fm.id,
    title: fm.title,
    created: fm.created,
    hue: fm.hue ?? 1,
    file: file2,
    messageCount: messages.length
  };
  if (fm.agent) meta.agent = fm.agent;
  if (fm.model) meta.model = fm.model;
  if (fm.effort) meta.effort = fm.effort;
  if (fm.parent) meta.parent = fm.parent;
  if (fm.anchor) meta.anchor = fm.anchor;
  if (fm.handoff) meta.handoff = fm.handoff;
  if (fm.summary) meta.summary = fm.summary;
  return { ...meta, messages };
}
function renderQuote(a) {
  const page = a.page ? `  [p.${a.page}]` : "";
  return a.quote.split("\n").map((l) => `> ${l}`).join("\n") + page;
}
function serializeThread(t) {
  const fm = { id: t.id, title: t.title, created: t.created, hue: t.hue };
  if (t.agent) fm.agent = t.agent;
  if (t.model) fm.model = t.model;
  if (t.effort) fm.effort = t.effort;
  if (t.parent) fm.parent = t.parent;
  if (t.anchor) fm.anchor = t.anchor;
  if (t.handoff) fm.handoff = t.handoff;
  if (t.summary) fm.summary = t.summary;
  const anchors2 = {};
  const context = {};
  for (const m of t.messages) {
    if (m.quote) anchors2[m.id] = m.quote;
    if (m.context?.length) context[m.id] = m.context;
  }
  if (Object.keys(anchors2).length) fm.anchors = anchors2;
  if (Object.keys(context).length) fm.context = context;
  const parts = [`---
${YAML.stringify(fm).trimEnd()}
---
`];
  for (const m of t.messages) {
    parts.push(`
## ${m.role}  <!-- ${m.id} ${m.at} -->

`);
    if (m.quote) parts.push(renderQuote(m.quote) + "\n\n");
    parts.push(m.body.trimEnd() + "\n");
  }
  return parts.join("");
}
function walk(dir, out) {
  if (!node_fs.existsSync(dir)) return;
  for (const name of node_fs.readdirSync(dir)) {
    const p = node_path.join(dir, name);
    if (node_fs.statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
}
function listThreads(collection) {
  const files = [];
  walk(node_path.join(collection, DIRS.threads), files);
  const out = [];
  for (const f of files) {
    try {
      const rel = node_path.relative(collection, f).split(node_path.sep).join("/");
      const { messages: _m, ...meta } = parseThreadFile(node_fs.readFileSync(f, "utf8"), rel);
      out.push(meta);
    } catch {
    }
  }
  return out.sort((a, b) => a.created < b.created ? 1 : -1);
}
function readThread(collection, id) {
  const meta = listThreads(collection).find((t) => t.id === id);
  if (!meta) return null;
  return parseThreadFile(node_fs.readFileSync(node_path.join(collection, meta.file), "utf8"), meta.file);
}
function writeThread(collection, t) {
  writeAtomic(node_path.join(collection, t.file), serializeThread(t));
}
function uniqueFile(collection, dir, base) {
  let rel = `${dir}/${base}.md`;
  let n = 2;
  while (node_fs.existsSync(node_path.join(collection, rel))) rel = `${dir}/${base}-${n++}.md`;
  return rel;
}
function createThread(collection, input) {
  const existing = listThreads(collection);
  const created = (/* @__PURE__ */ new Date()).toISOString();
  const day = created.slice(0, 10);
  let dir = DIRS.threads;
  if (input.parent) {
    const parent = existing.find((t) => t.id === input.parent.thread);
    if (parent) dir = parent.file.replace(/\.md$/, "");
  }
  const file2 = uniqueFile(collection, dir, input.parent ? slugify$1(input.title) : `${day}-${slugify$1(input.title)}`);
  const hue = existing.length % 4 + 1;
  const thread = {
    id: newId("thr"),
    title: input.title,
    created,
    hue,
    file: file2,
    messageCount: 0,
    messages: []
  };
  if (input.anchor) thread.anchor = input.anchor;
  if (input.parent) thread.parent = input.parent;
  if (input.agent) thread.agent = input.agent;
  if (input.model) thread.model = input.model;
  writeThread(collection, thread);
  return thread;
}
function appendMessage(collection, id, message) {
  const t = readThread(collection, id);
  if (!t) throw new Error(`Unknown thread: ${id}`);
  const msg = { ...message, id: message.id ?? newId("msg"), at: message.at ?? (/* @__PURE__ */ new Date()).toISOString() };
  t.messages.push(msg);
  t.messageCount = t.messages.length;
  writeThread(collection, t);
  return t;
}
function updateThread(collection, id, patch) {
  const t = readThread(collection, id);
  if (!t) throw new Error(`Unknown thread: ${id}`);
  Object.assign(t, patch);
  writeThread(collection, t);
  return t;
}
const FILE = "reader-state.json";
function readReaderState(collection) {
  return readJson(node_path.join(collection, DIRS.state, FILE)) ?? {};
}
function setReaderPosition(collection, sourceId, position) {
  const state = readReaderState(collection);
  state[sourceId] = position;
  writeJson(node_path.join(collection, DIRS.state, FILE), state);
}
const MAX = 20;
const file = () => node_path.join(electron.app.getPath("userData"), "recent-collections.json");
function recentCollections() {
  const list = readJson(file()) ?? [];
  return list.filter((c) => node_fs.existsSync(node_path.join(c.path, "qrabbit.json"))).sort((a, b) => (a.lastOpened ?? "") < (b.lastOpened ?? "") ? 1 : -1);
}
function touchRecent(info) {
  const rest = recentCollections().filter((c) => c.path !== info.path);
  const next = [{ ...info, lastOpened: (/* @__PURE__ */ new Date()).toISOString() }, ...rest].slice(0, MAX);
  writeJson(file(), next);
  return next;
}
function forgetRecent(path) {
  const next = recentCollections().filter((c) => c.path !== path);
  writeJson(file(), next);
  return next;
}
const AGENT_METHODS = {
  initialize: "initialize",
  authenticate: "authenticate",
  providers_list: "providers/list",
  providers_set: "providers/set",
  providers_disable: "providers/disable",
  session_new: "session/new",
  session_load: "session/load",
  session_set_mode: "session/set_mode",
  session_set_config_option: "session/set_config_option",
  session_prompt: "session/prompt",
  session_cancel: "session/cancel",
  session_list: "session/list",
  session_delete: "session/delete",
  session_fork: "session/fork",
  session_resume: "session/resume",
  session_close: "session/close",
  logout: "logout",
  nes_start: "nes/start",
  nes_suggest: "nes/suggest",
  nes_accept: "nes/accept",
  nes_reject: "nes/reject",
  nes_close: "nes/close",
  document_did_open: "document/didOpen",
  document_did_change: "document/didChange",
  document_did_close: "document/didClose",
  document_did_save: "document/didSave",
  document_did_focus: "document/didFocus"
};
const CLIENT_METHODS = {
  session_request_permission: "session/request_permission",
  session_update: "session/update",
  fs_write_text_file: "fs/write_text_file",
  fs_read_text_file: "fs/read_text_file",
  terminal_create: "terminal/create",
  terminal_output: "terminal/output",
  terminal_release: "terminal/release",
  terminal_wait_for_exit: "terminal/wait_for_exit",
  terminal_kill: "terminal/kill",
  elicitation_create: "elicitation/create",
  elicitation_complete: "elicitation/complete"
};
const PROTOCOL_VERSION = 1;
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
class Cached {
  constructor(getter) {
    this._getter = getter;
    this._value = void 0;
  }
  get value() {
    const getter = this._getter;
    if (getter !== void 0) {
      this._value = getter();
      this._getter = void 0;
    }
    return this._value;
  }
}
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema2) {
  return rawShape(schema2._zod.def) ?? schema2._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys, wrap) {
  const raw = sourceShape(source);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
const propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
  });
}
const NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
const BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema2, mask) {
  const currDef = schema2._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema2, maskedKeys(schema2, mask));
  return clone(schema2, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema2, mask) {
  const raw = sourceShape(schema2);
  const keys = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema2, mask) {
  const currDef = schema2._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema2, mask));
  const newShape = {};
  mirrorShape(newShape, schema2, Reflect.ownKeys(sourceShape(schema2)).filter((key) => !omitted.has(key)));
  return clone(schema2, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema2, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema2._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema2);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone(schema2, mergeDefs(schema2._zod.def, { shape: extended(schema2, shape) }));
}
function extended(schema2, shape) {
  const newShape = {};
  mirrorShape(newShape, schema2, Reflect.ownKeys(sourceShape(schema2)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema2, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone(schema2, mergeDefs(schema2._zod.def, { shape: extended(schema2, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema2, mask, name = "partial") {
  const currDef = schema2._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema2, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema2, Reflect.ownKeys(sourceShape(schema2)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({ type: "optional", innerType: value })));
  return clone(schema2, mergeDefs(schema2._zod.def, { shape: newShape, checks: [] }));
}
function required(Class, schema2, mask) {
  const selected = mask ? new Set(maskedKeys(schema2, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema2, Reflect.ownKeys(sourceShape(schema2)), (value, key) => (
    // overwrite with non-optional
    selected && !selected.has(key) ? value : new Class({ type: "nonoptional", innerType: value })
  ));
  return clone(schema2, mergeDefs(schema2._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a2;
    (_a2 = iss).path ?? (_a2.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function attachSchema(issues, start, inst) {
  var _a2;
  for (let i = start; i < issues.length; i++) {
    (_a2 = issues[i]).schema ?? (_a2.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config2) {
  var _a2;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a2 = iss).schema ?? (_a2.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
const highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0; i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
let installing;
let broke = false;
const breaker = {
  configurable: true,
  get() {
    broke = true;
    return void 0;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: void 0 };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
const CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}
var _a$1;
const NEVER = /* @__PURE__ */ Object.freeze({
  status: "aborted"
});
const _zodDesc = { value: void 0, enumerable: false };
let _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition();
}
function $constructor(name, initializer2, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer2(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _.prototype;
    for (const k in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto2[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred2 = inst._zod.deferred;
    if (deferred2) {
      for (const fn of deferred2) {
        fn();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}
class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
const _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
const _issuesDesc = { value: void 0, enumerable: false };
const _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
const initializer$1 = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = void 0;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
const $ZodError = $constructor("$ZodError", initializer$1);
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error2.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error3, path = []) => {
    for (const issue2 of error3.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue2));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node2 = curr[el];
            if (terminal) {
              node2._errors.push(mapper(issue2));
            }
            curr = node2;
            i++;
          }
        }
      }
    }
  };
  processError(error2);
  return fieldErrors;
}
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
const _parse = (_Err) => {
  const fn = (schema2, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema2._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError();
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
const _parseAsync = (_Err) => {
  const fn = async (schema2, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema2._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
const _safeParse = (_Err) => (schema2, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema2._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
function failure(Err, issues, ctx) {
  let error2;
  return {
    success: false,
    get error() {
      if (!error2) {
        error2 = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = void 0;
        ctx = void 0;
      }
      return error2;
    },
    set error(e) {
      error2 = e;
      issues = void 0;
      ctx = void 0;
    }
  };
}
const _safeParseAsync = (_Err) => async (schema2, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema2._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
const COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
const COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
const validate = ((schema2, value, _ctx) => {
  const validator = schema2._zod.bag.validator;
  if (validator !== void 0) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === void 0)
      return false;
  }
  return validateFallback(schema2, value, _ctx);
});
function validateFallback(schema2, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema2._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema2._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length === 0;
}
const validateAsync$1 = async (schema2, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema2._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
};
const _encode = (_Err) => {
  const parse2 = _parse(_Err);
  const fn = (schema2, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse2(schema2, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
const _decode = (_Err) => {
  const parse2 = _parse(_Err);
  const fn = (schema2, value, _ctx, _params) => {
    return parse2(schema2, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
const _encodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn = async (schema2, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync2(schema2, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
const _decodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn = async (schema2, value, _ctx, _params) => {
    return await parseAsync2(schema2, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
const _safeEncode = (_Err) => (schema2, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema2, value, ctx);
};
const _safeDecode = (_Err) => (schema2, value, _ctx) => {
  return _safeParse(_Err)(schema2, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema2, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema2, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema2, value, _ctx) => {
  return _safeParseAsync(_Err)(schema2, value, _ctx);
};
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
const duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
const email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
  return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function anchor(source) {
  return new RegExp(`^${source}$`);
}
const date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts = ["Z"];
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const anyString = /^[\s\S]{0,}$/;
const integer = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const boolean$1 = /^(?:true|false)$/i;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;
const $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a2;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a2 = inst._zod).onattach ?? (_a2.onattach = []);
});
const _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== void 0;
};
const numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
const $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? (
      // `value % 0n` throws, and nothing is a multiple of zero — the number branch already fails this way via NaN
      def.value !== BigInt(0) && payload.value % def.value === BigInt(0)
    ) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
const $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units > def.maximum ? codePointLength(input) : units;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a2, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a2 = inst._zod).check ?? (_a2.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
const $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});
class Doc {
  constructor(args = [], closed = {}) {
    this.content = [];
    this.indent = 0;
    this.args = args;
    this.closed = closed;
  }
  // the compiler catches a child's throw and keeps writing into this doc, so the indent has to unwind with it
  indented(fn) {
    this.indent += 1;
    try {
      fn(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const content = this?.content ?? [``];
    const factory = new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join("\n")}
};`);
    return factory(...Object.values(this.closed));
  }
}
const version = {
  major: 4,
  minor: 6,
  patch: 5
};
const $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a2;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
const toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {
      }
      return validateAsync(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
const $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
const $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
const $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
const $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
const $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
const URL_BAD_FORMAT = 1;
const URL_UNPARSEABLE = 2;
function canParseURL(input) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input);
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
const asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url2, hostname) {
  hostname.lastIndex = 0;
  return hostname.test(url2.hostname);
}
function urlProtocolOk(url2, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url2.protocol.endsWith(":") ? url2.protocol.slice(0, -1) : url2.protocol);
}
const $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url2 = validateURL(trimmed, def);
      if (url2 === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url2 === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url2 === true) {
        payload.value = stripTabAndNewline(trimmed);
        return;
      }
      if (def.hostname && !urlHostnameOk(url2, def.hostname)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      if (def.protocol && !urlProtocolOk(url2, def.protocol)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid protocol",
          pattern: def.protocol.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      payload.value = def.normalize ? url2.href : stripTabAndNewline(trimmed);
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
const $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1))
    throw new Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
  $ZodStringFormat.init(inst, def);
});
const $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
const $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
const $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
const $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
});
const ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
const $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
const $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
const $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
const base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
const $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
const $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
const $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number$1;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
const $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
const $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean$1;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
const $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
const $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
const $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
const NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
const $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, /* @__PURE__ */ new Set());
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== void 0)
          propValues[key].add(void 0);
      }
    }
    return propValues;
  });
  const isObject$1 = isObject;
  const catchall = def.catchall;
  let value;
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject$1(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
const $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const memo2 = globalConfig.memoizer;
  const generateFastpass = (shape) => {
    const normalized = _normalized.value;
    const syms = normalized.symbolKeys;
    const doc = new Doc(["payload", "ctx"], { shape, inst, memo: memo2, syms });
    const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.allKeys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(memo2 ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
    for (const key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      const id = ids[key];
      const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
      const isPresent = `${k} in input`;
      const schema2 = shape[key];
      const optin = schema2?._zod?.optin;
      const isOptionalIn = optin !== void 0;
      const isOptionalOut = schema2?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(k)};`);
      if (isOptionalIn && isOptionalOut) {
        const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
        doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
        if (optin === "defaulted") {
          doc.write(`newResult[${k}] = ${id}.value;`);
        } else {
          doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
        }
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    return doc.compile();
  };
  let fastpass;
  const isObject$1 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval$1 = allowsEval;
  const fastEnabled = jit && allowsEval$1.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject$1(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
const $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
const $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  const keyIssues = /* @__PURE__ */ new Map();
  const collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys = [k];
    } else {
      return false;
    }
    for (const k of keys) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k of bothKeys) {
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
const $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values && !def.partial) {
      payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
      const recordKeys = /* @__PURE__ */ new Set();
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          if (key === "__proto__")
            continue;
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          if (outKey === "__proto__")
            continue;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[outKey] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          if (def.mode === "loose") {
            if (key === "__proto__")
              continue;
            payload.value[key] = input[key];
          } else {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          }
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    } else {
      payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
      let unrecognized;
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number$1.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else if (values) {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const outKey = keyResult.value;
        if (outKey === "__proto__")
          continue;
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[outKey] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[outKey] = result.value;
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
const $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
const $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const values = new Set(def.values);
  inst._zod.values = values;
  defineLazyInternal(inst, "pattern", (zod) => {
    const vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
const $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? void 0 : result.value;
  return payload;
}
const $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result2) => handleOptionalResult(payload, result2));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
const $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => {
    const v = zod.def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
const $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleCatchResult(payload, result2, def, ctx));
    }
    return handleCatchResult(payload, result, def, ctx);
  };
});
const $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
const $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
const $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
class $ZodCyclicError extends Error {
  constructor() {
    super(`Cannot parse a reference cycle that closes through a transform`);
    this.name = "ZodCyclicError";
  }
}
const STATE = "~memo";
const NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
const recursive = /* @__PURE__ */ new WeakMap();
const NONE = 0;
const ASSUMED = 1;
const PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  const cached2 = recursive.get(inst);
  if (cached2 !== void 0)
    return cached2 ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (!desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge2 = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge2(raw ? shape(raw) : ASSUMED);
      check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType);
      check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left);
      check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in);
      check(def.out);
      break;
    case "function":
      check(def.input);
      check(def.output);
      break;
    // `$ZodLazy` caches its inner on the def, so a resolved edge is followed exactly
    case "lazy": {
      const inner = def._cachedInner ?? void 0;
      merge2(inner ? isRecursive(inner, stack) : ASSUMED);
      break;
    }
    // a leaf by choice: `parts` are regex fragments, not data positions
    case "template_literal":
    // leaves
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (const el of value)
            check(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = /* @__PURE__ */ new WeakMap();
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
let handoff;
const open = [];
const memo = {
  alloc(_inst, payload, empty) {
    const bucket = handoff;
    if (!bucket)
      return empty;
    handoff = void 0;
    const entry = { value: empty, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty;
  },
  guard(inst) {
    var _a2;
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError();
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a2;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === void 0) {
          const walked = isRecursive(inst, /* @__PURE__ */ new Set());
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state) {
          state = { buckets: /* @__PURE__ */ new WeakMap(), backEdges: void 0 };
          ctx[STATE] = state;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
            state.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = void 0;
        const entry = open.length > depth ? open.pop() : void 0;
        if (result instanceof Promise) {
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}
const error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    // Compatibility: "nan" -> "NaN" for display
    nan: "NaN"
    // All other type names omitted - they fall back to raw values via ?? operator
  };
  function getTypeName(type, input) {
    if (type === "number" && typeof input === "number" && !Number.isFinite(input)) {
      return String(input);
    }
    return TypeDictionary[type] ?? type;
  }
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = getTypeName(issue2.expected);
        const receivedType = parsedType(issue2.input);
        const received = getTypeName(receivedType, issue2.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        if (issue2.options && Array.isArray(issue2.options) && issue2.options.length > 0) {
          const opts = issue2.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        if (issue2.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en() {
  return {
    localeError: error()
  };
}
var _a;
class $ZodRegistry {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema2, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema2, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema2);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema2) {
    const meta = this._map.get(schema2);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema2);
    return this;
  }
  get(schema2) {
    const p = schema2._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema2) };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema2);
  }
  has(schema2) {
    return this._map.has(schema2);
  }
}
function registry() {
  return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
  return new Class(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
  return new Class(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
  const schema2 = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema2;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue$1) => {
      if (typeof issue$1 === "string") {
        payload.issues.push(issue(issue$1, payload.value, ch._zod.def));
      } else {
        const _issue = issue$1;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    sharedDefsExtractedFor: void 0,
    sharedEmitDoneFor: void 0,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? void 0
  };
}
function handleUnrepresentable(schema2, ctx, json, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema2, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === void 0 || result === "throw")
    throw new Error(message);
  Object.assign(json, result);
  return true;
}
function processSchema(schema2, ctx, _params = { path: [], schemaPath: [] }) {
  var _a2;
  const def = schema2._zod.def;
  const seen = ctx.seen.get(schema2);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema2);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema2, result);
  ctx.sharedDefsExtractedFor = void 0;
  ctx.sharedEmitDoneFor = void 0;
  const overrideSchema = schema2._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema2],
      path: _params.path
    };
    if (schema2._zod.processJSONSchema) {
      schema2._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema2, ctx, _json, params);
    }
    const parent = schema2._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema2);
  if (meta)
    assignProps(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema2)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a2 = result.schema).default ?? (_a2.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema2);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema2) {
  const root = ctx.seen.get(schema2);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema3 = seen.schema;
    for (const key in schema3) {
      delete schema3[key];
    }
    schema3.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema2 === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema2 !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema2) {
  const options = schema2.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema2.type !== void 0)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema2.anyOf;
  schema2.type = types.length === 1 ? types[0] : types;
}
const FOLDABLE_KEYS = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties"]);
const UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members2) {
  const objects = [];
  for (const member of members2) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required2 = /* @__PURE__ */ new Set();
  for (const object2 of objects) {
    for (const key in object2.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === void 0)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object2.required ?? [])
      required2.add(key);
  }
  const folded = { type: "object", properties };
  if (required2.size)
    folded.required = [...required2];
  if (objects.every((object2) => object2.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object2 of objects) {
      const constraint = undeclaredConstraint(object2);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  const allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union2 = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union2[k]));
    if (Object.keys(union2).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union2);
    const branches = union2[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf;
  assignProps(json, folded);
}
function finalize(ctx, schema2) {
  const root = ctx.seen.get(schema2);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema3 = seen.def ?? seen.schema;
    const _cached = { ...schema3 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema3.allOf = schema3.allOf ?? [];
        schema3.allOf.push(refSchema);
      } else {
        assignProps(schema3, refSchema);
      }
      assignProps(schema3, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema3) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema3[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema3) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema3[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema3[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema3.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema3) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema3[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema3[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema3,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = /* @__PURE__ */ new Map();
      for (const seen of ctx.seen.values()) {
        for (const json of [seen.schema, seen.def]) {
          const allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json of carriers.get(allOf) ?? [])
          foldIntersection(json);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") ;
  else ;
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema2)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema2)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) ;
  else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema2["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema2, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema2, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
const createToJSONSchemaMethod = (schema2, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  processSchema(schema2, ctx);
  extractDefs(ctx, schema2);
  return finalize(ctx, schema2);
};
const createStandardJSONSchemaMethod = (schema2, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema2, ctx);
  extractDefs(ctx, schema2);
  return finalize(ctx, schema2);
};
const narrowMin = (agg, key, value) => {
  if (agg[key] === void 0 || value > agg[key])
    agg[key] = value;
};
const narrowMax = (agg, key, value) => {
  if (agg[key] === void 0 || value < agg[key])
    agg[key] = value;
};
const narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
const addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
const addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
  agg.patterns.add(pattern);
};
const intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
const setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
const minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
const maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
const formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
const contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema2) {
  const agg = {};
  const def = schema2._zod.def;
  const list = schema2._zod.traits.has("$ZodCheck") ? [schema2, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema2._zod.bag;
  if (bag.minimum !== void 0)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== void 0)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== void 0)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== void 0)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== void 0)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== void 0) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
const formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
const exactPatterns = /* @__PURE__ */ new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
const exactPattern = (p) => exactPatterns.get(p) ?? p;
const stringProcessor = (schema2, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema2);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time" || laxFormat) {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
const numberProcessor = (schema2, ctx, _json, params) => {
  const json = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema2);
  json.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = /* @__PURE__ */ new Set();
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema2, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== void 0)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
const booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
const neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
const unknownProcessor = (_schema, _ctx, _json, _params) => {
};
const enumProcessor = (schema2, _ctx, json, _params) => {
  const def = schema2._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
const literalProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  if (def.values.length === 0) {
    json.not = {};
    return;
  }
  const vals = [];
  for (const val of def.values) {
    if (val === void 0) {
      if (handleUnrepresentable(schema2, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof val === "bigint") {
      if (handleUnrepresentable(schema2, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
        return;
      vals.push(Number(val));
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) ;
  else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
const customProcessor = (schema2, ctx, json, params) => {
  handleUnrepresentable(schema2, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
const transformProcessor = (schema2, ctx, json, params) => {
  handleUnrepresentable(schema2, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
const arrayProcessor = (schema2, ctx, _json, params) => {
  const json = _json;
  const def = schema2._zod.def;
  const { minimum, maximum } = aggregateChecks(schema2);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema2) {
  const def = schema2._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema2._zod.optin;
}
const objectProcessor = (schema2, ctx, _json, params) => {
  const json = _json;
  const def = schema2._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema2, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json.type = "object";
  json.properties = {};
  for (const key in shape) {
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
const unionProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
const intersectionProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
  ctx.intersections.push(allOf);
};
function stringifyKeyNames(bySchema, json, visited) {
  if (json.$ref) {
    if (visited.has(json))
      return json;
    visited.add(json);
    const def = bySchema.get(json)?.def;
    if (!def)
      return json;
    const inlined = stringifyKeyNames(bySchema, def, visited);
    return inlined === def ? json : inlined;
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches = json[keyword];
    if (!Array.isArray(branches))
      continue;
    const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
    if (mapped.some((branch, i) => branch !== branches[i]))
      json = { ...json, [keyword]: mapped };
  }
  const types = Array.isArray(json.type) ? json.type : [json.type];
  const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
  const values = json.enum ?? (json.const !== void 0 ? [json.const] : void 0);
  if (!numericType && !values?.some((v) => typeof v === "number"))
    return json;
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json;
  if (rest.enum)
    rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
  else if (typeof rest.const === "number")
    rest.const = String(rest.const);
  if (!numericType)
    return rest;
  rest.type = "string";
  if (!values)
    rest.pattern = (types.includes("number") ? number$1 : integer).source;
  return rest;
}
const pendingRecords = /* @__PURE__ */ new WeakMap();
function rewriteKeyNames(ctx) {
  const bySchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.values()) {
    if (entry.def && !bySchema.has(entry.schema))
      bySchema.set(entry.schema, entry);
  }
  const rewrites = /* @__PURE__ */ new Map();
  for (const record2 of pendingRecords.get(ctx) ?? []) {
    const seen = ctx.seen.get(record2);
    const names = (seen?.def ?? seen?.schema)?.propertyNames;
    if (!names || names === true || rewrites.has(names))
      continue;
    const rewritten = stringifyKeyNames(bySchema, names, /* @__PURE__ */ new Set());
    if (rewritten !== names)
      rewrites.set(names, rewritten);
  }
  if (!rewrites.size)
    return;
  for (const entry of ctx.seen.values()) {
    for (const carrier of [entry.schema, entry.def]) {
      const rewritten = carrier && rewrites.get(carrier.propertyNames);
      if (rewritten)
        carrier.propertyNames = rewritten;
    }
  }
}
const recordProcessor = (schema2, ctx, _json, params) => {
  const json = _json;
  const def = schema2._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const patterns = aggregateChecks(keyType).patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = processSchema(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
      let pending = pendingRecords.get(ctx);
      if (!pending) {
        pending = [];
        pendingRecords.set(ctx, pending);
        ctx.deferred.push(() => rewriteKeyNames(ctx));
      }
      pending.push(schema2);
    }
    json.additionalProperties = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
  if (keyValues && !def.partial && !omittableOnInput) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues.map(String);
    }
  }
};
const nullableProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
const nonoptionalProcessor = (schema2, ctx, _json, params) => {
  const def = schema2._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
};
const UNREPRESENTABLE_DEFAULT = /* @__PURE__ */ Symbol();
function serializeDefaultValue(value, schema2, ctx, json, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema2, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
const defaultProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema2, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
};
const prefaultProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema2, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
};
const catchProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    handleUnrepresentable(schema2, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
};
const pipeProcessor = (schema2, ctx, _json, params) => {
  const def = schema2._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = innerType;
};
const readonlyProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
  json.readOnly = true;
};
const optionalProcessor = (schema2, ctx, _json, params) => {
  const def = schema2._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
};
const _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
const initializer = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue2) => {
    self.issues.push(issue2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues2) => {
    self.issues.push(...issues2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
const ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer, void 0, {
  Parent: Error
});
const parse = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
const ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  _ensureDefaultLocale();
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  return inst;
}, {
  check(...chks) {
    const def = this.def;
    return this.clone(mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: true });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta) {
    reg.add(this, meta);
    return this;
  },
  refine(check, params) {
    return this.check(refine(check, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn) {
    return this.check(/* @__PURE__ */ _overwrite(fn));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe(this, transform(tx));
  },
  default(d) {
    return _default(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    const cl = this.clone();
    globalRegistry.add(cl, { description });
    return cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    const cl = this.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  },
  // Overrides core's `~standard` to add `jsonSchema`. Must stay a prototype entry: redefining it per instance demotes instances to dictionary mode.
  get "~standard"() {
    return hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  },
  parse: function _parse2(data, params) {
    return parse(this, data, params, { callee: _parse2 });
  },
  parseAsync: async function _parseAsync2(data, params) {
    return await parseAsync(this, data, params, { callee: _parseAsync2 });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  // `spa` is an alias: same function object as `safeParseAsync`, as before.
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    own(this, "spa", value);
  },
  validate(data, params) {
    return validate(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync$1(this, data, params);
  },
  encode: function _encode2(data, params) {
    return encode(this, data, params, { callee: _encode2 });
  },
  decode: function _decode2(data, params) {
    return decode(this, data, params, { callee: _decode2 });
  },
  encodeAsync: async function _encodeAsync2(data, params) {
    return await encodeAsync(this, data, params, { callee: _encodeAsync2 });
  },
  decodeAsync: async function _decodeAsync2(data, params) {
    return await decodeAsync(this, data, params, { callee: _decodeAsync2 });
  },
  safeEncode(data, params) {
    return safeEncode(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  // Reads through to the registry on every access, so it must not cache.
  get description() {
    return globalRegistry.get(this)?.description;
  },
  // No setter: `schema._def = x` throws, as it did when `_def` was a non-writable own property.
  get _def() {
    return this._zod.def;
  }
});
const _ZodString = /* @__PURE__ */ $constructor(
  "_ZodString",
  (inst, def) => {
    $ZodString.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json);
  },
  /* @__PURE__ */ derived({
    format: (inst) => aggregateChecks(inst).format ?? null,
    minLength: (inst) => aggregateChecks(inst).minimum ?? null,
    maxLength: (inst) => aggregateChecks(inst).maximum ?? null
  }, {
    regex(...args) {
      return this.check(/* @__PURE__ */ _regex(...args));
    },
    includes(...args) {
      return this.check(/* @__PURE__ */ _includes(...args));
    },
    startsWith(...args) {
      return this.check(/* @__PURE__ */ _startsWith(...args));
    },
    endsWith(...args) {
      return this.check(/* @__PURE__ */ _endsWith(...args));
    },
    min(...args) {
      return this.check(/* @__PURE__ */ _minLength(...args));
    },
    max(...args) {
      return this.check(/* @__PURE__ */ _maxLength(...args));
    },
    length(...args) {
      return this.check(/* @__PURE__ */ _length(...args));
    },
    nonempty(...args) {
      return this.check(/* @__PURE__ */ _minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(/* @__PURE__ */ _lowercase(params));
    },
    uppercase(params) {
      return this.check(/* @__PURE__ */ _uppercase(params));
    },
    trim() {
      return this.check(/* @__PURE__ */ _trim());
    },
    normalize(...args) {
      return this.check(/* @__PURE__ */ _normalize(...args));
    },
    toLowerCase() {
      return this.check(/* @__PURE__ */ _toLowerCase());
    },
    toUpperCase() {
      return this.check(/* @__PURE__ */ _toUpperCase());
    },
    slugify() {
      return this.check(/* @__PURE__ */ _slugify());
    }
  })
);
const ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(/* @__PURE__ */ _email(ZodEmail, params));
  },
  url(params) {
    return this.check(/* @__PURE__ */ _url(ZodURL, params));
  },
  jwt(params) {
    return this.check(/* @__PURE__ */ _jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
  },
  guid(params) {
    return this.check(/* @__PURE__ */ _guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(/* @__PURE__ */ _uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(/* @__PURE__ */ _cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(/* @__PURE__ */ _ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(/* @__PURE__ */ _base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(/* @__PURE__ */ _xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(/* @__PURE__ */ _e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(/* @__PURE__ */ _isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(/* @__PURE__ */ _isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(/* @__PURE__ */ _isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(/* @__PURE__ */ _isoDuration(ZodISODuration, params));
  }
});
function string(params) {
  return /* @__PURE__ */ _string(ZodString, params);
}
const ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
const ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function url(params) {
  return /* @__PURE__ */ _url(ZodURL, params);
}
const ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodNumber = /* @__PURE__ */ $constructor(
  "ZodNumber",
  (inst, def) => {
    $ZodNumber.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
    inst.isFinite = true;
  },
  /* @__PURE__ */ derived({
    minValue: (inst) => {
      const { minimum, exclusiveMinimum } = aggregateChecks(inst);
      return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
    },
    maxValue: (inst) => {
      const { maximum, exclusiveMaximum } = aggregateChecks(inst);
      return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
    },
    isInt: (inst) => {
      const { isInt, multipleOf } = aggregateChecks(inst);
      return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
    },
    format: (inst) => aggregateChecks(inst).format ?? null
  }, {
    gt(value, params) {
      return this.check(/* @__PURE__ */ _gt(value, params));
    },
    gte(value, params) {
      return this.check(/* @__PURE__ */ _gte(value, params));
    },
    min(value, params) {
      return this.check(/* @__PURE__ */ _gte(value, params));
    },
    lt(value, params) {
      return this.check(/* @__PURE__ */ _lt(value, params));
    },
    lte(value, params) {
      return this.check(/* @__PURE__ */ _lte(value, params));
    },
    max(value, params) {
      return this.check(/* @__PURE__ */ _lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(/* @__PURE__ */ _gt(0, params));
    },
    nonnegative(params) {
      return this.check(/* @__PURE__ */ _gte(0, params));
    },
    negative(params) {
      return this.check(/* @__PURE__ */ _lt(0, params));
    },
    nonpositive(params) {
      return this.check(/* @__PURE__ */ _lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(/* @__PURE__ */ _multipleOf(value, params));
    },
    step(value, params) {
      return this.check(/* @__PURE__ */ _multipleOf(value, params));
    },
    finite() {
      return this;
    }
  })
);
function number(params) {
  return /* @__PURE__ */ _number(ZodNumber, params);
}
const ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
const ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json);
});
function boolean(params) {
  return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
const ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor();
});
function unknown() {
  return /* @__PURE__ */ _unknown(ZodUnknown);
}
const ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json);
});
function never(params) {
  return /* @__PURE__ */ _never(ZodNever, params);
}
const ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
}, {
  min(n, params) {
    return this.check(/* @__PURE__ */ _minLength(n, params));
  },
  nonempty(params) {
    return this.check(/* @__PURE__ */ _minLength(1, params));
  },
  max(n, params) {
    return this.check(/* @__PURE__ */ _maxLength(n, params));
  },
  length(n, params) {
    return this.check(/* @__PURE__ */ _length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return /* @__PURE__ */ _array(ZodArray, element, params);
}
const ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(mergeDefs(this._zod.def, { catchall: void 0 }));
  },
  extend(incoming) {
    return extend(this, incoming);
  },
  safeExtend(incoming) {
    return safeExtend(this, incoming);
  },
  merge(other) {
    return merge(this, other);
  },
  pick(mask) {
    return pick(this, mask);
  },
  omit(mask) {
    return omit(this, mask);
  },
  partial(...args) {
    return partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return required(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
const ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
const ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
const ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
const ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json);
  inst.enum = def.entries;
  inst.options = [...inst._zod.values];
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
const ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
const ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue$1) => {
      if (typeof issue$1 === "string") {
        payload.issues.push(issue(issue$1, payload.value, def));
      } else {
        const _issue = issue$1;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
const ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
const ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
const ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
const ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
const ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
const ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
const ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
  });
}
const ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
const ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
const ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return /* @__PURE__ */ _superRefine(fn, params);
}
const skippedItem = /* @__PURE__ */ Symbol("skippedItem");
function defaultOnError(schema2, fallback) {
  return schema2.catch(fallback);
}
function requiredDefaultOnError(schema2, fallback) {
  const schemaWithCatch = schema2.catch(fallback);
  return unknown().transform((value, context) => {
    if (value !== void 0)
      return schemaWithCatch.parse(value);
    context.addIssue({
      code: "custom",
      message: "Required value is missing"
    });
    return NEVER;
  });
}
function stringTag(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  const tag = value[key];
  return typeof tag === "string" ? tag : void 0;
}
function excludeKnownTags(schema2, key, knownTags) {
  return schema2.superRefine((value, context) => {
    const tag = stringTag(value, key);
    if (tag !== void 0 && knownTags.includes(tag)) {
      context.addIssue({
        code: "custom",
        path: [key],
        message: `${key} ${JSON.stringify(tag)} is reserved by a known variant, but the value does not match that variant's schema`
      });
    }
  });
}
function preserveCustomPayload(schema2, key, knownTags) {
  return unknown().transform((value, context) => {
    const result = schema2.safeParse(value);
    if (!result.success) {
      for (const issue2 of result.error.issues) {
        context.addIssue({ ...issue2, input: value });
      }
      return NEVER;
    }
    const output = result.data;
    const tag = stringTag(value, key);
    if (tag !== void 0 && !knownTags.includes(tag)) {
      const raw = value;
      for (const [property, rawValue] of Object.entries(raw)) {
        if (property === "__proto__")
          continue;
        if (!Object.hasOwn(output, property))
          output[property] = rawValue;
      }
    }
    return output;
  });
}
function vecSkipError(itemSchema) {
  return array(itemSchema.catch(skippedItem)).transform((items) => items.filter((item) => item !== skippedItem));
}
const zRequestId = union([number(), string()]).nullable();
const zSessionId = string();
const zWriteTextFileRequest = object({
  sessionId: zSessionId,
  path: string(),
  content: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zReadTextFileRequest = object({
  sessionId: zSessionId,
  path: string(),
  line: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  limit: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zToolCallId = string();
const zToolKind = union([
  literal("read"),
  literal("edit"),
  literal("delete"),
  literal("move"),
  literal("search"),
  literal("execute"),
  literal("think"),
  literal("fetch"),
  literal("switch_mode"),
  literal("other")
]);
const zToolCallStatus = union([
  literal("pending"),
  literal("in_progress"),
  literal("completed"),
  literal("failed")
]);
const zRole = union([literal("assistant"), literal("user")]);
const zAnnotations = object({
  audience: defaultOnError(vecSkipError(zRole).nullish(), () => void 0),
  lastModified: defaultOnError(string().nullish(), () => void 0),
  priority: defaultOnError(number().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zTextContent = object({
  annotations: defaultOnError(zAnnotations.nullish(), () => void 0),
  text: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zImageContent = object({
  annotations: defaultOnError(zAnnotations.nullish(), () => void 0),
  data: string(),
  mimeType: string(),
  uri: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAudioContent = object({
  annotations: defaultOnError(zAnnotations.nullish(), () => void 0),
  data: string(),
  mimeType: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zResourceLink = object({
  annotations: defaultOnError(zAnnotations.nullish(), () => void 0),
  description: defaultOnError(string().nullish(), () => void 0),
  mimeType: defaultOnError(string().nullish(), () => void 0),
  name: string(),
  size: defaultOnError(number().nullish(), () => void 0),
  title: defaultOnError(string().nullish(), () => void 0),
  uri: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zTextResourceContents = object({
  mimeType: defaultOnError(string().nullish(), () => void 0),
  text: string(),
  uri: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zBlobResourceContents = object({
  blob: string(),
  mimeType: defaultOnError(string().nullish(), () => void 0),
  uri: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zEmbeddedResourceResource = union([
  zTextResourceContents,
  zBlobResourceContents
]);
const zEmbeddedResource = object({
  annotations: defaultOnError(zAnnotations.nullish(), () => void 0),
  resource: zEmbeddedResourceResource,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zContentBlock = union([
  zTextContent.and(object({
    type: literal("text")
  })),
  zImageContent.and(object({
    type: literal("image")
  })),
  zAudioContent.and(object({
    type: literal("audio")
  })),
  zResourceLink.and(object({
    type: literal("resource_link")
  })),
  zEmbeddedResource.and(object({
    type: literal("resource")
  }))
]);
const zContent = object({
  content: zContentBlock,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDiff = object({
  path: string(),
  oldText: defaultOnError(string().nullish(), () => void 0),
  newText: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zTerminalId = string();
const zTerminal = object({
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zToolCallContent = union([
  zContent.and(object({
    type: literal("content")
  })),
  zDiff.and(object({
    type: literal("diff")
  })),
  zTerminal.and(object({
    type: literal("terminal")
  }))
]);
const zToolCallLocation = object({
  path: string(),
  line: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zToolCallUpdate = object({
  toolCallId: zToolCallId,
  kind: defaultOnError(zToolKind.nullish(), () => void 0),
  status: defaultOnError(zToolCallStatus.nullish(), () => void 0),
  title: defaultOnError(string().nullish(), () => void 0),
  name: defaultOnError(string().nullish(), () => void 0),
  content: defaultOnError(vecSkipError(zToolCallContent).nullish(), () => void 0),
  locations: defaultOnError(vecSkipError(zToolCallLocation).nullish(), () => void 0),
  rawInput: defaultOnError(unknown().optional(), () => void 0),
  rawOutput: defaultOnError(unknown().optional(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPermissionOptionId = string();
const zPermissionOptionKind = union([
  literal("allow_once"),
  literal("allow_always"),
  literal("reject_once"),
  literal("reject_always")
]);
const zPermissionOption = object({
  optionId: zPermissionOptionId,
  name: string(),
  kind: zPermissionOptionKind,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zRequestPermissionRequest = object({
  sessionId: zSessionId,
  toolCall: zToolCallUpdate,
  options: array(zPermissionOption),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zEnvVariable = object({
  name: string(),
  value: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCreateTerminalRequest = object({
  sessionId: zSessionId,
  command: string(),
  args: defaultOnError(vecSkipError(string()).optional(), () => []),
  env: defaultOnError(vecSkipError(zEnvVariable).optional(), () => []),
  cwd: defaultOnError(string().nullish(), () => void 0),
  outputByteLimit: defaultOnError(number().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zTerminalOutputRequest = object({
  sessionId: zSessionId,
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zReleaseTerminalRequest = object({
  sessionId: zSessionId,
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zWaitForTerminalExitRequest = object({
  sessionId: zSessionId,
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zKillTerminalRequest = object({
  sessionId: zSessionId,
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zElicitationSessionScope = object({
  sessionId: zSessionId,
  toolCallId: defaultOnError(zToolCallId.nullish(), () => void 0)
});
const zElicitationRequestScope = object({
  requestId: zRequestId
});
const zElicitationSchemaType = literal("object");
const zStringFormat = union([
  literal("email"),
  literal("uri"),
  literal("date"),
  literal("date-time")
]);
const zEnumOption = object({
  const: string(),
  title: string(),
  description: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zStringPropertySchema = object({
  title: defaultOnError(string().nullish(), () => void 0),
  description: defaultOnError(string().nullish(), () => void 0),
  minLength: int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(),
  maxLength: int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(),
  pattern: string().nullish(),
  format: zStringFormat.nullish(),
  default: defaultOnError(string().nullish(), () => void 0),
  enum: array(string()).nullish(),
  oneOf: array(zEnumOption).nullish(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNumberPropertySchema = object({
  title: defaultOnError(string().nullish(), () => void 0),
  description: defaultOnError(string().nullish(), () => void 0),
  minimum: number().nullish(),
  maximum: number().nullish(),
  default: defaultOnError(number().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zIntegerPropertySchema = object({
  title: defaultOnError(string().nullish(), () => void 0),
  description: defaultOnError(string().nullish(), () => void 0),
  minimum: number().nullish(),
  maximum: number().nullish(),
  default: defaultOnError(number().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zBooleanPropertySchema = object({
  title: defaultOnError(string().nullish(), () => void 0),
  description: defaultOnError(string().nullish(), () => void 0),
  default: defaultOnError(boolean().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zStringMultiSelectItems = object({
  enum: array(string()),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zTitledMultiSelectItems = object({
  anyOf: array(zEnumOption),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zMultiSelectItems = preserveCustomPayload(union([
  zStringMultiSelectItems.and(object({
    type: literal("string")
  })),
  excludeKnownTags(object({
    type: string()
  }), "type", ["string"]),
  zTitledMultiSelectItems
]), "type", ["string"]);
const zMultiSelectPropertySchema = object({
  title: defaultOnError(string().nullish(), () => void 0),
  description: defaultOnError(string().nullish(), () => void 0),
  minItems: number().nullish(),
  maxItems: number().nullish(),
  items: zMultiSelectItems,
  default: defaultOnError(vecSkipError(string()).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zElicitationPropertySchema = preserveCustomPayload(union([
  zStringPropertySchema.and(object({
    type: literal("string")
  })),
  zNumberPropertySchema.and(object({
    type: literal("number")
  })),
  zIntegerPropertySchema.and(object({
    type: literal("integer")
  })),
  zBooleanPropertySchema.and(object({
    type: literal("boolean")
  })),
  zMultiSelectPropertySchema.and(object({
    type: literal("array")
  })),
  excludeKnownTags(object({
    type: string()
  }), "type", ["array", "boolean", "integer", "number", "string"])
]), "type", ["array", "boolean", "integer", "number", "string"]);
const zElicitationSchema = object({
  type: defaultOnError(zElicitationSchemaType.optional().default("object"), () => "object"),
  title: defaultOnError(string().nullish(), () => void 0),
  properties: record(string(), zElicitationPropertySchema).optional().default({}),
  required: array(string()).nullish(),
  description: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zElicitationFormMode = intersection(union([zElicitationSessionScope, zElicitationRequestScope]), object({
  requestedSchema: zElicitationSchema
}));
const zElicitationId = string();
const zElicitationUrlMode = intersection(union([zElicitationSessionScope, zElicitationRequestScope]), object({
  elicitationId: zElicitationId,
  url: url()
}));
const zCreateElicitationRequest = preserveCustomPayload(intersection(union([
  zElicitationFormMode.and(object({
    mode: literal("form")
  })),
  zElicitationUrlMode.and(object({
    mode: literal("url")
  })),
  excludeKnownTags(intersection(union([zElicitationSessionScope, zElicitationRequestScope]), object({
    mode: string()
  })), "mode", ["form", "url"])
]), object({
  message: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
})), "mode", ["form", "url"]);
const zMcpServerAcpId = string();
const zConnectMcpRequest = object({
  serverId: zMcpServerAcpId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zMcpConnectionId = string();
const zMessageMcpRequest = object({
  connectionId: zMcpConnectionId,
  method: string(),
  params: record(string(), unknown()).nullish(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDisconnectMcpRequest = object({
  connectionId: zMcpConnectionId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zExtRequest = unknown();
object({
  id: zRequestId,
  method: string(),
  params: union([
    zWriteTextFileRequest,
    zReadTextFileRequest,
    zRequestPermissionRequest,
    zCreateTerminalRequest,
    zTerminalOutputRequest,
    zReleaseTerminalRequest,
    zWaitForTerminalExitRequest,
    zKillTerminalRequest,
    zCreateElicitationRequest,
    zConnectMcpRequest,
    zMessageMcpRequest,
    zDisconnectMcpRequest,
    zExtRequest
  ]).nullish()
});
const zProtocolVersion = int().gte(0).lte(65535);
const zPromptCapabilities = object({
  image: defaultOnError(boolean().optional().default(false), () => false),
  audio: defaultOnError(boolean().optional().default(false), () => false),
  embeddedContext: defaultOnError(boolean().optional().default(false), () => false),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zMcpCapabilities = object({
  http: defaultOnError(boolean().optional().default(false), () => false),
  sse: defaultOnError(boolean().optional().default(false), () => false),
  acp: defaultOnError(boolean().optional().default(false), () => false),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionListCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionDeleteCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionAdditionalDirectoriesCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionForkCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionResumeCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionCloseCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionCapabilities = object({
  list: defaultOnError(zSessionListCapabilities.nullish(), () => void 0),
  delete: defaultOnError(zSessionDeleteCapabilities.nullish(), () => void 0),
  additionalDirectories: defaultOnError(zSessionAdditionalDirectoriesCapabilities.nullish(), () => void 0),
  fork: defaultOnError(zSessionForkCapabilities.nullish(), () => void 0),
  resume: defaultOnError(zSessionResumeCapabilities.nullish(), () => void 0),
  close: defaultOnError(zSessionCloseCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zLogoutCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAgentAuthCapabilities = object({
  logout: defaultOnError(zLogoutCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zProvidersCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesDocumentDidOpenCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zTextDocumentSyncKind = union([
  literal("full"),
  literal("incremental")
]);
const zNesDocumentDidChangeCapabilities = object({
  syncKind: zTextDocumentSyncKind,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesDocumentDidCloseCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesDocumentDidSaveCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesDocumentDidFocusCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesDocumentEventCapabilities = object({
  didOpen: defaultOnError(zNesDocumentDidOpenCapabilities.nullish(), () => void 0),
  didChange: defaultOnError(zNesDocumentDidChangeCapabilities.nullish(), () => void 0),
  didClose: defaultOnError(zNesDocumentDidCloseCapabilities.nullish(), () => void 0),
  didSave: defaultOnError(zNesDocumentDidSaveCapabilities.nullish(), () => void 0),
  didFocus: defaultOnError(zNesDocumentDidFocusCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesEventCapabilities = object({
  document: defaultOnError(zNesDocumentEventCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesRecentFilesCapabilities = object({
  maxCount: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesRelatedSnippetsCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesEditHistoryCapabilities = object({
  maxCount: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesUserActionsCapabilities = object({
  maxCount: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesOpenFilesCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesDiagnosticsCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesContextCapabilities = object({
  recentFiles: defaultOnError(zNesRecentFilesCapabilities.nullish(), () => void 0),
  relatedSnippets: defaultOnError(zNesRelatedSnippetsCapabilities.nullish(), () => void 0),
  editHistory: defaultOnError(zNesEditHistoryCapabilities.nullish(), () => void 0),
  userActions: defaultOnError(zNesUserActionsCapabilities.nullish(), () => void 0),
  openFiles: defaultOnError(zNesOpenFilesCapabilities.nullish(), () => void 0),
  diagnostics: defaultOnError(zNesDiagnosticsCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesCapabilities = object({
  events: defaultOnError(zNesEventCapabilities.nullish(), () => void 0),
  context: defaultOnError(zNesContextCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPositionEncodingKind = union([
  literal("utf-16"),
  literal("utf-32"),
  literal("utf-8")
]);
const zAgentCapabilities = object({
  loadSession: defaultOnError(boolean().optional().default(false), () => false),
  promptCapabilities: defaultOnError(zPromptCapabilities.optional().default({
    image: false,
    audio: false,
    embeddedContext: false
  }), () => ({
    image: false,
    audio: false,
    embeddedContext: false
  })),
  mcpCapabilities: defaultOnError(zMcpCapabilities.optional().default({
    http: false,
    sse: false,
    acp: false
  }), () => ({
    http: false,
    sse: false,
    acp: false
  })),
  sessionCapabilities: defaultOnError(zSessionCapabilities.optional().default({}), () => ({})),
  auth: defaultOnError(zAgentAuthCapabilities.optional().default({}), () => ({})),
  providers: defaultOnError(zProvidersCapabilities.nullish(), () => void 0),
  nes: defaultOnError(zNesCapabilities.nullish(), () => void 0),
  positionEncoding: defaultOnError(zPositionEncodingKind.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAuthMethodId = string();
const zAuthMethodTerminal = object({
  id: zAuthMethodId,
  name: string(),
  description: defaultOnError(string().nullish(), () => void 0),
  args: defaultOnError(vecSkipError(string()).optional(), () => []),
  env: defaultOnError(record(string(), string()).optional(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAuthMethodAgent = object({
  id: zAuthMethodId,
  name: string(),
  description: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAuthMethod = union([
  zAuthMethodTerminal.and(object({
    type: literal("terminal")
  })),
  zAuthMethodAgent
]);
const zImplementation = object({
  name: string(),
  title: defaultOnError(string().nullish(), () => void 0),
  version: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zInitializeResponse = object({
  protocolVersion: zProtocolVersion,
  agentCapabilities: defaultOnError(zAgentCapabilities.optional().default({
    loadSession: false,
    promptCapabilities: {
      image: false,
      audio: false,
      embeddedContext: false
    },
    mcpCapabilities: {
      http: false,
      sse: false,
      acp: false
    },
    sessionCapabilities: {},
    auth: {}
  }), () => ({
    loadSession: false,
    promptCapabilities: {
      image: false,
      audio: false,
      embeddedContext: false
    },
    mcpCapabilities: {
      http: false,
      sse: false,
      acp: false
    },
    sessionCapabilities: {},
    auth: {}
  })),
  authMethods: defaultOnError(vecSkipError(zAuthMethod).optional().default([]), () => []),
  agentInfo: defaultOnError(zImplementation.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAuthenticateResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zProviderId = string();
const zLlmProtocol = union([
  literal("anthropic"),
  literal("openai"),
  literal("azure"),
  literal("vertex"),
  literal("bedrock"),
  string()
]);
const zProviderCurrentConfig = object({
  apiType: zLlmProtocol,
  baseUrl: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zProviderInfo = object({
  providerId: zProviderId,
  supported: requiredDefaultOnError(vecSkipError(zLlmProtocol), () => []),
  required: boolean(),
  current: zProviderCurrentConfig.nullish(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zListProvidersResponse = object({
  providers: array(zProviderInfo),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSetProviderResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDisableProviderResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zLogoutResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionModeId = string();
const zSessionMode = object({
  id: zSessionModeId,
  name: string(),
  description: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionModeState = object({
  currentModeId: zSessionModeId,
  availableModes: requiredDefaultOnError(vecSkipError(zSessionMode), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionConfigId = string();
const zSessionConfigOptionCategory = union([
  literal("mode"),
  literal("model"),
  literal("model_config"),
  literal("thought_level"),
  string()
]);
const zSessionConfigValueId = string();
const zSessionConfigSelectOption = object({
  value: zSessionConfigValueId,
  name: string(),
  description: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionConfigGroupId = string();
const zSessionConfigSelectGroup = object({
  group: zSessionConfigGroupId,
  name: string(),
  options: requiredDefaultOnError(vecSkipError(zSessionConfigSelectOption), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionConfigSelectOptions = union([
  array(zSessionConfigSelectOption),
  array(zSessionConfigSelectGroup)
]);
const zSessionConfigSelect = object({
  currentValue: zSessionConfigValueId,
  options: zSessionConfigSelectOptions
});
const zSessionConfigBoolean = object({
  currentValue: boolean()
});
const zSessionConfigOption = intersection(union([
  zSessionConfigSelect.and(object({
    type: literal("select")
  })),
  zSessionConfigBoolean.and(object({
    type: literal("boolean")
  }))
]), object({
  id: zSessionConfigId,
  name: string(),
  description: defaultOnError(string().nullish(), () => void 0),
  category: defaultOnError(zSessionConfigOptionCategory.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
}));
const zNewSessionResponse = object({
  sessionId: zSessionId,
  modes: defaultOnError(zSessionModeState.nullish(), () => void 0),
  configOptions: defaultOnError(vecSkipError(zSessionConfigOption).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zLoadSessionResponse = object({
  modes: defaultOnError(zSessionModeState.nullish(), () => void 0),
  configOptions: defaultOnError(vecSkipError(zSessionConfigOption).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionInfo = object({
  sessionId: zSessionId,
  cwd: string(),
  additionalDirectories: defaultOnError(vecSkipError(string()).optional(), () => []),
  title: defaultOnError(string().nullish(), () => void 0),
  updatedAt: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zListSessionsResponse = object({
  sessions: requiredDefaultOnError(vecSkipError(zSessionInfo), () => []),
  nextCursor: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDeleteSessionResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zForkSessionResponse = object({
  sessionId: zSessionId,
  modes: defaultOnError(zSessionModeState.nullish(), () => void 0),
  configOptions: defaultOnError(vecSkipError(zSessionConfigOption).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zResumeSessionResponse = object({
  modes: defaultOnError(zSessionModeState.nullish(), () => void 0),
  configOptions: defaultOnError(vecSkipError(zSessionConfigOption).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCloseSessionResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSetSessionModeResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSetSessionConfigOptionResponse = object({
  configOptions: requiredDefaultOnError(vecSkipError(zSessionConfigOption), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zStopReason = union([
  literal("end_turn"),
  literal("max_tokens"),
  literal("max_turn_requests"),
  literal("refusal"),
  literal("cancelled")
]);
const zUsage = object({
  totalTokens: number(),
  inputTokens: number(),
  outputTokens: number(),
  thoughtTokens: defaultOnError(number().nullish(), () => void 0),
  cachedReadTokens: defaultOnError(number().nullish(), () => void 0),
  cachedWriteTokens: defaultOnError(number().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPromptResponse = object({
  stopReason: zStopReason,
  usage: defaultOnError(zUsage.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zStartNesResponse = object({
  sessionId: zSessionId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesSuggestionId = string();
const zPosition = object({
  line: int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }),
  character: int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zRange = object({
  start: zPosition,
  end: zPosition,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesTextEdit = object({
  range: zRange,
  newText: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesEditSuggestion = object({
  id: zNesSuggestionId,
  uri: string(),
  edits: array(zNesTextEdit),
  cursorPosition: defaultOnError(zPosition.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesJumpSuggestion = object({
  id: zNesSuggestionId,
  uri: string(),
  position: zPosition,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesRenameSuggestion = object({
  id: zNesSuggestionId,
  uri: string(),
  position: zPosition,
  newName: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesSearchAndReplaceSuggestion = object({
  id: zNesSuggestionId,
  uri: string(),
  search: string(),
  replace: string(),
  isRegex: boolean().nullish(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesSuggestion = union([
  zNesEditSuggestion.and(object({
    kind: literal("edit")
  })),
  zNesJumpSuggestion.and(object({
    kind: literal("jump")
  })),
  zNesRenameSuggestion.and(object({
    kind: literal("rename")
  })),
  zNesSearchAndReplaceSuggestion.and(object({
    kind: literal("searchAndReplace")
  }))
]);
const zSuggestNesResponse = object({
  suggestions: array(zNesSuggestion),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCloseNesResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zExtResponse = unknown();
const zMessageMcpResponse = unknown();
const zErrorCode = union([
  literal(-32700),
  literal(-32600),
  literal(-32601),
  literal(-32602),
  literal(-32603),
  literal(-32800),
  literal(-32e3),
  literal(-32002),
  int().min(-2147483648, {
    error: "Invalid value: Expected int32 to be >= -2147483648"
  }).max(2147483647, {
    error: "Invalid value: Expected int32 to be <= 2147483647"
  })
]);
const zError = object({
  code: zErrorCode,
  message: string(),
  data: defaultOnError(unknown().optional(), () => void 0)
});
union([
  object({
    id: zRequestId,
    result: union([
      zInitializeResponse,
      zAuthenticateResponse,
      zListProvidersResponse,
      zSetProviderResponse,
      zDisableProviderResponse,
      zLogoutResponse,
      zNewSessionResponse,
      zLoadSessionResponse,
      zListSessionsResponse,
      zDeleteSessionResponse,
      zForkSessionResponse,
      zResumeSessionResponse,
      zCloseSessionResponse,
      zSetSessionModeResponse,
      zSetSessionConfigOptionResponse,
      zPromptResponse,
      zStartNesResponse,
      zSuggestNesResponse,
      zCloseNesResponse,
      zExtResponse,
      zMessageMcpResponse
    ])
  }),
  object({
    id: zRequestId,
    error: zError
  })
]);
const zMessageId = string();
const zContentChunk = object({
  content: zContentBlock,
  messageId: defaultOnError(zMessageId.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zToolCall = object({
  toolCallId: zToolCallId,
  title: string(),
  name: defaultOnError(string().nullish(), () => void 0),
  kind: defaultOnError(zToolKind.optional(), () => void 0),
  status: defaultOnError(zToolCallStatus.optional(), () => void 0),
  content: defaultOnError(vecSkipError(zToolCallContent).optional(), () => []),
  locations: defaultOnError(vecSkipError(zToolCallLocation).optional(), () => []),
  rawInput: defaultOnError(unknown().optional(), () => void 0),
  rawOutput: defaultOnError(unknown().optional(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPlanEntryPriority = union([
  literal("high"),
  literal("medium"),
  literal("low")
]);
const zPlanEntryStatus = union([
  literal("pending"),
  literal("in_progress"),
  literal("completed")
]);
const zPlanEntry = object({
  content: string(),
  priority: zPlanEntryPriority,
  status: zPlanEntryStatus,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPlan = object({
  entries: requiredDefaultOnError(vecSkipError(zPlanEntry), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPlanId = string();
const zPlanItems = object({
  planId: zPlanId,
  entries: requiredDefaultOnError(vecSkipError(zPlanEntry), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPlanFile = object({
  planId: zPlanId,
  uri: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPlanMarkdown = object({
  planId: zPlanId,
  content: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPlanUpdateContent = union([
  zPlanItems.and(object({
    type: literal("items")
  })),
  zPlanFile.and(object({
    type: literal("file")
  })),
  zPlanMarkdown.and(object({
    type: literal("markdown")
  }))
]);
const zPlanUpdate = object({
  plan: zPlanUpdateContent,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPlanRemoved = object({
  planId: zPlanId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zUnstructuredCommandInput = object({
  hint: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAvailableCommandInput = zUnstructuredCommandInput;
const zAvailableCommand = object({
  name: string(),
  description: string(),
  input: defaultOnError(zAvailableCommandInput.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAvailableCommandsUpdate = object({
  availableCommands: requiredDefaultOnError(vecSkipError(zAvailableCommand), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCurrentModeUpdate = object({
  currentModeId: zSessionModeId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zConfigOptionUpdate = object({
  configOptions: requiredDefaultOnError(vecSkipError(zSessionConfigOption), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionInfoUpdate = object({
  title: defaultOnError(string().nullish(), () => void 0),
  updatedAt: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCost = object({
  amount: number(),
  currency: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zUsageUpdate = object({
  used: number(),
  size: number(),
  cost: defaultOnError(zCost.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNoticeSeverity = union([
  literal("info"),
  literal("warning"),
  literal("error"),
  string()
]);
const zNotice = object({
  severity: zNoticeSeverity,
  title: string().min(1),
  description: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCompactionId = string();
const zCompactionStatus = union([
  literal("in_progress"),
  literal("completed"),
  literal("failed"),
  literal("cancelled"),
  string()
]);
const zCompactionUpdate = object({
  compactionId: zCompactionId,
  status: zCompactionStatus,
  summary: defaultOnError(vecSkipError(zContentBlock).nullish(), () => void 0),
  error: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCompactionSummaryChunk = object({
  compactionId: zCompactionId,
  content: zContentBlock,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionUpdate = union([
  zContentChunk.and(object({
    sessionUpdate: literal("user_message_chunk")
  })),
  zContentChunk.and(object({
    sessionUpdate: literal("agent_message_chunk")
  })),
  zContentChunk.and(object({
    sessionUpdate: literal("agent_thought_chunk")
  })),
  zToolCall.and(object({
    sessionUpdate: literal("tool_call")
  })),
  zToolCallUpdate.and(object({
    sessionUpdate: literal("tool_call_update")
  })),
  zPlan.and(object({
    sessionUpdate: literal("plan")
  })),
  zPlanUpdate.and(object({
    sessionUpdate: literal("plan_update")
  })),
  zPlanRemoved.and(object({
    sessionUpdate: literal("plan_removed")
  })),
  zAvailableCommandsUpdate.and(object({
    sessionUpdate: literal("available_commands_update")
  })),
  zCurrentModeUpdate.and(object({
    sessionUpdate: literal("current_mode_update")
  })),
  zConfigOptionUpdate.and(object({
    sessionUpdate: literal("config_option_update")
  })),
  zSessionInfoUpdate.and(object({
    sessionUpdate: literal("session_info_update")
  })),
  zUsageUpdate.and(object({
    sessionUpdate: literal("usage_update")
  })),
  zNotice.and(object({
    sessionUpdate: literal("notice")
  })),
  zCompactionUpdate.and(object({
    sessionUpdate: literal("compaction_update")
  })),
  zCompactionSummaryChunk.and(object({
    sessionUpdate: literal("compaction_summary_chunk")
  }))
]);
const zSessionNotification = object({
  sessionId: zSessionId,
  update: zSessionUpdate,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCompleteElicitationNotification = object({
  elicitationId: zElicitationId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zMessageMcpNotification = object({
  connectionId: zMcpConnectionId,
  method: string(),
  params: defaultOnError(record(string(), unknown()).nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zExtNotification = unknown();
object({
  method: string(),
  params: union([
    zSessionNotification,
    zCompleteElicitationNotification,
    zMessageMcpNotification,
    zExtNotification
  ]).nullish()
});
const zFileSystemCapabilities = object({
  readTextFile: defaultOnError(boolean().optional().default(false), () => false),
  writeTextFile: defaultOnError(boolean().optional().default(false), () => false),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCompactionCapabilities = record(string(), unknown());
const zBooleanConfigOptionCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSessionConfigOptionsCapabilities = object({
  boolean: defaultOnError(zBooleanConfigOptionCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNoticeCapabilities = record(string(), unknown());
const zClientSessionCapabilities = object({
  compaction: defaultOnError(zCompactionCapabilities.nullish(), () => void 0),
  configOptions: defaultOnError(zSessionConfigOptionsCapabilities.nullish(), () => void 0),
  notices: defaultOnError(zNoticeCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zPlanCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAuthCapabilities = object({
  terminal: defaultOnError(boolean().optional().default(false), () => false),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zElicitationFormCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zElicitationUrlCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zElicitationCapabilities = object({
  form: defaultOnError(zElicitationFormCapabilities.nullish(), () => void 0),
  url: defaultOnError(zElicitationUrlCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesJumpCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesRenameCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesSearchAndReplaceCapabilities = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zClientNesCapabilities = object({
  jump: defaultOnError(zNesJumpCapabilities.nullish(), () => void 0),
  rename: defaultOnError(zNesRenameCapabilities.nullish(), () => void 0),
  searchAndReplace: defaultOnError(zNesSearchAndReplaceCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zClientCapabilities = object({
  fs: defaultOnError(zFileSystemCapabilities.optional().default({ readTextFile: false, writeTextFile: false }), () => ({ readTextFile: false, writeTextFile: false })),
  terminal: defaultOnError(boolean().optional().default(false), () => false),
  session: defaultOnError(zClientSessionCapabilities.nullish(), () => void 0),
  plan: defaultOnError(zPlanCapabilities.nullish(), () => void 0),
  auth: defaultOnError(zAuthCapabilities.optional().default({ terminal: false }), () => ({ terminal: false })),
  elicitation: defaultOnError(zElicitationCapabilities.nullish(), () => void 0),
  nes: defaultOnError(zClientNesCapabilities.nullish(), () => void 0),
  positionEncodings: defaultOnError(vecSkipError(zPositionEncodingKind).optional(), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zInitializeRequest = object({
  protocolVersion: zProtocolVersion,
  clientCapabilities: defaultOnError(zClientCapabilities.optional().default({
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    auth: { terminal: false }
  }), () => ({
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    auth: { terminal: false }
  })),
  clientInfo: defaultOnError(zImplementation.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAuthenticateRequest = object({
  methodId: zAuthMethodId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zListProvidersRequest = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSetProviderRequest = object({
  providerId: zProviderId,
  apiType: zLlmProtocol,
  baseUrl: string(),
  headers: record(string(), string()).optional(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDisableProviderRequest = object({
  providerId: zProviderId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zLogoutRequest = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zHttpHeader = object({
  name: string(),
  value: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zMcpServerHttp = object({
  name: string(),
  url: string(),
  headers: array(zHttpHeader),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zMcpServerSse = object({
  name: string(),
  url: string(),
  headers: array(zHttpHeader),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zMcpServerAcp = object({
  name: string(),
  serverId: zMcpServerAcpId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zMcpServerStdio = object({
  name: string(),
  command: string(),
  args: array(string()),
  env: array(zEnvVariable),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zMcpServer = union([
  zMcpServerHttp.and(object({
    type: literal("http")
  })),
  zMcpServerSse.and(object({
    type: literal("sse")
  })),
  zMcpServerAcp.and(object({
    type: literal("acp")
  })),
  zMcpServerStdio
]);
const zNewSessionRequest = object({
  cwd: string(),
  additionalDirectories: defaultOnError(vecSkipError(string()).optional(), () => []),
  mcpServers: requiredDefaultOnError(vecSkipError(zMcpServer), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zLoadSessionRequest = object({
  mcpServers: requiredDefaultOnError(vecSkipError(zMcpServer), () => []),
  cwd: string(),
  additionalDirectories: defaultOnError(vecSkipError(string()).optional(), () => []),
  sessionId: zSessionId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zListSessionsRequest = object({
  cwd: string().nullish(),
  cursor: string().nullish(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDeleteSessionRequest = object({
  sessionId: zSessionId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zForkSessionRequest = object({
  sessionId: zSessionId,
  cwd: string(),
  additionalDirectories: defaultOnError(vecSkipError(string()).optional(), () => []),
  mcpServers: defaultOnError(vecSkipError(zMcpServer).optional(), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zResumeSessionRequest = object({
  sessionId: zSessionId,
  cwd: string(),
  additionalDirectories: defaultOnError(vecSkipError(string()).optional(), () => []),
  mcpServers: defaultOnError(vecSkipError(zMcpServer).optional(), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCloseSessionRequest = object({
  sessionId: zSessionId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSetSessionModeRequest = object({
  sessionId: zSessionId,
  modeId: zSessionModeId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSetSessionConfigOptionRequest = intersection(union([
  object({
    value: boolean(),
    type: literal("boolean")
  }),
  object({
    value: zSessionConfigValueId
  })
]), object({
  sessionId: zSessionId,
  configId: zSessionConfigId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
}));
const zPromptRequest = object({
  sessionId: zSessionId,
  prompt: array(zContentBlock),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zWorkspaceFolder = object({
  uri: string(),
  name: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesRepository = object({
  name: string(),
  owner: string(),
  remoteUrl: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zStartNesRequest = object({
  workspaceUri: defaultOnError(string().nullish(), () => void 0),
  workspaceFolders: array(zWorkspaceFolder).nullish(),
  repository: defaultOnError(zNesRepository.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesTriggerKind = union([
  literal("automatic"),
  literal("diagnostic"),
  literal("manual")
]);
const zNesRecentFile = object({
  uri: string(),
  languageId: string(),
  text: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesExcerpt = object({
  startLine: int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }),
  endLine: int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }),
  text: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesRelatedSnippet = object({
  uri: string(),
  excerpts: array(zNesExcerpt),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesEditHistoryEntry = object({
  uri: string(),
  diff: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesUserAction = object({
  action: string(),
  uri: string(),
  position: zPosition,
  timestampMs: number(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesOpenFile = object({
  uri: string(),
  languageId: string(),
  visibleRange: defaultOnError(zRange.nullish(), () => void 0),
  lastFocusedMs: defaultOnError(number().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesDiagnosticSeverity = union([
  literal("error"),
  literal("warning"),
  literal("information"),
  literal("hint")
]);
const zNesDiagnostic = object({
  uri: string(),
  range: zRange,
  severity: zNesDiagnosticSeverity,
  message: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesSuggestContext = object({
  recentFiles: array(zNesRecentFile).nullish(),
  relatedSnippets: array(zNesRelatedSnippet).nullish(),
  editHistory: array(zNesEditHistoryEntry).nullish(),
  userActions: array(zNesUserAction).nullish(),
  openFiles: array(zNesOpenFile).nullish(),
  diagnostics: array(zNesDiagnostic).nullish(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSuggestNesRequest = object({
  sessionId: zSessionId,
  uri: string(),
  version: number(),
  position: zPosition,
  selection: zRange.nullish(),
  triggerKind: zNesTriggerKind,
  context: zNesSuggestContext.nullish(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCloseNesRequest = object({
  sessionId: zSessionId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
object({
  id: zRequestId,
  method: string(),
  params: union([
    zInitializeRequest,
    zAuthenticateRequest,
    zListProvidersRequest,
    zSetProviderRequest,
    zDisableProviderRequest,
    zLogoutRequest,
    zNewSessionRequest,
    zLoadSessionRequest,
    zListSessionsRequest,
    zDeleteSessionRequest,
    zForkSessionRequest,
    zResumeSessionRequest,
    zCloseSessionRequest,
    zSetSessionModeRequest,
    zSetSessionConfigOptionRequest,
    zPromptRequest,
    zStartNesRequest,
    zSuggestNesRequest,
    zCloseNesRequest,
    zMessageMcpRequest,
    zExtRequest
  ]).nullish()
});
const zWriteTextFileResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zReadTextFileResponse = object({
  content: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zSelectedPermissionOutcome = object({
  optionId: zPermissionOptionId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zRequestPermissionOutcome = union([
  object({
    outcome: literal("cancelled")
  }),
  zSelectedPermissionOutcome.and(object({
    outcome: literal("selected")
  }))
]);
const zRequestPermissionResponse = object({
  outcome: zRequestPermissionOutcome,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zCreateTerminalResponse = object({
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zTerminalExitStatus = object({
  exitCode: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  signal: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zTerminalOutputResponse = object({
  output: string(),
  truncated: boolean(),
  exitStatus: defaultOnError(zTerminalExitStatus.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zReleaseTerminalResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zWaitForTerminalExitResponse = object({
  exitCode: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  signal: defaultOnError(string().nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zKillTerminalResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zElicitationContentValue = union([
  string(),
  number(),
  number(),
  boolean(),
  array(string())
]);
const zElicitationAcceptAction = object({
  content: record(string(), zElicitationContentValue).nullish()
});
const zCreateElicitationResponse = preserveCustomPayload(intersection(union([
  zElicitationAcceptAction.and(object({
    action: literal("accept")
  })),
  object({
    action: literal("decline")
  }),
  object({
    action: literal("cancel")
  }),
  excludeKnownTags(object({
    action: string()
  }), "action", ["accept", "cancel", "decline"])
]), object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
})), "action", ["accept", "cancel", "decline"]);
const zConnectMcpResponse = object({
  connectionId: zMcpConnectionId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDisconnectMcpResponse = object({
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
union([
  object({
    id: zRequestId,
    result: union([
      zWriteTextFileResponse,
      zReadTextFileResponse,
      zRequestPermissionResponse,
      zCreateTerminalResponse,
      zTerminalOutputResponse,
      zReleaseTerminalResponse,
      zWaitForTerminalExitResponse,
      zKillTerminalResponse,
      zCreateElicitationResponse,
      zConnectMcpResponse,
      zDisconnectMcpResponse,
      zMessageMcpResponse,
      zExtResponse
    ])
  }),
  object({
    id: zRequestId,
    error: zError
  })
]);
const zCancelNotification = object({
  sessionId: zSessionId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDidOpenDocumentNotification = object({
  sessionId: zSessionId,
  uri: string(),
  languageId: string(),
  version: number(),
  text: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zTextDocumentContentChangeEvent = object({
  range: zRange.nullish(),
  text: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDidChangeDocumentNotification = object({
  sessionId: zSessionId,
  uri: string(),
  version: number(),
  contentChanges: requiredDefaultOnError(vecSkipError(zTextDocumentContentChangeEvent), () => []),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDidCloseDocumentNotification = object({
  sessionId: zSessionId,
  uri: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDidSaveDocumentNotification = object({
  sessionId: zSessionId,
  uri: string(),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zDidFocusDocumentNotification = object({
  sessionId: zSessionId,
  uri: string(),
  version: number(),
  position: zPosition,
  visibleRange: zRange,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zAcceptNesNotification = object({
  sessionId: zSessionId,
  id: zNesSuggestionId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const zNesRejectReason = union([
  literal("rejected"),
  literal("ignored"),
  literal("replaced"),
  literal("cancelled")
]);
const zRejectNesNotification = object({
  sessionId: zSessionId,
  id: zNesSuggestionId,
  reason: defaultOnError(zNesRejectReason.nullish(), () => void 0),
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
object({
  method: string(),
  params: union([
    zCancelNotification,
    zDidOpenDocumentNotification,
    zDidChangeDocumentNotification,
    zDidCloseDocumentNotification,
    zDidSaveDocumentNotification,
    zDidFocusDocumentNotification,
    zAcceptNesNotification,
    zRejectNesNotification,
    zMessageMcpNotification,
    zExtNotification
  ]).nullish()
});
object({
  requestId: zRequestId,
  _meta: defaultOnError(record(string(), unknown()).nullish(), () => void 0)
});
const CANCEL_REQUEST_METHOD = "$/cancel_request";
function isRequestMessage(value) {
  return isJsonRpcEnvelope(value) && "id" in value && typeof value["method"] === "string" && isJsonRpcId(value["id"]);
}
function isResponseMessage(value) {
  if (!isJsonRpcEnvelope(value) || "method" in value) {
    return false;
  }
  if (!("id" in value) || !isJsonRpcId(value["id"])) {
    return false;
  }
  const hasResult = Object.hasOwn(value, "result");
  const hasError = Object.hasOwn(value, "error");
  if (hasResult === hasError) {
    return false;
  }
  return !hasError || isErrorResponse(value["error"]);
}
function isNotificationMessage(value) {
  return isJsonRpcEnvelope(value) && !("id" in value) && typeof value["method"] === "string";
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function isJsonRpcEnvelope(value) {
  return isRecord(value) && value["jsonrpc"] === "2.0";
}
function isJsonRpcId(value) {
  return value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value);
}
function isResponseShapedMessage(value) {
  return isRecord(value) && !("method" in value) && ("id" in value || "result" in value || "error" in value);
}
function isResponseBatch(batch) {
  let hasValidCall = false;
  let hasValidResponse = false;
  let hasCallShape = false;
  let hasResponseShape = false;
  for (const entry of batch) {
    hasValidCall ||= isRequestMessage(entry) || isNotificationMessage(entry);
    hasValidResponse ||= isResponseMessage(entry);
    if (!isRecord(entry)) {
      continue;
    }
    hasCallShape ||= "method" in entry;
    hasResponseShape ||= "result" in entry || "error" in entry;
  }
  if (hasValidCall) {
    return false;
  }
  if (hasValidResponse) {
    return true;
  }
  return hasResponseShape && !hasCallShape;
}
function cancelRequestId(params) {
  if (!isRecord(params) || !isJsonRpcId(params["requestId"])) {
    return void 0;
  }
  return params["requestId"];
}
function isErrorResponse(value) {
  return isRecord(value) && typeof value["code"] === "number" && Number.isInteger(value["code"]) && typeof value["message"] === "string";
}
const Handled = {
  /**
   * Marks a message as handled.
   */
  yes() {
    return { handled: true };
  },
  /**
   * Leaves a message unhandled so later handlers can process it.
   */
  no(message, retry = false) {
    return { handled: false, message, retry };
  }
};
function rejectedPromise(error2) {
  const promise = Promise.reject(error2);
  promise.catch(() => {
  });
  return promise;
}
function errorDetails(error2) {
  if (error2 instanceof Error) {
    return error2.message;
  }
  if (typeof error2 === "object" && error2 != null && "message" in error2 && typeof error2.message === "string") {
    return error2.message;
  }
  return void 0;
}
function isZodError(error2) {
  return typeof error2 === "object" && error2 !== null && "name" in error2 && error2.name === "ZodError" && "issues" in error2 && Array.isArray(error2.issues) && "format" in error2 && typeof error2.format === "function";
}
function errorToResult(error2) {
  if (error2 instanceof RequestError) {
    return error2.toResult();
  }
  if (isZodError(error2)) {
    return RequestError.invalidParams(error2.format()).toResult();
  }
  const details = errorDetails(error2);
  try {
    return RequestError.internalError(details ? JSON.parse(details) : {}).toResult();
  } catch {
    return RequestError.internalError({ details }).toResult();
  }
}
function requestCancelledError(reason) {
  if (reason instanceof RequestError && reason.code === -32800) {
    return reason;
  }
  return RequestError.requestCancelled(reason);
}
function errorToRequestResult(error2, signal) {
  const requestCancelled = abortErrorToRequestCancelled(error2, signal);
  return requestCancelled ? requestCancelled.toResult() : errorToResult(error2);
}
function abortErrorToRequestCancelled(error2, signal) {
  if (!signal.aborted || !isAbortError(error2)) {
    return void 0;
  }
  return requestCancelledError(signal.reason);
}
function isAbortError(error2) {
  if (typeof error2 !== "object" || error2 === null) {
    return false;
  }
  const maybeAbortError = error2;
  return maybeAbortError.name === "AbortError" || maybeAbortError.code === "ABORT_ERR";
}
class RequestResponder {
  id;
  sendResult;
  signal;
  finishRequest;
  didRespond = false;
  constructor(id, sendResult, signal = new AbortController().signal, finishRequest) {
    this.id = id;
    this.sendResult = sendResult;
    this.signal = signal;
    this.finishRequest = finishRequest;
  }
  /**
   * Whether this request has already received a response.
   */
  get responded() {
    return this.didRespond;
  }
  /**
   * Sends a successful JSON-RPC response.
   */
  respond(response) {
    return this.respondWithResult({ result: response ?? null });
  }
  /**
   * Sends an error JSON-RPC response.
   */
  respondWithError(error2) {
    const errorResponse = error2 instanceof RequestError ? error2.toErrorResponse() : error2;
    return this.respondWithResult({ error: errorResponse });
  }
  /**
   * Sends a complete JSON-RPC result payload.
   */
  respondWithResult(result) {
    if (this.didRespond) {
      return rejectedPromise(new Error("JSON-RPC request already responded"));
    }
    this.didRespond = true;
    return this.sendResult(result).finally(() => {
      this.finishRequest?.();
    });
  }
}
const requestBatchSizes = /* @__PURE__ */ new WeakMap();
class HandlerRegistration {
  disposeHandler;
  active = true;
  constructor(disposeHandler) {
    this.disposeHandler = disposeHandler;
  }
  /**
   * Unregisters the associated handler.
   */
  dispose() {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.disposeHandler();
  }
  /**
   * Supports explicit resource management with `using`.
   */
  [Symbol.dispose]() {
    this.dispose();
  }
  /**
   * Returns this registration for call sites that intentionally keep it active.
   */
  runIndefinitely() {
    return this;
  }
}
class ConnectionContext {
  connection;
  constructor(connection) {
    this.connection = connection;
  }
  /**
   * Sends a request over the connection.
   */
  sendRequest(method, params, mapResponse, options) {
    return this.connection.sendRequest(method, params, mapResponse, options);
  }
  /**
   * Sends a notification over the connection.
   */
  sendNotification(method, params) {
    return this.connection.sendNotification(method, params);
  }
  /**
   * Sends a non-empty JSON-RPC batch in one transport message.
   */
  sendBatch(entries) {
    return this.connection.sendBatch(entries);
  }
  /**
   * Sends a protocol-level request cancellation notification.
   */
  sendCancelRequest(requestId) {
    return this.connection.sendCancelRequest(requestId);
  }
  /**
   * Registers a handler that can be disposed independently.
   */
  addDynamicHandler(handler) {
    return this.connection.addDynamicHandler(handler);
  }
  /**
   * AbortSignal that aborts when the connection closes.
   */
  get signal() {
    return this.connection.signal;
  }
  /**
   * Promise that resolves when the connection closes.
   */
  get closed() {
    return this.connection.closed;
  }
}
class Connection {
  pendingResponses = /* @__PURE__ */ new Map();
  incomingRequests = /* @__PURE__ */ new Map();
  nextRequestId = 0;
  staticHandlers = [];
  dynamicHandlers = /* @__PURE__ */ new Set();
  stream;
  writeQueue = Promise.resolve();
  abortController = new AbortController();
  closedPromise;
  retryQueue = [];
  context = new ConnectionContext(this);
  receiveReader;
  allowBatches = true;
  constructor(requestHandlerOrStream, notificationHandlerOrHandlers, streamOrOptions, options) {
    if (typeof requestHandlerOrStream === "function") {
      const requestHandler = requestHandlerOrStream;
      const notificationHandler = notificationHandlerOrHandlers;
      const stream2 = streamOrOptions;
      this.initialize(stream2, [
        ...options?.handlers ?? [],
        this.legacyHandler(requestHandler, notificationHandler)
      ], options);
      return;
    }
    const stream = requestHandlerOrStream;
    const handlers = notificationHandlerOrHandlers;
    const connectionOptions = streamOrOptions;
    this.initialize(stream, [...connectionOptions?.handlers ?? [], ...handlers], connectionOptions);
  }
  /**
   * Creates a builder for configuring a handler-based connection.
   */
  static builder() {
    return new ConnectionBuilder();
  }
  /**
   * Runs an operation while the connection is open, then closes the connection.
   *
   * If the stream closes before `op` settles, the returned promise rejects with
   * the connection close reason.
   */
  runUntil(op) {
    let opSettled = false;
    const opPromise = Promise.resolve().then(() => op(this.context)).finally(() => {
      opSettled = true;
    });
    const closedPromise = this.closed.then(() => {
      if (opSettled) {
        return new Promise(() => {
        });
      }
      throw this.closedReason();
    });
    return Promise.race([opPromise, closedPromise]).finally(() => {
      opSettled = true;
      this.close();
    });
  }
  /**
   * Adds a handler after the connection has started.
   *
   * Any messages queued with `Handled.no(message, true)` are retried after the
   * handler is added.
   */
  addDynamicHandler(handler) {
    this.dynamicHandlers.add(handler);
    if (this.retryQueue.length > 0) {
      for (const message of this.retryQueue.splice(0)) {
        void this.processIncomingMessage(message).catch((error2) => this.close(error2));
      }
    }
    return new HandlerRegistration(() => {
      this.dynamicHandlers.delete(handler);
    });
  }
  /**
   * AbortSignal that aborts when the connection closes.
   */
  get signal() {
    return this.abortController.signal;
  }
  /**
   * Promise that resolves when the connection closes.
   */
  get closed() {
    return this.closedPromise;
  }
  /** @internal */
  getContext() {
    return this.context;
  }
  /**
   * Sends a JSON-RPC request.
   *
   * `mapResponse` can convert the raw result before the returned promise
   * resolves.
   */
  sendRequest(method, params, mapResponse, options = {}) {
    if (this.abortController.signal.aborted) {
      return rejectedPromise(this.closedReason());
    }
    const request = this.prepareRequest(method, params, mapResponse, options);
    const requestSent = this.sendWireMessage(request.message);
    void requestSent.catch(() => {
    });
    if (options.cancellationSignal?.aborted) {
      request.cancel();
    }
    return request.response;
  }
  /**
   * Sends a non-empty JSON-RPC batch in one transport message.
   *
   * Requests and notifications are processed independently by the peer. The
   * returned tuple preserves the input order: request entries resolve to their
   * mapped response, while notification entries resolve to `undefined`.
   */
  sendBatch(entries) {
    if (this.abortController.signal.aborted) {
      return rejectedPromise(this.closedReason());
    }
    if (!this.allowBatches) {
      return rejectedPromise(new TypeError("JSON-RPC batches are not supported on this connection"));
    }
    if (entries.length === 0) {
      return rejectedPromise(new TypeError("JSON-RPC batch must contain at least one entry"));
    }
    const messages = [];
    const cancellations = [];
    const outputs = [];
    for (const entry of entries) {
      if (entry.kind === "notification") {
        messages.push({
          jsonrpc: "2.0",
          method: entry.method,
          params: entry.params
        });
        outputs.push(Promise.resolve(void 0));
        continue;
      }
      const request = this.prepareRequest(entry.method, entry.params, entry.mapResponse, entry.options);
      messages.push(request.message);
      outputs.push(request.response);
      cancellations.push({
        signal: entry.options?.cancellationSignal,
        cancel: request.cancel
      });
    }
    const batch = messages;
    const batchSent = this.sendWireMessage(batch);
    for (const cancellation of cancellations) {
      if (cancellation.signal?.aborted) {
        cancellation.cancel();
      }
    }
    const response = Promise.all([batchSent, ...outputs]).then(([, ...resolved]) => resolved);
    response.catch(() => {
    });
    return response;
  }
  /**
   * Sends a protocol-level request cancellation notification.
   */
  sendCancelRequest(requestId) {
    return this.sendNotification(CANCEL_REQUEST_METHOD, { requestId });
  }
  /**
   * Sends a JSON-RPC notification.
   */
  sendNotification(method, params) {
    if (this.abortController.signal.aborted) {
      return rejectedPromise(this.closedReason());
    }
    return this.sendWireMessage({ jsonrpc: "2.0", method, params });
  }
  prepareRequest(method, params, mapResponse, options = {}) {
    const id = this.nextRequestId++;
    let cancel = () => {
    };
    const response = new Promise((resolve, reject) => {
      const pendingResponse = {
        resolve: (value) => {
          try {
            resolve(mapResponse ? mapResponse(value) : value);
          } catch (error2) {
            reject(error2);
          }
        },
        reject
      };
      cancel = () => {
        if (pendingResponse.cancellationSent) {
          return;
        }
        pendingResponse.cancellationSent = true;
        pendingResponse.cleanup?.();
        void this.sendCancelRequest(id).catch(() => {
        });
      };
      options.cancellationSignal?.addEventListener("abort", cancel, {
        once: true
      });
      pendingResponse.cleanup = () => {
        options.cancellationSignal?.removeEventListener("abort", cancel);
      };
      this.pendingResponses.set(id, pendingResponse);
    });
    response.catch(() => {
    });
    return {
      message: { jsonrpc: "2.0", id, method, params },
      response,
      cancel: () => cancel()
    };
  }
  /**
   * Closes the connection and rejects pending requests.
   */
  close(error2) {
    if (this.abortController.signal.aborted) {
      return;
    }
    const closeError = error2 ?? new Error("ACP connection closed");
    this.abortController.abort(closeError);
    for (const pendingResponse of this.pendingResponses.values()) {
      pendingResponse.cleanup?.();
      pendingResponse.reject(closeError);
    }
    this.pendingResponses.clear();
    for (const controller of this.incomingRequests.values()) {
      controller.abort(closeError);
    }
    this.incomingRequests.clear();
    void this.receiveReader?.cancel(closeError).catch(() => {
    });
  }
  initialize(stream, handlers, options) {
    this.stream = stream;
    this.staticHandlers = handlers;
    this.allowBatches = options?.allowBatches ?? true;
    this.closedPromise = new Promise((resolve) => {
      this.abortController.signal.addEventListener("abort", () => resolve());
    });
    void this.receive();
  }
  legacyHandler(requestHandler, notificationHandler) {
    return {
      handleMessage: async (message, cx) => {
        if (message.kind === "request") {
          const result = await requestHandler(message.method, message.params, cx);
          await message.responder.respond(result);
        } else {
          await notificationHandler(message.method, message.params, cx);
        }
        return Handled.yes();
      }
    };
  }
  async receive() {
    let closeError = void 0;
    try {
      const reader = this.stream.readable.getReader();
      this.receiveReader = reader;
      try {
        while (!this.abortController.signal.aborted) {
          const { value: message, done } = await reader.read();
          if (this.abortController.signal.aborted) {
            break;
          }
          if (done) {
            break;
          }
          this.receiveWireMessage(message);
        }
      } finally {
        if (this.receiveReader === reader) {
          this.receiveReader = void 0;
        }
        reader.releaseLock();
      }
    } catch (error2) {
      closeError = error2;
    } finally {
      this.close(closeError);
    }
  }
  receiveWireMessage(message) {
    if (Array.isArray(message)) {
      if (!this.allowBatches) {
        this.close(new TypeError("JSON-RPC batches are not supported on this connection"));
        return;
      }
      this.receiveBatch(message);
      return;
    }
    if (!isRequestMessage(message) && !isNotificationMessage(message) && !isResponseShapedMessage(message)) {
      void this.sendWireMessage(protocolErrorResponse(RequestError.invalidRequest(message))).catch(() => {
      });
      return;
    }
    this.receiveMessage(message);
  }
  receiveBatch(batch) {
    if (batch.length === 0) {
      void this.sendWireMessage(protocolErrorResponse(RequestError.invalidRequest(batch))).catch(() => {
      });
      return;
    }
    const responseBatch = isResponseBatch(batch);
    const responseCount = responseBatch ? 0 : batch.reduce((count, message) => count + (isNotificationMessage(message) ? 0 : 1), 0);
    let remaining = responseCount;
    let remainingNotifications = batch.reduce((count, message) => count + (isNotificationMessage(message) ? 1 : 0), 0);
    let responseSent = false;
    const responses = [];
    const sendResponsesIfReady = async () => {
      if (responseSent || remaining !== 0 || remainingNotifications !== 0 || responses.length === 0) {
        return;
      }
      responseSent = true;
      await this.sendWireMessage(responses);
    };
    const collectResponse = async (response) => {
      responses.push(response);
      remaining -= 1;
      await sendResponsesIfReady();
    };
    for (const message of batch) {
      if (responseBatch) {
        if (isResponseShapedMessage(message)) {
          this.receiveMessage(message);
        }
        continue;
      }
      if (!isRequestMessage(message) && !isNotificationMessage(message)) {
        void collectResponse(protocolErrorResponse(RequestError.invalidRequest(message))).catch(() => {
        });
        continue;
      }
      const processing = this.receiveMessage(message, isRequestMessage(message) ? collectResponse : void 0, batch.length);
      if (isNotificationMessage(message)) {
        void processing.finally(() => {
          remainingNotifications -= 1;
          void sendResponsesIfReady().catch((error2) => this.close(error2));
        });
      }
    }
  }
  receiveMessage(message, sendResponse, batchSize) {
    if (this.abortController.signal.aborted) {
      return Promise.resolve();
    }
    if (!isRecord(message)) {
      console.error("Invalid message", { message });
      return Promise.resolve();
    }
    if ("method" in message) {
      if (!("id" in message)) {
        this.handleProtocolNotification(message);
      }
      return this.processIncomingMessage(this.toIncomingMessage(message, sendResponse, batchSize)).catch((error2) => this.close(error2));
    } else if ("id" in message) {
      this.handleResponse(message);
    } else {
      console.error("Invalid message", { message });
    }
    return Promise.resolve();
  }
  async processIncomingMessage(message) {
    if (this.abortController.signal.aborted) {
      return;
    }
    let current = message;
    let retry = false;
    try {
      for (const handler of [
        ...this.staticHandlers,
        ...this.dynamicHandlers.values()
      ]) {
        if (this.abortController.signal.aborted) {
          return;
        }
        const result = await handler.handleMessage(current, this.context) ?? {
          handled: true
        };
        if (result.handled) {
          return;
        }
        current = result.message ?? current;
        retry = retry || Boolean(result.retry);
      }
      if (retry) {
        this.retryQueue.push(current);
      } else if (current.kind === "request") {
        await current.responder.respondWithError(RequestError.methodNotFound(current.method));
      }
    } catch (error2) {
      if (this.abortController.signal.aborted) {
        return;
      }
      if (current.kind === "request" && !current.responder.responded) {
        await current.responder.respondWithResult(errorToRequestResult(error2, current.responder.signal));
      } else {
        const response = errorToResult(error2);
        if ("error" in response) {
          console.error("Error handling notification", message.raw, response.error);
        }
      }
    }
  }
  toIncomingMessage(message, sendResponse, batchSize) {
    if ("id" in message) {
      const abortController = new AbortController();
      this.incomingRequests.set(message.id, abortController);
      const finishRequest = () => {
        if (this.incomingRequests.get(message.id) === abortController) {
          this.incomingRequests.delete(message.id);
        }
      };
      const responder = new RequestResponder(message.id, (result) => {
        const response = {
          jsonrpc: "2.0",
          id: message.id,
          ...result
        };
        return sendResponse ? sendResponse(response) : this.sendWireMessage(response);
      }, abortController.signal, finishRequest);
      if (batchSize !== void 0) {
        requestBatchSizes.set(responder, batchSize);
      }
      return {
        kind: "request",
        method: message.method,
        params: message.params,
        raw: message,
        signal: abortController.signal,
        responder
      };
    }
    return {
      kind: "notification",
      method: message.method,
      params: message.params,
      raw: message
    };
  }
  handleResponse(response) {
    const pendingResponse = this.pendingResponses.get(response.id);
    if (pendingResponse) {
      this.pendingResponses.delete(response.id);
      pendingResponse.cleanup?.();
      if (!isResponseMessage(response)) {
        pendingResponse.reject(RequestError.invalidRequest(response));
      } else if ("result" in response) {
        pendingResponse.resolve(response.result);
      } else {
        const { code, message, data } = response.error;
        pendingResponse.reject(new RequestError(code, message, data));
      }
    } else {
      console.error("Got response to unknown request", response.id);
    }
  }
  handleProtocolNotification(message) {
    if (message.method !== CANCEL_REQUEST_METHOD) {
      return;
    }
    const requestId = cancelRequestId(message.params);
    if (requestId === void 0) {
      return;
    }
    const controller = this.incomingRequests.get(requestId);
    if (!controller || controller.signal.aborted) {
      return;
    }
    controller.abort(RequestError.requestCancelled({ requestId }));
  }
  closedReason() {
    return this.abortController.signal.reason ?? new Error("ACP connection closed");
  }
  async sendWireMessage(message) {
    if (this.abortController.signal.aborted) {
      return rejectedPromise(this.closedReason());
    }
    this.writeQueue = this.writeQueue.then(async () => {
      if (this.abortController.signal.aborted) {
        throw this.closedReason();
      }
      const writer = this.stream.writable.getWriter();
      try {
        await writer.write(message);
      } finally {
        writer.releaseLock();
      }
    }).catch((error2) => {
      this.close(error2);
      throw error2;
    });
    return this.writeQueue;
  }
}
class ConnectionBuilder {
  handlers = [];
  connectionName;
  /**
   * Sets a diagnostic name used by handlers created from this builder.
   */
  name(name) {
    this.connectionName = name;
    return this;
  }
  /**
   * Adds a raw JSON-RPC handler to the handler chain.
   */
  withHandler(handler) {
    this.handlers.push(handler);
    return this;
  }
  /**
   * Adds a handler that can inspect every incoming request or notification.
   *
   * Observer callbacks that return void pass the message through to later
   * handlers. Return `Handled.yes()` to stop dispatch explicitly.
   */
  onReceiveMessage(handler) {
    return this.withHandler({
      handleMessage: async (message, cx) => await handler(message, cx) ?? Handled.no(message),
      describe: () => this.connectionName ?? "onReceiveMessage"
    });
  }
  /**
   * Adds a typed request handler for one method.
   */
  onReceiveRequest(method, parse2, handler) {
    return this.withHandler({
      handleMessage: async (message, cx) => {
        if (message.kind !== "request" || message.method !== method) {
          return Handled.no(message);
        }
        const request = parse2(message.params);
        return await handler(request, message.responder, cx) ?? Handled.yes();
      },
      describe: () => `${this.connectionName ?? "request"}:${method}`
    });
  }
  /**
   * Adds a typed notification handler for one method.
   */
  onReceiveNotification(method, parse2, handler) {
    return this.withHandler({
      handleMessage: async (message, cx) => {
        if (message.kind !== "notification" || message.method !== method) {
          return Handled.no(message);
        }
        const notification = parse2(message.params);
        return await handler(notification, cx) ?? Handled.yes();
      },
      describe: () => `${this.connectionName ?? "notification"}:${method}`
    });
  }
  /**
   * Connects the configured handlers to a stream.
   */
  connect(stream, options) {
    return new Connection(stream, this.handlers, options);
  }
  /**
   * Connects to a stream for the lifetime of `op`, then closes the connection.
   */
  connectWith(stream, op, options) {
    return this.connect(stream, options).runUntil(op);
  }
}
class RequestError extends Error {
  code;
  /**
   * Additional JSON-RPC error data.
   */
  data;
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.name = "RequestError";
    this.data = data;
  }
  /**
   * Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text.
   */
  static parseError(data, additionalMessage) {
    return new RequestError(-32700, `Parse error${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * The JSON sent is not a valid Request object.
   */
  static invalidRequest(data, additionalMessage) {
    return new RequestError(-32600, `Invalid request${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * The method does not exist / is not available.
   */
  static methodNotFound(method) {
    return new RequestError(-32601, `"Method not found": ${method}`, {
      method
    });
  }
  /**
   * Invalid method parameter(s).
   */
  static invalidParams(data, additionalMessage) {
    return new RequestError(-32602, `Invalid params${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * Internal JSON-RPC error.
   */
  static internalError(data, additionalMessage) {
    return new RequestError(-32603, `Internal error${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * Execution of the request was aborted.
   */
  static requestCancelled(data, additionalMessage) {
    return new RequestError(-32800, `Request cancelled${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * Authentication required.
   */
  static authRequired(data, additionalMessage) {
    return new RequestError(-32e3, `Authentication required${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * Resource, such as a file, was not found
   */
  static resourceNotFound(uri) {
    return new RequestError(-32002, `Resource not found${uri ? `: ${uri}` : ""}`, uri && { uri });
  }
  /**
   * Converts this error to a JSON-RPC result object.
   */
  toResult() {
    return {
      error: {
        code: this.code,
        message: this.message,
        data: this.data
      }
    };
  }
  /**
   * Converts this error to a JSON-RPC error response payload.
   */
  toErrorResponse() {
    return {
      code: this.code,
      message: this.message,
      data: this.data
    };
  }
}
function protocolErrorResponse(error2) {
  return {
    jsonrpc: "2.0",
    id: null,
    error: error2.toErrorResponse()
  };
}
const newline = 10;
class LineBuffer {
  /** Bytes of the current (incomplete) line, carried across chunks. */
  #pending = [];
  /**
   * Consumes a chunk, returning each complete line without its trailing
   * newline.
   */
  push(chunk) {
    const lines = [];
    let start = 0;
    let newlineIndex = chunk.indexOf(newline, start);
    while (newlineIndex !== -1) {
      lines.push(this.#takeLine(chunk.subarray(start, newlineIndex)));
      start = newlineIndex + 1;
      newlineIndex = chunk.indexOf(newline, start);
    }
    if (start < chunk.byteLength) {
      this.#pending.push(start === 0 ? chunk : new Uint8Array(chunk.subarray(start)));
    }
    return lines;
  }
  /**
   * Returns the trailing unterminated line and resets the buffer, or
   * undefined if no bytes are buffered.
   */
  flush() {
    if (this.#pending.length === 0) {
      return void 0;
    }
    return this.#takeLine(new Uint8Array(0));
  }
  #takeLine(tail) {
    if (this.#pending.length === 0) {
      return tail;
    }
    let total = tail.byteLength;
    for (const part of this.#pending) {
      total += part.byteLength;
    }
    const line = new Uint8Array(total);
    let offset = 0;
    for (const part of this.#pending) {
      line.set(part, offset);
      offset += part.byteLength;
    }
    line.set(tail, offset);
    this.#pending = [];
    return line;
  }
}
function ndJsonStream$1(output, input) {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  let cancelled = false;
  let inputReader;
  let outputWrite = Promise.resolve();
  const writeJson2 = (message) => {
    const content = JSON.stringify(message) + "\n";
    const write = outputWrite.then(async () => {
      const writer = output.getWriter();
      try {
        await writer.write(textEncoder.encode(content));
      } finally {
        writer.releaseLock();
      }
    });
    outputWrite = write.catch(() => {
    });
    return write;
  };
  const readable = new ReadableStream({
    async start(controller) {
      const lines = new LineBuffer();
      const enqueueLine = async (lineBytes) => {
        const trimmedLine = textDecoder.decode(lineBytes).trim();
        if (!trimmedLine) {
          return;
        }
        let message;
        try {
          message = JSON.parse(trimmedLine);
        } catch {
          await writeJson2(protocolErrorResponse(RequestError.parseError()));
          return;
        }
        if (isRecord(message) || Array.isArray(message)) {
          controller.enqueue(message);
        } else {
          await writeJson2(protocolErrorResponse(RequestError.invalidRequest(message)));
        }
      };
      const reader = input.getReader();
      inputReader = reader;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (cancelled) {
            return;
          }
          if (done) {
            break;
          }
          if (!value) {
            continue;
          }
          for (const line of lines.push(value)) {
            await enqueueLine(line);
            if (cancelled) {
              return;
            }
          }
        }
        if (cancelled) {
          return;
        }
        const lastLine = lines.flush();
        if (lastLine) {
          await enqueueLine(lastLine);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        controller.error(err);
        return;
      } finally {
        if (inputReader === reader) {
          inputReader = void 0;
        }
        reader.releaseLock();
      }
      if (cancelled) {
        return;
      }
      controller.close();
    },
    cancel(reason) {
      cancelled = true;
      return inputReader?.cancel(reason);
    }
  });
  const writable = new WritableStream({
    write(message) {
      return writeJson2(message);
    }
  });
  return { readable, writable };
}
zElicitationFormMode.and(object({ mode: literal("form") })).and(object({ message: string() }));
zElicitationUrlMode.and(object({ mode: literal("url") })).and(object({ message: string() }));
union([zElicitationSessionScope, zElicitationRequestScope]).and(object({ message: string() }));
zStringPropertySchema.and(object({ type: literal("string") }));
zNumberPropertySchema.and(object({ type: literal("number") }));
zIntegerPropertySchema.and(object({ type: literal("integer") }));
zBooleanPropertySchema.and(object({ type: literal("boolean") }));
zMultiSelectPropertySchema.and(object({ type: literal("array") }));
zStringMultiSelectItems.and(object({ type: literal("string") }));
zElicitationAcceptAction.and(object({ action: literal("accept") }));
object({
  action: literal("decline")
});
object({
  action: literal("cancel")
});
function ndJsonStream(output, input) {
  return ndJsonStream$1(output, input);
}
function emptyObjectResponse(response) {
  return response ?? {};
}
function isStream(value) {
  return typeof value === "object" && value !== null && "readable" in value && "writable" in value;
}
function memoryStreamPair() {
  const leftToRight = new TransformStream();
  const rightToLeft = new TransformStream();
  return [
    {
      readable: rightToLeft.readable,
      writable: leftToRight.writable
    },
    {
      readable: leftToRight.readable,
      writable: rightToLeft.writable
    }
  ];
}
const methods = {
  agent: {
    initialize: AGENT_METHODS.initialize,
    session: {
      setConfigOption: AGENT_METHODS.session_set_config_option,
      cancel: AGENT_METHODS.session_cancel
    }
  },
  client: {
    session: {
      requestPermission: CLIENT_METHODS.session_request_permission
    },
    fs: {
      writeTextFile: CLIENT_METHODS.fs_write_text_file,
      readTextFile: CLIENT_METHODS.fs_read_text_file
    }
  }
};
const startActiveSession = /* @__PURE__ */ Symbol("startActiveSession");
class AcpContext {
  cx;
  currentRequestId;
  /** @internal */
  constructor(cx, currentRequestId) {
    this.cx = cx;
    this.currentRequestId = currentRequestId;
  }
  /**
   * JSON-RPC id of the request currently being handled.
   *
   * This is `undefined` for notification handlers and for contexts created
   * outside an inbound request, such as `connect(...)` and `connectWith(...)`.
   */
  get requestId() {
    return this.currentRequestId;
  }
  /** @internal */
  get connectionContext() {
    return this.cx;
  }
  /** @internal */
  sendRequest(method, params, mapResponse, options) {
    return this.cx.sendRequest(method, params, mapResponse, options);
  }
  /** @internal */
  sendNotification(method, params) {
    return this.cx.sendNotification(method, params);
  }
  /** @internal */
  addDynamicHandler(handler) {
    return this.cx.addDynamicHandler(handler);
  }
}
class AgentContext extends AcpContext {
  constructor(cx, requestId) {
    super(cx, requestId);
  }
  /** @internal */
  static create(cx, requestId) {
    return new AgentContext(cx, requestId);
  }
  request(method, params, options) {
    const spec = clientRequestSpecsByMethod[method];
    return this.sendRequest(method, params, spec?.mapResponse, options);
  }
  notify(method, params) {
    return this.sendNotification(method, params);
  }
}
class ClientContext extends AcpContext {
  constructor(cx, requestId) {
    super(cx, requestId);
  }
  /** @internal */
  static create(cx, requestId) {
    return new ClientContext(cx, requestId);
  }
  /** @internal */
  [startActiveSession](params, options) {
    return this.sendRequest(AGENT_METHODS.session_new, params, (response) => this.attachSession(response), options);
  }
  buildSession(cwdOrRequest) {
    if (typeof cwdOrRequest === "string") {
      return SessionBuilder.create(this, {
        cwd: cwdOrRequest,
        mcpServers: []
      });
    }
    return SessionBuilder.create(this, cwdOrRequest);
  }
  /**
   * Builds active-session helpers around a `session/new` response.
   */
  attachSession(response) {
    const updates = new AsyncQueue();
    const closeSignal = this.connectionContext.signal;
    const failUpdatesOnClose = () => {
      updates.fail(closeSignal.reason ?? new Error("ACP connection closed"));
    };
    if (closeSignal.aborted) {
      failUpdatesOnClose();
    } else {
      closeSignal.addEventListener("abort", failUpdatesOnClose);
    }
    const sessionRegistration = sessionUpdateRouter(this.connectionContext).attach(response, updates);
    const closeRegistration = new HandlerRegistration(() => {
      closeSignal.removeEventListener("abort", failUpdatesOnClose);
    });
    return ActiveSession.create(this, response, updates, [
      sessionRegistration,
      closeRegistration
    ]);
  }
  request(method, params, options) {
    const spec = agentRequestSpecsByMethod[method];
    return this.sendRequest(method, params, spec?.mapResponse, options);
  }
  notify(method, params) {
    return this.sendNotification(method, params);
  }
}
class AcpConnectionHandle {
  connection;
  constructor(connection) {
    this.connection = connection;
  }
  get signal() {
    return this.connection.signal;
  }
  get closed() {
    return this.connection.closed;
  }
  close(error2) {
    this.connection.close(error2);
  }
}
class AgentConnectionHandle extends AcpConnectionHandle {
  connectHandlers;
  client;
  didStartConnectHandlers = false;
  constructor(connection, connectHandlers = []) {
    super(connection);
    this.connectHandlers = connectHandlers;
    this.client = AgentContext.create(connection.getContext());
  }
  /** @internal */
  startConnectHandlers() {
    if (this.didStartConnectHandlers) {
      return;
    }
    this.didStartConnectHandlers = true;
    runConnectHandlers(this, this.connectHandlers);
  }
}
class ClientConnectionHandle extends AcpConnectionHandle {
  connectHandlers;
  agent;
  didStartConnectHandlers = false;
  constructor(connection, connectHandlers = []) {
    super(connection);
    this.connectHandlers = connectHandlers;
    this.agent = ClientContext.create(connection.getContext());
  }
  /** @internal */
  startConnectHandlers() {
    if (this.didStartConnectHandlers) {
      return;
    }
    this.didStartConnectHandlers = true;
    runConnectHandlers(this, this.connectHandlers);
  }
}
function agentConnection(connection, connectHandlers = []) {
  return new AgentConnectionHandle(connection, connectHandlers);
}
function clientConnection(connection, connectHandlers = []) {
  return new ClientConnectionHandle(connection, connectHandlers);
}
class AsyncQueue {
  values = [];
  waiters = [];
  failed = false;
  failure;
  enqueue(value) {
    if (this.failed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(value);
    } else {
      this.values.push({ kind: "value", value });
    }
  }
  reject(error2) {
    if (this.failed) {
      return;
    }
    if (this.waiters.length > 0) {
      for (const waiter of this.waiters.splice(0)) {
        waiter.reject(error2);
      }
      return;
    }
    this.values.push({ kind: "error", error: error2 });
  }
  clearErrors() {
    this.values = this.values.filter((entry) => entry.kind === "value");
  }
  fail(error2) {
    if (this.failed) {
      return;
    }
    this.failed = true;
    this.failure = error2;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error2);
    }
  }
  next() {
    if (this.values.length > 0) {
      const entry = this.values.shift();
      if (entry.kind === "error") {
        return Promise.reject(entry.error);
      }
      return Promise.resolve(entry.value);
    }
    if (this.failed) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}
function cloneNewSessionRequest(request) {
  return {
    ...request,
    additionalDirectories: request.additionalDirectories ? [...request.additionalDirectories] : void 0,
    mcpServers: [...request.mcpServers]
  };
}
class SessionBuilder {
  cx;
  request;
  constructor(cx, request) {
    this.cx = cx;
    this.request = cloneNewSessionRequest(request);
  }
  /** @internal */
  static create(cx, request) {
    return new SessionBuilder(cx, request);
  }
  /**
   * Returns the `session/new` request that will be sent.
   *
   * The returned object is a defensive copy, so mutating it does not change the
   * builder.
   */
  toRequest() {
    return cloneNewSessionRequest(this.request);
  }
  /**
   * Replaces the additional workspace roots for this session.
   *
   * `additionalDirectories` expand the session's file-system scope without
   * changing `cwd`. Each path should be absolute.
   */
  withAdditionalDirectories(additionalDirectories) {
    this.request = {
      ...this.request,
      additionalDirectories: [...additionalDirectories]
    };
    return this;
  }
  /**
   * Adds one MCP server to the `session/new` request.
   */
  withMcpServer(mcpServer) {
    this.request = {
      ...this.request,
      mcpServers: [...this.request.mcpServers, mcpServer]
    };
    return this;
  }
  /**
   * Starts the session and returns an `ActiveSession` for prompting and reading
   * updates.
   *
   * Call `dispose()` on the returned session when you no longer need update
   * routing, or use `withSession(...)` to scope disposal automatically.
   */
  async start(options) {
    return this.cx[startActiveSession](this.toRequest(), options);
  }
  /**
   * Starts the session, runs `op`, and disposes the active-session update
   * routing when `op` finishes or throws.
   */
  async withSession(op) {
    const session = await this.start();
    try {
      return await op(session);
    } finally {
      session.dispose();
    }
  }
}
class ActiveSession {
  cx;
  sessionResponse;
  updates;
  registrations;
  constructor(cx, sessionResponse, updates, registrations) {
    this.cx = cx;
    this.sessionResponse = sessionResponse;
    this.updates = updates;
    this.registrations = registrations;
  }
  /** @internal */
  static create(cx, sessionResponse, updates, registrations) {
    return new ActiveSession(cx, sessionResponse, updates, registrations);
  }
  /**
   * Session ID returned by `session/new`.
   */
  get sessionId() {
    return this.sessionResponse.sessionId;
  }
  /**
   * Mode state returned when the session was created, if the agent provided it.
   */
  get modes() {
    return this.sessionResponse.modes;
  }
  /**
   * Metadata returned when the session was created.
   */
  get meta() {
    return this.sessionResponse._meta;
  }
  /**
   * Full response returned by `session/new`.
   */
  get newSessionResponse() {
    return this.sessionResponse;
  }
  /**
   * Sends a prompt to this session.
   *
   * Strings are converted to one text content block. A single content block is
   * wrapped in an array. The returned promise resolves with the final
   * `PromptResponse`, and the same completion is also queued as a `stop`
   * message for `nextUpdate()`.
   */
  prompt(prompt, options) {
    this.updates.clearErrors();
    const response = this.cx.request(AGENT_METHODS.session_prompt, {
      sessionId: this.sessionId,
      prompt: this.promptBlocks(prompt)
    }, options);
    void response.then((value) => {
      this.updates.enqueue({
        kind: "stop",
        response: value,
        stopReason: value.stopReason
      });
    }, (error2) => {
      this.updates.reject(error2);
    });
    return response;
  }
  /**
   * Reads the next update or stop message for this session.
   */
  nextUpdate() {
    return this.updates.next();
  }
  /**
   * Reads text chunks until the current prompt turn stops.
   *
   * Only `agent_message_chunk` updates with text content are appended. Other
   * update types are ignored by this helper; use `nextUpdate()` when you need
   * tool calls, plans, or the final `PromptResponse`.
   */
  async readText() {
    let output = "";
    for (; ; ) {
      const message = await this.nextUpdate();
      if (message.kind === "stop") {
        return output;
      }
      const { update } = message;
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        output += update.content.text;
      }
    }
  }
  /**
   * Stops routing updates to this active-session helper.
   *
   * This does not close the ACP session on the agent. Use `ClientContext`
   * session lifecycle methods when the protocol session itself should be closed
   * or deleted.
   */
  dispose() {
    for (const registration of this.registrations.splice(0)) {
      registration.dispose();
    }
    this.updates.fail(new Error("Active session disposed"));
  }
  /**
   * Supports explicit resource management with `using`.
   */
  [Symbol.dispose]() {
    this.dispose();
  }
  promptBlocks(prompt) {
    if (typeof prompt === "string") {
      return [{ type: "text", text: prompt }];
    }
    if (Array.isArray(prompt)) {
      return prompt;
    }
    return [prompt];
  }
}
function parseParams(parser2, params) {
  if (!parser2) {
    return params;
  }
  if (typeof parser2 === "function") {
    return parser2(params);
  }
  return parser2.parse(params);
}
function requestSpec(method, params, mapResponse) {
  return { method, params, mapResponse };
}
function notificationSpec(method, params) {
  return { method, params };
}
function registerAppRequest(builder, spec, context, handler) {
  builder.onReceiveRequest(spec.method, (params) => parseParams(spec.params, params), async (params, responder, cx) => {
    const response = await handler(context(params, cx, responder.signal, responder.id));
    await responder.respond(spec.mapResponse ? spec.mapResponse(response) : response);
  });
}
function registerAppNotification(builder, spec, context, handler) {
  builder.onReceiveNotification(spec.method, (params) => parseParams(spec.params, params), (params, cx) => handler(context(params, cx, cx.signal)));
}
function specsByMethod(specs) {
  const byMethod = {};
  for (const spec of Object.values(specs)) {
    byMethod[spec.method] = spec;
  }
  return byMethod;
}
const agentRequestSpecs = {
  initialize: requestSpec(AGENT_METHODS.initialize, zInitializeRequest),
  newSession: requestSpec(AGENT_METHODS.session_new, zNewSessionRequest),
  loadSession: requestSpec(AGENT_METHODS.session_load, zLoadSessionRequest, emptyObjectResponse),
  unstable_forkSession: requestSpec(AGENT_METHODS.session_fork, zForkSessionRequest),
  listSessions: requestSpec(AGENT_METHODS.session_list, zListSessionsRequest),
  deleteSession: requestSpec(AGENT_METHODS.session_delete, zDeleteSessionRequest, emptyObjectResponse),
  resumeSession: requestSpec(AGENT_METHODS.session_resume, zResumeSessionRequest),
  closeSession: requestSpec(AGENT_METHODS.session_close, zCloseSessionRequest, emptyObjectResponse),
  setSessionMode: requestSpec(AGENT_METHODS.session_set_mode, zSetSessionModeRequest, emptyObjectResponse),
  setSessionConfigOption: requestSpec(AGENT_METHODS.session_set_config_option, zSetSessionConfigOptionRequest),
  authenticate: requestSpec(AGENT_METHODS.authenticate, zAuthenticateRequest, emptyObjectResponse),
  unstable_listProviders: requestSpec(AGENT_METHODS.providers_list, zListProvidersRequest),
  unstable_setProvider: requestSpec(AGENT_METHODS.providers_set, zSetProviderRequest, emptyObjectResponse),
  unstable_disableProvider: requestSpec(AGENT_METHODS.providers_disable, zDisableProviderRequest, emptyObjectResponse),
  logout: requestSpec(AGENT_METHODS.logout, zLogoutRequest, emptyObjectResponse),
  prompt: requestSpec(AGENT_METHODS.session_prompt, zPromptRequest),
  unstable_startNes: requestSpec(AGENT_METHODS.nes_start, zStartNesRequest),
  unstable_suggestNes: requestSpec(AGENT_METHODS.nes_suggest, zSuggestNesRequest),
  unstable_closeNes: requestSpec(AGENT_METHODS.nes_close, zCloseNesRequest, emptyObjectResponse)
};
const agentNotificationSpecs = {
  cancel: notificationSpec(AGENT_METHODS.session_cancel, zCancelNotification),
  unstable_didOpenDocument: notificationSpec(AGENT_METHODS.document_did_open, zDidOpenDocumentNotification),
  unstable_didChangeDocument: notificationSpec(AGENT_METHODS.document_did_change, zDidChangeDocumentNotification),
  unstable_didCloseDocument: notificationSpec(AGENT_METHODS.document_did_close, zDidCloseDocumentNotification),
  unstable_didSaveDocument: notificationSpec(AGENT_METHODS.document_did_save, zDidSaveDocumentNotification),
  unstable_didFocusDocument: notificationSpec(AGENT_METHODS.document_did_focus, zDidFocusDocumentNotification),
  unstable_acceptNes: notificationSpec(AGENT_METHODS.nes_accept, zAcceptNesNotification),
  unstable_rejectNes: notificationSpec(AGENT_METHODS.nes_reject, zRejectNesNotification)
};
const clientRequestSpecs = {
  requestPermission: requestSpec(CLIENT_METHODS.session_request_permission, zRequestPermissionRequest),
  writeTextFile: requestSpec(CLIENT_METHODS.fs_write_text_file, zWriteTextFileRequest, emptyObjectResponse),
  readTextFile: requestSpec(CLIENT_METHODS.fs_read_text_file, zReadTextFileRequest),
  createTerminal: requestSpec(CLIENT_METHODS.terminal_create, zCreateTerminalRequest),
  terminalOutput: requestSpec(CLIENT_METHODS.terminal_output, zTerminalOutputRequest),
  releaseTerminal: requestSpec(CLIENT_METHODS.terminal_release, zReleaseTerminalRequest, emptyObjectResponse),
  waitForTerminalExit: requestSpec(CLIENT_METHODS.terminal_wait_for_exit, zWaitForTerminalExitRequest),
  killTerminal: requestSpec(CLIENT_METHODS.terminal_kill, zKillTerminalRequest, emptyObjectResponse),
  createElicitation: requestSpec(CLIENT_METHODS.elicitation_create, zCreateElicitationRequest)
};
const clientNotificationSpecs = {
  sessionUpdate: notificationSpec(CLIENT_METHODS.session_update, zSessionNotification),
  completeElicitation: notificationSpec(CLIENT_METHODS.elicitation_complete, zCompleteElicitationNotification)
};
const agentRequestSpecsByMethod = specsByMethod(agentRequestSpecs);
specsByMethod(agentNotificationSpecs);
const clientRequestSpecsByMethod = specsByMethod(clientRequestSpecs);
const clientNotificationSpecsByMethod = specsByMethod(clientNotificationSpecs);
function clientRequestContext(params, agent, signal, requestId) {
  return {
    params,
    requestId,
    signal,
    agent
  };
}
function clientNotificationContext(params, agent, signal) {
  return {
    params,
    signal,
    agent
  };
}
class SessionUpdateRouter {
  activeSessions = /* @__PURE__ */ new Map();
  handleMessage(message) {
    if (message.kind !== "notification" || message.method !== CLIENT_METHODS.session_update) {
      return Handled.no(message);
    }
    const notification = zSessionNotification.parse(message.params);
    const update = {
      kind: "session_update",
      notification,
      update: notification.update
    };
    const activeSessions = this.activeSessions.get(notification.sessionId);
    if (activeSessions && activeSessions.size > 0) {
      for (const session of activeSessions) {
        session.enqueue(update);
      }
    }
    return Handled.no(message);
  }
  attach(response, updates) {
    const sessions = this.activeSessions.get(response.sessionId) ?? /* @__PURE__ */ new Set();
    sessions.add(updates);
    this.activeSessions.set(response.sessionId, sessions);
    return new HandlerRegistration(() => {
      sessions.delete(updates);
      if (sessions.size === 0) {
        this.activeSessions.delete(response.sessionId);
      }
    });
  }
}
const sessionUpdateRouters = /* @__PURE__ */ new WeakMap();
function sessionUpdateRouter(cx) {
  let router = sessionUpdateRouters.get(cx);
  if (!router) {
    router = new SessionUpdateRouter();
    sessionUpdateRouters.set(cx, router);
  }
  return router;
}
function runConnectHandlers(connection, handlers) {
  for (const handler of handlers) {
    let result;
    try {
      result = handler(connection);
    } catch (error2) {
      connection.close(error2);
      throw error2;
    }
    void Promise.resolve(result).catch((error2) => {
      connection.close(error2);
    });
  }
}
const appBuilder = /* @__PURE__ */ Symbol("appBuilder");
const runAgentConnectHandlers = /* @__PURE__ */ Symbol("runAgentConnectHandlers");
const runClientConnectHandlers = /* @__PURE__ */ Symbol("runClientConnectHandlers");
const stableConnectionOptions = { allowBatches: false };
function client(options) {
  return new ClientApp(options);
}
class ClientApp {
  builder = Connection.builder();
  connectHandlers = [];
  constructor(options = {}) {
    if (options.name) {
      this.builder.name(options.name);
    }
    this.builder.withHandler({
      handleMessage: (message, cx) => sessionUpdateRouter(cx).handleMessage(message),
      describe: () => "client-session-update-router"
    });
  }
  /** @internal */
  [appBuilder]() {
    return this.builder;
  }
  /** @internal */
  [runClientConnectHandlers](connection) {
    runConnectHandlers(connection, this.connectHandlers);
  }
  connect(target) {
    return this.connectConnection(target).connection;
  }
  connectWith(target, op) {
    const { rawConnection, connection } = this.connectConnection(target);
    return rawConnection.runUntil(() => op(connection.agent));
  }
  /**
   * Registers a handler that runs when this client app opens a connection.
   *
   * Use this for connection-scoped work that needs to call agent-side ACP
   * methods outside an inbound request handler.
   */
  onConnect(handler) {
    this.connectHandlers.push(handler);
    return this;
  }
  onRequest(method, handlerOrParams, handler) {
    if (handler) {
      return this.request({ method, params: handlerOrParams }, handler);
    }
    const spec = clientRequestSpecsByMethod[method];
    if (!spec) {
      throw new Error(`Unknown ACP request method '${method}'. Pass a params parser for custom methods.`);
    }
    return this.request(spec, handlerOrParams);
  }
  onNotification(method, handlerOrParams, handler) {
    if (handler) {
      return this.notification({ method, params: handlerOrParams }, handler);
    }
    const spec = clientNotificationSpecsByMethod[method];
    if (!spec) {
      throw new Error(`Unknown ACP notification method '${method}'. Pass a params parser for custom methods.`);
    }
    return this.notification(spec, handlerOrParams);
  }
  request(spec, handler) {
    registerAppRequest(this.builder, spec, (params, cx, signal, requestId) => clientRequestContext(params, ClientContext.create(cx, requestId), signal, requestId), handler);
    return this;
  }
  notification(spec, handler) {
    registerAppNotification(this.builder, spec, (params, cx, signal) => clientNotificationContext(params, ClientContext.create(cx), signal), handler);
    return this;
  }
  connectConnection(target) {
    if (isStream(target)) {
      const state2 = this.openStreamConnection(target);
      this[runClientConnectHandlers](state2.connection);
      return state2;
    }
    const [thisStream, peerStream] = memoryStreamPair();
    const peerRawConnection = target[appBuilder]().connect(peerStream, stableConnectionOptions);
    const peerConnection = agentConnection(peerRawConnection);
    const state = this.openStreamConnection(thisStream);
    void state.rawConnection.closed.then(() => peerConnection.close());
    void peerRawConnection.closed.then(() => state.connection.close());
    try {
      target[runAgentConnectHandlers](peerConnection);
      this[runClientConnectHandlers](state.connection);
    } catch (error2) {
      peerConnection.close(error2);
      state.connection.close(error2);
      throw error2;
    }
    return state;
  }
  openStreamConnection(stream) {
    const rawConnection = this.builder.connect(stream, stableConnectionOptions);
    return {
      rawConnection,
      connection: clientConnection(rawConnection, this.connectHandlers)
    };
  }
}
const AUTH_STATUS_UPDATE_METHOD = "_auth/status_update";
function defaultClientCapabilities() {
  return {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: false,
    auth: { terminal: true }
  };
}
function spawnAgent(launch, stderr = "pipe") {
  const child = node_child_process.spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env ?? {} },
    stdio: ["pipe", "pipe", stderr],
    windowsHide: true
  });
  const input = node_stream.Writable.toWeb(child.stdin);
  const output = node_stream.Readable.toWeb(child.stdout);
  const stream = ndJsonStream(input, output);
  const exited = new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, stream, exited, kill: () => {
    if (!child.killed) child.kill();
  } };
}
function buildClientApp(identity2, handlers) {
  let app = client({ name: identity2.name }).onRequest(methods.client.session.requestPermission, async (ctx) => {
    const decision = await handlers.permission(ctx.params);
    return { outcome: decision };
  });
  if (handlers.fs) {
    const fs = handlers.fs;
    app = app.onRequest(methods.client.fs.readTextFile, (ctx) => fs.readTextFile(ctx.params)).onRequest(methods.client.fs.writeTextFile, (ctx) => fs.writeTextFile(ctx.params));
  }
  if (handlers.authStatus) {
    const onStatus = handlers.authStatus;
    app = app.onNotification(
      AUTH_STATUS_UPDATE_METHOD,
      (raw) => raw,
      (ctx) => {
        if (ctx.params?.authStatus) onStatus(ctx.params.authStatus);
      }
    );
  }
  return app;
}
async function initialize(ctx, identity2) {
  return ctx.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: defaultClientCapabilities(),
    clientInfo: { name: identity2.name, title: identity2.title ?? identity2.name, version: identity2.version ?? "0.0.0" }
  });
}
function terminalLoginCommand(launch, method) {
  if (!("type" in method) || method.type !== "terminal") return null;
  return {
    command: launch.command,
    args: [...launch.args, ...method.args ?? []],
    env: { ...launch.env ?? {}, ...method.env ?? {} },
    cwd: launch.cwd
  };
}
async function setConfigOption(ctx, sessionId, configId, value) {
  const params = typeof value === "boolean" ? { sessionId, configId, type: "boolean", value } : { sessionId, configId, value };
  const res = await ctx.request(methods.agent.session.setConfigOption, params);
  return res.configOptions ?? [];
}
function authMethodKind(method) {
  return "type" in method && method.type === "terminal" ? "terminal" : "agent";
}
function text(t) {
  return { type: "text", text: t };
}
function embeddedText(uri, contents, mimeType = "text/markdown") {
  return { type: "resource", resource: { uri, text: contents, mimeType } };
}
function resourceLink(uri, name, mimeType = "text/markdown") {
  return { type: "resource_link", uri, name, mimeType };
}
async function* promptTurn(session, blocks) {
  let promptError = null;
  const pending = session.prompt(blocks).catch((err) => {
    promptError = err;
    return null;
  });
  for (; ; ) {
    let message;
    try {
      message = await session.nextUpdate();
    } catch (err) {
      if (promptError) throw promptError;
      throw err;
    }
    if (message.kind === "stop") {
      yield { type: "stop", stopReason: message.response.stopReason, response: message.response };
      return message.response;
    }
    const u = message.update;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content.type === "text") yield { type: "text", text: u.content.text };
        else yield { type: "other", update: u };
        break;
      case "agent_thought_chunk":
        if (u.content.type === "text") yield { type: "thought", text: u.content.text };
        break;
      case "tool_call":
        yield {
          type: "tool_call",
          id: u.toolCallId,
          title: u.title,
          kind: u.kind ?? void 0,
          status: u.status ?? void 0,
          locations: (u.locations ?? []).map((l) => l.path),
          rawInput: u.rawInput
        };
        break;
      case "tool_call_update":
        yield { type: "tool_call_update", id: u.toolCallId, title: u.title ?? void 0, status: u.status ?? void 0 };
        break;
      case "config_option_update":
        yield { type: "config_options", options: u.configOptions };
        break;
      case "usage_update":
        yield { type: "usage", usage: u };
        break;
      default:
        yield { type: "other", update: u };
    }
    if (promptError) {
      await pending;
      throw promptError;
    }
  }
}
const PREAMBLE = "You are helping the reader understand a source in this collection (see AGENTS.md). Cite pages as [p.N] using the <!-- page N --> markers in the source's text.md. Write maths as LaTeX with $…$ and $$…$$. Keep answers scoped to the question; the reader will branch if they want more. Do not modify anything under threads/ or sources/.";
const CONTEXT_CHARS = 700;
const HISTORY_CHARS = 6e3;
function textUri(collection, sourceId) {
  return node_url.pathToFileURL(node_path.join(collection, "sources", sourceId, "text.md")).href;
}
function passageBlocks(collection, anchor2, label) {
  if (!anchor2.source) return [text(`${label}:
${anchor2.quote}`)];
  const uri = textUri(collection, anchor2.source);
  const page = anchor2.page ? ` (p.${anchor2.page})` : "";
  const blocks = [embeddedText(`${uri}#quote`, `${label}${page}:
${anchor2.quote}`)];
  const full = readSourceText(collection, anchor2.source);
  if (full && anchor2.end > anchor2.start && anchor2.end <= full.length) {
    const before = full.slice(Math.max(0, anchor2.start - CONTEXT_CHARS), anchor2.start);
    const after = full.slice(anchor2.end, anchor2.end + CONTEXT_CHARS);
    blocks.push(text(`Surrounding text from text.md${page}:
…${before}[[${anchor2.quote}]]${after}…`));
  }
  blocks.push(resourceLink(uri, `sources/${anchor2.source}/text.md`));
  return blocks;
}
function historyBlock(thread, intro = "Earlier in this thread (for context, do not repeat it)") {
  if (thread.messages.length === 0) return null;
  const parts = [];
  for (const m of thread.messages) {
    const who = m.role === "user" ? "Reader" : m.role === "assistant" ? "You" : "Note";
    const quote = m.quote ? `[quoting ${m.quote.page ? `p.${m.quote.page}` : "a passage"}: ${m.quote.quote}]
` : "";
    parts.push(`${who}: ${quote}${m.body}`);
  }
  let joined = parts.join("\n\n");
  if (joined.length > HISTORY_CHARS) joined = "…" + joined.slice(-HISTORY_CHARS);
  return text(`${intro}:

${joined}`);
}
function paragraphAround(body, quote) {
  const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const target = norm(quote);
  for (const para of body.split(/\n{2,}/)) if (norm(para).includes(target)) return para.trim();
  return "";
}
function branchIntroBlocks(parent, branch, handoff2) {
  const blocks = [];
  const parentMsg = parent.messages.find((m) => m.id === branch.parent?.message);
  blocks.push(text(`This thread branches from a passage inside an earlier answer in the thread "${parent.title}". The reader wants to explore that passage on its own.`));
  if (handoff2) blocks.push(text(`Handoff from the assistant in the parent thread:

${handoff2}`));
  else {
    const h = historyBlock(parent, "The parent thread so far (for context)");
    if (h) blocks.push(h);
  }
  if (branch.anchor) {
    const para = parentMsg ? paragraphAround(parentMsg.body, branch.anchor.quote) : "";
    blocks.push(text(`The passage being explored, from the parent's answer:
${branch.anchor.quote}${para && para !== branch.anchor.quote ? `

Its surrounding paragraph:
${para}` : ""}`));
  }
  return blocks;
}
function handoffPrompt(selection) {
  return `The reader is about to explore "${selection}" in a separate thread. Write a handoff for a fresh assistant that has no access to this conversation: (1) what this thread is about and which source passage it started from; (2) what has been established so far, in 3–6 sentences; (3) what "${selection}" means in the context of your answer, in 1–3 sentences; (4) what the reader already seems to understand and what they seem to be missing. Reply with the handoff only.`;
}
const SUMMARY_PROMPT = "Summarise what this thread has established, for someone who has not read it, in 2–3 sentences. Then on a new line write `Tags:` followed by 1–5 short concept tags separated by commas. Reply with nothing else.";
function parseSummary(reply) {
  const m = /\n\s*tags?\s*:\s*(.+)$/i.exec(reply.trim());
  if (!m) return { text: reply.trim(), concepts: [] };
  const concepts = m[1].split(/[,;]/).map((s) => s.trim().replace(/^[-*]\s*/, "")).filter(Boolean).slice(0, 5);
  return { text: reply.slice(0, m.index).trim(), concepts };
}
function branchContextBlock(items) {
  if (items.length === 0) return null;
  const lines = items.map((b) => `• The reader explored "${b.title}" in a branch. ${b.digest}`);
  return text(`Since your last turn, in branches of this thread:
${lines.join("\n\n")}`);
}
function buildPromptBlocks(collection, thread, body, quote, priorTurns, extras = {}) {
  const blocks = [];
  if (priorTurns === 0) {
    blocks.push(text(PREAMBLE));
    if (extras.intro) blocks.push(...extras.intro);
    const history = historyBlock(thread);
    if (history) blocks.push(history);
    if (thread.anchor?.target === "source") blocks.push(...passageBlocks(collection, thread.anchor, "The reader started this thread from this passage"));
  }
  if (extras.branchContext) blocks.push(extras.branchContext);
  if (quote && quote.target === "source") blocks.push(...passageBlocks(collection, quote, "The reader highlighted this passage"));
  const question = body.trim() || (quote ? "Explain this passage." : "");
  if (question) blocks.push(text(question));
  return blocks;
}
function childrenOf(all, id) {
  return all.filter((t) => t.parent?.thread === id).sort((a, b) => a.created < b.created ? -1 : 1);
}
function subtreeLastActivity(collection, all, id) {
  let latest = "";
  const t = readThread(collection, id);
  for (const m of t?.messages ?? []) if (m.at > latest) latest = m.at;
  for (const c of childrenOf(all, id)) {
    const l = subtreeLastActivity(collection, all, c.id);
    if (l > latest) latest = l;
  }
  return latest;
}
const DIGEST_CHARS = 900;
function branchDigest(branch) {
  const last = branch.messages[branch.messages.length - 1];
  if (branch.summary && last && branch.summary.through === last.id) {
    const tags2 = branch.summary.concepts.length ? ` (concepts: ${branch.summary.concepts.join(", ")})` : "";
    return `${branch.summary.text}${tags2}`;
  }
  const firstUser = branch.messages.find((m) => m.role === "user");
  const lastAssistant = [...branch.messages].reverse().find((m) => m.role === "assistant");
  const parts = [];
  if (firstUser) parts.push(`They asked: ${firstUser.body.slice(0, 300)}`);
  if (lastAssistant) parts.push(`Latest answer: ${lastAssistant.body.slice(0, DIGEST_CHARS)}${lastAssistant.body.length > DIGEST_CHARS ? "…" : ""}`);
  return parts.join("\n") || "(no messages yet)";
}
function dirtyBranches(collection, parent, all) {
  const out = [];
  for (const child of childrenOf(all, parent.id)) {
    const lastActivity = subtreeLastActivity(collection, all, child.id);
    if (!lastActivity) continue;
    let lastTold = "";
    for (const m of parent.messages) if (m.context?.includes(child.id) && m.at > lastTold) lastTold = m.at;
    if (lastActivity <= lastTold) continue;
    const full = readThread(collection, child.id);
    if (!full) continue;
    out.push({ branch: full, digest: branchDigest(full) });
  }
  return out;
}
const IDENTITY = { name: "qrabbit", title: "QRabbit", version: electron.app.getVersion() };
const HANDOFF_WAIT_MS = 2e4;
const SUMMARY_DELAY_MS = 1500;
function adapterEntry() {
  try {
    return require.resolve("@agentclientprotocol/claude-agent-acp/dist/index.js");
  } catch {
    return node_path.join(electron.app.getAppPath(), "node_modules", "@agentclientprotocol", "claude-agent-acp", "dist", "index.js");
  }
}
function claudeLaunch(collection) {
  return {
    command: process.execPath,
    args: [adapterEntry()],
    env: { ELECTRON_RUN_AS_NODE: "1", ELECTRON_NO_ATTACH_CONSOLE: "1" },
    cwd: collection
  };
}
function flattenOptions(options) {
  return (options ?? []).map((o) => {
    if (o.type === "select") {
      const flat = [];
      for (const entry of o.options) {
        if ("group" in entry) for (const v of entry.options) flat.push({ value: v.value, name: v.name, description: v.description, group: entry.name });
        else flat.push({ value: entry.value, name: entry.name, description: entry.description });
      }
      return { id: o.id, name: o.name, category: o.category ?? null, type: "select", currentValue: o.currentValue, options: flat };
    }
    return { id: o.id, name: o.name, category: o.category ?? null, type: "boolean", currentValue: o.currentValue };
  });
}
function deferred() {
  let resolve2;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve2 = res;
    reject = rej;
  });
  return { promise, resolve: resolve2, reject };
}
function agentShortName(reported) {
  if (!reported) return "claude-code";
  if (/claude/i.test(reported)) return "claude-code";
  if (/codex/i.test(reported)) return "codex";
  if (/copilot/i.test(reported)) return "copilot";
  return reported.replace(/^@[^/]+\//, "").replace(/-acp$/, "");
}
function loginArgs(methodId) {
  if (methodId === "console-login") return ["--cli", "auth", "login", "--console"];
  return ["--cli", "auth", "login", "--claudeai"];
}
class AgentHost {
  constructor(collection, emit) {
    this.collection = collection;
    this.emit = emit;
  }
  collection;
  emit;
  status = { connected: false, auth: null, authMethods: [] };
  agent = null;
  ctx = null;
  closed = deferred();
  connecting = null;
  sessions = /* @__PURE__ */ new Map();
  threadBySession = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  running = /* @__PURE__ */ new Map();
  handoffs = /* @__PURE__ */ new Map();
  summaryTimers = /* @__PURE__ */ new Map();
  permSeq = 0;
  // ---------- paths ----------
  inside(p) {
    const rel = node_path.relative(this.collection, node_path.resolve(this.collection, p));
    return rel !== "" && !rel.startsWith("..") && !node_path.isAbsolute(rel);
  }
  underNotes(p) {
    return this.inside(p) && node_path.relative(this.collection, node_path.resolve(this.collection, p)).split(node_path.sep)[0] === "notes";
  }
  // ---------- lifecycle ----------
  connect() {
    if (this.status.connected) return Promise.resolve(this.status);
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  async doConnect() {
    const launch = claudeLaunch(this.collection);
    this.closed = deferred();
    const agent = spawnAgent(launch, "pipe");
    this.agent = agent;
    agent.child.stderr?.on("data", (d) => {
      const s = d.toString().trim();
      if (s) console.log(`[agent] ${s}`);
    });
    void agent.exited.then(() => {
      this.status = { ...this.status, connected: false };
      this.sessions.clear();
      this.emit.status(this.collection, this.status);
    });
    const client2 = buildClientApp(IDENTITY, {
      permission: (req) => this.onPermission(req),
      authStatus: (s) => {
        this.status = { ...this.status, auth: { kind: s.kind, label: s.label } };
        this.emit.status(this.collection, this.status);
      },
      fs: {
        readTextFile: async (p) => {
          if (!this.inside(p.path)) throw new Error("Reading outside the collection is not allowed");
          return { content: node_fs.readFileSync(p.path, "utf8") };
        },
        writeTextFile: async (p) => {
          if (!this.underNotes(p.path)) throw new Error("Only notes/ is writable");
          node_fs.mkdirSync(node_path.dirname(p.path), { recursive: true });
          node_fs.writeFileSync(p.path, p.content);
          return {};
        }
      }
    });
    const ready = deferred();
    client2.connectWith(agent.stream, async (ctx) => {
      this.ctx = ctx;
      const init = await initialize(ctx, IDENTITY);
      this.status = {
        connected: true,
        agent: { name: init.agentInfo?.name ?? "agent", version: init.agentInfo?.version ?? void 0 },
        auth: this.status.auth,
        authMethods: (init.authMethods ?? []).filter((m) => authMethodKind(m) === "terminal").map((m) => ({ id: m.id, name: m.name, description: m.description }))
      };
      this.emit.status(this.collection, this.status);
      ready.resolve(this.status);
      await this.closed.promise;
    }).catch((err) => {
      this.status = { connected: false, auth: null, authMethods: [], error: String(err?.message ?? err) };
      this.emit.status(this.collection, this.status);
      ready.reject(err);
    });
    return ready.promise;
  }
  async dispose() {
    this.closed.resolve();
    for (const cancel of this.running.values()) cancel();
    for (const reply of this.pending.values()) reply({ outcome: "cancelled" });
    for (const t of this.summaryTimers.values()) clearTimeout(t);
    this.pending.clear();
    this.summaryTimers.clear();
    this.agent?.kill();
    this.agent = null;
    this.ctx = null;
    this.sessions.clear();
    this.status = { connected: false, auth: null, authMethods: [] };
  }
  // ---------- sessions ----------
  async ensureSession(threadId) {
    const existing = this.sessions.get(threadId);
    if (existing) return existing;
    await this.connect();
    if (!this.ctx) throw new Error("Agent is not connected");
    const session = await this.ctx.buildSession(this.collection).start();
    const entry = { session, configOptions: flattenOptions(session.newSessionResponse.configOptions), turns: 0, lock: Promise.resolve() };
    this.sessions.set(threadId, entry);
    this.threadBySession.set(session.sessionId, threadId);
    const thread = readThread(this.collection, threadId);
    for (const [id, value] of [["model", thread?.model], ["effort", thread?.effort]]) {
      const opt = entry.configOptions.find((o) => o.id === id);
      if (value && opt && opt.currentValue !== value) {
        try {
          entry.configOptions = flattenOptions(await setConfigOption(this.ctx, session.sessionId, id, value));
        } catch (err) {
          console.warn(`[agent] could not restore ${id}=${value}:`, err);
        }
      }
    }
    return entry;
  }
  /** Run `fn` when the session is free; the reader's turns and hidden work never overlap. */
  withSession(entry, fn) {
    const run = entry.lock.then(fn, fn);
    entry.lock = run.then(() => void 0, () => void 0);
    return run;
  }
  async setConfig(threadId, configId, value) {
    const entry = await this.ensureSession(threadId);
    if (!this.ctx) throw new Error("Agent is not connected");
    entry.configOptions = flattenOptions(await setConfigOption(this.ctx, entry.session.sessionId, configId, value));
    if (typeof value === "string" && (configId === "model" || configId === "effort")) updateThread(this.collection, threadId, { [configId]: value });
    return entry.configOptions;
  }
  /** A turn whose output goes nowhere but the return value: handoffs and summaries. */
  async runHidden(entry, blocks) {
    return this.withSession(entry, async () => {
      entry.turns += 1;
      let out = "";
      for await (const ev of promptTurn(entry.session, blocks)) if (ev.type === "text") out += ev.text;
      return out.trim();
    });
  }
  // ---------- branches (plan §5.5) ----------
  /** Create the branch file at once and let the parent session write the handoff behind it. */
  branch(parentId, messageId, anchor2) {
    const parent = readThread(this.collection, parentId);
    if (!parent) throw new Error(`Unknown thread: ${parentId}`);
    const title = titleFromQuote(anchor2.quote);
    const branch = createThread(this.collection, {
      title,
      anchor: { ...anchor2, target: "message", thread: parentId, message: messageId },
      parent: { thread: parentId, message: messageId },
      ...parent.model ? { model: parent.model } : {},
      ...parent.effort ? { effort: parent.effort } : {}
    });
    const job = this.writeHandoff(parent, branch).catch((err) => console.warn("[agent] handoff failed:", err));
    this.handoffs.set(branch.id, job);
    void job.finally(() => this.handoffs.delete(branch.id));
    return branch;
  }
  async writeHandoff(parent, branch) {
    const entry = await this.ensureSession(parent.id);
    const blocks = [];
    if (entry.turns === 0) {
      blocks.push(text(PREAMBLE));
      const h = historyBlock(parent, "This thread so far");
      if (h) blocks.push(h);
    }
    blocks.push(text(handoffPrompt(branch.anchor?.quote ?? branch.title)));
    const handoff2 = await this.runHidden(entry, blocks);
    if (!handoff2) return;
    updateThread(this.collection, branch.id, { handoff: handoff2 });
    this.emit.event(branch.id, { type: "handoff", text: handoff2 });
  }
  /** After a branch turn, summarise the branch for its ancestors while its session is warm. */
  scheduleSummary(threadId) {
    const prev = this.summaryTimers.get(threadId);
    if (prev) clearTimeout(prev);
    this.summaryTimers.set(
      threadId,
      setTimeout(() => {
        this.summaryTimers.delete(threadId);
        void this.writeSummary(threadId).catch((err) => console.warn("[agent] summary failed:", err));
      }, SUMMARY_DELAY_MS)
    );
  }
  async writeSummary(threadId) {
    const entry = this.sessions.get(threadId);
    const thread = readThread(this.collection, threadId);
    if (!entry || !thread || thread.messages.length === 0) return;
    const last = thread.messages[thread.messages.length - 1];
    if (thread.summary?.through === last.id) return;
    const reply = await this.runHidden(entry, [text(SUMMARY_PROMPT)]);
    if (!reply) return;
    const { text: summary, concepts } = parseSummary(reply);
    updateThread(this.collection, threadId, { summary: { at: (/* @__PURE__ */ new Date()).toISOString(), through: last.id, text: summary, concepts } });
  }
  // ---------- turns ----------
  async prompt(threadId, body, quote) {
    const before = readThread(this.collection, threadId);
    if (!before) throw new Error(`Unknown thread: ${threadId}`);
    const entry = await this.ensureSession(threadId);
    if (!this.ctx) throw new Error("Agent is not connected");
    let intro;
    if (entry.turns === 0 && before.parent) {
      const pending = this.handoffs.get(threadId);
      if (pending) await Promise.race([pending, new Promise((r) => setTimeout(r, HANDOFF_WAIT_MS))]);
      const fresh = readThread(this.collection, threadId) ?? before;
      const parent = readThread(this.collection, before.parent.thread);
      if (parent) intro = branchIntroBlocks(parent, fresh, fresh.handoff);
    }
    const dirty = dirtyBranches(this.collection, before, listThreads(this.collection));
    const branchContext = branchContextBlock(dirty.map((d) => ({ title: d.branch.title, digest: d.digest })));
    appendMessage(this.collection, threadId, {
      role: "user",
      body: body.trim(),
      ...quote ? { quote } : {},
      ...dirty.length ? { context: dirty.map((d) => d.branch.id) } : {}
    });
    const blocks = buildPromptBlocks(this.collection, before, body, quote, entry.turns, { intro, branchContext });
    const sessionId = entry.session.sessionId;
    this.running.set(threadId, () => {
      void this.ctx?.notify(methods.agent.session.cancel, { sessionId });
    });
    let reply = "";
    try {
      await this.withSession(entry, async () => {
        entry.turns += 1;
        for await (const ev of promptTurn(entry.session, blocks)) {
          switch (ev.type) {
            case "text":
              reply += ev.text;
              this.emit.event(threadId, { type: "text", text: ev.text });
              break;
            case "thought":
              this.emit.event(threadId, { type: "thought", text: ev.text });
              break;
            case "tool_call": {
              if (reply && !/\n\s*$/.test(reply)) {
                reply += "\n\n";
                this.emit.event(threadId, { type: "text", text: "\n\n" });
              }
              const paths = [...ev.locations ?? []];
              const raw = ev.rawInput;
              for (const k of ["file_path", "path", "notebook_path"]) if (typeof raw?.[k] === "string") paths.push(raw[k]);
              this.emit.event(threadId, { type: "tool_call", id: ev.id, title: ev.title, kind: ev.kind, status: ev.status, paths });
              break;
            }
            case "tool_call_update":
              this.emit.event(threadId, { type: "tool_call_update", id: ev.id, title: ev.title, status: ev.status });
              break;
            case "config_options":
              entry.configOptions = flattenOptions(ev.options);
              this.emit.event(threadId, { type: "config_options", options: entry.configOptions });
              break;
            case "stop":
              this.emit.event(threadId, { type: "stop", stopReason: ev.stopReason });
              break;
            default:
              break;
          }
        }
      });
    } catch (err) {
      const message = String(err?.message ?? err);
      this.emit.event(threadId, { type: "error", message });
      if (!reply.trim()) reply = `*The agent could not answer: ${message}*`;
    } finally {
      this.running.delete(threadId);
    }
    if (reply.trim()) appendMessage(this.collection, threadId, { role: "assistant", body: reply.trimEnd() });
    const model = entry.configOptions.find((o) => o.id === "model");
    updateThread(this.collection, threadId, {
      agent: agentShortName(this.status.agent?.name),
      ...model && typeof model.currentValue === "string" ? { model: model.currentValue } : {}
    });
    if (before.parent) this.scheduleSummary(threadId);
    return readThread(this.collection, threadId);
  }
  cancel(threadId) {
    this.running.get(threadId)?.();
  }
  // ---------- permissions (plan §5.6) ----------
  onPermission(req) {
    const tc = req.toolCall;
    const paths = [];
    for (const loc of tc.locations ?? []) paths.push(loc.path);
    const raw = tc.rawInput;
    for (const k of ["file_path", "path", "notebook_path"]) if (typeof raw?.[k] === "string") paths.push(raw[k]);
    const pick2 = (kind) => req.options.find((o) => o.kind === kind) ?? req.options.find((o) => o.kind.startsWith(kind.split("_")[0]));
    const isWrite = tc.kind === "edit" || tc.kind === "delete" || tc.kind === "move";
    if (tc.kind === "read" && paths.length > 0 && paths.every((p) => this.inside(p))) {
      const o = pick2("allow_once");
      if (o) return { outcome: "selected", optionId: o.optionId };
    }
    if (isWrite && paths.length > 0 && paths.every((p) => this.underNotes(p))) {
      const o = pick2("allow_once");
      if (o) return { outcome: "selected", optionId: o.optionId };
    }
    const threadId = this.threadBySession.get(req.sessionId) ?? "";
    const id = `perm_${++this.permSeq}`;
    return new Promise((resolve2) => {
      this.pending.set(id, resolve2);
      this.emit.permission({
        id,
        threadId,
        title: tc.title ?? "(untitled tool call)",
        kind: tc.kind ?? void 0,
        paths,
        options: req.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind }))
      });
    });
  }
  replyPermission(requestId, optionId) {
    const resolve2 = this.pending.get(requestId);
    if (!resolve2) return;
    this.pending.delete(requestId);
    resolve2(optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" });
  }
  // ---------- sign-in ----------
  /** Open the agent's own login in a terminal window. The app never sees a credential. */
  login(methodId) {
    const method = this.status.authMethods.find((m) => m.id === methodId);
    const launch = claudeLaunch(this.collection);
    const cmd = terminalLoginCommand(launch, { id: methodId, name: method?.name ?? methodId, type: "terminal", args: loginArgs(methodId) });
    if (!cmd) return;
    const dir = node_path.join(electron.app.getPath("userData"), "login");
    node_fs.mkdirSync(dir, { recursive: true });
    const quote = (s) => `"${s.replace(/"/g, '\\"')}"`;
    if (process.platform === "win32") {
      const script = node_path.join(dir, "sign-in.cmd");
      const envLines = Object.entries(cmd.env ?? {}).map(([k, v]) => `set ${k}=${v}`).join("\r\n");
      node_fs.writeFileSync(script, `@echo off\r
title QRabbit sign-in\r
${envLines}\r
${quote(cmd.command)} ${cmd.args.map(quote).join(" ")}\r
echo.\r
echo Done. You can close this window and return to QRabbit.\r
pause\r
`);
      node_child_process.spawn("cmd.exe", ["/c", "start", "QRabbit sign-in", script], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    } else {
      const script = node_path.join(dir, "sign-in.command");
      const envLines = Object.entries(cmd.env ?? {}).map(([k, v]) => `export ${k}=${quote(v)}`).join("\n");
      node_fs.writeFileSync(script, `#!/bin/bash
${envLines}
${quote(cmd.command)} ${cmd.args.map(quote).join(" ")}
echo
echo "Done. You can close this window and return to QRabbit."
read -r
`, { mode: 493 });
      const opener = process.platform === "darwin" ? ["open", ["-a", "Terminal", script]] : ["x-terminal-emulator", ["-e", `bash ${quote(script)}`]];
      node_child_process.spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).unref();
    }
  }
}
function titleFromQuote(quote, max = 60) {
  const one = quote.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > 30 ? cut.slice(0, at) : cut) + "…";
}
const opened = /* @__PURE__ */ new Set();
const hosts = /* @__PURE__ */ new Map();
const broadcast = (channel, ...args) => {
  for (const w of electron.BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
};
const emitter = {
  event: (threadId, event) => broadcast("agent:event", threadId, event),
  permission: (request) => broadcast("agent:permission", request),
  status: (collection, status) => broadcast("agent:status", collection, status)
};
function host(collection) {
  guard(collection);
  let h = hosts.get(collection);
  if (!h) {
    h = new AgentHost(collection, emitter);
    hosts.set(collection, h);
  }
  return h;
}
async function disposeAgents() {
  await Promise.all([...hosts.values()].map((h) => h.dispose()));
  hosts.clear();
}
function guard(path) {
  if (!opened.has(path)) throw new Error("Collection is not open");
  return path;
}
function snapshot(path) {
  const { info, manifest } = openCollection(path);
  opened.add(path);
  touchRecent(info);
  return { info, manifest, sources: listSources(path), threads: listThreads(path), readerState: readReaderState(path) };
}
const windowOf = (e) => electron.BrowserWindow.fromWebContents(e.sender) ?? void 0;
function registerIpc() {
  electron.ipcMain.handle("collections:recent", () => recentCollections());
  electron.ipcMain.handle("collections:open", (_e, path) => snapshot(path));
  electron.ipcMain.handle("collections:forget", (_e, path) => forgetRecent(path));
  electron.ipcMain.handle("collections:openDialog", async (e) => {
    const win = windowOf(e);
    const r = await electron.dialog.showOpenDialog(win, {
      title: "Open a collection folder (or pick an empty folder to start one)",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Open collection"
    });
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return null;
    return snapshot(dir);
  });
  electron.ipcMain.handle("sources:importDialog", async (e, collection) => {
    guard(collection);
    const win = windowOf(e);
    const r = await electron.dialog.showOpenDialog(win, {
      title: "Add sources",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "PDF and Markdown", extensions: ["pdf", "md", "markdown", "txt"] },
        { name: "PDF", extensions: ["pdf"] },
        { name: "Markdown", extensions: ["md", "markdown", "txt"] }
      ],
      buttonLabel: "Add"
    });
    if (r.canceled) return listSources(collection);
    for (const f of r.filePaths) {
      try {
        importFile(collection, f);
      } catch (err) {
        console.error(`import failed for ${node_path.basename(f)}:`, err);
      }
    }
    return listSources(collection);
  });
  electron.ipcMain.handle("sources:readBytes", (_e, collection, id) => readSourceBytes(guard(collection), id));
  electron.ipcMain.handle("sources:readText", (_e, collection, id) => readSourceText(guard(collection), id));
  electron.ipcMain.handle(
    "sources:saveText",
    (_e, collection, id, text2, pages, title) => saveSourceText(guard(collection), id, text2, pages, title)
  );
  electron.ipcMain.handle("threads:list", (_e, collection) => listThreads(guard(collection)));
  electron.ipcMain.handle("threads:read", (_e, collection, id) => readThread(guard(collection), id));
  electron.ipcMain.handle(
    "threads:create",
    (_e, collection, input) => createThread(guard(collection), input)
  );
  electron.ipcMain.handle(
    "threads:appendMessage",
    (_e, collection, id, message) => appendMessage(guard(collection), id, message)
  );
  electron.ipcMain.handle("reader:setPosition", (_e, collection, sourceId, position) => {
    setReaderPosition(guard(collection), sourceId, position);
  });
  electron.ipcMain.handle("agent:status", (_e, collection) => host(collection).status);
  electron.ipcMain.handle("agent:connect", (_e, collection) => host(collection).connect());
  electron.ipcMain.handle("agent:session", async (_e, collection, threadId) => {
    const entry = await host(collection).ensureSession(threadId);
    return { configOptions: entry.configOptions };
  });
  electron.ipcMain.handle(
    "agent:prompt",
    (_e, collection, threadId, body, quote) => host(collection).prompt(threadId, body, quote)
  );
  electron.ipcMain.handle("agent:cancel", (_e, collection, threadId) => host(collection).cancel(threadId));
  electron.ipcMain.handle(
    "agent:branch",
    (_e, collection, parentId, messageId, anchor2) => host(collection).branch(parentId, messageId, anchor2)
  );
  electron.ipcMain.handle(
    "agent:setConfig",
    (_e, collection, threadId, configId, value) => host(collection).setConfig(threadId, configId, value)
  );
  electron.ipcMain.handle("agent:replyPermission", (_e, requestId, optionId) => {
    for (const h of hosts.values()) h.replyPermission(requestId, optionId);
  });
  electron.ipcMain.handle("agent:login", (_e, collection, methodId) => host(collection).login(methodId));
  electron.ipcMain.handle("app:version", () => electron.app.getVersion());
  electron.ipcMain.handle("app:platform", () => process.platform);
}
const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: "#121417",
    titleBarStyle: "hidden",
    ...process.platform === "win32" ? { titleBarOverlay: { color: "#121417", symbolColor: "#a3a8b0", height: 44 } } : {},
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.on("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url: url2 }) => {
    void electron.shell.openExternal(url2);
    return { action: "deny" };
  });
  if (rendererUrl) void win.loadURL(rendererUrl);
  else void win.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  return win;
}
void electron.app.whenReady().then(() => {
  registerIpc();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", () => {
  void disposeAgents();
});
