import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { atomicWriteFile } from "../config";

interface HistoryNode {
  id: string;
  parent?: HistoryNode;
  itemJson: string;
  count: number;
  chainBytes: number;
  bytes: number;
  payloadBytes: number;
  snapshotBytes: number;
  refs: number;
}
interface ResponseRoot { createdAt: number; head?: HistoryNode }
type NodeRow = [string, { parent: string | null; itemJson: string }];
type RootRow = [string, { createdAt: number; head: string | null }];

export interface ResponseHistoryOptions {
  path?: string;
  now?: () => number;
  ttlMs?: number;
  maxResponses?: number;
  maxBytes?: number;
  maxNodes?: number;
  snapshotNodeMaxBytes?: number;
  snapshotMaxBytes?: number;
}

const HASH = /^[a-f0-9]{64}$/;
const NODE_OVERHEAD_BYTES = 160;
const record = (value: unknown): Record<string, unknown> | undefined => value !== null
  && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const nodeId = (parent: string | undefined, itemJson: string) => createHash("sha256")
  .update(parent ?? "root").update("\0").update(itemJson).digest("hex");
const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

/** Immutable, shared history prefixes; response IDs are independently expiring roots. */
export class ResponseHistoryStore {
  private readonly roots = new Map<string, ResponseRoot>();
  private readonly nodes = new Map<string, HistoryNode>();
  private loaded = false;
  private bytes = 0;
  private payloadBytes = 0;
  private readonly clock: () => number;
  private readonly ttlMs: number;
  private readonly maxResponses: number;
  private readonly maxBytes: number;
  private readonly maxNodes: number;
  private readonly snapshotNodeMaxBytes: number;
  private readonly snapshotMaxBytes: number;

  constructor(private readonly options: ResponseHistoryOptions = {}) {
    this.clock = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 60 * 60 * 1000;
    this.maxResponses = options.maxResponses ?? 1000;
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.maxNodes = options.maxNodes ?? 100_000;
    this.snapshotNodeMaxBytes = options.snapshotNodeMaxBytes ?? 2 * 1024 * 1024;
    this.snapshotMaxBytes = options.snapshotMaxBytes ?? 24 * 1024 * 1024;
    for (const value of [this.ttlMs, this.maxResponses, this.maxBytes, this.maxNodes, this.snapshotNodeMaxBytes, this.snapshotMaxBytes]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Response history limits must be positive integers");
    }
  }

  stats() {
    return { responses: this.roots.size, nodes: this.nodes.size,
      uniquePayloadBytes: this.payloadBytes, accountedBytes: this.bytes };
  }

  private intern(parent: HistoryNode | undefined, itemJson: string): HistoryNode {
    const id = nodeId(parent?.id, itemJson);
    const existing = this.nodes.get(id);
    if (existing) return existing;
    const payloadBytes = Buffer.byteLength(itemJson, "utf8");
    const bytes = payloadBytes + NODE_OVERHEAD_BYTES;
    const node: HistoryNode = { id, parent, itemJson, count: (parent?.count ?? 0) + 1,
      chainBytes: (parent?.chainBytes ?? 0) + bytes, bytes, payloadBytes,
      snapshotBytes: byteLength([id, { parent: parent?.id ?? null, itemJson }]), refs: 0 };
    if (parent) parent.refs++;
    this.nodes.set(id, node);
    this.bytes += bytes;
    this.payloadBytes += payloadBytes;
    return node;
  }

  private collectUnused(node: HistoryNode | undefined): void {
    while (node && node.refs === 0 && this.nodes.get(node.id) === node) {
      this.nodes.delete(node.id);
      this.bytes -= node.bytes;
      this.payloadBytes -= node.payloadBytes;
      node = node.parent;
      if (node) node.refs--;
    }
  }

  private deleteRoot(id: string): void {
    const root = this.roots.get(id);
    if (!root) return;
    this.roots.delete(id);
    if (root.head) { root.head.refs--; this.collectUnused(root.head); }
  }

  private setRoot(id: string, head: HistoryNode | undefined, createdAt: number): void {
    // Retain first: replacing an identical root must not collect the shared path.
    if (head) head.refs++;
    this.deleteRoot(id);
    this.roots.set(id, { createdAt, head });
  }

  private rememberItems(id: string, items: readonly unknown[], createdAt: number): boolean {
    let head: HistoryNode | undefined;
    try {
      for (const item of items) {
        const json = JSON.stringify(item);
        if (typeof json !== "string") throw new Error("History contains a non-JSON item");
        head = this.intern(head, json);
        if (head.chainBytes > this.maxBytes || head.count > this.maxNodes) throw new Error("History exceeds the cache budget");
      }
      this.setRoot(id, head, createdAt);
      return true;
    } catch {
      this.collectUnused(head);
      this.deleteRoot(id);
      return false;
    }
  }

  remember(id: string, items: readonly unknown[]): boolean {
    this.ensureLoaded();
    this.prune();
    const stored = this.rememberItems(id, items, this.clock());
    this.prune();
    return stored && this.roots.has(id);
  }

  expand(id: string): unknown[] | undefined {
    this.ensureLoaded();
    this.prune();
    const root = this.roots.get(id);
    if (!root) return undefined;
    const items = new Array<unknown>(root.head?.count ?? 0);
    let index = items.length;
    for (let node = root.head; node; node = node.parent) items[--index] = JSON.parse(node.itemJson);
    return items;
  }

  private prune(): void {
    const at = this.clock();
    for (const [id, root] of this.roots) if (at - root.createdAt > this.ttlMs) this.deleteRoot(id);
    while (this.roots.size > this.maxResponses || this.bytes > this.maxBytes || this.nodes.size > this.maxNodes) {
      const oldest = this.roots.keys().next().value;
      if (oldest === undefined) break;
      this.deleteRoot(oldest);
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const path = this.options.path;
    if (!path || !existsSync(path)) return;
    try {
      // Legacy v1 counted UTF-16 code units, so its valid UTF-8 file can be larger.
      if (statSync(path).size > this.snapshotMaxBytes * 3 + 65536) return;
      const raw = record(JSON.parse(readFileSync(path, "utf8")));
      if (!raw || !Array.isArray(raw.states)) return;
      if (raw.version === 1) {
        for (const row of raw.states) {
          if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string") continue;
          const state = record(row[1]);
          if (!state || typeof state.createdAt !== "number" || !Number.isFinite(state.createdAt) || !Array.isArray(state.items)) continue;
          this.rememberItems(row[0], state.items, state.createdAt);
          this.prune();
        }
      } else if (raw.version === 2 && Array.isArray(raw.nodes) && raw.nodes.length <= this.maxNodes) {
        // Persisted nodes are parent-first. A missing, corrupt, or out-of-order
        // parent invalidates its descendants; never replay a partial prefix.
        for (const row of raw.nodes) {
          if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" || !HASH.test(row[0])) continue;
          const value = record(row[1]);
          if (!value || typeof value.itemJson !== "string") continue;
          const parent = typeof value.parent === "string" ? this.nodes.get(value.parent) : undefined;
          if (value.parent !== null && !parent) continue;
          if (nodeId(parent?.id, value.itemJson) !== row[0]) continue;
          try { JSON.parse(value.itemJson); } catch { continue; }
          this.intern(parent, value.itemJson);
        }
        for (const row of raw.states) {
          if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string") continue;
          const value = record(row[1]);
          if (!value || typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) continue;
          const head = typeof value.head === "string" ? this.nodes.get(value.head) : undefined;
          if (value.head !== null && !head) continue;
          this.setRoot(row[0], head, value.createdAt);
        }
        for (const node of this.nodes.values()) this.collectUnused(node);
        this.prune();
      }
    } catch {
      this.roots.clear(); this.nodes.clear(); this.bytes = 0; this.payloadBytes = 0;
    }
  }

  /** Persist only complete dependency closures, newest response roots first. */
  flush(): boolean {
    const path = this.options.path;
    if (!path) return false;
    this.ensureLoaded();
    this.prune();
    try {
      const included = new Set<string>();
      const roots: RootRow[] = [];
      let total = byteLength({ version: 2, nodes: [], states: [] });
      for (const [id, state] of [...this.roots].reverse()) {
        const row: RootRow = [id, { createdAt: state.createdAt, head: state.head?.id ?? null }];
        const missing: HistoryNode[] = [];
        let extra = byteLength(row) + 1, valid = true;
        for (let node = state.head; node && !included.has(node.id); node = node.parent) {
          if (node.snapshotBytes > this.snapshotNodeMaxBytes) { valid = false; break; }
          extra += node.snapshotBytes + 1;
          missing.push(node);
          if (total + extra > this.snapshotMaxBytes) { valid = false; break; }
        }
        if (!valid || total + extra > this.snapshotMaxBytes) continue;
        for (const node of missing) included.add(node.id);
        roots.push(row); total += extra;
      }
      roots.reverse();
      const nodes: NodeRow[] = [];
      for (const node of this.nodes.values()) if (included.has(node.id)) {
        nodes.push([node.id, { parent: node.parent?.id ?? null, itemJson: node.itemJson }]);
      }
      const snapshot = JSON.stringify({ version: 2, nodes, states: roots });
      if (Buffer.byteLength(snapshot, "utf8") > this.snapshotMaxBytes) return false;
      atomicWriteFile(path, snapshot);
      return true;
    } catch { return false; }
  }
}
