/* script.js - RadSphere core engine */

// --- GLOBAL APPLICATION STATE ---
const state = {
    mode: 'researcher', // 'researcher' | 'student'
    
    // Researcher Mode State
    researcher: {
        dicomFileBuffer: null,
        dicomFileName: null,
        parsedDicom: null,
        imageDims: { width: 0, height: 0 },
        points: [], // Array of [x, y] in DICOM image coordinate space
        isClosed: false,
        isConfirmed: false,
        pathologyLabel: '',
        metadata: null
    },
    
    // Student Mode State
    student: {
        dicomFileBuffer: null,
        parsedDicom: null,
        imageDims: { width: 0, height: 0 },
        studentPoints: [], // Array of [x, y] in DICOM image space
        isClosed: false,
        expertPoints: [], // Loaded from researcher CSV
        expertLabel: '',
        isSubmitted: false
    }
};

// --- MOCK DICOM GENERATOR (EXPLICIT VR LITTLE ENDIAN) ---
class DicomWriter {
    constructor() {
        this.buffer = new Uint8Array(1024 * 1024 * 1.5); // 1.5MB buffer
        this.offset = 0;
        
        // Write 128-byte preamble (zeroes)
        for (let i = 0; i < 128; i++) this.writeByte(0);
        // Write DICOM prefix "DICM"
        this.writeString("DICM");
    }
    
    writeByte(val) {
        this.buffer[this.offset++] = val;
    }
    
    writeUint16(val) {
        this.buffer[this.offset++] = val & 0xff;
        this.buffer[this.offset++] = (val >> 8) & 0xff;
    }
    
    writeUint32(val) {
        this.buffer[this.offset++] = val & 0xff;
        this.buffer[this.offset++] = (val >> 8) & 0xff;
        this.buffer[this.offset++] = (val >> 16) & 0xff;
        this.buffer[this.offset++] = (val >> 24) & 0xff;
    }
    
    writeString(str) {
        for (let i = 0; i < str.length; i++) {
            this.buffer[this.offset++] = str.charCodeAt(i);
        }
    }
    
    writeElement(group, element, vr, val) {
        this.writeUint16(group);
        this.writeUint16(element);
        this.writeString(vr);
        
        const longVRs = ["OB", "OW", "OF", "UT", "SQ", "UN"];
        const isLong = longVRs.includes(vr);
        
        let valBytes;
        if (vr === "US") {
            valBytes = new Uint8Array(2);
            valBytes[0] = val & 0xff;
            valBytes[1] = (val >> 8) & 0xff;
        } else if (typeof val === 'string') {
            valBytes = new TextEncoder().encode(val);
            // Values must be even length; pad with space if odd
            if (valBytes.length % 2 !== 0) {
                const temp = new Uint8Array(valBytes.length + 1);
                temp.set(valBytes);
                temp[valBytes.length] = 32; // ASCII Space
                valBytes = temp;
            }
        } else if (val instanceof Uint16Array) {
            valBytes = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
        } else if (val instanceof Uint8Array) {
            valBytes = val;
            if (valBytes.length % 2 !== 0) {
                const temp = new Uint8Array(valBytes.length + 1);
                temp.set(valBytes);
                valBytes = temp;
            }
        }
        
        if (isLong) {
            this.writeUint16(0); // Reserved bytes
            this.writeUint32(valBytes.length);
        } else {
            this.writeUint16(valBytes.length);
        }
        
        // Write the data payload
        for (let i = 0; i < valBytes.length; i++) {
            this.buffer[this.offset++] = valBytes[i];
        }
    }
    
    getBuffer() {
        return this.buffer.slice(0, this.offset);
    }
}

// Draw a simulated high-fidelity chest X-ray onto a canvas
function drawSimulatedChestXray(ctx, width, height, pathologyX = 0, pathologyY = 0, pathologyRadius = 0) {
    // 1. Black outer background
    ctx.fillStyle = "#090a0d";
    ctx.fillRect(0, 0, width, height);
    
    // 2. Translucent chest/body outline contour
    const cx = width / 2;
    const cy = height / 2;
    const bodyGrad = ctx.createRadialGradient(cx, cy, 30, cx, cy, width * 0.46);
    bodyGrad.addColorStop(0, "#484b54");
    bodyGrad.addColorStop(0.65, "#25272c");
    bodyGrad.addColorStop(0.85, "#121316");
    bodyGrad.addColorStop(1, "#090a0d");
    
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, width * 0.38, height * 0.44, 0, 0, 2 * Math.PI);
    ctx.fill();
    
    // 3. Lung Fields (anatomical left and right, dark air density)
    ctx.fillStyle = "#0e0f12";
    // Right Lung (display left)
    ctx.beginPath();
    ctx.ellipse(cx - width * 0.17, cy - height * 0.04, width * 0.12, height * 0.28, 0.04, 0, 2 * Math.PI);
    ctx.fill();
    
    // Left Lung (display right)
    ctx.beginPath();
    ctx.ellipse(cx + width * 0.17, cy - height * 0.04, width * 0.12, height * 0.28, -0.04, 0, 2 * Math.PI);
    ctx.fill();
    
    // Diaphragm outline curves
    ctx.fillStyle = "#25272c";
    ctx.beginPath();
    ctx.arc(cx - width * 0.17, cy + height * 0.26, width * 0.15, Math.PI, 0);
    ctx.arc(cx + width * 0.17, cy + height * 0.26, width * 0.15, Math.PI, 0);
    ctx.fill();
    
    // 4. Central spine columna
    const spineGrad = ctx.createLinearGradient(cx - 15, 0, cx + 15, 0);
    spineGrad.addColorStop(0, "#2c2e34");
    spineGrad.addColorStop(0.5, "#52555e");
    spineGrad.addColorStop(1, "#2c2e34");
    ctx.fillStyle = spineGrad;
    ctx.fillRect(cx - 10, height * 0.06, 20, height * 0.82);
    
    // Vertebrae details
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.lineWidth = 1.5;
    for (let y = height * 0.08; y < height * 0.85; y += 14) {
        ctx.beginPath();
        ctx.moveTo(cx - 10, y);
        ctx.lineTo(cx + 10, y);
        ctx.stroke();
    }
    
    // 5. Heart Shadow / Mediastinum (display right, soft tissue opacity)
    const heartGrad = ctx.createRadialGradient(cx + width * 0.03, cy + height * 0.1, 10, cx + width * 0.03, cy + height * 0.1, width * 0.16);
    heartGrad.addColorStop(0, "#555860");
    heartGrad.addColorStop(0.7, "#35373d");
    heartGrad.addColorStop(1, "transparent");
    ctx.fillStyle = heartGrad;
    ctx.beginPath();
    ctx.ellipse(cx + width * 0.03, cy + height * 0.08, width * 0.14, height * 0.16, -0.08, 0, 2 * Math.PI);
    ctx.fill();
    
    // 6. Rib arcs overlay (translucent bone stripes)
    ctx.strokeStyle = "rgba(92, 96, 107, 0.18)";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    for (let i = 0; i < 9; i++) {
        const yPos = cy - height * 0.22 + i * 36;
        // Right ribs
        ctx.beginPath();
        ctx.arc(cx - width * 0.35, yPos, width * 0.26, 1.7 * Math.PI, 0.2 * Math.PI);
        ctx.stroke();
        
        // Left ribs
        ctx.beginPath();
        ctx.arc(cx + width * 0.35, yPos, width * 0.26, 0.8 * Math.PI, 1.3 * Math.PI);
        ctx.stroke();
    }
    
    // Clavicles (upper collarbones)
    ctx.strokeStyle = "rgba(100, 104, 115, 0.35)";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy - height * 0.33);
    ctx.quadraticCurveTo(cx - width * 0.18, cy - height * 0.36, cx - width * 0.33, cy - height * 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy - height * 0.33);
    ctx.quadraticCurveTo(cx + width * 0.18, cy - height * 0.36, cx + width * 0.33, cy - height * 0.3);
    ctx.stroke();
    
    // 7. Text overlays
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText("R", width * 0.06, height * 0.1);
    ctx.font = "9px sans-serif";
    ctx.fillText("RadSphere SIM", width * 0.06, height * 0.94);
    ctx.fillText("ID: DX-77491-A", width * 0.06, height * 0.97);
    
    // 8. Pathology Shadow (e.g. lung nodule)
    if (pathologyRadius > 0) {
        const pathGrad = ctx.createRadialGradient(pathologyX, pathologyY, 1, pathologyX, pathologyY, pathologyRadius);
        pathGrad.addColorStop(0, "rgba(88, 88, 88, 0.72)");
        pathGrad.addColorStop(0.5, "rgba(65, 65, 65, 0.45)");
        pathGrad.addColorStop(1, "transparent");
        
        ctx.fillStyle = pathGrad;
        ctx.beginPath();
        ctx.arc(pathologyX, pathologyY, pathologyRadius, 0, 2 * Math.PI);
        ctx.fill();
        
        // Add irregular border
        ctx.strokeStyle = "rgba(65, 65, 65, 0.12)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pathologyX, pathologyY, pathologyRadius * 0.85, 0, 2 * Math.PI);
        ctx.stroke();
    }
}

// Generate the virtual DICOM bytes (512x512 pixels)
function generateDemoDicomBytes() {
    const writer = new DicomWriter();
    
    // Meta Elements
    writer.writeElement(0x0002, 0x0002, "UI", "1.2.840.10008.5.1.4.1.1.7"); // SOP Class SC
    writer.writeElement(0x0002, 0x0003, "UI", "1.2.826.0.1.3680043.8.498.77491.101");
    writer.writeElement(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"); // Explicit Little Endian
    
    // SOP Class & Modality
    writer.writeElement(0x0008, 0x0016, "UI", "1.2.840.10008.5.1.4.1.1.7");
    writer.writeElement(0x0008, 0x0018, "UI", "1.2.826.0.1.3680043.8.498.77491.101");
    writer.writeElement(0x0008, 0x0060, "CS", "DX");
    writer.writeElement(0x0008, 0x0020, "DA", "20260623");
    
    // Patient Data
    writer.writeElement(0x0010, 0x0010, "PN", "SIMULATED^PATIENT");
    writer.writeElement(0x0010, 0x0020, "LO", "DX-77491-A");
    
    // Image Dimension / Format Details
    writer.writeElement(0x0028, 0x0002, "US", 1); // Samples/pixel
    writer.writeElement(0x0028, 0x0004, "CS", "MONOCHROME2");
    writer.writeElement(0x0028, 0x0010, "US", 512); // Rows
    writer.writeElement(0x0028, 0x0011, "US", 512); // Columns
    writer.writeElement(0x0028, 0x0100, "US", 16); // Bits Allocated
    writer.writeElement(0x0028, 0x0101, "US", 12); // Bits Stored
    writer.writeElement(0x0028, 0x0102, "US", 11); // High Bit
    writer.writeElement(0x0028, 0x0103, "US", 0);  // Unsigned
    writer.writeElement(0x0028, 0x1050, "DS", "2048"); // Window Center
    writer.writeElement(0x0028, 0x1051, "DS", "4096"); // Window Width
    
    // Draw the image to a temporary canvas and read its values
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 512;
    tempCanvas.height = 512;
    const tempCtx = tempCanvas.getContext("2d");
    
    // Pathological nodule coordinates: center (348, 216), radius 16
    drawSimulatedChestXray(tempCtx, 512, 512, 348, 216, 16);
    const imgData = tempCtx.getImageData(0, 0, 512, 512);
    
    // Build 16-bit pixel data array
    const pixels = new Uint16Array(512 * 512);
    for (let i = 0; i < pixels.length; i++) {
        const val8 = imgData.data[i * 4]; // R channel
        pixels[i] = val8 * 16; // Scale 0-255 -> 0-4080 (within 12-bit stored)
    }
    
    // Pixel Data Element
    writer.writeElement(0x7fe0, 0x0010, "OW", pixels);
    
    return writer.getBuffer();
}


// --- CORE APPLICATION VIEWER AND MODE SWITCHER ---
function switchMode(newMode) {
    state.mode = newMode;
    
    // Update navigation buttons
    document.getElementById('tab-researcher-btn').classList.toggle('active', newMode === 'researcher');
    document.getElementById('tab-student-btn').classList.toggle('active', newMode === 'student');
    
    // Update active tab container
    document.getElementById('tab-researcher').classList.toggle('active', newMode === 'researcher');
    document.getElementById('tab-student').classList.toggle('active', newMode === 'student');
    
    // Trigger canvas resets on tab switch
    if (newMode === 'researcher') {
        redrawResearcherCanvas();
    } else {
        redrawStudentCanvas();
    }
}


// --- DICOM RENDERING INTERNALS ---
function renderParsedDicom(canvas, dataSet, byteArray) {
    const pixelDataElement = dataSet.elements['x7fe00010'];
    if (!pixelDataElement) {
        throw new Error("No pixel data found in DICOM file.");
    }
    
    const rows = dataSet.uint16('x00280010');
    const cols = dataSet.uint16('x00280011');
    const bitsAllocated = dataSet.uint16('x00280100');
    const pixelRep = dataSet.uint16('x00280103'); // 0 = unsigned, 1 = signed
    const photoInterp = dataSet.string('x00280004')?.trim() || "MONOCHROME2";
    
    // Rescale slopes
    let rescaleSlope = 1.0;
    let rescaleIntercept = 0.0;
    if (dataSet.string('x00281053')) {
        rescaleSlope = parseFloat(dataSet.string('x00281053'));
    }
    if (dataSet.string('x00281052')) {
        rescaleIntercept = parseFloat(dataSet.string('x00281052'));
    }
    
    // Window Settings
    let windowCenter = null;
    let windowWidth = null;
    const wcStr = dataSet.string('x00281050');
    if (wcStr) {
        windowCenter = parseFloat(wcStr.split('\\')[0]);
    }
    const wwStr = dataSet.string('x00281051');
    if (wwStr) {
        windowWidth = parseFloat(wwStr.split('\\')[0]);
    }
    
    // Setup pixel views based on Bits Allocated
    const dataOffset = pixelDataElement.dataOffset;
    const dataLength = pixelDataElement.length;
    const numPixels = rows * cols;
    const pixels = new Float32Array(numPixels);
    const view = new DataView(byteArray.buffer, byteArray.byteOffset + dataOffset, dataLength);
    const littleEndian = true;
    
    if (bitsAllocated === 16) {
        for (let i = 0; i < numPixels; i++) {
            let val;
            if (pixelRep === 1) {
                val = view.getInt16(i * 2, littleEndian);
            } else {
                val = view.getUint16(i * 2, littleEndian);
            }
            pixels[i] = val * rescaleSlope + rescaleIntercept;
        }
    } else {
        // 8-bit fallback
        for (let i = 0; i < numPixels; i++) {
            const val = byteArray[dataOffset + i];
            pixels[i] = val * rescaleSlope + rescaleIntercept;
        }
    }
    
    // Compute window parameters if missing
    if (windowCenter === null || windowWidth === null) {
        let min = pixels[0];
        let max = pixels[0];
        for (let i = 1; i < pixels.length; i++) {
            if (pixels[i] < min) min = pixels[i];
            if (pixels[i] > max) max = pixels[i];
        }
        windowCenter = (min + max) / 2;
        windowWidth = max - min;
        if (windowWidth <= 0) windowWidth = 1.0;
    }
    
    // Renders the pixels using the window scale
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(cols, rows);
    const data = imgData.data;
    
    const low = windowCenter - windowWidth / 2;
    const high = windowCenter + windowWidth / 2;
    const range = windowWidth;
    
    for (let i = 0; i < pixels.length; i++) {
        const val = pixels[i];
        let intensity = 0;
        if (val <= low) {
            intensity = 0;
        } else if (val >= high) {
            intensity = 255;
        } else {
            intensity = Math.round(((val - low) / range) * 255);
        }
        
        if (photoInterp === "MONOCHROME1") {
            intensity = 255 - intensity; // Invert grayscale mapping
        }
        
        const idx = i * 4;
        data[idx] = intensity;     // R
        data[idx + 1] = intensity; // G
        data[idx + 2] = intensity; // B
        data[idx + 3] = 255;       // Alpha
    }
    ctx.putImageData(imgData, 0, 0);
}


// --- RESEARCHER WORKSPACE FUNCTIONALITY ---

// Load mock demo scan
function loadDemoDicom() {
    try {
        const dcmBytes = generateDemoDicomBytes();
        state.researcher.dicomFileBuffer = dcmBytes.buffer;
        state.researcher.dicomFileName = "demo_chest.dcm";
        
        const byteArray = new Uint8Array(dcmBytes.buffer);
        state.researcher.parsedDicom = dicomParser.parseDicom(byteArray);
        
        processResearcherDicom();
    } catch (err) {
        console.error("Demo generation failed: ", err);
        alert("Failed to generate simulated DICOM scan: " + err.message);
    }
}

// Handle real DICOM file uploads
function handleResearcherFile(file) {
    state.researcher.dicomFileName = file.name;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const buffer = evt.target.result;
            state.researcher.dicomFileBuffer = buffer;
            
            const byteArray = new Uint8Array(buffer);
            
            // Check for compressed transfer syntaxes
            const tempDataset = dicomParser.parseDicom(byteArray);
            const pixelElement = tempDataset.elements['x7fe00010'];
            if (pixelElement && pixelElement.undefinedLength) {
                alert("Compressed DICOM files (JPEG/RLE) are not supported. Loading the demo DICOM instead.");
                loadDemoDicom();
                return;
            }
            
            state.researcher.parsedDicom = tempDataset;
            processResearcherDicom();
        } catch (err) {
            console.error("DICOM Parsing error: ", err);
            alert("Error parsing DICOM: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

document.getElementById('researcher-file-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) handleResearcherFile(file);
});

// Researcher drag & drop handlers
const rUploadZone = document.getElementById('researcher-upload-zone');
rUploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    rUploadZone.classList.add('drag-active');
});
rUploadZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    rUploadZone.classList.add('drag-active');
});
rUploadZone.addEventListener('dragleave', () => {
    rUploadZone.classList.remove('drag-active');
});
rUploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    rUploadZone.classList.remove('drag-active');
    const file = e.dataTransfer.files[0];
    if (file) handleResearcherFile(file);
});

// Configure UI and parse details once researcher DICOM is loaded
function processResearcherDicom() {
    const dcm = state.researcher.parsedDicom;
    const byteArray = new Uint8Array(state.researcher.dicomFileBuffer);
    
    const rows = dcm.uint16('x00280010');
    const cols = dcm.uint16('x00280011');
    state.researcher.imageDims = { width: cols, height: rows };
    
    // Extrusion of Patient metadata
    const patientName = dcm.string('x00100010') || "UNKNOWN^PATIENT";
    const patientId = dcm.string('x00100020') || "UNKNOWN-ID";
    const modality = dcm.string('x00080060') || "OT";
    
    // Window Center / Window Width
    let wc = dcm.string('x00281050') || "Auto";
    let ww = dcm.string('x00281051') || "Auto";
    
    state.researcher.metadata = {
        patientName,
        patientId,
        modality,
        width: cols,
        height: rows
    };
    
    // Update Control Labels
    document.getElementById('r-meta-patient').innerText = patientName;
    document.getElementById('r-meta-patient-id').innerText = patientId;
    document.getElementById('r-meta-modality').innerText = modality;
    document.getElementById('r-meta-dims').innerText = `${cols} x ${rows}`;
    document.getElementById('r-meta-window').innerText = `${wc} / ${ww}`;
    
    // Render to base canvas
    const imgCanvas = document.getElementById('r-dicom-canvas');
    renderParsedDicom(imgCanvas, dcm, byteArray);
    
    // Reset drawings
    state.researcher.points = [];
    state.researcher.isClosed = false;
    state.researcher.isConfirmed = false;
    document.getElementById('input-pathology-name').value = '';
    
    // Reveal Canvas viewport structures
    document.getElementById('researcher-canvas-placeholder').style.display = 'none';
    imgCanvas.style.display = 'block';
    const drawCanvas = document.getElementById('r-draw-canvas');
    drawCanvas.width = cols;
    drawCanvas.height = rows;
    drawCanvas.style.display = 'block';
    
    // Show sections
    document.getElementById('researcher-metadata-container').style.display = 'block';
    document.getElementById('researcher-draw-container').style.display = 'block';
    document.getElementById('download-group').style.display = 'none';
    
    // Update status badge
    const badge = document.getElementById('r-status-badge');
    badge.innerText = "Ready to Annotate";
    badge.className = "canvas-subtitle-tag";
    
    redrawResearcherCanvas();
    updateResearcherButtons();
}

// Reset the polygon
function clearPolygon() {
    state.researcher.points = [];
    state.researcher.isClosed = false;
    state.researcher.isConfirmed = false;
    document.getElementById('download-group').style.display = 'none';
    
    const badge = document.getElementById('r-status-badge');
    badge.innerText = "Annotating";
    badge.className = "canvas-subtitle-tag";
    
    redrawResearcherCanvas();
    updateResearcherButtons();
}

// Close the loop
function closePolygon() {
    if (state.researcher.points.length >= 3) {
        state.researcher.isClosed = true;
        redrawResearcherCanvas();
        updateResearcherButtons();
    }
}

// Confirm Pathology Annotations
function confirmAnnotation() {
    const labelInput = document.getElementById('input-pathology-name').value.trim();
    if (!labelInput) {
        alert("Please enter a pathology label describing the disease.");
        return;
    }
    
    state.researcher.pathologyLabel = labelInput;
    state.researcher.isConfirmed = true;
    
    document.getElementById('download-group').style.display = 'block';
    
    const badge = document.getElementById('r-status-badge');
    badge.innerText = "Confirmed";
    badge.className = "canvas-subtitle-tag";
    
    redrawResearcherCanvas();
    updateResearcherButtons();
}

// State toggler for button disabling
function updateResearcherButtons() {
    const pts = state.researcher.points;
    const isClosed = state.researcher.isClosed;
    const isConfirmed = state.researcher.isConfirmed;
    
    document.getElementById('btn-clear-points').disabled = pts.length === 0;
    document.getElementById('btn-close-polygon').disabled = isClosed || pts.length < 3;
    document.getElementById('btn-confirm-pathology').disabled = !isClosed || isConfirmed;
    
    // Lock/Unlock inputs
    document.getElementById('input-pathology-name').disabled = isConfirmed;
}

// Redraw overlay graphics
function redrawResearcherCanvas() {
    const drawCanvas = document.getElementById('r-draw-canvas');
    if (!drawCanvas || drawCanvas.style.display === 'none') return;
    
    const ctx = drawCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    
    const pts = state.researcher.points;
    const isClosed = state.researcher.isClosed;
    const isConfirmed = state.researcher.isConfirmed;
    
    if (pts.length === 0) return;
    
    // Draw polygon fills
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
    }
    
    if (isClosed) {
        ctx.closePath();
        ctx.fillStyle = isConfirmed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.2)';
        ctx.fill();
        ctx.strokeStyle = isConfirmed ? '#10b981' : '#6366f1';
        ctx.lineWidth = 3;
        ctx.stroke();
    } else {
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    // Draw joints
    pts.forEach((pt, i) => {
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], i === 0 ? 6 : 4, 0, 2 * Math.PI);
        ctx.fillStyle = i === 0 ? '#f59e0b' : '#6366f1'; // Orange start point
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
    });
}

// Researcher Canvas interaction bindings
const rDrawCanvas = document.getElementById('r-draw-canvas');
let rMousePos = null;

rDrawCanvas.addEventListener('mousedown', function(e) {
    if (state.researcher.isClosed || !state.researcher.parsedDicom) return;
    
    const rect = rDrawCanvas.getBoundingClientRect();
    const scaleX = rDrawCanvas.width / rect.width;
    const scaleY = rDrawCanvas.height / rect.height;
    
    const x_img = (e.clientX - rect.left) * scaleX;
    const y_img = (e.clientY - rect.top) * scaleY;
    
    const pts = state.researcher.points;
    
    // Try to close path if clicking starting node
    if (pts.length >= 3) {
        const startX = pts[0][0];
        const startY = pts[0][1];
        
        // Match range in display pixels
        const clickDistCanvas = Math.hypot((x_img - startX) / scaleX, (y_img - startY) / scaleY);
        if (clickDistCanvas < 12) {
            state.researcher.isClosed = true;
            redrawResearcherCanvas();
            updateResearcherButtons();
            return;
        }
    }
    
    // Push new point
    pts.push([Math.round(x_img), Math.round(y_img)]);
    redrawResearcherCanvas();
    updateResearcherButtons();
});

rDrawCanvas.addEventListener('mousemove', function(e) {
    if (state.researcher.isClosed || state.researcher.points.length === 0) return;
    
    const rect = rDrawCanvas.getBoundingClientRect();
    const scaleX = rDrawCanvas.width / rect.width;
    const scaleY = rDrawCanvas.height / rect.height;
    
    rMousePos = [
        (e.clientX - rect.left) * scaleX,
        (e.clientY - rect.top) * scaleY
    ];
    
    // Redraw with cursor guidance line
    redrawResearcherCanvas();
    
    const ctx = rDrawCanvas.getContext('2d');
    const pts = state.researcher.points;
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.lineTo(rMousePos[0], rMousePos[1]);
    ctx.stroke();
    ctx.setLineDash([]); // Reset
    
    // Highlight closing loop potential
    if (pts.length >= 3) {
        const distCanvas = Math.hypot((rMousePos[0] - pts[0][0]) / scaleX, (rMousePos[1] - pts[0][1]) / scaleY);
        if (distCanvas < 12) {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pts[0][0], pts[0][1], 10, 0, 2 * Math.PI);
            ctx.stroke();
        }
    }
});

rDrawCanvas.addEventListener('mouseleave', function() {
    rMousePos = null;
    redrawResearcherCanvas();
});

// ZIP package assembly and export download
function downloadPackage() {
    if (!state.researcher.isConfirmed) return;
    
    const zip = new JSZip();
    
    // 1. Add original DICOM buffer
    zip.file("image.dcm", state.researcher.dicomFileBuffer);
    
    // 2. Build pathology coordinates CSV
    let csvContent = `metadata,label,value\n`;
    csvContent += `info,pathology,${state.researcher.pathologyLabel}\n`;
    csvContent += `info,patientId,${state.researcher.metadata.patientId}\n`;
    csvContent += `info,patientName,${state.researcher.metadata.patientName}\n`;
    csvContent += `info,points_count,${state.researcher.points.length}\n`;
    csvContent += `x,y\n`;
    
    state.researcher.points.forEach(pt => {
        csvContent += `${pt[0]},${pt[1]}\n`;
    });
    
    zip.file("pathology.csv", csvContent);
    
    // 3. Trigger build and browser download
    zip.generateAsync({ type: "blob" }).then(function(content) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `annotated_${state.researcher.metadata.patientId.replace(/\s+/g, '_')}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}


// --- STUDENT ARENA FUNCTIONALITY ---

// Handle student ZIP package imports
function handleStudentFile(file) {
    const reader = new FileReader();
    reader.onload = function(evt) {
        const buffer = evt.target.result;
        
        JSZip.loadAsync(buffer).then(function(zip) {
            // Find targets
            const dcmFiles = zip.file(/.*\.dcm$/i);
            const csvFiles = zip.file(/.*\.csv$/i);
            
            if (dcmFiles.length === 0 || csvFiles.length === 0) {
                alert("Invalid package structure. Must contain a DICOM (.dcm) file and pathology (.csv) coordinates.");
                return;
            }
            
            // Extract DICOM buffer
            dcmFiles[0].async("arraybuffer").then(function(dcmBuf) {
                state.student.dicomFileBuffer = dcmBuf;
                
                const byteArray = new Uint8Array(dcmBuf);
                state.student.parsedDicom = dicomParser.parseDicom(byteArray);
                
                // Extract CSV content
                csvFiles[0].async("string").then(function(csvText) {
                    parseStudentCsv(csvText);
                    processStudentDicom();
                });
            });
            
        }).catch(err => {
            console.error("ZIP Load Failure: ", err);
            alert("Error unpacking zip file. Ensure it is a valid RadSphere package.");
        });
    };
    reader.readAsArrayBuffer(file);
}

document.getElementById('student-file-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) handleStudentFile(file);
});

// Student drag & drop handlers
const sUploadZone = document.getElementById('student-upload-zone');
sUploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    sUploadZone.classList.add('drag-active');
});
sUploadZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    sUploadZone.classList.add('drag-active');
});
sUploadZone.addEventListener('dragleave', () => {
    sUploadZone.classList.remove('drag-active');
});
sUploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    sUploadZone.classList.remove('drag-active');
    const file = e.dataTransfer.files[0];
    if (file) handleStudentFile(file);
});

// Parser for the CSV coordinates and pathology labels
function parseStudentCsv(csvText) {
    const lines = csvText.split('\n');
    state.student.expertPoints = [];
    state.student.expertLabel = '';
    
    let readingCoords = false;
    
    lines.forEach(line => {
        const parts = line.split(',');
        if (parts.length < 2) return;
        
        const key = parts[0].trim();
        const val = parts[1].trim();
        
        if (key === 'info' && val === 'pathology') {
            state.student.expertLabel = parts[2]?.trim() || "Pathology";
        }
        
        if (key === 'x' && val === 'y') {
            readingCoords = true;
            return;
        }
        
        if (readingCoords) {
            const x = parseInt(parts[0]);
            const y = parseInt(parts[1]);
            if (!isNaN(x) && !isNaN(y)) {
                state.student.expertPoints.push([x, y]);
            }
        }
    });
}

// Render student screen
function processStudentDicom() {
    const dcm = state.student.parsedDicom;
    const byteArray = new Uint8Array(state.student.dicomFileBuffer);
    
    const rows = dcm.uint16('x00280010');
    const cols = dcm.uint16('x00280011');
    state.student.imageDims = { width: cols, height: rows };
    
    // Extrusion of Patient metadata
    const patientName = dcm.string('x00100010') || "UNKNOWN^PATIENT";
    const patientId = dcm.string('x00100020') || "UNKNOWN-ID";
    const modality = dcm.string('x00080060') || "DX";
    
    // Update Control Labels
    document.getElementById('s-meta-patient').innerText = patientName;
    document.getElementById('s-meta-patient-id').innerText = patientId;
    document.getElementById('s-meta-modality').innerText = modality;
    document.getElementById('s-meta-dims').innerText = `${cols} x ${rows}`;
    
    // Render to base canvas
    const imgCanvas = document.getElementById('s-dicom-canvas');
    renderParsedDicom(imgCanvas, dcm, byteArray);
    
    // Reset drawings
    state.student.studentPoints = [];
    state.student.isClosed = false;
    state.student.isSubmitted = false;
    
    // Reveal Canvas viewport structures
    document.getElementById('student-canvas-placeholder').style.display = 'none';
    imgCanvas.style.display = 'block';
    const drawCanvas = document.getElementById('s-draw-canvas');
    drawCanvas.width = cols;
    drawCanvas.height = rows;
    drawCanvas.style.display = 'block';
    
    // Show sections
    document.getElementById('student-metadata-container').style.display = 'block';
    document.getElementById('student-draw-container').style.display = 'block';
    
    // Update status badge
    const badge = document.getElementById('s-status-badge');
    badge.innerText = "Drawing Diagnostic";
    badge.className = "canvas-subtitle-tag student";
    
    redrawStudentCanvas();
    updateStudentButtons();
}

// Reset student drawings
function clearStudentPolygon() {
    state.student.studentPoints = [];
    state.student.isClosed = false;
    state.student.isSubmitted = false;
    
    const badge = document.getElementById('s-status-badge');
    badge.innerText = "Drawing Diagnostic";
    badge.className = "canvas-subtitle-tag student";
    
    redrawStudentCanvas();
    updateStudentButtons();
}

// Close Student loop
function closeStudentPolygon() {
    if (state.student.studentPoints.length >= 3) {
        state.student.isClosed = true;
        redrawStudentCanvas();
        updateStudentButtons();
    }
}

// Enable/Disable toggles
function updateStudentButtons() {
    const pts = state.student.studentPoints;
    const isClosed = state.student.isClosed;
    const isSubmitted = state.student.isSubmitted;
    
    document.getElementById('btn-s-clear-points').disabled = pts.length === 0 || isSubmitted;
    document.getElementById('btn-s-close-polygon').disabled = isClosed || pts.length < 3 || isSubmitted;
    document.getElementById('btn-submit-attempt').disabled = !isClosed || isSubmitted;
}

// Redraw student canvas
function redrawStudentCanvas() {
    const drawCanvas = document.getElementById('s-draw-canvas');
    if (!drawCanvas || drawCanvas.style.display === 'none') return;
    
    const ctx = drawCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    
    const pts = state.student.studentPoints;
    const isClosed = state.student.isClosed;
    const isSubmitted = state.student.isSubmitted;
    
    // If student has submitted, we also draw the expert boundary in dashed green
    if (isSubmitted) {
        const expPts = state.student.expertPoints;
        if (expPts.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(expPts[0][0], expPts[0][1]);
            for (let i = 1; i < expPts.length; i++) {
                ctx.lineTo(expPts[i][0], expPts[i][1]);
            }
            ctx.closePath();
            ctx.strokeStyle = '#10b981'; // Green expert border
            ctx.lineWidth = 3.5;
            ctx.setLineDash([6, 6]);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw expert tag next to it
            ctx.fillStyle = '#10b981';
            ctx.font = "bold 12px sans-serif";
            ctx.fillText(`EXPERT: ${state.student.expertLabel}`, expPts[0][0], expPts[0][1] - 8);
        }
    }
    
    if (pts.length === 0) return;
    
    // Draw student shapes
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
    }
    
    if (isClosed) {
        ctx.closePath();
        ctx.fillStyle = isSubmitted ? 'rgba(167, 139, 250, 0.15)' : 'rgba(99, 102, 241, 0.18)';
        ctx.fill();
        ctx.strokeStyle = isSubmitted ? '#a78bfa' : '#6366f1';
        ctx.lineWidth = 3;
        ctx.stroke();
    } else {
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    // Draw joints
    pts.forEach((pt, i) => {
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], i === 0 ? 6 : 4, 0, 2 * Math.PI);
        ctx.fillStyle = i === 0 ? '#f59e0b' : '#6366f1';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
    });
}

// Student Canvas event bindings
const sDrawCanvas = document.getElementById('s-draw-canvas');
let sMousePos = null;

sDrawCanvas.addEventListener('mousedown', function(e) {
    if (state.student.isClosed || !state.student.parsedDicom || state.student.isSubmitted) return;
    
    const rect = sDrawCanvas.getBoundingClientRect();
    const scaleX = sDrawCanvas.width / rect.width;
    const scaleY = sDrawCanvas.height / rect.height;
    
    const x_img = (e.clientX - rect.left) * scaleX;
    const y_img = (e.clientY - rect.top) * scaleY;
    
    const pts = state.student.studentPoints;
    
    // Try to close path
    if (pts.length >= 3) {
        const startX = pts[0][0];
        const startY = pts[0][1];
        const distCanvas = Math.hypot((x_img - startX) / scaleX, (y_img - startY) / scaleY);
        
        if (distCanvas < 12) {
            state.student.isClosed = true;
            redrawStudentCanvas();
            updateStudentButtons();
            return;
        }
    }
    
    pts.push([Math.round(x_img), Math.round(y_img)]);
    redrawStudentCanvas();
    updateStudentButtons();
});

sDrawCanvas.addEventListener('mousemove', function(e) {
    if (state.student.isClosed || state.student.studentPoints.length === 0 || state.student.isSubmitted) return;
    
    const rect = sDrawCanvas.getBoundingClientRect();
    const scaleX = sDrawCanvas.width / rect.width;
    const scaleY = sDrawCanvas.height / rect.height;
    
    sMousePos = [
        (e.clientX - rect.left) * scaleX,
        (e.clientY - rect.top) * scaleY
    ];
    
    redrawStudentCanvas();
    
    const ctx = sDrawCanvas.getContext('2d');
    const pts = state.student.studentPoints;
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.lineTo(sMousePos[0], sMousePos[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    
    if (pts.length >= 3) {
        const distCanvas = Math.hypot((sMousePos[0] - pts[0][0]) / scaleX, (sMousePos[1] - pts[0][1]) / scaleY);
        if (distCanvas < 12) {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pts[0][0], pts[0][1], 10, 0, 2 * Math.PI);
            ctx.stroke();
        }
    }
});

sDrawCanvas.addEventListener('mouseleave', function() {
    sMousePos = null;
    redrawStudentCanvas();
});


// --- GRADING / ALIGNMENT ALGORITHM ---

// Ray-casting Point-In-Polygon checker
function isPointInPolygon(point, vs) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];
        
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Compute metrics using pixel raster grid simulation
function computeMetrics(polyR, polyS, imgWidth, imgHeight) {
    // 1. Find bounding box of combined boundaries
    let minX = Math.min(...polyR.map(p => p[0]), ...polyS.map(p => p[0]));
    let maxX = Math.max(...polyR.map(p => p[0]), ...polyS.map(p => p[0]));
    let minY = Math.min(...polyR.map(p => p[1]), ...polyS.map(p => p[1]));
    let maxY = Math.max(...polyR.map(p => p[1]), ...polyS.map(p => p[1]));
    
    // Add safety margins
    minX = Math.max(0, Math.floor(minX - 8));
    maxX = Math.min(imgWidth - 1, Math.ceil(maxX + 8));
    minY = Math.max(0, Math.floor(minY - 8));
    maxY = Math.min(imgHeight - 1, Math.ceil(maxY + 8));
    
    // Sample grid inside bounding box
    // Limit to 150 divisions per axis for high-performance sub-2ms grades
    const stepsX = Math.min(150, maxX - minX + 1);
    const stepsY = Math.min(150, maxY - minY + 1);
    
    const dx = (maxX - minX) / (stepsX - 1 || 1);
    const dy = (maxY - minY) / (stepsY - 1 || 1);
    
    let areaR = 0;
    let areaS = 0;
    let intersection = 0;
    let union = 0;
    
    for (let i = 0; i < stepsX; i++) {
        const x = minX + i * dx;
        for (let j = 0; j < stepsY; j++) {
            const y = minY + j * dy;
            const pt = [x, y];
            
            const inR = isPointInPolygon(pt, polyR);
            const inS = isPointInPolygon(pt, polyS);
            
            if (inR) areaR++;
            if (inS) areaS++;
            
            if (inR && inS) {
                intersection++;
                union++;
            } else if (inR || inS) {
                union++;
            }
        }
    }
    
    const iou = union > 0 ? (intersection / union) : 0;
    const sensitivity = areaR > 0 ? (intersection / areaR) : 0;
    const precision = areaS > 0 ? (intersection / areaS) : 0;
    
    return {
        iou,
        sensitivity, // Target pathology covered
        precision    // Student accuracy inside their drawn borders
    };
}

// Calculate scores, trigger modals
function gradeStudentAttempt() {
    if (!state.student.isClosed) return;
    
    const polyR = state.student.expertPoints;
    const polyS = state.student.studentPoints;
    
    if (polyR.length < 3) {
        alert("The pathology package doesn't contain a valid researcher contour. Cannot score.");
        return;
    }
    
    // Perform scoring
    const metrics = computeMetrics(polyR, polyS, state.student.imageDims.width, state.student.imageDims.height);
    
    // Convert to percentages
    const iouPct = Math.round(metrics.iou * 100);
    const covPct = Math.round(metrics.sensitivity * 100);
    const precPct = Math.round(metrics.precision * 100);
    
    // Grade threshold: at least 60% match (either IoU or Overlap Coverage)
    const isCorrect = iouPct >= 60 || covPct >= 60;
    
    // Update state to render expert lines
    state.student.isSubmitted = true;
    redrawStudentCanvas();
    updateStudentButtons();
    
    // Display result badge
    const badge = document.getElementById('s-status-badge');
    badge.innerText = isCorrect ? "Passed" : "Needs Review";
    badge.className = `canvas-subtitle-tag ${isCorrect ? 'success' : 'danger'}`;
    
    // Render Modal contents
    const modalDetails = document.getElementById('modal-content-details');
    
    let html = `
        <div class="result-icon-container ${isCorrect ? 'success' : 'failure'}">
            <i class="ph-bold ${isCorrect ? 'ph-check-circle' : 'ph-x-circle'}" style="font-size: 3rem;"></i>
        </div>
        <h2 class="result-title ${isCorrect ? 'success' : 'failure'}">
            ${isCorrect ? 'You are right!' : 'Keep trying!'}
        </h2>
        <p class="result-desc">
            ${isCorrect 
                ? `Incredible! Your drawn diagnosis borders match the expert's annotations of the <strong>${state.student.expertLabel}</strong>.` 
                : `Your border overlaps by less than 60% with the expert reference for the <strong>${state.student.expertLabel}</strong>. Adjust your polygon anchors and try again.`
            }
        </p>
        
        <div class="score-card">
            <div class="score-stats">
                <div class="stat-box">
                    <span class="stat-label">Spatial Overlap (IoU)</span>
                    <span class="stat-val">${iouPct}%</span>
                </div>
                <div class="stat-box">
                    <span class="stat-label">Target Coverage</span>
                    <span class="stat-val">${covPct}%</span>
                </div>
                
                <div class="progress-bar-container">
                    <div class="progress-bar-fill ${isCorrect ? 'success' : 'failure'}" style="width: ${Math.max(5, Math.min(100, Math.max(iouPct, covPct)))}%"></div>
                </div>
            </div>
        </div>
        
        <div class="button-group">
            <button class="btn btn-secondary" onclick="closeGradingModal()">
                <i class="ph ph-eye"></i> View Alignment overlay
            </button>
            <button class="btn btn-primary" onclick="resetGradingSession()">
                <i class="ph ph-arrow-counter-clockwise"></i> Try Again
            </button>
        </div>
    `;
    
    modalDetails.innerHTML = html;
    
    // Open modal
    document.getElementById('grading-modal').classList.add('active');
}

function closeGradingModal(e) {
    document.getElementById('grading-modal').classList.remove('active');
}

function resetGradingSession() {
    closeGradingModal();
    clearStudentPolygon();
}
