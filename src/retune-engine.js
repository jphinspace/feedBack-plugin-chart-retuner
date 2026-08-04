// Chart Retuner — stage 4: takes stage 3's octave-shifted source pitches
// and stage 2's capo'd target tuning, and remaps notes/chords/
// chord-templates onto the target — this is the stage responsible for
// whether a note/chord ends up playable at all. Hand-position anchor
// remapping lives in note-anchors.js (stage 5), which consumes this
// module's remapped notes as plain input. One of the pure-logic modules
// chart-retune.js aggregates into `CR`.
//
// One fret = one half-step. Every function looks up each target string's
// own open pitch from `target[j]`, so irregular (non-fourths) target
// tunings work with no special-casing. Simultaneous-note groups (chords,
// same-onset flat-note buckets, chord templates) route through the
// chord-aware solver (src/chord-solver.js) — see the PATCH POINT (chord
// solver) blocks in createRetuner below.

import { DEFAULT_MAX_FRET, HAND_JUMP_FRET_THRESHOLD } from './common.js';
import { DEFAULT_TARGET_MIDI_TUNING, MAX_FRET_OPTIONS, MAX_TARGET_STRING_COUNT } from './target-tuning.js';
import { computeOpenStringMidiByString, MAX_SOURCE_STRING_COUNT } from './source-tuning.js';
import { chordSpecFromNotes, solveChord, computeChordFingers, MAX_SEARCH_NODES, isFretted, isOpen, isRealFret } from './chord-solver.js';
import { remapAnchors } from './note-anchors.js';
import { CAPO_OUTPUT_MODE, projectCapoOutput, resolveCapoOutputMode } from './capo-output.js';

// The shift k (target string = source string + k) that best aligns the
// source strings with the target — most exact matches win, ties broken by
// smallest total |adjustment| then smallest |k|. `sourceOpenMidiByString`
// is optional, pass it when already computed. Needs both stage 3's source
// pitches and stage 2's target tuning, so it lives here rather than in
// either stage's own file.
export function computeArrangementShift(sourceStringCount, tuningOffsets, capo, sourceOpenMidiByString, targetMidiTuning) {
    const midiByString = sourceOpenMidiByString || computeOpenStringMidiByString(sourceStringCount, tuningOffsets, capo);
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    let bestK = 0;
    let bestExact = -1;
    let bestTotalAbs = Infinity;
    for (let k = 1 - sourceStringCount; k <= target.length - 1; k += 1) {
        let exact = 0;
        let totalAbs = 0;
        let counted = 0;
        for (let s = 0; s < sourceStringCount; s += 1) {
            const j = s + k;
            if (j < 0 || j >= target.length) continue;
            const midi = midiByString[s];
            if (midi === null) continue;
            const adjustment = midi - target[j];
            counted += 1;
            totalAbs += Math.abs(adjustment);
            if (adjustment === 0) exact += 1;
        }
        if (counted === 0) continue;
        if (exact > bestExact
            || (exact === bestExact && totalAbs < bestTotalAbs)
            || (exact === bestExact && totalAbs === bestTotalAbs && Math.abs(k) < Math.abs(bestK))) {
            bestExact = exact;
            bestTotalAbs = totalAbs;
            bestK = k;
        }
    }
    return bestK;
}

// A note's slide destination and which field carries it (sl wins if both
// are set); null if it isn't sliding.
function slideTarget(note) {
    if (isRealFret(note.sl)) return { field: 'sl', to: note.sl };
    if (isRealFret(note.slu)) return { field: 'slu', to: note.slu };
    return null;
}

// ---- Pathological-chart safety valves (createRetuner) ----------------
// Keeps one remap fast enough to never stall the render thread. Three
// bounds, chord-solver.js's MAX_SEARCH_NODES plus the two below, all
// overridable per retuner via createRetuner(opts).

// A simultaneous-note group larger than this skips the solver and takes
// the bounded per-note path instead; no real instrument needs a group
// this size, so it signals corrupt chart data.
export const MAX_SOLVER_GROUP_SIZE = 12;
// Exact slide option combinations tried before falling back to the preferred
// non-colliding slide subset. Bounded independently from chord DFS nodes.
export const MAX_SLIDE_PLACEMENT_COMBINATIONS = 128;
// Deadline for one whole cold remap, checked between work units. Past
// it, remaining groups take the per-note path.
export const MAX_TOTAL_SOLVE_MS = 40;

const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? () => performance.now()
    : () => Date.now();

// Pitch-order tables per target-tuning array, cached by array identity
// (resolveTargetTuning always allocates a fresh array). Null for an
// ascending target, where resolveTargetForFret can walk by index
// directly. Otherwise { byPitch, rankOf }: an index walk on a
// non-monotonic target (a drone string tuned above its neighbors) can
// march away from the string that could actually play the note.
const pitchOrderCache = new WeakMap();
function pitchOrderFor(target) {
    let cached = pitchOrderCache.get(target);
    if (cached === undefined) {
        cached = null;
        for (let i = 1; i < target.length; i += 1) {
            if (target[i] < target[i - 1]) {
                const byPitch = target.map((_, idx) => idx).sort((a, b) => target[a] - target[b] || a - b);
                const rankOf = new Array(target.length);
                byPitch.forEach((idx, rank) => { rankOf[idx] = rank; });
                cached = { byPitch, rankOf };
                break;
            }
        }
        pitchOrderCache.set(target, cached);
    }
    return cached;
}

// Resolves one (sourceOpenMidi, fret) against the target: starts from the
// natural target string and walks in pitch order toward whichever
// direction the out-of-range fret demands. Returns { s, f, adjustment }
// or null if unplayable on every string.
//
// Anchors on the natural string first rather than searching globally for
// the smallest adjustment, since a global search can flip to the wrong
// string too early on a large single-string tuning drop.
export function resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    const ord = pitchOrderFor(target);
    // Walk position: an index directly for an ascending target, a pitch
    // RANK otherwise.
    let r = Math.max(0, Math.min(target.length - 1, naturalTargetString));
    if (ord) r = ord.rankOf[r];
    // The direction lock is also the termination guarantee: reversing
    // proves the note is unplayable everywhere, since underflow at one
    // pitch implies underflow at every higher one (and the reverse for
    // overflow).
    let dir = 0;
    while (r >= 0 && r < target.length) {
        const j = ord ? ord.byPitch[r] : r;
        const adjustment = sourceOpenMidi - target[j];
        const targetFret = fret + adjustment;
        if (targetFret < 0) {
            if (dir > 0) return null;
            dir = -1;
            r -= 1;
            continue;
        }
        if (targetFret > maxFret) {
            if (dir < 0) return null;
            dir = 1;
            r += 1;
            continue;
        }
        return { s: j, f: targetFret, adjustment };
    }
    return null;
}

export function remapNote(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    const best = resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning, maxFret);
    return best ? { s: best.s, f: best.f } : null;
}

// Every exact placement for a slide, ordered natural string first and then
// neighboring strings by distance. Both sounded endpoints must fit on the
// SAME target string; unlike the old endpoint-clamping path, this can never
// silently change either pitch.
export function remapSlideCandidates(sourceOpenMidi, naturalTargetString, fret, slideToFret, targetMidiTuning, maxFret = DEFAULT_MAX_FRET, capo = 0) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return [];
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    if (!Array.isArray(target) || target.length === 0) return [];
    // Chart capo only raises a fret sitting at/below the capo (i.e. an
    // open string); a slide endpoint already above it is an absolute
    // position and must not also pick up the capo.
    const effFret = Math.max(fret, capo);
    const effSlideTo = Math.max(slideToFret, capo);
    const startMidi = sourceOpenMidi + effFret;
    const endMidi = sourceOpenMidi + effSlideTo;
    const natural = Math.max(0, Math.min(target.length - 1, naturalTargetString));
    const candidates = [];
    for (let s = 0; s < target.length; s += 1) {
        const targetFret = startMidi - target[s];
        const targetEnd = endMidi - target[s];
        if (!Number.isInteger(targetFret) || !Number.isInteger(targetEnd)) continue;
        if (targetFret < 0 || targetFret > maxFret || targetEnd < 0 || targetEnd > maxFret) continue;
        candidates.push({ s, f: targetFret, slideTo: targetEnd });
    }
    candidates.sort((a, b) => Math.abs(a.s - natural) - Math.abs(b.s - natural)
        || Math.abs(a.f - effFret) - Math.abs(b.f - effFret)
        || a.s - b.s);
    return candidates;
}

// Best exact slide placement. Null means no target string can sound both
// endpoints within the playable neck; callers drop the slide note rather
// than inventing a replacement interval.
export function remapSlide(sourceOpenMidi, naturalTargetString, fret, slideToFret, targetMidiTuning, maxFret = DEFAULT_MAX_FRET, capo = 0) {
    const candidates = remapSlideCandidates(
        sourceOpenMidi, naturalTargetString, fret, slideToFret,
        targetMidiTuning, maxFret, capo,
    );
    return candidates && candidates.length ? candidates[0] : null;
}

export function noteHalfstepRank(sourceOpenMidi, fret) {
    return sourceOpenMidi + fret;
}

// Dispatches to remapSlide when the note carries sl/slu, else remapNote.
export function remapNoteEntry(sourceOpenMidi, naturalTargetString, note, targetMidiTuning, maxFret = DEFAULT_MAX_FRET, capo = 0) {
    const slide = slideTarget(note);
    if (slide) {
        const r = remapSlide(sourceOpenMidi, naturalTargetString, note.f, slide.to, targetMidiTuning, maxFret, capo);
        if (!r) return null;
        const out = { s: r.s, f: r.f };
        out[slide.field] = r.slideTo;
        return out;
    }
    return remapNote(sourceOpenMidi, naturalTargetString, Math.max(note.f, capo), targetMidiTuning, maxFret);
}

// Remaps every note, then keeps only the lower-pitched note per colliding
// target string. This public helper handles each note independently; the
// grouped chord fallback below gives exact slides priority before ordinary
// notes. Returns { entry, note } per survivor.
export function resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret = DEFAULT_MAX_FRET, capo = 0) {
    const candidates = [];
    for (const note of notes) {
        const midi = sourceOpenMidiByString[note.s];
        if (midi === null || midi === undefined) continue;
        const entry = remapNoteEntry(midi, naturalTargetByString[note.s], note, targetMidiTuning, maxFret, capo);
        if (!entry) continue;
        candidates.push({ entry, note, rank: noteHalfstepRank(midi, Math.max(note.f, capo)) });
    }
    const bySlot = new Map();
    for (const c of candidates) {
        const prev = bySlot.get(c.entry.s);
        if (!prev || c.rank < prev.rank) bySlot.set(c.entry.s, c);
    }
    return Array.from(bySlot.values()).map(c => ({ entry: c.entry, note: c.note }));
}

// A comfortable single-position hand span, in frets — the trigger
// threshold below which a cross-string jump is left alone.
// Kept as a direct-module re-export for callers that imported it from
// retune-engine.js before the stage split. The shared definition itself
// lives in common.js so note-anchors.js does not import back from stage 4.
export { HAND_JUMP_FRET_THRESHOLD } from './common.js';
// A jump farther apart than this in time gives the hand time to
// relocate normally; only a fast jump is a real ergonomics problem.
export const HAND_JUMP_TIME_WINDOW_S = 0.75;
// An alternate placement must beat the natural one by at least this many
// frets to be worth relocating to — rejects marginal, barely-better swaps.
export const HAND_JUMP_MIN_IMPROVEMENT = 2;

// Bounds how many times reduceHandTravel re-sweeps the note array. A
// note decided early in one sweep can only see a later neighbor's
// PRE-relocation position, since that neighbor's own turn hasn't come
// up yet — so an earlier note that stayed put may need another sweep to
// react once the later neighbor has actually settled. Real charts
// converge in a couple of passes; this caps the cost of the rare chart
// that doesn't settle cleanly.
const HAND_TRAVEL_MAX_PASSES = 4;

// Relocates a note (or a whole repeated-note run, together) reached via
// a fast, large cross-string jump to an exact-pitch alternate on an
// adjacent string; scores candidates by raw fret distance regardless of
// string, so only a genuinely shorter jump wins. `notes` must be
// time-sorted; mutates in place. `isEligible` restricts to standalone
// notes — group-solved notes already have a deliberate voicing.
export function reduceHandTravel(notes, target, maxFret = DEFAULT_MAX_FRET, isEligible = () => true) {
    if (!Array.isArray(notes) || notes.length < 2 || !Array.isArray(target)) return;
    const near = (t1, t2) => Math.abs(t2 - t1) <= HAND_JUMP_TIME_WINDOW_S;
    // A neighbor's NATURAL (pre-relocation) position — this pass mutates
    // left-to-right, so an earlier unrelated relocation must not cascade
    // into a false trigger for this note.
    const natS = (note) => note.natS !== undefined ? note.natS : note.s;
    const natF = (note) => note.natF !== undefined ? note.natF : note.f;
    // A jump triggers only when retuning made it worse than the source
    // chart already had (compares `origNote`). Always eligible: a side
    // newly fretted (open in the source, fretted now), or notes sharing
    // one source string (a slide). No `origNote` -> fires unconditionally.
    const becameFretted = (note) => note.origNote && isOpen(note.origNote.f) && isFretted(note.f);
    const notWorsenedBySource = (a, b, postGap) => {
        const oa = a.origNote;
        const ob = b.origNote;
        if (!oa || !ob || oa.s === ob.s || becameFretted(a) || becameFretted(b)) return false;
        return postGap <= Math.abs(oa.f - ob.f);
    };
    // A repeated note (identical source string+fret, back-to-back with
    // nothing else in between) relocates as one run rather than
    // note-by-note — otherwise only the run's member next to an awkward
    // neighbor would move, leaving its own repeats on a different fret.
    const sameOrigin = (a, b) => a.origNote && b.origNote
        && a.origNote.s === b.origNote.s && a.origNote.f === b.origNote.f;
    // A slide's start and end fret are both computed for the SAME target
    // string (remapSlide); relocating just the start note here would
    // leave its `.sl`/`.slu` endpoint stranded on the string it left.
    const isSlide = (note) => slideTarget(note) !== null;

    // Live occupancy index for collision checks. The previous implementation
    // called notes.some(...) for every alternate of every note, turning a long
    // standalone passage into O(n^2) work after the solver deadline had
    // already finished. Sets preserve the old object-identity semantics while
    // making the common lookup O(1); moves update the index in place.
    const occupancy = new Map();
    const occupants = (t, s, create = false) => {
        let byString = occupancy.get(t);
        if (!byString && create) {
            byString = new Map();
            occupancy.set(t, byString);
        }
        if (!byString) return null;
        let atString = byString.get(s);
        if (!atString && create) {
            atString = new Set();
            byString.set(s, atString);
        }
        return atString || null;
    };
    const addOccupant = note => occupants(note.t, note.s, true).add(note);
    const moveOccupant = (note, fromS, toS) => {
        const from = occupants(note.t, fromS);
        if (from) {
            from.delete(note);
            if (from.size === 0) occupancy.get(note.t).delete(fromS);
        }
        occupants(note.t, toS, true).add(note);
    };
    for (const note of notes) addOccupant(note);

    for (let pass = 0; pass < HAND_TRAVEL_MAX_PASSES; pass += 1) {
        let changed = false;
        let i = 0;
        while (i < notes.length) {
            const n = notes[i];
            // A note that already relocated (in an earlier pass) is
            // settled -- re-evaluating it here would score candidates
            // against its NEW position instead of its natural one,
            // letting it drift string to string pass after pass instead
            // of ever converging.
            if (!isFretted(n.f) || !isEligible(n) || n.natS !== undefined || isSlide(n)) { i += 1; continue; }
            let end = i + 1;
            while (end < notes.length && isEligible(notes[end]) && isFretted(notes[end].f) && !isSlide(notes[end]) && sameOrigin(notes[end], n)) end += 1;
            const runStart = notes[i];
            const runEnd = notes[end - 1];
            const prev = i > 0 ? notes[i - 1] : null;
            const next = end < notes.length ? notes[end] : null;

            // prevGap drops the same-natural-string exclusion: a
            // same-source-string pair (a slide) is documented above as
            // "always eligible", and notWorsenedBySource is what
            // actually decides whether a same-string jump counts. This
            // only applies looking BACKWARD, at the already-settled
            // predecessor — nextGap keeps the exclusion, since letting a
            // note trigger on a same-string jump to a not-yet-processed
            // successor means scoring against that successor's stale
            // pre-relocation position, which can steal a fix that
            // rightfully belongs to the successor itself (it may have a
            // strictly better alternate once IT is evaluated in turn).
            const prevGap = (prev && near(prev.t, runStart.t)) ? Math.abs(n.f - natF(prev)) : -1;
            const nextGap = (next && natS(next) !== n.s && near(runEnd.t, next.t)) ? Math.abs(n.f - natF(next)) : -1;
            const triggerGap = Math.max(
                (prevGap >= 0 && !notWorsenedBySource(prev, n, prevGap)) ? prevGap : -1,
                (nextGap >= 0 && !notWorsenedBySource(n, next, nextGap)) ? nextGap : -1,
            );
            if (triggerGap < HAND_JUMP_FRET_THRESHOLD) { i = end; continue; }

            // Live positions here, unlike the trigger check above —
            // scoring targets the real final arrangement the player will
            // see, including a later neighbor's own settled relocation
            // from an earlier pass.
            const score = (f) => Math.max(
                (prev && near(prev.t, runStart.t)) ? Math.abs(f - prev.f) : -1,
                (next && near(runEnd.t, next.t)) ? Math.abs(f - next.f) : -1,
            );
            const naturalScore = score(n.f);

            const pitch = target[n.s] + n.f;
            let best = null;
            for (const altS of [n.s - 1, n.s + 1]) {
                if (altS < 0 || altS >= target.length) continue;
                const altF = pitch - target[altS];
                if (altF < 0 || altF > maxFret) continue;
                let collides = false;
                for (let k = i; k < end && !collides; k += 1) {
                    const rn = notes[k];
                    const atTarget = occupants(rn.t, altS);
                    collides = !!atTarget && atTarget.size > (atTarget.has(rn) ? 1 : 0);
                }
                if (collides) continue;
                const altScore = score(altF);
                if (best === null || altScore < best.score) best = { s: altS, f: altF, score: altScore };
            }
            if (best && best.score <= naturalScore - HAND_JUMP_MIN_IMPROVEMENT) {
                for (let k = i; k < end; k += 1) {
                    const rn = notes[k];
                    const oldS = rn.s;
                    rn.natS = rn.s;
                    rn.natF = rn.f;
                    rn.s = best.s;
                    rn.f = best.f;
                    moveOccupant(rn, oldS, best.s);
                }
                changed = true;
            }
            i = end;
        }
        if (!changed) break;
    }
}

// Remaps a chord template's frets/fingers (indexed by original string)
// into target-string indices, reusing resolveChordCollisions.
export function remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template, targetMidiTuning, maxFret = DEFAULT_MAX_FRET, capo = 0) {
    if (!template || !Array.isArray(template.frets)) return template;
    const notes = [];
    for (let si = 0; si < template.frets.length; si += 1) {
        const f = template.frets[si];
        if (isRealFret(f)) notes.push({ s: si, f });
    }
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret, capo);
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    const frets = new Array(target.length).fill(-1);
    const hasFingers = Array.isArray(template.fingers);
    const fingers = hasFingers ? new Array(target.length).fill(-1) : template.fingers;
    for (const { entry, note } of survivors) {
        frets[entry.s] = entry.f;
        if (hasFingers) fingers[entry.s] = template.fingers[note.s] ?? -1;
    }
    return { ...template, frets, fingers };
}

// PATCH POINT (chord solver) — exact per-note candidate for a
// simultaneous-note group, as solver placements: null when any note
// drops or two collide on one target string (those go to the revoicing
// search in chord-solver.js instead). Skips null-open-midi strings using
// the same filter as chordSpecFromNotes, so the two views stay
// index-aligned.
function exactCandidateFor(ctx, notes) {
    const placements = [];
    const taken = new Set();
    for (let i = 0; i < notes.length; i += 1) {
        const n = notes[i];
        const midi = ctx.sourceOpenMidiByString[n.s];
        if (midi === null || midi === undefined) continue;
        const entry = remapNoteEntry(midi, ctx.naturalTargetByString[n.s], n, ctx.targetMidiTuning, ctx.maxFret, ctx.capo);
        if (!entry || taken.has(entry.s)) return null;
        taken.add(entry.s);
        placements.push({ srcIndex: i, s: entry.s, f: entry.f, entry });
    }
    return placements.length ? placements : null;
}

// Maximum-cardinality non-colliding slide subset. This is a small bipartite
// matching (slide groups -> target strings), with each group's candidates
// already ordered natural string then neighboring strings. Processing groups
// in reverse lets an earlier chart note keep its preferred string when an
// augmenting path can move a later note instead. No endpoint is altered.
function preferredSlideCombination(optionGroups) {
    const byString = new Map();
    const assign = (groupIndex, seenStrings) => {
        for (const option of optionGroups[groupIndex].options) {
            if (seenStrings.has(option.s)) continue;
            seenStrings.add(option.s);
            const incumbent = byString.get(option.s);
            if (!incumbent || assign(incumbent.groupIndex, seenStrings)) {
                byString.set(option.s, { groupIndex, option });
                return true;
            }
        }
        return false;
    };
    for (let i = optionGroups.length - 1; i >= 0; i -= 1) {
        assign(i, new Set());
    }
    return [...byString.values()]
        .sort((a, b) => a.groupIndex - b.groupIndex)
        .map(match => match.option);
}

// Materializes solver placements into remapped note copies: source-note
// fields + target s/f + an `origNote` back-reference (keyed by the
// note-state scorer). Exact placements carry the engine `entry` (with
// remapped slide endpoints); ordinary revoiced placements carry their
// selected target s/f. Slides never reach that second case: they are exact
// fixed placements and always carry an `entry`. The guarded fallback drops
// a slide rather than reconstructing it from a raw fret delta.
//
// `revoiced`/`degradeLevel` (both optional) tag onto each copy as
// `crRevoiced`/`crDegradeLevel`, for remapAnchors' donor preference.
function materializePlacements(notes, placements, revoiced, degradeLevel) {
    const out = [];
    for (const pl of placements) {
        const src = notes[pl.srcIndex];
        const copy = pl.entry
            ? { ...src, ...pl.entry }
            : { ...src, s: pl.s, f: pl.f };
        if (!pl.entry) {
            const slide = slideTarget(src);
            if (slide) continue;
        }
        copy.origNote = src;
        if (revoiced !== undefined) copy.crRevoiced = revoiced;
        if (degradeLevel !== undefined) copy.crDegradeLevel = degradeLevel;
        out.push(copy);
    }
    return out;
}

// Safety fallback for a group routed away from the solver (oversized,
// node budget exhausted, or solver disabled): the pre-solver per-note
// path, exact remap plus lower-pitch-wins collision resolution.
// `degraded: true` marks the voicing as a fallback, informational only.
function collisionPlacements(ctx, notes, slideGroups) {
    const fixedSlides = preferredSlideCombination(slideGroups);
    const taken = new Set(fixedSlides.map(placement => placement.s));
    const plainNotes = notes.filter(note => slideTarget(note) === null);
    const survivors = resolveChordCollisions(
        ctx.sourceOpenMidiByString,
        ctx.naturalTargetByString,
        plainNotes,
        ctx.targetMidiTuning,
        ctx.maxFret,
        ctx.capo,
    );
    const placements = fixedSlides.slice();
    for (const { entry, note } of survivors) {
        if (taken.has(entry.s)) continue;
        taken.add(entry.s);
        placements.push({ srcIndex: notes.indexOf(note), s: entry.s, f: entry.f, entry });
    }
    if (placements.length === 0) return null;
    return {
        placements,
        revoiced: false,
        degradeLevel: 0,
        degraded: true,
    };
}

// Solves one simultaneous-note group (a Chord's notes, a chord
// template's sounded frets, or a same-onset flat-note bucket): exact
// per-note remap first, then the revoicing/degradation search. Returns
// { placements, revoiced, degradeLevel } or null. `cache` lives for one
// remap run, keyed by the group's ordered (s,f,sl,slu) shape + template
// name.
//
// `jobCtl` ({ solverDisabled, maxSearchNodes, stats }): oversized groups,
// solver-disabled jobs, and an empty node-budget abort all route to
// collisionPlacements, so "gave up" still degrades the voicing rather
// than dropping a group the per-note path could have placed.
function solveGroup(cache, ctx, notes, templateName, jobCtl) {
    let key = (templateName || '') + '#';
    for (const n of notes) key += n.s + ',' + n.f + ',' + (n.sl ?? '') + ',' + (n.slu ?? '') + '|';
    if (cache.has(key)) return cache.get(key);

    // An impossible slide is omitted before building the chord spec, so the
    // generic pitch-class solver cannot recreate its starting pitch as an
    // ordinary note and accidentally carry the slide technique onto it.
    const workingNotes = [];
    const originalIndices = [];
    // Build exact slide options while filtering impossible slides. The same
    // immutable option groups are reused by the solver and every fallback;
    // candidate discovery is intentionally not repeated on the render thread.
    const slideGroups = [];
    for (let i = 0; i < notes.length; i += 1) {
        const note = notes[i];
        const slide = slideTarget(note);
        if (slide) {
            const candidates = remapSlideCandidates(
                ctx.sourceOpenMidiByString[note.s],
                ctx.naturalTargetByString[note.s],
                note.f,
                slide.to,
                ctx.targetMidiTuning,
                ctx.maxFret,
                ctx.capo,
            );
            if (!candidates || candidates.length === 0) continue;
            const srcIndex = workingNotes.length;
            slideGroups.push({
                srcIndex,
                options: candidates.map(candidate => {
                    const entry = { s: candidate.s, f: candidate.f };
                    entry[slide.field] = candidate.slideTo;
                    return { srcIndex, s: candidate.s, f: candidate.f, entry };
                }),
            });
        }
        originalIndices.push(i);
        workingNotes.push(note);
    }

    let solved = null;
    const spec = chordSpecFromNotes(ctx.sourceOpenMidiByString, workingNotes, templateName, ctx.capo);
    if (spec) {
        const oversize = workingNotes.length > MAX_SOLVER_GROUP_SIZE;
        if (oversize || (jobCtl && jobCtl.solverDisabled)) {
            if (oversize && jobCtl) jobCtl.stats.oversizeGroups += 1;
            solved = collisionPlacements(ctx, workingNotes, slideGroups);
        } else {
            const nodeCap = jobCtl && jobCtl.maxSearchNodes != null ? jobCtl.maxSearchNodes : MAX_SEARCH_NODES;
            const budget = { nodes: nodeCap, aborted: false };
            const exact = exactCandidateFor(ctx, workingNotes);
            if (slideGroups.length === 0) {
                solved = solveChord(spec, ctx.targetMidiTuning, exact, ctx.maxFret, { budget });
            } else {
                let firstCombination = null;
                let combinations = 0;
                let stop = false;
                const chosen = [];
                const taken = new Set();
                const visit = (groupIndex) => {
                    if (stop || budget.nodes <= 0
                        || combinations >= MAX_SLIDE_PLACEMENT_COMBINATIONS) return;
                    if (groupIndex === slideGroups.length) {
                        combinations += 1;
                        const fixed = chosen.slice();
                        if (!firstCombination) firstCombination = fixed;
                        const found = solveChord(
                            spec,
                            ctx.targetMidiTuning,
                            combinations === 1 ? exact : null,
                            ctx.maxFret,
                            { budget, fixedPlacements: fixed },
                        );
                        if (found && (!solved || found.degradeLevel < solved.degradeLevel
                            || (found.degradeLevel === solved.degradeLevel
                                && solved.revoiced && !found.revoiced))) {
                            solved = found;
                        }
                        // Full harmony at the closest viable slide-string
                        // combination is the best result later combinations
                        // can provide under the public ordering policy.
                        if (found && found.degradeLevel === 0) stop = true;
                        return;
                    }
                    for (const option of slideGroups[groupIndex].options) {
                        if (taken.has(option.s)) continue;
                        taken.add(option.s);
                        chosen.push(option);
                        visit(groupIndex + 1);
                        chosen.pop();
                        taken.delete(option.s);
                        if (stop) break;
                    }
                };
                visit(0);

                if (!solved) {
                    // Preserve every exact slide that can coexist, even if
                    // that means dropping all ordinary chord tones.
                    const fallback = firstCombination
                        || preferredSlideCombination(slideGroups);
                    if (fallback.length) {
                        solved = {
                            placements: fallback,
                            revoiced: true,
                            degradeLevel: 1,
                            degraded: true,
                        };
                    }
                }
            }
            if (budget.aborted) {
                if (jobCtl) jobCtl.stats.searchAborts += 1;
                if (!solved) solved = collisionPlacements(ctx, workingNotes, slideGroups);
            }
        }
    }
    if (solved) {
        solved = {
            ...solved,
            placements: solved.placements.map(placement => ({
                ...placement,
                srcIndex: originalIndices[placement.srcIndex],
            })),
        };
    }
    cache.set(key, solved);
    return solved;
}

// Remaps bundle.notes/.chords/.anchors/.chordTemplates to the active
// target tuning in place, cached per song/tuning. Returns a fresh
// { apply(bundle, targetMidiTuning, maxFret, retunerCapo, octaveOffset),
// getStats() } per call, so each splitscreen panel gets its own cache.
// `targetMidiTuning`/`maxFret` are expected to already carry stage 2's
// capo (target-capo.js's applyCapo) — this function only combines them
// with stage 3's octave-shifted source. `maxFret` defaults to
// DEFAULT_MAX_FRET when omitted; `retunerCapo` (default 0) is used only
// by the final output projection; `octaveOffset` (default 0) is stage 3's
// chart-side octave shift. The cached solve always stays capo-relative.
//
// opts (optional): maxTotalSolveMs (MAX_TOTAL_SOLVE_MS), maxSearchNodes
// (MAX_SEARCH_NODES), capoOutputMode (CAPO_OUTPUT_MODE).
//
// getStats(): { workMs, searchAborts, oversizeGroups, solverDisabled }
// for the most recent cold remap.
export function createRetuner(opts) {
    const maxTotalSolveMs = opts && opts.maxTotalSolveMs !== undefined ? opts.maxTotalSolveMs : MAX_TOTAL_SOLVE_MS;
    const maxSearchNodes = opts && opts.maxSearchNodes !== undefined ? opts.maxSearchNodes : MAX_SEARCH_NODES;
    const capoOutputMode = resolveCapoOutputMode(opts && opts.capoOutputMode !== undefined
        ? opts.capoOutputMode
        : CAPO_OUTPUT_MODE);

    let cacheNotesRef = null;
    let cacheChordsRef = null;
    let cacheAnchorsRef = null;
    let cacheTemplatesRef = null;
    let cacheTuningRef = null;
    let cacheCapo = null;
    let cacheStringCount = null;
    let cacheTargetSig = null;
    let cacheSourceSig = null;
    let canonicalResult = { notes: [], chords: [], anchors: [], chordTemplates: [] };
    let canonicalWasRemapped = false;
    let projectionKey = null;
    let projectedResult = canonicalResult;
    const stats = { workMs: 0, searchAborts: 0, oversizeGroups: 0, solverDisabled: false };
    const maxSupportedFret = Math.max(...MAX_FRET_OPTIONS);
    const isDenseIntegerArray = (values, expectedLength) => {
        if (!Array.isArray(values) || values.length !== expectedLength) return false;
        for (let i = 0; i < values.length; i += 1) {
            if (!Number.isInteger(values[i])) return false;
        }
        return true;
    };
    // Source arrays are mutable host-owned JSON data. Reference equality alone
    // cannot distinguish a genuine cache hit from an in-place difficulty,
    // note, template, anchor, or tuning edit. A full JSON signature is linear
    // in chart size and _transform() runs only at rebuild/settings boundaries,
    // never per animation frame. If unusual cyclic/non-JSON data cannot be
    // serialized, returning null safely disables cache hits for that input.
    const sourceContentSignature = (tuning, notes, chords, anchors, templates) => {
        try {
            return JSON.stringify([tuning, notes, chords, anchors, templates]);
        } catch (_) {
            return null;
        }
    };

    // The whole cold remap, synchronous. checkDeadline runs between work
    // units (one template / one same-onset note bucket / one chord) and
    // flips the remaining groups onto the per-note path once the
    // deadline passes — see MAX_TOTAL_SOLVE_MS above.
    function remap(rawNotes, rawChords, rawAnchors, rawTemplates, tuning, capo, sc, target, maxFret, octaveOffset) {
        const t0 = now();
        const ctl = { solverDisabled: false, maxSearchNodes, stats };
        const checkDeadline = () => {
            if (!ctl.solverDisabled && now() - t0 > maxTotalSolveMs) {
                ctl.solverDisabled = true;
                stats.solverDisabled = true;
            }
        };
        // Capo-inclusive: arrangement alignment follows the chart's sounding
        // open pitches. A uniform capo or octave shift can deliberately move
        // the best alignment to neighboring target strings (for example, an
        // E-standard chart at capo 5 aligns naturally with A/D/G/... strings).
        // octaveOffset (stage 3) is folded in here too; unlike the chart capo,
        // it shifts every source note unconditionally.
        const sourceOpenMidiByString = computeOpenStringMidiByString(sc, tuning, capo, octaveOffset);
        const shiftK = computeArrangementShift(sc, tuning, capo, sourceOpenMidiByString, target);
        const naturalTargetByString = [];
        for (let s = 0; s < sc; s += 1) {
            naturalTargetByString.push(s + shiftK);
        }
        // Capo-EXCLUDED: per-note pitch math must not double-count chart
        // capo on an already-fretted note. `capo` on ctx supplies the
        // correction (Math.max(f, capo)) at each point a note's own fret
        // is actually read.
        const pitchOpenMidiByString = computeOpenStringMidiByString(sc, tuning, 0, octaveOffset);
        // Bundles the per-song remap coordinates threaded through every
        // internal solver-path call below, so those signatures don't each
        // carry the same four values separately.
        const ctx = { sourceOpenMidiByString: pitchOpenMidiByString, naturalTargetByString, targetMidiTuning: target, maxFret, capo };

        // PATCH POINT (chord solver): one solve cache per remap
        // run; identical chord shapes (by ordered s/f/slide
        // signature + template name) solve once per song/tuning.
        const groupCache = new Map();

        // Templates FIRST, so chord instances and the hand-shape chords
        // screen.js builds from bundle.chordTemplates follow the SAME
        // solved voicing (chordTemplates is indexed by chord id).
        const templateSolutions = new Map(); // template index -> Map<sourceString, {s,f}>
        const templateRevoiced = new Map(); // template index -> bool, for chord instances taking the shortcut below
        const templateDegradeLevel = new Map(); // template index -> number, ditto
        const remapOneTemplate = (template, ti) => {
            if (!template || !Array.isArray(template.frets)) return template;
            const tNotes = [];
            for (let si = 0; si < template.frets.length; si += 1) {
                if (isRealFret(template.frets[si])) tNotes.push({ s: si, f: template.frets[si] });
            }
            // Single-note / empty templates keep the per-note
            // path (identical to the pre-solver behavior).
            if (tNotes.length < 2) {
                return remapChordTemplate(pitchOpenMidiByString, naturalTargetByString, template, target, maxFret, capo);
            }
            const solved = solveGroup(groupCache, ctx, tNotes, template.displayName || template.name, ctl);
            const frets = new Array(target.length).fill(-1);
            if (!solved) {
                // Nothing soundable (all strings null-midi) — same net
                // effect as the per-note path dropping every note.
                return {
                    ...template,
                    frets,
                    fingers: Array.isArray(template.fingers) ? frets.slice() : template.fingers,
                };
            }
            const byString = new Map();
            for (const pl of solved.placements) {
                byString.set(tNotes[pl.srcIndex].s, { s: pl.s, f: pl.f });
                frets[pl.s] = pl.f;
            }
            templateSolutions.set(ti, byString);
            templateRevoiced.set(ti, solved.revoiced);
            templateDegradeLevel.set(ti, solved.degradeLevel);
            // Fingers: an omitted (non-array) finger chart stays omitted.
            // Otherwise an exact placement carries the chart's own
            // per-string fingering, unless the remap crossed the
            // open/fretted boundary or the shape was revoiced — both
            // derive plausible fingers instead.
            let fingers;
            if (!Array.isArray(template.fingers)) {
                fingers = template.fingers;
            } else {
                let carried = null;
                if (!solved.revoiced) {
                    carried = new Array(target.length).fill(-1);
                    for (const pl of solved.placements) {
                        const c = template.fingers[tNotes[pl.srcIndex].s] ?? -1;
                        if (isRealFret(c) && isOpen(c) !== isOpen(pl.f)) { carried = null; break; }
                        carried[pl.s] = c;
                    }
                }
                fingers = carried || computeChordFingers(frets);
            }
            return { ...template, frets, fingers };
        };
        let newTemplates;
        if (Array.isArray(rawTemplates)) {
            newTemplates = [];
            for (let ti = 0; ti < rawTemplates.length; ti += 1) {
                checkDeadline();
                newTemplates.push(remapOneTemplate(rawTemplates[ti], ti));
            }
        } else {
            newTemplates = rawTemplates || [];
        }

        // Group by onset time first (a bass double-stop is often two
        // flat Notes sharing a time, not a Chord object), so simultaneous
        // notes on different strings still resolve as one chord.
        // PATCH POINT (chord solver): groups of >= 2 route through the
        // solver, which only revoices a group the per-note path would
        // break (drops, collisions, unplayable stretches).
        const newNotes = [];
        // Notes with no simultaneous partner at all — reduceHandTravel may
        // only ever relocate these; a note the solver placed as part of a
        // group already has a deliberate voicing this pass must not touch.
        const standalone = new WeakSet();
        if (Array.isArray(rawNotes)) {
            const byTime = new Map();
            for (const n of rawNotes) {
                let bucket = byTime.get(n.t);
                if (!bucket) byTime.set(n.t, bucket = []);
                bucket.push(n);
            }
            for (const bucket of byTime.values()) {
                checkDeadline();
                if (bucket.length >= 2) {
                    const solved = solveGroup(groupCache, ctx, bucket, null, ctl);
                    if (solved) newNotes.push(...materializePlacements(bucket, solved.placements, solved.revoiced, solved.degradeLevel));
                } else {
                    const survivors = resolveChordCollisions(pitchOpenMidiByString, naturalTargetByString, bucket, target, maxFret, capo);
                    // false: exact per-note remap — always a preferred anchor donor.
                    const placements = survivors.map(({ entry, note }) => ({ srcIndex: bucket.indexOf(note), s: entry.s, f: entry.f, entry }));
                    for (const copy of materializePlacements(bucket, placements, false, 0)) {
                        standalone.add(copy);
                        newNotes.push(copy);
                    }
                }
            }
            newNotes.sort((a, b) => a.t - b.t);
            reduceHandTravel(newNotes, target, maxFret, n => standalone.has(n));
        }
        // Solves one chord instance: template-shortcut when its notes
        // exactly match an already-solved template, ad-hoc group-solve or
        // per-note collision resolution otherwise. Returns the remapped
        // chord (materialized notes, own `.t` stamped on each), or null
        // when nothing survives (dropped).
        const remapOneChord = (ch) => {
            const chNotes = ch.notes || [];
            let placements = null;
            let revoiced = false;
            let degradeLevel = 0;
            // Template-first: an instance whose notes match its
            // template's frets (even a difficulty-filtered subset)
            // takes the template's solved voicing, so every
            // difficulty level agrees with the chord diagram.
            // Instances referencing a dropped/diverging string solve
            // ad-hoc below. Null/absent id means "no template",
            // guarded before Number() coercion (which would alias
            // null to template index 0).
            const cid = ch.id == null ? null
                : (typeof ch.id === 'number' ? ch.id : Number(ch.id));
            const byString = cid !== null ? templateSolutions.get(cid) : undefined;
            const tmpl = cid !== null && Array.isArray(rawTemplates) ? (rawTemplates[cid] || null) : null;
            // Sliding chords skip the template shortcut: a template
            // solution is solved from PLAIN frets, which only anchors
            // a static position. The ad-hoc path below goes through
            // remapNoteEntry/remapSlide instead, keeping slides exact.
            const hasSlide = chNotes.some(n => slideTarget(n) !== null);
            if (!hasSlide && byString && tmpl && chNotes.length > 0
                && chNotes.every(n => tmpl.frets[n.s] === n.f && byString.has(n.s))) {
                // One note per source string: a malformed chart
                // can double up a string within one chord — the
                // first note wins, matching the one-note-per-
                // target-slot invariant every other path keeps.
                const seen = new Set();
                placements = [];
                for (let i = 0; i < chNotes.length; i += 1) {
                    const n = chNotes[i];
                    if (seen.has(n.s)) continue;
                    seen.add(n.s);
                    const t = byString.get(n.s);
                    placements.push({ srcIndex: i, s: t.s, f: t.f });
                }
                // Inherit the template's own revoiced status.
                revoiced = templateRevoiced.get(cid) || false;
                degradeLevel = templateDegradeLevel.get(cid) || 0;
            } else if (chNotes.length >= 2) {
                const solved = solveGroup(groupCache, ctx, chNotes,
                    tmpl ? (tmpl.displayName || tmpl.name) : null, ctl);
                placements = solved ? solved.placements : null;
                revoiced = solved ? solved.revoiced : false;
                degradeLevel = solved ? solved.degradeLevel : 0;
            } else {
                const survivors = resolveChordCollisions(pitchOpenMidiByString, naturalTargetByString, chNotes, target, maxFret, capo);
                placements = survivors.map(({ entry, note }) => ({ srcIndex: chNotes.indexOf(note), s: entry.s, f: entry.f, entry }));
            }
            if (!placements || placements.length === 0) return null;
            const materialized = materializePlacements(chNotes, placements, revoiced, degradeLevel);
            // Raw chord notes have no `.t` of their own; remapAnchors needs one.
            for (const n of materialized) { if (n.t !== ch.t) n.t = ch.t; }
            return { ...ch, notes: materialized };
        };
        const newChords = [];
        if (Array.isArray(rawChords)) {
            for (const ch of rawChords) {
                checkDeadline();
                const remapped = remapOneChord(ch);
                if (remapped) newChords.push(remapped);
            }
        }
        // Anchor donors: standalone AND chord notes, time-sorted, so a
        // chord-only passage still has something for remapAnchors to track.
        const anchorDonors = newChords.length
            ? newNotes.concat(newChords.flatMap(c => c.notes)).sort((a, b) => a.t - b.t)
            : newNotes;
        canonicalResult = {
            notes: newNotes,
            chords: newChords,
            anchors: remapAnchors(rawAnchors, anchorDonors, maxFret, capo),
            chordTemplates: newTemplates,
        };
        canonicalWasRemapped = true;
        stats.workMs = now() - t0;
    }

    function apply(bundle, targetMidiTuning, maxFret = DEFAULT_MAX_FRET, retunerCapo = 0, octaveOffset = 0) {
        const target = (Array.isArray(targetMidiTuning) && targetMidiTuning.length >= 1)
            ? targetMidiTuning : DEFAULT_TARGET_MIDI_TUNING;
        const suppliedNotes = bundle.notes;
        const suppliedChords = bundle.chords;
        const suppliedAnchors = bundle.anchors;
        const suppliedTemplates = bundle.chordTemplates;
        // apply() writes its result back onto the caller's bundle. If that
        // same bundle is applied again, unwrap fields that are still our own
        // latest output to the original source references. This keeps apply
        // idempotent and lets a target/projection change re-solve from raw
        // chart data instead of recursively retuning the prior result.
        const hasPriorProjection = projectionKey !== null;
        const rawNotes = hasPriorProjection && suppliedNotes === projectedResult.notes
            ? cacheNotesRef : suppliedNotes;
        const rawChords = hasPriorProjection && suppliedChords === projectedResult.chords
            ? cacheChordsRef : suppliedChords;
        const rawAnchors = hasPriorProjection && suppliedAnchors === projectedResult.anchors
            ? cacheAnchorsRef : suppliedAnchors;
        const rawTemplates = hasPriorProjection && suppliedTemplates === projectedResult.chordTemplates
            ? cacheTemplatesRef : suppliedTemplates;
        const tuning = bundle.tuning;
        const rawCapo = bundle.capo;
        const capo = Number.isInteger(rawCapo) ? rawCapo : 0;
        const sc = bundle.stringCount;
        // Sanitized independently from the solve signature: changing only
        // the output representation must re-project, never re-solve chords.
        const outputCapo = (Number.isInteger(retunerCapo) && retunerCapo > 0)
            ? retunerCapo : 0;
        const oct = Number.isInteger(octaveOffset) ? octaveOffset : 0;
        const sourceMetadataValid = Number.isInteger(sc)
            && sc >= 1
            && sc <= MAX_SOURCE_STRING_COUNT
            && isDenseIntegerArray(tuning, sc)
            && Number.isInteger(rawCapo)
            && rawCapo >= 0;
        const targetMetadataValid = Array.isArray(target)
            && target.length >= 1
            && target.length <= MAX_TARGET_STRING_COUNT
            && isDenseIntegerArray(target, target.length)
            && Number.isInteger(maxFret)
            && maxFret >= 1
            && maxFret <= maxSupportedFret;
        const inputsValid = sourceMetadataValid && targetMetadataValid;
        // '@' + maxFret: two profiles sharing the same strings but a
        // different max fret must NOT cache-hit each other's remap.
        // '#' + oct: stage 3's octave offset is no longer baked into
        // `target` by the caller, so it must be its own cache-key term.
        const targetSig = inputsValid
            ? target.join(',') + '@' + maxFret + '#' + oct
            : 'invalid';
        const sourceSig = inputsValid
            ? sourceContentSignature(tuning, rawNotes, rawChords, rawAnchors, rawTemplates)
            : 'invalid';
        const cacheHit = sourceSig !== null
            && rawNotes === cacheNotesRef && rawChords === cacheChordsRef
            && rawAnchors === cacheAnchorsRef && rawTemplates === cacheTemplatesRef
            && tuning === cacheTuningRef && capo === cacheCapo && sc === cacheStringCount
            && targetSig === cacheTargetSig && sourceSig === cacheSourceSig;

        if (!cacheHit) {
            cacheNotesRef = rawNotes;
            cacheChordsRef = rawChords;
            cacheAnchorsRef = rawAnchors;
            cacheTemplatesRef = rawTemplates;
            cacheTuningRef = tuning;
            cacheCapo = capo;
            cacheStringCount = sc;
            cacheTargetSig = targetSig;
            cacheSourceSig = sourceSig;
            projectionKey = null;
            stats.workMs = 0;
            stats.searchAborts = 0;
            stats.oversizeGroups = 0;
            stats.solverDisabled = false;

            if (!inputsValid) {
                // Fail-safe: pass the chart through unremapped.
                canonicalResult = {
                    notes: Array.isArray(rawNotes) ? rawNotes : [],
                    chords: Array.isArray(rawChords) ? rawChords : [],
                    anchors: Array.isArray(rawAnchors) ? rawAnchors : [],
                    chordTemplates: Array.isArray(rawTemplates) ? rawTemplates : [],
                };
                canonicalWasRemapped = false;
            } else {
                remap(rawNotes, rawChords, rawAnchors, rawTemplates, tuning, capo, sc, target, maxFret, oct);
            }
        }

        // Invalid source metadata takes the fail-safe path above and must stay
        // byte-for-byte pass-through rather than receiving a target projection.
        const projectionCapo = canonicalWasRemapped ? outputCapo : 0;
        const nextProjectionKey = capoOutputMode + '@' + projectionCapo;
        if (projectionKey !== nextProjectionKey) {
            projectedResult = projectCapoOutput(canonicalResult, projectionCapo, capoOutputMode);
            projectionKey = nextProjectionKey;
        }

        bundle.notes = projectedResult.notes;
        bundle.chords = projectedResult.chords;
        bundle.anchors = projectedResult.anchors;
        bundle.chordTemplates = projectedResult.chordTemplates;
    }

    function getStats() {
        return {
            workMs: stats.workMs,
            searchAborts: stats.searchAborts,
            oversizeGroups: stats.oversizeGroups,
            solverDisabled: stats.solverDisabled,
        };
    }

    return { apply, getStats, capoOutputMode };
}
