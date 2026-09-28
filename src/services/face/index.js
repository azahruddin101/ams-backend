import { env } from "../../config/env.js";
import { ClientEmbeddingProvider } from "./clientEmbeddingProvider.js";

const registry = {
  "client-embedding": () => new ClientEmbeddingProvider({ threshold: env.FACE_MATCH_THRESHOLD, identifyThreshold: env.FACE_IDENTIFY_THRESHOLD, ambiguityMargin: env.FACE_AMBIGUITY_MARGIN }),
};

let instance;
export function getFaceProvider() {
  if (!instance) {
    const factory = registry[env.FACE_PROVIDER];
    if (!factory) throw new Error(`Unknown FACE_PROVIDER "${env.FACE_PROVIDER}"`);
    instance = factory();
  }
  return instance;
}
export const setFaceProvider = (p) => { instance = p; };
