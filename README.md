<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RadSphere - DICOM Annotation & Training Portal</title>
    <meta name="description" content="A client-side DICOM radiology image annotation tool and student assessment arena. Upload DICOM files, draw pathologies, export ZIP packages, and test students' diagnostic accuracy.">
    
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    
    <!-- Phosphor Icons -->
    <script src="https://unpkg.com/@phosphor-icons/web"></script>
    
    <!-- CSS Stylesheet -->
    <link rel="stylesheet" href="style.css">
    
    <!-- Third-Party Libraries (Local with UMD Protection) -->
    <script>
        (function() {
            window._tempModule = window.module;
            window._tempExports = window.exports;
            window._tempDefine = window.define;
            window.module = undefined;
            window.exports = undefined;
            window.define = undefined;
        })();
    </script>
    <script src="dicomParser.min.js"></script>
    <script src="jszip.min.js"></script>
    <script>
        (function() {
            window.module = window._tempModule;
            window.exports = window._tempExports;
            window.define = window._tempDefine;
            delete window._tempModule;
            delete window._tempExports;
            delete window._tempDefine;
        })();
    </script>
</head>
<body>
    <!-- Background Gradient Spheres -->
    <div class="glow-bg">
        <div class="glow-sphere sphere-1"></div>
        <div class="glow-sphere sphere-2"></div>
    </div>

    <!-- Application Navigation Header -->
    <header class="app-header">
        <div class="header-logo">
            <i class="ph-bold ph-activity logo-icon"></i>
            <span class="logo-text">Rad<span class="logo-highlight">Sphere</span></span>
        </div>
        <nav class="nav-tabs">
            <button id="tab-researcher-btn" class="nav-btn active" onclick="switchMode('researcher')">
                <i class="ph ph-microscope"></i> Researcher Workspace
            </button>
            <button id="tab-student-btn" class="nav-btn" onclick="switchMode('student')">
                <i class="ph ph-student"></i> Student Arena
            </button>
        </nav>
    </header>

    <!-- Main Workspace Container -->
    <main class="app-container">
        
        <!-- ==================== RESEARCHER WORKSPACE ==================== -->
        <section id="tab-researcher" class="tab-content active">
            <div class="hero-section">
                <h1>Annotate Pathology on DICOM Images</h1>
                <p class="subtitle">Upload a radiology scan, inspect the DICOM header metadata, and draw a polygon marking the pathological boundaries.</p>
            </div>
            
            <div class="workspace-grid">
                <!-- Left Control Panel -->
                <div class="glass-card">
                    <div class="panel-header">
                        <i class="ph-bold ph-folder-open panel-icon"></i>
                        <h3>Source Image Upload</h3>
                    </div>
                    
                    <!-- Upload Dropzone -->
                    <div class="upload-zone" id="researcher-upload-zone">
                        <i class="ph ph-cloud-arrow-up upload-icon"></i>
                        <h4 class="upload-title">Drag & drop DICOM file</h4>
                        <p class="upload-subtitle">Supports raw .dcm format</p>
                        <input type="file" id="researcher-file-input" class="file-input" accept=".dcm">
                    </div>
                    
                    <div class="demo-divider">OR</div>
                    
                    <!-- Demo Mode Action -->
                    <button id="btn-load-demo" class="btn btn-secondary" onclick="loadDemoDicom()">
                        <i class="ph ph-sparkle"></i> Load Demo Chest X-Ray
                    </button>
                    
                    <!-- Metadata Box -->
                    <div class="metadata-container" id="researcher-metadata-container" style="display: none;">
                        <h4 class="metadata-title"><i class="ph ph-info"></i> DICOM Header Details</h4>
                        <div class="metadata-grid">
                            <div class="metadata-row">
                                <span class="meta-label">Patient Name</span>
                                <span class="meta-val" id="r-meta-patient">--</span>
                            </div>
                            <div class="metadata-row">
                                <span class="meta-label">Patient ID</span>
                                <span class="meta-val" id="r-meta-patient-id">--</span>
                            </div>
                            <div class="metadata-row">
                                <span class="meta-label">Modality</span>
                                <span class="meta-val" id="r-meta-modality">--</span>
                            </div>
                            <div class="metadata-row">
                                <span class="meta-label">Image Resolution</span>
                                <span class="meta-val" id="r-meta-dims">--</span>
                            </div>
                            <div class="metadata-row">
                                <span class="meta-label">Window Center/Width</span>
                                <span class="meta-val" id="r-meta-window">--</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Pathology Draw Controls -->
                    <div class="metadata-container" id="researcher-draw-container" style="display: none;">
                        <h4 class="metadata-title"><i class="ph ph-pencil-line"></i> Pathology Annotation</h4>
                        
                        <div class="form-group">
                            <label for="input-pathology-name">Pathology Label</label>
                            <input type="text" id="input-pathology-name" class="form-input" placeholder="e.g. Pleural Effusion, Nodule">
                        </div>
                        
                        <div class="button-group">
                            <button id="btn-clear-points" class="btn btn-secondary" onclick="clearPolygon()">
                                <i class="ph ph-trash"></i> Reset
                            </button>
                            <button id="btn-close-polygon" class="btn btn-secondary" onclick="closePolygon()">
                                <i class="ph ph-polygon"></i> Close Loop
                            </button>
                            <button id="btn-confirm-pathology" class="btn btn-success button-group-full" onclick="confirmAnnotation()" style="margin-top: 0.5rem;" disabled>
                                <i class="ph ph-check-circle"></i> Confirm Pathology
                            </button>
                        </div>
                        
                        <div class="form-group" id="download-group" style="display: none; margin-top: 1rem;">
                            <button id="btn-download-package" class="btn btn-primary" onclick="downloadPackage()">
                                <i class="ph ph-download-simple"></i> Download Annotated ZIP
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- Right Canvas Viewport -->
                <div class="glass-card canvas-panel">
                    <div class="canvas-header">
                        <div class="canvas-title-text" id="r-canvas-title">
                            <i class="ph ph-image"></i> Workspace Viewer
                        </div>
                        <span class="canvas-subtitle-tag" id="r-status-badge">Empty</span>
                    </div>
                    
                    <div class="canvas-frame" id="researcher-canvas-frame">
                        <div class="canvas-placeholder" id="researcher-canvas-placeholder">
                            <i class="ph ph-heartbeat placeholder-icon"></i>
                            <h3>No scan uploaded yet</h3>
                            <p>Upload a .dcm file or run the demo to start drawing boundaries</p>
                        </div>
                        <canvas id="r-dicom-canvas" style="display: none;"></canvas>
                        <canvas id="r-draw-canvas" style="display: none;"></canvas>
                    </div>
                    
                    <div class="canvas-hints">
                        <span class="hint-item"><i class="ph ph-mouse hint-icon"></i> Left-Click to add anchor points</span>
                        <span class="hint-item"><i class="ph ph-arrow-bend-down-right hint-icon"></i> Close loop near start or click "Close Loop"</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- ==================== STUDENT TRAINING ARENA ==================== -->
        <section id="tab-student" class="tab-content">
            <div class="hero-section">
                <h1>Student Diagnostic Assessment Arena</h1>
                <p class="subtitle">Upload an annotated package, identify the abnormalities, and draw your diagnosis to test your boundary accuracy.</p>
            </div>
            
            <div class="workspace-grid">
                <!-- Left Control Panel -->
                <div class="glass-card">
                    <div class="panel-header">
                        <i class="ph-bold ph-sparkle panel-icon"></i>
                        <h3>Diagnosis Package Upload</h3>
                    </div>
                    
                    <!-- Upload Dropzone -->
                    <div class="upload-zone" id="student-upload-zone">
                        <i class="ph ph-file-archive upload-icon"></i>
                        <h4 class="upload-title">Upload annotated ZIP package</h4>
                        <p class="upload-subtitle">Select the package generated in Researcher Mode</p>
                        <input type="file" id="student-file-input" class="file-input" accept=".zip">
                    </div>
                    
                    <!-- Metadata Box -->
                    <div class="metadata-container" id="student-metadata-container" style="display: none;">
                        <h4 class="metadata-title"><i class="ph ph-info"></i> Patient Metadata</h4>
                        <div class="metadata-grid">
                            <div class="metadata-row">
                                <span class="meta-label">Patient Name</span>
                                <span class="meta-val" id="s-meta-patient">--</span>
                            </div>
                            <div class="metadata-row">
                                <span class="meta-label">Patient ID</span>
                                <span class="meta-val" id="s-meta-patient-id">--</span>
                            </div>
                            <div class="metadata-row">
                                <span class="meta-label">Modality</span>
                                <span class="meta-val" id="s-meta-modality">--</span>
                            </div>
                            <div class="metadata-row">
                                <span class="meta-label">Image Resolution</span>
                                <span class="meta-val" id="s-meta-dims">--</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Student Draw Controls -->
                    <div class="metadata-container" id="student-draw-container" style="display: none;">
                        <h4 class="metadata-title"><i class="ph ph-pencil-line"></i> Drawing Tools</h4>
                        
                        <div class="button-group">
                            <button id="btn-s-clear-points" class="btn btn-secondary" onclick="clearStudentPolygon()">
                                <i class="ph ph-trash"></i> Reset drawing
                            </button>
                            <button id="btn-s-close-polygon" class="btn btn-secondary" onclick="closeStudentPolygon()">
                                <i class="ph ph-polygon"></i> Close Loop
                            </button>
                            <button id="btn-submit-attempt" class="btn btn-primary button-group-full" onclick="gradeStudentAttempt()" style="margin-top: 0.5rem;" disabled>
                                <i class="ph ph-sparkle"></i> Submit Diagnosis
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- Right Canvas Viewport -->
                <div class="glass-card canvas-panel">
                    <div class="canvas-header">
                        <div class="canvas-title-text" id="s-canvas-title">
                            <i class="ph ph-student"></i> Diagnostic Screen
                        </div>
                        <span class="canvas-subtitle-tag student" id="s-status-badge">Locked</span>
                    </div>
                    
                    <div class="canvas-frame" id="student-canvas-frame">
                        <div class="canvas-placeholder" id="student-canvas-placeholder">
                            <i class="ph ph-lock placeholder-icon"></i>
                            <h3>No package loaded</h3>
                            <p>Upload a .zip pathology package to unlock the workspace viewer</p>
                        </div>
                        <canvas id="s-dicom-canvas" style="display: none;"></canvas>
                        <canvas id="s-draw-canvas" style="display: none;"></canvas>
                    </div>
                    
                    <div class="canvas-hints">
                        <span class="hint-item"><i class="ph ph-mouse hint-icon"></i> Draw around the suspected pathological lesion</span>
                        <span class="hint-item"><i class="ph ph-info hint-icon"></i> Overlap is graded against the expert baseline</span>
                    </div>
                </div>
            </div>
        </section>
    </main>

    <!-- Grading Result Modal -->
    <div class="modal-overlay" id="grading-modal" onclick="closeGradingModal(event)">
        <div class="modal-content" onclick="event.stopPropagation()">
            <button class="modal-close" onclick="closeGradingModal()"><i class="ph ph-x"></i></button>
            <div id="modal-content-details">
                <!-- Loaded dynamically by JavaScript -->
            </div>
        </div>
    </div>

    <!-- Sticky Footer -->
    <footer class="app-footer">
        <p>&copy; 2026 RadSphere. Built for clinical training and radiology research validation. Fully localized & secure.</p>
        <p style="margin-top: 0.5rem; font-size: 0.75rem;">
            <a href="radsphere_project.zip" download id="download-project-source" style="color: var(--color-primary); text-decoration: underline; cursor: pointer;">
                <i class="ph ph-download-simple"></i> Download Complete Project Source (.zip)
            </a>
        </p>
    </footer>

    <!-- Main Logic Script -->
    <script src="script.js"></script>
</body>
</html>
