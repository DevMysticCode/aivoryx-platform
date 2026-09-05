export interface CapturedPoint {
  lat: number;
  lng: number;
  accuracyM?: number;
}

/**
 * Wraps `navigator.geolocation` in a promise. Never fabricates or substitutes
 * a previous location on failure (ADR 0033 / phase brief §17) — callers must
 * surface `error.message` to the user and let them retry.
 */
export function captureLocation(): Promise<CapturedPoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('This device does not support location access.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new Error(
              'Location access was denied. Enable location permission for this site and try again.',
            ),
          );
        } else {
          reject(new Error('Could not determine your location. Move to an open area and retry.'));
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}
