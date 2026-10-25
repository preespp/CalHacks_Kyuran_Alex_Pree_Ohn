export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function userFacingError(message: string, path: string): string {
  if (
    !/\b(api|backend|database|spacetimedb|sqlite|reducer|schema)\b|\.env|make (api|web)|[A-Z]+_[A-Z_]+|structured.output/i.test(
      message,
    )
  )
    return message.replace(/\bMuse\b/g, 'Remi');
  if (path.includes('transcrib'))
    return 'We couldn’t understand that recording. Please try again or type your question.';
  if (path === '/api/guest/users')
    return 'Saved names are unavailable right now. Please try again shortly.';
  if (path === '/api/guest/session') return 'We couldn’t save your name. Please try again shortly.';
  if (path.startsWith('/api/camera/') || path === '/api/captures')
    return 'We couldn’t save this view. Please try starting the camera again.';
  if (path.includes('chat')) return 'Remi is unavailable right now. Please try again shortly.';
  return 'We couldn’t connect to your household. Please try again shortly.';
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
      'We couldn’t connect to your household. Check your connection and try again.',
      0,
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail =
      typeof body.detail === 'string' ? body.detail : 'The request could not be completed.';
    throw new ApiError(userFacingError(detail, path), response.status);
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
