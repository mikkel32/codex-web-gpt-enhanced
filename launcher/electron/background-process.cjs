const { EventEmitter } = require("node:events");
const { processRunning } = require("./process-tree.cjs");

// A relaunched UI can monitor an authenticated daemon it did not spawn. Its PID is
// accepted only after the supervisor verifies the ownership journal and health.
function monitorBackgroundProcess(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = null;
  child.stderr = null;
  const timer = setInterval(() => {
    if (processRunning(pid)) return;
    clearInterval(timer);
    child.exitCode = 0;
    child.emit("exit", 0, null);
  }, 250);
  timer.unref();
  child.unref = () => timer.unref();
  child.release = () => { clearInterval(timer); child.removeAllListeners(); };
  return child;
}

module.exports = { monitorBackgroundProcess };
