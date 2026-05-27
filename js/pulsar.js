//  Physics used:
//   • Magnetic dipole field: B(r) = B0 / r³
//   • Surface gravity:  g = GM/R²
//   • Rotational energy: E = ½Iω²  (I = 2/5 MR²)
//   • Lighthouse beam detection (dot product alignment)
// ============================================================

class PulsarSimulation {
    constructor() {
        this.container = document.getElementById("pulsar-container");

        // Physics state
        this.mass         = 1.4;    // Solar masses
        this.spinRate     = 30.0;   // Hz  (Crab Pulsar ~30 Hz)
        this.magneticField = 1e8;   // Tesla

        // UI Elements
        this.sliderMass  = document.getElementById("pulsar-mass");
        this.numMass     = document.getElementById("pulsar-mass-num");
        this.sliderSpin  = document.getElementById("pulsar-spin");
        this.numSpin     = document.getElementById("pulsar-spin-num");
        this.sliderMag   = document.getElementById("pulsar-mag");
        this.numMag      = document.getElementById("pulsar-mag-num");

        this.metricRadius  = document.getElementById("metric-p-radius");
        this.metricGravity = document.getElementById("metric-p-gravity");
        this.metricEnergy  = document.getElementById("metric-p-energy");

        // Lifecycle
        this.isActive   = false;
        this.clock      = new THREE.Clock();
        this._totalTime = 0;

        // Register globally
        window.AstrophysicsLab = window.AstrophysicsLab || { simulations: {} };
        window.AstrophysicsLab.simulations["pulsar"] = this;

        this.initThree();
        this.buildMagneticFieldLines();
        this.bindEvents();
        this.updatePhysics();
        this.animate();
    }

    // ----------------------------------------------------------
    //  THREE.JS SCENE — full-screen shader quad + 3D Lines overlay
    // ----------------------------------------------------------
    initThree() {
        const w = this.container.clientWidth  || 800;
        const h = this.container.clientHeight || 600;

        // ---- Renderer ----
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000002, 1);
        this.container.appendChild(this.renderer.domElement);

        // ---- Scene 2D: orthographic camera + full-screen quad (Raymarching) ----
        this.scene2D  = new THREE.Scene();
        this.camera2D = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // ---- Scene 3D: perspective camera for Vector Graphics (Magnetic Field) ----
        this.scene3D  = new THREE.Scene();
        this.camera3D = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);

        // ---- Uniforms ----
        this.uniforms = {
            u_resolution: { value: new THREE.Vector2(w, h) },
            u_time:       { value: 0.0 },
            u_spin:       { value: this.spinRate },
            u_mag:        { value: 0.0 },   // 0 = pulsar, 1 = magnetar
            u_cam:        { value: new THREE.Vector3(0.0, 2.5, 6.0) }
        };

        // ---- Fragment Shader (full raymarched pulsar) ----
        const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`;

        const fs = `
precision highp float;

uniform vec2  u_resolution;
uniform float u_time;
uniform float u_spin;    // actual Hz (used for rotation)
uniform float u_mag;     // 0..1 magnetar fraction
uniform vec3  u_cam;     // camera position

// ────────────────────────────────────────────────────────────
//  UTILITY
// ────────────────────────────────────────────────────────────
#define PI  3.14159265359
#define TAU 6.28318530718

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
    for(int i=0;i<5;i++){ v+=a*noise3(p); p*=2.3; a*=0.5; }
    return v;
}

// ────────────────────────────────────────────────────────────
//  ROTATION helpers
// ────────────────────────────────────────────────────────────
mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0,-s,0,1,0,s,0,c); }
mat3 rotZ(float a){ float c=cos(a),s=sin(a); return mat3(c,s,0,-s,c,0,0,0,1); }

// ────────────────────────────────────────────────────────────
//  CLEAN PREMIUM STARFIELD
// ────────────────────────────────────────────────────────────
vec3 starfield(vec3 ray) {
    ray = normalize(ray);
    vec3 d = abs(ray);
    vec2 uv;
    float face;

    // Cube-face projection
    if (d.x >= d.y && d.x >= d.z) {
        uv = ray.yz / d.x; face = ray.x > 0.0 ? 0.0 : 1.0;
    } else if (d.y >= d.z) {
        uv = ray.xz / d.y; face = ray.y > 0.0 ? 2.0 : 3.0;
    } else {
        uv = ray.xy / d.z; face = ray.z > 0.0 ? 4.0 : 5.0;
    }
    uv = uv * 0.5 + 0.5;

    vec3 col = vec3(0.0);

    // Sparse pinpoint stars
    for (int i = 0; i < 2; i++) {
        float sc = 30.0 + float(i) * 25.0;
        vec2 cell = floor(uv * sc + face * 13.0);
        vec2 f = fract(uv * sc);

        vec2 jitter = vec2(hash21(cell), hash21(cell + 13.0));
        float dStar = length(f - jitter);

        float bright = hash21(cell + 7.0);
        bright = pow(bright, 22.0); // Extremely sparse
        bright *= exp(-dStar * dStar * 800.0); // Tight point

        float hue = hash21(cell + 11.0);
        vec3 tint = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.9, 0.7), hue);
        col += bright * tint * 4.0;
    }
    
    // Very subtle deep space nebula (almost invisible, just to not be completely pitch black)
    float neb = fbm3(ray * 2.5) * 0.05;
    col += mix(vec3(0.0, 0.0, 0.02), vec3(0.02, 0.0, 0.04), ray.y*0.5+0.5) * neb;

    return col;
}

// ────────────────────────────────────────────────────────────
//  MAIN
// ────────────────────────────────────────────────────────────
void main(){
    vec2 fc = gl_FragCoord.xy;
    vec2 uv = (fc - 0.5*u_resolution) / u_resolution.y;

    // ---- Camera ----
    vec3 ro = u_cam;
    vec3 look = vec3(0.0);
    vec3 fwd  = normalize(look - ro);
    vec3 right= normalize(cross(fwd, vec3(0,1,0)));
    vec3 up2  = cross(right, fwd);
    vec3 rd   = normalize(fwd + uv.x*right + uv.y*up2);

    // ---- Rotation angles ----
    float visualHz = u_spin * 0.04;  // slow down so eye can track it
    float spinAngle = u_time * visualHz * TAU;
    float magTilt   = PI / 6.0;      // 30° dipole tilt from spin axis

    // Magnetic axis direction (in world space, rotating with star)
    mat3 Rspin = rotY(spinAngle);
    mat3 Rtilt = rotZ(magTilt);
    vec3 magAxis = Rspin * Rtilt * vec3(0.0, 1.0, 0.0);

    // ─── SDF scene ───────────────────────────────────────────
    float STAR_R = 0.55;

    // Raycast neutron star sphere
    float tHit = -1.0;
    {
        vec3 oc = ro;                        // centre at origin
        float b  = dot(oc, rd);
        float c_ = dot(oc,oc) - STAR_R*STAR_R;
        float dis = b*b - c_;
        if(dis >= 0.0){
            float t = -b - sqrt(dis);
            if(t > 0.01) tHit = t;
        }
    }

    // ─── Accumulate glow volumes (raymarching) ─────────────────
    vec3  col      = vec3(0.0);
    float transmit = 1.0;

    const int STEPS = 80;
    float tMax  = 14.0;
    float tStep = tMax / float(STEPS);
    float t     = 0.02;

    for(int i=0; i<STEPS; i++){
        if(tHit > 0.001 && t > tHit) break;

        vec3 p = ro + rd * t;
        float rr = length(p);

        // ── A. Corona glow around the star ──
        {
            float corona = exp(-max(rr - STAR_R, 0.0) * 4.5);
            // colour: cyan-white core, blue halo
            vec3 cCoronaCol = mix(vec3(0.1,0.5,1.0), vec3(0.8,0.9,1.0), corona);
            // magnetar: corona shifts violet-ultraviolet
            cCoronaCol = mix(cCoronaCol, vec3(0.7,0.1,1.0), u_mag * (1.0-corona*0.5));
            float dens = corona * 0.04;
            col       += cCoronaCol * dens * transmit;
            transmit  *= exp(-dens);
        }

        // ── B. Relativistic polar jets ──────────────────────
        {
            float cosA = dot(normalize(p), magAxis);
            float sinA = length(p - cosA*magAxis * rr / max(length(magAxis),0.0001));
            // Jet: very tight cone, full length
            float jetRadius = 0.04 + abs(cosA) * rr * 0.15;
            float dJet = length(p - dot(p,magAxis)*magAxis);
            float jetCone = smoothstep(jetRadius*2.0, jetRadius*0.1, dJet);

            if(jetCone > 0.001){
                // Plasma noise along jet
                float jNoise = noise3(p * vec3(5.0,1.0,5.0) + vec3(0.0, u_time*4.5, 0.0));
                float decay  = exp(-rr * 0.28);
                float dens   = jetCone * decay * (0.3 + 0.7*jNoise) * 0.08;

                // Jet colour: white-cyan for normal, violet for magnetar
                vec3 jCol = mix(vec3(0.4,0.8,1.0), vec3(0.9,0.2,1.0), u_mag);
                jCol = mix(jCol, vec3(1.0), jetCone * decay * 0.5);

                col      += jCol * dens * transmit;
                transmit *= exp(-dens * 0.5);
            }
        }

        // ── C. Pulse beat — periodic bright flare ─────────────
        {
            float pulse = pow(max(0.0, dot(rd, -magAxis)), 12.0);
            pulse      += pow(max(0.0, dot(rd,  magAxis)), 12.0);
            float beat  = max(0.0, sin(u_time * u_spin * TAU * 0.04));
            beat        = pow(beat, 6.0);
            float dens  = pulse * beat * 0.15;
            vec3 pCol   = mix(vec3(0.8,0.9,1.0), vec3(0.9,0.6,1.0), u_mag);
            col        += pCol * dens * transmit;
        }

        t += tStep;
    }

    // ─── Star surface (Improved Model) ────────────────────────
    if(tHit > 0.001){
        vec3 hp    = ro + rd * tHit;
        vec3 norm  = normalize(hp);

        // Spin the surface
        mat3 spinMat = rotY(spinAngle);
        vec3 sNorm   = spinMat * norm;

        // Animated intense boiling plasma
        vec3 ppos = sNorm * 4.0 + u_time * vec3(0.2, 0.1, 0.2);
        // Sharp ridges for neutron degenerate matter look
        float plasma = 1.0 - abs(fbm3(ppos) * 2.0 - 1.0); 
        plasma = pow(plasma, 2.0);

        // Base colour: extremely hot blue-white
        vec3 surfCol = mix(vec3(0.0,0.4,0.9), vec3(1.0,1.0,1.0), plasma);

        // Poles (magnetic axis on sphere): bright hot-spots
        float poleAlign = abs(dot(norm, magAxis));
        vec3  polCol    = mix(vec3(0.6,0.9,1.0), vec3(1.0,0.4,1.0), u_mag);
        surfCol = mix(surfCol, polCol*2.5, pow(poleAlign, 6.0));

        // Fresnel edge — limb darkening
        float fresnel = 1.0 - max(dot(norm, -rd), 0.0);
        surfCol      *= 1.0 - fresnel*0.4;

        // Add blinding white core at the exact poles
        float hotCap = pow(poleAlign, 16.0) * 3.0;
        surfCol += vec3(1.0) * hotCap;

        col += surfCol * transmit;
        transmit = 0.0;
    }

    // ─── Background stars ─────────────────────────────────────
    col += starfield(rd) * transmit;

    // ─── Tonemapping (ACES filmic) ────────────────────────────
    col = col * (2.51*col + 0.03) / (col*(2.43*col + 0.59) + 0.14);
    col = clamp(col, 0.0, 1.0);
    col = pow(col, vec3(1.0/2.2));

    gl_FragColor = vec4(col, 1.0);
}`;

        this.shaderMat = new THREE.ShaderMaterial({
            vertexShader:   vs,
            fragmentShader: fs,
            uniforms:       this.uniforms,
            depthWrite: false,
            depthTest:  false
        });

        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.shaderMat);
        this.scene2D.add(quad);

        // ---- Flash overlay div ----
        this.flashDiv = document.createElement("div");
        Object.assign(this.flashDiv.style, {
            position: "absolute", inset: "0", background: "white",
            opacity: "0", pointerEvents: "none", zIndex: "10",
            transition: "opacity 0.08s"
        });
        this.container.appendChild(this.flashDiv);

        window.addEventListener("resize", () => this.resize());
    }

    // ----------------------------------------------------------
    //  MAGNETIC FIELD LINES (3D Vector Overlay)
    // ----------------------------------------------------------
    buildMagneticFieldLines() {
        // Equation for magnetic dipole field line: r = L * sin^2(theta)
        const L_values = [1.2, 1.8, 2.6, 3.8, 5.5]; // Shell sizes
        const numLongitudes = 16;
        const ptsPerLine = 64;

        const points = [];
        const colors = [];

        for (let L of L_values) {
            for (let i = 0; i < numLongitudes; i++) {
                const phi = (i / numLongitudes) * Math.PI * 2;
                
                for (let j = 0; j <= ptsPerLine; j++) {
                    // Theta goes from 0 to PI. We skip exactly 0 and PI so r doesn't hit 0 inside the star
                    // We only draw lines outside the star surface (r > 0.55)
                    const theta = 0.01 + (j / ptsPerLine) * (Math.PI - 0.02);
                    const r = L * Math.sin(theta) * Math.sin(theta);
                    
                    if (r < 0.55) continue; // Inside the star

                    // Spherical to Cartesian
                    const x = r * Math.sin(theta) * Math.cos(phi);
                    const z = r * Math.sin(theta) * Math.sin(phi);
                    const y = r * Math.cos(theta); // Magnetic axis is Y

                    points.push(x, y, z);
                    
                    // Alpha fade out further away
                    const alpha = Math.max(0, 1.0 - (r / 6.0));
                    colors.push(alpha, alpha, alpha);
                }
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        // Use LineBasicMaterial with vertex colors to create glowing lines
        this.magMat = new THREE.LineBasicMaterial({
            color: 0x44aaff,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.magLines = new THREE.Line(geo, this.magMat);
        
        // We put all lines into a group so we can rotate them together based on spin/tilt
        this.magGroup = new THREE.Group();
        this.magGroup.add(this.magLines);
        this.scene3D.add(this.magGroup);
    }

    // ----------------------------------------------------------
    //  MOUSE ORBIT
    // ----------------------------------------------------------
    _initMouseOrbit() {
        this._theta = 0.3;   // horizontal angle
        this._phi   = 0.45;  // vertical angle (from Y-axis)
        this._camR  = 6.0;

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
            this._camR = Math.max(2.5, Math.min(15, this._camR + e.deltaY*0.01));
            this._updateCam();
            e.preventDefault();
        }, { passive: false });

        this._updateCam();
    }

    _updateCam() {
        const x = this._camR * Math.sin(this._phi) * Math.sin(this._theta);
        const y = this._camR * Math.cos(this._phi);
        const z = this._camR * Math.sin(this._phi) * Math.cos(this._theta);
        
        // Update shader camera
        this.uniforms.u_cam.value.set(x, y, z);
        
        // Update 3D Lines camera
        this.camera3D.position.set(x, y, z);
        this.camera3D.lookAt(0, 0, 0);
    }

    // ----------------------------------------------------------
    //  CONTROLS BINDING
    // ----------------------------------------------------------
    bindEvents() {
        this._initMouseOrbit();

        const sync = () => {
            this.mass          = parseFloat(this.sliderMass.value);
            this.spinRate      = parseFloat(this.sliderSpin.value);
            this.magneticField = parseFloat(this.sliderMag.value);
            this.numMass.value = this.mass;
            this.numSpin.value = this.spinRate;
            this.numMag.value  = this.magneticField;
            this.updatePhysics();
        };

        this.sliderMass.addEventListener("input",  sync);
        this.numMass.addEventListener("change",    e => { this.sliderMass.value=e.target.value; sync(); });
        this.sliderSpin.addEventListener("input",  sync);
        this.numSpin.addEventListener("change",    e => { this.sliderSpin.value=e.target.value; sync(); });
        this.sliderMag.addEventListener("input",   sync);
        this.numMag.addEventListener("change",     e => { this.sliderMag.value=e.target.value;  sync(); });
    }

    // ----------------------------------------------------------
    //  PHYSICS CALCULATIONS
    // ----------------------------------------------------------
    updatePhysics() {
        const G   = 6.674e-11;
        const Ms  = 1.989e30;
        const rKm = 12.0 * Math.pow(this.mass / 1.4, -0.33);
        const R   = rKm * 1e3;

        const gSurf = G * this.mass * Ms / (R * R);
        const gEarth = gSurf / 9.81;

        const omega = 2 * Math.PI * this.spinRate;
        const I     = 0.4 * this.mass * Ms * R * R;
        const Erot  = 0.5 * I * omega * omega;

        this.metricRadius.textContent  = rKm.toFixed(1) + " km";
        this.metricGravity.textContent = window.formatScientific(gEarth) + " g⊕";
        this.metricEnergy.textContent  = window.formatScientific(Erot)   + " J";

        // Magnetar fraction
        const magLog  = Math.max(0, Math.log10(this.magneticField) - 7);
        const magFrac = Math.min(magLog / 4, 1);
        this.uniforms.u_mag.value   = magFrac;
        this.uniforms.u_spin.value  = this.spinRate;
        
        // Change magnetic line color based on magnetar intensity
        const baseCol = new THREE.Color(0x44aaff);
        const magCol  = new THREE.Color(0xdc44ff);
        this.magMat.color.copy(baseCol).lerp(magCol, magFrac);
        // Increase opacity as field gets stronger
        this.magMat.opacity = 0.5 + magFrac * 0.5;
    }

    // ----------------------------------------------------------
    //  RENDER LOOP
    // ----------------------------------------------------------
    pause()  { this.isActive = false; }
    resume() {
        this.isActive = true;
        setTimeout(() => this.resize(), 50);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (!this.isActive || window.AstrophysicsLab.activeTab !== 'pulsar') return;

        const dt = this.clock.getDelta();
        this._totalTime += dt;
        this.uniforms.u_time.value = this._totalTime;

        // Update Magnetic Field Lines Rotation
        const visualHz  = this.spinRate * 0.04;
        const spinAngle = this._totalTime * visualHz * Math.PI * 2;
        const magTilt   = Math.PI / 6.0; // 30 degrees
        
        // The shader performs rotY(spin) * rotZ(tilt) on the Y axis
        // We replicate this rotation on the 3D group
        this.magGroup.rotation.set(0, 0, 0); // Reset
        this.magGroup.rotateY(spinAngle);
        this.magGroup.rotateZ(magTilt);

        // Lighthouse flash
        const beatPhase = Math.sin(this._totalTime * visualHz * Math.PI * 2);
        const flash     = Math.pow(Math.max(0, beatPhase), 8);
        this.flashDiv.style.opacity = (flash * 0.35 * this.uniforms.u_mag.value).toFixed(3);

        // Render pass 1: Raymarched Shader (clears screen)
        this.renderer.autoClear = true;
        this.renderer.render(this.scene2D, this.camera2D);
        
        // Render pass 2: 3D Vector Lines (on top without clearing)
        this.renderer.autoClear = false;
        this.renderer.render(this.scene3D, this.camera3D);
    }

    resize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.renderer.setSize(w, h);
        this.uniforms.u_resolution.value.set(w, h);
        
        this.camera3D.aspect = w / h;
        this.camera3D.updateProjectionMatrix();
    }
}

// ---- Bootstrap ----
document.addEventListener("DOMContentLoaded", () => {
    new PulsarSimulation();
});
