// Chart Retuner — hand-position anchor remap math. Consumes an
// already-remapped note array (retune-engine.js's output); doesn't touch
// the source chart, the solver, or string/fret remap math itself, so this
// module has no dependency back on how notes got remapped, only on the
// result.

import { DEFAULT_MAX_FRET, HAND_JUMP_FRET_THRESHOLD } from './common.js';
import { isFretted } from './chord-solver.js';

// How far past an anchor's time (in seconds) remapAnchors looks for an
// exact-remap donor before settling for a revoiced one.
export const ANCHOR_DONOR_WINDOW_S = 2;

// Above this many segments, a chart anchor's span reflects rapid
// alternation rather than a real multi-step transition — falls back to
// one wide band instead of flickering through micro-anchors. Sized to
// cover a short vamp repeating a couple of times under one raw anchor.
const ANCHOR_MAX_SPLITS = 8;

// Minimum distinct out-of-band moments before a departure counts as a
// real position change rather than one note passing through.
const ANCHOR_SUSTAIN_MIN_MOMENTS = 2;

// An anchor's displayed width is a fret COUNT, not a fret-to-fret span
// (fret=4,width=4 shows frets 4-7) — never below a 4-finger reach.
const ANCHOR_MIN_WIDTH = 4;

// Remaps hand-position anchors ({ time, fret, width }, no string of
// their own) by borrowing the adjustment of the nearest already-remapped
// note at/after the anchor's time. A donor must actually need a finger:
// excluded are open strings (origNote.f === 0) and, the same rule, any
// note at or below the chart's own capo (origNote.f <= capo) — the capo
// itself holds those down, not a finger, so neither indicates a hand
// position. Both arrays must be time-sorted.

export function remapAnchors(anchors, remappedNotes, maxFret = DEFAULT_MAX_FRET, capo = 0) {
    if (!Array.isArray(anchors) || anchors.length === 0) return anchors || [];
    if (!Array.isArray(remappedNotes) || remappedNotes.length === 0) return anchors.slice();
    const fretted = remappedNotes.filter(n => n.origNote.f > capo);
    const donors = fretted.length ? fretted : remappedNotes;
    const revoicedOf = n => n.crRevoiced === true;
    // Revoiced is only untrustworthy for hand-position purposes above
    // degradeLevel 0 (notes actually dropped, not just refingered).
    const untrustworthy = n => revoicedOf(n) && n.crDegradeLevel !== 0;
    // Widen/split candidates, grouped into moments so a chord strike's
    // simultaneous notes widen or split together, not string by string.
    const targetFretted = remappedNotes.filter(n => isFretted(n.f) && !untrustworthy(n));
    const moments = [];
    for (let i = 0; i < targetFretted.length; ) {
        const t = targetFretted[i].t;
        let lo = targetFretted[i].f;
        let hi = lo;
        let j = i + 1;
        while (j < targetFretted.length && targetFretted[j].t === t) {
            const f = targetFretted[j].f;
            if (f < lo) lo = f;
            if (f > hi) hi = f;
            j += 1;
        }
        moments.push({ t, lo, hi });
        i = j;
    }
    // True when moments recur outside [fret,fret+width] often enough
    // to be a real position change, not one passing moment to widen through.
    const isSustainedDeparture = (fromIdx, fret, width, hardEnd, windowEnd) => {
        let seen = 0;
        for (let k = fromIdx; k < moments.length && moments[k].t < hardEnd && moments[k].t < windowEnd; k += 1) {
            const m = moments[k];
            if (m.lo >= fret && m.hi <= fret + width) continue;
            seen += 1;
            if (seen >= ANCHOR_SUSTAIN_MIN_MOMENTS) return true;
        }
        return false;
    };
    const out = [];
    let ptr = 0;
    let mPtr = 0;
    for (let i = 0; i < anchors.length; i += 1) {
        const a = anchors[i];
        const hardEnd = i + 1 < anchors.length ? anchors[i + 1].time : Infinity;
        while (ptr < donors.length - 1 && donors[ptr].t < a.time) ptr += 1;
        let note = donors[ptr];
        // Prefer an exact per-note donor over a revoiced one within
        // ANCHOR_DONOR_WINDOW_S — a revoiced donor's adjustment can
        // lurch the anchor to a nonsense fret.
        if (revoicedOf(note)) {
            const limit = a.time + ANCHOR_DONOR_WINDOW_S;
            for (let k = ptr + 1; k < donors.length && donors[k].t <= limit; k += 1) {
                if (!revoicedOf(donors[k])) { note = donors[k]; break; }
            }
        }
        // Live fret (post-relocation), since the anchor should guide the
        // player to what's actually displayed. A relocation that's a
        // poor fit for the passage gets its own anchor via the split
        // logic below instead of being hidden here.
        const adjustment = note.f - note.origNote.f;
        const baseFret = Math.max(0, Math.min(maxFret, a.fret + adjustment));
        let fret = baseFret;
        let width = 0;
        let startTime = a.time;
        const mPtrStart = mPtr;
        const segments = [];

        // Grows the band for an in-bounds moment; past any bound, the
        // moment seeds its own new anchor instead (up to ANCHOR_MAX_SPLITS).
        let tiedOrphan = false;
        for (;;) {
            const widthCap = Math.max(width, HAND_JUMP_FRET_THRESHOLD);
            const spanEnd = Math.min(hardEnd, startTime + ANCHOR_DONOR_WINDOW_S);
            // The sustain veto only applies once a real moment has
            // confirmed the band — not to a fresh, still-unconfirmed estimate.
            let established = false;
            while (mPtr < moments.length && moments[mPtr].t < startTime) mPtr += 1;
            while (mPtr < moments.length && moments[mPtr].t < hardEnd) {
                const m = moments[mPtr];
                // Already covered — consume regardless of the time
                // window (which only gates genuine widen/split decisions
                // below), so an already-covered moment can't force a
                // pointless split.
                if (m.lo >= fret && m.hi <= fret + width) { mPtr += 1; established = true; continue; }
                if (!(m.t < spanEnd)) break;
                const newLo = Math.min(fret, m.lo);
                const newHi = Math.max(fret + width, m.hi);
                if (newHi - newLo > widthCap) break;
                if (established && isSustainedDeparture(mPtr, fret, width, hardEnd, spanEnd)) break;
                fret = newLo; width = newHi - newLo;
                mPtr += 1;
                established = true;
            }
            segments.push({ time: startTime, fret, width: Math.max(width + 1, ANCHOR_MIN_WIDTH) });
            if (segments.length > ANCHOR_MAX_SPLITS) break;
            const orphan = mPtr < moments.length ? moments[mPtr] : null;
            if (!orphan || !(orphan.t < hardEnd)) break;
            // A candidate sharing the band's own start time can't seed a
            // new split (anchors need distinct timestamps), but it still
            // proves the band is wrong from the start — so it triggers
            // the rapid-alternation fallback below instead.
            if (!(orphan.t > startTime)) { tiedOrphan = true; break; }
            startTime = orphan.t;
            fret = Math.max(0, Math.min(maxFret, orphan.lo));
            const hi = Math.max(0, Math.min(maxFret, orphan.hi));
            width = hi - fret;
        }

        if (segments.length <= ANCHOR_MAX_SPLITS && !tiedOrphan) {
            for (const seg of segments) out.push(seg);
        } else {
            // Rapid alternation: one uncapped band spanning the whole
            // chart anchor, sized to the true min/max fret across every
            // target-fretted moment in it — reads better than a flicker
            // of tiny ones. The donor's own base fret is only a
            // fallback for the (unreachable in practice) case of no
            // target-fretted moments in the span at all — it must not
            // pad the real range, since the donor can come from well
            // outside this anchor's own span when nothing local has a
            // fretted source note to borrow from.
            let fbMin = null;
            let fbMax = null;
            let p = mPtrStart;
            for (; p < moments.length && moments[p].t < hardEnd; p += 1) {
                const m = moments[p];
                if (fbMin === null || m.lo < fbMin) fbMin = m.lo;
                if (fbMax === null || m.hi > fbMax) fbMax = m.hi;
            }
            if (fbMin === null) { fbMin = baseFret; fbMax = baseFret; }
            // An anchor is a hand-position indicator (one finger per
            // fret), not a note tracker, so the band never shrinks
            // below ANCHOR_MIN_WIDTH even when every real note in a
            // long span lands on one fret.
            out.push({ time: a.time, fret: fbMin, width: Math.max(fbMax - fbMin + 1, ANCHOR_MIN_WIDTH) });
            mPtr = p;
        }
    }
    return out;
}
