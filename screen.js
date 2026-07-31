// Chart Retuner — chart-transform provider (feedBack#952).
//
// Registers CR.createRetuner() (./src/chart-retune.js) as a chart-transform
// provider, so the remapped chart reaches every renderer and scorer, not
// just one renderer this plugin owns. Also hosts the Target Tunings
// settings bridge and the player-controls Retuner/Capo pills.
import { CR } from './src/chart-retune.js';

(function () {
    'use strict';

    const PROVIDER_ID = 'chart_retuner';

    // Legacy namespace, kept as-is so upgrading installs keep their saved tunings.
    const STORAGE_PREFIX = 'chart_retuner_bg_';
    const _mem = Object.create(null); // in-memory fallback when localStorage is blocked

    function _read(key) {
        if (key in _mem) return _mem[key];
        try {
            const v = localStorage.getItem(STORAGE_PREFIX + key);
            if (v !== null) return v;
        } catch (_) { /* storage blocked */ }
        return undefined;
    }
    // Persists without triggering _refresh()'s chart-transform 'refresh'
    // dispatch — for writes that can't possibly change remap output (e.g.
    // per-string display color), so a value that's purely cosmetic doesn't
    // walk a host-side highway into a full re-clone + re-remap of the chart.
    function _writeSilent(key, val) {
        const s = String(val);
        _mem[key] = s;
        try { localStorage.setItem(STORAGE_PREFIX + key, s); } catch (_) { /* storage blocked */ }
    }
    function _write(key, val) {
        _writeSilent(key, val);
        _refresh();
    }

    // Three per-arrangement-class tuning profiles sharing one pool of
    // built-in presets + saved custom tunings.
    const _PROFILE_KEY_BY_CLASS = {
        bass: 'targetTuningIdBass',
        rhythm: 'targetTuningIdRhythm',
        lead: 'targetTuningIdLead',
    };
    const _PROFILE_CLASSES = Object.keys(_PROFILE_KEY_BY_CLASS);
    function _profileKeyFor(arrClass) {
        return _PROFILE_KEY_BY_CLASS[arrClass] || _PROFILE_KEY_BY_CLASS.bass;
    }

    // One-time migration from the pre-guitar single 'targetTuningId' key to the bass profile.
    (function _migrateLegacyTuningProfile() {
        try {
            if (localStorage.getItem(STORAGE_PREFIX + 'targetTuningIdBass') != null) return;
            const legacy = localStorage.getItem(STORAGE_PREFIX + 'targetTuningId');
            if (legacy == null) return;
            _mem.targetTuningIdBass = legacy;
            localStorage.setItem(STORAGE_PREFIX + 'targetTuningIdBass', legacy);
        } catch (_) { /* storage blocked */ }
    })();

    function _readCustomTunings() {
        let list;
        try { list = JSON.parse(_read('customTunings') || '[]'); } catch (_) { list = []; }
        if (!Array.isArray(list)) return [];
        return list.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string'
            && CR.isValidTuningStringsArray(p.strings));
    }
    function _writeCustomTunings(list) { _write('customTunings', JSON.stringify(list)); }

    // Per-tuning capo/octave overrides, keyed by resolved tuning id — lets a
    // quick capo on EADGBE not leak onto the cello preset.
    function _readTuningAdjustOverrides() {
        let map;
        try { map = JSON.parse(_read('tuningAdjustOverrides') || '{}'); } catch (_) { map = null; }
        return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    }
    function _writeTuningAdjustOverride(tuningId, capo, capoEnabled, octave) {
        if (typeof tuningId !== 'string' || !tuningId) return;
        const map = _readTuningAdjustOverrides();
        map[tuningId] = { capo, capoEnabled, octave };
        _write('tuningAdjustOverrides', JSON.stringify(map));
    }

    // The unsaved "active" tuning the settings editor edits live; overlays every class while it exists.
    function _readActiveTuning() {
        const active = CR.parseActiveTuning(_read('activeTuning'));
        if (!active) return null;
        const gray = active.strings.map(() => CR.intToHex(CR.LIGHT_GRAY_COLOR));
        active.colors = CR.resolveColorsArray(active.colors, active.strings.length, gray);
        return active;
    }
    // true when normalized's remap-relevant fields (everything but display
    // color) match what's already stored — a pure color edit shouldn't pay
    // for a chart-transform refresh, since _transform() never reads color.
    function _onlyColorsChanged(normalized) {
        const prev = _readActiveTuning();
        if (!prev) return false;
        return prev.maxFret === normalized.maxFret
            && prev.capo === normalized.capo
            && prev.capoEnabled === normalized.capoEnabled
            && prev.octaveOffset === normalized.octaveOffset
            && prev.strings.length === normalized.strings.length
            && prev.strings.every((s, i) => s === normalized.strings[i]);
    }
    function _writeActiveTuning(d) {
        const normalized = CR.parseActiveTuning(d);
        if (!normalized) return false;
        const writeFn = _onlyColorsChanged(normalized) ? _writeSilent : _write;
        writeFn('activeTuning', JSON.stringify({
            strings: normalized.strings,
            colors: normalized.colors,
            maxFret: normalized.maxFret,
            capo: normalized.capo,
            capoEnabled: normalized.capoEnabled,
            octaveOffset: normalized.octaveOffset,
        }));
        return true;
    }
    function _clearActiveTuning() {
        if (_read('activeTuning')) _write('activeTuning', '');
    }
    // Startup: an unsaved active tuning left over from a previous session
    // (forgotten edits never saved or reselected away from) would otherwise
    // keep silently overriding every arrangement class's playback forever.
    _clearActiveTuning();

    // Resolves a class's tuning: active-tuning overlay, else the profile with any quick-adjust override applied.
    function _resolveActiveTuning(arrClass) {
        const active = _readActiveTuning();
        if (active) return active;
        const t = CR.resolveActiveTuning(_read(_profileKeyFor(arrClass)), _readCustomTunings(), arrClass);
        const ov = _readTuningAdjustOverrides()[t.id];
        if (ov && typeof ov === 'object') {
            if (CR.isValidCapo(ov.capo, t.maxFret)) t.capo = ov.capo;
            if (typeof ov.capoEnabled === 'boolean') t.capoEnabled = ov.capoEnabled;
            if (CR.isValidOctaveOffset(ov.octave)) t.octaveOffset = ov.octave;
        }
        return t;
    }

    // Bridge for settings.html (dynamic-imports src/chart-retune.js directly; falls back to
    // raw localStorage writes if this script hasn't registered these yet).
    window.cr3dSetActiveTuning = (arrClass, id) => {
        _clearActiveTuning();
        _write(_profileKeyFor(arrClass), String(id || CR.defaultTuningIdForClass(arrClass)));
    };
    window.cr3dWriteActiveTuning = (d) => _writeActiveTuning(d);
    window.cr3dClearActiveTuning = () => _clearActiveTuning();
    window.cr3dSaveCustomTuning = (profile) => {
        if (!profile || typeof profile.name !== 'string' || !profile.name.trim()) return null;
        if (!CR.isValidTuningStringsArray(profile.strings)) return null;
        const n = profile.strings.length;
        const grayDefaults = profile.strings.map(() => CR.intToHex(CR.LIGHT_GRAY_COLOR));
        const colors = CR.resolveColorsArray(profile.colors, n, grayDefaults);
        const maxFret = CR.isValidMaxFret(profile.maxFret) ? profile.maxFret : CR.DEFAULT_MAX_FRET;
        const capo = CR.resolveCapo(profile.capo, maxFret);
        const capoEnabled = CR.resolveCapoEnabled(profile.capoEnabled);
        const octaveOffset = CR.resolveOctaveOffset(profile.octaveOffset);
        const list = _readCustomTunings();
        const id = (typeof profile.id === 'string' && profile.id)
            ? profile.id
            : 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const entry = { id, name: profile.name.trim(), strings: profile.strings.slice(0, n), colors, maxFret, capo, capoEnabled, octaveOffset };
        const idx = list.findIndex(p => p.id === id);
        if (idx >= 0) list[idx] = entry; else list.push(entry);
        _writeCustomTunings(list);
        // A save is deliberate — drop any quick-adjust override so the new defaults apply.
        const overrides = _readTuningAdjustOverrides();
        if (overrides[id]) {
            delete overrides[id];
            _write('tuningAdjustOverrides', JSON.stringify(overrides));
        }
        _clearActiveTuning();
        return id;
    };
    window.cr3dDeleteCustomTuning = (id) => {
        _writeCustomTunings(_readCustomTunings().filter(p => p.id !== id));
        const overrides = _readTuningAdjustOverrides();
        if (overrides[id]) {
            delete overrides[id];
            _write('tuningAdjustOverrides', JSON.stringify(overrides));
        }
        for (const cls of _PROFILE_CLASSES) {
            if (_read(_profileKeyFor(cls)) === id) window.cr3dSetActiveTuning(cls, null);
        }
    };

    // Standard open-string base MIDI by string count — same table as lib/song.py's
    // base_open_string_midis, so a consuming renderer's own base + this plugin's
    // returned tuning offsets/capo reconstruct the right pitch for nut labels.
    const _BASE_OPEN_MIDI = {
        4: [28, 33, 38, 43],
        5: [23, 28, 33, 38, 43],
        6: [40, 45, 50, 55, 59, 64],
        7: [35, 40, 45, 50, 55, 59, 64],
        8: [30, 35, 40, 45, 50, 55, 59, 64],
    };
    function _rendererBaseOpenMidi(n, isBass) {
        const base = (n === 4 || n === 5)
            ? (isBass ? _BASE_OPEN_MIDI[n] : _BASE_OPEN_MIDI[6].slice(0, n))
            : (_BASE_OPEN_MIDI[n] || _BASE_OPEN_MIDI[6]);
        return base.slice();
    }

    // Runs the remap engine over one notes/chords/anchors/templates view. sourceTuning/
    // sourceCapo/sourceStringCount describe the CHART's own tuning (untouched by this
    // plugin); targetMidiTuning/maxFret already fold in this plugin's own capo, if
    // enabled. Frets come back capo-relative, pairing with the `capo` field
    // _transform() returns separately — the same convention every chart already uses.
    function _applyRetune(notes, chords, anchors, chordTemplates, sourceTuning, sourceCapo, sourceStringCount, targetMidiTuning, maxFret) {
        const bundle = {
            notes, chords, anchors: anchors || [], chordTemplates,
            tuning: sourceTuning, capo: sourceCapo, stringCount: sourceStringCount,
        };
        CR.createRetuner().apply(bundle, targetMidiTuning, maxFret);
        return bundle;
    }

    // The chart-transform entry point (feedBack#952) — called after every
    // difficulty-filter rebuild (song ready, mastery move, refresh), never per frame.
    function _transform(input) {
        const songInfo = input.songInfo || {};
        const arrClass = CR.arrangementClassFor(songInfo.arrangement);
        // _transform() can run many times per second while the mastery
        // slider is dragged; _crMountAdjustControls does DOM lookups + a
        // full repaint, so only pay for that when the widget isn't already
        // mounted ('song:ready' and the registration path already cover
        // the "new song" refresh case).
        if (!_crRoot || !_crRoot.isConnected) _crMountAdjustControls();

        const active = _resolveActiveTuning(arrClass);
        const target = CR.resolveTargetTuning(active.strings);
        // This plugin's own target-side capo — separate from whatever capo the
        // chart's source used (that still feeds sourceCapo above).
        const effCapo = active.capoEnabled ? active.capo : 0;
        const remapMidiTuning = (effCapo === 0 && active.octaveOffset === 0)
            ? target.midiTuning
            : CR.effectiveTargetMidiTuning(target.midiTuning, effCapo, active.octaveOffset);
        const maxFret = CR.effectiveMaxFret(active.maxFret, effCapo);

        const filtered = _applyRetune(input.notes, input.chords, input.anchors, input.chordTemplates,
            songInfo.tuning, songInfo.capo, input.stringCount, remapMidiTuning, maxFret);
        const sameSet = input.allNotes === input.notes && input.allChords === input.chords;
        const all = sameSet ? filtered : _applyRetune(input.allNotes, input.allChords, null, input.chordTemplates,
            songInfo.tuning, songInfo.capo, input.stringCount, remapMidiTuning, maxFret);

        // The chart's own native capo (e.g. a guitar recorded with a capo)
        // otherwise bakes silently into every fret number above — decided
        // once from `all` (the fuller of the two views) and forced onto
        // `filtered` too, so both agree with the single `capo` value
        // returned below instead of one view's frets going stale relative
        // to it. See canFoldSourceCapo's own comment for why this can't
        // always apply (a target that needs to reach lower than the
        // source's capo allows keeps today's absolute-fret behavior).
        const sourceCapo = songInfo.capo | 0;
        const foldedSourceCapo = CR.canFoldSourceCapo(all, sourceCapo) ? sourceCapo : 0;
        if (foldedSourceCapo > 0) {
            CR.applySourceCapoFold(filtered, foldedSourceCapo);
            if (all !== filtered) CR.applySourceCapoFold(all, foldedSourceCapo);
        }

        const n = target.midiTuning.length;
        const isBass = /\bbass\b/i.test(songInfo.arrangement || '');
        const base = _rendererBaseOpenMidi(n, isBass);
        const tuningOffsets = target.midiTuning.map((m, i) => m - base[Math.min(i, base.length - 1)]);

        return {
            notes: filtered.notes,
            chords: filtered.chords,
            anchors: filtered.anchors,
            allNotes: all.notes,
            allChords: all.chords,
            chordTemplates: filtered.chordTemplates,
            stringCount: n,
            tuning: tuningOffsets,
            capo: effCapo + foldedSourceCapo,
        };
    }

    /* ── Retuner / Capo controls (player chrome) ──────────────────────────
     * v3's Plugin Controls rail popover (playerControlSlot()), or classic
     * v2's #player-controls. Retuner/Capo are pills (highway_3d's
     * convention for this slot); fret + octave are sliders, since both
     * need to be adjustable mid-song here as well as in Settings. Mounted
     * from song:ready directly (not just _transform()) so the Retuner
     * pill stays reachable even while this plugin isn't the active
     * provider. One shared widget for the whole app: it always reflects
     * window.highway (the primary panel), never a cached value — under
     * splitscreen a secondary panel's own tuning is still configured
     * correctly (each panel resolves its own arrangement class), just not
     * shown in this widget; use Settings for that panel's class.
     */
    let _crRoot = null;
    let _crPills = null; // { retuner, capo }
    let _crEls = null;   // { detailsWrap, fretRow, fretSlider, fretVal, octSlider, octVal }

    // The core "Default arrangement" gameplay setting (an arrangement name,
    // e.g. "Lead" or "Bass 2") — _crCurrentArrClass()'s fallback before any
    // song has loaded, instead of always assuming bass. Fetched once; '' until
    // it resolves, which CR.arrangementClassFor already treats as bass.
    let _crDefaultArrangement = '';
    fetch('/api/settings').then(r => r.json()).then(data => {
        _crDefaultArrangement = (data && typeof data.default_arrangement === 'string') ? data.default_arrangement : '';
        _crAdjRefresh();
    }).catch(() => { /* keep the bass fallback */ });

    function _crCurrentArrClass() {
        const hw = window.highway;
        const arrangement = (hw && typeof hw.getSongInfo === 'function') ? (hw.getSongInfo() || {}).arrangement : undefined;
        return CR.arrangementClassFor(arrangement || _crDefaultArrangement);
    }
    function _crIsActive() {
        const domain = window.feedBack && window.feedBack.chartTransformDomain;
        return !!(domain && domain.snapshot().active === PROVIDER_ID);
    }
    function _crSetActive(on) {
        if (!_capabilitiesReady()) return;
        window.feedBack.capabilities.dispatch({
            capability: 'chart-transform',
            command: on ? 'select-provider' : 'clear-provider',
            source: PROVIDER_ID,
            payload: on ? { providerId: PROVIDER_ID } : undefined,
        });
    }
    function _crProfileName(t) {
        if (t.id === CR.ACTIVE_TUNING_ID) return CR.ACTIVE_TUNING_NAME + ' (unsaved)';
        const preset = CR.BUILTIN_PRESET_TUNINGS.find(p => p.id === t.id);
        if (preset) return preset.label;
        const custom = _readCustomTunings().find(p => p.id === t.id);
        return custom ? custom.name : t.strings.join(' ');
    }

    const _PILL_STYLE = 'padding:.375rem .75rem;border:0;border-radius:.5rem;font-size:.75rem;'
        + 'line-height:1rem;cursor:pointer;transition:background-color .15s,color .15s;';
    const _PILL_COLOR = { idle: '#181830', hover: '#1e1e3a', text: '#d1d5db', textDim: '#6b7280', onBg: 'rgba(20,83,45,0.5)', onText: '#86efac' };
    function _crPill(label) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = _PILL_STYLE;
        b.addEventListener('mouseenter', () => { if (!b._on) b.style.backgroundColor = _PILL_COLOR.hover; });
        b.addEventListener('mouseleave', () => { if (!b._on) b.style.backgroundColor = _PILL_COLOR.idle; });
        return b;
    }
    function _crPaintPill(btn, on, disabled, title) {
        btn._on = !!on && !disabled;
        btn.disabled = !!disabled;
        btn.style.pointerEvents = disabled ? 'none' : '';
        btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
        btn.style.opacity = disabled ? '.45' : '1';
        btn.title = title;
        btn.setAttribute('aria-pressed', btn._on ? 'true' : 'false');
        btn.style.backgroundColor = disabled ? _PILL_COLOR.idle : (btn._on ? _PILL_COLOR.onBg : _PILL_COLOR.idle);
        btn.style.color = disabled ? _PILL_COLOR.textDim : (btn._on ? _PILL_COLOR.onText : _PILL_COLOR.text);
    }

    function _crAdjRefresh() {
        if (!_crPills) return;
        const active = _crIsActive();
        _crPaintPill(_crPills.retuner, active, false,
            active ? 'Retuning active — click to play the original tuning.' : 'Off — click to retune this chart.');
        _crEls.detailsWrap.style.display = active ? '' : 'none';
        if (!active) return;
        const t = _resolveActiveTuning(_crCurrentArrClass());
        _crPaintPill(_crPills.capo, t.capoEnabled, false,
            (t.capoEnabled ? 'Capo fret ' + t.capo : 'Off') + ' on ' + _crProfileName(t) + ' — click to toggle.');
        _crEls.fretRow.style.display = t.capoEnabled ? '' : 'none';
        _crEls.fretSlider.max = String(t.maxFret - 1);
        _crEls.fretSlider.value = String(t.capo);
        _crEls.fretVal.textContent = String(t.capo);
        _crEls.octSlider.value = String(t.octaveOffset);
        _crEls.octVal.textContent = (t.octaveOffset > 0 ? '+' : '') + t.octaveOffset;
    }
    function _crToggleCapo() {
        const t = _resolveActiveTuning(_crCurrentArrClass());
        const capoEnabled = !t.capoEnabled;
        if (t.id === CR.ACTIVE_TUNING_ID) {
            _writeActiveTuning({ strings: t.strings, colors: t.colors, maxFret: t.maxFret, capo: t.capo, capoEnabled, octaveOffset: t.octaveOffset });
            return;
        }
        _writeTuningAdjustOverride(t.id, t.capo, capoEnabled, t.octaveOffset);
    }
    function _crAdjCommit() {
        const t = _resolveActiveTuning(_crCurrentArrClass());
        const capo = Math.max(0, Math.min(t.maxFret - 1, parseInt(_crEls.fretSlider.value, 10) || 0));
        const oct = Math.max(CR.MIN_OCTAVE_OFFSET, Math.min(CR.MAX_OCTAVE_OFFSET, parseInt(_crEls.octSlider.value, 10) || 0));
        if (t.id === CR.ACTIVE_TUNING_ID) {
            _writeActiveTuning({ strings: t.strings, colors: t.colors, maxFret: t.maxFret, capo, capoEnabled: t.capoEnabled, octaveOffset: oct });
            return;
        }
        _writeTuningAdjustOverride(t.id, capo, t.capoEnabled, oct);
    }
    function _crBuildControls() {
        const root = document.createElement('div');
        root.id = 'cr3d-adjust-controls';
        root.style.cssText = 'display:flex;gap:6px 10px;align-items:center;flex-wrap:wrap;';
        const retuner = _crPill('Retuner');
        root.appendChild(retuner);

        // Everything below is moot while Retuner is off.
        const detailsWrap = document.createElement('div');
        detailsWrap.style.cssText = 'display:flex;gap:6px 10px;align-items:center;flex-wrap:wrap;';
        root.appendChild(detailsWrap);
        const capo = _crPill('Capo');
        detailsWrap.appendChild(capo);

        function row(labelText, min, max, title) {
            const wrap = document.createElement('label');
            wrap.style.cssText = 'display:flex;align-items:center;gap:6px;white-space:nowrap;cursor:pointer;font-size:.75rem;color:' + _PILL_COLOR.text + ';';
            wrap.title = title;
            const text = document.createElement('span');
            text.textContent = labelText;
            text.style.marginRight = '4px';
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = String(min);
            slider.max = String(max);
            slider.step = '1';
            slider.style.cssText = 'width:100px;';
            const val = document.createElement('span');
            val.style.cssText = 'min-width:2em;text-align:right;font-variant-numeric:tabular-nums;';
            wrap.appendChild(text);
            wrap.appendChild(slider);
            wrap.appendChild(val);
            detailsWrap.appendChild(wrap);
            return { wrap, slider, val };
        }
        const fret = row('Fret', 0, CR.DEFAULT_MAX_FRET - 1, 'Capo fret — applies live, persists per tuning.');
        const oct = row('Octave', CR.MIN_OCTAVE_OFFSET, CR.MAX_OCTAVE_OFFSET, 'Shift the chart up/down whole octaves — applies live, persists per tuning.');

        retuner.addEventListener('click', () => _crSetActive(!retuner._on));
        capo.addEventListener('click', _crToggleCapo);
        fret.slider.addEventListener('input', _crAdjCommit);
        oct.slider.addEventListener('input', _crAdjCommit);

        _crRoot = root;
        _crPills = { retuner, capo };
        _crEls = { detailsWrap, fretRow: fret.wrap, fretSlider: fret.slider, fretVal: fret.val, octSlider: oct.slider, octVal: oct.val };
    }
    function _crMountAdjustControls() {
        if (typeof document === 'undefined') return;
        const fb = window.feedBack;
        // v3: mount into the stable plugin slot (#player-controls's legacy
        // anchors are gone and the v3 transport auto-hides). v2: classic bar.
        const isV3 = !!(fb && fb.uiVersion === 'v3');
        const slot = (isV3 && fb.ui && typeof fb.ui.playerControlSlot === 'function')
            ? fb.ui.playerControlSlot()
            : document.getElementById('player-controls');
        if (!slot) return;
        // A stale copy from a previous script execution (core re-registers
        // this plugin's transform on rehydration, but the old closure's DOM
        // node never got removed) is a different element than our own
        // _crRoot — drop it so clicks always land on the live instance.
        const stale = document.getElementById('cr3d-adjust-controls');
        if (stale && stale !== _crRoot) stale.remove();
        if (_crRoot && slot.contains(_crRoot)) { _crAdjRefresh(); return; }
        if (!_crRoot) _crBuildControls();
        slot.appendChild(_crRoot);
        _crAdjRefresh();
    }
    if (window.feedBack && typeof window.feedBack.on === 'function') {
        window.feedBack.on('song:ready', _crMountAdjustControls);
        // Keeps both this widget and settings.html's toggle in sync regardless of which changed it.
        window.feedBack.on('chart-transform:transform-changed', _crAdjRefresh);
    }
    const _refreshListeners = [_crAdjRefresh];

    /* ── chart-transform capability registration ─────────────────────── */
    function _capabilitiesReady() {
        return !!(window.feedBack && window.feedBack.capabilities && window.feedBack.capabilities.version === 1);
    }
    function _refresh() {
        for (const fn of _refreshListeners) { try { fn(); } catch (e) { console.error('[Chart Retuner] refresh listener threw', e); } }
        if (!_capabilitiesReady()) return;
        window.feedBack.capabilities.dispatch({ capability: 'chart-transform', command: 'refresh', source: PROVIDER_ID });
    }
    function _registerAndAutoSelect() {
        const api = window.feedBack.capabilities;
        Promise.resolve(api.dispatch({
            capability: 'chart-transform',
            command: 'register-provider',
            source: PROVIDER_ID,
            payload: { providerId: PROVIDER_ID, label: 'Chart Retuner', transform: _transform },
        })).then(() => {
            // An already-active provider gets a guaranteed mount via
            // _setActive -> _install -> _restageChartTransform -> _transform()
            // above. An inactive one has no such trigger, and 'song:ready' is
            // a no-op if it already fired before this script finished
            // registering (e.g. reload mid-song) — mount here too so the
            // in-song Retuner toggle stays reachable.
            _crMountAdjustControls();
            // Auto-activate only the first time this plugin ever registers — an
            // absent key means either "never chosen" or "explicitly cleared", and
            // this flag is what tells the two apart on later loads.
            if (_read('autoSelected') != null) return;
            _write('autoSelected', '1');
            api.dispatch({
                capability: 'chart-transform', command: 'select-provider',
                source: PROVIDER_ID, payload: { providerId: PROVIDER_ID },
            });
        });
    }
    if (_capabilitiesReady()) _registerAndAutoSelect();
    else window.addEventListener('feedBack:capabilities:ready', _registerAndAutoSelect, { once: true });
})();
