// Chart Retuner — chart remap math: source notes/chords/
// chord-templates -> positions on the active target tuning. Hand-position
// anchor remapping lives in note-anchors.js, which consumes this module's
// remapped notes as plain input. One of the pure-logic modules
// chart-retune.js aggregates into `CR`.
//
// One fret = one half-step. Every function looks up each target string's
// own open pitch from `target[j]`, so irregular (non-fourths) target
// tunings work with no special-casing. Simultaneous-note groups (chords,
// same-onset flat-note buckets, chord templates) route through the
// chord-aware solver (src/chord-solver.js) — see the PATCH POINT (chord
// solver) blocks in createRetuner below.

import { DEFAULT_MAX_FRET, DEFAULT_TARGET_MIDI_TUNING, computeOpenStringMidiByString, computeArrangementShift } from './target-tuning.js';
import { chordSpecFromNotes, solveChord, computeChordFingers, MAX_SEARCH_NODES, isFretted, isOpen, isRealFret } from './chord-solver.js';
import { remapAnchors } from './note-anchors.js';

const clampFret = (f, maxFret) => Math.max(0, Math.min(maxFret, f));

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

// Slide (slide_to/slide_unpitch_to): both endpoints must land on the
// same target string. Anchors on whichever fret is lower, retries on
// the higher one if that fails, and clamps to maxFret on overflow
// instead of dropping.
export function remapSlide(sourceOpenMidi, naturalTargetString, fret, slideToFret, targetMidiTuning, maxFret = DEFAULT_MAX_FRET, capo = 0) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    // Chart capo only raises a fret sitting at/below the capo (i.e. an
    // open string); a slide endpoint already above it is an absolute
    // position and must not also pick up the capo.
    const effFret = Math.max(fret, capo);
    const effSlideTo = Math.max(slideToFret, capo);
    const lowFret = Math.min(effFret, effSlideTo);
    const highFret = Math.max(effFret, effSlideTo);
    let anchor = resolveTargetForFret(sourceOpenMidi, naturalTargetString, lowFret, targetMidiTuning, maxFret);
    if (!anchor) anchor = resolveTargetForFret(sourceOpenMidi, naturalTargetString, highFret, targetMidiTuning, maxFret);
    if (!anchor) return null;
    return {
        s: anchor.s,
        f: clampFret(effFret + anchor.adjustment, maxFret),
        slideTo: clampFret(effSlideTo + anchor.adjustment, maxFret),
    };
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
// target string. Returns { entry, note } per survivor.
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
export const HAND_JUMP_FRET_THRESHOLD = 5;
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
                    collides = notes.some(o => o !== rn && o.t === rn.t && o.s === altS);
                }
                if (collides) continue;
                const altScore = score(altF);
                if (best === null || altScore < best.score) best = { s: altS, f: altF, score: altScore };
            }
            if (best && best.score <= naturalScore - HAND_JUMP_MIN_IMPROVEMENT) {
                for (let k = i; k < end; k += 1) {
                    const rn = notes[k];
                    rn.natS = rn.s;
                    rn.natF = rn.f;
                    rn.s = best.s;
                    rn.f = best.f;
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

// Materializes solver placements into remapped note copies: source-note
// fields + target s/f + an `origNote` back-reference (keyed by the
// note-state scorer). Exact placements carry the engine `entry` (with
// remapped slide endpoints); revoiced placements re-apply the source
// note's slide delta to the solved fret instead.
//
// `revoiced`/`degradeLevel` (both optional) tag onto each copy as
// `crRevoiced`/`crDegradeLevel`, for remapAnchors' donor preference.
function materializePlacements(notes, placements, maxFret, revoiced, degradeLevel) {
    const out = [];
    for (const pl of placements) {
        const src = notes[pl.srcIndex];
        const copy = pl.entry
            ? { ...src, ...pl.entry }
            : { ...src, s: pl.s, f: pl.f };
        if (!pl.entry) {
            const slide = slideTarget(src);
            if (slide) copy[slide.field] = clampFret(pl.f + (slide.to - src.f), maxFret);
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
function collisionPlacements(ctx, notes) {
    const survivors = resolveChordCollisions(ctx.sourceOpenMidiByString, ctx.naturalTargetByString, notes, ctx.targetMidiTuning, ctx.maxFret, ctx.capo);
    if (survivors.length === 0) return null;
    return {
        placements: survivors.map(({ entry, note }) => ({ srcIndex: notes.indexOf(note), s: entry.s, f: entry.f, entry })),
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
    let solved = null;
    const spec = chordSpecFromNotes(ctx.sourceOpenMidiByString, notes, templateName, ctx.capo);
    if (spec) {
        const oversize = notes.length > MAX_SOLVER_GROUP_SIZE;
        if (oversize || (jobCtl && jobCtl.solverDisabled)) {
            if (oversize && jobCtl) jobCtl.stats.oversizeGroups += 1;
            solved = collisionPlacements(ctx, notes);
        } else {
            const nodeCap = jobCtl && jobCtl.maxSearchNodes != null ? jobCtl.maxSearchNodes : MAX_SEARCH_NODES;
            const budget = { nodes: nodeCap, aborted: false };
            const exact = exactCandidateFor(ctx, notes);
            solved = solveChord(spec, ctx.targetMidiTuning, exact, ctx.maxFret, { budget });
            if (budget.aborted) {
                if (jobCtl) jobCtl.stats.searchAborts += 1;
                if (!solved) solved = collisionPlacements(ctx, notes);
            }
        }
    }
    cache.set(key, solved);
    return solved;
}

// Remaps bundle.notes/.chords/.anchors/.chordTemplates to the active
// target tuning in place, cached per song/tuning. Returns a fresh
// { apply(bundle, targetMidiTuning, maxFret, displayFretOffset),
// getStats() } per call, so each splitscreen panel gets its own cache.
// `maxFret` defaults to DEFAULT_MAX_FRET when omitted; `displayFretOffset`
// (default 0) is the target capo for physical-fret display.
//
// opts (optional): maxTotalSolveMs (MAX_TOTAL_SOLVE_MS), maxSearchNodes
// (MAX_SEARCH_NODES).
//
// getStats(): { workMs, searchAborts, oversizeGroups, solverDisabled }
// for the most recent cold remap.
export function createRetuner(opts) {
    const maxTotalSolveMs = opts && opts.maxTotalSolveMs !== undefined ? opts.maxTotalSolveMs : MAX_TOTAL_SOLVE_MS;
    const maxSearchNodes = opts && opts.maxSearchNodes !== undefined ? opts.maxSearchNodes : MAX_SEARCH_NODES;

    let cacheNotesRef = null;
    let cacheChordsRef = null;
    let cacheAnchorsRef = null;
    let cacheTemplatesRef = null;
    let cacheTuningRef = null;
    let cacheCapo = null;
    let cacheStringCount = null;
    let cacheTargetSig = null;
    let remappedNotes = [];
    let remappedChords = [];
    let remappedAnchors = [];
    let remappedTemplates = [];
    const stats = { workMs: 0, searchAborts: 0, oversizeGroups: 0, solverDisabled: false };

    // The whole cold remap, synchronous. checkDeadline runs between work
    // units (one template / one same-onset note bucket / one chord) and
    // flips the remaining groups onto the per-note path once the
    // deadline passes — see MAX_TOTAL_SOLVE_MS above.
    function remap(rawNotes, rawChords, rawAnchors, rawTemplates, tuning, capo, sc, target, maxFret, displayFretOffset) {
        const t0 = now();
        const ctl = { solverDisabled: false, maxSearchNodes, stats };
        const checkDeadline = () => {
            if (!ctl.solverDisabled && now() - t0 > maxTotalSolveMs) {
                ctl.solverDisabled = true;
                stats.solverDisabled = true;
            }
        };
        // Capo-inclusive: string-alignment only cares which strings are
        // tuned alike, and capo shifts every string's open pitch equally
        // so it doesn't change which shift best aligns source to target.
        const sourceOpenMidiByString = computeOpenStringMidiByString(sc, tuning, capo);
        const shiftK = computeArrangementShift(sc, tuning, capo, sourceOpenMidiByString, target);
        const naturalTargetByString = [];
        for (let s = 0; s < sc; s += 1) {
            naturalTargetByString.push(s + shiftK);
        }
        // Capo-EXCLUDED: per-note pitch math must not double-count chart
        // capo on an already-fretted note. `capo` on ctx supplies the
        // correction (Math.max(f, capo)) at each point a note's own fret
        // is actually read.
        const pitchOpenMidiByString = computeOpenStringMidiByString(sc, tuning, 0);
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
                    if (solved) newNotes.push(...materializePlacements(bucket, solved.placements, maxFret, solved.revoiced, solved.degradeLevel));
                } else {
                    const survivors = resolveChordCollisions(pitchOpenMidiByString, naturalTargetByString, bucket, target, maxFret, capo);
                    // false: exact per-note remap — always a preferred anchor donor.
                    const placements = survivors.map(({ entry, note }) => ({ srcIndex: bucket.indexOf(note), s: entry.s, f: entry.f, entry }));
                    for (const copy of materializePlacements(bucket, placements, maxFret, false, 0)) {
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
            const materialized = materializePlacements(chNotes, placements, maxFret, revoiced, degradeLevel);
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
        remappedNotes = newNotes;
        remappedChords = newChords;
        // Anchor donors: standalone AND chord notes, time-sorted, so a
        // chord-only passage still has something for remapAnchors to track.
        const anchorDonors = newChords.length
            ? newNotes.concat(newChords.flatMap(c => c.notes)).sort((a, b) => a.t - b.t)
            : newNotes;
        remappedAnchors = remapAnchors(rawAnchors, anchorDonors, maxFret, capo);
        remappedTemplates = newTemplates;

        // Physical-fret display shift: every fretted note becomes r + capo,
        // except a note exactly at relative fret 0 (the plugin capo's own
        // position), which stays open — chosen for chord legibility over
        // scoring purity.
        // isRealFret guards sl/slu/template sentinels from the same shift.
        if (displayFretOffset > 0) {
            const off = displayFretOffset;
            const shiftNote = (n) => {
                if (isFretted(n.f)) n.f += off;
                if (isRealFret(n.sl)) n.sl += off;
                if (isRealFret(n.slu)) n.slu += off;
            };
            for (const n of remappedNotes) shiftNote(n);
            for (const ch of remappedChords) {
                for (const n of ch.notes) shiftNote(n);
            }
            remappedAnchors = remappedAnchors.map(
                a => ({ time: a.time, fret: a.fret + off, width: a.width }));
            // Template frets follow the same relative-fret-0-stays-open
            // rule as notes, so a renderer merging the two sees them agree.
            remappedTemplates = Array.isArray(remappedTemplates)
                ? remappedTemplates.map(t => (t && Array.isArray(t.frets))
                    ? { ...t, frets: t.frets.map(f => (isFretted(f) ? f + off : f)) }
                    : t)
                : remappedTemplates;
        }
        stats.workMs = now() - t0;
    }

    function apply(bundle, targetMidiTuning, maxFret = DEFAULT_MAX_FRET, displayFretOffset = 0) {
        const target = (Array.isArray(targetMidiTuning) && targetMidiTuning.length >= 1)
            ? targetMidiTuning : DEFAULT_TARGET_MIDI_TUNING;
        const rawNotes = bundle.notes;
        const rawChords = bundle.chords;
        const rawAnchors = bundle.anchors;
        const rawTemplates = bundle.chordTemplates;
        const tuning = bundle.tuning;
        const capo = bundle.capo | 0;
        const sc = bundle.stringCount;
        // Sanitized so a bogus caller value can't shift by a fraction or
        // skew the cache signature.
        const off = (Number.isInteger(displayFretOffset) && displayFretOffset > 0)
            ? displayFretOffset : 0;
        // '@' + maxFret: two profiles sharing the same strings but a
        // different max fret must NOT cache-hit each other's remap.
        // '+' + off: same rule for the display shift — a capo-only change
        // must re-derive from raw (frets move by the capo delta).
        const targetSig = target.join(',') + '@' + maxFret + '+' + off;
        const cacheHit = rawNotes === cacheNotesRef && rawChords === cacheChordsRef
            && rawAnchors === cacheAnchorsRef && rawTemplates === cacheTemplatesRef
            && tuning === cacheTuningRef && capo === cacheCapo && sc === cacheStringCount
            && targetSig === cacheTargetSig;

        if (!cacheHit) {
            cacheNotesRef = rawNotes;
            cacheChordsRef = rawChords;
            cacheAnchorsRef = rawAnchors;
            cacheTemplatesRef = rawTemplates;
            cacheTuningRef = tuning;
            cacheCapo = capo;
            cacheStringCount = sc;
            cacheTargetSig = targetSig;
            stats.workMs = 0;
            stats.searchAborts = 0;
            stats.oversizeGroups = 0;
            stats.solverDisabled = false;

            if (!Number.isFinite(sc) || sc < 1 || !Array.isArray(tuning)) {
                // Fail-safe: pass the chart through unremapped.
                remappedNotes = Array.isArray(rawNotes) ? rawNotes : [];
                remappedChords = Array.isArray(rawChords) ? rawChords : [];
                remappedAnchors = Array.isArray(rawAnchors) ? rawAnchors : [];
                remappedTemplates = Array.isArray(rawTemplates) ? rawTemplates : [];
            } else {
                remap(rawNotes, rawChords, rawAnchors, rawTemplates, tuning, capo, sc, target, maxFret, off);
            }
        }

        bundle.notes = remappedNotes;
        bundle.chords = remappedChords;
        bundle.anchors = remappedAnchors;
        bundle.chordTemplates = remappedTemplates;
    }

    function getStats() {
        return {
            workMs: stats.workMs,
            searchAborts: stats.searchAborts,
            oversizeGroups: stats.oversizeGroups,
            solverDisabled: stats.solverDisabled,
        };
    }

    return { apply, getStats };
}
