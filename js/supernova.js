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

    // --- Pre-detonation Star ---
    float STAR_R = 0.8;
    
    if (u_sim_time < 0.0) {
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
                // If mass > 50, make it a Blue Supergiant
                if (u_mass > 50.0) {
                    starCol = mix(vec3(0.2, 0.6, 1.0), vec3(0.8, 0.9, 1.0), nVal);
                }
                
                // Limb darkening
                float fresnel = max(0.0, dot(-rd, n));
                starCol *= pow(fresnel, 0.5);
                
                col += starCol;
                transmit = 0.0;
            }
        }
    } 
    // --- Post-detonation Supernova Explosion ---
    else {
        // Physical params scaled for visual
        // Expansion velocity: ~10,000 km/s -> mapped to visual space
        // Let's assume visual space 1 unit = 1 million km.
        float expansionSpeed = 10.0; // Units per second in sim time
        float shockRadius = STAR_R + u_sim_time * expansionSpeed;
        float coreTemp = exp(-u_sim_time * 0.5); // Core cools exponentially
        
        // Raymarching bounds
        float b = dot(ro, rd);
        float c_ = dot(ro, ro) - (shockRadius*1.5)*(shockRadius*1.5); // bounding sphere slightly larger
        float disc = b*b - c_;
        
        if (disc >= 0.0) {
            float tNear = max(0.0, -b - sqrt(disc));
            float tFar = -b + sqrt(disc);
            
            int STEPS = 80;
            float tStep = (tFar - tNear) / float(STEPS);
            float t = tNear + hash21(uv)*tStep; // dithering

            for (int i=0; i<STEPS; i++) {
                vec3 p = ro + rd * t;
                float r = length(p);
                
                // 1. Core / Neutron Star remnant
                if (r < 0.1) {
                    float coreGlow = smoothstep(0.1, 0.0, r);
                    vec3 cCol = mix(vec3(0.0,0.5,1.0), vec3(1.0), coreGlow);
                    col += cCol * coreTemp * transmit * 0.5;
                    transmit *= exp(-coreGlow * 10.0);
                }
                
                // 2. Shockwave Shell & Dust
                if (r > 0.1 && r < shockRadius) {
                    // Normalize position inside the shell [0..1]
                    float normR = r / shockRadius;
                    
                    // Rayleigh-Taylor instabilities (fingers of material)
                    vec3 pNoise = p * (3.0 / shockRadius) + vec3(u_real_time*0.1);
                    float shellNoise = fbm3(pNoise);
                    
                    // Dense shell at the outer edge, empty inside
                    float shellShape = smoothstep(0.6, 0.95, normR) * smoothstep(1.05, 0.95, normR);
                    // Add fingers reaching inwards
                    shellShape += smoothstep(0.2, 0.8, normR) * pow(shellNoise, 3.0);
                    
                    float density = shellShape * exp(-u_sim_time * 0.2) * 2.0; // dissipates over time
                    
                    if (density > 0.01) {
                        // Temperature color mapping
                        // Early = hot (white/blue/violet), Mid = orange/red, Late = dark/dust
                        float tempAge = u_sim_time * 0.15 + (1.0-normR)*0.5; // Outer edge cools faster
                        
                        vec3 dustCol;
                        if (tempAge < 0.2) {
                            dustCol = mix(vec3(1.0, 1.0, 1.0), vec3(0.5, 0.0, 1.0), tempAge/0.2); // Flash to Violet
                        } else if (tempAge < 0.6) {
                            dustCol = mix(vec3(0.5, 0.0, 1.0), vec3(1.0, 0.2, 0.0), (tempAge-0.2)/0.4); // Violet to Red
                        } else if (tempAge < 1.0) {
                            dustCol = mix(vec3(1.0, 0.2, 0.0), vec3(0.1, 0.0, 0.0), (tempAge-0.6)/0.4); // Red to Dark
                        } else {
                            dustCol = vec3(0.01); // Cold dark dust
                        }
                        
                        // Illumination from the core
                        float coreLight = exp(-r * 0.5) * coreTemp * 5.0;
                        dustCol += vec3(0.5, 0.8, 1.0) * coreLight * shellNoise;
                        
                        col += dustCol * density * transmit * tStep * 2.0;
                        transmit *= exp(-density * tStep * 4.0);
                    }
                }
                
                t += tStep;
                if (transmit < 0.01) break;
            }
        }
        
        // Initial flash (blinds the camera)
        if (u_sim_time > 0.0 && u_sim_time < 0.5) {
            float flash = pow(1.0 - (u_sim_time / 0.5), 3.0);
            col += vec3(1.0) * flash * transmit;
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
            
            this.metricTime.textContent = "0.000 s";
            this.metricRadius.textContent = "0.00 km";
            this.metricSpeed.textContent = "0 km/s";
            this.metricTemp.textContent = "0 K";
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
