/** Pure, network-free text guard. Input is normalized to NFKC before inspection. */
export const VERSION = '0.2.0';
export const MAX_BYTES = 256 * 1024;

export class PrivacyError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'PrivacyError'; this.code = code; this.status = status; }
}

// No global flags: RegExp.test must be independent across requests.
const SECRETS = [
  /-----BEGIN[^\n]*PRIVATE KEY-----/i,
  /\b(?:sk|rk)-[a-z0-9_-]{16,}/i,
  /\b(?:sk|rk)_(?:live|test)_[a-z0-9]{10,}/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[a-z0-9]{20,}/i,
  /\bgithub_pat_[a-z0-9_]{20,}/i,
  /\bxox[baprs]-[a-z0-9-]{10,}/i,
  /\bAIza[a-z0-9_-]{30,}/i,
  /\b(?:tew|koeu)_[a-z0-9_-]{12,}/i,
  /\beyJ[a-z0-9_-]{6,}\.[a-z0-9_-]{6,}\.[a-z0-9_-]{6,}/i,
  /\b(?:Bearer|Basic)\s+[a-z0-9._~+\/=:-]{8,}/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|token|private[_-]?key)["']?\s*[:=]\s*["']?[^\s"',;}{]{4,}/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i,
];
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const EMAIL_LOCAL = /[a-z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}$/i;
const EMAIL_DOMAIN = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){1,10}/iy;
// Equivalent to the former global email regex, but never retries at every
// character of a long non-email token. Bounds and global non-overlap are kept.
function emailSpans(text, add) {
  let cursor = 0;
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', cursor)) {
    const window = text.slice(Math.max(cursor, at - 64), at);
    const local = EMAIL_LOCAL.exec(window);
    EMAIL_DOMAIN.lastIndex = at + 1;
    // JS `$` also matches before a terminal newline; an email local part cannot.
    const domain = local && local.index + local[0].length === window.length && EMAIL_DOMAIN.exec(text);
    cursor = at + 1;
    if (domain) {
      cursor += domain[0].length;
      add({ start: at - local[0].length, end: cursor, kind: 'email' });
    }
  }
}
// Deliberately conservative: Japanese domestic numbers and explicit international + numbers.
const PHONE = /(?<![\p{L}\p{N}])(?:\+[1-9][0-9 .()-]{5,24}[0-9]|0[1-9][0-9-]{7,12}[0-9])(?![\p{L}\p{N}])/gu;

function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed) {
  if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new PrivacyError('unsupported_field');
}
function normalized(value) {
  const text = value.normalize('NFKC');
  if (INVISIBLE.test(text)) throw new PrivacyError('unsupported_invisible_character');
  if (SECRETS.some(pattern => pattern.test(text))) throw new PrivacyError('secret_detected', 422);
  return text;
}

/** configuredTerms is an array of exact strings, e.g. names/addresses. Never sent upstream. */
export function protectChat(input, configuredTerms = []) {
  if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_BYTES) throw new PrivacyError('body_too_large', 413);
  if (!Array.isArray(configuredTerms) || configuredTerms.length > 100 || configuredTerms.some(t => typeof t !== 'string' || t.length < 2 || t.length > 256)) throw new PrivacyError('invalid_privacy_config', 503);
  keys(input, ['model', 'messages', 'stream', 'stream_options', 'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'stop', 'seed', 'presence_penalty', 'frequency_penalty']);
  if (typeof input.model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,160}$/.test(input.model)) throw new PrivacyError('invalid_model');
  normalized(input.model);
  // Model is routing metadata; never silently substitute a different model.
  if (configuredTerms.some(t => input.model.includes(t))) throw new PrivacyError('sensitive_routing_metadata', 422);
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 128) throw new PrivacyError('invalid_messages');
  if (input.stream !== undefined && typeof input.stream !== 'boolean') throw new PrivacyError('invalid_stream');
  if (input.stream_options !== undefined) {
    keys(input.stream_options, ['include_usage']);
    if (typeof input.stream_options.include_usage !== 'boolean') throw new PrivacyError('invalid_stream_options');
  }
  for (const [name, min, max, integer] of [
    ['temperature', 0, 2, false], ['top_p', 0, 1, false],
    ['presence_penalty', -2, 2, false], ['frequency_penalty', -2, 2, false],
    ['max_tokens', 1, 32768, true], ['max_completion_tokens', 1, 32768, true],
    ['seed', -2147483648, 2147483647, true],
  ]) {
    const value = input[name];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))) throw new PrivacyError('invalid_parameter');
  }
  // Local variables only: no cross-request identity map or persistent storage.
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const replacements = new Map();
  const counts = { email: 0, phone: 0, term: 0 };
  function replacement(kind, value) {
    const key = kind + ':' + value;
    if (!replacements.has(key)) replacements.set(key, `[PRIVATE_${nonce}_${kind.toUpperCase()}_${++counts[kind]}]`);
    return replacements.get(key);
  }
  const terms = [...new Set(configuredTerms.map(t => normalized(t)))].sort((a, b) => b.length - a.length);
  function clean(value) {
    let text = normalized(value);
    // One pass over original spans: inserted placeholders cannot be matched by later rules.
    const spans = [];
    function add(span) { if (spans.length >= 4096) throw new PrivacyError('too_many_matches', 413); spans.push(span); }
    for (const term of terms) {
      let start = 0, found;
      while ((found = text.indexOf(term, start)) !== -1) { add({ start: found, end: found + term.length, kind: 'term' }); start = found + term.length; }
    }
    emailSpans(text, add);
    for (const match of text.matchAll(PHONE)) {
      const digits = match[0].replace(/\D/g, '');
      if (match[0].startsWith('+') ? digits.length >= 7 && digits.length <= 15 : (digits.length === 10 || digits.length === 11)) add({ start: match.index, end: match.index + match[0].length, kind: 'phone' });
    }
    // Merge overlapping matches to avoid exposing the remainder of an email/name.
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];
    for (const span of spans) {
      const last = merged.at(-1);
      if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
      else merged.push({ ...span });
    }
    let cursor = 0, result = '';
    for (const span of merged) { result += text.slice(cursor, span.start) + replacement(span.kind, text.slice(span.start, span.end)); cursor = span.end; }
    return result + text.slice(cursor);
  }
  const messages = input.messages.map(message => {
    keys(message, ['role', 'content']);
    if (!['system', 'developer', 'user', 'assistant'].includes(message.role)) throw new PrivacyError('unsupported_role');
    if (typeof message.content === 'string') return { role: message.role, content: clean(message.content) };
    if (!Array.isArray(message.content) || !message.content.length || message.content.length > 64) throw new PrivacyError('text_only');
    // Combine parts before inspection so a secret split across text parts cannot bypass detection.
    const text = message.content.map(part => { keys(part, ['type', 'text']); if (part.type !== 'text' || typeof part.text !== 'string') throw new PrivacyError('text_only'); return part.text; }).join('');
    return { role: message.role, content: clean(text) };
  });
  if (clean(input.model) !== input.model) throw new PrivacyError('sensitive_routing_metadata', 422);
  const output = { ...input, messages };
  if (input.stop !== undefined) {
    const stops = typeof input.stop === 'string' ? [input.stop] : input.stop;
    if (!Array.isArray(stops) || stops.length > 4 || stops.some(s => typeof s !== 'string' || s.length > 256)) throw new PrivacyError('invalid_stop');
    output.stop = stops.map(clean);
  }
  return { body: output, counts };
}
