/**
 * Secret/credential detection for analyzed targets.
 * Rule: report the KIND and a masked preview; never keep the full value.
 */

export interface SecretHit {
  kind: string;
  /** First 4 chars + **** + length, e.g. "AKIA****(20)". */
  preview: string;
  index: number;
  /** 'risk' = should not ship in a client; 'notice' = often public by design (still worth knowing). */
  severity: 'risk' | 'notice';
  note?: string;
}

interface Rule {
  kind: string;
  re: RegExp;
  severity: 'risk' | 'notice';
  note?: string;
  /** index of capture group holding the secret value (default 0) */
  group?: number;
}

const RULES: Rule[] = [
  { kind: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: 'risk' },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_\-]{35}\b/g, severity: 'notice', note: 'Google browser keys are usually public by design but should be restricted by referrer.' },
  { kind: 'Stripe secret key', re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/g, severity: 'risk' },
  { kind: 'Stripe publishable key', re: /\bpk_(?:live|test)_[0-9a-zA-Z]{20,}\b/g, severity: 'notice', note: 'Publishable keys are meant to be public.' },
  { kind: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, severity: 'risk' },
  { kind: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, severity: 'risk' },
  { kind: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, severity: 'risk' },
  { kind: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g, severity: 'risk' },
  { kind: 'OpenAI-style API key', re: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{32,}\b/g, severity: 'risk' },
  { kind: 'SendGrid key', re: /\bSG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\b/g, severity: 'risk' },
  { kind: 'Twilio API key', re: /\bSK[0-9a-f]{32}\b/g, severity: 'risk' },
  { kind: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g, severity: 'notice', note: 'A JWT may be a sample, an anonymous key (e.g. Supabase anon) or a live session token.' },
  { kind: 'Private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, severity: 'risk' },
  {
    kind: 'Hard-coded credential assignment',
    re: /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|passwd|password)["']?\s*[:=]\s*["']([^"'\s]{8,64})["']/gi,
    severity: 'risk',
    group: 1,
  },
];

export function maskSecret(value: string): string {
  const head = value.slice(0, 4);
  return `${head}****(${value.length})`;
}

/** Scan text for likely secrets. Bounded: stops after `max` hits. Placeholder-looking values are skipped. */
export function scanSecrets(text: string, max = 60): SecretHit[] {
  const hits: SecretHit[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      const value = rule.group ? m[rule.group] : m[0];
      if (!value) continue;
      if (isPlaceholder(value)) continue;
      const key = rule.kind + ':' + value;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        kind: rule.kind,
        preview: rule.kind === 'Private key block' ? 'PRIVATE KEY block' : maskSecret(value),
        index: m.index,
        severity: rule.severity,
        ...(rule.note ? { note: rule.note } : {}),
      });
      if (hits.length >= max) return hits;
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
    }
  }
  return hits;
}

function isPlaceholder(v: string): boolean {
  const s = v.toLowerCase();
  if (/^(x+|\*+|0+|1+|\.+|_+|-+)$/.test(s)) return true;
  return /(your|example|changeme|placeholder|xxxx|<.*>|\{\{|process\.env|undefined|null|test1234|password)/.test(s);
}
