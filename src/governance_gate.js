/**
 * Enterprise AI governance gate: PII redaction, prompt injection screening,
 * tenant token/cost budgets, dataset classification checks, and lineage audit receipts.
 */
import crypto from 'node:crypto';

const PII_PATTERNS = [
  { type: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: 'API_KEY', regex: /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/g },
  { type: 'PHONE', regex: /(?:\+\d{1,3}[\s-]+)?\(?\d{1,4}\)?[\s-]+\d{3,4}[\s-]+\d{3,4}\b/g }
];

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions/i,
  /reveal\s+(?:your\s+)?system\s+prompt/i,
  /bypass\s+(?:security|governance|policy)/i,
  /exfiltrate\s+(?:data|secrets|credentials)/i
];

const CLASSIFICATION_RANK = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };

export function redactPII(text) {
  let sanitized = String(text ?? '');
  const detectedTypes = new Set();
  let redactedCount = 0;

  for (const { type, regex } of PII_PATTERNS) {
    sanitized = sanitized.replace(regex, () => {
      detectedTypes.add(type);
      redactedCount += 1;
      return `[REDACTED_${type}]`;
    });
  }
  return { sanitized, redactedCount, detectedTypes: [...detectedTypes] };
}

export function detectPromptInjection(text) {
  const input = String(text ?? '');
  const matched = INJECTION_PATTERNS.filter((rx) => rx.test(input)).map((rx) => rx.source);
  return { flagged: matched.length > 0, matchedRules: matched };
}

export class GovernanceGateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GovernanceGateError';
    this.code = code;
  }
}

export class GovernanceGate {
  constructor(options = {}) {
    this.approvedModels = new Set(options.approvedModels || ['gpt-4o-enterprise', 'claude-sonnet-4', 'llama-3.3-70b']);
    this.allowedCatalogs = new Set(options.allowedCatalogs || ['analytics_gold', 'ops_silver']);
    this.maxClassification = options.maxClassification || 'CONFIDENTIAL';
    this.defaultTenantTokenBudget = options.defaultTenantTokenBudget || 100000;
    this.tenantUsage = new Map();
    this.auditReceipts = [];
  }

  _recordReceipt(entry) {
    const receipt = {
      receiptId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry
    };
    this.auditReceipts.push(receipt);
    return receipt;
  }

  getTenantTokensUsed(tenantId) {
    return this.tenantUsage.get(tenantId) || 0;
  }

  async evaluateAndRun(request, modelFn) {
    const {
      tenantId = 'default-tenant',
      model,
      catalog = 'analytics_gold',
      classification = 'INTERNAL',
      prompt = '',
      estimatedTokens = 500,
      tenantBudget = this.defaultTenantTokenBudget
    } = request;

    if (!this.approvedModels.has(model)) {
      const receipt = this._recordReceipt({ tenantId, model, catalog, classification, decision: 'DENY_UNAPPROVED_MODEL', tokensUsed: 0 });
      throw new GovernanceGateError('UNAPPROVED_MODEL', `Model "${model}" is not in approved governance registry (receipt=${receipt.receiptId})`);
    }

    if (!this.allowedCatalogs.has(catalog)) {
      const receipt = this._recordReceipt({ tenantId, model, catalog, classification, decision: 'DENY_CATALOG_POLICY', tokensUsed: 0 });
      throw new GovernanceGateError('FORBIDDEN_CATALOG', `Catalog "${catalog}" is not authorized for inference`);
    }

    const reqRank = CLASSIFICATION_RANK[classification] ?? 99;
    const maxRank = CLASSIFICATION_RANK[this.maxClassification] ?? 2;
    if (reqRank > maxRank) {
      const receipt = this._recordReceipt({ tenantId, model, catalog, classification, decision: 'DENY_CLASSIFICATION', tokensUsed: 0 });
      throw new GovernanceGateError('CLASSIFICATION_EXCEEDED', `Dataset classification "${classification}" exceeds max allowed "${this.maxClassification}"`);
    }

    const injection = detectPromptInjection(prompt);
    if (injection.flagged) {
      const receipt = this._recordReceipt({ tenantId, model, catalog, classification, decision: 'DENY_PROMPT_INJECTION', tokensUsed: 0 });
      throw new GovernanceGateError('PROMPT_INJECTION', `Prompt blocked by injection screening (receipt=${receipt.receiptId})`);
    }

    const currentUsed = this.getTenantTokensUsed(tenantId);
    if (currentUsed + estimatedTokens > tenantBudget) {
      this._recordReceipt({ tenantId, model, catalog, classification, decision: 'DENY_BUDGET_EXCEEDED', tokensUsed: 0 });
      throw new GovernanceGateError('BUDGET_EXCEEDED', `Tenant "${tenantId}" token budget exceeded (${currentUsed}/${tenantBudget})`);
    }

    const pii = redactPII(prompt);
    const output = await modelFn({ ...request, prompt: pii.sanitized });
    const actualTokens = Number(output?.tokensUsed ?? estimatedTokens);
    this.tenantUsage.set(tenantId, currentUsed + actualTokens);

    const receipt = this._recordReceipt({
      tenantId,
      model,
      catalog,
      classification,
      decision: 'ALLOW',
      tokensUsed: actualTokens,
      redactedTypes: pii.detectedTypes,
      redactedCount: pii.redactedCount
    });

    return { output, sanitizedPrompt: pii.sanitized, receipt };
  }
}
