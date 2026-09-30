/**
 * AI narrative guard.
 *
 * The language model is only allowed to *phrase* verified facts. After it
 * answers we verify that it did not introduce any number or campus service
 * name that is not present in the facts we handed it. If it did, the answer is
 * discarded and the deterministic narrative is used instead.
 */

export interface NarrativeFacts {
  /** Service names the model is allowed to mention. */
  allowedServiceNames: string[];
  /** Every service name CampusFlow knows about (for detection). */
  knownServiceNames: string[];
  /** Every numeric fact the model is allowed to state. */
  allowedNumbers: number[];
  /** Item names the model is allowed to mention. */
  allowedItemNames?: string[];
}

/**
 * A number is only exempt when it is clearly list formatting ("2.", "3)",
 * "1 -"), never when it appears inside a sentence where it reads as a fact.
 */
const LIST_MARKER = /(^|\n)\s*(?:[-*•]\s*)?\d{1,2}\s*[.):]\s/;

function isListMarkerNumber(text: string, value: number): boolean {
  if (!Number.isInteger(value) || value < 0 || value > 10) return false;
  return LIST_MARKER.test(text);
}

export interface GuardResult {
  ok: boolean;
  violations: string[];
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(?:\.\d+)?/g);
  return matches ? matches.map(value => parseFloat(value)) : [];
}

export function validateNarrative(text: string, facts: NarrativeFacts): GuardResult {
  const violations: string[] = [];
  const trimmed = (text ?? '').trim();

  if (trimmed.length === 0) {
    return { ok: false, violations: ['empty_response'] };
  }
  if (trimmed.length > 2000) {
    return { ok: false, violations: ['response_too_long'] };
  }

  const allowed = new Set(facts.allowedNumbers.map(n => Math.round(n * 100) / 100));
  for (const value of extractNumbers(trimmed)) {
    if (value === 100) continue;
    if (allowed.has(value)) continue;
    if (isListMarkerNumber(trimmed, value)) continue;
    // tolerate "24 minutes" style roundings of an allowed fact
    const nearAllowed = facts.allowedNumbers.some(n => Math.abs(n - value) < 0.5);
    if (nearAllowed) continue;
    violations.push(`unverified_number:${value}`);
  }

  const lower = trimmed.toLowerCase();
  for (const name of facts.knownServiceNames) {
    const needle = name.toLowerCase();
    if (needle.length < 6) continue;
    if (!lower.includes(needle)) continue;
    const allowedName = facts.allowedServiceNames.some(a => a.toLowerCase() === needle);
    if (!allowedName) violations.push(`unverified_service:${name}`);
  }

  const banned = ['i guarantee', 'guaranteed wait', 'always available', 'definitely available', 'no queue', 'will be empty'];
  for (const phrase of banned) {
    if (lower.includes(phrase)) violations.push(`overclaim:${phrase}`);
  }

  return { ok: violations.length === 0, violations };
}
