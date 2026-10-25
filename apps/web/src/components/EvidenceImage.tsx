import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { Observation } from '../types';

export default function EvidenceImage({
  observation,
  token,
  highlight = false,
  depthMode = false,
}: {
  observation: Observation | null;
  token: string;
  highlight?: boolean;
  depthMode?: boolean;
}) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setUrl('');
    setFailed(false);
    setErrorMessage('');
    if (observation?.image_url) {
      const endpoint = depthMode ? `${observation.image_url}/depth` : observation.image_url;
      fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) {
            return response
              .json()
              .catch(() => ({}))
              .then((body: { detail?: unknown }) => {
                throw new Error(
                  typeof body.detail === 'string' ? body.detail : 'Image unavailable',
                );
              });
          }
          return response.blob();
        })
        .then((blob) => {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch((error) => {
          if (error.name !== 'AbortError') {
            setFailed(true);
            setErrorMessage(error instanceof Error ? error.message : 'Image unavailable');
          }
        });
    }
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [observation?.image_url, token, depthMode]);
  const box = observation?.bbox;
  return (
    <div className="evidence-image">
      {url ? (
        <>
          <img
            src={url}
            alt={
              observation?.source === 'sample'
                ? 'Illustrated sample desk, not a camera photo'
                : 'Saved scene photograph'
            }
          />
          {highlight && box && (
            <span
              className="bounding-box"
              aria-label="Object location in saved image"
              style={{
                left: `${box[0] * 100}%`,
                top: `${box[1] * 100}%`,
                width: `${(box[2] - box[0]) * 100}%`,
                height: `${(box[3] - box[1]) * 100}%`,
              }}
            />
          )}
        </>
      ) : (
        <div className="image-placeholder">
          <ImageOff size={24} />
          <span>
            {failed
              ? errorMessage
              : observation?.image_url
                ? 'Loading evidence…'
                : 'No photo recorded'}
          </span>
        </div>
      )}
    </div>
  );
}
