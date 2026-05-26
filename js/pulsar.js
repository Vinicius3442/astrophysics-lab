// ============================================================
//  PULSAR / MAGNETAR SIMULATION  –  v2  (full shader glow)
//
//  A neutron star is rendered ENTIRELY via a raymarching
//  fragment shader.  There is NO mesh sphere, NO disk, NO
//  Three.js geometry except a full-screen quad.
//
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
        this.bindEvents();
        this.updatePhysics();
        this.animate();
    }

    // ----------------------------------------------------------
    //  THREE.JS SCENE — full-screen shader quad + overlay canvas
    // ----------------------------------------------------------
    initThree() {
        const w = this.container.clientWidth  || 800;
        const h = this.container.clientHeight || 600;

        // ---- Renderer ----
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000005, 1);
        this.container.appendChild(this.renderer.domElement);

        // ---- Scene: orthographic camera + full-screen quad ----
        this.scene  = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // ---- Uniforms ----
        this.uniforms = {
            u_resolution: { value: new THREE.Vector2(w, h) },
            u_time:       { value: 0.0 },
            u_spin:       { value: this.spinRate },
            u_mag:        { value: 0.0 },   // 0 = pulsar, 1 = magnetar
            u_cam:        { value: new THREE.Vector3(0.0, 2.5, 6.0) }
        };

        // ---- Fragment Shader (full raymarched pulsar) ----
        const vs = `void main(){ gl_Position = vec4(position,1.0); }`;

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

float hash11(float n){ return fract(sin(n)*43758.5453123); }
float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }

float noise2(vec2 p){
    vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),
               mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);
}
float fbm2(vec2 p){
    float v=0.0,a=0.5;
    for(int i=0;i<5;i++){ v+=a*noise2(p); p*=2.1; a*=0.5; }
    return v;
}

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
    for(int i=0;i<4;i++){ v+=a*noise3(p); p*=2.3; a*=0.5; }
    return v;
}

// ────────────────────────────────────────────────────────────
//  SDFs
// ────────────────────────────────────────────────────────────
float sdSphere(vec3 p, float r){ return length(p)-r; }

// Infinite cone along Y with half-angle α
float sdCone(vec3 p, float alpha){
    float q = length(p.xz);
    return q * cos(alpha) - abs(p.y) * sin(alpha);
}

// ────────────────────────────────────────────────────────────
//  ROTATION helpers
// ────────────────────────────────────────────────────────────
mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0,-s,0,1,0,s,0,c); }
mat3 rotZ(float a){ float c=cos(a),s=sin(a); return mat3(c,s,0,-s,c,0,0,0,1); }

// ────────────────────────────────────────────────────────────
//  STARFIELD  (fast, cheap, beautiful)
// ────────────────────────────────────────────────────────────
vec3 starfield(vec3 dir){
    vec3 col = vec3(0.0);
    // Three layers at different scales
    for(int i=0;i<3;i++){
        float sc = float(i)*1.7+1.0;
        vec2 uv = vec2(atan(dir.z,dir.x), asin(dir.y)) * sc * 4.0;
        float s = noise2(uv*8.0);
        s = pow(s,18.0)*3.0;
        // star colour varies
        vec3 tint = mix(vec3(0.9,0.95,1.0), vec3(1.0,0.8,0.5), hash21(floor(uv*8.0)));
        col += s * tint;
    }
    // Faint nebula haze
    float neb = fbm2(vec2(dir.x+dir.z, dir.y)*2.0)*0.07;
    col += mix(vec3(0.05,0.0,0.12), vec3(0.0,0.05,0.15), dir.y*0.5+0.5)*neb;
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
    float visualHz = u_spin * 0.06;  // slow down so eye can track it
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

    const int STEPS = 96;
    float tMax  = 14.0;
    float tStep = tMax / float(STEPS);
    float t     = 0.02;

    for(int i=0; i<STEPS; i++){
        if(tHit > 0.001 && t > tHit) break;

        vec3 p = ro + rd * t;
        float rr = length(p);

        // ── A. Corona glow around the star ──
        {
            float corona = exp(-max(rr - STAR_R, 0.0) * 5.5);
            // colour: cyan-white core, blue halo
            vec3 cCoronaCol = mix(vec3(0.3,0.7,1.0), vec3(1.0,1.0,1.0), corona);
            // magnetar: corona shifts violet-ultraviolet
            cCoronaCol = mix(cCoronaCol, vec3(0.9,0.3,1.0), u_mag * (1.0-corona*0.5));
            float dens = corona * 0.035;
            col       += cCoronaCol * dens * transmit;
            transmit  *= exp(-dens);
        }

        // ── B. Relativistic polar jets ──────────────────────
        // Distance from the magnetic axis line
        {
            float cosA = dot(normalize(p), magAxis);
            float sinA = length(p - cosA*magAxis * rr / max(length(magAxis),0.0001));
            // Jet: very tight cone, full length
            float jetRadius = 0.08 + abs(cosA) * rr * 0.12;
            float dJet = length(p - dot(p,magAxis)*magAxis);
            float jetCone = smoothstep(jetRadius*1.8, jetRadius*0.3, dJet);
            float dirCheck = abs(cosA);   // 1 = on axis

            if(jetCone > 0.001){
                // Plasma noise along jet
                float jNoise = noise3(p * vec3(4.0,0.5,4.0) + vec3(0.0, u_time*3.5, 0.0));
                float decay  = exp(-rr * 0.25);
                float dens   = jetCone * decay * (0.4 + 0.6*jNoise) * 0.06;

                // Jet colour: white-cyan for normal, violet for magnetar
                vec3 jCol = mix(vec3(0.6,0.9,1.0), vec3(0.8,0.0,1.0), u_mag);
                jCol = mix(jCol, vec3(1.0), jetCone * decay * 0.4);

                col      += jCol * dens * transmit;
                transmit *= exp(-dens * 0.5);
            }
        }

        // ── C. Magnetic field lines glow (dipole) ─────────────
        // Dipole field strength ~ 1/r³
        {
            float B  = 1.0 / (rr * rr * rr + 0.01);
            B = clamp(B * 0.002, 0.0, 1.0);
            vec3 Bcol = mix(vec3(0.0,0.2,0.7), vec3(0.6,0.0,1.0), u_mag);
            float dens = B * 0.004;
            col      += Bcol * dens * transmit;
            transmit *= exp(-dens);
        }

        // ── D. Pulse beat — periodic bright flare ─────────────
        // Simulates the lighthouse effect as a global brightening
        // The glow direction is the magnetic axis; camera gets
        // blasted when it aligns with the jet.
        {
            float pulse = pow(max(0.0, dot(rd, -magAxis)), 12.0);
            pulse      += pow(max(0.0, dot(rd,  magAxis)), 12.0);
            float beat  = max(0.0, sin(u_time * u_spin * TAU * 0.06));
            beat        = pow(beat, 6.0);
            float dens  = pulse * beat * 0.2;
            vec3 pCol   = mix(vec3(0.8,0.9,1.0), vec3(0.9,0.6,1.0), u_mag);
            col        += pCol * dens * transmit;
        }

        t += tStep;
    }

    // ─── Star surface ─────────────────────────────────────────
    if(tHit > 0.001){
        vec3 hp    = ro + rd * tHit;
        vec3 norm  = normalize(hp);

        // Spin the surface UV
        mat3 spinMat = rotY(spinAngle);
        vec3 sNorm   = spinMat * norm;

        // Animated plasma on surface
        vec3 ppos = sNorm * 3.0 + u_time * vec3(0.15, 0.08, 0.12);
        float plasma = fbm3(ppos);

        // Base colour: hot blue-white neutron star
        vec3 surfCol = mix(vec3(0.2,0.6,1.0), vec3(1.0,1.0,1.0), plasma*0.8);

        // Poles (magnetic axis on sphere): bright hot-spots
        float poleAlign = abs(dot(norm, magAxis));
        vec3  polCol    = mix(vec3(0.5,0.9,1.0), vec3(0.9,0.3,1.0), u_mag);
        surfCol = mix(surfCol, polCol*3.0, pow(poleAlign, 4.0));

        // Fresnel edge — limb is slightly dimmer
        float fresnel = 1.0 - max(dot(norm, -rd), 0.0);
        surfCol      *= 1.0 - fresnel*0.3;

        // Surface emits extra brightness near poles for "hot cap" look
        float hotCap = pow(poleAlign, 6.0) * 2.0;
        surfCol += vec3(1.0,1.0,1.0) * hotCap;

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
        this.scene.add(quad);

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
    //  MOUSE ORBIT  (no OrbitControls needed for 2D shader cam)
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
        this.uniforms.u_cam.value.set(x, y, z);
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

        // Lighthouse flash (simple: pulse based on spin and time modulation)
        const visualHz  = this.spinRate * 0.06;
        const beatPhase = Math.sin(this._totalTime * visualHz * Math.PI * 2);
        const flash     = Math.pow(Math.max(0, beatPhase), 8);
        this.flashDiv.style.opacity = (flash * 0.35 * this.uniforms.u_mag.value).toFixed(3);

        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.renderer.setSize(w, h);
        this.uniforms.u_resolution.value.set(w, h);
    }
}

// ---- Bootstrap ----
document.addEventListener("DOMContentLoaded", () => {
    new PulsarSimulation();
});
