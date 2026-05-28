// ============================================================
//  GALAXY COLLISION SIMULATOR (js/galaxy.js)
//  Restricted 3-Body Problem N-Body simulation for 40k stars.
// ============================================================

class GalaxySimulation {
    constructor() {
        this.container = document.getElementById("galaxy-container");
        if (!this.container) return;

        // UI Elements
        this.sliderMassA = document.getElementById("gx-massA");
        this.numMassA    = document.getElementById("gx-massA-num");
        this.sliderDmA   = document.getElementById("gx-dmA");
        this.numDmA      = document.getElementById("gx-dmA-num");
        
        this.sliderMassB = document.getElementById("gx-massB");
        this.numMassB    = document.getElementById("gx-massB-num");
        this.sliderDmB   = document.getElementById("gx-dmB");
        this.numDmB      = document.getElementById("gx-dmB-num");
        
        this.sliderImpact = document.getElementById("gx-impact");
        this.numImpact    = document.getElementById("gx-impact-num");

        this.btnStart = document.getElementById("btn-gx-start");
        this.btnReset = document.getElementById("btn-gx-reset");

        this.metricTime = document.getElementById("metric-gx-time");
        this.metricDist = document.getElementById("metric-gx-dist");
        this.metricVel  = document.getElementById("metric-gx-vel");

        // State
        this.isActive = true;
        this.isRunning = false;
        
        // Physics constants (abstract units)
        this.G = 0.05; 
        this.dt = 0.02; // time step per frame
        this.simTime = 0.0;
        
        // Cores
        this.coreA = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), mass: 4.0, dm: 1.0 };
        this.coreB = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), mass: 6.0, dm: 1.5 };
        
        // Particles
        this.numStarsPerGalaxy = 15000;
        this.totalStars = this.numStarsPerGalaxy * 2;

        window.AstrophysicsLab = window.AstrophysicsLab || { simulations: {} };
        window.AstrophysicsLab.simulations["galaxy"] = this;

        this.initThree();
        this.bindEvents();
        this.resetSimulation();
        this.animate();
    }

    initThree() {
        const w = this.container.clientWidth || 800;
        const h = this.container.clientHeight || 600;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x05000a, 1); // Deep void
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 1000);
        this.camera.position.set(0, 40, 60);
        this.camera.lookAt(0, 0, 0);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Visuals for Cores (Supermassive Black Holes)
        const coreGeo = new THREE.SphereGeometry(0.5, 32, 32);
        const coreMatA = new THREE.MeshBasicMaterial({ color: 0x00d2ff }); // Blueish young galaxy
        const coreMatB = new THREE.MeshBasicMaterial({ color: 0xff6432 }); // Reddish old galaxy
        
        this.meshCoreA = new THREE.Mesh(coreGeo, coreMatA);
        this.meshCoreB = new THREE.Mesh(coreGeo, coreMatB);
        this.scene.add(this.meshCoreA);
        this.scene.add(this.meshCoreB);

        // Core Glows
        const spriteMatA = new THREE.SpriteMaterial({
            map: this.createGlowTexture(0x00d2ff),
            color: 0x00d2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
        });
        const spriteMatB = new THREE.SpriteMaterial({
            map: this.createGlowTexture(0xff6432),
            color: 0xff6432, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
        });
        this.glowA = new THREE.Sprite(spriteMatA);
        this.glowA.scale.set(8, 8, 1);
        this.meshCoreA.add(this.glowA);
        
        this.glowB = new THREE.Sprite(spriteMatB);
        this.glowB.scale.set(8, 8, 1);
        this.meshCoreB.add(this.glowB);

        // Particles setup
        this.starsGeometry = new THREE.BufferGeometry();
        this.starPositions = new Float32Array(this.totalStars * 3);
        this.starVelocities = new Float32Array(this.totalStars * 3);
        this.starColors = new Float32Array(this.totalStars * 3);

        this.starsGeometry.setAttribute('position', new THREE.BufferAttribute(this.starPositions, 3));
        this.starsGeometry.setAttribute('color', new THREE.BufferAttribute(this.starColors, 3));

        const starMat = new THREE.PointsMaterial({
            size: 0.15,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.starsSystem = new THREE.Points(this.starsGeometry, starMat);
        this.scene.add(this.starsSystem);

        window.addEventListener("resize", () => this.resize());
    }

    createGlowTexture(colorHex) {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        const color = new THREE.Color(colorHex);
        grad.addColorStop(0.2, `rgba(${color.r*255},${color.g*255},${color.b*255},0.8)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    }

    generateGalaxy(offsetIndex, corePos, coreVel, mass, colorVec, isRetrograde) {
        const numStars = this.numStarsPerGalaxy;
        const radiusMin = 1.0;
        const radiusMax = 16.0;
        const numArms = 2;
        const armWinding = 2.0;

        for (let i = 0; i < numStars; i++) {
            const idx = offsetIndex + i;
            
            let r, theta, colorIntensity;
            
            if (Math.random() < 0.25) {
                // Bulge / Core
                r = radiusMin + Math.random() * 2.0;
                theta = Math.random() * Math.PI * 2;
                colorIntensity = 1.2;
            } else {
                // Spiral Disk
                r = radiusMin + (radiusMax - radiusMin) * Math.pow(Math.random(), 1.2);
                const armOffset = Math.floor(Math.random() * numArms) * (Math.PI * 2 / numArms);
                const spiralAngle = armWinding * (r / radiusMax) * Math.PI * 2;
                
                // Add scatter that increases with radius
                const scatter = (Math.random() - 0.5) * (r / radiusMax) * 2.5;
                
                // If retro, arms wind the other way mathematically
                const directionMultiplier = isRetrograde ? -1 : 1;
                theta = armOffset + (spiralAngle * directionMultiplier) + scatter;
                colorIntensity = 0.6 + Math.random() * 0.4;
            }
            
            const x = r * Math.cos(theta);
            const thickness = 0.8 * Math.exp(-r/4); // Exponentially thinner disk
            const y = (Math.random() - 0.5) * thickness;
            const z = r * Math.sin(theta);
            
            this.starPositions[idx*3]   = corePos.x + x;
            this.starPositions[idx*3+1] = corePos.y + y;
            this.starPositions[idx*3+2] = corePos.z + z;

            const vOrbital = Math.sqrt(this.G * mass / r);
            const dir = isRetrograde ? -1 : 1;
            
            const vx = -Math.sin(theta) * vOrbital * dir;
            const vy = 0;
            const vz = Math.cos(theta) * vOrbital * dir;

            this.starVelocities[idx*3]   = coreVel.x + vx;
            this.starVelocities[idx*3+1] = coreVel.y + vy;
            this.starVelocities[idx*3+2] = coreVel.z + vz;

            // Dust Lanes Logic
            const phase = (theta - (armWinding * (r / radiusMax) * Math.PI * 2 * (isRetrograde ? -1 : 1))) % (Math.PI * 2 / numArms);
            const isDust = Math.abs(phase) > (Math.PI / numArms) * 0.65;
            
            if (isDust && r > 2.5 && Math.random() < 0.6) {
                // Dark dust lane (dark orange/red tint)
                this.starColors[idx*3]   = colorVec.x * 0.15;
                this.starColors[idx*3+1] = colorVec.y * 0.05;
                this.starColors[idx*3+2] = colorVec.z * 0.05;
            } else {
                // Star glow (mix base color with white)
                this.starColors[idx*3]   = Math.min(1.0, colorVec.x * colorIntensity + 0.3);
                this.starColors[idx*3+1] = Math.min(1.0, colorVec.y * colorIntensity + 0.3);
                this.starColors[idx*3+2] = Math.min(1.0, colorVec.z * colorIntensity + 0.3);
            }
        }
    }

    resetSimulation() {
        this.isRunning = false;
        this.simTime = 0.0;
        this.coresMerged = false;
        this.meshCoreB.visible = true;
        this.glowB.visible = true;

        // Read UI
        this.coreA.mass = parseFloat(this.sliderMassA.value);
        this.coreA.dm = parseFloat(this.sliderDmA.value);
        this.coreB.mass = parseFloat(this.sliderMassB.value);
        this.coreB.dm = parseFloat(this.sliderDmB.value);
        const impact = parseFloat(this.sliderImpact.value);

        // Initial positions (Separated along X axis)
        this.coreA.pos.set(-20, 0, impact * 5.0);
        this.coreB.pos.set(20, 0, -impact * 5.0);

        // Initial velocities (moving towards each other)
        // Adjust approach speed based on total mass
        const totalEffectiveMass = (this.coreA.mass * (1+this.coreA.dm)) + (this.coreB.mass * (1+this.coreB.dm));
        const approachSpeed = Math.sqrt(this.G * totalEffectiveMass / 40.0) * 0.8;

        this.coreA.vel.set(approachSpeed, 0, 0);
        this.coreB.vel.set(-approachSpeed, 0, 0);

        // Generate galaxies
        const colA = new THREE.Vector3(0.1, 0.6, 1.0); // Vibrant Blue
        const colB = new THREE.Vector3(1.0, 0.7, 0.2); // Vibrant Golden Yellow
        
        this.generateGalaxy(0, this.coreA.pos, this.coreA.vel, this.coreA.mass * (1+this.coreA.dm), colA, false);
        this.generateGalaxy(this.numStarsPerGalaxy, this.coreB.pos, this.coreB.vel, this.coreB.mass * (1+this.coreB.dm), colB, true);

        this.starsGeometry.attributes.position.needsUpdate = true;
        this.starsGeometry.attributes.color.needsUpdate = true;
        
        this.meshCoreA.position.copy(this.coreA.pos);
        this.meshCoreB.position.copy(this.coreB.pos);
        
        // Scale cores visually based on mass
        this.meshCoreA.scale.setScalar(Math.pow(this.coreA.mass, 0.33));
        this.meshCoreB.scale.setScalar(Math.pow(this.coreB.mass, 0.33));

        this.btnStart.textContent = "INICIAR COLISÃO";
        this.btnStart.style.backgroundColor = "";
        
        this.updateMetrics();
        this.controls.target.set(0,0,0);
        this.camera.position.set(0, 40, 60);
    }

    bindEvents() {
        this.sliderMassA.addEventListener("input", e => { this.numMassA.textContent = e.target.value; this.resetSimulation(); });
        this.sliderDmA.addEventListener("input", e => { this.numDmA.textContent = e.target.value + "x"; this.resetSimulation(); });
        this.sliderMassB.addEventListener("input", e => { this.numMassB.textContent = e.target.value; this.resetSimulation(); });
        this.sliderDmB.addEventListener("input", e => { this.numDmB.textContent = e.target.value + "x"; this.resetSimulation(); });
        this.sliderImpact.addEventListener("input", e => { this.numImpact.textContent = e.target.value; this.resetSimulation(); });

        this.btnStart.addEventListener("click", () => {
            this.isRunning = !this.isRunning;
            if (this.isRunning) {
                this.btnStart.textContent = "PAUSAR SIMULAÇÃO";
                this.btnStart.style.backgroundColor = "#ffaa00";
            } else {
                this.btnStart.textContent = "CONTINUAR COLISÃO";
                this.btnStart.style.backgroundColor = "";
            }
        });

        this.btnReset.addEventListener("click", () => this.resetSimulation());
    }

    updateMetrics() {
        this.metricTime.textContent = this.simTime.toFixed(1);
        
        const dist = this.coreA.pos.distanceTo(this.coreB.pos);
        this.metricDist.textContent = dist.toFixed(2);
        
        const relVel = new THREE.Vector3().subVectors(this.coreA.vel, this.coreB.vel).length();
        this.metricVel.textContent = (relVel * 100).toFixed(1); // Scaled up for display
    }

    resize() {
        if (!this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    pause()  { this.isActive = true; }
    resume() {
        this.isActive = true;
        setTimeout(() => this.resize(), 50);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (!this.isActive || window.AstrophysicsLab.activeTab !== 'galaxy') return;

        this.controls.update();

        if (this.isRunning) {
            this.simTime += this.dt;

            // Physics Step (Verlet or Euler)
            const eps = 0.5; // Softening parameter to prevent singularities
            const posA = this.coreA.pos;
            const posB = this.coreB.pos;
            const massA = this.coreA.mass * (1 + this.coreA.dm);
            const massB = this.coreB.mass * (1 + this.coreB.dm);

            // Core-to-Core Gravity
            const dirAB = new THREE.Vector3().subVectors(posB, posA);
            const dSq = dirAB.lengthSq() + eps*eps;
            const d = Math.sqrt(dSq);
            const f = (this.G * massA * massB) / dSq;
            
            dirAB.normalize();
            
            const accA = dirAB.clone().multiplyScalar(f / massA);
            const accB = dirAB.clone().multiplyScalar(-f / massB);
            
            // Dynamical friction (Chandrasekhar approx) - causes spiraling merger
            if (!this.coresMerged) {
                const relVel = new THREE.Vector3().subVectors(this.coreA.vel, this.coreB.vel);
                const frictionCoef = 0.08 * (this.coreA.dm + this.coreB.dm) / (dSq + 2.0); // Energy loss
                accA.sub(relVel.clone().multiplyScalar(frictionCoef));
                accB.add(relVel.clone().multiplyScalar(frictionCoef));
            }

            this.coreA.vel.add(accA.multiplyScalar(this.dt));
            this.coreB.vel.add(accB.multiplyScalar(this.dt));

            posA.add(this.coreA.vel.clone().multiplyScalar(this.dt));
            posB.add(this.coreB.vel.clone().multiplyScalar(this.dt));
            
            // Core Merger Logic
            if (!this.coresMerged && d < 1.2) {
                this.coresMerged = true;
                
                // Inelastic collision conservation of momentum
                const totalMass = massA + massB;
                this.coreA.vel.multiplyScalar(massA).add(this.coreB.vel.clone().multiplyScalar(massB)).divideScalar(totalMass);
                
                this.meshCoreB.visible = false;
                this.glowB.visible = false;
                
                // Visually increase the remaining core size
                this.meshCoreA.scale.setScalar(Math.pow(this.coreA.mass + this.coreB.mass, 0.35));
                this.glowA.material.color.setHex(0xffffff); // Super bright flash on merge
            }
            
            if (this.coresMerged) {
                posB.copy(posA); // Keep B inside A for gravity calculations
            }

            this.meshCoreA.position.copy(posA);
            this.meshCoreB.position.copy(posB);

            // Camera tracks center of mass
            const com = new THREE.Vector3()
                .addScaledVector(posA, massA)
                .addScaledVector(posB, massB)
                .divideScalar(massA + massB);
            this.controls.target.lerp(com, 0.05);

            // Update all stars (Restricted 3-Body)
            const p = this.starPositions;
            const v = this.starVelocities;
            
            for (let i = 0; i < this.totalStars; i++) {
                const idx = i * 3;
                
                const dxA = posA.x - p[idx];
                const dyA = posA.y - p[idx+1];
                const dzA = posA.z - p[idx+2];
                const dSqA = dxA*dxA + dyA*dyA + dzA*dzA + eps*eps;
                const dA = Math.sqrt(dSqA);
                const forceA = (this.G * massA) / dSqA;

                const dxB = posB.x - p[idx];
                const dyB = posB.y - p[idx+1];
                const dzB = posB.z - p[idx+2];
                const dSqB = dxB*dxB + dyB*dyB + dzB*dzB + eps*eps;
                const dB = Math.sqrt(dSqB);
                const forceB = (this.G * massB) / dSqB;

                v[idx]   += (dxA / dA * forceA + dxB / dB * forceB) * this.dt;
                v[idx+1] += (dyA / dA * forceA + dyB / dB * forceB) * this.dt;
                v[idx+2] += (dzA / dA * forceA + dzB / dB * forceB) * this.dt;

                p[idx]   += v[idx] * this.dt;
                p[idx+1] += v[idx+1] * this.dt;
                p[idx+2] += v[idx+2] * this.dt;
            }

            this.starsGeometry.attributes.position.needsUpdate = true;
            this.updateMetrics();
        }

        this.renderer.render(this.scene, this.camera);
    }
}

// Bootstrap
document.addEventListener("DOMContentLoaded", () => {
    new GalaxySimulation();
});
