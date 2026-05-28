// ASTROPHYSICS LAB - KEPLER'S LAWS SIMULATION (js/kepler.js)
// Física Aplicada: Primeira Lei (Elipses), Segunda Lei (Áreas em tempos iguais) e Terceira Lei (Períodos T² = a³)

class KeplerSimulation {
    constructor() {
        this.container = document.getElementById("kepler-canvas-container");
        this.isActive = true;
        
        // Physics parameters (Standardized units where G=1, M=1, a=1 => T = 2*pi)
        this.a = 1.0;          // Semi-major axis (AU)
        this.ecc = 0.02;       // Eccentricity
        this.mStar = 1.0;      // Star mass (solar masses)
        this.simulationSpeed = 1.0;
        this.showAreas = true;
        this.dtWedgeMonths = 2.0; // Time sweep window for 2nd law areas (months)
        
        // Simulation time
        this.t = 0; 
        
        // UI Elements
        this.initUI();
        
        // Three.js Setup
        this.initThree();
        
        // Create Scene Objects
        this.createSolarSystem();
        
        // Initialize to 1st Law visual states now that Three.js objects are created
        this.selectLawTab(1);
        
        // Register in main controller
        window.AstrophysicsLab.simulations['kepler'] = this;
        
        // Start Loop
        this.animate();
    }

    initUI() {
        // Study Modules Buttons
        this.btnLaw1 = document.getElementById("btn-k-law1");
        this.btnLaw2 = document.getElementById("btn-k-law2");
        this.btnLaw3 = document.getElementById("btn-k-law3");
        
        this.groupLaw1 = document.getElementById("group-k-law1");
        this.groupLaw2 = document.getElementById("group-k-law2");
        this.groupLaw3 = document.getElementById("group-k-law3");

        // Range Sliders
        this.sliderA = document.getElementById("slider-k-a");
        this.sliderEcc = document.getElementById("slider-k-ecc");
        this.sliderMStar = document.getElementById("slider-k-mstar");
        this.sliderDt = document.getElementById("slider-k-dt");
        this.sliderSpeed = document.getElementById("slider-k-speed");
        this.toggleAreas = document.getElementById("toggle-k-areas");
        this.btnReset = document.getElementById("btn-k-reset");
        this.selectPlanet = document.getElementById("select-k-planet");
        
        // Value Monitors
        this.valA = document.getElementById("val-k-a");
        this.valEcc = document.getElementById("val-k-ecc");
        this.valMStar = document.getElementById("val-k-mstar");
        this.valDt = document.getElementById("val-k-dt");
        this.formulaCard = document.getElementById("formula-3rd-law");
        
        // Metrics HUD
        this.metricM = document.getElementById("metric-k-m");
        this.metricE = document.getElementById("metric-k-e");
        this.metricV = document.getElementById("metric-k-v");
        this.metricR = document.getElementById("metric-k-r");

        // 1. Study Modules Tab Controls
        this.selectLawTab = (lawNum) => {
            [this.btnLaw1, this.btnLaw2, this.btnLaw3].forEach((btn, idx) => {
                btn.classList.remove("active");
                if (idx + 1 === lawNum) btn.classList.add("active");
            });

            [this.groupLaw1, this.groupLaw2, this.groupLaw3].forEach((group, idx) => {
                group.style.display = (idx + 1 === lawNum) ? 'block' : 'none';
            });

            // Adjust ThreeJS visuals dynamically based on active sub-law study module
            if (lawNum === 1) {
                this.focusRing.visible = true;
                this.axisGroup.visible = true;
                this.areaLabel.style.display = 'none';
                this.velArrow.visible = false;
                this.gravArrow.visible = false;
                this.wedgesGroup.visible = false;
            } else if (lawNum === 2) {
                this.focusRing.visible = false;
                this.axisGroup.visible = false;
                this.areaLabel.style.display = this.showAreas ? 'block' : 'none';
                this.velArrow.visible = true;
                this.gravArrow.visible = true;
                this.wedgesGroup.visible = this.showAreas;
            } else if (lawNum === 3) {
                this.focusRing.visible = false;
                this.axisGroup.visible = false;
                this.areaLabel.style.display = 'none';
                this.velArrow.visible = false;
                this.gravArrow.visible = false;
                this.wedgesGroup.visible = false;
            }
        };

        this.btnLaw1.addEventListener("click", () => this.selectLawTab(1));
        this.btnLaw2.addEventListener("click", () => this.selectLawTab(2));
        this.btnLaw3.addEventListener("click", () => this.selectLawTab(3));

        // 2. Real Planets Dataset Selector
        this.selectPlanet.addEventListener("change", (e) => {
            const planet = e.target.value;
            if (planet === "custom") return;

            // Planet parameters: [semi-major axis (a), eccentricity (e)]
            const planetsData = {
                mercury: { a: 0.387, e: 0.206, scale: 3.5 },
                venus:   { a: 0.723, e: 0.007, scale: 2.2 },
                earth:   { a: 1.000, e: 0.017, scale: 1.8 },
                mars:    { a: 1.524, e: 0.093, scale: 1.3 },
                jupiter: { a: 5.204, e: 0.048, scale: 0.38 },
                saturn:  { a: 9.582, e: 0.054, scale: 0.20 }
            };

            const data = planetsData[planet];
            if (data) {
                this.a = data.a;
                this.ecc = data.e;
                this.scale = data.scale; // adjust display scale dynamically so big planets fit the canvas!

                // Sync sliders and value monitors
                this.sliderA.value = this.a;
                this.valA.textContent = this.a.toFixed(2);
                
                this.sliderEcc.value = this.ecc;
                this.valEcc.textContent = this.ecc.toFixed(2);

                this.updateOrbitGeometry();
                this.updateThirdLawHUD();
                this.t = 0;
                this.clearWedges();
            }
        });

        // Sliders Listeners
        this.sliderA.addEventListener("input", (e) => {
            this.a = parseFloat(e.target.value);
            this.valA.textContent = this.a.toFixed(2);
            this.selectPlanet.value = "custom";
            this.scale = 2.0; // Reset to default scale
            this.updateOrbitGeometry();
            this.updateThirdLawHUD();
        });

        this.sliderEcc.addEventListener("input", (e) => {
            this.ecc = parseFloat(e.target.value);
            this.valEcc.textContent = this.ecc.toFixed(2);
            this.selectPlanet.value = "custom";
            this.updateOrbitGeometry();
            this.updateThirdLawHUD();
        });

        this.sliderMStar.addEventListener("input", (e) => {
            this.mStar = parseFloat(e.target.value);
            this.valMStar.textContent = this.mStar.toFixed(1);
            this.updateThirdLawHUD();
        });

        this.sliderDt.addEventListener("input", (e) => {
            this.dtWedgeMonths = parseFloat(e.target.value);
            this.valDt.textContent = this.dtWedgeMonths.toFixed(1);
            this.updateWedges();
        });

        this.sliderSpeed.addEventListener("input", (e) => {
            this.simulationSpeed = parseFloat(e.target.value);
        });

        this.toggleAreas.addEventListener("change", (e) => {
            this.showAreas = e.target.checked;
            this.wedgesGroup.visible = this.showAreas;
        });

        this.btnReset.addEventListener("click", () => {
            this.t = 0;
            this.clearWedges();
        });
    }

    initThree() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        // Scene
        this.scene = new THREE.Scene();

        // Camera
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        this.camera.position.set(0, 4, 6);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2.1; // Don't go completely under the plane

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
        this.scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0xffffff, 1.8, 100);
        this.scene.add(pointLight);

        // Groups
        this.wedgesGroup = new THREE.Group();
        this.scene.add(this.wedgesGroup);

        // Grid Plane Helper (Dark Cybernetic Look)
        const gridHelper = new THREE.GridHelper(12, 24, 0x00d2ff, 0x222233);
        gridHelper.position.y = -0.01;
        gridHelper.material.opacity = 0.15;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);

        // Handle Resizing
        window.addEventListener("resize", () => this.resize());
    }

    createSolarSystem() {
        // Scale constant: 1 AU is approximately 2.0 units in Three.js
        this.scale = 2.0;

        // 1. Central Star (Sun)
        const starGeo = new THREE.SphereGeometry(0.24, 32, 32);
        const starMat = new THREE.MeshBasicMaterial({
            color: 0xffa500,
            toneMapped: false
        });
        this.starMesh = new THREE.Mesh(starGeo, starMat);
        this.scene.add(this.starMesh);

        // Glowing Star Crown
        const starGlowGeo = new THREE.SphereGeometry(0.32, 16, 16);
        const starGlowMat = new THREE.MeshBasicMaterial({
            color: 0xffd700,
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending
        });
        this.starGlow = new THREE.Mesh(starGlowGeo, starGlowMat);
        this.scene.add(this.starGlow);

        // 2. The Orbiting Planet
        const planetGeo = new THREE.SphereGeometry(0.08, 32, 32);
        const planetMat = new THREE.MeshPhongMaterial({
            color: 0x00d2ff,
            emissive: 0x002244,
            shininess: 80
        });
        this.planetMesh = new THREE.Mesh(planetGeo, planetMat);
        this.scene.add(this.planetMesh);

        // Planet Trail
        const trailLimit = 150;
        const trailGeo = new THREE.BufferGeometry();
        this.trailPositions = new Float32Array(trailLimit * 3);
        trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
        const trailMat = new THREE.LineBasicMaterial({
            color: 0x00f5d4,
            transparent: true,
            opacity: 0.4
        });
        this.trailLine = new THREE.Line(trailGeo, trailMat);
        this.scene.add(this.trailLine);
        this.trailCount = 0;

        // 3. Orbital Path Wireframe (1st Law)
        this.orbitPathGeo = new THREE.BufferGeometry();
        const orbitPathMat = new THREE.LineBasicMaterial({
            color: 0xff2a6d,
            transparent: true,
            opacity: 0.5,
            linewidth: 1
        });
        this.orbitPathLine = new THREE.Line(this.orbitPathGeo, orbitPathMat);
        this.scene.add(this.orbitPathLine);

        // 4. Physical Vectors (Velocity & Gravity)
        this.velArrow = new THREE.ArrowHelper(
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 0, 0),
            0.6,
            0x00f5d4, // Cyan for velocity
            0.15,
            0.05
        );
        this.gravArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, 0, 0),
            0.6,
            0xff2a6d, // Red for gravitational force
            0.15,
            0.05
        );
        this.scene.add(this.velArrow);
        this.scene.add(this.gravArrow);

        // Focus & Center markers (subtle rings)
        const focusRingGeo = new THREE.RingGeometry(0.04, 0.05, 16);
        const focusRingMat = new THREE.MeshBasicMaterial({ color: 0xff2a6d, side: THREE.DoubleSide, opacity: 0.3, transparent: true });
        this.focusRing = new THREE.Mesh(focusRingGeo, focusRingMat);
        this.focusRing.rotation.x = Math.PI / 2;
        this.scene.add(this.focusRing);

        // Major and Minor Axes (1st Law)
        this.axisGroup = new THREE.Group();
        const axisMat = new THREE.LineDashedMaterial({ color: 0x00d2ff, dashSize: 0.1, gapSize: 0.05, opacity: 0.5, transparent: true });
        
        this.majorAxisGeo = new THREE.BufferGeometry();
        this.majorAxisLine = new THREE.Line(this.majorAxisGeo, axisMat);
        this.axisGroup.add(this.majorAxisLine);

        this.minorAxisGeo = new THREE.BufferGeometry();
        this.minorAxisLine = new THREE.Line(this.minorAxisGeo, axisMat);
        this.axisGroup.add(this.minorAxisLine);
        
        this.scene.add(this.axisGroup);
        
        // HTML Area Label (2nd Law)
        this.areaLabel = document.createElement('div');
        this.areaLabel.style.position = 'absolute';
        this.areaLabel.style.color = '#fff';
        this.areaLabel.style.fontFamily = 'monospace';
        this.areaLabel.style.fontSize = '11px';
        this.areaLabel.style.background = 'rgba(0, 245, 212, 0.2)';
        this.areaLabel.style.border = '1px solid #00f5d4';
        this.areaLabel.style.padding = '2px 4px';
        this.areaLabel.style.borderRadius = '3px';
        this.areaLabel.style.pointerEvents = 'none';
        this.areaLabel.style.transform = 'translate(-50%, -50%)';
        this.areaLabel.style.display = 'none';
        this.areaLabel.style.zIndex = '10';
        this.container.appendChild(this.areaLabel);
        
        // 3rd Law Graph state
        this.graphHistory = [];


        // Wedge tracker for the Second Law
        this.areaWedges = [];
        this.lastWedgeTime = 0;

        // Initial setup
        this.updateOrbitGeometry();
        this.updateThirdLawHUD();
    }

    // Solves Kepler's Equation M = E - e*sin(E) using Newton-Raphson
    solveKepler(M, e) {
        let E = M; // Initial guess
        const tolerance = 1e-6;
        const maxIterations = 100;
        
        for (let i = 0; i < maxIterations; i++) {
            const deltaE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
            E -= deltaE;
            if (Math.abs(deltaE) < tolerance) break;
        }
        return E;
    }

    updateOrbitGeometry() {
        // Recalculate foci and draw the static orbit path (ellipse)
        const points = [];
        const segments = 128;
        const focalDist = this.a * this.ecc * this.scale;
        
        // The star (Sun) is at the origin (0, 0, 0).
        // Since the star is at one of the foci, the center of the ellipse is shifted to (-focalDist, 0, 0)
        this.centerX = -focalDist; 

        // Update Focus Ring position (the other empty focus)
        this.focusRing.position.set(-focalDist * 2, 0, 0);

        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            // Ellipse parametric equations relative to the center:
            // x = a * cos(theta), z = b * sin(theta)
            const b = this.a * Math.sqrt(1 - this.ecc * this.ecc);
            const x = this.centerX + this.a * Math.cos(theta) * this.scale;
            const z = this.a * Math.sqrt(1 - this.ecc * this.ecc) * Math.sin(theta) * this.scale;
            points.push(new THREE.Vector3(x, 0, z));
        }

        this.orbitPathGeo.setFromPoints(points);
        
        // Update Axes Geometry
        const bLine = this.a * Math.sqrt(1 - this.ecc * this.ecc) * this.scale;
        const aLine = this.a * this.scale;
        
        this.majorAxisGeo.setFromPoints([
            new THREE.Vector3(this.centerX - aLine, 0, 0),
            new THREE.Vector3(this.centerX + aLine, 0, 0)
        ]);
        this.majorAxisLine.computeLineDistances();
        
        this.minorAxisGeo.setFromPoints([
            new THREE.Vector3(this.centerX, 0, -bLine),
            new THREE.Vector3(this.centerX, 0, bLine)
        ]);
        this.minorAxisLine.computeLineDistances();
        
        this.clearWedges();
    }

    updateThirdLawHUD() {
        // T^2 = a^3 / M
        const aCubed = Math.pow(this.a, 3);
        const tSquared = aCubed / this.mStar;
        const period = Math.sqrt(tSquared);
        const ratio = tSquared / aCubed;

        this.formulaCard.innerHTML = `T² = a³ / M_estrela\nT = ${period.toFixed(2)} anos | T² = ${tSquared.toFixed(2)}\na³ = ${aCubed.toFixed(2)} | Razão T²/a³ = ${ratio.toFixed(3)}`;
    }

    // Dynamic Areas Wedges (2nd Law)
    addAreaWedge(tStart, tEnd) {
        const segments = 24;
        const vertices = [0, 0, 0]; // Sun at origin is the apex of the wedge
        
        const E_start = this.solveKepler(tStart, this.ecc);
        const E_end = this.solveKepler(tEnd, this.ecc);
        
        const b = this.a * Math.sqrt(1 - this.ecc * this.ecc);
        
        for (let i = 0; i <= segments; i++) {
            const tInterp = i / segments;
            const E = E_start + (E_end - E_start) * tInterp;
            
            // X and Z coordinates of orbit
            const x = this.centerX + this.a * Math.cos(E) * this.scale;
            const z = b * Math.sin(E) * this.scale;
            
            vertices.push(x, 0, z);
        }

        // Build planar geometry
        const wedgeGeo = new THREE.BufferGeometry();
        const wedgePositions = new Float32Array(vertices);
        wedgeGeo.setAttribute('position', new THREE.BufferAttribute(wedgePositions, 3));

        // Create index buffer to draw triangles from origin apex (0) to outer points (1..segments+1)
        const indices = [];
        for (let i = 1; i <= segments; i++) {
            indices.push(0, i, i + 1);
        }
        wedgeGeo.setIndex(indices);
        wedgeGeo.computeVertexNormals();

        // Harmonious rotating colors or alternating hues
        const colorPalette = [0x00f5d4, 0x00d2ff, 0x9d4edd];
        const wedgeColor = colorPalette[this.areaWedges.length % colorPalette.length];
        
        const wedgeMat = new THREE.MeshBasicMaterial({
            color: wedgeColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.28,
            depthWrite: false
        });

        const wedgeMesh = new THREE.Mesh(wedgeGeo, wedgeMat);
        this.wedgesGroup.add(wedgeMesh);
        this.areaWedges.push({
            mesh: wedgeMesh,
            tStart: tStart,
            tEnd: tEnd
        });

        // Limit wedges to keep screen clean (max 8)
        if (this.areaWedges.length > 8) {
            const oldWedge = this.areaWedges.shift();
            this.wedgesGroup.remove(oldWedge.mesh);
            oldWedge.mesh.geometry.dispose();
            oldWedge.mesh.material.dispose();
        }
    }

    clearWedges() {
        while (this.areaWedges.length > 0) {
            const wedge = this.areaWedges.pop();
            this.wedgesGroup.remove(wedge.mesh);
            wedge.mesh.geometry.dispose();
            wedge.mesh.material.dispose();
        }
        this.lastWedgeTime = this.t;
    }

    updateWedges() {
        this.clearWedges();
    }

    resize() {
        if (!this.container) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width === 0 || height === 0) return; // Safeguard against 0px dimensions when hidden
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    pause() {
        this.isActive = true;
    }

    resume() {
        this.isActive = true;
        setTimeout(() => {
            this.resize();
        }, 50);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (!this.isActive || window.AstrophysicsLab.activeTab !== 'kepler') return;

        this.controls.update();

        // 1. Time Advancement based on Kepler's 3rd Law Period
        // Period T = 2 * pi * sqrt( a^3 / M ) in scaled units
        const period = 2 * Math.PI * Math.sqrt(Math.pow(this.a, 3) / this.mStar);
        
        // Speed up simulation scaling
        const baseSpeed = 0.005;
        this.t += baseSpeed * this.simulationSpeed * (2 * Math.PI / period);

        // 2. Orbital Physics Calculations
        // Mean Anomaly (M)
        const M = this.t % (Math.PI * 2);
        // Eccentric Anomaly (E)
        const E = this.solveKepler(M, this.ecc);
        // True Anomaly (theta)
        const theta = 2 * Math.atan(Math.sqrt((1 + this.ecc) / (1 - this.ecc)) * Math.tan(E / 2));

        // Semi-minor axis (b)
        const b = this.a * Math.sqrt(1 - this.ecc * this.ecc);

        // Positional Coordinates (relative to the Star focus at (0,0,0))
        const pX = this.centerX + this.a * Math.cos(E) * this.scale;
        const pZ = b * Math.sin(E) * this.scale;

        this.planetMesh.position.set(pX, 0, pZ);

        // Real distance (r) in Astronomical Units (AU)
        const r_AU = this.a * (1 - this.ecc * Math.cos(E));
        
        // 3. Orbital Velocity Vector v = sqrt(GM * (2/r - 1/a))
        const vScale = 29.78; // Earth's average speed is ~29.78 km/s
        // Kepler velocity magnitude (real physical formula):
        const vMag = Math.sqrt(this.mStar * (2 / r_AU - 1 / this.a));
        const velocity_kms = vMag * vScale;

        // Gravity vector magnitude (1/r^2)
        const gMag = this.mStar / (r_AU * r_AU);

        // Update Planet Trail
        const posAttr = this.trailLine.geometry.attributes.position;
        // Shift trail history
        for (let i = posAttr.count - 1; i > 0; i--) {
            posAttr.setXYZ(i, posAttr.getX(i - 1), posAttr.getY(i - 1), posAttr.getZ(i - 1));
        }
        posAttr.setXYZ(0, pX, 0, pZ);
        posAttr.needsUpdate = true;

        if (this.trailCount < posAttr.count) {
            this.trailCount++;
            this.trailLine.geometry.setDrawRange(0, this.trailCount);
        }

        // 4. Update Vectors (Arrows)
        // Direction of velocity is tangent to the ellipse:
        // derivative dr/dE = (-a*sin(E), 0, b*cos(E))
        const vDir = new THREE.Vector3(-this.a * Math.sin(E), 0, b * Math.cos(E)).normalize();
        this.velArrow.position.set(pX, 0, pZ);
        this.velArrow.setDirection(vDir);
        this.velArrow.setLength(Math.max(0.2, vMag * 0.5));

        // Direction of gravity is directly towards the star at (0,0,0)
        const gDir = new THREE.Vector3(-pX, 0, -pZ).normalize();
        this.gravArrow.position.set(pX, 0, pZ);
        this.gravArrow.setDirection(gDir);
        this.gravArrow.setLength(Math.max(0.2, gMag * 0.3));

        // Rotate Star gently for realism
        this.starMesh.rotation.y += 0.005;
        this.starGlow.scale.setScalar(1.0 + Math.sin(this.t * 8) * 0.05);

        // 5. Area Wedges Generation (2nd Law)
        // Convert wedge interval from months to mean anomaly delta (2pi = 12 months => months * 2pi/12)
        const dtWedgeRad = (this.dtWedgeMonths / 12) * Math.PI * 2;
        
        if (this.showAreas) {
            // Check if enough time has passed to seed a new equal-time area wedge
            if (this.t - this.lastWedgeTime >= dtWedgeRad) {
                this.addAreaWedge(this.lastWedgeTime, this.t);
                this.lastWedgeTime = this.t;
            }
        }

        // 5.5 Update HTML Label Position for newest wedge
        if (this.showAreas && this.areaWedges.length > 0 && window.AstrophysicsLab.activeTab === 'kepler' && this.groupLaw2.style.display !== 'none') {
            const lastWedge = this.areaWedges[this.areaWedges.length - 1];
            // Midpoint of the wedge
            const tMid = (lastWedge.tStart + lastWedge.tEnd) / 2;
            const EMid = this.solveKepler(tMid, this.ecc);
            const midX = this.centerX + this.a * Math.cos(EMid) * this.scale;
            const midZ = b * Math.sin(EMid) * this.scale;
            
            // Project to 2D screen space
            const vector = new THREE.Vector3(midX * 0.5, 0, midZ * 0.5); // Place label halfway to the planet
            vector.project(this.camera);
            
            const x = (vector.x * .5 + .5) * this.container.clientWidth;
            const y = (vector.y * -.5 + .5) * this.container.clientHeight;
            
            // Calculate theoretical area speed dA/dt = L / (2m)
            const areaSpeed = Math.sqrt(this.mStar * this.a * (1 - this.ecc*this.ecc)) / 2;
            const area = areaSpeed * (this.dtWedgeMonths / 12 * Math.PI * 2);
            
            this.areaLabel.style.display = 'block';
            this.areaLabel.style.left = x + 'px';
            this.areaLabel.style.top = y + 'px';
            this.areaLabel.innerText = "A = " + area.toFixed(3);
        } else {
            if(this.areaLabel) this.areaLabel.style.display = 'none';
        }
        
        // 5.6 Draw T^2 vs a^3 graph if active
        if (this.groupLaw3.style.display !== 'none') {
            const canvas = document.getElementById("kepler-graph-canvas");
            if (canvas) {
                const ctx = canvas.getContext("2d");
                
                const rect = canvas.parentElement.getBoundingClientRect();
                if(rect.width > 0 && canvas.width !== rect.width * 2) {
                    canvas.width = rect.width * 2;
                    canvas.height = rect.height * 2;
                }
                const w = canvas.width;
                const h = canvas.height;
                if(w === 0) return;
                
                ctx.save();
                ctx.scale(2, 2);
                const drawW = w / 2;
                const drawH = h / 2;
                ctx.clearRect(0, 0, drawW, drawH);
                
                // Draw axes
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.beginPath();
                ctx.moveTo(30, 10); ctx.lineTo(30, drawH-20); // Y axis (T^2)
                ctx.lineTo(drawW-10, drawH-20); // X axis (a^3)
                ctx.stroke();
                ctx.fillStyle = "rgba(255,255,255,0.5)";
                ctx.font = "10px sans-serif";
                ctx.fillText("a³", drawW-20, drawH-5);
                ctx.fillText("T²", 10, 20);
                
                // Add current point to history if not there
                const aCubed = Math.pow(this.a, 3);
                const tSquared = aCubed / this.mStar;
                
                let found = false;
                for(let p of this.graphHistory) {
                    if (Math.abs(p.a3 - aCubed) < 0.1) { found = true; break; }
                ctx.restore();
                }
                if (!found) this.graphHistory.push({a3: aCubed, t2: tSquared});
                
                // Draw points and line
                const maxA3 = Math.max(10, ...this.graphHistory.map(p=>p.a3));
                const maxT2 = Math.max(10, ...this.graphHistory.map(p=>p.t2));
                
                ctx.strokeStyle = "#00d2ff";
                ctx.beginPath();
                ctx.moveTo(30, h-20);
                
                this.graphHistory.sort((A,B)=>A.a3-B.a3).forEach(p => {
                    const px = 30 + (p.a3 / maxA3) * (w - 50);
                    const py = (h - 20) - (p.t2 / maxT2) * (h - 40);
                    ctx.lineTo(px, py);
                    ctx.fillStyle = "#ff2a6d";
                    ctx.beginPath();
                    ctx.arc(px, py, 3, 0, Math.PI*2);
                    ctx.fill();
                });
                ctx.stroke();
                
                // Draw current floating point
                const cx = 30 + (aCubed / maxA3) * (w - 50);
                const cy = (h - 20) - (tSquared / maxT2) * (h - 40);
                ctx.fillStyle = "#ffffff";
                ctx.beginPath();
                ctx.arc(cx, cy, 5, 0, Math.PI*2);
                ctx.fill();
            }
        }

        // 6. Update HUD Metrics
        this.metricM.textContent = M.toFixed(3) + " rad";
        this.metricE.textContent = E.toFixed(3) + " rad";
        this.metricV.textContent = velocity_kms.toFixed(2) + " km/s";
        this.metricR.textContent = r_AU.toFixed(2) + " UA";

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }
}

// Instantiate simulation when scripts are loaded
new KeplerSimulation();
