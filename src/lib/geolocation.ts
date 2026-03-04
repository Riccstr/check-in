
export interface GeoResult {
  latitude: number;
  longitude: number;
  address?: string;
}

/**
 * Attempt to get the device's GPS coordinates.
 * Returns null if permissions denied or unavailable — never blocks.
 */
export function captureLocation(timeoutMs = 10000): Promise<GeoResult | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

/**
 * Reverse geocode coordinates into a human-readable address.
 * Uses the free Nominatim API (no key required). Returns null on failure.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=0`,
      { headers: { "User-Agent": "CheckInTracker/1.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch {
    return null;
  }
}
