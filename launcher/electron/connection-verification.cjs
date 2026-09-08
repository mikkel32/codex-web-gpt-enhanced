const { createHash } = require("node:crypto");

function connectionVerificationIdentity(config) {
  if (config?.mode !== "full" || config.browserInteractionMode !== "automatic" || !config.tunnel?.tunnelId) return null;
  // Metadata only. Never read or persist runtime keys as part of setup evidence.
  return createHash("sha256").update(JSON.stringify({ protocol: 1,
    release: config.releaseVersion, connector: config.automaticAppName || config.appName,
    tunnel: config.tunnel.tunnelId, broker: config.brokerSocketPath,
    browser: config.browserHostDescriptorPath || config.storageStatePath,
  })).digest("hex");
}

function connectionVerificationStale(state, config) {
  return config?.mode === "full" && config.browserInteractionMode === "automatic"
    && (connectionVerificationIdentity(config) === null || state.mcpVerificationIdentity !== connectionVerificationIdentity(config));
}

module.exports = { connectionVerificationIdentity, connectionVerificationStale };
