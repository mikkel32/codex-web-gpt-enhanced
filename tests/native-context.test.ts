import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker, RemoteTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { nativeContextPrompt, NATIVE_CONTEXT_READ, NATIVE_CONTEXT_PAGE_CHARS } from "../src/adapters/chatgpt-web/native-context";
import { chatGptPromptFilePayloads } from "../src/adapters/chatgpt-web/browser-worker";
import { compiledChatGptWebMessages, estimateCompiledChatGptWebInputTokens } from "../src/adapters/chatgpt-web/input-tokens";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";

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
  await expect(remote.commitCompletionFence(token,earlyRevision!)).rejects.toThrow("before retrieving every required native context page");
  const client=new Client({name:"context-test",version:"1"});
  await client.connect(new StdioClientTransport({command:process.execPath,args:["src/cli.ts","mcp","--broker-socket",socket],cwd:process.cwd(),stderr:"pipe"}));
  const read=(handle: string,name: string,offset: number) => client.callTool({name:NATIVE_CONTEXT_READ,arguments:{turn_token:handle,name,offset}});
  try {
    expect((await client.listTools()).tools.find(tool => tool.name === NATIVE_CONTEXT_READ)?.annotations)
      .toMatchObject({readOnlyHint:true,destructiveHint:false,openWorldHint:false});
    const inventory=await client.callTool({name:"codex_tool_inventory",arguments:{turn_token:token,query:NATIVE_CONTEXT_READ}});
    expect(inventory.structuredContent).toMatchObject({tools:[{wire_name:NATIVE_CONTEXT_READ}],total:1});
    expect(JSON.stringify(inventory)).not.toContain(files[1]!.text);
    expect((await read(other,files[0]!.name,0)).isError).toBe(true);
    const first=await read(token,files[0]!.name,0);
    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toMatchObject({offset:0,next_offset:NATIVE_CONTEXT_PAGE_CHARS});
    expect((await read(token,files[0]!.name,NATIVE_CONTEXT_PAGE_CHARS+1)).isError).toBe(true);
    await expect(remote.setContextFiles(token,files)).rejects.toThrow("unclaimed");
    const premature=await client.callTool({name:"codex_tool_call",arguments:{turn_token:token,wire_name:"read_file",arguments:{}}});
    expect(premature.isError).toBe(true);
    const last=await read(token,files[0]!.name,NATIVE_CONTEXT_PAGE_CHARS);
    expect(last.structuredContent).toMatchObject({next_offset:null});
    expect(String((first.structuredContent as { text: string }).text)+String((last.structuredContent as { text: string }).text)).toBe(files[0]!.text);
    expect((await read(token,files[0]!.name,0)).structuredContent).toEqual(first.structuredContent);
    expect((await read(token,files[1]!.name,0)).structuredContent).toMatchObject({text:files[1]!.text,next_offset:null});
    const work=client.callTool({name:"codex_tool_call",arguments:{turn_token:token,wire_name:"read_file",arguments:{}}});
    const [call]=await broker.nextToolBatch(token);
    expect(call!.wireName).toBe("read_file");
    broker.completeTool(token,call!.callId,{content:[{type:"text",text:"fixture-ok"}]});
    expect((await work).isError).not.toBe(true);
    broker.revoke(token);
    const revoked=await read(token,files[1]!.name,0);
    expect(revoked.isError).toBe(true);
    expect(JSON.stringify(revoked)).not.toContain(files[1]!.text);
  } finally {
    await client.close(); broker.revoke(token); broker.revoke(other); await broker.close();
  }
},30000);
