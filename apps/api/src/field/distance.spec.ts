import { describe, expect, it } from 'vitest';
import { computeGpsDistanceMeters, haversineDistanceMeters } from './distance.js';

describe('gps distance', () => {
  it('is zero for identical points', () => {
    expect(
      haversineDistanceMeters({ lat: 12.9716, lng: 77.5946 }, { lat: 12.9716, lng: 77.5946 }),
    ).toBe(0);
  });

  it('matches a known reference distance within a small tolerance', () => {
    // Bangalore MG Road to Bangalore airport, straight-line ~ 33.7km per public reference calculators.
    const mgRoad = { lat: 12.9757, lng: 77.6079 };
    const airport = { lat: 13.1986, lng: 77.7066 };
    const meters = haversineDistanceMeters(mgRoad, airport);
    expect(meters).toBeGreaterThan(25_000);
    expect(meters).toBeLessThan(30_000);
  });

  it('is symmetric', () => {
    const a = { lat: 12.9716, lng: 77.5946 };
    const b = { lat: 13.0827, lng: 80.2707 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });

  it('gracefully skips when either point is missing', () => {
    const p = { lat: 12.9716, lng: 77.5946 };
    expect(computeGpsDistanceMeters(null, p)).toBeNull();
    expect(computeGpsDistanceMeters(p, null)).toBeNull();
    expect(computeGpsDistanceMeters(null, null)).toBeNull();
  });

  it('computes when both points are present', () => {
    const p = { lat: 12.9716, lng: 77.5946 };
    const q = { lat: 12.972, lng: 77.595 };
    const result = computeGpsDistanceMeters(p, q);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });
});
