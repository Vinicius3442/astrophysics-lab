// ============================================================
//  SUPERNOVA SIMULATOR (js/supernova.js)
//  Volumetric raymarching of a core-collapse supernova
//  with extreme slow-motion time control.
// ============================================================

class SupernovaSimulation {
    constructor() {
        this.container = document.getElementById("supernova-container");

        // UI Elements
        this.sliderMass = document.getElementById("sn-mass");
        this.numMass    = document.getElementById("sn-mass-num");
        
        this.sliderTimeScale = document.getElementById("sn-timescale");
        this.numTimeScale    = document.getElementById("sn-timescale-num");
        
        this.btnDetonate = document.getElementById("btn-sn-detonate");
        this.btnReset    = document.getElementById("btn-sn-reset");

        this.metricTime   = document.getElementById("metric-sn-time");
        this.metricRadius = document.getElementById("metric-sn-radius");
        this.metricSpeed  = document.getElementById("metric-sn-speed");
        this.metricTemp   = document.getElementById("metric-sn-temp");

        // State
        this.isActive = false;
        this.mass = 25.0; // Solar masses
        
        // Time logic
        this.simTime = 0.0;     // Time since detonation in seconds
        this.timeScale = 1.0;   // Multiplier for dt
        this.isDetonated = false;
        
        this.clock = new THREE.Clock();
        this._realTime = 0; // Absolute time for noise animation

        // Register
        window.AstrophysicsLab = window.AstrophysicsLab || { simulations: {} };
        window.AstrophysicsLab.simulations["supernova"] = this;

        this.initThree();
        this.bindEvents();
        this.updateTimeScaleDisplay();
        this.animate();
    }

    initThree() {
        const w = this.container.clientWidth  || 800;
        const h = this.container.clientHeight || 600;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 1);
        this.container.appendChild(this.renderer.domElement);

        // Scene
        this.scene  = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // Uniforms
        this.uniforms = {
            u_resolution: { value: new THREE.Vector2(w, h) },
            u_real_time:  { value: 0.0 },     // For continuous noise/plasma movement
            u_sim_time:   { value: -1.0 },    // -1 means not detonated. > 0 means detonated.
            u_mass:       { value: this.mass },
            u_cam:        { value: new THREE.Vector3(0.0, 0.0, 12.0) }
        };

        const vs = `void main(){ gl_Position = vec4(position,1.0); }`;
        const fs = `
precision highp float;

uniform vec2  u_resolution;
uniform float u_real_time;
uniform float u_sim_time;
uniform float u_mass;
uniform vec3  u_cam;

// ────────────────────────────────────────────────────────────
// UTILITY NOISE
// ────────────────────────────────────────────────────────────
float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }

float hash13(vec3 p){
    p=fract(p*vec3(127.1,311.7,74.7));
    p+=dot(p,p.zxy+31.32);
    return fract((p.x+p.y)*p.z);
}

float noise3(vec3 x){
    vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(
        mix(mix(hash13(i),         hash13(i+vec3(1,0,0)),f.x),
            mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
        mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),
            mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}

float fbm3(vec3 p){
    float v=0.0,a=0.5;
    for(int i=0;i<5;i++){ v+=a*noise3(p); p*=2.2; a*=0.5; }
    return v;
}

mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0,-s,0,1,0,s,0,c); }
mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1,0,0,0,c,-s,0,s,c); }

// Clean starfield
vec3 starfield(vec3 ray) {
    ray = normalize(ray);
    vec3 d = abs(ray);
    vec2 uv; float face;
    if (d.x >= d.y && d.x >= d.z) { uv = ray.yz/d.x; face = ray.x>0.0?0.0:1.0; } 
    else if (d.y >= d.z) { uv = ray.xz/d.y; face = ray.y>0.0?2.0:3.0; } 
    else { uv = ray.xy/d.z; face = ray.z>0.0?4.0:5.0; }
    uv = uv*0.5+0.5;
    vec3 col = vec3(0.0);
    for (int i = 0; i < 2; i++) {
        float sc = 40.0 + float(i)*30.0;
        vec2 cell = floor(uv*sc + face*13.0);
        vec2 f = fract(uv*sc);
        vec2 jitter = vec2(hash21(cell), hash21(cell+13.0));
        float dStar = length(f - jitter);
        float bright = pow(hash21(cell+7.0), 30.0) * exp(-dStar*dStar*900.0);
        vec3 tint = mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.8, 0.6), hash21(cell+11.0));
        col += bright * tint * 2.5;
    }
    // Very faint molecular cloud
    float neb = fbm3(ray*3.0) * 0.08;
    col += mix(vec3(0.01, 0.0, 0.03), vec3(0.03, 0.0, 0.05), ray.y*0.5+0.5) * neb;
    return col;
}

// ────────────────────────────────────────────────────────────
// MAIN SIMULATION
// ────────────────────────────────────────────────────────────
void main() {
    vec2 fc = gl_FragCoord.xy;
    vec2 uv = (fc - 0.5*u_resolution) / u_resolution.y;

    // Camera setup
    vec3 ro = u_cam;
    vec3 look = vec3(0.0);
    vec3 fwd = normalize(look - ro);
    vec3 right = normalize(cross(fwd, vec3(0,1,0)));
    vec3 up2 = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x*right + uv.y*up2);

    vec3 col = vec3(0.0);
    float transmit = 1.0;

    // --- Phase 1: Pre-Detonation ---
    if (u_sim_time < 0.0) {
        float STAR_R = 0.8;
        // Render massive star
        float b = dot(ro, rd);
        float c_ = dot(ro, ro) - STAR_R*STAR_R;
        float d = b*b - c_;
        if (d >= 0.0) {
            float tHit = -b - sqrt(d);
            if (tHit > 0.0) {
                vec3 p = ro + rd * tHit;
                vec3 n = normalize(p);
                // Boiling surface
                float nVal = fbm3(n * 4.0 + u_real_time*0.2);
                vec3 starCol = mix(vec3(1.0, 0.3, 0.1), vec3(1.0, 0.8, 0.5), nVal); // Red Supergiant
                if (u_mass > 50.0) {
                    starCol = mix(vec3(0.2, 0.6, 1.0), vec3(0.8, 0.9, 1.0), nVal); // Blue Supergiant
                }
                
                // Limb darkening
                float fresnel = max(0.0, dot(-rd, n));
                starCol *= pow(fresnel, 0.5);
                
                col += starCol;
                transmit = 0.0;
            }
        }
    } 
    // --- Phase 2: Core Implosion (0.0 to 0.1s) ---
    else if (u_sim_time <= 0.1) {
        float progress = u_sim_time / 0.1;
        // Exponentially accelerating collapse from 0.8 down to 0.02
        float currentR = mix(0.8, 0.02, pow(progress, 3.0)); 
        
        float b = dot(ro, rd);
        float c_ = dot(ro, ro) - currentR*currentR;
        float d = b*b - c_;
        if (d >= 0.0) {
            float tHit = -b - sqrt(d);
            if (tHit > 0.0) {
                vec3 baseCol = (u_mass > 50.0) ? vec3(0.2, 0.6, 1.0) : vec3(1.0, 0.3, 0.1);
                vec3 hotCol = vec3(1.0, 1.0, 1.0);
                // As it compresses, temperature and brightness spike violently
                col += mix(baseCol, hotCol, progress) * (1.0 + progress * 50.0); 
                transmit = 0.0;
            }
        }
    }
    // --- Phase 3 & 4: Bounce, Shockwave & Remanent (> 0.1s) ---
    else {
        float expTime = u_sim_time - 0.1;
        float expansionSpeed = 15.0; // Visual scale km/s mapping
        float shockRadius = 0.02 + expTime * expansionSpeed;
        
        // Raymarch bounds for the expanding shockwave (wider to allow tentacles)
        float boundRadius = shockRadius * 2.5;
        float b = dot(ro, rd);
        float c_ = dot(ro, ro) - boundRadius*boundRadius;
        float disc = b*b - c_;
        
        if (disc >= 0.0) {
            float tNear = max(0.0, -b - sqrt(disc));
            float tFar = -b + sqrt(disc);
            
            int STEPS = 120; // Increased steps for photorealism
            float tStep = (tFar - tNear) / float(STEPS);
            float t = tNear + hash21(uv)*tStep; // dithering
            
            float coreTemp = exp(-expTime * 0.4); // Core cools exponentially after flash
            
            for (int i=0; i<STEPS; i++) {
                vec3 p = ro + rd * t;
                float r = length(p);
                
                // 1. Remanent Core (Pulsar / Neutron Star)
                if (r < 0.05) {
                    float coreGlow = smoothstep(0.05, 0.0, r);
                    vec3 cCol = vec3(0.1, 0.8, 1.0); // Intense cyan neutron radiation
                    col += cCol * coreTemp * transmit * 3.0;
                    transmit *= exp(-coreGlow * 30.0);
                }
                
                // 2. Shockwave Shell & Highly Chaotic Gas (Rayleigh-Taylor instability)
                if (r > 0.05 && r < boundRadius) {
                    vec3 dir = normalize(p);
                    
                    // Macro-Asymmetry: Supernova blasts at different speeds in different directions
                    float macroNoise = fbm3(dir * 2.0 + vec3(u_real_time * 0.05));
                    float directionalRadius = shockRadius * (0.3 + macroNoise * 2.0);
                    
                    float normR = r / directionalRadius;
                    
                    // Domain warping to create extreme stretching (tentacles)
                    vec3 warp = vec3(fbm3(p * 2.0 + u_real_time*0.1), fbm3(p * 2.2 - u_real_time*0.15), fbm3(p * 1.8 + u_real_time*0.05));
                    vec3 pWarped = p + warp * (0.5 + expTime * 0.5);
                    
                    // Noise coordinates scaling with expansion
                    vec3 pNoise = pWarped * (3.5 / shockRadius);
                    float shellNoise = fbm3(pNoise);
                    
                    // Cellular / Worley approximation for intricate web-like filaments (Crab Nebula style)
                    float n1 = fbm3(pNoise * 2.5);
                    float n2 = fbm3(pNoise * 2.5 + vec3(14.2, 5.1, -3.8));
                    float cellular = pow(1.0 - abs(n1 - n2), 5.0); // Sharp glowing veins
                    
                    // Void Cutout: Completely destroys the spherical shape by hiding huge chunks
                    float voidCut = smoothstep(0.3, 0.7, fbm3(dir * 2.5 + vec3(u_real_time * 0.02)));
                    
                    // Rayleigh-Taylor Fingers (highly irregular gas)
                    float shellShape = smoothstep(0.0, 0.6, normR) * smoothstep(1.8, 0.8, normR);
                    
                    // Chaos factor: spikes of density extending outwards + veins
                    float chaos = pow(shellNoise, 2.5) * 2.0 + cellular * 2.5;
                    float density = shellShape * chaos * exp(-expTime * 0.2) * 5.0 * voidCut;
                    
                    if (density > 0.01) {
                        float tempAge = expTime * 0.2 + (1.0-normR)*0.5;
                        
                        // Chemical mapping based on isolated noise layers (Hubble Palette)
                        float oxygen = smoothstep(0.3, 1.0, fbm3(pNoise * 1.5 + vec3(12.3))); // Cyan
                        float hydrogen = smoothstep(0.2, 0.8, fbm3(pNoise * 1.2 + vec3(-5.1))); // Magenta/Red
                        float sulfur = smoothstep(0.4, 1.0, fbm3(pNoise * 2.0 + vec3(8.8)));  // Yellow/Green
                        
                        vec3 oCol = vec3(0.05, 0.7, 1.0) * oxygen;
                        vec3 hCol = vec3(1.0, 0.15, 0.4) * hydrogen;
                        vec3 sCol = vec3(0.9, 0.8, 0.1) * sulfur;
                        
                        vec3 dustCol = (oCol + hCol + sCol) * 1.5;
                        
                        // Heat thermal fallback (bright white/orange right after flash)
                        vec3 thermalCol = mix(vec3(1.0, 0.8, 0.4), vec3(0.1, 0.0, 0.05), clamp(tempAge * 2.0, 0.0, 1.0));
                        
                        // Transition from purely thermal explosion to chemical cooling
                        dustCol = mix(thermalCol, dustCol, clamp(expTime * 1.5, 0.0, 1.0));
                        
                        // Internal Illumination from the pulsar
                        float coreLight = exp(-r * 0.8) * coreTemp * 8.0;
                        dustCol += vec3(0.6, 0.9, 1.0) * coreLight * shellNoise;
                        
                        col += dustCol * density * transmit * tStep * 3.0;
                        transmit *= exp(-density * tStep * 5.0);
                    }
                }
                
                t += tStep;
                if (transmit < 0.01) break;
            }
        }
        
        // Initial Neutrino Burst Flash (Blinds camera temporarily upon bounce)
        if (expTime > 0.0 && expTime < 0.4) {
            float flash = pow(1.0 - (expTime / 0.4), 4.0);
            col += vec3(0.8, 0.95, 1.0) * flash * 3.0 * transmit;
        }
    }

    col += starfield(rd) * transmit;

    // ACES Tonemapping
    col = col * (2.51*col + 0.03) / (col*(2.43*col + 0.59) + 0.14);
    col = clamp(col, 0.0, 1.0);
    col = pow(col, vec3(1.0/2.2));

    gl_FragColor = vec4(col, 1.0);
}
`;
        this.shaderMat = new THREE.ShaderMaterial({
            vertexShader: vs,
            fragmentShader: fs,
            uniforms: this.uniforms,
            depthWrite: false,
            depthTest: false
        });

        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.shaderMat);
        this.scene.add(quad);

        window.addEventListener("resize", () => this.resize());
    }

    _initMouseOrbit() {
        this._theta = 0.0;
        this._phi   = Math.PI / 2;
        this._camR  = 12.0;

        const el = this.renderer.domElement;
        let dragging = false, lx = 0, ly = 0;

        el.addEventListener("mousedown",  e => { dragging=true; lx=e.clientX; ly=e.clientY; });
        el.addEventListener("mouseup",    ()=> { dragging=false; });
        el.addEventListener("mouseleave", ()=> { dragging=false; });
        el.addEventListener("mousemove",  e => {
            if(!dragging) return;
            this._theta -= (e.clientX - lx) * 0.008;
            this._phi    = Math.max(0.1, Math.min(Math.PI-0.1, this._phi + (e.clientY-ly)*0.008));
            lx=e.clientX; ly=e.clientY;
            this._updateCam();
        });
        el.addEventListener("wheel", e => {
            this._camR = Math.max(2.0, Math.min(60.0, this._camR + e.deltaY*0.02));
            this._updateCam();
            e.preventDefault();
        }, { passive: false });

        this._updateCam();
    }

    _updateCam() {
        const x = this._camR * Math.sin(this._phi) * Math.sin(this._theta);
        const y = this._camR * Math.cos(this._phi);
        const z = this._camR * Math.sin(this._phi) * Math.cos(this._theta);
        this.uniforms.u_cam.value.set(x, y, z);
    }

    bindEvents() {
        this._initMouseOrbit();

        // UI Listeners
        this.sliderMass.addEventListener("input", (e) => {
            this.mass = parseFloat(e.target.value);
            this.numMass.textContent = this.mass.toFixed(1);
            this.uniforms.u_mass.value = this.mass;
        });

        this.sliderTimeScale.addEventListener("input", (e) => {
            this.updateTimeScaleDisplay();
        });

        this.btnDetonate.addEventListener("click", () => {
            if (!this.isDetonated) {
                this.isDetonated = true;
                this.simTime = 0.0; // Start explosion
                this.btnDetonate.textContent = "EXPLOSÃO EM CURSO";
                this.btnDetonate.style.backgroundColor = "#ff2a2a";
                this.btnDetonate.style.color = "white";
                this.btnDetonate.disabled = true;
            }
        });

        this.btnReset.addEventListener("click", () => {
            this.isDetonated = false;
            this.simTime = 0.0;
            this.uniforms.u_sim_time.value = -1.0;
            this.btnDetonate.textContent = "DETONAR SUPERNOVA";
            this.btnDetonate.style.backgroundColor = "";
            this.btnDetonate.disabled = false;
            this.metricTemp.textContent = "0 K";
            
            // Hide video player if active
            document.getElementById("sn-video-container").style.display = "none";
            this.container.style.display = "block";
            if (this.videoInterval) {
                clearInterval(this.videoInterval);
                this.videoInterval = null;
            }
        });

        // Video Editor / Pre-renderer Logic
        this.btnRenderVideo = document.getElementById("btn-sn-render-video");
        this.videoContainer = document.getElementById("sn-video-container");
        this.videoFrames = [];
        
        this.btnRenderVideo.addEventListener("click", async () => {
            if (this.isRenderingVideo) return;
            this.isRenderingVideo = true;
            this.btnRenderVideo.textContent = "⏳ CALCULANDO FRAMES (0%)...";
            this.btnRenderVideo.style.background = "#555";
            
            // Setup sequence
            this.isDetonated = true;
            this.simTime = 0.0;
            this._realTime = 0.0;
            
            const totalFrames = 180; // 3 seconds at 60fps
            const simTimeTarget = 2.5; // Simulate up to 2.5s of explosion
            const dt = simTimeTarget / totalFrames;
            this.videoFrames = [];
            
            this.pause(); // Pause live simulation
            
            // Render frames asynchronously to not freeze UI
            for (let i = 0; i < totalFrames; i++) {
                this.simTime = i * dt;
                this._realTime = i * dt;
                this.uniforms.u_sim_time.value = this.simTime;
                this.uniforms.u_real_time.value = this._realTime;
                
                // Force High Quality Steps just for the render
                this.renderer.render(this.scene, this.camera);
                
                // Capture frame to ImageBitmap (fastest way to store textures in RAM)
                const bitmap = await createImageBitmap(this.renderer.domElement);
                this.videoFrames.push(bitmap);
                
                if (i % 5 === 0) {
                    const pct = Math.round((i / totalFrames) * 100);
                    this.btnRenderVideo.textContent = `⏳ CALCULANDO FRAMES (${pct}%)...`;
                    await new Promise(r => setTimeout(r, 1)); // Yield to browser
                }
            }
            
            this.btnRenderVideo.textContent = "✅ VÍDEO RENDERIZADO";
            this.btnRenderVideo.style.background = "linear-gradient(135deg, #00f5d4, #0077ff)";
            this.isRenderingVideo = false;
            
            // Switch UI to Video Player
            this.container.style.display = "none";
            this.videoContainer.style.display = "block";
            
            // Create or get canvas for playback
            let playCanvas = document.getElementById("sn-playback-canvas");
            if (!playCanvas) {
                playCanvas = document.createElement("canvas");
                playCanvas.id = "sn-playback-canvas";
                playCanvas.width = this.renderer.domElement.width;
                playCanvas.height = this.renderer.domElement.height;
                playCanvas.style.width = "100%";
                playCanvas.style.borderRadius = "8px";
                playCanvas.style.border = "1px solid rgba(255,255,255,0.2)";
                
                // Replace the <video> tag from HTML with our Canvas player
                const videoTag = document.getElementById("sn-video-player");
                if(videoTag) videoTag.replaceWith(playCanvas);
            }
            
            const ctx = playCanvas.getContext("2d");
            let frameIdx = 0;
            
            if (this.videoInterval) clearInterval(this.videoInterval);
            this.videoInterval = setInterval(() => {
                if (this.videoFrames.length > 0) {
                    ctx.clearRect(0, 0, playCanvas.width, playCanvas.height);
                    ctx.drawImage(this.videoFrames[frameIdx], 0, 0);
                    frameIdx = (frameIdx + 1) % this.videoFrames.length;
                }
            }, 1000 / 60); // Playback smoothly at 60 FPS
            
        });
    }

    updateTimeScaleDisplay() {
        const val = parseInt(this.sliderTimeScale.value);
        // Map 0-6 to specific scales
        const scales = [0.00000025, 0.00001, 0.0001, 0.001, 0.01, 0.1, 1.0];
        this.timeScale = scales[val];
        
        if (this.timeScale === 1.0) {
            this.numTimeScale.textContent = "1.0000x (Tempo Real)";
        } else {
            this.numTimeScale.textContent = this.timeScale + "x";
        }
    }

    resize() {
        if (!this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.renderer.setSize(w, h);
        this.uniforms.u_resolution.value.set(w, h);
    }

    pause()  { this.isActive = false; }
    resume() {
        this.isActive = true;
        setTimeout(() => this.resize(), 50);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (!this.isActive || window.AstrophysicsLab.activeTab !== 'supernova') return;

        const dt = this.clock.getDelta();
        this._realTime += dt;
        this.uniforms.u_real_time.value = this._realTime;

        if (this.isDetonated) {
            // Advance simulation time using the highly precise timeScale
            this.simTime += dt * this.timeScale;
            this.uniforms.u_sim_time.value = this.simTime;
            
            // Update physical metrics
            const expansionVelocity = 15000; // km/s
            const currentRadius = expansionVelocity * this.simTime; // km
            
            // Format time with high precision if in extreme slow mo
            if (this.simTime < 0.01) {
                this.metricTime.textContent = (this.simTime * 1000).toFixed(6) + " ms";
            } else {
                this.metricTime.textContent = this.simTime.toFixed(3) + " s";
            }

            // Radius
            if (currentRadius > 1.496e8) {
                this.metricRadius.textContent = (currentRadius / 1.496e8).toFixed(4) + " UA";
            } else if (currentRadius > 1e6) {
                this.metricRadius.textContent = (currentRadius / 1e6).toFixed(2) + " Milhões km";
            } else {
                this.metricRadius.textContent = currentRadius.toFixed(0) + " km";
            }
            
            this.metricSpeed.textContent = expansionVelocity.toLocaleString() + " km/s";
            
            // Temperature drops exponentially
            const temp = 1e11 * Math.exp(-this.simTime * 2.0);
            this.metricTemp.textContent = window.formatScientific ? window.formatScientific(temp) + " K" : temp.toExponential(2) + " K";
        } else {
            // Pre-detonation stats
            const coreTemp = (this.mass > 50) ? 5e9 : 3e9; // 3-5 Billion K pre-collapse
            this.metricTemp.textContent = window.formatScientific ? window.formatScientific(coreTemp) + " K" : coreTemp.toExponential(2) + " K";
        }

        this.renderer.render(this.scene, this.camera);
    }
}

// Bootstrap
document.addEventListener("DOMContentLoaded", () => {
    new SupernovaSimulation();
});
