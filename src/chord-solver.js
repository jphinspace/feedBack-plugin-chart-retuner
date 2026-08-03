// Chart Retuner — chord-aware remapping (the guitar-chords feature). One
// of the pure-logic modules chart-retune.js aggregates into `CR`, kept
// one-way with retune-engine.js: that module calls into this one,
// supplying this module's exact-candidate input.
//
// A per-note pitch-preserving remap can drop notes or break an open
// chord's shape under a shifted tuning, so this module solves a
// comparable voicing on the TARGET tuning instead. Priority order: 1)
// playable (<=MAX_CHORD_SPAN fret box, <=4 fingers, unless the source
// itself was wider), 2) hand shape close to the source (openness, barre,
// position), 3) root in the bass. Identity = pitch-class set + root.
// Exact sounded pitches are strongly preferred; octave doublings adapt
// to keep the result playable.
//
// Dispatch (solveChord): the exact per-note remap wins outright when
// it's collision-free and playable. Otherwise a pitch-class revoicing
// search (solveVoicingSearch) runs down a degradation ladder (full
// pitch-class set, then triad, root+5th, bare root), each level costed
// so a fuller solution wins unless far worse. Every result carries
// `revoiced` and `degradeLevel` (which step won); no candidate solving
// returns null.

import { notePitchClass, pitchClassOf } from './pitch.js';
import { DEFAULT_MAX_FRET } from './target-tuning.js';

// Max fretted-fret difference within one chord (a four-fret box). A
// wider stretch is only allowed when the source chord itself carried
// one.
export const MAX_CHORD_SPAN = 3;
export const MAX_FRETTING_FINGERS = 4;

// Safety valve: max DFS nodes per solveChord call, shared across its
// degradation-ladder levels. The cap only bites on pathological data (a
// huge-span many-pitch-class group defeats branch-and-bound pruning),
// where it can otherwise burn seconds on the render thread. On
// exhaustion, the search returns its best voicing so far, possibly null
// — callers treat that as "solver gave up" (fall back to per-note)
// rather than "unsoundable".
export const MAX_SEARCH_NODES = 20000;

// Additive cost weights, lower = better; tuned by the test suite.
// Playability is enforced as a hard constraint ahead of these weighted
// terms. The shape terms (EXACT_PITCH_MISS, OPENNESS_MISMATCH,
// BARRE_INTRODUCED, POSITION_DISTANCE) collectively outweigh
// ROOT_NOT_IN_BASS, encoding priority 2 > 3. DEGRADE_LEVEL dwarfs
// everything else, so a reduced chord only wins when the fuller level
// has no acceptable voicing.
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
    DEGRADE_LEVEL: 500,     // per degradation-ladder level
};

// Fret/finger-field convention shared with retune-engine.js: -1 = not
// applicable, 0 = open (no dedicated finger), n > 0 = fretted/finger number.
export function isFretted(v) { return v > 0; }
export function isOpen(v) { return v === 0; }
export function isRealFret(v) { return Number.isInteger(v) && v >= 0; }

// Root (and slash bass, if any) pitch class from a chord template name.
// Returns null unless the name starts with a note letter (GP imports
// carry junk/empty names); the caller validates the parsed root against
// the actually-sounded pitch classes, so a name that contradicts the
// notes loses to the lowest sounded pitch. Uses pitch.js's
// notePitchClass, keeping letter/accidental parsing in sync with
// parseTargetNote.
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
// contiguous-string same-fret runs, each frettable with one finger laid
// across it (a mini-barre).
function contiguousRuns(frettedSortedByString) {
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

// Min/max `.f` across a fretted-note list ({ min: Infinity, max: -Infinity }
// for an empty list — callers that care check length first).
function fretRange(fretted) {
    let min = Infinity;
    let max = -Infinity;
    for (const n of fretted) { if (n.f < min) min = n.f; if (n.f > max) max = n.f; }
    return { min, max };
}

// Fingers needed to fret `voicing` ([{ s, f }], one note per string): a
// full barre at the chord's min fret counts as one (when valid, per
// barreIsValid); each contiguous same-fret run elsewhere counts as one
// mini-barre. Open strings are free. Deliberately permissive, since this
// only gates playability (computeChordFingers below draws diagrams).
export function fingersNeeded(voicing) {
    const fretted = voicing.filter(n => isFretted(n.f)).sort((a, b) => a.s - b.s);
    if (fretted.length === 0) return 0;
    const minF = fretRange(fretted).min;
    const atMin = fretted.filter(n => n.f === minF);
    const useBarre = atMin.length >= 2 && barreIsValid(voicing);
    const rest = useBarre ? fretted.filter(n => n.f !== minF) : fretted;
    return (useBarre ? 1 : 0) + contiguousRuns(rest).length;
}

// A barre at the chord's min fretted fret covers every string from the
// lowest barred string up, so it's invalid when an open note sounds on
// any string at or above that point.
export function barreIsValid(voicing) {
    const fretted = voicing.filter(n => isFretted(n.f));
    if (fretted.length < 2) return false;
    const minF = fretRange(fretted).min;
    let atMin = 0;
    let barreLowS = Infinity;
    for (const n of fretted) {
        if (n.f !== minF) continue;
        atMin += 1;
        if (n.s < barreLowS) barreLowS = n.s;
    }
    if (atMin < 2) return false;
    return !voicing.some(n => isOpen(n.f) && n.s >= barreLowS);
}

// Hard playability check against the source chord's own difficulty:
// fretted stretch within max(MAX_CHORD_SPAN, source stretch), fingers
// within max(MAX_FRETTING_FINGERS, source fingers). Anything the source
// chord itself demanded stays allowed (it was in the chart).
export function voicingPlayable(voicing, spec) {
    const fretted = voicing.filter(n => isFretted(n.f));
    if (fretted.length > 1) {
        const { min: minF, max: maxF } = fretRange(fretted);
        if (maxF - minF > Math.max(MAX_CHORD_SPAN, spec.span)) return false;
    }
    return fingersNeeded(voicing) <= Math.max(MAX_FRETTING_FINGERS, spec.fingers);
}

// Strict, source-relative playability — no slack up to the generic
// beginner-chord ceiling the way voicingPlayable grants. Used only to
// gate the exact-pitch candidate below: a source chord's ease often
// comes from a capo doing a finger's job for free (an open string, or a
// raw fret at/below the capo, needs no finger at all), and that
// assistance doesn't exist on an uncapo'd target — reproducing the exact
// pitch can legitimately demand more fingers or a wider stretch than the
// source ever did. When it does, a revoiced voicing genuinely no harder
// than the source (the degradation ladder below) is the better outcome,
// even though the exact pitch would still clear the generic ceiling.
function notHarderThanSource(voicing, spec) {
    const fretted = voicing.filter(n => isFretted(n.f));
    if (fretted.length > 1) {
        const { min: minF, max: maxF } = fretRange(fretted);
        if (maxF - minF > spec.span) return false;
    }
    return fingersNeeded(voicing) <= spec.fingers;
}

// Builds the solver's view of one source chord from its notes
// ([{ s, f, ... }], source-string indexed) under the source tuning
// (sourceOpenMidiByString excludes chart capo; `capo` raises only the
// PITCH of notes at or below it — see the Math.max below). `.f` on each
// spec note stays the chart's own raw fret, not the capo-raised one: it
// drives span/finger-count difficulty (fretRange, fingersNeeded,
// barreIsValid), and the raw fret is what the player's hand actually
// does — a capo'd open string needs no finger at all, so it must not
// read as a real fretted note there. templateName seeds the root when
// it parses and agrees with the sounded pitch classes; otherwise the
// lowest sounded pitch is the root. Returns null when no note sounds.
export function chordSpecFromNotes(sourceOpenMidiByString, notes, templateName, capo = 0) {
    const specNotes = [];
    for (let i = 0; i < notes.length; i += 1) {
        const n = notes[i];
        const open = sourceOpenMidiByString[n.s];
        if (open === null || open === undefined) continue;
        const midi = open + Math.max(n.f, capo);
        specNotes.push({ idx: i, s: n.s, f: n.f, midi, pc: pitchClassOf(midi) });
    }
    if (specNotes.length === 0) return null;
    const pitchSet = new Set(specNotes.map(n => n.midi));
    const pcs = new Set(specNotes.map(n => n.pc));
    const pcCounts = new Map();
    for (const n of specNotes) pcCounts.set(n.pc, (pcCounts.get(n.pc) || 0) + 1);
    let bassMidi = Infinity;
    for (const n of specNotes) if (n.midi < bassMidi) bassMidi = n.midi;
    const fretted = specNotes.filter(n => isFretted(n.f));
    let minFretted = null;
    let span = 0;
    if (fretted.length > 0) {
        const { min: minF, max: maxF } = fretRange(fretted);
        minFretted = minF;
        span = maxF - minF;
    }
    let rootPc = pitchClassOf(bassMidi);
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
// barest, consecutive duplicates removed. Third = 4 semitones (major)
// else 3 (minor); fifth = 7 (perfect) else 6 (dim) else 8 (aug); only
// intervals actually present in the source chord are required.
export function degradationLadder(spec) {
    const has = pc => spec.pcs.has(pc);
    const iv = semis => pitchClassOf(spec.rootPc + semis);
    const third = [4, 3].map(iv).find(has);
    const fifth = [7, 6, 8].map(iv).find(has);
    const levels = [new Set(spec.pcs)];
    const triad = new Set([spec.rootPc]);
    if (third !== undefined) triad.add(third);
    if (fifth !== undefined) triad.add(fifth);
    levels.push(triad);
    const dyad = new Set([spec.rootPc]);
    const partner = fifth !== undefined ? fifth : third;
    if (partner !== undefined) dyad.add(partner);
    levels.push(dyad);
    levels.push(new Set([spec.rootPc]));
    const out = [];
    for (const level of levels) {
        const prev = out[out.length - 1];
        if (prev && prev.size === level.size && [...level].every(pc => prev.has(pc))) continue;
        out.push(level);
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
    let minMidi = Infinity;
    let minMidiPc = -1;
    let openCount = 0;
    let minFretted = null;
    let minS = Infinity;
    let maxS = -Infinity;
    const tgtPcCounts = new Map();
    for (const n of voicing) {
        if (!spec.pitchSet.has(n.midi)) cost += W.EXACT_PITCH_MISS;
        if (n.midi < minMidi) { minMidi = n.midi; minMidiPc = n.pc; }
        if (isOpen(n.f)) openCount += 1;
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
    // Only penalize losing opens, not gaining extra ones.
    cost += W.OPENNESS_MISMATCH * Math.max(0, spec.openCount - openCount);
    if (voicing.length - openCount > MAX_FRETTING_FINGERS && !spec.requiresBarre) cost += W.BARRE_INTRODUCED;
    cost += W.POSITION_DISTANCE * Math.abs((minFretted !== null ? minFretted : 0) - (spec.minFretted !== null ? spec.minFretted : 0));
    cost += W.REGISTER_DISTANCE * Math.abs(minMidi - spec.bassMidi);
    cost += W.NOTE_COUNT_DIFF * Math.abs(voicing.length - spec.noteCount);
    cost += W.INNER_MUTE * (maxS - minS + 1 - voicing.length);
    return cost;
}

// Searches every hand position for the min-cost playable voicing whose
// notes all belong to `requiredPcs`, covering every pc at least once.
// DFS over target strings (mute | open-if-in-set | in-set window frets)
// with branch-and-bound on the partial EXACT_PITCH_MISS cost; positions
// visited nearest-to-source first so the bound tightens early. Voicing
// size is capped at the source note count. Returns
// { voicing: [{ s, f, midi, pc }], cost } or null.
//
// opts.budget (optional): a shared { nodes, aborted } counter, decremented
// per DFS node — pass the SAME object across the solveChord ladder levels
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
    // window covering the whole neck): a degenerate source span must
    // still widen the search while keeping the loop non-empty, since an
    // empty loop would also skip the open-string candidates it gates.
    const allowedSpan = Math.min(Math.max(MAX_CHORD_SPAN, spec.span), maxFret - 1);
    const pcsArr = [...requiredPcs];
    const pcBit = new Map(pcsArr.map((pc, i) => [pc, 1 << i]));
    const fullMask = (1 << pcsArr.length) - 1;
    const srcPos = spec.minFretted !== null ? spec.minFretted : 1;
    const positions = [];
    for (let p = 1; p <= maxFret - allowedSpan; p += 1) positions.push(p);
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
        for (let j = 0; j < nStr; j += 1) {
            const open = target[j];
            const list = [null];
            const openBit = pcBit.get(pitchClassOf(open));
            if (openBit !== undefined) list.push({ s: j, f: 0, midi: open, pc: pitchClassOf(open), bit: openBit });
            for (let f = p; f <= p + allowedSpan && f <= maxFret; f += 1) {
                const midi = open + f;
                const bit = pcBit.get(pitchClassOf(midi));
                if (bit !== undefined) list.push({ s: j, f, midi, pc: pitchClassOf(midi), bit });
            }
            cands.push(list);
        }
        (function dfs(j, mask, partial) {
            const nodesLeft = budget.nodes;
            budget.nodes -= 1;
            if (nodesLeft <= 0) { budget.aborted = true; return; }
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
// origNote scoring linkage and technique carry-over): exact MIDI match
// first, then nearest same-pitch-class, then nearest by pitch, always
// among not-yet-used source notes. Target notes are matched in ascending
// pitch order for determinism. Returns [{ srcIndex, s, f }], srcIndex
// indexing the notes array chordSpecFromNotes was built from.
export function matchVoicingToSource(voicing, spec) {
    const used = new Set();
    const ordered = voicing.slice().sort((a, b) => a.midi - b.midi || a.s - b.s);
    const placements = [];
    for (const n of ordered) {
        // Nearest not-yet-used source note passing `filter`; an exact
        // midi match is always distance 0, so this doubles as "first
        // exact match wins" for that case.
        const findNearest = (filter) => {
            let bestD = Infinity;
            let picked = null;
            for (const s of spec.notes) {
                if (used.has(s.idx) || !filter(s)) continue;
                const d = Math.abs(s.midi - n.midi);
                if (d < bestD) { bestD = d; picked = s; }
            }
            return picked;
        };
        const pick = findNearest(s => s.midi === n.midi)
            || findNearest(s => s.pc === n.pc)
            || findNearest(() => true);
        if (!pick) return null; // impossible: |voicing| <= |spec.notes|
        used.add(pick.idx);
        placements.push({ srcIndex: pick.idx, s: n.s, f: n.f });
    }
    return placements;
}

// Cheapest all-open (no fretted notes) target voicing covering every pc
// in requiredPcs, or null if no combination of open strings covers them all.
function allOpenCandidate(spec, requiredPcs, targetMidiTuning) {
    const target = targetMidiTuning;
    if (!Array.isArray(target) || target.length === 0) return null;
    const openNotes = [];
    for (let s = 0; s < target.length; s += 1) {
        const midi = target[s];
        const pc = pitchClassOf(midi);
        if (requiredPcs.has(pc)) openNotes.push({ s, f: 0, midi, pc });
    }
    const n = openNotes.length;
    if (n === 0) return null;
    let best = null;
    for (let mask = 1; mask < (1 << n); mask += 1) {
        const voicing = [];
        const covered = new Set();
        for (let i = 0; i < n; i += 1) {
            if (mask & (1 << i)) { voicing.push(openNotes[i]); covered.add(openNotes[i].pc); }
        }
        let coversAll = true;
        for (const pc of requiredPcs) { if (!covered.has(pc)) { coversAll = false; break; } }
        if (!coversAll) continue;
        const cost = scoreVoicing(spec, voicing);
        if (!best || cost < best.cost) best = { voicing, cost };
    }
    return best;
}

// Dispatch for one chord. `exactCandidate` ([{ srcIndex, s, f }] or
// null) is accepted when it covers every spec note and is playable, or
// is the source voicing verbatim. Otherwise runs the degradation ladder,
// comparing levels on cost + degradeLevel*DEGRADE_LEVEL, breaking early
// once no later level can win. Returns { placements, revoiced,
// degradeLevel } or null. `revoiced` is false only for the
// exact-candidate path, where `degradeLevel` is always 0.
//
// opts.budget (optional): one { nodes, aborted } object shared across
// every ladder level, bounding the whole chord's work. `aborted`
// distinguishes "solver gave up" from a genuine unsoundable null.
export function solveChord(spec, targetMidiTuning, exactCandidate, maxFret = DEFAULT_MAX_FRET, opts) {
    if (!spec || spec.notes.length === 0) return null;
    if (Array.isArray(exactCandidate) && exactCandidate.length === spec.notes.length) {
        const byIdx = new Map(spec.notes.map(n => [n.idx, n]));
        const identity = exactCandidate.every(pl => {
            const src = byIdx.get(pl.srcIndex);
            return src && src.s === pl.s && src.f === pl.f;
        });
        const voicing = exactCandidate.map(pl => ({ s: pl.s, f: pl.f }));
        if (identity || notHarderThanSource(voicing, spec)) {
            return { placements: exactCandidate, revoiced: false, degradeLevel: 0 };
        }
    }
    // An open-voiced source tries an all-open target first — the search
    // below anchors near the source's own frets and won't jump strings.
    if (spec.openCount > 0) {
        const allOpen = allOpenCandidate(spec, spec.pcs, targetMidiTuning);
        if (allOpen) {
            const placements = matchVoicingToSource(allOpen.voicing, spec);
            if (placements) return { placements, revoiced: true, degradeLevel: 0 };
        }
    }
    const W = SOLVER_WEIGHTS;
    const budget = (opts && opts.budget) || { nodes: MAX_SEARCH_NODES, aborted: false };
    const levels = degradationLadder(spec);
    let best = null;
    for (let level = 0; level < levels.length; level += 1) {
        if (budget.nodes <= 0) { budget.aborted = true; break; }
        const found = solveVoicingSearch(spec, levels[level], targetMidiTuning, { maxNotes: spec.noteCount, budget }, maxFret);
        if (found) {
            const total = found.cost + level * W.DEGRADE_LEVEL;
            if (!best || total < best.total) {
                const placements = matchVoicingToSource(found.voicing, spec);
                if (placements) best = { total, placements, revoiced: true, degradeLevel: level };
            }
        }
        // No later level (baseline (level+1) * DEGRADE_LEVEL) can beat this.
        if (best && best.total <= (level + 1) * W.DEGRADE_LEVEL) break;
    }
    return best ? { placements: best.placements, revoiced: best.revoiced, degradeLevel: best.degradeLevel } : null;
}

// Plausible finger numbers for a remapped chord template (frets-by-
// target-string; -1 = unused, 0 = open, n = fret). Prefers canonical
// one-finger-per-note in ascending (fret, string) order, falling back to
// a barre (per barreIsValid) then contiguous-run mini-barre grouping
// when there are more fretted notes than fingers. Anything still
// ambiguous returns all -1, since a wrong finger number is worse than
// none.
export function computeChordFingers(fretsByTargetString) {
    const n = fretsByTargetString.length;
    const fingers = new Array(n).fill(-1);
    const voicing = [];
    for (let s = 0; s < n; s += 1) {
        const f = fretsByTargetString[s];
        if (isOpen(f)) fingers[s] = 0;
        else if (isFretted(f)) voicing.push({ s, f });
        // fingers[s] stays -1 for unused strings
    }
    if (voicing.length === 0) return fingers;
    const all = fretsByTargetString.map((f, s) => ({ s, f })).filter(x => isRealFret(x.f));
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
        for (const x of sorted) { fingers[x.s] = next; next += 1; }
        return fingers;
    }
    // Mini-barre fallback: contiguous same-fret runs share a finger.
    const runs = contiguousRuns(rest).sort((a, b) => a.f - b.f || a.minS - b.minS);
    if (next - 1 + runs.length > MAX_FRETTING_FINGERS) {
        return new Array(n).fill(-1).map((v, s) => (isOpen(fretsByTargetString[s]) ? 0 : -1)); // ambiguous
    }
    for (const run of runs) {
        for (const x of run.notes) fingers[x.s] = next;
        next += 1;
    }
    return fingers;
}
