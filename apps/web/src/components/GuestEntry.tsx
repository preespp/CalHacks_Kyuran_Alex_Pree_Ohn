import { useEffect, useId, useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { api, ApiError } from '../api';
import type { Member } from '../types';

export default function GuestEntry({
  onJoin,
  onSelect,
  currentUserId,
  switching = false,
}: {
  onJoin: (name: string) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  currentUserId?: string;
  switching?: boolean;
}) {
  const [name, setName] = useState('');
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [directory, setDirectory] = useState<{
    users: Member[];
    storage: string;
    notice: string;
  } | null>(null);
  const [directoryError, setDirectoryError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setDirectory(null);
    setDirectoryError('');
    api<{ users: Member[]; storage: string; notice: string }>('/api/guest/users', undefined, {
      signal: request.signal,
    })
      .then((value) => {
        if (!request.signal.aborted) setDirectory(value);
      })
      .catch((failure) => {
        if (!request.signal.aborted)
          setDirectoryError(
            failure instanceof Error ? failure.message : 'Could not load saved users.',
          );
      });
    return () => request.abort();
  }, [revision]);

  async function submit(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 404
          ? 'The user or household API is unavailable. Reload saved users, add a new user, or open Muse chat for independent testing.'
          : failure instanceof Error
            ? failure.message
            : 'Could not join the household. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="guest-entry" aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`}>
        {switching ? 'Switch user or add someone new' : 'Welcome. What should we call you?'}
      </h2>
      <p>
        Enter a name to join our shared prototype household. No password, email, or account setup.
      </p>
      <div className="guest-directory" aria-label="Saved users">
        <h3>Saved users</h3>
        {directory ? (
          <>
            <p className="fine-print">{directory.notice}</p>
            {directory.users.length ? (
              <div className="member-list">
                {directory.users.map((user) => (
                  <button
                    key={user.id}
                    className="member-row"
                    disabled={busy || user.id === currentUserId}
                    aria-label={`Use ${user.name} (${user.id.slice(-6)})`}
                    onClick={() => void submit(() => onSelect(user.id))}
                  >
                    <span className="avatar avatar-pree">{user.name[0]}</span>
                    <span>
                      <strong>{user.name}</strong>
                      <small>
                        {user.id === currentUserId
                          ? 'Current user'
                          : `Return to this user · ${user.id.slice(-6)}`}
                      </small>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="fine-print">No saved users yet. Add the first one below.</p>
            )}
          </>
        ) : directoryError ? (
          <p className="error" role="alert">
            {directoryError}
          </p>
        ) : (
          <p role="status">Loading saved users…</p>
        )}
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          Reload saved users
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !name.trim()) return;
          await submit(() => onJoin(name.trim()));
        }}
      >
        <label className="field-label" htmlFor={inputId}>
          Your name
        </label>
        <div className="assistant-compose">
          <input
            id={inputId}
            autoComplete="nickname"
            placeholder="e.g. Pree"
            maxLength={50}
            required
            disabled={busy}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-describedby={`${inputId}-note`}
          />
          <button className="primary-button" disabled={busy || !name.trim()} type="submit">
            {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
            {switching ? 'Switch guest' : 'Continue as guest'}
          </button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error} <a href="/muse">Open Muse chat</a>
        </p>
      )}
      <p id={`${inputId}-note`} className="fine-print">
        Everyone who joins can see and update this demo household. Names are display labels, not
        verified accounts. Use demo items rather than private household information.
      </p>
    </section>
  );
}
