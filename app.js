
const video = document.getElementById('video-feed');
const term = document.getElementById('term-out');
let canvas, ctx, meshActive = false, modelsReady = false, faceMatcher = null;
let lastMatchName = null;
const STORAGE_KEY = 'darkfox_known_faces_v1';
const COOKIE_KEY = 'darkfox_faces';

let enrollActive = false;
let enrollName = '';
let enrollStep = 0;
let enrollSamples = [];
let stepHoldFrames = 0;
const HOLD_NEEDED = 12;
const STEPS = [
    { id: 'center',  title: 'SCHRITT 1/5', text: 'Gesicht in den Kreis halten', hint: 'Kopf gerade · Blick in die Kamera', arrow: null,   check: checkCenter },
    { id: 'front',   title: 'SCHRITT 2/5', text: 'Geradeaus schauen',           hint: 'Augen auf die Kamera richten',     arrow: null,   check: checkFront },
    { id: 'left',    title: 'SCHRITT 3/5', text: 'Kopf nach links drehen',      hint: 'Langsam nach links (dein links)', arrow: 'left', check: checkLeft },
    { id: 'right',   title: 'SCHRITT 4/5', text: 'Kopf nach rechts drehen',     hint: 'Langsam nach rechts',             arrow: 'right',check: checkRight },
    { id: 'up',      title: 'SCHRITT 5/5', text: 'Leicht nach oben schauen',    hint: 'Kinn etwas anheben',              arrow: 'up',   check: checkUp }
];

function log(msg) {
    const div = document.createElement('div');
    div.innerHTML = `<span class="term-ts">[${new Date().toLocaleTimeString()}]</span> > ${msg}`;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
    while (term.children.length > 80) term.removeChild(term.firstChild);
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function loadKnownFaces() {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch(e) {}
    try {
        const c = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE_KEY + '='));
        if (c) return JSON.parse(decodeURIComponent(c.split('=').slice(1).join('=')));
    } catch(e) {}
    return {};
}
function saveKnownFaces(db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    try {
        const compact = {};
        Object.keys(db).forEach(name => {
            compact[name] = { descriptors: (db[name].descriptors || []).slice(0, 4), lastSeen: db[name].lastSeen || null };
        });
        document.cookie = COOKIE_KEY + '=' + encodeURIComponent(JSON.stringify(compact)) + ';path=/;max-age=31536000;SameSite=Lax';
    } catch(e) {}
}
function rebuildMatcher() {
    const db = loadKnownFaces();
    const labeled = [];
    Object.keys(db).forEach(name => {
        const descs = (db[name].descriptors || []).map(a => new Float32Array(a));
        if (descs.length) labeled.push(new faceapi.LabeledFaceDescriptors(name, descs));
    });
    faceMatcher = labeled.length ? new faceapi.FaceMatcher(labeled, 0.48) : null;
    return Object.keys(db).length;
}
function formatAway(ms) {
    if (ms == null || isNaN(ms)) return 'nie gesehen';
    const s = Math.floor(ms / 1000);
    if (s < 5) return 'gerade eben';
    if (s < 60) return s + 's her';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm her';
    const h = Math.floor(m / 60);
    if (h < 48) return h + 'h her';
    return Math.floor(h / 24) + 'd her';
}

function toggleMesh() {
    meshActive = !meshActive;
    const b = document.getElementById('btn-mesh');
    b.innerText = meshActive ? '3D MESH: AN' : '3D MESH: AUS';
    b.classList.toggle('active', meshActive);
    log('3D Mesh ' + (meshActive ? 'AN' : 'AUS'));
}
function drawMesh(ctx, pts) {
    ctx.strokeStyle = 'rgba(0,255,102,0.55)';
    ctx.fillStyle = '#00ff66';
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    const chain = (idx, close) => {
        if (!idx.length) return;
        ctx.beginPath();
        ctx.moveTo(pts[idx[0]].x, pts[idx[0]].y);
        for (let i = 1; i < idx.length; i++) ctx.lineTo(pts[idx[i]].x, pts[idx[i]].y);
        if (close) ctx.closePath();
        ctx.stroke();
    };
    chain([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], false);
    chain([17,18,19,20,21], false);
    chain([22,23,24,25,26], false);
    chain([27,28,29,30], false);
    chain([31,32,33,34,35], false);
    chain([36,37,38,39,40,41], true);
    chain([42,43,44,45,46,47], true);
    chain([48,49,50,51,52,53,54,55,56,57,58,59], true);
    chain([60,61,62,63,64,65,66,67], true);
    chain([0,36], false); chain([16,45], false); chain([30,8], false);
    pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 1.3, 0, Math.PI*2); ctx.fill(); });
}

function getYaw(pts) {
    const nose = pts[30];
    const left = pts[36];
    const right = pts[45];
    const midX = (left.x + right.x) / 2;
    const eyeDist = Math.abs(right.x - left.x) || 1;
    return (nose.x - midX) / eyeDist;
}
function getPitch(pts) {
    const nose = pts[30];
    const brow = pts[27];
    const faceH = Math.abs(pts[8].y - brow.y) || 1;
    const eyeY = (pts[37].y + pts[44].y) / 2;
    return (nose.y - eyeY) / faceH;
}
function faceInOval(box, vw, vh) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const ox = vw / 2, oy = vh / 2;
    const ow = vw * 0.29, oh = vh * 0.36;
    const nx = (cx - ox) / ow;
    const ny = (cy - oy) / oh;
    const inside = (nx * nx + ny * ny) < 1.15;
    const sizeOk = box.width > vw * 0.22 && box.width < vw * 0.55;
    return inside && sizeOk;
}
function checkCenter(det, dims) {
    return faceInOval(det.detection.box, dims.width, dims.height);
}
function checkFront(det, dims) {
    if (!faceInOval(det.detection.box, dims.width, dims.height)) return false;
    const yaw = getYaw(det.landmarks.positions);
    const pitch = getPitch(det.landmarks.positions);
    return Math.abs(yaw) < 0.12 && pitch > 0.05 && pitch < 0.45;
}
function checkLeft(det, dims) {
    const yaw = getYaw(det.landmarks.positions);
    return yaw > 0.18 && yaw < 0.55;
}
function checkRight(det, dims) {
    const yaw = getYaw(det.landmarks.positions);
    return yaw < -0.18 && yaw > -0.55;
}
function checkUp(det, dims) {
    if (!faceInOval(det.detection.box, dims.width, dims.height)) return false;
    const pitch = getPitch(det.landmarks.positions);
    return pitch < 0.12 && pitch > -0.05;
}

function startEnrollFlow() {
    if (!modelsReady) { log('Zuerst AI CORE starten'); return; }
    document.getElementById('enroll-name').value = '';
    openModal('modal-name');
}
function beginGuidedScan() {
    const name = (document.getElementById('enroll-name').value || '').trim();
    if (!name) { alert('Bitte einen Namen eingeben'); return; }
    enrollName = name;
    enrollStep = 0;
    enrollSamples = [];
    stepHoldFrames = 0;
    enrollActive = true;
    closeModal('modal-name');
    showGuideUI(true);
    updateGuideUI();
    log('SCAN gestartet für: ' + enrollName);
}
function cancelEnroll() {
    enrollActive = false;
    showGuideUI(false);
    log('Scan abgebrochen');
}
function showGuideUI(on) {
    document.getElementById('guide-layer').style.display = on ? 'flex' : 'none';
    document.getElementById('progress-wrap').classList.toggle('show', on);
    document.getElementById('cancel-scan').classList.toggle('show', on);
    document.getElementById('mode-display').style.display = on ? 'none' : 'block';
    document.getElementById('target-count').style.display = on ? 'none' : 'block';
}
function updateGuideUI() {
    const step = STEPS[enrollStep];
    document.getElementById('guide-step').textContent = step.title;
    document.getElementById('guide-text').textContent = step.text;
    document.getElementById('guide-hint').textContent = step.hint;
    document.getElementById('progress-fill').style.width = ((enrollStep / STEPS.length) * 100) + '%';
    document.getElementById('progress-label').textContent = 'Schritt ' + enrollStep + '/' + STEPS.length;
    ['arrow-left','arrow-right','arrow-up'].forEach(id => document.getElementById(id).classList.remove('show'));
    if (step.arrow === 'left') document.getElementById('arrow-left').classList.add('show');
    if (step.arrow === 'right') document.getElementById('arrow-right').classList.add('show');
    if (step.arrow === 'up') document.getElementById('arrow-up').classList.add('show');
    const dots = document.getElementById('step-dots');
    dots.innerHTML = STEPS.map((_, i) => {
        let cls = 'step-dot';
        if (i < enrollStep) cls += ' done';
        if (i === enrollStep) cls += ' current';
        return `<div class="${cls}"></div>`;
    }).join('');
    document.getElementById('face-oval').className = 'face-oval scan';
    document.getElementById('scan-line').classList.add('active');
}
async function captureSample(descriptor) {
    enrollSamples.push(Array.from(descriptor));
    stepHoldFrames = 0;
    enrollStep++;
    log('Sample ' + enrollSamples.length + ' erfasst (' + STEPS[enrollStep - 1].id + ')');
    if (enrollStep >= STEPS.length) finishEnroll();
    else updateGuideUI();
}
function finishEnroll() {
    enrollActive = false;
    showGuideUI(false);
    document.getElementById('progress-fill').style.width = '100%';
    const db = loadKnownFaces();
    if (!db[enrollName]) db[enrollName] = { descriptors: [], lastSeen: Date.now() };
    db[enrollName].descriptors = db[enrollName].descriptors.concat(enrollSamples);
    if (db[enrollName].descriptors.length > 12) db[enrollName].descriptors = db[enrollName].descriptors.slice(-12);
    db[enrollName].lastSeen = Date.now();
    saveKnownFaces(db);
    rebuildMatcher();
    log('FERTIG: "' + enrollName + '" mit ' + enrollSamples.length + ' Winkeln gespeichert');
    document.getElementById('mode-display').style.display = 'block';
    document.getElementById('mode-display').innerText = 'SCAN OK: ' + enrollName;
    setTimeout(() => { document.getElementById('mode-display').innerText = 'CORE: LIVE'; }, 2500);
}

function openRoster() {
    const list = document.getElementById('roster-list');
    const db = loadKnownFaces();
    const names = Object.keys(db).sort();
    if (!names.length) {
        list.innerHTML = '<div style="color:#667788;font-size:12px;">Noch keine Gesichter. Tippe auf GESICHT SCANNEN.</div>';
    } else {
        list.innerHTML = names.map(n => {
            const away = formatAway(Date.now() - (db[n].lastSeen || 0));
            const samples = (db[n].descriptors || []).length;
            const safe = n.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `<div class="roster-item"><div><strong style="color:#e2f8ff">${n}</strong><br><span style="color:#667788;font-size:10px">${samples} Samples · zuletzt: ${away}</span></div><button onclick="deleteFace('${safe}')">LÖSCHEN</button></div>`;
        }).join('');
    }
    openModal('modal-roster');
}
function deleteFace(name) {
    const db = loadKnownFaces();
    delete db[name];
    saveKnownFaces(db);
    rebuildMatcher();
    log('Entfernt: ' + name);
    openRoster();
}
function clearAllFaces() {
    if (!confirm('Alle trainierten Gesichter löschen?')) return;
    saveKnownFaces({});
    faceMatcher = null;
    log('Roster geleert');
    openRoster();
}
async function loadLogs() {
    openModal('modal-log');
    try {
        const res = await fetch('update-log.txt');
        document.getElementById('log-content').innerText = res.ok ? await res.text() : "update-log.txt nicht gefunden.";
    } catch(e) {
        document.getElementById('log-content').innerText = 'Verbindung zum Log fehlgeschlagen.';
    }
}

async function loadModels() {
    const candidates = [
        './weights/', 'weights/',
        'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/',
        'https://justadudewhohacks.github.io/face-api.js/models/'
    ];
    let lastErr = null;
    for (const PATH of candidates) {
        try {
            log('Modelle laden: ' + PATH);
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(PATH),
                faceapi.nets.faceLandmark68Net.loadFromUri(PATH),
                faceapi.nets.faceRecognitionNet.loadFromUri(PATH),
                faceapi.nets.faceExpressionNet.loadFromUri(PATH),
                faceapi.nets.ageGenderNet.loadFromUri(PATH)
            ]);
            log('Modelle OK: ' + PATH);
            return true;
        } catch(e) { lastErr = e; log('Pfad fehlgeschlagen: ' + PATH); }
    }
    throw lastErr || new Error('Alle Modell-Pfade fehlgeschlagen');
}
async function initAI() {
    const btn = document.getElementById('boot-btn');
    btn.innerText = 'STARTE...';
    btn.disabled = true;
    try {
        await loadModels();
        modelsReady = true;
        const count = rebuildMatcher();
        log('Matcher bereit · bekannte Personen: ' + count);
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        video.srcObject = stream;
    } catch(e) {
        log('BOOT FEHLER: ' + (e.message || e));
        btn.innerText = 'NOCHMAL VERSUCHEN';
        btn.disabled = false;
    }
}

video.onplay = () => {
    document.getElementById('boot-screen').style.opacity = '0';
    setTimeout(() => { document.getElementById('boot-screen').style.display = 'none'; }, 700);
    document.getElementById('mode-display').innerText = 'CORE: LIVE';
    canvas = faceapi.createCanvasFromMedia(video);
    document.getElementById('cam-wrapper').append(canvas);
    ctx = canvas.getContext('2d');
    log('Kamera online');

    const loop = async () => {
        try {
            const dims = { width: video.offsetWidth, height: video.offsetHeight };
            if (!dims.width || !dims.height) { requestAnimationFrame(loop); return; }
            if (canvas.width !== dims.width || canvas.height !== dims.height) faceapi.matchDimensions(canvas, dims);

            const detections = await faceapi
                .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 }))
                .withFaceLandmarks()
                .withFaceDescriptors()
                .withFaceExpressions()
                .withAgeAndGender();

            const scaled = faceapi.resizeResults(detections, dims);
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            let primaryName = '--', primaryAway = '--', primaryGender = '--', primaryEmotion = '--';
            const oval = document.getElementById('face-oval');

            if (enrollActive) {
                const step = STEPS[enrollStep];
                let ok = false;
                let det0 = scaled[0] || null;
                if (det0) {
                    ok = step.check(det0, dims);
                    const box = det0.detection.box;
                    ctx.strokeStyle = ok ? '#00ff66' : '#5efcff';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(box.x, box.y, box.width, box.height);
                    if (meshActive) drawMesh(ctx, det0.landmarks.positions);
                }
                if (ok) {
                    oval.className = 'face-oval ok';
                    stepHoldFrames++;
                    document.getElementById('guide-hint').textContent = 'Halte still... ' + Math.min(100, Math.round(stepHoldFrames / HOLD_NEEDED * 100)) + '%';
                    if (stepHoldFrames >= HOLD_NEEDED && det0 && det0.descriptor) {
                        await captureSample(det0.descriptor);
                    }
                } else {
                    oval.className = det0 ? 'face-oval err' : 'face-oval scan';
                    stepHoldFrames = 0;
                    document.getElementById('guide-hint').textContent = step.hint;
                }
            } else {
                scaled.forEach((res, idx) => {
                    const box = res.detection.box;
                    const pts = res.landmarks.positions;
                    let label = 'UNKNOWN', distance = 1;
                    if (faceMatcher && res.descriptor) {
                        const best = faceMatcher.findBestMatch(res.descriptor);
                        if (best && best.label !== 'unknown') {
                            label = best.label;
                            distance = best.distance;
                            const db = loadKnownFaces();
                            if (db[label]) {
                                const prev = db[label].lastSeen || 0;
                                if (idx === 0) primaryAway = formatAway(Date.now() - prev);
                                db[label].lastSeen = Date.now();
                                saveKnownFaces(db);
                            }
                        }
                    }
                    if (idx === 0) {
                        primaryName = label;
                        primaryGender = (res.gender || '--').toUpperCase();
                        const exprs = res.expressions || {};
                        primaryEmotion = Object.keys(exprs).reduce((a,b) => exprs[a] > exprs[b] ? a : b, 'neutral').toUpperCase();
                        if (label !== 'UNKNOWN' && label !== lastMatchName) {
                            log('ERKANNT: ' + label + ' (dist ' + distance.toFixed(3) + ')');
                            lastMatchName = label;
                        }
                    }
                    const color = label !== 'UNKNOWN' ? '#00ff66' : '#5efcff';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(box.x, box.y, box.width, box.height);
                    if (meshActive) drawMesh(ctx, pts);
                    ctx.save();
                    ctx.scale(-1, 1);
                    ctx.fillStyle = color;
                    ctx.font = 'bold 13px monospace';
                    ctx.fillText(label !== 'UNKNOWN' ? label : 'UNBEKANNT', -(box.x + box.width), box.y - 10);
                    if (label !== 'UNKNOWN') {
                        ctx.font = '10px monospace';
                        ctx.fillText('match ' + (1 - distance).toFixed(2), -(box.x + box.width), box.y - 24);
                    }
                    ctx.restore();
                });
                if (detections.length === 0) lastMatchName = null;
            }

            document.getElementById('target-count').innerText = 'TARGETS: ' + detections.length;
            document.getElementById('out-name').innerText = primaryName;
            document.getElementById('out-away').innerText = primaryAway;
            document.getElementById('out-gender').innerText = primaryGender;
            document.getElementById('out-emotion').innerText = primaryEmotion;
        } catch(e) {}
        requestAnimationFrame(loop);
    };
    loop();
};
