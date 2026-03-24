export type UserRole = "admin" | "member";

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export type PublicUser = Omit<User, "passwordHash">;

export interface Node {
  id: string;
  title: string;
  body: string;
  type: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Edge {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthPayload {
  userId: string;
  role: UserRole;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}
