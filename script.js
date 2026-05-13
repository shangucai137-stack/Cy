/* ============================================================
   Image Sonification — script.js
   Maps image pixels → musical notes via Web Audio API (Tone.js)
   ============================================================ */

// ─── Musical scales (semitone offsets from C) ───────────────
const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  chromatic:  [0,1,2,3,4,5,6,7,8,9,10,11],
  blues:      [0, 3, 5, 6, 7, 10],
};

// MIDI note number → note name
function midiToName(midi) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[midi % 12] + Math.floor(midi / 12 - 1);
}

// Map a value [0..1] to a scale note in range [octaveMin..octaveMax]
function valueToNote(v, scaleName, octaveMin = 3, octaveMax = 6) {
  const scale = SCALES[scaleName];
  const totalNotes = scale.length * (octaveMax - octaveMin + 1);
  const idx = Math.round(v * (totalNotes - 1));
  const octave = octaveMin + Math.floor(idx / scale.length);
  const semitone = scale[idx % scale.length];
  const midi = (octave + 1) * 12 + semitone; // C4 = MIDI 60
  return { name: midiToName(midi), midi };
}

// ─── Synth factory ──────────────────────────────────────────
function createSynth(type) {
  switch (type) {
    case 'piano':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.5, sustain: 0.1, release: 1.2 },
      }).toDestination();

    case 'synth':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.05, decay: 0.2, sustain: 0.4, release: 0.8 },
      }).toDestination();

    case 'marimba':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.0, release: 0.4 },
      }).toDestination();

    case 'pad':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.4, decay: 0.3, sustain: 0.7, release: 2.0 },
      }).toDestination();

    default:
      return new Tone.PolySynth(Tone.Synth).toDestination();
  }
}

// ─── DOM references ─────────────────────────────────────────
const uploadZone   = document.getElementById('upload-zone');
const fileInput    = document.getElementById('file-input');
const workspace    = document.getElementById('workspace');
const mainCanvas   = document.getElementById('main-canvas');
const overlayCanvas= document.getElementById('overlay-canvas');
const vizCanvas    = document.getElementById('viz-canvas');
const scanLine     = document.getElementById('scan-line');
const playBtn      = document.getElementById('play-btn');
const stopBtn      = document.getElementById('stop-btn');
const changeBtn    = document.getElementById('change-btn');
const speedSlider  = document.getElementById('speed-slider');
const volumeSlider = document.getElementById('volume-slider');
const scaleSelect  = document.getElementById('scale-select');
const synthSelect  = document.getElementById('synth-select');
const speedVal     = document.getElementById('speed-val');
const volumeVal    = document.getElementById('volume-val');
const infoTime     = document.getElementById('info-time');
const infoPos      = document.getElementById('info-pos');
const infoNote     = document.getElementById('info-note');

const ctx          = mainCanvas.getContext('2d', { willReadFrequently: true });
const octx         = overlayCanvas.getContext('2d');
const vctx         = vizCanvas.getContext('2d');

// ─── State ──────────────────────────────────────────────────
let imgData      = null;   // ImageData
let imgW = 0, imgH = 0;
let isPlaying    = false;
let currentCol   = 0;
let synth        = null;
let analyser     = null;
let animFrame    = null;
let stepInterval = null;
let startTime    = 0;
let elapsedMs    = 0;

const SAMPLE_ROWS = 16;
const NOTE_DURATION = '8n';

// ─── Upload handling ─────────────────────────────────────────
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadImageFile(fileInput.files[0]);
});

document.querySelectorAll('.sample-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const type = btn.dataset.src;
    loadSampleImage(type);
  });
});

function loadSampleImage(type) {
  const canvas = document.createElement('canvas');
  canvas.width = 400; canvas.height = 200;
  const c = canvas.getContext('2d');

  if (type === 'sample-gradient.png') {
    const g = c.createLinearGradient(0, 0, 400, 200);
    g.addColorStop(0, '#7c3aed');
    g.addColorStop(0.33, '#06b6d4');
    g.addColorStop(0.66, '#f59e0b');
    g.addColorStop(1, '#ef4444');
    c.fillStyle = g;
    c.fillRect(0, 0, 400, 200);
    for (let i = 0; i < 3000; i++) {
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.3})`;
      c.fillRect(Math.random()*400, Math.random()*200, 2, 2);
    }
  } else if (type === 'sample-sunset.png') {
    const sky = c.createLinearGradient(0, 0, 0, 200);
    sky.addColorStop(0, '#1a0533');
    sky.addColorStop(0.4, '#c2410c');
    sky.addColorStop(0.7, '#f59e0b');
    sky.addColorStop(1, '#fbbf24');
    c.fillStyle = sky;
    c.fillRect(0, 0, 400, 200);
    const radial = c.createRadialGradient(200, 160, 0, 200, 160, 60);
    radial.addColorStop(0, 'rgba(255,255,200,0.9)');
    radial.addColorStop(1, 'rgba(255,150,0,0)');
    c.fillStyle = radial;
    c.fillRect(0, 0, 400, 200);
    const hor = c.createLinearGradient(0, 140, 0, 200);
    hor.addColorStop(0, 'rgba(251,191,36,0.5)');
    hor.addColorStop(1, 'rgba(120,53,15,0.8)');
    c.fillStyle = hor;
    c.fillRect(0, 140, 400, 60);
  } else if (type === 'sample-ocean.png') {
    const ocean = c.createLinearGradient(0, 0, 400, 200);
    ocean.addColorStop(0, '#0c4a6e');
    ocean.addColorStop(0.5, '#0369a1');
    ocean.addColorStop(1, '#06b6d4');
    c.fillStyle = ocean;
    c.fillRect(0, 0, 400, 200);
    c.strokeStyle = 'rgba(255,255,255,0.3)';
    c.lineWidth = 2;
    for (let y = 20; y < 200; y += 25) {
      c.beginPath();
      for (let x = 0; x <= 400; x += 10) {
        const wy = y + Math.sin((x + y * 3) * 0.05) * 8;
        x === 0 ? c.moveTo(x, wy) : c.lineTo(x, wy);
      }
      c.stroke();
    }
  }

  canvas.toBlob(blob => loadImageFile(blob));
}

function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const maxW = 800, maxH = 420;
    let w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(maxW / w, maxH / h, 1);
    w = Math.round(w * scale);
    h = Math.round(h * scale);

    mainCanvas.width  = w;
    mainCanvas.height = h;
    overlayCanvas.width  = w;
    overlayCanvas.height = h;
    vizCanvas.width  = vizCanvas.offsetWidth || 800;
    vizCanvas.height = 80;

    ctx.drawImage(img, 0, 0, w, h);
    imgData = ctx.getImageData(0, 0, w, h);
    imgW = w; imgH = h;

    URL.revokeObjectURL(url);
    showWorkspace();
  };
  img.src = url;
}

function showWorkspace() {
  uploadZone.classList.add('hidden');
  workspace.classList.remove('hidden');
  resetPlayback();
}

// ─── Audio setup ─────────────────────────────────────────────
async function ensureAudio() {
  await Tone.start();
  if (synth) { synth.dispose(); synth = null; }

  synth = createSynth(synthSelect.value);
  synth.volume.value = Tone.gainToDb(parseInt(volumeSlider.value) / 100);

  analyser = new Tone.Analyser('waveform', 256);
  synth.connect(analyser);
}

// ─── Playback control ────────────────────────────────────────
playBtn.addEventListener('click', async () => {
  if (!imgData) return;
  if (isPlaying) {
    pausePlayback();
  } else {
    await startPlayback();
  }
});

stopBtn.addEventListener('click', () => {
  stopPlayback();
});

changeBtn.addEventListener('click', () => {
  stopPlayback();
  workspace.classList.add('hidden');
  uploadZone.classList.remove('hidden');
  fileInput.value = '';
});

async function startPlayback() {
  await ensureAudio();
  isPlaying = true;
  playBtn.innerHTML = '<span class="play-icon">⏸</span> 暂停';
  scanLine.classList.add('active');
  startTime = performance.now() - elapsedMs;
  scheduleStep();
  drawVisualizer();
}

function pausePlayback() {
  isPlaying = false;
  elapsedMs = performance.now() - startTime;
  playBtn.innerHTML = '<span class="play-icon">▶</span> 播放';
  clearTimeout(stepInterval);
  cancelAnimationFrame(animFrame);
  if (synth) synth.releaseAll();
}

function stopPlayback() {
  isPlaying = false;
  elapsedMs = 0;
  currentCol = 0;
  playBtn.innerHTML = '<span class="play-icon">▶</span> 播放';
  clearTimeout(stepInterval);
  cancelAnimationFrame(animFrame);
  if (synth) { synth.releaseAll(); synth.dispose(); synth = null; }
  scanLine.style.transform = 'translateX(-10px)';
  scanLine.classList.remove('active');
  clearOverlay();
  resetInfoBar();
}

function resetPlayback() {
  stopPlayback();
}

// ─── Pixel → music step ──────────────────────────────────────
function scheduleStep() {
  if (!isPlaying) return;
  processColumn(currentCol);
  currentCol++;
  if (currentCol >= imgW) {
    currentCol = 0;
    elapsedMs = 0;
    startTime = performance.now();
  }
  const msPerStep = getStepMs();
  stepInterval = setTimeout(scheduleStep, msPerStep);
}

function getStepMs() {
  const speed = parseInt(speedSlider.value);
  return Math.round(300 / speed);
}

function processColumn(col) {
  if (!imgData) return;
  const data = imgData.data;
  const scaleName = scaleSelect.value;

  const step = Math.max(1, Math.floor(imgH / SAMPLE_ROWS));
  const notes = [];
  const volumes = [];

  for (let row = 0; row < imgH; row += step) {
    const i = (row * imgW + col) * 4;
    const r = data[i], g = data[i+1], b = data[i+2];

    const { h, s, l } = rgbToHsl(r, g, b);

    const brightness = l;
    if (brightness < 0.12) continue;

    const pitchRatio = 1 - (row / imgH);
    const note = valueToNote(pitchRatio, scaleName, 3, 6);

    const vel = 0.2 + brightness * 0.8;

    notes.push(note);
    volumes.push(vel);
  }

  const seen = new Set();
  const uniqueNotes = [];
  for (let i = 0; i < notes.length; i++) {
    if (!seen.has(notes[i].name)) {
      seen.add(notes[i].name);
      uniqueNotes.push({ note: notes[i], vol: volumes[i] });
    }
  }

  if (uniqueNotes.length === 0) return;

  uniqueNotes.sort((a, b) => b.vol - a.vol);
  const chord = uniqueNotes.slice(0, 4);

  const duration = getStepMs() / 1000 * 1.2;
  chord.forEach(({ note, vol }) => {
    try {
      synth.triggerAttackRelease(note.name, duration, Tone.now(), vol);
    } catch {}
  });

  updateScanLine(col);
  updateColumnOverlay(col, chord);
  updateInfoBar(col, chord[0]?.note?.name);
}

// ─── UI updates ──────────────────────────────────────────────
function updateScanLine(col) {
  const wrapper = document.querySelector('.canvas-wrapper');
  const wW = wrapper.offsetWidth;
  const cW = mainCanvas.offsetWidth;
  const offsetX = (wW - cW) / 2;
  const x = offsetX + (col / imgW) * cW;
  scanLine.style.transform = `translateX(${x}px)`;
}

function updateColumnOverlay(col, chord) {
  octx.clearRect(0, 0, imgW, imgH);
  const x = col;

  octx.fillStyle = 'rgba(255,255,255,0.15)';
  octx.fillRect(x, 0, 1, imgH);

  chord.forEach(({ note, vol }) => {
    const pitch = (note.midi - 36) / 48;
    const y = (1 - pitch) * imgH;
    octx.beginPath();
    octx.arc(x, y, 4, 0, Math.PI * 2);
    octx.fillStyle = `rgba(124,58,237,${vol})`;
    octx.fill();
    octx.strokeStyle = 'rgba(255,255,255,0.8)';
    octx.lineWidth = 1;
    octx.stroke();
  });
}

function clearOverlay() {
  if (octx) octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function updateInfoBar(col, noteName) {
  const ms = performance.now() - startTime;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  infoTime.textContent = `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  infoPos.textContent  = `列 ${col + 1} / ${imgW}`;
  infoNote.textContent = noteName || '--';
}

function resetInfoBar() {
  infoTime.textContent = '00:00';
  infoPos.textContent  = '列 0 / 0';
  infoNote.textContent = '--';
}

// ─── Waveform visualizer ─────────────────────────────────────
function drawVisualizer() {
  if (!isPlaying) return;
  animFrame = requestAnimationFrame(drawVisualizer);

  vizCanvas.width = vizCanvas.offsetWidth;
  const W = vizCanvas.width, H = vizCanvas.height;
  vctx.clearRect(0, 0, W, H);

  if (!analyser) return;
  const wave = analyser.getValue();

  vctx.fillStyle = 'rgba(0,0,0,0.3)';
  vctx.fillRect(0, 0, W, H);

  const grad = vctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#7c3aed');
  grad.addColorStop(0.5, '#06b6d4');
  grad.addColorStop(1, '#f59e0b');
  vctx.strokeStyle = grad;
  vctx.lineWidth = 2;
  vctx.beginPath();
  for (let i = 0; i < wave.length; i++) {
    const x = (i / wave.length) * W;
    const y = ((wave[i] + 1) / 2) * H;
    i === 0 ? vctx.moveTo(x, y) : vctx.lineTo(x, y);
  }
  vctx.stroke();

  vctx.globalAlpha = 0.3;
  vctx.beginPath();
  for (let i = 0; i < wave.length; i++) {
    const x = (i / wave.length) * W;
    const y = H - ((wave[i] + 1) / 2) * H;
    i === 0 ? vctx.moveTo(x, y) : vctx.lineTo(x, y);
  }
  vctx.stroke();
  vctx.globalAlpha = 1;
}

// ─── Control event listeners ─────────────────────────────────
speedSlider.addEventListener('input', () => {
  speedVal.textContent = speedSlider.value;
});

volumeSlider.addEventListener('input', () => {
  volumeVal.textContent = volumeSlider.value + '%';
  if (synth) {
    synth.volume.value = Tone.gainToDb(parseInt(volumeSlider.value) / 100);
  }
});

scaleSelect.addEventListener('change', () => {
  currentCol = 0;
});

synthSelect.addEventListener('change', async () => {
  if (isPlaying) {
    const wasPlaying = isPlaying;
    pausePlayback();
    await ensureAudio();
    if (wasPlaying) await startPlayback();
  }
});

window.addEventListener('resize', () => {
  vizCanvas.width = vizCanvas.offsetWidth;
  if (isPlaying) updateScanLine(currentCol);
});

// ─── Color utilities ─────────────────────────────────────────
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h, s, l };
}