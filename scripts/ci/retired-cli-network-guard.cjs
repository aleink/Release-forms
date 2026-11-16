// Offline CLI integration test only. Inherited by every Node child; never used
// in the production workflow's build/deploy commands. No non-loopback socket.
const net = require("node:net");
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : net._normalizeArgs(args)[0];
  if (!["127.0.0.1", "::1"].includes(options.host) || Number(options.port) !== Number(process.env.RETIRED_MOCK_PORT)) {
    throw new Error("OFFLINE_NETWORK_DENIED");
  }
  return original.apply(this, args);
};
