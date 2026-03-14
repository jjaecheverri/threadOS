// Drifty — Drift Detection Engine v1
// Detects constraint violations, instruction drift, scope expansion, incomplete task chains
// Returns a alignment score (0–100) and a structured drift result

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const STOP = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'is','are','was','were','be','been','have','has','do','does','did','will',
  'would','could','should','that','this','it','they','then','when','if','as',
  'so','all','any','not','use','make','new','each','from','get','set','run',
  'into','via','per','also','both','just','can','may','might','let','please',
  'i','you','we','my','your','our','me','us','him','her','them','their',
  'what','how','why','which','who','where','want','need','help','think',
  'using','used','been','more','some','there','their','about','would',
]);

// Negation prefixes — these invert the meaning of what follows
const NEGATION_WORDS = ['no', 'never', "don't", "don't", 'avoid', 'do not',
                        'without', 'exclude', 'stop', 'halt', 'refrain'];

// ── KEYWORD EXTRACTION ────────────────────────────────────────────────────────
export function extractKeywords(text = '') {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP.has(w))
      .slice(0, 50)
  );
}

// ── KEYWORD OVERLAP RATIO ────────────────────────────────────────────────────
function overlapRatio(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const k of a) if (b.has(k)) shared++;
  return shared / Math.max(a.size, b.size);
}

// ── CONSTRAINT VIOLATION CHECK ────────────────────────────────────────────────
function checkConstraintViolation(constraint, prompt) {
  const c = constraint.toLowerCase().trim();
  const p = prompt.toLowerCase();

  // Extract what the constraint is forbidding
  let forbidden = c;
  for (const neg of NEGATION_WORDS) {
    if (c.startsWith(neg + ' ')) {
      forbidden = c.slice(neg.length).trim();
      break;
    }
  }

  const cKw = extractKeywords(forbidden);
  const pKw = extractKeywords(p);

  // If constraint has a negation word AND the forbidden topic appears in prompt
  const hasNegation = NEGATION_WORDS.some(n => c.startsWith(n + ' ') || c.startsWith(n + "'"));
  if (!hasNegation) return false; // constraint is a positive requirement, not a prohibition

  // Check overlap between forbidden topic and prompt
  const overlap = overlapRatio(cKw, pKw);
  return overlap >= 0.35;
}

// ── INSTRUCTION DRIFT ─────────────────────────────────────────────────────────
function measureInstructionDrift(currentPrompt, thread) {
  const brief = thread?.brief || '';
  if (!brief.trim() || brief.length < 10) return { drifted: false, coverage: 100 };

  const briefKw = extractKeywords(brief);
  const promptKw = extractKeywords(currentPrompt);

  const coverage = Math.round(overlapRatio(briefKw, promptKw) * 100);
  return { drifted: coverage < 20 && briefKw.size >= 5, coverage };
}

// ── SCOPE EXPANSION ───────────────────────────────────────────────────────────
function measureScopeExpansion(prevPrompt, currPrompt, briefKw) {
  const prev = extractKeywords(prevPrompt || '');
  const curr = extractKeywords(currPrompt || '');
  const combined = new Set([...prev, ...briefKw]);

  const newTopics = [...curr].filter(k => !combined.has(k));
  const expansionRatio = curr.size > 0 ? Math.round(newTopics.length / curr.size * 100) : 0;

  return {
    expanded: expansionRatio > 45,
    ratio: expansionRatio,
    newTopics: newTopics.slice(0, 6),
  };
}

// ── INCOMPLETE TASK CHAINING ──────────────────────────────────────────────────
function checkIncompleteTasks(prevSession, currPrompt) {
  if (!prevSession?.response) return { detected: false };

  const response = prevSession.response.toLowerCase();
  const incompleteSignals = [
    'not yet', 'todo', 'still need', 'next step', 'remaining',
    "haven't", 'pending', 'incomplete', 'partial', 'will need to',
    'needs to be', 'should be done', 'not finished', 'not complete',
  ];

  const foundSignals = incompleteSignals.filter(s => response.includes(s));
  if (foundSignals.length < 2) return { detected: false };

  // See if current prompt addresses the incomplete items
  const incompleteContext = foundSignals.map(s => {
    const idx = response.indexOf(s);
    return response.slice(Math.max(0, idx - 10), idx + 50);
  }).join(' ');

  const incompleteKw = extractKeywords(incompleteContext);
  const currKw = extractKeywords(currPrompt);
  const addressed = overlapRatio(incompleteKw, currKw);

  return {
    detected: addressed < 0.12,
    signals: foundSignals.slice(0, 3),
    addressedRatio: Math.round(addressed * 100),
  };
}

// ── FIDELITY SCORE ────────────────────────────────────────────────────────────
// Score 0–100 representing thread alignment for this session
// Higher = more faithful to the thread brief
function computeAlignmentScore({ coverage, violations, scopeExpansion, incompleteTasks }) {
  let score = 100;

  // Constraint violations are the most serious
  score -= violations * 30;

  // Instruction drift penalty (scaled)
  if (coverage < 20) score -= 25;
  else if (coverage < 40) score -= 15;
  else if (coverage < 60) score -= 5;

  // Scope expansion penalty
  if (scopeExpansion > 60) score -= 20;
  else if (scopeExpansion > 45) score -= 10;

  // Incomplete task chaining
  if (incompleteTasks) score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── SEVERITY CALCULATOR ───────────────────────────────────────────────────────
function calcSeverity(flags, alignmentScore) {
  const hasHigh = flags.some(f => f.severity === 'high');
  const hasMedium = flags.some(f => f.severity === 'medium');

  if (hasHigh || alignmentScore < 40) return 'high';
  if (hasMedium || alignmentScore < 65) return 'medium';
  if (flags.length > 0 || alignmentScore < 85) return 'low';
  return 'none';
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────────
/**
 * analyzeDrift(previousSession, currentSession, thread)
 *
 * @param {object} previousSession - { prompt, response, model }
 * @param {object} currentSession  - { prompt, model }
 * @param {object} thread          - { brief, constraints[] }
 * @returns {DriftResult}
 *
 * DriftResult: {
 *   drift: boolean,
 *   severity: "high" | "medium" | "low" | "none",
 *   reason: string,
 *   score: number,          // alignment score 0–100
 *   flags: DriftFlag[],
 *   details: {
 *     coverage: number,       // % brief keywords in current prompt
 *     scopeExpansion: number, // % new topics vs prior session
 *     constraintViolations: string[],
 *   }
 * }
 */
export function analyzeDrift(previousSession, currentSession, thread) {
  const flags = [];
  const currPrompt = currentSession?.prompt || '';
  const prevPrompt = previousSession?.prompt || '';
  const constraints = thread?.constraints || [];
  const briefKw = extractKeywords(thread?.brief || '');

  // ── 1. Constraint violations ──────────────────────────────────────────────
  const violatedConstraints = [];
  for (const constraint of constraints) {
    if (checkConstraintViolation(constraint, currPrompt)) {
      violatedConstraints.push(constraint);
      flags.push({
        type: 'CONSTRAINT_VIOLATION',
        severity: 'high',
        detail: `Boundary crossed: "${constraint.slice(0, 60)}"`,
        constraint,
      });
    }
  }

  // ── 2. Instruction drift ──────────────────────────────────────────────────
  const driftCheck = measureInstructionDrift(currPrompt, thread);
  if (driftCheck.drifted) {
    flags.push({
      type: 'INSTRUCTION_DRIFT',
      severity: 'medium',
      detail: `Low topic overlap with thread brief (${driftCheck.coverage}% match)`,
      coverage: driftCheck.coverage,
    });
  }

  // ── 3. Scope expansion ────────────────────────────────────────────────────
  const scopeCheck = measureScopeExpansion(prevPrompt, currPrompt, briefKw);
  if (scopeCheck.expanded) {
    flags.push({
      type: 'SCOPE_EXPANSION',
      severity: 'medium',
      detail: `Most of this prompt is off-topic — new subjects not in your brief`,
      newTopics: scopeCheck.newTopics,
    });
  }

  // ── 4. Incomplete task chaining ───────────────────────────────────────────
  const taskCheck = checkIncompleteTasks(previousSession, currPrompt);
  if (taskCheck.detected) {
    flags.push({
      type: 'INCOMPLETE_TASKS',
      severity: 'low',
      detail: `Previous conversation had open items that weren't carried forward`,
      signals: taskCheck.signals,
    });
  }

  // ── 5. Model switch (informational) ──────────────────────────────────────
  if (previousSession?.model && currentSession?.model &&
      previousSession.model !== currentSession.model) {
    flags.push({
      type: 'MODEL_SWITCH',
      severity: 'low',
      detail: `Model changed: ${previousSession.model} → ${currentSession.model}`,
    });
  }

  // ── Alignment score ────────────────────────────────────────────────────────
  const alignmentScore = computeAlignmentScore({
    coverage: driftCheck.coverage,
    violations: violatedConstraints.length,
    scopeExpansion: scopeCheck.ratio,
    incompleteTasks: taskCheck.detected,
  });

  const drift = flags.filter(f => f.severity !== 'low').length > 0;
  const severity = calcSeverity(flags, alignmentScore);

  let reason = 'On track — no drift detected';
  if (flags.length > 0) {
    const primary = flags.find(f => f.severity === 'high')
      || flags.find(f => f.severity === 'medium')
      || flags[0];
    reason = primary.detail;
  }

  return {
    drift,
    severity,
    reason,
    score: alignmentScore,
    flagCount: flags.length,
    flags,
    details: {
      coverage: driftCheck.coverage,
      scopeExpansion: scopeCheck.ratio,
      constraintViolations: violatedConstraints,
    },
  };
}

export { computeAlignmentScore, checkConstraintViolation };
