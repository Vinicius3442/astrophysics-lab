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

        this.isActive = false;
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
        this.virtualCamera.position.set(0, 2.5, 12.0); // Initial pos
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
            precision highp float;

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

            #define RS 1.0

            // ──────────────────────────────────────────────────────────────
            //  NOISE / FBM
            // ──────────────────────────────────────────────────────────────
            float hash(float n) { return fract(sin(n) * 43758.5453123); }
            float noise(vec3 x) {
                vec3 p = floor(x);
                vec3 f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                float n = p.x + p.y * 57.0 + 113.0 * p.z;
                return mix(mix(mix(hash(n+  0.0), hash(n+  1.0),f.x),
                               mix(hash(n+ 57.0), hash(n+ 58.0),f.x),f.y),
                           mix(mix(hash(n+113.0), hash(n+114.0),f.x),
                               mix(hash(n+170.0), hash(n+171.0),f.x),f.y),f.z);
            }
            float fbm(vec3 p) {
                float f = 0.0;
                f += 0.5000 * noise(p); p = p * 2.02;
                f += 0.2500 * noise(p); p = p * 2.03;
                f += 0.1250 * noise(p); p = p * 2.01;
                f += 0.0625 * noise(p);
                return f;
            }

            // ──────────────────────────────────────────────────────────────
            //  STARFIELD (Interstellar Quality)
            // ──────────────────────────────────────────────────────────────
            vec3 starfield(vec3 ray) {
                vec3 d = abs(ray);
                
                // Milky way band effect
                float galactic_plane = exp(-abs(ray.y) * 8.0);
                float dust = fbm(ray * 5.0) * galactic_plane;
                vec3 bg_color = mix(vec3(0.0), vec3(0.05, 0.03, 0.08), dust);
                
                // Crisp stars (less noise, more distinct points)
                float n1 = noise(ray * 300.0);
                float stars1 = pow(n1, 60.0) * 15.0 * (1.0 + galactic_plane * 2.0);
                
                float n2 = noise(ray * 150.0 + 10.0);
                vec3 star_color = mix(vec3(1.0, 0.8, 0.6), vec3(0.6, 0.8, 1.0), noise(ray*50.0));
                vec3 stars = star_color * (stars1 + pow(n2, 80.0) * 20.0);
                
                return stars + bg_color;
            }

            // ──────────────────────────────────────────────────────────────
            //  MAIN RAYMARCH
            // ──────────────────────────────────────────────────────────────
            void main() {
                vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

                vec3 ro = u_cam_pos;
                vec3 rd = normalize(u_cam_dir + uv.x * u_cam_right + uv.y * u_cam_up * u_fov_scale);

                vec3 ray_pos = ro;
                vec3 ray_dir = rd;
                
                vec3 accumulated_color = vec3(0.0);
                float transmit = 1.0;
                
                // Adaptive escape radius to prevent disk clipping
                float escapeR = max(50.0, length(ro) * 1.5);
                
                // Physics constants
                float ISCO = (u_bh_type > 0.5) ? RS * (3.0 - 2.0*u_spin) : RS * 3.0;
                float DISK_OUTER = RS * 15.0;

                const int MAX_STEPS = 250;
                
                for (int i = 0; i < MAX_STEPS; i++) {
                    float r2 = dot(ray_pos, ray_pos);
                    float r = sqrt(r2);
                    
                    // A. Horizon collision
                    float horizon = RS;
                    if (u_bh_type > 0.5) {
                        float rg = RS * 0.5;
                        float a = u_spin * rg;
                        horizon = rg + sqrt(max(0.0, rg*rg - a*a));
                    }
                    if (r < horizon * 1.02) { // Absorb slightly above horizon to hide singularity math errors
                        transmit = 0.0;
                        break;
                    }

                    if (r > escapeR) break;

                    // Adaptive step size: Very fine near BH, fast in empty space
                    float dt = clamp(r * 0.03, 0.005, 1.5);

                    // B. Geodesic Lensing (Robust Integration)
                    if (u_lensing_enabled > 0.5) {
                        // h = angular momentum per unit mass
                        vec3 h_vec = cross(ray_pos, ray_dir);
                        float h2 = dot(h_vec, h_vec);
                        
                        // Acceleration due to gravity: a = -1.5 * RS * h^2 * r_vec / r^5
                        vec3 accel = -1.5 * RS * h2 * ray_pos / (r2 * r2 * r);
                        
                        // Frame dragging (simplified Lense-Thirring)
                        if (u_bh_type > 0.5) {
                            vec3 spin_axis = vec3(0.0, 0.0, 1.0);
                            vec3 frame_drag = cross(spin_axis, ray_pos) * (u_spin * RS * 2.0 / (r2*r2));
                            accel += frame_drag;
                        }
                        
                        // Prevent dt from being too large if acceleration is high
                        float accel_mag = length(accel);
                        if (accel_mag * dt > 0.1) {
                            dt = 0.1 / accel_mag;
                        }
                        
                        ray_dir += accel * dt;
                        ray_dir = normalize(ray_dir);
                    }
                    
                    // C. Accretion Disk (Interstellar Gargantua Style)
                    if (u_accretion_rate > 0.0 && r > ISCO && r < DISK_OUTER) {
                        float dist_to_plane = abs(ray_pos.z);
                        
                        // Razor-thin disk profile flaring slightly
                        float disk_thickness = r * 0.03 + 0.01; 
                        
                        if (dist_to_plane < disk_thickness * 3.0) {
                            float norm_r = (r - ISCO) / (DISK_OUTER - ISCO);
                            
                            // Vertical falloff (exponential for sharp midplane)
                            float vertical_density = exp(-abs(dist_to_plane) / disk_thickness * 4.0);
                            
                            // Radial density (Peaks intensely near ISCO)
                            float radial_density = pow(1.0 - norm_r, 2.0) * smoothstep(0.0, 0.05, norm_r);
                            float base_density = vertical_density * radial_density;
                            
                            if (base_density > 0.005) {
                                float v_orbital = 1.0 / sqrt(2.0 * r - RS); // Relativistic Keplerian approx
                                float angle = atan(ray_pos.y, ray_pos.x);
                                float time_offset = angle - u_time * v_orbital;
                                
                                // High-detail gas turbulence and structured rings
                                vec3 noise_pos = vec3(r * 4.0, time_offset * 4.0, ray_pos.z * 10.0);
                                float gas = fbm(noise_pos);
                                
                                // Radial sine rings to create structured plasma bands
                                float rings = 0.6 + 0.4 * sin(r * 35.0 - u_time * 3.0);
                                float micro_rings = 0.8 + 0.2 * sin(r * 120.0);
                                
                                gas = pow(gas, 1.2) * rings * micro_rings * 1.8;
                                
                                float final_density = base_density * gas * u_accretion_rate * 3.0;
                                
                                // Relativistic Doppler Beaming
                                float doppler_factor = 1.0;
                                if (u_doppler_enabled > 0.5) {
                                    vec3 tangent = normalize(vec3(-ray_pos.y, ray_pos.x, 0.0));
                                    float align = dot(ray_dir, tangent); 
                                    // Beaming formula approx: D^3 or D^4. 
                                    doppler_factor = 1.0 + (align * v_orbital * 1.5);
                                    doppler_factor = max(0.1, doppler_factor);
                                }
                                
                                // Interstellar colors (Fiery orange/yellow near edge, brilliant white-blue near ISCO)
                                vec3 base_col = mix(vec3(1.0, 0.8, 0.4), vec3(1.0, 0.95, 0.9), smoothstep(0.5, 0.0, norm_r));
                                
                                // Apply Doppler shift to color
                                vec3 doppler_col = base_col;
                                if (u_doppler_enabled > 0.5) {
                                    if (doppler_factor > 1.0) {
                                        doppler_col = mix(base_col, vec3(0.5, 0.8, 1.0), min(1.0, (doppler_factor - 1.0)*0.8));
                                    } else {
                                        doppler_col = mix(vec3(0.8, 0.2, 0.0), base_col, doppler_factor);
                                    }
                                }
                                
                                // Beaming amplifies intensity dramatically
                                float intensity = pow(doppler_factor, 3.0) * final_density * 5.0;
                                
                                // Photon ring glow enhancement
                                float photon_ring = smoothstep(RS * 1.8, RS * 1.5, r) * 2.0;
                                intensity += photon_ring * final_density;
                                
                                vec3 glow = doppler_col * intensity;
                                
                                accumulated_color += glow * transmit * dt;
                                transmit *= exp(-final_density * dt * 2.0);
                            }
                        }
                    }

                    // D. Quasar Jets (Volumetric)
                    if (u_bh_type > 1.5) {
                        float d_axis = length(ray_pos.xy);
                        float jet_radius = RS * 0.2 + abs(ray_pos.z) * 0.15;
                        
                        if (d_axis < jet_radius && abs(ray_pos.z) > RS * 1.2) {
                            float profile = smoothstep(jet_radius, 0.0, d_axis);
                            float z_decay = exp(-abs(ray_pos.z) * 0.05);
                            float jet_gas = fbm(vec3(ray_pos.xy * 8.0, ray_pos.z * 0.5 - u_time * 15.0));
                            float jet_density = profile * z_decay * jet_gas * u_accretion_rate * 2.0;
                            
                            vec3 jet_col = mix(vec3(0.4, 0.0, 1.0), vec3(0.8, 0.9, 1.0), jet_gas);
                            accumulated_color += jet_col * jet_density * transmit * dt * 3.0;
                            transmit *= exp(-jet_density * dt * 1.5);
                        }
                    }

                    ray_pos += ray_dir * dt;
                    if (transmit < 0.01) break;
                    
                    // Prevent deleting bubble by smoothly terminating if trapped
                    if (i == MAX_STEPS - 1) transmit = 0.0;
                }
                
                // Add starfield background
                if (transmit > 0.01) {
                    accumulated_color += starfield(ray_dir) * transmit;
                }
                
                // Photorealistic ACES Tonemapping
                vec3 color = accumulated_color;
                color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
                color = clamp(color, 0.0, 1.0);
                
                // Extra bloom pop
                color += accumulated_color * 0.1;
                
                // Gamma correct
                color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2));

                gl_FragColor = vec4(color, 1.0);
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

    bindEvents() {
        const sync = () => {
            const expMass = parseFloat(this.sliderMass.value);
            this.mass = Math.pow(10, expMass);
            this.accretionRate = parseFloat(this.sliderAcc.value);
            this.updatePhysics();
            
            // Format numbers nicely
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

    pause() { this.isActive = false; }
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
        this.uniforms.u_cam_up.value.copy(this.virtualCamera.up);
        this.uniforms.u_cam_up.value.transformDirection(this.virtualCamera.matrixWorld);
        
        this.uniforms.u_cam_right.value.crossVectors(this.uniforms.u_cam_dir.value, this.uniforms.u_cam_up.value).normalize();
        
        // Compute FOV scale based on Virtual Camera FOV
        const fovRad = THREE.MathUtils.degToRad(this.virtualCamera.fov);
        this.uniforms.u_fov_scale.value = Math.tan(fovRad / 2.0);

        this.renderer.render(this.scene, this.virtualCamera); // The Orthographic camera is replaced by rendering the quad directly. Wait, no.
        // Wait, to render a full-screen quad using ShaderMaterial, we just need ANY camera, 
        // the vertex shader completely bypasses the projection matrices.
        // `gl_Position = vec4(position, 1.0);`
        // So rendering with virtualCamera is perfectly fine and avoids needing a dual scene setup.
    }
}

// Bootstrap
document.addEventListener("DOMContentLoaded", () => {
    new BlackHoleSimulation();
});
