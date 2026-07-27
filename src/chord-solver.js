// Chart Retuner — chord-aware remapping (the guitar-chords feature). One
// of the pure-logic modules chart-retune.js aggregates into `CR`; never
// imports retune-engine.js, keeping that dependency one-way (it supplies
// this module's exact-candidate input, not the reverse).
//
// A per-note pitch-preserving remap can drop notes or break an open
// chord's shape under a shifted tuning, so this module solves a
// comparable voicing on the TARGET tuning instead. Priority order: 1)
// playable (<=MAX_CHORD_SPAN fret box, <=4 fingers, unless the source
// itself was wider), 2) hand shape close to the source (openness, barre,
// position), 3) root in the bass. Identity = pitch-class set + root —
// exact sounded pitches are strongly preferred, octave doublings may
// change when they aren't playable.
//
// Dispatch (solveChord): the exact per-note remap wins outright when
// it's collision-free and playable. Otherwise a pitch-class revoicing
// search (solveVoicingSearch) runs down a degradation ladder — full
// pitch-class set first, then triad, root+5th, bare root — each rung
// costed so a fuller solution always wins unless far worse. Every result
// carries `revoiced` (false only for the exact remap) and `rung` (which
// ladder step won). No candidate solves -> null (same drop contract as
// an unplayable single note).

import { notePitchClass } from './pitch.js';
import { DEFAULT_MAX_FRET } from './target-tuning.js';

// Max fretted-fret difference within one chord: 3 = a four-fret box
// (e.g. frets 5-6-7-8). A "5+ fret stretch" (max − min ≥ 4) is only
// allowed when the source chord itself carried one.
export const MAX_CHORD_SPAN = 3;
export const MAX_FRETTING_FINGERS = 4;

// Safety valve: max DFS nodes per solveChord call (shared across its
// degradation-ladder rungs). Real chart chords need hundreds to a few
// thousand nodes; the cap only bites on pathological data (a huge-span
// many-pitch-class group on a wide target defeats branch-and-bound
// pruning and can otherwise burn seconds on the render thread). On
// exhaustion the search stops and returns the best voicing found so far
// — possibly null, which callers treat as "solver gave up", NOT
// "unsoundable" (createRetuner falls back to the per-note path).
export const MAX_SEARCH_NODES = 20000;

// Additive cost weights, lower = better. Starting points, tuned by the
// test suite — the invariants that matter: playability is a hard
// constraint (not a weight); the shape terms (EXACT_PITCH_MISS on every
// note of a relocated voicing, OPENNESS_MISMATCH, BARRE_INTRODUCED,
// POSITION_DISTANCE) collectively outweigh ROOT_NOT_IN_BASS, encoding
// priority 2 > 3; DEGRADE_RUNG dwarfs everything else so a reduced
// chord only wins when the fuller rung has no acceptable voicing at all.
export const SOLVER_WEIGHTS = {
    EXACT_PITCH_MISS: 40,   // per target note not among the source's sounded pitches
    DROPPED_NOTE: 30,       // per source note whose pitch class vanished entirely
    DROPPED_DOUBLING: 8,    // per source note dropped while its pitch class stays covered
    ROOT_NOT_IN_BASS: 25,   // lowest sounded target note isn't the root (or slash bass)
    OPENNESS_MISMATCH: 12,  // per |source open-string count − target open-string count|
    BARRE_INTRODUCED: 30,   // target needs a barre (>4 fretted) where the source didn't
    POSITION_DISTANCE: 5,   // per fret |target min fretted fret − source min fretted fret|
    REGISTER_DISTANCE: 2,   // per semitone |target bass note − source bass note|
    NOTE_COUNT_DIFF: 4,     // per |target note count − source note count|
    INNER_MUTE: 10,         // per muted string strictly between sounded strings
    DEGRADE_RUNG: 500,      // per degradation-ladder rung
};

function pcOf(midi) {
    return ((midi % 12) + 12) % 12;
}

// Root (and slash bass, if any) pitch class from a chord template name:
// 'Am7' -> { rootPc: 9, bassPc: null }, 'C/G' -> { rootPc: 0, bassPc: 7 },
// 'F#5' -> { rootPc: 6, bassPc: null }. Returns null when the name doesn't
// start with a note letter (GP imports carry junk/empty names). The caller
// validates the parsed root against the actually-sounded pitch classes —
// a name that contradicts the notes loses to the lowest sounded pitch.
// Letter/accidental -> pitch-class parsing is pitch.js's notePitchClass —
// the same table parseTargetNote uses, so the two can't drift.
export function parseChordRootFromName(name) {
    if (typeof name !== 'string') return null;
    const m = /^\s*([A-Ga-g])([#b])?/.exec(name);
    if (!m) return null;
    const rootPc = notePitchClass(m[1], m[2]);
    const slash = /\/\s*([A-Ga-g])([#b])?\s*$/.exec(name);
    const bassPc = slash ? notePitchClass(slash[1], slash[2]) : null;
    return { rootPc, bassPc };
}

// Groups a fretted-note list (sorted by string) into maximal
// contiguous-string same-fret runs — a run is frettable with one finger
// laid across it (ring-finger mini-barre), e.g. the 2-2-2 of A major.
function _contiguousRuns(frettedSortedByString) {
    const runs = [];
    for (const n of frettedSortedByString) {
        const last = runs[runs.length - 1];
        if (last && last.f === n.f && n.s === last.maxS + 1) {
            last.notes.push(n);
            last.maxS = n.s;
        } else {
            runs.push({ f: n.f, minS: n.s, maxS: n.s, notes: [n] });
        }
    }
    return runs;
}

// Fingers needed to fret `voicing` ([{ s, f }], one note per string): a
// full barre at the chord's min fret counts as one finger (when valid —
// barreIsValid), and each contiguous same-fret run elsewhere counts as
// one (mini-barre). Open strings are free. Deliberately permissive —
// this gates playability; computeChordFingers below draws diagrams and
// prefers one-finger-per-note assignments.
export function fingersNeeded(voicing) {
    const fretted = voicing.filter(n => n.f > 0).sort((a, b) => a.s - b.s);
    if (fretted.length === 0) return 0;
    let minF = Infinity;
    for (const n of fretted) if (n.f < minF) minF = n.f;
    const atMin = fretted.filter(n => n.f === minF);
    const useBarre = atMin.length >= 2 && barreIsValid(voicing);
    const rest = useBarre ? fretted.filter(n => n.f !== minF) : fretted;
    return (useBarre ? 1 : 0) + _contiguousRuns(rest).length;
}

// A barre at the chord's min fretted fret lies across every string from
// the lowest barred string up — so it's invalid when any OPEN note
// sounds on a string the barre would cover (at or above the lowest
// same-min-fret string).
export function barreIsValid(voicing) {
    const fretted = voicing.filter(n => n.f > 0);
    if (fretted.length < 2) return false;
    let minF = Infinity;
    for (const n of fretted) if (n.f < minF) minF = n.f;
    let atMin = 0, barreLowS = Infinity;
    for (const n of fretted) {
        if (n.f !== minF) continue;
        atMin++;
        if (n.s < barreLowS) barreLowS = n.s;
    }
    if (atMin < 2) return false;
    return !voicing.some(n => n.f === 0 && n.s >= barreLowS);
}

// Hard playability check against the source chord's own difficulty:
// fretted stretch within max(MAX_CHORD_SPAN, source stretch), fingers
// within max(MAX_FRETTING_FINGERS, source fingers). Anything the source
// chord itself demanded stays allowed (it was in the chart).
export function voicingPlayable(voicing, spec) {
    const fretted = voicing.filter(n => n.f > 0);
    if (fretted.length > 1) {
        let minF = Infinity, maxF = -Infinity;
        for (const n of fretted) { if (n.f < minF) minF = n.f; if (n.f > maxF) maxF = n.f; }
        if (maxF - minF > Math.max(MAX_CHORD_SPAN, spec.span)) return false;
    }
    return fingersNeeded(voicing) <= Math.max(MAX_FRETTING_FINGERS, spec.fingers);
}

// Builds the solver's view of one source chord from its notes
// ([{ s, f, ... }], source-string indexed) under the source tuning
// (sourceOpenMidiByString — capo already folded in upstream, so f === 0
// means "open at the capo", zero fingers). templateName seeds the root
// when it parses AND agrees with the sounded pitch classes; otherwise
// the lowest sounded pitch is the root (right for the overwhelming
// majority of guitar chart chords). Returns null when no note sounds.
export function chordSpecFromNotes(sourceOpenMidiByString, notes, templateName) {
    const specNotes = [];
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const open = sourceOpenMidiByString[n.s];
        if (open === null || open === undefined) continue;
        const midi = open + n.f;
        specNotes.push({ idx: i, s: n.s, f: n.f, midi, pc: pcOf(midi) });
    }
    if (specNotes.length === 0) return null;
    const pitchSet = new Set(specNotes.map(n => n.midi));
    const pcs = new Set(specNotes.map(n => n.pc));
    const pcCounts = new Map();
    for (const n of specNotes) pcCounts.set(n.pc, (pcCounts.get(n.pc) || 0) + 1);
    let bassMidi = Infinity;
    for (const n of specNotes) if (n.midi < bassMidi) bassMidi = n.midi;
    const fretted = specNotes.filter(n => n.f > 0);
    let minFretted = null, span = 0;
    if (fretted.length > 0) {
        let minF = Infinity, maxF = -Infinity;
        for (const n of fretted) { if (n.f < minF) minF = n.f; if (n.f > maxF) maxF = n.f; }
        minFretted = minF;
        span = maxF - minF;
    }
    let rootPc = pcOf(bassMidi);
    let bassPc = null;
    const named = parseChordRootFromName(templateName);
    if (named && pcs.has(named.rootPc)) {
        rootPc = named.rootPc;
        if (named.bassPc !== null && pcs.has(named.bassPc)) bassPc = named.bassPc;
    }
    return {
        notes: specNotes,
        pitchSet,
        pcs,
        pcCounts,
        rootPc,
        bassPc,
        bassMidi,
        minFretted,
        span,
        openCount: specNotes.length - fretted.length,
        noteCount: specNotes.length,
        fingers: fingersNeeded(specNotes),
        requiresBarre: fretted.length > MAX_FRETTING_FINGERS,
    };
}

// The degradation ladder: required pitch-class sets from fullest to
// barest, consecutive duplicates removed. Interval preferences off the
// root: third = 4 (major) else 3 (minor), fifth = 7 (perfect) else
// 6 (dim) else 8 (aug) — only intervals actually present in the source
// chord are ever required.
export function degradationLadder(spec) {
    const has = pc => spec.pcs.has(pc);
    const iv = semis => pcOf(spec.rootPc + semis);
    const third = [4, 3].map(iv).find(has);
    const fifth = [7, 6, 8].map(iv).find(has);
    const rungs = [new Set(spec.pcs)];
    const triad = new Set([spec.rootPc]);
    if (third !== undefined) triad.add(third);
    if (fifth !== undefined) triad.add(fifth);
    rungs.push(triad);
    const dyad = new Set([spec.rootPc]);
    const partner = fifth !== undefined ? fifth : third;
    if (partner !== undefined) dyad.add(partner);
    rungs.push(dyad);
    rungs.push(new Set([spec.rootPc]));
    const out = [];
    for (const r of rungs) {
        const prev = out[out.length - 1];
        if (prev && prev.size === r.size && [...r].every(pc => prev.has(pc))) continue;
        out.push(r);
    }
    return out;
}

// Full cost of a candidate voicing ([{ s, f, midi, pc }]) against the
// spec. Every term is >= 0 and the per-note EXACT_PITCH_MISS portion is
// exactly what the search accumulates as its branch-and-bound partial
// cost, keeping that bound admissible.
export function scoreVoicing(spec, voicing) {
    const W = SOLVER_WEIGHTS;
    let cost = 0;
    let minMidi = Infinity, minMidiPc = -1, openCount = 0, minFretted = null;
    let minS = Infinity, maxS = -Infinity;
    const tgtPcCounts = new Map();
    for (const n of voicing) {
        if (!spec.pitchSet.has(n.midi)) cost += W.EXACT_PITCH_MISS;
        if (n.midi < minMidi) { minMidi = n.midi; minMidiPc = n.pc; }
        if (n.f === 0) openCount += 1;
        else if (minFretted === null || n.f < minFretted) minFretted = n.f;
        if (n.s < minS) minS = n.s;
        if (n.s > maxS) maxS = n.s;
        tgtPcCounts.set(n.pc, (tgtPcCounts.get(n.pc) || 0) + 1);
    }
    for (const [pc, srcCount] of spec.pcCounts) {
        const t = tgtPcCounts.get(pc) || 0;
        if (t === 0) cost += W.DROPPED_NOTE * srcCount;
        else if (t !== srcCount) cost += W.DROPPED_DOUBLING * Math.abs(t - srcCount);
    }
    if (minMidiPc !== (spec.bassPc !== null ? spec.bassPc : spec.rootPc)) cost += W.ROOT_NOT_IN_BASS;
    cost += W.OPENNESS_MISMATCH * Math.abs(openCount - spec.openCount);
    if (voicing.length - openCount > MAX_FRETTING_FINGERS && !spec.requiresBarre) cost += W.BARRE_INTRODUCED;
    cost += W.POSITION_DISTANCE * Math.abs((minFretted !== null ? minFretted : 0) - (spec.minFretted !== null ? spec.minFretted : 0));
    cost += W.REGISTER_DISTANCE * Math.abs(minMidi - spec.bassMidi);
    cost += W.NOTE_COUNT_DIFF * Math.abs(voicing.length - spec.noteCount);
    cost += W.INNER_MUTE * (maxS - minS + 1 - voicing.length);
    return cost;
}

// Searches every hand position for the min-cost playable voicing whose
// notes all belong to `requiredPcs`, covering every pc in it at least
// once. DFS over target strings (mute | open-if-in-set | in-set window
// frets) with branch-and-bound on the partial EXACT_PITCH_MISS cost;
// positions visited nearest-to-source first so the bound tightens early.
// Voicing size is capped at the source note count (opts.maxNotes) so
// _origNote/scoring semantics downstream stay sane. Returns
// { voicing: [{ s, f, midi, pc }], cost } or null.
//
// opts.budget (optional): a shared { nodes, aborted } counter, decremented
// per DFS node — pass the SAME object across the solveChord ladder rungs
// to bound one chord's work as a whole. Omitted -> a fresh
// MAX_SEARCH_NODES budget per call.
export function solveVoicingSearch(spec, requiredPcs, targetMidiTuning, opts, maxFret = DEFAULT_MAX_FRET) {
    const target = targetMidiTuning;
    if (!Array.isArray(target) || target.length === 0) return null;
    const nStr = target.length;
    const budget = (opts && opts.budget) || { nodes: MAX_SEARCH_NODES, aborted: false };
    const maxNotes = Math.min((opts && opts.maxNotes) || spec.noteCount, nStr);
    if (maxNotes < requiredPcs.size) return null;
    // Clamped so the position loop below always has at least p=1 (a
    // window covering the whole neck): a degenerate source span >= 20
    // (extreme GP import) must widen the search, never empty it — an
    // empty loop would also skip the open-string candidates it gates.
    const allowedSpan = Math.min(Math.max(MAX_CHORD_SPAN, spec.span), maxFret - 1);
    const pcsArr = [...requiredPcs];
    const pcBit = new Map(pcsArr.map((pc, i) => [pc, 1 << i]));
    const fullMask = (1 << pcsArr.length) - 1;
    const srcPos = spec.minFretted !== null ? spec.minFretted : 1;
    const positions = [];
    for (let p = 1; p <= maxFret - allowedSpan; p++) positions.push(p);
    positions.sort((a, b) => Math.abs(a - srcPos) - Math.abs(b - srcPos) || a - b);

    const W = SOLVER_WEIGHTS;
    let best = null;
    const chosen = [];
    for (const p of positions) {
        if (budget.nodes <= 0) { budget.aborted = true; break; }
        // Per-string candidates at this position: mute (null), the open
        // string when its pc qualifies, and every window fret whose pc
        // qualifies. Window frets start at the position itself — fret 0
        // is only ever the explicit open candidate.
        const cands = [];
        for (let j = 0; j < nStr; j++) {
            const open = target[j];
            const list = [null];
            const openBit = pcBit.get(pcOf(open));
            if (openBit !== undefined) list.push({ s: j, f: 0, midi: open, pc: pcOf(open), bit: openBit });
            for (let f = p; f <= p + allowedSpan && f <= maxFret; f++) {
                const midi = open + f;
                const bit = pcBit.get(pcOf(midi));
                if (bit !== undefined) list.push({ s: j, f, midi, pc: pcOf(midi), bit });
            }
            cands.push(list);
        }
        (function dfs(j, mask, partial) {
            if (budget.nodes-- <= 0) { budget.aborted = true; return; }
            if (best && partial >= best.cost) return;
            if (j === nStr) {
                if (mask !== fullMask || chosen.length === 0) return;
                if (fingersNeeded(chosen) > Math.max(MAX_FRETTING_FINGERS, spec.fingers)) return;
                const cost = scoreVoicing(spec, chosen);
                if (!best || cost < best.cost) best = { voicing: chosen.slice(), cost };
                return;
            }
            // Coverage feasibility: the remaining strings must be able to
            // supply every still-missing pc (one new note covers at most
            // one missing bit) within the note budget.
            const missing = fullMask & ~mask;
            let missingCount = 0;
            for (let m = missing; m; m >>= 1) missingCount += m & 1;
            const noteBudget = Math.min(maxNotes - chosen.length, nStr - j);
            if (missingCount > noteBudget) return;
            for (const c of cands[j]) {
                if (c === null) { dfs(j + 1, mask, partial); continue; }
                if (chosen.length >= maxNotes) continue;
                chosen.push(c);
                dfs(j + 1, mask | c.bit, partial + (spec.pitchSet.has(c.midi) ? 0 : W.EXACT_PITCH_MISS));
                chosen.pop();
            }
        })(0, 0, 0);
    }
    return best;
}

// Matches each solved target note back to a distinct source note (for
// _origNote scoring linkage and technique carry-over): exact MIDI match
// first, then nearest same-pitch-class, then nearest by pitch — always
// among the not-yet-used source notes; target notes are matched in
// ascending pitch order for determinism. Returns [{ srcIndex, s, f }]
// where srcIndex indexes the notes array chordSpecFromNotes was built
// from (spec.notes[k].idx).
export function matchVoicingToSource(voicing, spec) {
    const used = new Set();
    const ordered = voicing.slice().sort((a, b) => a.midi - b.midi || a.s - b.s);
    const placements = [];
    for (const n of ordered) {
        let pick = null;
        for (const s of spec.notes) {
            if (used.has(s.idx) || s.midi !== n.midi) continue;
            pick = s;
            break;
        }
        if (!pick) {
            let bestD = Infinity;
            for (const s of spec.notes) {
                if (used.has(s.idx) || s.pc !== n.pc) continue;
                const d = Math.abs(s.midi - n.midi);
                if (d < bestD) { bestD = d; pick = s; }
            }
        }
        if (!pick) {
            let bestD = Infinity;
            for (const s of spec.notes) {
                if (used.has(s.idx)) continue;
                const d = Math.abs(s.midi - n.midi);
                if (d < bestD) { bestD = d; pick = s; }
            }
        }
        if (!pick) return null; // impossible: |voicing| <= |spec.notes|
        used.add(pick.idx);
        placements.push({ srcIndex: pick.idx, s: n.s, f: n.f });
    }
    return placements;
}

// Dispatch for one chord. `exactCandidate` is the caller-computed exact
// per-note result ([{ srcIndex, s, f }] or null) — accepted when it
// covers every spec note and is playable, or is the source voicing
// verbatim. Otherwise runs the degradation ladder, comparing rungs on
// cost + rung*DEGRADE_RUNG (early break once no later rung can win).
// Returns { placements, revoiced, rung } or null (drop the chord).
// `revoiced` is false only for the exact-candidate path; `rung` (0 =
// full pitch-class set, higher = more degraded) is 0 there too, since it
// doesn't apply. `maxFret` is the active tuning profile's own ceiling.
//
// opts.budget (optional): one { nodes, aborted } object shared across
// every ladder rung, bounding a pathological chord as a WHOLE (see
// MAX_SEARCH_NODES) — `aborted` tells "gave up" (fall back to per-note)
// from a genuine "nothing soundable" null.
export function solveChord(spec, targetMidiTuning, exactCandidate, maxFret = DEFAULT_MAX_FRET, opts) {
    if (!spec || spec.notes.length === 0) return null;
    if (Array.isArray(exactCandidate) && exactCandidate.length === spec.notes.length) {
        const byIdx = new Map(spec.notes.map(n => [n.idx, n]));
        const identity = exactCandidate.every(pl => {
            const src = byIdx.get(pl.srcIndex);
            return src && src.s === pl.s && src.f === pl.f;
        });
        const voicing = exactCandidate.map(pl => ({ s: pl.s, f: pl.f }));
        if (identity || voicingPlayable(voicing, spec)) {
            return { placements: exactCandidate, revoiced: false, rung: 0 };
        }
    }
    const W = SOLVER_WEIGHTS;
    const budget = (opts && opts.budget) || { nodes: MAX_SEARCH_NODES, aborted: false };
    const rungs = degradationLadder(spec);
    let best = null;
    for (let r = 0; r < rungs.length; r++) {
        if (budget.nodes <= 0) { budget.aborted = true; break; }
        const found = solveVoicingSearch(spec, rungs[r], targetMidiTuning, { maxNotes: spec.noteCount, budget }, maxFret);
        if (found) {
            const total = found.cost + r * W.DEGRADE_RUNG;
            if (!best || total < best.total) {
                const placements = matchVoicingToSource(found.voicing, spec);
                if (placements) best = { total, placements, revoiced: true, rung: r };
            }
        }
        // No later rung (baseline (r+1) * DEGRADE_RUNG) can beat this.
        if (best && best.total <= (r + 1) * W.DEGRADE_RUNG) break;
    }
    return best ? { placements: best.placements, revoiced: best.revoiced, rung: best.rung } : null;
}

// Plausible finger numbers for a remapped chord template (frets-by-
// target-string, -1 = unused, 0 = open, n = fret). Prefers canonical
// one-finger-per-note in ascending (fret, string) order, falls back to a
// barre (same-fret notes at the min fret share finger 1, per
// barreIsValid) then contiguous-run mini-barre grouping when there are
// more fretted notes than fingers. Deliberately conservative: anything
// still ambiguous returns all -1 (GP imports already render this way) —
// a wrong finger number is worse than none.
export function computeChordFingers(fretsByTargetString) {
    const n = fretsByTargetString.length;
    const fingers = new Array(n).fill(-1);
    const voicing = [];
    for (let s = 0; s < n; s++) {
        const f = fretsByTargetString[s];
        if (f === 0) fingers[s] = 0;
        else if (f > 0) voicing.push({ s, f });
        // fingers[s] stays -1 for unused strings
    }
    if (voicing.length === 0) return fingers;
    const all = fretsByTargetString.map((f, s) => ({ s, f })).filter(x => x.f >= 0);
    const byString = voicing.slice().sort((a, b) => a.s - b.s);
    const minF = Math.min(...voicing.map(x => x.f));
    const atMin = byString.filter(x => x.f === minF);
    const useBarre = atMin.length >= 2 && voicing.length > MAX_FRETTING_FINGERS && barreIsValid(all);
    const rest = useBarre ? byString.filter(x => x.f !== minF) : byString;
    let next = useBarre ? 2 : 1;
    if (useBarre) for (const x of atMin) fingers[x.s] = 1;
    if (rest.length <= MAX_FRETTING_FINGERS - (useBarre ? 1 : 0)) {
        // Canonical: one finger per remaining note, low fret first.
        const sorted = rest.slice().sort((a, b) => a.f - b.f || a.s - b.s);
        for (const x of sorted) fingers[x.s] = next++;
        return fingers;
    }
    // Mini-barre fallback: contiguous same-fret runs share a finger.
    const runs = _contiguousRuns(rest).sort((a, b) => a.f - b.f || a.minS - b.minS);
    if (next - 1 + runs.length > MAX_FRETTING_FINGERS) {
        return new Array(n).fill(-1).map((v, s) => (fretsByTargetString[s] === 0 ? 0 : -1)); // ambiguous
    }
    for (const run of runs) {
        for (const x of run.notes) fingers[x.s] = next;
        next++;
    }
    return fingers;
}
