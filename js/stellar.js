// ASTROPHYSICS LAB - STELLAR SIMULATION (js/stellar.js)
// Física Estelar Avançada: Fusão Termonuclear p-p e CNO, Diagrama H-R interativo e Evolução de Gigantes Vermelhas, Anãs Brancas e Supernovas de Colapso de Núcleo.

class StellarSimulation {
    constructor() {
        this.container = document.getElementById("stellar-canvas-container");
        this.isActive = false; // Starts inactive until tab switch
        
        // Physical parameters (Sun = 1)
        this.mass = 1.0;        // Solar masses (M_sun)
        this.temp = 5778;       // Effective temperature (K)
        this.lum = 1.0;         // Luminosity (L_sun)
        this.radius = 1.0;      // Radius (R_sun)
        
        // Core nuclear states
        this.tc = 15.6e6;       // Central temperature (K)
        this.rhoCentral = 150;  // Central density (g/cm^3)
        this.ppFraction = 1.0;
        this.cnoFraction = 0.0;
        this.lifetime = 10.0;   // In billion years
        
        // Evolutionary states: 'main_sequence', 'giant', 'nebula', 'white_dwarf', 'supernova', 'remanent'
        this.state = 'main_sequence';
        this.deathSequenceActive = false;
        this.deathTimer = 0;
        
        // Register in global scope
        window.AstrophysicsLab.simulations['stellar'] = this;
        
        // Initializations
        this.initUI();
        this.initThree();
        this.initHRDiagram();
        this.updateStellarPhysics();
        
        // Start Render Loop
        this.animate();
    }

    initUI() {
        this.sliderMass = document.getElementById("slider-s-mass");
        this.sliderTemp = document.getElementById("slider-s-temp");
        this.valMass = document.getElementById("val-s-mass");
        this.valTemp = document.getElementById("val-s-temp");
        this.valLum = document.getElementById("val-s-lum");
        
        this.valPP = document.getElementById("val-s-pp");
        this.valCNO = document.getElementById("val-s-cno");
        this.barPP = document.getElementById("bar-s-pp");
        this.barCNO = document.getElementById("bar-s-cno");
        
        this.metricRadius = document.getElementById("metric-s-r");
        this.metricTc = document.getElementById("metric-s-tc");
        this.metricPres = document.getElementById("metric-s-pres");
        this.metricTime = document.getElementById("metric-s-time");
        
        this.btnEvolve = document.getElementById("btn-s-evolve");
        
        // Alert Modal Elements
        this.alertModal = document.getElementById("stellar-alert");
        this.alertTitle = document.getElementById("alert-title");
        this.alertDesc = document.getElementById("alert-desc");
        this.btnAlertClose = document.getElementById("btn-alert-close");

        // Input Handlers
        this.sliderMass.addEventListener("input", (e) => {
            if (this.deathSequenceActive) return;
            this.mass = parseFloat(e.target.value);
            this.valMass.textContent = this.mass.toFixed(1);
            
            // On the Main Sequence, Luminosity and Temp are bound to Mass:
            // L ~ M^3.5 for solar-like stars
            this.lum = Math.pow(this.mass, 3.5);
            // Temp T ~ M^0.5
            this.temp = Math.round(5778 * Math.pow(this.mass, 0.50));
            this.temp = Math.max(2000, Math.min(this.temp, 40000));
            
            // Sync sliders
            this.sliderTemp.value = this.temp;
            this.valTemp.textContent = this.temp;
            
            this.updateStellarPhysics();
        });

        this.sliderTemp.addEventListener("input", (e) => {
            if (this.deathSequenceActive) return;
            this.temp = parseInt(e.target.value);
            this.valTemp.textContent = this.temp;
            
            // Adjust Mass and Luminosity along the Main Sequence corridor
            // M ~ (T/5778)^2 approximately
            const tRatio = this.temp / 5778;
            this.mass = Math.pow(tRatio, 1.8);
            this.mass = Math.max(0.1, Math.min(this.mass, 25));
            this.lum = Math.pow(this.mass, 3.5);
            
            // Sync sliders
            this.sliderMass.value = this.mass.toFixed(1);
            this.valMass.textContent = this.mass.toFixed(1);
            
            this.updateStellarPhysics();
        });

        this.btnEvolve.addEventListener("click", () => {
            this.triggerDeathSequence();
        });

        this.btnAlertClose.addEventListener("click", () => {
            this.alertModal.classList.remove("active");
            this.resetSimulation();
        });
    }

    initThree() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
        this.camera.position.set(0, 0, 5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 1.5;
        this.controls.maxDistance = 12;

        // Space Dust Background
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.05);
        this.scene.add(ambientLight);

        // Core star point light
        this.starLight = new THREE.PointLight(0xffffff, 2.0, 50);
        this.scene.add(this.starLight);

        // Star 3D Geometry (highly detailed)
        this.starGeo = new THREE.SphereGeometry(1.0, 64, 64);
        
        // Star Material - Custom Fresnel/Plasma Glow Effect simulation
        this.starMat = new THREE.MeshBasicMaterial({
            color: 0xffd700,
            wireframe: false
        });
        
        this.starMesh = new THREE.Mesh(this.starGeo, this.starMat);
        this.scene.add(this.starMesh);

        // Corona / Soft Outer Aura (Additive blending)
        this.coronaGeo = new THREE.SphereGeometry(1.06, 32, 32);
        this.coronaMat = new THREE.MeshBasicMaterial({
            color: 0xffa500,
            transparent: true,
            opacity: 0.35,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide
        });
        this.coronaMesh = new THREE.Mesh(this.coronaGeo, this.coronaMat);
        this.scene.add(this.coronaMesh);

        // Ejected Envelope Particles (for Supernova / Nebula)
        this.particleCount = 2000;
        this.particleGeo = new THREE.BufferGeometry();
        this.particlePositions = new Float32Array(this.particleCount * 3);
        this.particleVelocities = [];
        this.particleColors = new Float32Array(this.particleCount * 3);

        for (let i = 0; i < this.particleCount; i++) {
            // Distribute spherical shell
            this.particlePositions[i*3] = 0;
            this.particlePositions[i*3+1] = 0;
            this.particlePositions[i*3+2] = 0;
            
            // Random expanding velocities
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const speed = 0.2 + Math.random() * 2.5; // velocity magnitude
            
            this.particleVelocities.push(new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.sin(phi) * Math.sin(theta) * speed,
                Math.cos(phi) * speed
            ));
        }

        this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
        
        this.particleMat = new THREE.PointsMaterial({
            color: 0xffaa00,
            size: 0.05,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending
        });

        this.particles = new THREE.Points(this.particleGeo, this.particleMat);
        this.scene.add(this.particles);

        window.addEventListener("resize", () => this.resize());
    }

    // 2D Hertzsprung-Russell Diagram Interactive Render
    initHRDiagram() {
        this.hrCanvas = document.getElementById("hr-canvas");
        this.hrCtx = this.hrCanvas.getContext("2d");
        
        // Standard setup sizes
        this.hrCanvas.width = 300;
        this.hrCanvas.height = 220;

        // Click and drag handling on HR Diagram
        const handleHRClick = (e) => {
            if (this.deathSequenceActive) return;
            const rect = this.hrCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // Map click back to Temp and Lum
            // Temp (x axis) goes from 40,000K (left) to 2,000K (right) - Logarithmic scale
            const xPct = x / rect.width;
            const logTempMin = Math.log10(2000);
            const logTempMax = Math.log10(40000);
            const logTemp = logTempMax - xPct * (logTempMax - logTempMin);
            this.temp = Math.round(Math.pow(10, logTemp));
            
            // Bound inside slider values
            this.temp = Math.max(2000, Math.min(this.temp, 40000));
            this.sliderTemp.value = this.temp;
            this.valTemp.textContent = this.temp;
            
            // Map Mass and Luminosity along the Main Sequence
            const tRatio = this.temp / 5778;
            this.mass = Math.pow(tRatio, 1.8);
            this.mass = Math.max(0.1, Math.min(this.mass, 25));
            this.lum = Math.pow(this.mass, 3.5);
            
            this.sliderMass.value = this.mass.toFixed(1);
            this.valMass.textContent = this.mass.toFixed(1);

            this.updateStellarPhysics();
        };

        this.hrCanvas.addEventListener("mousedown", (e) => {
            handleHRClick(e);
            const moveHandler = (moveEvent) => handleHRClick(moveEvent);
            window.addEventListener("mousemove", moveHandler);
            window.addEventListener("mouseup", () => {
                window.removeEventListener("mousemove", moveHandler);
            }, { once: true });
        });
    }

    drawHRDiagram() {
        const ctx = this.hrCtx;
        const w = this.hrCanvas.width;
        const h = this.hrCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // 1. Draw Grid Lines
        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.lineWidth = 1;
        for (let i = 1; i < 5; i++) {
            const x = (i / 5) * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();

            const y = (i / 5) * h;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // 2. Draw Main Sequence Corridor Gradient
        const msGrad = ctx.createLinearGradient(0, 0, w, h);
        msGrad.addColorStop(0, "rgba(0, 210, 255, 0.2)");   // Hot Blue
        msGrad.addColorStop(0.5, "rgba(255, 215, 0, 0.15)"); // Solar Yellow
        msGrad.addColorStop(1, "rgba(255, 42, 109, 0.2)");   // Cool Red

        ctx.strokeStyle = msGrad;
        ctx.lineWidth = 18;
        ctx.lineCap = "round";
        ctx.beginPath();
        // A curve in 'S' shape representing the Main Sequence corridor
        ctx.moveTo(25, 25);
        ctx.quadraticCurveTo(w * 0.4, h * 0.5, w - 25, h - 25);
        ctx.stroke();

        // 3. Labels
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "8px Orbitron";
        ctx.fillText("40,000K", 5, h - 6);
        ctx.fillText("O", 30, h - 6);
        ctx.fillText("B", 70, h - 6);
        ctx.fillText("A", 115, h - 6);
        ctx.fillText("F", 150, h - 6);
        ctx.fillText("G", 185, h - 6);
        ctx.fillText("K", 225, h - 6);
        ctx.fillText("M", 260, h - 6);
        ctx.fillText("2,000K", w - 40, h - 6);

        ctx.save();
        ctx.translate(10, 45);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("LUMINOSIDADE (L/Lsun)", 0, 0);
        ctx.restore();

        // 4. Draw Current Star Indicator Marker
        // Temperature logarithmic coordinate
        const logTempMin = Math.log10(2000);
        const logTempMax = Math.log10(40000);
        const logCurrent = Math.log10(this.temp);
        const xPct = (logTempMax - logCurrent) / (logTempMax - logTempMin);
        const markerX = xPct * (w - 50) + 25;

        // Luminosity logarithmic coordinate (L = M^3.5)
        const logLumMin = Math.log10(Math.pow(0.1, 3.5));
        const logLumMax = Math.log10(Math.pow(25.0, 3.5));
        const logCurrentLum = Math.log10(this.lum);
        const yPct = (logLumMax - logCurrentLum) / (logLumMax - logLumMin);
        const markerY = yPct * (h - 60) + 30;

        // Draw crosshair or target circle with glow
        ctx.shadowBlur = 8;
        ctx.shadowColor = this.getStarHexColor();
        ctx.fillStyle = this.getStarHexColor();
        ctx.beginPath();
        ctx.arc(markerX, markerY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    updateStellarPhysics() {
        if (this.deathSequenceActive) return;

        // 1. Stefan-Boltzmann Law for Radius
        // L = 4*pi * R^2 * sigma * T^4
        // Normalized with solar values: R/R_sun = sqrt( L/L_sun ) / ( T / T_sun )^2
        const tempRatio = this.temp / 5778;
        this.radius = Math.sqrt(this.lum) / (tempRatio * tempRatio);

        // 2. Central Core Conditions Estimation
        // Central Temp: Tc ~ M/R * Tc_sun
        this.tc = 15.6e6 * (this.mass / this.radius);
        
        // Central Density: rho_c ~ M/R^3 * rho_sun
        this.rhoCentral = 150 * (this.mass / Math.pow(this.radius, 3));

        // 3. Nuclear Reaction Rates (p-p Chain vs CNO Cycle)
        // Energy production scaling:
        // epsilon_pp ~ Tc^4
        // epsilon_cno ~ Tc^17
        const t6 = this.tc / 1e6; // Temperature in millions of Kelvin
        const e_pp = Math.pow(t6, 4);
        // CNO starts fusing around 14MK and completely dominates past 17MK
        const e_cno = 1e-11 * Math.pow(t6, 17); // Exponentially massive sensitivity

        const totalEnergy = e_pp + e_cno;
        this.ppFraction = e_pp / totalEnergy;
        this.cnoFraction = e_cno / totalEnergy;

        // 4. Main Sequence Lifetime Estimate
        // lifetime = 10 billion years * (M / L) = 10 * M^-2.5
        this.lifetime = 10.0 * Math.pow(this.mass, -2.5);

        // Update Three.js meshes properties
        const visualScale = Math.max(0.2, Math.min(this.radius * 0.7, 2.0)); // scale boundaries
        this.starMesh.scale.setScalar(visualScale);
        this.coronaMesh.scale.setScalar(visualScale * 1.05);

        // Change colors according to spectral temp
        const hexColor = this.getStarHexColor();
        this.starMat.color.setHex(hexColor);
        this.coronaMat.color.setHex(hexColor);
        this.starLight.color.setHex(hexColor);

        // Update UI
        this.valLum.textContent = window.formatScientific(this.lum);
        this.metricRadius.textContent = this.radius.toFixed(2) + " R⊙";
        this.metricTc.textContent = (this.tc / 1e6).toFixed(1) + " Milhões K";
        
        // Estimate central core pressure (hydrostatic equilibrium approximation)
        const centralPressure = this.mass * this.mass / Math.pow(this.radius, 4);
        this.metricPres.textContent = centralPressure.toFixed(2) + " P⊙";

        if (this.lifetime < 0.001) {
            this.metricTime.textContent = (this.lifetime * 1e3).toFixed(1) + " Milhões anos";
        } else {
            this.metricTime.textContent = this.lifetime.toFixed(2) + " Bilhões anos";
        }

        // Nuclear bars update
        this.valPP.textContent = Math.round(this.ppFraction * 100) + "%";
        this.valCNO.textContent = Math.round(this.cnoFraction * 100) + "%";
        this.barPP.style.width = (this.ppFraction * 100) + "%";
        this.barCNO.style.width = (this.cnoFraction * 100) + "%";
    }

    getStarHexColor() {
        if (this.temp < 3700) return 0xff4500;      // Class M: Red
        if (this.temp < 5200) return 0xffa500;      // Class K: Orange
        if (this.temp < 6000) return 0xffd700;      // Class G: Yellow (Sun)
        if (this.temp < 7500) return 0xfff4ea;      // Class F: Warm White
        if (this.temp < 10000) return 0xf0f8ff;     // Class A: Blue-White
        if (this.temp < 30000) return 0x00d2ff;     // Class B: Cyan
        return 0x1e90ff;                            // Class O: Deep Blue
    }

    // Stellar Evolution Death Sequences
    triggerDeathSequence() {
        if (this.deathSequenceActive) return;
        this.deathSequenceActive = true;
        this.state = 'evolving';
        this.deathTimer = 0;

        // Block UI sliders
        this.sliderMass.disabled = true;
        this.sliderTemp.disabled = true;

        if (this.mass < 8.0) {
            // Low mass death: Red Giant Expansion -> Planetary Nebula -> White Dwarf contraction
            this.deathType = 'white_dwarf';
        } else {
            // High mass death: Supernova collapse -> Explosion -> Remanent Black Hole/Neutron star
            this.deathType = 'supernova';
        }
    }

    resetSimulation() {
        this.state = 'main_sequence';
        this.deathSequenceActive = false;
        
        // Reset scale and colors
        this.starMesh.visible = true;
        this.coronaMesh.visible = true;
        this.particles.material.opacity = 0;
        
        // Restore sliders
        this.sliderMass.disabled = false;
        this.sliderTemp.disabled = false;
        
        // Recompute
        this.updateStellarPhysics();
    }

    resize() {
        if (!this.container) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    pause() {
        this.isActive = false;
    }

    resume() {
        this.isActive = true;
        this.resize();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (!this.isActive || window.AstrophysicsLab.activeTab !== 'stellar') return;

        this.controls.update();

        // Rotate the star for realistic convection feeling
        if (this.state !== 'nebula' && this.state !== 'remanent') {
            this.starMesh.rotation.y += 0.006;
            this.starMesh.rotation.x += 0.002;
        }

        // Draw the HR Diagram at 30 FPS or when active
        this.drawHRDiagram();

        // 1. ANIMATE THE EVOLUTIONARY STAGES (DEATH SEQUENCES)
        if (this.deathSequenceActive) {
            this.deathTimer += 0.01;

            if (this.deathType === 'white_dwarf') {
                this.animateWhiteDwarfSequence();
            } else if (this.deathType === 'supernova') {
                this.animateSupernovaSequence();
            }
        } else {
            // Gentle pulse on main sequence
            const scalePulse = 1.0 + Math.sin(performance.now() * 0.002) * 0.015;
            this.coronaMesh.scale.copy(this.starMesh.scale).multiplyScalar(1.05 * scalePulse);
        }

        this.renderer.render(this.scene, this.camera);
    }

    // A: Low-mass evolutionary animation sequence
    animateWhiteDwarfSequence() {
        // Step 1: Red Giant Expansion (Timer 0.0 -> 3.0)
        if (this.deathTimer < 3.0) {
            const progress = this.deathTimer / 3.0;
            const targetRadius = Math.max(2.5, this.radius * 3.5);
            const currentRadius = this.radius + (targetRadius - this.radius) * progress;
            const visualScale = currentRadius * 0.5;
            
            this.starMesh.scale.setScalar(visualScale);
            this.coronaMesh.scale.setScalar(visualScale * 1.08);

            // Shift color to red-giant reddish spectrum
            this.starMat.color.setHex(0xff3300);
            this.coronaMat.color.setHex(0xff3300);
            this.starLight.color.setHex(0xff3300);
            this.starLight.intensity = 1.0 + progress * 2.0;

            this.metricRadius.textContent = currentRadius.toFixed(2) + " R⊙ (Gigante Vermelha)";
        }
        // Step 2: Nebula envelope ejection (Timer 3.0 -> 6.0)
        else if (this.deathTimer < 6.0) {
            const progress = (this.deathTimer - 3.0) / 3.0;
            this.state = 'nebula';

            // Ejection particle cloud expands
            this.particles.material.opacity = progress * 0.5;
            this.particles.material.color.setHex(0xff5500);
            
            const positions = this.particles.geometry.attributes.position.array;
            for (let i = 0; i < this.particleCount; i++) {
                // Expand particles radially
                const vel = this.particleVelocities[i];
                positions[i*3] += vel.x * 0.03;
                positions[i*3+1] += vel.y * 0.03;
                positions[i*3+2] += vel.z * 0.03;
            }
            this.particles.geometry.attributes.position.needsUpdate = true;

            // Shrink the core rapidly to a white dwarf core
            const currentScale = (this.radius * 3.5 * 0.5) * (1.0 - progress) + 0.15 * progress;
            this.starMesh.scale.setScalar(currentScale);
            this.starMat.color.setHex(0xe0ffff); // shift to blue-white degenerate color

            this.coronaMesh.material.opacity = (1.0 - progress) * 0.35;
            this.metricRadius.textContent = "Ejetando Envelope Estelar...";
        }
        // Step 3: White Dwarf Core (Timer 6.0+)
        else {
            this.state = 'white_dwarf';
            this.starMesh.scale.setScalar(0.08); // Earth sized core
            this.starMat.color.setHex(0xffffff);
            this.starLight.color.setHex(0xffffff);
            this.starLight.intensity = 0.5;
            this.coronaMesh.visible = false;
            
            // Nebula fades
            this.particles.material.opacity = Math.max(0, 0.5 - (this.deathTimer - 6.0) * 0.05);

            this.metricRadius.textContent = "0.01 R⊙ (Anã Branca)";
            this.metricTc.textContent = "0.0 K (Exausto)";
            this.metricPres.textContent = "Pressão Degenerada Eletrônica";
            this.metricTime.textContent = "Resfriamento Eterno";

            // Trigger HUD completion notice
            if (this.deathTimer > 7.5) {
                this.alertTitle.textContent = "ANÃ BRANCA CRIADA!";
                this.alertTitle.className = "alert-title collapse";
                this.alertDesc.textContent = `A estrela de baixa massa (${this.mass.toFixed(1)} M⊙) concluiu a queima do hélio. Suas camadas externas foram dispersas como uma bela Nebulosa Planetária. O núcleo contraiu-se para uma Anã Branca sustentada pela Pressão de Degenerescência Eletrônica, resfriando-se lentamente pela eternidade.`;
                this.alertModal.classList.add("active");
                this.deathSequenceActive = false;
            }
        }
    }

    // B: High-mass explosive sequence (Supernova)
    animateSupernovaSequence() {
        // Step 1: Nuclear Core collapse (Timer 0.0 -> 1.5)
        if (this.deathTimer < 1.5) {
            this.state = 'collapsing';
            const progress = this.deathTimer / 1.5;
            
            // Fast shrink contraction representing core collapse
            const shrink = 1.0 - progress * 0.6;
            this.starMesh.scale.setScalar(this.radius * 0.7 * shrink);
            this.coronaMesh.scale.setScalar(this.radius * 0.75 * shrink);

            // Flicker warning orange/red core
            this.starMat.color.setHex(0xff2200);
            this.coronaMat.color.setHex(0xff2200);
            this.starLight.intensity = 5.0 * (1.0 + Math.sin(this.deathTimer * 80) * 0.5);

            this.metricRadius.textContent = "Colapso do Núcleo de Ferro!";
        }
        // Step 2: Supernova Outburst Flash (Timer 1.5 -> 3.5)
        else if (this.deathTimer < 3.5) {
            this.state = 'explosion';
            const progress = (this.deathTimer - 1.5) / 2.0;

            // Gigantic scale flash sphere
            this.starMesh.visible = false;
            this.coronaMesh.visible = true;
            this.coronaMesh.scale.setScalar(0.1 + progress * 15.0);
            this.coronaMat.color.setHex(0xffffff);
            this.coronaMat.opacity = (1.0 - progress) * 0.9;
            this.coronaMat.blending = THREE.AdditiveBlending;

            // Activate and expand particles massively at high speeds
            this.particles.material.opacity = 1.0 - progress;
            this.particles.material.size = 0.08 + progress * 0.15;
            this.particles.material.color.setHex(0xff7700);

            const positions = this.particles.geometry.attributes.position.array;
            for (let i = 0; i < this.particleCount; i++) {
                const vel = this.particleVelocities[i];
                positions[i*3] += vel.x * 0.18;
                positions[i*3+1] += vel.y * 0.18;
                positions[i*3+2] += vel.z * 0.18;
            }
            this.particles.geometry.attributes.position.needsUpdate = true;

            this.starLight.intensity = 50.0 * (1.0 - progress);

            this.metricRadius.textContent = "Explosão de Supernova!!";
        }
        // Step 3: Core Remanent (Timer 3.5+)
        else {
            this.state = 'remanent';
            this.coronaMesh.visible = false;
            this.particles.material.opacity = Math.max(0, 1.0 - (this.deathTimer - 1.5) * 0.2);

            // Remanent object depends on original mass
            if (this.mass < 15.0) {
                // Neutron Star (Tiny pulsar pulsing with dynamic scale)
                this.starMesh.visible = true;
                const pPulse = 0.05 + Math.sin(performance.now() * 0.1) * 0.01;
                this.starMesh.scale.setScalar(pPulse);
                this.starMat.color.setHex(0x00f5d4); // pulsate ciano
                
                this.metricRadius.textContent = "15 km (Estrela de Nêutrons)";
                this.metricPres.textContent = "Pressão Degenerada de Nêutrons";
            } else {
                // Black hole (Completely black, invisible)
                this.starMesh.visible = false;
                this.metricRadius.textContent = "0.0 km (Buraco Negro)";
                this.metricPres.textContent = "Singularidade!";
            }
            
            this.metricTc.textContent = "Extremo";
            this.metricTime.textContent = "---";

            if (this.deathTimer > 5.0) {
                const isBH = this.mass >= 15.0;
                this.alertTitle.textContent = "SUPERNOVA DE CATÁSTROFE!";
                this.alertTitle.className = "alert-title supernova";
                this.alertDesc.textContent = `A estrela massiva (${this.mass.toFixed(1)} M⊙) exauriu sua queima. O colapso gravitacional implodiu o núcleo instantaneamente, liberando uma energia equivalente a ${isBH ? "um buraco negro estelar" : "uma estrela de nêutrons"} como remanescente denso no centro da nebulosa expansiva.`;
                this.alertModal.classList.add("active");
                this.deathSequenceActive = false;
                
                // Reset positions for particles for future run
                const positions = this.particles.geometry.attributes.position.array;
                for (let i = 0; i < this.particleCount * 3; i++) {
                    positions[i] = 0;
                }
                this.particles.geometry.attributes.position.needsUpdate = true;
            }
        }
    }
}

// Instantiate
new StellarSimulation();
