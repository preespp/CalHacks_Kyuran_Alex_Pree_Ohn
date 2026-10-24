export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(
      path.startsWith('/api/lab/')
        ? 'Could not reach Muse chat. Start make muse-api on port 8002 and try again.'
        : 'Could not reach the household API. Start make api on port 8000, or open Muse chat for an independent conversation.',
      0,
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail =
      typeof body.detail === 'string'
        ? body.detail
        : path.startsWith('/api/lab/') && response.status >= 500
          ? 'Muse chat is unavailable. Start make muse-api on port 8002 and retry.'
          : 'The request could not be completed.';
    throw new ApiError(detail, response.status);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export function timeAgo(date: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
