// Browser permissions still decide whether an enabled preference can activate a device.
export function mediaDefault(kind: 'camera' | 'voice') {
  try {
    const saved = sessionStorage.getItem(`commonplace-${kind}-enabled`);
    if (saved !== null) return saved === 'true';
  } catch {
    /* Private browsing can disable storage. */
  }
  return import.meta.env.VITE_MEDIA_AUTOSTART !== 'false';
}

export function saveMediaPreference(kind: 'camera' | 'voice', enabled: boolean) {
  try {
    sessionStorage.setItem(`commonplace-${kind}-enabled`, String(enabled));
  } catch {
    /* Keep controls usable. */
  }
}
