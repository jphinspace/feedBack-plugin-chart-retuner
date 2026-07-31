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

const _now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? () => performance.now()
    : () => Date.now();

// Pitch-order tables per target-tuning array, cached by array identity
// (resolveTargetTuning always allocates a fresh array). Null for an
// ascending target, where resolveTargetForFret can walk by index
// directly. Otherwise { byPitch, rankOf }: an index walk on a
// non-monotonic target (a drone string tuned above its neighbors) can
// march away from the string that could actually play the note.
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
    const ord = _pitchOrderFor(target);
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

// Above this many segments, a chart anchor's span reflects rapid
// alternation rather than a real multi-step transition, and splitting
// would flicker through dozens of micro-anchors — worse than one wide
// band. Past this limit, remapAnchors falls back to a single band
// spanning the whole chart anchor instead.
const ANCHOR_MAX_SPLITS = 5;

// Remaps hand-position anchors ({ time, fret, width }, no string of
// their own) by borrowing the adjustment of the nearest already-remapped
// note at/after the anchor's time. Open-string notes are skipped as
// donors; both arrays must be time-sorted.

export function remapAnchors(anchors, remappedNotes, maxFret = DEFAULT_MAX_FRET) {
    if (!Array.isArray(anchors) || anchors.length === 0) return anchors || [];
    if (!Array.isArray(remappedNotes) || remappedNotes.length === 0) return anchors.slice();
    const fretted = remappedNotes.filter(n => n._origNote.f > 0);
    const donors = fretted.length ? fretted : remappedNotes;
    const revoicedOf = n => n._crRevoiced === true;
    // Widen/split candidates: every target-fretted note, whether or not
    // it started open in the source (a differential per-string retune
    // can strand an already-fretted note outside the donor band too).
    // Revoiced notes are excluded — their fret can be a nonsense
    // pitch-solver artifact, not a real hand-position destination.
    const targetFretted = remappedNotes.filter(n => n.f > 0 && !revoicedOf(n));
    const out = [];
    let ptr = 0;
    let cPtr = 0;
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
        // Live fret (post-relocation), since the anchor should guide the
        // player to what's actually displayed. A relocation that's a
        // poor fit for the passage gets its own anchor via the split
        // logic below instead of being hidden here.
        const adjustment = note.f - note._origNote.f;
        const baseFret = Math.max(0, Math.min(maxFret, a.fret + adjustment));
        let fret = baseFret;
        let width = a.width;
        let startTime = a.time;
        const cPtrStart = cPtr;
        const segments = [];

        // Grows the band to cover a note that lands outside it (most
        // often one newly fretted here after being open in the source).
        // Bounded to ANCHOR_DONOR_WINDOW_S past the band's own start and
        // HAND_JUMP_FRET_THRESHOLD frets, so "one hand position" stays
        // honest. A candidate past either bound seeds its own brand-new
        // anchor instead (at its live fret), which repeats the same
        // widen-then-split process — so one chart anchor can expand into
        // several (capped at ANCHOR_MAX_SPLITS).
        let tiedOrphan = false;
        for (;;) {
            const widthCap = Math.max(width, HAND_JUMP_FRET_THRESHOLD);
            const spanEnd = Math.min(hardEnd, startTime + ANCHOR_DONOR_WINDOW_S);
            while (cPtr < targetFretted.length && targetFretted[cPtr].t < startTime) cPtr++;
            while (cPtr < targetFretted.length && targetFretted[cPtr].t < hardEnd) {
                const nf = targetFretted[cPtr].f;
                // Already covered — consume regardless of the time
                // window (which only gates genuine widen/split decisions
                // below), so an already-covered note can't force a
                // pointless split.
                if (nf >= fret && nf <= fret + width) { cPtr++; continue; }
                if (!(targetFretted[cPtr].t < spanEnd)) break;
                if (nf < fret) {
                    if (width + (fret - nf) > widthCap) break;
                    width += fret - nf; fret = nf;
                } else {
                    if (nf - fret > widthCap) break;
                    width = nf - fret;
                }
                cPtr++;
            }
            segments.push({ time: startTime, fret, width });
            if (segments.length > ANCHOR_MAX_SPLITS) break;
            const orphan = cPtr < targetFretted.length ? targetFretted[cPtr] : null;
            if (!orphan || !(orphan.t < hardEnd)) break;
            // A candidate sharing the band's own start time can't seed a
            // new split (anchors need distinct timestamps), but it still
            // proves the band is wrong from the start — so it triggers
            // the rapid-alternation fallback below instead.
            if (!(orphan.t > startTime)) { tiedOrphan = true; break; }
            startTime = orphan.t;
            fret = Math.max(0, Math.min(maxFret, orphan.f));
            width = a.width;
        }

        if (segments.length <= ANCHOR_MAX_SPLITS && !tiedOrphan) {
            for (const seg of segments) out.push(seg);
        } else {
            // Rapid alternation: one uncapped band spanning the whole
            // chart anchor, sized to the true min/max fret across every
            // target-fretted note in it — reads better than a flicker
            // of tiny ones. The donor's own base fret is only a
            // fallback for the (unreachable in practice) case of no
            // target-fretted notes in the span at all — it must not
            // pad the real range, since the donor can come from well
            // outside this anchor's own span when nothing local has a
            // fretted source note to borrow from.
            let fbMin = null, fbMax = null;
            let p = cPtrStart;
            for (; p < targetFretted.length && targetFretted[p].t < hardEnd; p++) {
                const nf = targetFretted[p].f;
                if (fbMin === null || nf < fbMin) fbMin = nf;
                if (fbMax === null || nf > fbMax) fbMax = nf;
            }
            if (fbMin === null) { fbMin = baseFret; fbMax = baseFret; }
            // An anchor is a hand-position indicator (one finger per
            // fret), not a note tracker, so the band never shrinks
            // below the chart's own authored width even when every
            // real note in a long span lands on one fret.
            out.push({ time: a.time, fret: fbMin, width: Math.max(fbMax - fbMin, a.width) });
            cPtr = p;
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
    const natS = (note) => note._natS !== undefined ? note._natS : note.s;
    const natF = (note) => note._natF !== undefined ? note._natF : note.f;
    // A jump triggers only when retuning made it worse than the source
    // chart already had (compares `_origNote`). Always eligible: a side
    // newly fretted (open in the source, fretted now), or notes sharing
    // one source string (a slide). No `_origNote` -> fires unconditionally.
    const becameFretted = (note) => note._origNote && note._origNote.f === 0 && note.f > 0;
    const notWorsenedBySource = (a, b, postGap) => {
        const oa = a._origNote, ob = b._origNote;
        if (!oa || !ob || oa.s === ob.s || becameFretted(a) || becameFretted(b)) return false;
        return postGap <= Math.abs(oa.f - ob.f);
    };
    // A repeated note (identical source string+fret, back-to-back with
    // nothing else in between) relocates as one run rather than
    // note-by-note — otherwise only the run's member next to an awkward
    // neighbor would move, leaving its own repeats on a different fret.
    const sameOrigin = (a, b) => a._origNote && b._origNote
        && a._origNote.s === b._origNote.s && a._origNote.f === b._origNote.f;
    // A slide's start and end fret are both computed for the SAME target
    // string (remapSlide); relocating just the start note here would
    // leave its `.sl`/`.slu` endpoint stranded on the string it left.
    const isSlide = (note) => (Number.isInteger(note.sl) && note.sl >= 0)
        || (Number.isInteger(note.slu) && note.slu >= 0);

    for (let pass = 0; pass < HAND_TRAVEL_MAX_PASSES; pass++) {
        let changed = false;
        let i = 0;
        while (i < notes.length) {
            const n = notes[i];
            // A note that already relocated (in an earlier pass) is
            // settled -- re-evaluating it here would score candidates
            // against its NEW position instead of its natural one,
            // letting it drift string to string pass after pass instead
            // of ever converging.
            if (n.f <= 0 || !isEligible(n) || n._natS !== undefined || isSlide(n)) { i++; continue; }
            let end = i + 1;
            while (end < notes.length && isEligible(notes[end]) && notes[end].f > 0 && !isSlide(notes[end]) && sameOrigin(notes[end], n)) end++;
            const runStart = notes[i], runEnd = notes[end - 1];
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
                for (let k = i; k < end && !collides; k++) {
                    const rn = notes[k];
                    collides = notes.some(o => o !== rn && o.t === rn.t && o.s === altS);
                }
                if (collides) continue;
                const altScore = score(altF);
                if (best === null || altScore < best.score) best = { s: altS, f: altF, score: altScore };
            }
            if (best && best.score <= naturalScore - HAND_JUMP_MIN_IMPROVEMENT) {
                for (let k = i; k < end; k++) {
                    const rn = notes[k];
                    rn._natS = rn.s;
                    rn._natF = rn.f;
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
// simultaneous-note group, as solver placements: null when any note
// drops or two collide on one target string (those go to the revoicing
// search in chord-solver.js instead). Skips null-open-midi strings using
// the same filter as chordSpecFromNotes, so the two views stay
// index-aligned.
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

// Materializes solver placements into remapped note copies: source-note
// fields + target s/f + an `_origNote` back-reference (keyed by the
// note-state scorer). Exact placements carry the engine `entry` (with
// remapped slide endpoints); revoiced placements re-apply the source
// note's slide delta to the solved fret instead.
//
// `revoiced` (optional) is tagged onto each copy as `_crRevoiced`, for
// remapAnchors' donor preference; omitted, a copy reads as not revoiced.
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

// Safety fallback for a group routed away from the solver (oversized,
// node budget exhausted, or solver disabled): the pre-solver per-note
// path, exact remap plus lower-pitch-wins collision resolution.
// `degraded: true` marks the voicing as a fallback, informational only.
function _collisionPlacements(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret) {
    const survivors = resolveChordCollisions(sourceOpenMidiByString, naturalTargetByString, notes, targetMidiTuning, maxFret);
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
// _collisionPlacements, so "gave up" still degrades the voicing rather
// than dropping a group the per-note path could have placed.
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

        // Templates FIRST, so chord instances and the hand-shape chords
        // screen.js builds from bundle.chordTemplates follow the SAME
        // solved voicing (chordTemplates is indexed by chord id).
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
        // capo-relative (fret r means "r above the capo"); a renderer
        // numbering its board physically passes the target capo as
        // displayFretOffset, and every fretted output fret becomes
        // r + capo. Pure relabeling — sounding pitch is untouched.
        //
        // Opens (fret 0) stay 0, since an open string rings from the bar
        // itself and renderers key open-note treatment on f === 0.
        // Slides shift the same way; anchors are rebuilt as fresh
        // objects; template frets shift where > 0 and fingers are
        // unaffected.
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

// ---- Source-capo pass-through (feedBack chart-retuner) ----------------
//
// `apply()` above always outputs the ABSOLUTE physical fret a bare
// (uncapo'd) target needs to reproduce a note's exact sounding pitch —
// correct and necessary whenever the source chart's own tuning/capo
// (bundle.capo, e.g. a guitar recorded with a capo) doesn't line up
// pitch-for-pitch with the target. But when the retune is effectively a
// no-op (same tuning, no target capo/octave shift), that absolute-fret
// output silently bakes the source's OWN capo into every fret number —
// turning what the chart authored as "open" into "fret 2", "fret 1" into
// "fret 3", etc. — instead of leaving the chart looking like its
// untouched, capo-relative self. The two functions below re-express an
// already-remapped bundle relative to the source's capo when doing so is
// exact, so a target that adds nothing of its own reproduces the
// original chart's fret numbers, and the caller folds the same amount
// into the `capo` value it reports back (mirroring how a chart's own
// native capo already pairs frets with a separate capo field for every
// chart-transform consumer).
//
// Split in two (check, then mutate) so a caller can decide once from the
// fuller of two related note sets (e.g. a difficulty-filtered view and
// its unfiltered counterpart) and force the SAME decision on both —
// independent per-view decisions could disagree at the margins and leave
// one view's frets inconsistent with the single `capo` value reported
// for both.

// True when every fretted value in `bundle` (notes, chord notes, slide
// endpoints, anchor bands, template frets) sits at or above `sourceCapo`
// — the precondition for subtracting it back out below. A target whose
// own tuning/octave choice needs to reach a pitch below what the
// source's capo allows can't be re-expressed this way; the caller should
// leave that bundle (and any paired view) as absolute frets.
export function canFoldSourceCapo(bundle, sourceCapo) {
    if (!(sourceCapo > 0)) return false;
    const notes = Array.isArray(bundle.notes) ? bundle.notes : [];
    const chordNotes = Array.isArray(bundle.chords) ? bundle.chords.flatMap(c => c.notes || []) : [];
    for (const n of notes.concat(chordNotes)) {
        if (n.f > 0 && n.f < sourceCapo) return false;
        if (Number.isInteger(n.sl) && n.sl > 0 && n.sl < sourceCapo) return false;
        if (Number.isInteger(n.slu) && n.slu > 0 && n.slu < sourceCapo) return false;
    }
    const anchors = Array.isArray(bundle.anchors) ? bundle.anchors : [];
    for (const a of anchors) {
        if (a.fret < sourceCapo) return false;
    }
    const templates = Array.isArray(bundle.chordTemplates) ? bundle.chordTemplates : [];
    for (const t of templates) {
        if (Array.isArray(t.frets) && t.frets.some(f => f > 0 && f < sourceCapo)) return false;
    }
    return true;
}

// Subtracts `sourceCapo` from every fretted value in `bundle`, mutating
// notes/chords/anchors/chordTemplates in place. No safety check of its
// own — call only after canFoldSourceCapo(bundle, sourceCapo) (on this
// bundle or a fuller paired one) confirms every value stays >= 0.
// Opens (fret 0) and unused template slots (-1) are left alone, same
// convention as the physical-fret-display shift in _remap above; anchor
// bands shift unconditionally (their own already-uniform convention).
export function applySourceCapoFold(bundle, sourceCapo) {
    const notes = Array.isArray(bundle.notes) ? bundle.notes : [];
    const chordNotes = Array.isArray(bundle.chords) ? bundle.chords.flatMap(c => c.notes || []) : [];
    for (const n of notes.concat(chordNotes)) {
        if (n.f > 0) n.f -= sourceCapo;
        if (Number.isInteger(n.sl) && n.sl > 0) n.sl -= sourceCapo;
        if (Number.isInteger(n.slu) && n.slu > 0) n.slu -= sourceCapo;
    }
    const anchors = Array.isArray(bundle.anchors) ? bundle.anchors : [];
    for (const a of anchors) a.fret -= sourceCapo;
    const templates = Array.isArray(bundle.chordTemplates) ? bundle.chordTemplates : [];
    for (const t of templates) {
        if (Array.isArray(t.frets)) t.frets = t.frets.map(f => (f > 0 ? f - sourceCapo : f));
    }
}
