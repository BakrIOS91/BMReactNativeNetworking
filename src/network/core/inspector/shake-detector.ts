import type { Unsubscribe } from '../../../helpers/emitter';

/** Subscribes to device shakes. Return an unsubscribe function. */
export type ShakeSource = (onShake: () => void) => Unsubscribe;

/**
 * Default shake source built on `expo-sensors`' Accelerometer. Returns a no-op
 * when the package is not installed; pass your own [ShakeSource] to the overlay
 * to use another sensor library.
 */
export function accelerometerShakeSource(options: { threshold?: number; cooldownMs?: number } = {}): ShakeSource {
  const { threshold = 2.2, cooldownMs = 1000 } = options;
  return (onShake) => {
    const Accelerometer = loadSensors()?.Accelerometer;
    if (!Accelerometer) return () => {};

    let last = 0;
    Accelerometer.setUpdateInterval?.(100);
    const subscription = Accelerometer.addListener(({ x, y, z }: { x: number; y: number; z: number }) => {
      // Magnitude in g, with gravity (1g) included.
      const force = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (force > threshold && now - last > cooldownMs) {
        last = now;
        onShake();
      }
    });
    return () => subscription?.remove?.();
  };
}

function loadSensors(): any {
  try {
    return require('expo-sensors');
  } catch {
    return undefined;
  }
}
