# DarkFox AI Face Scanner (AIFaceScanner)

Browser face detection + recognition terminal (face-api.js / TensorFlow.js).

**Live demo:** https://slabylol.github.io/AIFaceScanner/

## v7.0 features
- Live webcam detection (age, gender, emotion)
- **Train faces** from the camera (name + capture)
- **Recognize** trained people and show **how long they were away**
- Storage: `localStorage` + cookie fallback
- Toggleable **3D landmark mesh** (fixed closed loops)
- Kernel log + emergency report UI

## Usage
1. Open the page (GitHub Pages or local server).
2. Click **INITIALIZE AI CORE** (allow camera).
3. **TRAIN FACE** → enter name → CAPTURE (repeat for better accuracy).
4. When that person reappears, **IDENTITY** and **AWAY** update.
5. **KNOWN FACES** to list / delete trained subjects.
6. **3D MESH** to toggle the green landmark wireframe.

## Models
Weights are loaded from `./weights/` if present, otherwise from public CDNs.

## License
MIT
