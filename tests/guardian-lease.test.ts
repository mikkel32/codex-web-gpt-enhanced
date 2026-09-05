import { test, expect } from "bun:test";
import { acquireGuardianLease } from "../src/native-guardian";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("guardian ownership is exclusive and released when its owner exits", async () => {
  const root = mkdtempSync(join(tmpdir(), "maria-lease-"));
  const leasePath = join(root, "lease.sqlite");
  const record = join(root, "owners.txt");
  const script = `import { acquireGuardianLease } from ${JSON.stringify(resolve(import.meta.dir, "../src/native-guardian.ts"))};
    import { appendFileSync } from 'node:fs';
    const lease=acquireGuardianLease(${JSON.stringify(leasePath)});
    if(!lease)process.exit(0);
    // Retain the Database like the guardian's finally block, even under collection.
    setInterval(()=>{if(!lease.inTransaction)process.exit(2);},50);
    setTimeout(()=>{Bun.gc(true);appendFileSync(${JSON.stringify(record)},process.pid+'\\n');},0);`;
  const children: ReturnType<typeof Bun.spawn>[] = [];
  try {
    for (let i = 0; i < 6; i++) children.push(Bun.spawn([process.execPath, "-e", script], { stdout: "ignore", stderr: "pipe" }));
    const deadline = Date.now() + 5000;
    while ((!existsSync(record) || children.filter(child => child.exitCode !== null).length < 5) && Date.now() < deadline) await Bun.sleep(50);
    const owners = readFileSync(record, "utf8").trim().split("\n").map(Number);
    expect(owners).toHaveLength(1);
    const owner = children.find(child => child.pid === owners[0])!;
    expect(owner?.exitCode).toBeNull();
    const competing = acquireGuardianLease(leasePath);
    try { expect(competing).toBeUndefined(); }
    finally { competing?.close(); }
    owner.kill("SIGKILL"); await owner.exited;
    const recovered = acquireGuardianLease(leasePath);
    expect(recovered).toBeDefined(); recovered?.close();
  } finally {
    for (const child of children) { if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
