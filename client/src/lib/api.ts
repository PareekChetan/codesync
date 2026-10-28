export interface User {
  id: string;
  email: string;
  name: string;
}

export type Language =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'java'
  | 'cpp'
  | 'go'
  | 'html'
  | 'css'
  | 'markdown';

export interface Room {
  id: string;
  name: string;
  language: Language;
  ownerId: string;
  ownerName?: string;
  role?: 'owner' | 'editor';
  createdAt: string;
  updatedAt: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'codesync.token';

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string | null) => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable (private mode) */
    }
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.details?.[0];
    throw new ApiError(res.status, detail ? `${detail.path}: ${detail.message}` : (data.error ?? 'Request failed'));
  }
  return data as T;
}

export interface RunResult {
  phase: 'compile' | 'run';
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export const api = {
  register: (email: string, name: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/api/auth/register', { email, name, password }),
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/api/auth/login', { email, password }),
  me: () => request<{ user: User }>('GET', '/api/auth/me'),
  listRooms: () => request<{ rooms: Room[] }>('GET', '/api/rooms'),
  createRoom: (name: string, language: Language) => request<{ room: Room }>('POST', '/api/rooms', { name, language }),
  getRoom: (id: string) => request<{ room: Room }>('GET', `/api/rooms/${id}`),
  updateRoom: (id: string, fields: Partial<Pick<Room, 'name' | 'language'>>) =>
    request<{ room: Room }>('PATCH', `/api/rooms/${id}`, fields),
  deleteRoom: (id: string) => request<void>('DELETE', `/api/rooms/${id}`),
  runCode: (id: string, language: Language, code: string, stdin: string) =>
    request<{ result: RunResult }>('POST', `/api/rooms/${id}/run`, { language, code, stdin }),
};

/** WebSocket base URL: same host as the page, so it works behind any proxy. */
export function wsBaseUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
