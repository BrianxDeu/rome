import { Server as HttpServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import jwt from "jsonwebtoken";
import type { AuthPayload } from "@rome/shared";
import { getJwtSecret } from "./middleware/auth.js";

export type RomeEvent =
  | { type: "node:created"; payload: Record<string, unknown> }
  | { type: "node:updated"; payload: Record<string, unknown> }
  | { type: "node:deleted"; payload: { id: string } }
  | { type: "edge:created"; payload: Record<string, unknown> }
  | { type: "edge:deleted"; payload: { id: string } };

let io: SocketServer | null = null;

export function setupSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: "*" },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const payload = jwt.verify(token, getJwtSecret()) as AuthPayload;
      socket.data.auth = payload;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join("graph");
  });

  return io;
}

export function broadcast(event: RomeEvent): void {
  if (!io) return;
  io.to("graph").emit(event.type, event.payload);
}

export function getIo(): SocketServer | null {
  return io;
}
