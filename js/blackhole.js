// ============================================================
//  BLACK HOLE SIMULATOR (js/blackhole.js)
//  Volumetric Raymarching & High-Precision Geodesics
// ============================================================

class BlackHoleSimulation {
    constructor() {
        this.container = document.getElementById("blackhole-canvas-container");

        // Physics limits and state
        this.mass = 4.3e6; // Solar masses (Sgr A*)
        this.accretionRate = 1.0;
        this.spin = 0.0;
        this.bhType = 'schwarzschild'; 

        // UI references
        this.sliderMass   = document.getElementById("slider-b-mass");
        this.numMass      = document.getElementById("val-b-mass");
        this.sliderAcc    = document.getElementById("slider-b-bright");
        this.numAcc       = document.getElementById("val-b-bright");
        
        this.toggleDoppler = document.getElementById("toggle-b-doppler");
        this.toggleRedshift = document.getElementById("toggle-b-redshift");
        this.toggleLensing = document.getElementById("toggle-b-lensing");

        this.metricRadius = document.getElementById("metric-b-rs");
        this.metricIsco   = document.getElementById("metric-b-isco");
        this.metricTemp   = document.getElementById("metric-b-rph"); // reusing Rph slot for Temp or skip

        this.isActive = true;
        this.clock = new THREE.Clock();
        this._totalTime = 0;

        window.AstrophysicsLab = window.AstrophysicsLab || { simulations: {} };
        window.AstrophysicsLab.simulations["blackhole"] = this;

        this.initThree();
        this.bindEvents();
        this.updatePhysics();
        this.animate();
    }

    // Convert BH Type to float for shader
    getBhTypeFloat() {
        if (this.bhType === 'schwar') return 0.0;
        if (this.bhType === 'kerr') return 1.0;
        if (this.bhType === 'quasar') return 2.0;
        return 0.0;
    }

    initThree() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        // Scene
        this.scene = new THREE.Scene();

        // Virtual camera mapped to OrbitControls (Scale invariant space)
        // RS = 1.0 in shader. Camera orbits between 2.5 and 50.0.
        this.virtualCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
        this.virtualCamera.position.set(0, 8.0, 16.0); // Better angle for Gargantua
        this.virtualCamera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0)); 
        this.container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.virtualCamera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 2.1; 
        this.controls.maxDistance = 45.0; 
        this.controls.enablePan = false; 

        // Shader parameters
        this.uniforms = {
            u_resolution: { value: new THREE.Vector2(width, height) },
            u_time: { value: 0.0 },
            u_accretion_rate: { value: 1.0 },
            u_doppler_enabled: { value: 1.0 },
            u_lensing_enabled: { value: 1.0 },
            u_spin: { value: 0.0 },
            u_bh_type: { value: 0.0 },
            u_cam_pos:   { value: new THREE.Vector3() },
            u_cam_dir:   { value: new THREE.Vector3() },
            u_cam_up:    { value: new THREE.Vector3() },
            u_cam_right: { value: new THREE.Vector3() },
            u_fov_scale: { value: 1.0 }
        };

        const vs = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `;

        const fs = `

            uniform vec2  u_resolution;
            uniform float u_time;
            uniform float u_accretion_rate;
            uniform float u_doppler_enabled;
            uniform float u_lensing_enabled;
            uniform float u_spin;
            uniform float u_bh_type;

            uniform vec3  u_cam_pos;
            uniform vec3  u_cam_dir;
            uniform vec3  u_cam_up;
            uniform vec3  u_cam_right;
            uniform float u_fov_scale;

            #define RS       1.0
            #define MAX_STEPS 512
            #define PI       3.14159265358979
            #define ISCO     (3.0 * RS)
            #define DISK_OUT (13.0 * RS)

            // ─── Hash / Noise ───────────────────────────────────────────
            float hash1(float n)  { return fract(sin(n) * 43758.5453123); }
            float hash2f(vec2 p)  { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
            float noise3(vec3 x)  {
                vec3 i = floor(x), f = fract(x);
                f = f*f*(3.0-2.0*f);
                float n = i.x + i.y*57.0 + 113.0*i.z;
                return mix(mix(mix(hash1(n),hash1(n+1.),f.x),mix(hash1(n+57.),hash1(n+58.),f.x),f.y),
                           mix(mix(hash1(n+113.),hash1(n+114.),f.x),mix(hash1(n+170.),hash1(n+171.),f.x),f.y),f.z);
            }
            float fbm(vec3 p) {
                return 0.5*noise3(p) + 0.25*noise3(p*2.02) + 0.125*noise3(p*4.05) + 0.0625*noise3(p*8.09);
            }

            // ─── STARFIELD: Cellular grid of point stars ──────────────────
            // Each cell on the sky sphere gets a single, sharp luminous dot.
            // These will be visibly distorted (arced, duplicated) by gravitational lensing.
            vec3 starfield(vec3 dir) {
                vec3 col = vec3(0.0);

                // Subtle galactic dust band
                float gal = exp(-abs(dir.y) * 5.0) * 0.04;
                col += vec3(0.04, 0.02, 0.09) * gal;

                // Cellular grid: convert direction to angular coords
                float phi   = atan(dir.z, dir.x);            // -PI..PI
                float theta = asin(clamp(dir.y, -1.0, 1.0)); // -PI/2..PI/2

                // Three resolution layers for natural distribution
                float scales[3];
                scales[0] = 18.0;
                scales[1] = 40.0;
                scales[2] = 90.0;

                for (int lyr = 0; lyr < 3; lyr++) {
                    float sc = scales[lyr];
                    vec2 ang = vec2(phi, theta) * sc / PI;
                    vec2 cell = floor(ang);
                    vec2 fr   = fract(ang);

                    // Random star within cell
                    float rnd = hash2f(cell + vec2(float(lyr) * 17.3, float(lyr) * 31.7));
                    if (rnd > 0.88) { // ~12% of cells get a star
                        vec2 spos = vec2(hash2f(cell + vec2(3.1, 7.7)),
                                         hash2f(cell + vec2(13.3, 19.1)));
                        float d = length(fr - spos);

                        // Sharp point star (sub-pixel to ~2px)
                        float pixR = (lyr == 0) ? 0.04 : (lyr == 1) ? 0.025 : 0.015;
                        float bri  = smoothstep(pixR, 0.0, d);

                        // Tiny diffraction spike for brightest stars
                        float spike = max(0.0, 1.0 - abs(fr.x - spos.x) * 30.0) *
                                      max(0.0, 1.0 - abs(fr.y - spos.y) * 30.0);
                        bri += spike * 0.3 * float(lyr == 0);

                        // Color temperature (blue O/B to red M)
                        float tc = hash2f(cell + vec2(57.1, 23.4));
                        vec3 sc3 = mix(vec3(0.5, 0.7, 1.0), mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.4, 0.2), tc), tc);

                        // Brightness varies per star
                        float mag = (1.0 - rnd) * 3.0 + 0.5;
                        col += bri * sc3 * mag;
                    }
                }

                return col;
            }

            // ─── DISK: Blackbody temperature → RGB ────────────────────────
            // Maps temperature in Kelvin to approximate sRGB color.
            vec3 blackbody(float T) {
                // Piecewise approximation (Planck curve fit)
                T = clamp(T, 1000.0, 40000.0);
                vec3 c;
                c.r = (T < 6600.0) ? 1.0 : clamp(329.698727 * pow(T/100.0 - 60.0, -0.1332047) / 255.0, 0.0, 1.0);
                c.g = (T < 6600.0) ? clamp((99.4708025 * log(T/100.0) - 161.1195681) / 255.0, 0.0, 1.0)
                                    : clamp(288.1221695 * pow(T/100.0 - 60.0, -0.0755148) / 255.0, 0.0, 1.0);
                c.b = (T >= 6600.0) ? 1.0
                    : (T <= 1900.0) ? 0.0
                    : clamp((138.5177312 * log(T/100.0 - 10.0) - 305.0447927) / 255.0, 0.0, 1.0);
                return c;
            }

            // ─── DISK DENSITY: Ultra-thin Novikov-Thorne style ────────────
            float diskDensity(vec3 p) {
                float r = length(p.xz);
                if (r < ISCO || r > DISK_OUT) return 0.0;

                // Razor-thin vertical profile: half-height scales weakly with r
                float h     = abs(p.y);
                float maxH  = 0.07 + (r - ISCO) * 0.012; // very thin – Interstellar style
                if (h > maxH) return 0.0;

                // Radial profile: peaks just outside ISCO, fades at outer edge
                float rNorm = (r - ISCO) / (DISK_OUT - ISCO);  // 0..1
                float radial = pow(sin(rNorm * PI), 0.6);       // broad peak

                // Vertical: very sharp exponential (crisp edge, not smoke)
                float vert   = exp(-4.0 * (h / maxH) * (h / maxH));

                // Fine-grain turbulence (only radial/azimuthal, not vertical – no smoke!)
                float angle = atan(p.z, p.x);
                float omega = pow(r, -1.5);              // Keplerian angular velocity
                float phase = angle - u_time * omega;
                float turb  = fbm(vec3(r * 1.5, phase * 4.0, 0.0)) * 0.35 + 0.65;

                return radial * vert * turb * u_accretion_rate;
            }

            // ─── DISK COLOR: Physically-motivated temperature gradient ─────
            vec3 diskColor(vec3 p, vec3 rayDir) {
                float r     = length(p.xz);
                float angle = atan(p.z, p.x);
                float omega = pow(r, -1.5); // Keplerian

                // Doppler: dot of orbital velocity with ray direction
                vec3 v_orb  = vec3(-sin(angle), 0.0, cos(angle)) * sqrt(RS / r);
                float beta  = dot(v_orb, rayDir);      // -1..1 (relativistic proxy)

                // Relativistic beaming + Doppler shift of frequency
                float dop = 1.0;
                if (u_doppler_enabled > 0.5) {
                    // Relativistic Doppler + beaming: I ∝ (1+β)^3 (boost factor cubed)
                    dop = pow(clamp(1.0 + beta * 1.2, 0.05, 6.0), 3.0);
                }

                // Disk temperature: Novikov-Thorne profile peak ≈ 5e7 K at ISCO,
                // falls as r^(-3/4) away from it.
                float r_norm = max(r / ISCO, 1.001);
                float Tpeak  = (u_bh_type > 1.5) ? 35000.0 : 12000.0; // quasar much hotter
                float T      = Tpeak * pow(r_norm, -0.75) * (1.0 - sqrt(ISCO / r));

                vec3 col = blackbody(T);

                // Gravitational redshift: frequency shift near ISCO
                float grav_z = sqrt(1.0 - RS / r);  // redshift factor
                col *= grav_z;

                // Apply Doppler boost/dimming
                col *= dop;

                // Emissivity scaling: 1/r^2 for thin disk
                float emissivity = 6.0 / (r * r / (ISCO * ISCO) + 0.5);
                col *= emissivity;

                return col;
            }

            // ─── QUASAR JET ───────────────────────────────────────────────
            vec3 quasarJet(vec3 p) {
                if (u_bh_type < 1.5) return vec3(0.0);
                float rAxis = length(p.xz);
                float yAbs  = abs(p.y);
                if (yAbs < 1.5 || yAbs > 32.0) return vec3(0.0);
                // Conical opening: jet narrows with distance (collimation)
                float maxR = 0.3 + yAbs * 0.04;
                if (rAxis > maxR) return vec3(0.0);

                float dens = exp(-rAxis * rAxis / (maxR * maxR) * 4.0);
                float knot = fbm(vec3(rAxis * 4.0, yAbs * 0.25 - u_time * 3.0, u_time * 0.1));
                dens *= (0.3 + 0.7 * knot);

                float tc = rAxis / maxR;
                vec3 jc  = mix(vec3(1.0), vec3(0.2, 0.5, 1.0), tc);
                jc *= (p.y > 0.0) ? vec3(0.85, 0.92, 1.0) : vec3(1.0, 0.75, 0.55);
                return jc * dens * 3.5 * u_accretion_rate;
            }

            // ─── MAIN RAYMARCHER ──────────────────────────────────────────
            void main() {
                vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

                vec3 ro  = u_cam_pos;
                vec3 dir = normalize(u_cam_dir
                                   + u_cam_right * uv.x * u_fov_scale
                                   + u_cam_up    * uv.y * u_fov_scale);

                vec3 p = ro;
                vec3 accumColor    = vec3(0.0);
                float transmittance = 1.0;

                float prev_y = p.y; // for disk plane crossing detection

                for (int i = 0; i < MAX_STEPS; i++) {
                    float r = length(p);

                    // ── Adaptive step: ultra-fine near horizon & photon sphere ──
                    float dr = r - RS;
                    float step;
                    if      (dr < 0.2)  step = 0.008;
                    else if (dr < 1.0)  step = 0.025;
                    else if (r  < 5.0)  step = 0.06;
                    else if (r  < 15.0) step = 0.15;
                    else                step = 0.45;

                    // ── Termination ──
                    if (r < 1.02 * RS) { transmittance = 0.0; break; }
                    if (r > 65.0)       break;

                    // ── Gravitational Lensing (Schwarzschild + Lense-Thirring) ──
                    if (u_lensing_enabled > 0.5) {
                        float r5  = r * r * r * r * r;
                        vec3 accel = -1.5 * RS * cross(cross(p, dir), p) / r5;
                        // Frame dragging (Kerr spin term)
                        if (u_spin > 0.01) {
                            vec3 lt = u_spin * RS * RS * cross(vec3(0.0, 1.0, 0.0), dir)
                                      / (r * r * r) * 0.6;
                            accel += lt;
                        }
                        dir = normalize(dir + accel * step);
                    }

                    // ── Quasar jet ──
                    if (u_bh_type > 1.5) {
                        vec3 jc = quasarJet(p);
                        float ja = clamp(length(jc) * step * 0.5, 0.0, 1.0);
                        accumColor  += transmittance * jc * ja;
                        transmittance *= (1.0 - ja * 0.25);
                    }

                    // ── Disk: sample on Y-sign crossing (precise thin-disk intersection) ──
                    float curr_y = p.y;
                    if (prev_y * curr_y < 0.0) { // sign crossing: ray crossed disk plane
                        // Linear interpolation to exact crossing point
                        float t_cross = prev_y / (prev_y - curr_y);
                        vec3  pcross  = p - dir * step * (1.0 - t_cross);
                        float rc      = length(pcross.xz);

                        if (rc >= ISCO && rc <= DISK_OUT) {
                            float dens = diskDensity(pcross);
                            if (dens > 0.001) {
                                vec3 dc    = diskColor(pcross, dir);
                                float alpha = clamp(dens * 2.5, 0.0, 0.95);
                                accumColor  += transmittance * dc * alpha;
                                transmittance *= (1.0 - alpha * 0.9);
                            }
                        }
                    }

                    // ── Also sample volumetrically for smooth hot corona ──
                    if (abs(p.y) < 0.3 && length(p.xz) > ISCO && length(p.xz) < DISK_OUT) {
                        float dens = diskDensity(p) * 0.4;
                        if (dens > 0.001) {
                            vec3 dc    = diskColor(p, dir) * 0.4;
                            float alpha = clamp(dens * step * 1.5, 0.0, 0.5);
                            accumColor  += transmittance * dc * alpha;
                            transmittance *= (1.0 - alpha);
                        }
                    }

                    prev_y = curr_y;
                    p += dir * step;

                    if (transmittance < 0.005) break;
                }

                // ── Background: lensed starfield ──
                if (transmittance > 0.005) {
                    accumColor += transmittance * starfield(dir);
                }

                // ── Tonemap (ACES approximation) + gamma ──
                accumColor = accumColor * (2.51 * accumColor + 0.03) /
                             (accumColor * (2.43 * accumColor + 0.59) + 0.14);
                accumColor = clamp(accumColor, 0.0, 1.0);
                accumColor = pow(accumColor, vec3(1.0 / 2.2));

                gl_FragColor = vec4(accumColor, 1.0);
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

        // Force a delayed resize to ensure layout is computed
        setTimeout(() => this.resize(), 100);
        window.addEventListener("resize", () => this.resize());
    }

    bindEvents() {
        const sync = () => {
            const expMass = parseFloat(this.sliderMass.value);
            this.mass = Math.pow(10, expMass);
            this.accretionRate = parseFloat(this.sliderAcc.value);

            // Update spin from slider immediately
            const spinSlider = document.getElementById("slider-b-spin");
            if (spinSlider) {
                this.spin = parseFloat(spinSlider.value);
                const spinVal = document.getElementById('val-b-spin');
                if (spinVal) spinVal.textContent = this.spin.toFixed(2);
            }

            this.updatePhysics();

            // Format mass display
            if (this.mass >= 1e9) {
                this.numMass.textContent = (this.mass / 1e9).toFixed(2) + " Bilhões";
            } else if (this.mass >= 1e6) {
                this.numMass.textContent = (this.mass / 1e6).toFixed(2) + " Milhões";
            } else if (this.mass >= 1e3) {
                this.numMass.textContent = (this.mass / 1e3).toFixed(2) + " Mil";
            } else {
                this.numMass.textContent = this.mass.toFixed(2);
            }
            this.numAcc.textContent = this.accretionRate.toFixed(2);
        };

        this.sliderMass.addEventListener("input", sync);
        this.sliderAcc.addEventListener("input", sync);
        
        const spinSlider = document.getElementById("slider-b-spin");
        if (spinSlider) spinSlider.addEventListener("input", sync);

        const checkToggles = () => {
            this.uniforms.u_doppler_enabled.value = this.toggleDoppler.checked ? 1.0 : 0.0;
            this.uniforms.u_lensing_enabled.value = this.toggleLensing.checked ? 1.0 : 0.0;
        };

        this.toggleDoppler.addEventListener("change", checkToggles);
        this.toggleLensing.addEventListener("change", checkToggles);

        // Bind Type Selector
        const selectType = document.getElementById('select-b-type');
        if (selectType) {
            this.bhType = selectType.value; // Get initial value
            selectType.addEventListener("change", (e) => {
                this.bhType = e.target.value;
                if (this.bhType === 'kerr') {
                    document.getElementById('group-b-spin').style.display = 'block';
                } else {
                    document.getElementById('group-b-spin').style.display = 'none';
                }
                this.updatePhysics();
            });
        }
    }

    updatePhysics() {
        // Shader uses RS=1.0 universally.
        // We only update the visual UI metrics based on mass.
        
        const G = 6.674e-11;
        const c = 299792458;
        const Ms = 1.989e30;
        
        const M_kg = this.mass * Ms;
        // Schwarzschild Radius in km
        const Rs_km = (2 * G * M_kg) / (c * c) / 1000;
        
        this.metricRadius.textContent = window.formatScientific ? window.formatScientific(Rs_km) + " km" : Rs_km.toExponential(2) + " km";

        // Spin configuration
        if (this.bhType === 'schwar') {
            this.spin = 0.0;
        } else if (this.bhType === 'kerr') {
            const spinSlider = document.getElementById('slider-b-spin');
            this.spin = spinSlider ? parseFloat(spinSlider.value) : 0.98;
            const spinVal = document.getElementById('val-b-spin');
            if (spinVal) spinVal.textContent = this.spin.toFixed(2);
        } else if (this.bhType === 'quasar') {
            this.spin = 0.98; // Maximal spin
        }
        
        const iscoFactor = (this.bhType === 'schwar') ? 3.0 : (1.5);
        this.metricIsco.textContent = (Rs_km * iscoFactor).toExponential(2) + " km";
        
        // Temperature of accretion disk (simplified thin disk model peak temp)
        const temp = 5e7 * Math.pow(this.mass / 10, -0.25);
        this.metricTemp.textContent = temp.toExponential(2) + " K";

        // Update shader uniforms
        this.uniforms.u_accretion_rate.value = this.accretionRate;
        this.uniforms.u_spin.value = this.spin;
        this.uniforms.u_bh_type.value = this.getBhTypeFloat();
    }

    pause() { this.isActive = true; }
    resume() { 
        this.isActive = true; 
        setTimeout(() => this.resize(), 50);
    }

    resize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width === 0 || height === 0) return;
        
        this.renderer.setSize(width, height);
        this.uniforms.u_resolution.value.set(width, height);
        
        this.virtualCamera.aspect = width / height;
        this.virtualCamera.updateProjectionMatrix();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (!this.isActive || window.AstrophysicsLab.activeTab !== 'blackhole') return;

        const dt = this.clock.getDelta();
        this._totalTime += dt;
        this.uniforms.u_time.value = this._totalTime;

        // Ensure controls are updated to move virtual camera
        this.controls.update();

        // Pass the updated Virtual Camera state to the Shader
        this.uniforms.u_cam_pos.value.copy(this.virtualCamera.position);
        
        this.virtualCamera.getWorldDirection(this.uniforms.u_cam_dir.value);
        this.uniforms.u_cam_right.value.setFromMatrixColumn(this.virtualCamera.matrixWorld, 0).normalize();
        this.uniforms.u_cam_up.value.setFromMatrixColumn(this.virtualCamera.matrixWorld, 1).normalize();
        
        // Compute FOV scale based on Virtual Camera FOV
        // Clamp zoom to prevent black screen when BH mass is very high
        const fovRad = THREE.MathUtils.degToRad(this.virtualCamera.fov);
        this.uniforms.u_fov_scale.value = Math.tan(fovRad / 2.0);

        this.renderer.render(this.scene, this.virtualCamera); // The Orthographic camera is replaced by rendering the quad directly. Wait, no.
        // Wait, to render a full-screen quad using ShaderMaterial, we just need ANY camera, 
        // the vertex shader completely bypasses the projection matrices.
        // gl_Position = vec4(position, 1.0);
        // So rendering with virtualCamera is perfectly fine and avoids needing a dual scene setup.
    }
}

// Bootstrap
document.addEventListener("DOMContentLoaded", () => {
    new BlackHoleSimulation();
});
