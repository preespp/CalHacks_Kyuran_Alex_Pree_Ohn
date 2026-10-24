import { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { api } from './api';
import AssistantPanel from './components/AssistantPanel';
import HouseholdLayout from './components/HouseholdLayout';
import type { Health } from './types';

export default function MuseLab() {
  const [health, setHealth] = useState<Pick<Health, 'assistant_provider'> | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    api<Pick<Health, 'assistant_provider'>>('/api/lab/health', undefined, {
      signal: request.signal,
    })
      .then((value) => {
        if (!request.signal.aborted) {
          setHealth(value);
          setError('');
        }
      })
      .catch(() => {
        if (!request.signal.aborted)
          setError(
            'Could not reach Muse chat. Start make muse-api on port 8002, then retry the connection.',
          );
      });
    return () => request.abort();
  }, [revision]);
  return (
    <HouseholdLayout tab="assistant" testMode>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span />
            LESS SEARCHING, MORE LIVING
          </div>
          <h1>Just ask your household.</h1>
          <p>Find the little things, with Muse and shared evidence.</p>
        </div>
        <button
          className="primary-button"
          disabled
          title="Scanning requires the household app and vision integration"
        >
          <Camera size={18} />
          Scan room
        </button>
      </div>
      <div className="notice" role="note" aria-label="Temporary assistant test mode">
        <strong>Assistant test mode — household memory is disconnected.</strong>
        <p>
          This uses the same assistant screen as the household app. Test chat and voice here; saved
          objects, household members, and camera features are available from{' '}
          <a href="/">Our memory</a>.
        </p>
      </div>
      {error && (
        <div className="notice" role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={() => setRevision((value) => value + 1)}>
            Retry connection
          </button>
        </div>
      )}
      <AssistantPanel mode="plain" health={health} />
      <p className="fine-print">
        Local development only. Uses Meta Model API, separate from the consumer Muse app. Each send
        or transcription consumes API usage.
      </p>
    </HouseholdLayout>
  );
}
