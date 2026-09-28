/**
 * Contract every face-recognition backend must satisfy. The rest of the app depends only on this.
 * Swap providers by adding a class here and registering it in providers/index.js.
 */
export class FaceRecognitionProvider {
  get name() { throw new Error("not implemented"); }
  get modelVersion() { return "unknown"; }
  /** Whether detectLiveness gives a real anti-spoofing signal. */
  get supportsLiveness() { return false; }
  /** input → { template:number[] } normalised representation to persist. */
  async registerFace(_input) { throw new Error("not implemented"); }
  /** (input, storedTemplate) → { match:boolean, score:number } */
  async verifyFace(_input, _storedTemplate) { throw new Error("not implemented"); }
  /**
   * 1:N identification. candidates: [{ id, template }].
   * → { matchedId:string|null, ambiguous:boolean, best:{id,score}|null }  (score semantics are provider-defined;
   * the caller only relies on matchedId/ambiguous).
   */
  async identify(_input, _candidates) { throw new Error("not implemented"); }
  /** input → { live:boolean, score:number|null } */
  async detectLiveness(_input) { throw new Error("not implemented"); }
}
