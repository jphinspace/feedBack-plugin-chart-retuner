// Chart Retuner — chart remap math: source notes/chords/anchors/
// chord-templates -> positions on the active target tuning.
// One of the pure-logic modules chart-retune.js aggregates into `CR`.
//
// One fret = one half-step. Every function looks up each target string's
// own open pitch from `target[j]`, so irregular (non-fourths) target
// tunings work with no special-casing. Simultaneous-note groups (chords,
// same-onset flat-note buckets, chord templates) route through the
// chord-aware solver (src/chord-solver.js) — see the PATCH POINT (chord
// solver) blocks in createRetuner below.

import { DEFAULT_MAX_FRET, DEFAULT_TARGET_MIDI_TUNING, computeOpenStringMidiByString, computeArrangementShift } from './target-tuning.js';
import { chordSpecFromNotes, solveChord, computeChordFingers, MAX_SEARCH_NODES } from './chord-solver.js';

const _clampFret = (f, maxFret) => Math.max(0, Math.min(maxFret, f));

// ---- Pathological-chart safety valves (createRetuner) ----------------
// A remap must never be able to stall the render thread, no matter what
// a chart file contains. Three independent bounds — chord-solver.js's
// MAX_SEARCH_NODES plus the two below — all overridable per retuner via
// createRetuner(opts):
//
// MAX_SOLVER_GROUP_SIZE — a simultaneous-note group larger than this
// (no real instrument: buckets this size are data corruption, e.g. a
// broken GP export stacking a whole bar on one timestamp) skips the
// solver entirely and takes the bounded per-note path.
export const MAX_SOLVER_GROUP_SIZE = 12;
// MAX_TOTAL_SOLVE_MS — deadline for one whole cold remap, checked between
// work units. Past it, REMAINING groups take the per-note path, so the
// worst-case apply() stall is ~this deadline plus one node-capped group.
// Only a pathological chart hits it, and lands where it doesn't hurt
// (song load's first frame isn't drawn yet; a mid-song switch drops a
// couple frames). A prior generator-job time-slicing approach was
// simplified away — the solver's own node budget already bounds any
// single group, so a plain deadline gives the same guarantee for free.
export const MAX_TOTAL_SOLVE_MS = 40;

const _now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? () => performance.now()
    : () => Date.now();

// Pitch-order tables per target-tuning array, cached by array identity
// (target arrays are treated as immutable — resolveTargetTuning always
// allocates fresh). `null` for an ascending array — the overwhelmingly
// common case, where the walk in resolveTargetForFret can move by index
// directly — else { byPitch, rankOf } for a pitch-ordered walk. Needed
// since banjo5_gdgbd (high G4 drone at index 0) made non-monotonic
// targets a real, shipping configuration: an index walk on such a target
// marches AWAY from the string that could actually play the note.
const _pitchOrderCache = new WeakMap();
function _pitchOrderFor(target) {
    let cached = _pitchOrderCache.get(target);
    if (cached === undefined) {
        cached = null;
        for (let i = 1; i < target.length; i++) {
            if (target[i] < target[i - 1]) {
                const byPitch = target.map((_, idx) => idx).sort((a, b) => target[a] - target[b] || a - b);
                const rankOf = new Array(target.length);
                byPitch.forEach((idx, rank) => { rankOf[idx] = rank; });
                cached = { byPitch, rankOf };
                break;
            }
        }
        _pitchOrderCache.set(target, cached);
    }
    return cached;
}

// Resolves one (sourceOpenMidi, fret) against the target: starts from the
// natural target string and steps in whichever direction the out-of-
// range fret demands, in PITCH order (index order for ascending tunings,
// rank order otherwise). Returns { s, f, adjustment } or null if
// unplayable everywhere — complete, since underflow at one pitch implies
// underflow at every higher one (and vice versa), so a one-direction
// sweep covers every candidate.
//
// Anchors on the natural string first rather than a global smallest-
// adjustment search — a global search misfires on a large single-string
// drop (e.g. Drop C#), flipping to a different string too early.
export function resolveTargetForFret(sourceOpenMidi, naturalTargetString, fret, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    const ord = _pitchOrderFor(target);
    // Walk position: an index directly for an ascending target, a pitch
    // RANK otherwise.
    let r = Math.max(0, Math.min(target.length - 1, naturalTargetString));
    if (ord) r = ord.rankOf[r];
    // The direction lock doubles as the termination guarantee: needing to
    // reverse proves the note fits nowhere (everything one way underflows,
    // everything the other way overflows). Without it, two pitch-adjacent
    // strings more than maxFret semitones apart made the old walk
    // oscillate between them forever — a hard render-thread hang.
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

// Slide (slide_to/slide_unpitch_to): both endpoints must land on the same
// target string, so anchor on whichever fret is lower, retry on the
// higher one if that fails. Clamps to maxFret on overflow instead of
// dropping (unlike an ordinary note).
export function remapSlide(sourceOpenMidi, naturalTargetString, fret, slideToFret, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    if (sourceOpenMidi === null || sourceOpenMidi === undefined) return null;
    const lowFret = Math.min(fret, slideToFret);
    const highFret = Math.max(fret, slideToFret);
    let anchor = resolveTargetForFret(sourceOpenMidi, naturalTargetString, lowFret, targetMidiTuning, maxFret);
    if (!anchor) anchor = resolveTargetForFret(sourceOpenMidi, naturalTargetString, highFret, targetMidiTuning, maxFret);
    if (!anchor) return null;
    return {
        s: anchor.s,
        f: _clampFret(fret + anchor.adjustment, maxFret),
        slideTo: _clampFret(slideToFret + anchor.adjustment, maxFret),
    };
}

export function noteHalfstepRank(sourceOpenMidi, fret) {
    return sourceOpenMidi + fret;
}

// Dispatches to remapSlide when the note carries sl/slu, else remapNote.
export function remapNoteEntry(sourceOpenMidi, naturalTargetString, note, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    const hasSl = Number.isInteger(note.sl) && note.sl >= 0;
    const hasSlu = !hasSl && Number.isInteger(note.slu) && note.slu >= 0;
    if (hasSl || hasSlu) {
        const dest = hasSl ? note.sl : note.slu;
        const r = remapSlide(sourceOpenMidi, naturalTargetString, note.f, dest, targetMidiTuning, maxFret);
        if (!r) return null;
        const out = { s: r.s, f: r.f };
        if (hasSl) out.sl = r.slideTo; else out.slu = r.slideTo;
        return out;
    }
    return remapNote(sourceOpenMidi, naturalTargetString, note.f, targetMidiTuning, maxFret);
}

// Remaps every note, then keeps only the lower-pitched note per colliding
// target string. Returns { entry, note } per survivor.
export function resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    const candidates = [];
    for (const note of notes) {
        const midi = sourceOpenMidiByString[note.s];
        if (midi === null || midi === undefined) continue;
        const entry = remapNoteEntry(midi, naturalTargetByString[note.s], note, targetMidiTuning, maxFret);
        if (!entry) continue;
        candidates.push({ entry, note, rank: noteHalfstepRank(midi, note.f) });
    }
    const bySlot = new Map();
    for (const c of candidates) {
        const prev = bySlot.get(c.entry.s);
        if (!prev || c.rank < prev.rank) bySlot.set(c.entry.s, c);
    }
    return Array.from(bySlot.values()).map(c => ({ entry: c.entry, note: c.note }));
}

// How far past an anchor's time (in seconds) remapAnchors looks for an
// exact-remap donor before settling for a revoiced one.
export const ANCHOR_DONOR_WINDOW_S = 2;

// Remaps hand-position anchors ({ time, fret, width }, no string of their
// own) by borrowing the adjustment of the nearest already-remapped note
// at/after the anchor's time. Open-string notes are skipped as donors;
// both arrays must be time-sorted.
// Above this many honestly-sized segments, a chart anchor's span isn't
// "one clean transition" (Bon Jovi "It's My Life": fret 8 settles, then
// fret 1 settles — one split, easy to read) — it's a fast, repeating
// alternation (Alestorm "Drink": source open/fretted flipping every
// ~0.3-0.5s for ~17s straight). Splitting THAT would produce dozens of
// flickering micro-anchors, worse than either the pre-split behavior or
// one wide band, so past this limit the split attempt is discarded in
// favor of a single band spanning the whole chart anchor.
const ANCHOR_MAX_SPLITS = 2;

export function remapAnchors(anchors, remappedNotes, maxFret = DEFAULT_MAX_FRET) {
    if (!Array.isArray(anchors) || anchors.length === 0) return anchors || [];
    if (!Array.isArray(remappedNotes) || remappedNotes.length === 0) return anchors.slice();
    const fretted = remappedNotes.filter(n => n._origNote.f > 0);
    const donors = fretted.length ? fretted : remappedNotes;
    const newlyFretted = remappedNotes.filter(n => n._origNote.f === 0 && n.f > 0);
    const revoicedOf = n => n._crRevoiced === true;
    const out = [];
    let ptr = 0;
    let nfPtr = 0;
    for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        const hardEnd = i + 1 < anchors.length ? anchors[i + 1].time : Infinity;
        while (ptr < donors.length - 1 && donors[ptr].t < a.time) ptr++;
        let note = donors[ptr];
        // Prefer an exact per-note donor over a revoiced one within
        // ANCHOR_DONOR_WINDOW_S — a revoiced donor's adjustment can
        // lurch the anchor to a nonsense fret.
        if (revoicedOf(note)) {
            const limit = a.time + ANCHOR_DONOR_WINDOW_S;
            for (let k = ptr + 1; k < donors.length && donors[k].t <= limit; k++) {
                if (!revoicedOf(donors[k])) { note = donors[k]; break; }
            }
        }
        // The donor's NATURAL fret (pre-hand-travel) — an ergonomic
        // relocation must never leak into the anchor's shift.
        const natF = note._natF !== undefined ? note._natF : note.f;
        const adjustment = natF - note._origNote.f;
        const baseFret = Math.max(0, Math.min(maxFret, a.fret + adjustment));
        let fret = baseFret;
        let width = a.width;
        let startTime = a.time;
        const nfPtrStart = nfPtr;
        const segments = [];

        // Widen (never shrink) the band to also cover a note that was
        // open in the source but is newly fretted here — the source
        // chart's anchors were never authored to give it a hand position.
        // Two bounds, both about what "one hand position" can honestly
        // mean: only look ANCHOR_DONOR_WINDOW_S past the current band's
        // own start (a note several seconds later isn't part of THIS
        // moment regardless of its fret), and never stretch past
        // HAND_JUMP_FRET_THRESHOLD frets (a comfortable single-position
        // span) even for a note that IS nearby in time — a retune with
        // non-uniform per-string offsets can stretch a passage that was
        // compact on the source instrument apart on the target one, no
        // matter how close together in time it still plays. A note past
        // either bound isn't dropped, though: it seeds a brand-new
        // anchor of its own (at its own natural fret, the chart's own
        // width) — so the highway shows the real position change instead
        // of covering nothing, or covering the wrong span — and that new
        // anchor repeats the same widen-then-split process in turn, so
        // one chart anchor can expand into several honestly-sized ones
        // (capped at ANCHOR_MAX_SPLITS — see its own comment).
        let tiedOrphan = false;
        for (;;) {
            const widthCap = Math.max(width, HAND_JUMP_FRET_THRESHOLD);
            const spanEnd = Math.min(hardEnd, startTime + ANCHOR_DONOR_WINDOW_S);
            while (nfPtr < newlyFretted.length && newlyFretted[nfPtr].t < startTime) nfPtr++;
            while (nfPtr < newlyFretted.length && newlyFretted[nfPtr].t < spanEnd) {
                const nf = newlyFretted[nfPtr].f;
                if (nf < fret) {
                    if (width + (fret - nf) > widthCap) break;
                    width += fret - nf; fret = nf;
                } else if (nf > fret + width) {
                    if (nf - fret > widthCap) break;
                    width = nf - fret;
                }
                nfPtr++;
            }
            segments.push({ time: startTime, fret, width });
            if (segments.length > ANCHOR_MAX_SPLITS) break;
            const orphan = nfPtr < newlyFretted.length ? newlyFretted[nfPtr] : null;
            if (!orphan || !(orphan.t < hardEnd)) break;
            // A candidate at/before the CURRENT band's own start can't
            // become a NEXT split (two anchors can't share one timestamp)
            // — but it's still proof the donor-derived band is wrong
            // right from this anchor's very first moment, so it forces
            // the same "rapid alternation" fallback below rather than
            // silently keeping a band that's wrong from the start.
            if (!(orphan.t > startTime)) { tiedOrphan = true; break; }
            startTime = orphan.t;
            fret = Math.max(0, Math.min(maxFret, orphan.f));
            width = a.width;
        }

        if (segments.length <= ANCHOR_MAX_SPLITS && !tiedOrphan) {
            for (const seg of segments) out.push(seg);
        } else {
            // Rapid alternation: fall back to one band spanning the
            // whole chart anchor, widened (uncapped) across every
            // newly-fretted note in it — the same shape this function
            // used before splitting existed, since a wide-but-honest
            // single anchor reads better here than a flicker of tiny ones.
            let fbFret = baseFret, fbWidth = a.width;
            let p = nfPtrStart;
            for (; p < newlyFretted.length && newlyFretted[p].t < hardEnd; p++) {
                const nf = newlyFretted[p].f;
                if (nf < fbFret) { fbWidth += fbFret - nf; fbFret = nf; }
                else if (nf > fbFret + fbWidth) { fbWidth = nf - fbFret; }
            }
            out.push({ time: a.time, fret: fbFret, width: fbWidth });
            nfPtr = p;
        }
    }
    return out;
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

// Relocates a note reached via a fast, large cross-string jump to an
// exact-pitch alternate on an adjacent string; scores candidates by raw
// fret distance regardless of string, so a fix can't trade one bad jump
// for an equally bad same-string one. `notes` must be time-sorted;
// mutates in place. `isEligible` restricts to standalone notes —
// group-solved notes already have a deliberate voicing.
export function reduceHandTravel(notes, target, maxFret = DEFAULT_MAX_FRET, isEligible = () => true) {
    if (!Array.isArray(notes) || notes.length < 2 || !Array.isArray(target)) return;
    const near = (t1, t2) => Math.abs(t2 - t1) <= HAND_JUMP_TIME_WINDOW_S;
    // A neighbor's NATURAL (pre-relocation) position — this pass mutates
    // left-to-right, so an earlier unrelated relocation must not cascade
    // into a false trigger for this note.
    const natS = (note) => note._natS !== undefined ? note._natS : note.s;
    const natF = (note) => note._natF !== undefined ? note._natF : note.f;
    // A jump triggers only when retuning made it worse than the source
    // chart already had (compares `_origNote`). Always eligible: a side
    // newly fretted (was open, isn't now), or notes sharing one source
    // string (a slide). No `_origNote` -> fires unconditionally.
    const becameFretted = (note) => note._origNote && note._origNote.f === 0 && note.f > 0;
    const notWorsenedBySource = (a, b, postGap) => {
        const oa = a._origNote, ob = b._origNote;
        if (!oa || !ob || oa.s === ob.s || becameFretted(a) || becameFretted(b)) return false;
        return postGap <= Math.abs(oa.f - ob.f);
    };
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.f <= 0 || !isEligible(n)) continue;
        const prev = i > 0 ? notes[i - 1] : null;
        const next = i + 1 < notes.length ? notes[i + 1] : null;

        const prevGap = (prev && natS(prev) !== n.s && near(prev.t, n.t)) ? Math.abs(n.f - natF(prev)) : -1;
        const nextGap = (next && natS(next) !== n.s && near(n.t, next.t)) ? Math.abs(n.f - natF(next)) : -1;
        const triggerGap = Math.max(
            (prevGap >= 0 && !notWorsenedBySource(prev, n, prevGap)) ? prevGap : -1,
            (nextGap >= 0 && !notWorsenedBySource(n, next, nextGap)) ? nextGap : -1,
        );
        if (triggerGap < HAND_JUMP_FRET_THRESHOLD) continue;

        // Live positions here, unlike the trigger check above — scoring
        // targets the real final arrangement, not the natural one.
        const score = (f) => Math.max(
            (prev && near(prev.t, n.t)) ? Math.abs(f - prev.f) : -1,
            (next && near(n.t, next.t)) ? Math.abs(f - next.f) : -1,
        );
        const naturalScore = score(n.f);

        const pitch = target[n.s] + n.f;
        let best = null;
        for (const altS of [n.s - 1, n.s + 1]) {
            if (altS < 0 || altS >= target.length) continue;
            const altF = pitch - target[altS];
            if (altF < 0 || altF > maxFret) continue;
            if (notes.some(o => o !== n && o.t === n.t && o.s === altS)) continue;
            const altScore = score(altF);
            if (best === null || altScore < best.score) best = { s: altS, f: altF, score: altScore };
        }
        if (best && best.score <= naturalScore - HAND_JUMP_MIN_IMPROVEMENT) {
            n._natS = n.s;
            n._natF = n.f;
            n.s = best.s;
            n.f = best.f;
        }
    }
}

// Remaps a chord template's frets/fingers (indexed by original string)
// into target-string indices, reusing resolveChordCollisions.
export function remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    if (!template || !Array.isArray(template.frets)) return template;
    const notes = [];
    for (let si = 0; si < template.frets.length; si++) {
        const f = template.frets[si];
        if (f >= 0) notes.push({ s: si, f });
    }
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
    const target = targetMidiTuning || DEFAULT_TARGET_MIDI_TUNING;
    const frets = new Array(target.length).fill(-1);
    const hasFingers = Array.isArray(template.fingers);
    const fingers = hasFingers ? new Array(target.length).fill(-1) : template.fingers;
    for (const { entry, note } of survivors) {
        frets[entry.s] = entry.f;
        if (hasFingers) fingers[entry.s] = template.fingers[note.s] ?? -1;
    }
    return Object.assign({}, template, { frets, fingers });
}

export function remapChordTemplates(sourceOpenMidiByString, naturalTargetByString, templates, targetMidiTuning, maxFret = DEFAULT_MAX_FRET) {
    if (!Array.isArray(templates)) return templates || [];
    return templates.map(t => remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, t, targetMidiTuning, maxFret));
}

// PATCH POINT (chord solver) — exact per-note candidate for a
// simultaneous-note group: the existing per-note engine's output
// expressed as solver placements, or null when any note drops or two
// notes collide on one target string (those cases go to the revoicing
// search instead — src/chord-solver.js). Notes on null-open-midi strings
// are skipped, the same filter chordSpecFromNotes applies, so the two
// views of the group stay index-aligned. Each placement keeps the engine
// `entry` so an accepted group materializes byte-identically to the
// per-note path (including remapped slide endpoints).
function _exactCandidateFor(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret) {
    const placements = [];
    const taken = new Set();
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const midi = sourceOpenMidiByString[n.s];
        if (midi === null || midi === undefined) continue;
        const entry = remapNoteEntry(midi, naturalTargetByString[n.s], n, targetMidiTuning, maxFret);
        if (!entry || taken.has(entry.s)) return null;
        taken.add(entry.s);
        placements.push({ srcIndex: i, s: entry.s, f: entry.f, entry });
    }
    return placements.length ? placements : null;
}

// Materializes solver placements into remapped note copies — the same
// shape the per-note path emits: source-note fields + target s/f +
// `_origNote` back-reference (the note-state scorer keys judgments by
// the ORIGINAL time/string/fret). Exact placements carry the engine
// `entry` (with its own remapped slide endpoints); revoiced placements
// re-apply the source note's slide delta to the solved fret instead.
//
// `revoiced` (optional): tagged onto each copy as `_crRevoiced` for
// remapAnchors' donor preference. Chord paths omit it — an untagged note
// reads as not revoiced, also the right default for direct API use.
function _materializePlacements(notes, placements, maxFret, revoiced) {
    const out = [];
    for (const pl of placements) {
        const src = notes[pl.srcIndex];
        const copy = pl.entry
            ? Object.assign({}, src, pl.entry)
            : Object.assign({}, src, { s: pl.s, f: pl.f });
        if (!pl.entry) {
            if (Number.isInteger(src.sl) && src.sl >= 0) copy.sl = _clampFret(pl.f + (src.sl - src.f), maxFret);
            else if (Number.isInteger(src.slu) && src.slu >= 0) copy.slu = _clampFret(pl.f + (src.slu - src.f), maxFret);
        }
        copy._origNote = src;
        if (revoiced !== undefined) copy._crRevoiced = revoiced;
        out.push(copy);
    }
    return out;
}

// Safety fallback for a group the solver can't take (oversized, node
// budget exhausted with nothing found, or solver disabled by the
// whole-job work valve): the pre-solver per-note path — exact remap +
// lower-pitch-wins collision resolution. Placements carry the engine
// `entry`, so they materialize byte-identically to the per-note path
// (including remapped slide endpoints). `degraded: true` marks the
// voicing as a fallback, informational only.
function _collisionPlacements(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret) {
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
    if (survivors.length === 0) return null;
    return {
        placements: survivors.map(({ entry, note }) => ({ srcIndex: notes.indexOf(note), s: entry.s, f: entry.f, entry })),
        revoiced: false,
        rung: 0,
        degraded: true,
    };
}

// Solves one simultaneous-note group (a Chord's notes, a chord
// template's sounded frets, or a same-onset flat-note bucket): the exact
// per-note remap first, then the revoicing/degradation search. Returns
// { placements, revoiced, rung } or null (unsoundable, matching the
// single-note drop contract). `cache` lives for one remap run, keyed by
// the group's ordered (s,f,sl,slu) shape + template name.
//
// `jobCtl` ({ solverDisabled, maxSearchNodes, stats }): oversized groups
// and solver-disabled jobs route to _collisionPlacements; a node-budget
// abort that found nothing falls back there too — "gave up" must
// degrade the voicing, never drop a group the per-note path could place.
function _solveGroup(cache, sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, templateName, maxFret, jobCtl) {
    let key = (templateName || '') + '#';
    for (const n of notes) key += n.s + ',' + n.f + ',' + (n.sl ?? '') + ',' + (n.slu ?? '') + '|';
    if (cache.has(key)) return cache.get(key);
    let solved = null;
    const spec = chordSpecFromNotes(sourceOpenMidiByString, notes, templateName);
    if (spec) {
        const oversize = notes.length > MAX_SOLVER_GROUP_SIZE;
        if (oversize || (jobCtl && jobCtl.solverDisabled)) {
            if (oversize && jobCtl) jobCtl.stats.oversizeGroups += 1;
            solved = _collisionPlacements(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
        } else {
            const nodeCap = jobCtl && jobCtl.maxSearchNodes != null ? jobCtl.maxSearchNodes : MAX_SEARCH_NODES;
            const budget = { nodes: nodeCap, aborted: false };
            const exact = _exactCandidateFor(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
            solved = solveChord(spec, targetMidiTuning, exact, maxFret, { budget });
            if (budget.aborted) {
                if (jobCtl) jobCtl.stats.searchAborts += 1;
                if (!solved) solved = _collisionPlacements(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
            }
        }
    }
    cache.set(key, solved);
    return solved;
}

// Remaps bundle.notes/.chords/.anchors/.chordTemplates to the active
// target tuning in place, cached per song/tuning. Returns a fresh
// { apply(bundle, targetMidiTuning, maxFret, displayFretOffset),
// getStats() } per call so each splitscreen panel gets its own cache.
// `maxFret` is the active tuning profile's own ceiling
// (CR.resolveActiveTuning's maxFret) — defaults to DEFAULT_MAX_FRET
// (the historical hardcoded 20) when omitted. `displayFretOffset`
// (default 0) is the target capo for physical-fret display — see the
// shift block at the end of _remap.
//
// opts (all optional, defaults are the exported valve constants):
//   maxTotalSolveMs — cold-remap deadline (MAX_TOTAL_SOLVE_MS).
//   maxSearchNodes  — per-group solver node budget (MAX_SEARCH_NODES).
//
// getStats() (diagnostics + tests): { workMs, searchAborts,
// oversizeGroups, solverDisabled } for the most recent cold remap.
export function createRetuner(opts) {
    const maxTotalSolveMs = opts && opts.maxTotalSolveMs !== undefined ? opts.maxTotalSolveMs : MAX_TOTAL_SOLVE_MS;
    const maxSearchNodes = opts && opts.maxSearchNodes !== undefined ? opts.maxSearchNodes : MAX_SEARCH_NODES;

    let cacheNotesRef = null, cacheChordsRef = null, cacheAnchorsRef = null, cacheTemplatesRef = null;
    let cacheTuningRef = null, cacheCapo = null, cacheStringCount = null, cacheTargetSig = null;
    let remappedNotes = [], remappedChords = [], remappedAnchors = [], remappedTemplates = [];
    const stats = { workMs: 0, searchAborts: 0, oversizeGroups: 0, solverDisabled: false };

    // The whole cold remap, synchronous. checkDeadline runs between work
    // units (one template / one same-onset note bucket / one chord) and
    // flips the remaining groups onto the per-note path once the
    // deadline passes — see MAX_TOTAL_SOLVE_MS above.
    function _remap(rawNotes, rawChords, rawAnchors, rawTemplates, tuning, capo, sc, target, maxFret, displayFretOffset) {
        const t0 = _now();
        const ctl = { solverDisabled: false, maxSearchNodes, stats };
        const checkDeadline = () => {
            if (!ctl.solverDisabled && _now() - t0 > maxTotalSolveMs) {
                ctl.solverDisabled = true;
                stats.solverDisabled = true;
            }
        };
        const sourceOpenMidiByString = computeOpenStringMidiByString(sc, tuning, capo);
        const shiftK = computeArrangementShift(sc, tuning, capo, sourceOpenMidiByString, target);
        const naturalTargetByString = [];
        for (let s = 0; s < sc; s++) {
            naturalTargetByString.push(s + shiftK);
        }

        // PATCH POINT (chord solver): one solve cache per remap
        // run; identical chord shapes (by ordered s/f/slide
        // signature + template name) solve once per song/tuning.
        const groupCache = new Map();

        // Templates FIRST, so chord instances and the hand-shape-
        // synthesized chords screen.js builds straight from
        // bundle.chordTemplates follow the SAME solved voicing by
        // construction (same array index/order — chordTemplates is
        // indexed by chord id).
        const templateSolutions = new Map(); // template index -> Map<sourceString, {s,f}>
        const remapOneTemplate = (template, ti) => {
            if (!template || !Array.isArray(template.frets)) return template;
            const tNotes = [];
            for (let si = 0; si < template.frets.length; si++) {
                if (template.frets[si] >= 0) tNotes.push({ s: si, f: template.frets[si] });
            }
            // Single-note / empty templates keep the per-note
            // path (identical to the pre-solver behavior).
            if (tNotes.length < 2) {
                return remapChordTemplate(sourceOpenMidiByString, naturalTargetByString, template, target, maxFret);
            }
            const solved = _solveGroup(groupCache, sourceOpenMidiByString, naturalTargetByString, tNotes, target, template.displayName || template.name, maxFret, ctl);
            const frets = new Array(target.length).fill(-1);
            if (!solved) {
                // Nothing soundable (all strings null-midi) — same net
                // effect as the per-note path dropping every note.
                return Object.assign({}, template, {
                    frets,
                    fingers: Array.isArray(template.fingers) ? frets.slice() : template.fingers,
                });
            }
            const byString = new Map();
            for (const pl of solved.placements) {
                byString.set(tNotes[pl.srcIndex].s, { s: pl.s, f: pl.f });
                frets[pl.s] = pl.f;
            }
            templateSolutions.set(ti, byString);
            // Fingers: a chart that omitted finger data entirely (non-
            // array) keeps that omission — no fabricated digits. An exact
            // placement otherwise carries the chart's own per-string
            // fingering UNLESS the remap crossed the open/fretted
            // boundary (a carried finger 0 would be nonsense) or the
            // shape was revoiced — both derive plausible fingers instead.
            let fingers;
            if (!Array.isArray(template.fingers)) {
                fingers = template.fingers;
            } else {
                let carried = null;
                if (!solved.revoiced) {
                    carried = new Array(target.length).fill(-1);
                    for (const pl of solved.placements) {
                        const c = template.fingers[tNotes[pl.srcIndex].s] ?? -1;
                        if (c >= 0 && (c === 0) !== (pl.f === 0)) { carried = null; break; }
                        carried[pl.s] = c;
                    }
                }
                fingers = carried || computeChordFingers(frets);
            }
            return Object.assign({}, template, { frets, fingers });
        };
        let newTemplates;
        if (Array.isArray(rawTemplates)) {
            newTemplates = [];
            for (let ti = 0; ti < rawTemplates.length; ti++) {
                checkDeadline();
                newTemplates.push(remapOneTemplate(rawTemplates[ti], ti));
            }
        } else {
            newTemplates = rawTemplates || [];
        }

        // Group by onset time first (a bass double-stop is often two
        // flat Notes sharing a time rather than a Chord object), so
        // simultaneous notes on different source strings still
        // resolve as one chord. PATCH POINT (chord solver): groups
        // of >= 2 route through the solver — the exact candidate
        // reproduces the per-note remap whenever it is drop/collision-
        // free and playable, so single notes and clean groups behave
        // exactly as before; only groups the per-note path would break
        // (drops, collisions, unplayable stretches) get revoiced.
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
                    const solved = _solveGroup(groupCache, sourceOpenMidiByString, naturalTargetByString, bucket, target, null, maxFret, ctl);
                    if (solved) newNotes.push(..._materializePlacements(bucket, solved.placements, maxFret, solved.revoiced));
                } else {
                    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, bucket, target, maxFret);
                    for (const { entry, note } of survivors) {
                        const copy = Object.assign({}, note, entry);
                        copy._origNote = note; // keyed by the note-state provider
                        copy._crRevoiced = false; // exact per-note remap — always a preferred anchor donor
                        standalone.add(copy);
                        newNotes.push(copy);
                    }
                }
            }
            newNotes.sort((a, b) => a.t - b.t);
            reduceHandTravel(newNotes, target, maxFret, n => standalone.has(n));
        }
        const newChords = [];
        if (Array.isArray(rawChords)) {
            for (const ch of rawChords) {
                checkDeadline();
                const chNotes = ch.notes || [];
                let placements = null;
                // Template-first: an instance whose notes match its
                // template's frets (even a difficulty-filtered SUBSET)
                // takes the template's solved voicing, so instances at
                // every difficulty level agree with each other and the
                // chord diagram. Instances referencing a dropped/
                // diverging string solve ad-hoc below. Null/absent id
                // means "no template" — guarded before Number() coercion,
                // which would alias null to template index 0 (same guard
                // screen.js's chord-ghost helpers apply).
                const cid = ch.id == null ? null
                    : (typeof ch.id === 'number' ? ch.id : Number(ch.id));
                const byString = cid !== null ? templateSolutions.get(cid) : undefined;
                const tmpl = cid !== null && Array.isArray(rawTemplates) ? (rawTemplates[cid] || null) : null;
                // Sliding chords skip the template shortcut: the
                // template solution was solved from PLAIN frets, so
                // it can't reproduce remapSlide's lower-endpoint
                // anchoring — the ad-hoc path's exact candidate goes
                // through remapNoteEntry/remapSlide and keeps slides exact.
                const hasSlide = chNotes.some(n => (Number.isInteger(n.sl) && n.sl >= 0)
                    || (Number.isInteger(n.slu) && n.slu >= 0));
                if (!hasSlide && byString && tmpl && chNotes.length > 0
                    && chNotes.every(n => tmpl.frets[n.s] === n.f && byString.has(n.s))) {
                    // One note per source string: a malformed chart
                    // can double up a string within one chord — the
                    // first note wins, matching the one-note-per-
                    // target-slot invariant every other path keeps.
                    const seen = new Set();
                    placements = [];
                    for (let i = 0; i < chNotes.length; i++) {
                        const n = chNotes[i];
                        if (seen.has(n.s)) continue;
                        seen.add(n.s);
                        const t = byString.get(n.s);
                        placements.push({ srcIndex: i, s: t.s, f: t.f });
                    }
                } else if (chNotes.length >= 2) {
                    const solved = _solveGroup(groupCache, sourceOpenMidiByString, naturalTargetByString, chNotes, target,
                        tmpl ? (tmpl.displayName || tmpl.name) : null, maxFret, ctl);
                    placements = solved ? solved.placements : null;
                } else {
                    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, chNotes, target, maxFret);
                    placements = survivors.map(({ entry, note }) => ({ srcIndex: chNotes.indexOf(note), s: entry.s, f: entry.f, entry }));
                }
                if (placements && placements.length > 0) {
                    newChords.push(Object.assign({}, ch, { notes: _materializePlacements(chNotes, placements, maxFret) }));
                }
            }
        }
        remappedNotes = newNotes;
        remappedChords = newChords;
        remappedAnchors = remapAnchors(rawAnchors, newNotes, maxFret);
        remappedTemplates = newTemplates;

        // Physical-fret display shift (target capo). The remap above is
        // capo-RELATIVE (fret r means "r above the capo"); a renderer
        // numbering its board physically passes the target capo as
        // displayFretOffset and every FRETTED output fret becomes r +
        // capo — pure relabeling, sounding pitch untouched.
        //
        // Opens (fret 0) stay 0 — held by the bar, not fingered, and
        // renderers key open-note treatment on f === 0. Slides shift the
        // same way. Anchors (hand POSITIONS, not opens) always shift,
        // rebuilt as fresh objects (the no-donor remapAnchors path
        // returns the RAW chart objects, never mutated). Template frets
        // shift where > 0; fingers are untouched (0 = "no finger" still
        // holds under a capo).
        if (displayFretOffset > 0) {
            const off = displayFretOffset;
            const shiftNote = (n) => {
                if (n.f > 0) n.f += off;
                if (Number.isInteger(n.sl) && n.sl > 0) n.sl += off;
                if (Number.isInteger(n.slu) && n.slu > 0) n.slu += off;
            };
            for (const n of remappedNotes) shiftNote(n);
            for (const ch of remappedChords) {
                for (const n of ch.notes) shiftNote(n);
            }
            remappedAnchors = remappedAnchors.map(
                a => ({ time: a.time, fret: a.fret + off, width: a.width }));
            remappedTemplates = Array.isArray(remappedTemplates)
                ? remappedTemplates.map(t => (t && Array.isArray(t.frets))
                    ? Object.assign({}, t, { frets: t.frets.map(f => (f > 0 ? f + off : f)) })
                    : t)
                : remappedTemplates;
        }
        stats.workMs = _now() - t0;
    }

    function apply(bundle, targetMidiTuning, maxFret = DEFAULT_MAX_FRET, displayFretOffset = 0) {
        const target = (Array.isArray(targetMidiTuning) && targetMidiTuning.length >= 1)
            ? targetMidiTuning : DEFAULT_TARGET_MIDI_TUNING;
        const rawNotes = bundle.notes, rawChords = bundle.chords, rawAnchors = bundle.anchors;
        const rawTemplates = bundle.chordTemplates;
        const tuning = bundle.tuning, capo = bundle.capo | 0, sc = bundle.stringCount;
        // Physical-fret display shift (see _remap's tail) — sanitized here
        // so a bogus caller value can neither shift by a fraction nor skew
        // the cache signature.
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
                _remap(rawNotes, rawChords, rawAnchors, rawTemplates, tuning, capo, sc, target, maxFret, off);
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
