import { createHmac, randomBytes } from "node:crypto";
import { estimateTokens } from "../../lib/token-estimate";
import { nativeContextPage, nativeContextTextResult, NATIVE_CONTEXT_RESULT_BYTE_LIMIT, type NativeContextFile, type NativeContextOptions, type NativeContextPage, type NativeContextReadError } from "./native-context";

export const CONTEXT_FILE_NAME = /^(?:codex-context-[1-3]-of-[23]\.json|codex-(?:evidence|attachment)-[a-f0-9]{16}\.txt|codex-input-image-\d{1,3}|codex-image-[a-f0-9]{16})$/;
export const OPTIONAL_CONTEXT_TOKENS = 32_000;
const MAX_CONTEXT_BYTES = 50_000_000;

export class NativeContextReceiptError extends Error {
  constructor(readonly result: NativeContextReadError) {
    super(result.error);
    this.name = "NativeContextReceiptError";
  }
}

/** Immutable task data, with delivery receipts independent from served/read offsets. */
export class NativeContextStore {
  private readonly files: Map<string, NativeContextFile>;
  private readonly served = new Map<string, number>();
  private readonly acknowledged = new Map<string, number>();
  private readonly receipts = new Map<string, { name: string; start: number; end: number }>();
  private readonly charged = new Set<string>();
  private readonly receiptCorrections = new Map<string, number>();
  private readonly secret = randomBytes(24);
  private optionalTokens = 0;

  constructor(files: NativeContextFile[], readonly options: NativeContextOptions = {}) {
    if (!Array.isArray(files) || files.length < 1 || files.length > 512) throw new Error("Invalid context file count");
    if (options.requireReceipts !== undefined && typeof options.requireReceipts !== "boolean") throw new Error("Invalid context receipt policy");
    if (options.allowAgentReporting !== undefined && typeof options.allowAgentReporting !== "boolean") throw new Error("Invalid agent reporting policy");
    if (options.optionalTokenBudget !== undefined && options.optionalTokenBudget !== null && (!Number.isSafeInteger(options.optionalTokenBudget)
      || options.optionalTokenBudget < 0 || options.optionalTokenBudget > OPTIONAL_CONTEXT_TOKENS)) throw new Error("Invalid evidence retrieval budget");
    let bytes = 0;
    for (const file of files) {
      if (!file || !CONTEXT_FILE_NAME.test(file.name) || typeof file.text !== "string"
        || (file.required !== undefined && typeof file.required !== "boolean")
        || (file.source !== undefined && typeof file.source !== "string")
        || (file.kind !== undefined && !["context", "evidence", "attachment", "image"].includes(file.kind))) throw new Error("Invalid context file descriptor");
      if (file.kind === "image") {
        if (!file.mimeType || !/^image\/(?:png|jpeg|webp|gif)$/.test(file.mimeType) || !file.imageData
          || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.imageData) || file.imageData.length % 4 !== 0
          || (file.imageDetail !== undefined && !["auto", "low", "high", "original"].includes(file.imageDetail))) throw new Error("Invalid context image");
        const size = Buffer.from(file.imageData, "base64").length;
        if (!size || size > 20_000_000) throw new Error("Context image exceeds its byte budget");
        bytes += size;
      } else {
        const size = Buffer.byteLength(file.text, "utf8");
        if (size > 20_000_000) throw new Error("Context document exceeds its byte budget");
        bytes += size;
        if (!file.kind || file.kind === "context") JSON.parse(file.text);
      }
    }
    if (bytes > MAX_CONTEXT_BYTES) throw new Error("Context exceeds its total byte budget");
    this.files = new Map(structuredClone(files).map(file => [file.name, file]));
    if (this.files.size !== files.length) throw new Error("Duplicate context file names");
  }

  private size(file: NativeContextFile): number { return file.kind === "image" ? 1 : file.text.length; }
  private issue(name: string, start: number, end: number): string {
    const receipt = createHmac("sha256", this.secret).update(JSON.stringify([name, start, end])).digest("base64url");
    return receipt;
  }
  private invalidReceipt(): NativeContextReceiptError {
    // Recover only data served by this store. No guessed, foreign or stale receipt is
    // accepted, and issuing the replay instruction cannot acknowledge an unread page.
    const pending = this.pendingRequired().find(page => page.served_to > page.offset);
    const result: NativeContextReadError = {
      code: "context_receipt_invalid", error: "Context receipt is invalid for this task", retryable: false,
    };
    if (pending) {
      const key = JSON.stringify([pending.name, pending.offset]);
      const attempts = this.receiptCorrections.get(key) ?? 0;
      if (attempts < 2) {
        this.receiptCorrections.set(key, attempts + 1);
        result.recovery = {
          action: "reread_context_page", read: { name: pending.name, offset: pending.offset },
          attempts_remaining: 1 - attempts,
          message: "No context acknowledgement advanced. Use this read with the same current turn_token and omit receipt. It replays an already served page. Copy that result's next_read exactly; do not resend the rejected receipt or change access settings.",
        };
      }
    }
    return new NativeContextReceiptError(result);
  }

  private validateReceipt(receipt: string): { name: string; end: number } {
    const entry = this.receipts.get(receipt);
    if (!entry) throw this.invalidReceipt();
    const file = this.files.get(entry.name)!;
    const prior = this.acknowledged.get(entry.name) ?? 0;
    if (file.required !== false && entry.start > prior) throw new Error("A prior required context page has not been acknowledged");
    return { name: entry.name, end: Math.max(prior, entry.end) };
  }

  read(name: string, offset: number, receipt?: string): NativeContextPage {
    const file = this.files.get(name);
    if (!file || !Number.isSafeInteger(offset) || offset < 0 || offset > this.size(file)) throw new Error("Requested context file or offset is unavailable in this turn");
    const acknowledgement = receipt !== undefined ? this.validateReceipt(receipt) : undefined;
    const prior = this.served.get(name) ?? 0;
    if (file.required !== false && offset > prior) throw new Error("Requested sequential context offset is unavailable in this turn");
    const acknowledgedTo = acknowledgement?.name === name ? acknowledgement.end : (this.acknowledged.get(name) ?? 0);
    if (this.options.requireReceipts && file.required !== false && offset > acknowledgedTo) {
      throw new Error("Pass the previous page receipt before advancing the required context offset");
    }
    const page: NativeContextPage = file.kind === "image"
      ? { name, offset, text: "", next_offset: null, total_chars: 1, kind: "image",
        ...(offset === 0 ? { imageData: file.imageData, imageDetail: file.imageDetail, mimeType: file.mimeType,
          receipt: this.issue(name, 0, 1), next_read: { name, offset: 1, receipt: this.issue(name, 0, 1) } } : { acknowledged: true }) }
      : nativeContextPage(file, offset, this.options.requireReceipts ? end => this.issue(name, offset, end) : undefined);
    const end = file.kind === "image" ? 1 : offset + page.text.length;
    const chargeKey = JSON.stringify([name, offset, end]);
    if (file.required === false && this.options.optionalTokenBudget !== null && !this.charged.has(chargeKey)) {
      // All available images already have a vision reserve in the compiled input budget.
      const tokens = file.kind === "image" ? 0 : estimateTokens(page.text, "gpt-5.6-sol");
      if (this.optionalTokens + tokens > (this.options.optionalTokenBudget ?? OPTIONAL_CONTEXT_TOKENS)) {
        throw new Error("Evidence retrieval budget reached; use focused workspace reads or a new compacted task turn");
      }
      this.optionalTokens += tokens; this.charged.add(chargeKey);
    }
    // Commit delivery state only after the entire request passes validation. A rejected
    // offset or evidence-budget check must leave the required-context gate unchanged.
    if (acknowledgement) this.acknowledged.set(acknowledgement.name, acknowledgement.end);
    this.served.set(name, Math.max(prior, end));
    if (page.receipt) this.receipts.set(page.receipt, { name, start: offset, end });
    if (offset === this.size(file)) page.acknowledged = !this.options.requireReceipts || (this.acknowledged.get(name) ?? 0) === this.size(file);
    return page;
  }

  missingRequired(): string[] {
    const progress = this.options.requireReceipts ? this.acknowledged : this.served;
    return [...this.files.values()].filter(file => file.required !== false && (progress.get(file.name) ?? 0) < this.size(file)).map(file => file.name);
  }

  pendingRequired() {
    return this.missingRequired().map(name => ({ name,
      offset: (this.options.requireReceipts ? this.acknowledged : this.served).get(name) ?? 0,
      total_chars: this.size(this.files.get(name)!), served_to: this.served.get(name) ?? 0,
    }));
  }

  search(query: string, offset = 0, limit = 10) {
    if (this.missingRequired().length) throw new Error("Acknowledge required context before searching archived evidence");
    const needle = query.trim().toLowerCase();
    if (!needle || needle.length > 500 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Invalid context search");
    const matches = [...this.files.values()].filter(file => file.required === false && file.kind !== "image").flatMap(file => {
      const found = file.text.toLowerCase().indexOf(needle);
      if (found < 0) return [];
      let start = Math.max(0, found - 200);
      if (start > 0 && /[\uDC00-\uDFFF]/.test(file.text[start]!)) start--;
      return [{ name: file.name, offset: start, kind: file.kind, source: file.source?.slice(0, 256),
        excerpt: file.text.slice(start, start + 400) }];
    });
    const page: typeof matches = [];
    const response = () => ({ matches: page, total: matches.length,
      next_offset: offset + page.length < matches.length ? offset + page.length : null,
      remaining_retrieval_tokens: this.options.optionalTokenBudget === null ? null
        : (this.options.optionalTokenBudget ?? OPTIONAL_CONTEXT_TOKENS) - this.optionalTokens });
    for (const match of matches.slice(offset, offset + limit)) {
      page.push(match);
      if (Buffer.byteLength(JSON.stringify(nativeContextTextResult(response())), "utf8") > NATIVE_CONTEXT_RESULT_BYTE_LIMIT) { page.pop(); break; }
    }
    return response();
  }
}
