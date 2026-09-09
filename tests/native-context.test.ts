import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker, RemoteTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { nativeContextPrompt, nativeContextPage, nativeContextResult, NATIVE_CONTEXT_RESULT_BYTE_LIMIT, NATIVE_CONTEXT_READ, NATIVE_CONTEXT_PAGE_CHARS, type NativeContextPage } from "../src/adapters/chatgpt-web/native-context";
import { chatGptPromptFilePayloads } from "../src/adapters/chatgpt-web/browser-worker";
import { compiledChatGptWebMessages, estimateCompiledChatGptWebInputTokens } from "../src/adapters/chatgpt-web/input-tokens";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";
import { ChatGptExternalTurnProgress, ChatGptMirroredTurnProgress, chatGptExternalProgressIsLive } from "../src/adapters/chatgpt-web/turn-progress";

function pageOf(response: unknown): NativeContextPage {
  const content = (response as { content: Array<{ type: string; text: string }> }).content;
  expect(content).toHaveLength(1);
  expect(content[0]!.type).toBe("text");
  return JSON.parse(content[0]!.text);
}

test("native context remains budgeted but is absent from the visible prompt and uploads", () => {
  const prompt = nativeContextPrompt({ text: "original", images: [], multipart: {
    parts: [JSON.stringify({ hidden: "a".repeat(60000) }), JSON.stringify({ hidden: "part-two-sentinel" })], commit: "Execute the task",
  } });
  expect(prompt.nativeContext).toBe(true);
  expect(chatGptPromptFilePayloads(prompt)).toEqual([]);
  expect(compiledChatGptWebMessages(prompt)).toEqual([prompt.text]);
  expect(prompt.text).toContain(NATIVE_CONTEXT_READ);
  expect(prompt.text).not.toContain("part-two-sentinel");
  expect(estimateCompiledChatGptWebInputTokens(prompt, "gpt-5.6-sol")).toBeGreaterThan(5000);
});

test("context retrieval is paginated, immutable after claim, task-isolated, and required before work", async () => {
  const root=join(tmpdir(), `cgw-context-${randomUUID().slice(0,8)}`);
  const socket=process.platform === "win32" ? defaultBrokerEndpoint(root,"win32") : `${root}.sock`;
  const broker=TurnBroker.forSocket(socket);
  await broker.listen();
  const remote=new RemoteTurnBroker(socket);
  const environment: ChatGptTurnEnvironment={cwd:"/fixture",roots:["/fixture"],writableRoots:[],sandboxPolicy:{type:"readOnly",networkAccess:false},
    tools:[{name:"read_file",description:"Read fixture",parameters:{type:"object",properties:{}}},
      {name:"exec",description:"Native gateway",parameters:{},freeform:true}]};
  const token=await remote.register(environment,60000);
  const other=await remote.register(environment,60000);
  const files=[{name:"codex-context-1-of-2.json",text:JSON.stringify({text:"x".repeat(NATIVE_CONTEXT_PAGE_CHARS)+"\u00e6\u00f8\u00e5-end"})},
    {name:"codex-context-2-of-2.json",text:JSON.stringify({marker:randomUUID()})}];
  await remote.setContextFiles(token,files);
  const earlyRevision=await remote.beginCompletionFence(token);
  await expect(remote.commitCompletionFence(token,earlyRevision!)).rejects.toThrow("Required context delivery incomplete");
  const client=new Client({name:"context-test",version:"1"});
  await client.connect(new StdioClientTransport({command:process.execPath,args:["src/cli.ts","mcp","--broker-socket",socket],cwd:process.cwd(),stderr:"pipe"}));
  const read=(handle: string,name: string,offset: number) => client.callTool({name:NATIVE_CONTEXT_READ,arguments:{turn_token:handle,name,offset}});
  try {
    expect((await client.listTools()).tools.find(tool => tool.name === NATIVE_CONTEXT_READ)?.annotations)
      .toMatchObject({readOnlyHint:true,destructiveHint:false,openWorldHint:false});
    expect((await client.listTools()).tools.find(tool => tool.name === "codex_context_search")?.annotations?.readOnlyHint).toBe(true);
    expect((await read(other,files[0]!.name,0)).isError).toBe(true);
    const contextProgress = remote.waitForContextProgress(token, 0);
    const first=await read(token,files[0]!.name,0);
    const activity = await contextProgress;
    expect(activity.revision).toBe(1);
    const progress = new ChatGptExternalTurnProgress();
    progress.recordContextActivity(activity.lastProgressAt);
    const mirror = new ChatGptMirroredTurnProgress();
    mirror.apply(progress.snapshot());
    expect(mirror.snapshot()).toMatchObject({ activeToolCalls: 0, lastToolBatchRevision: 0, revision: 1 });
    expect(chatGptExternalProgressIsLive(mirror.snapshot(), activity.lastProgressAt + 5_001, 60_000)).toBe(true);
    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toBeUndefined();
    expect(pageOf(first)).toMatchObject({offset:0,next_offset:NATIVE_CONTEXT_PAGE_CHARS});
    expect((await read(token,files[0]!.name,NATIVE_CONTEXT_PAGE_CHARS+1)).isError).toBe(true);
    const waitAbort = new AbortController();
    const invalidReadProgress = remote.waitForContextProgress(token, activity.revision, waitAbort.signal).catch(error => error);
    waitAbort.abort();
    expect(await invalidReadProgress).toBeInstanceOf(Error);
    await expect(remote.setContextFiles(token,files)).rejects.toThrow("unclaimed");
    const premature=await client.callTool({name:"codex_tool_call",arguments:{turn_token:token,wire_name:"read_file",arguments:{}}});
    expect(premature.isError).toBe(true);
    const last=await read(token,files[0]!.name,NATIVE_CONTEXT_PAGE_CHARS);
    expect(pageOf(last)).toMatchObject({next_offset:null});
    expect(pageOf(first).text+pageOf(last).text).toBe(files[0]!.text);
    expect(pageOf(await read(token,files[0]!.name,0))).toEqual(pageOf(first));
    expect(pageOf(await read(token,files[1]!.name,0))).toMatchObject({text:files[1]!.text,next_offset:null});
    const work=client.callTool({name:"codex_tool_call",arguments:{turn_token:token,wire_name:"read_file",arguments:{}}});
    const [call]=await broker.nextToolBatch(token);
    expect(call!.wireName).toBe("read_file");
    broker.completeTool(token,call!.callId,{content:[{type:"text",text:"fixture-ok"}]});
    expect((await work).isError).not.toBe(true);
    const latestProgress = await remote.waitForContextProgress(token, activity.revision);
    expect(latestProgress.revision).toBe(4); // Failed reads and native work are not context progress.
    const retiredProgress = remote.waitForContextProgress(token, latestProgress.revision).catch(error => error);
    broker.revoke(token);
    expect(await retiredProgress).toBeInstanceOf(Error);
    const completedProgress = remote.waitForContextProgress(other, 0).catch(error => error);
    const otherRevision = await remote.beginCompletionFence(other);
    expect(await remote.commitCompletionFence(other, otherRevision!)).toBe(true);
    expect(await completedProgress).toBeInstanceOf(Error);
    const revoked=await read(token,files[1]!.name,0);
    expect(revoked.isError).toBe(true);
    expect(JSON.stringify(revoked)).not.toContain(files[1]!.text);
  } finally {
    await client.close(); broker.revoke(token); broker.revoke(other); await broker.close();
  }
},30000);

test("escaped and Unicode context pages fit the serialized response budget and reconstruct exactly", () => {
  for (const value of ['ASCII '.repeat(24000), '\\"\n\t'.repeat(24000), '\u00e6\u00f8\u00e5\u{1F680}'.repeat(24000)]) {
    const file = { name: "codex-context-1-of-2.json", text: JSON.stringify({ value }) };
    let offset = 0, reconstructed = "", pages = 0;
    do {
      const page = nativeContextPage(file, offset);
      const response = nativeContextResult(page);
      expect(Buffer.byteLength(JSON.stringify(response), "utf8")).toBeLessThanOrEqual(NATIVE_CONTEXT_RESULT_BYTE_LIMIT);
      expect(response).not.toHaveProperty("structuredContent");
      expect(page.text.length).toBeGreaterThan(0);
      expect(page.text.length).toBeLessThanOrEqual(NATIVE_CONTEXT_PAGE_CHARS);
      expect(page.text.charCodeAt(page.text.length - 1) >= 0xD800 && page.text.charCodeAt(page.text.length - 1) <= 0xDBFF).toBe(false);
      expect(nativeContextPage(file, offset)).toEqual(page);
      reconstructed += page.text; pages++;
      if (page.next_offset === null) break;
      expect(page.next_offset).toBeGreaterThan(offset);
      offset = page.next_offset;
    } while (pages < 100);
    expect(reconstructed).toBe(file.text);
    expect(JSON.parse(reconstructed)).toEqual({ value });
  }
});
