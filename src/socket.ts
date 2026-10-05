import { io } from "socket.io-client";

export const socket = io({
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  timeout: 10_000,
});
