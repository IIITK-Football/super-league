// In-memory stand-in for an R2 bucket binding, for tests run in Node.
import type { Bucket } from '../../backend/lib/storage';

export function memoryBucket() {
  const objects = new Map<string, { body: Uint8Array; contentType?: string }>();
  const bucket: Bucket = {
    put: async (key, value, options) => {
      objects.set(key, { body: value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer), contentType: options?.httpMetadata?.contentType });
      return {};
    },
    delete: async (key) => { objects.delete(key); },
    get: async (key) => {
      const o = objects.get(key);
      return o ? { body: new Blob([o.body.slice()]).stream(), httpMetadata: { contentType: o.contentType } } : null;
    },
  };
  return { bucket, objects };
}
