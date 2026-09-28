import { FaceRecognitionProvider } from "./provider.js";
import { BadRequestError } from "../../utils/errors.js";

const EMBEDDING_DIM = 128;
const round = (n) => Math.round(n * 1000) / 1000;

const euclidean = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
};

/**
 * Embeddings are computed in the browser (no raw image ever reaches the server). The server validates
 * the vector and performs the 1:1 comparison using Euclidean distance (the metric 128-d face-api/dlib descriptors are trained for;
 * threshold = maximum distance, lower is stricter). There is NO server-side liveness: a printed photo or a
 * replayed video of the employee can produce a matching embedding, so this provider only supports FACE_ONLY.
 */
export class ClientEmbeddingProvider extends FaceRecognitionProvider {
  constructor({ threshold, identifyThreshold, ambiguityMargin }) {
    super();
    this.threshold = threshold;
    this.identifyThreshold = identifyThreshold;
    this.ambiguityMargin = ambiguityMargin;
  }
  get name() { return "client-embedding"; }
  get modelVersion() { return `128d-euclidean-v1`; }

  #validate(input) {
    const v = input?.embedding;
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIM || v.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new BadRequestError(`Face data is invalid`, "INVALID_FACE_DATA");
    }
    return v;
  }

  async registerFace(input) {
    return { template: this.#validate(input) };
  }
  async verifyFace(input, stored) {
    const distance = euclidean(this.#validate(input), stored);
    return { match: distance <= this.threshold, score: Math.round(distance * 1000) / 1000 }; // score = distance
  }
  /**
   * Nearest-neighbour search. A match needs (a) distance <= identifyThreshold and (b) a clear margin over the
   * runner-up — two similar faces must never be silently resolved to whoever happens to be closer.
   */
  async identify(input, candidates) {
    const probe = this.#validate(input);
    let best = null;
    let second = null;
    for (const c of candidates) {
      const score = euclidean(probe, c.template);
      if (!best || score < best.score) { second = best; best = { id: c.id, score }; }
      else if (!second || score < second.score) second = { id: c.id, score };
    }
    if (!best || best.score > this.identifyThreshold) return { matchedId: null, ambiguous: false, best: best && { ...best, score: round(best.score) } };
    const ambiguous = Boolean(second) && second.score - best.score < this.ambiguityMargin;
    return { matchedId: ambiguous ? null : best.id, ambiguous, best: { ...best, score: round(best.score) } };
  }
  async detectLiveness() {
    return { live: false, score: null };
  }
}
