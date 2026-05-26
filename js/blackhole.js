// ASTROPHYSICS LAB - BLACK HOLE SCHWARZSCHILD SHADER ENGINE (js/blackhole.js)
// Relatividade Geral: Gargantua em 3D Real com Órbita e Zoom no mouse por Raymarching de Geodésicas de Schwarzschild integradas no Fragment Shader GLSL na GPU.
// Relatividade Geral: Traçado Geodésico Nulo de Schwarzschild, Lente Gravitacional de Einstein, Disco de Acreção com Doppler Beaming e Redshift Gravitacional na GPU.

class BlackHoleSimulation {
    constructor() {
        this.container = document.getElementById("blackhole-canvas-container");
        this.isActive = false; // Initialized inactive while on Lobby
        
        // Physics constants (normalized for GPU rendering where c = 1, G = 1)
        this.mass = 12.0;          // Solar masses (M_sun)
        this.accretionRate = 1.2;  // Disk brightness factor
        this.dopplerEffect = true; // Relativistic beaming toggle
        this.redshiftEffect = true;// Gravitational redshift toggle
        this.gravLensing = true;   // Deflection toggle
        this.pitchAngle = 15.0;     // Initial pitch in degrees (synced with virtual camera)
        
        // Register in main laboratory scope
        window.AstrophysicsLab.simulations['blackhole'] = this;

        this.initUI();
        this.initThree();
        this.updateHUD();
        
        this.animate();
    }

    initUI() {
        this.sliderMass = document.getElementById("slider-b-mass");
        this.sliderBright = document.getElementById("slider-b-bright");
        this.sliderPitch = document.getElementById("slider-b-pitch");
        
        this.valMass = document.getElementById("val-b-mass");
        this.valBright = document.getElementById("val-b-bright");
        this.valPitch = document.getElementById("val-b-pitch");
        
        this.toggleDoppler = document.getElementById("toggle-b-doppler");
        this.toggleRedshift = document.getElementById("toggle-b-redshift");
        this.toggleLensing = document.getElementById("toggle-b-lensing");

        this.metricRs = document.getElementById("metric-b-rs");
        this.metricRph = document.getElementById("metric-b-rph");
        this.metricIsco = document.getElementById("metric-b-isco");

        // Advanced Singularity Selectors & Spin sliders
        this.selectType = document.getElementById("select-b-type");
        this.sliderSpin = document.getElementById("slider-b-spin");
        this.valSpin = document.getElementById("val-b-spin");
        this.groupSpin = document.getElementById("group-b-spin");

        // State trackers
        this.bhType = 'schwar';
        this.spin = 0.0;

        // Event Listeners
        this.sliderMass.addEventListener("input", (e) => {
            this.mass = parseFloat(e.target.value);
            this.valMass.textContent = this.mass.toFixed(1);
            this.updateHUD();
        });

        this.sliderBright.addEventListener("input", (e) => {
            this.accretionRate = parseFloat(e.target.value);
            this.valBright.textContent = this.accretionRate.toFixed(1);
        });

        // The pitch slider now updates the virtual camera position smoothly
        this.sliderPitch.addEventListener("input", (e) => {
            this.pitchAngle = parseFloat(e.target.value);
            this.valPitch.textContent = Math.round(this.pitchAngle);
            this.syncVirtualCameraToSliders();
        });

        this.toggleDoppler.addEventListener("change", (e) => {
            this.dopplerEffect = e.target.checked;
        });

        this.toggleRedshift.addEventListener("change", (e) => {
            this.redshiftEffect = e.target.checked;
        });

        this.toggleLensing.addEventListener("change", (e) => {
            this.gravLensing = e.target.checked;
        });

        this.selectType.addEventListener("change", (e) => {
            const val = e.target.value;
            this.bhType = val;
            
            if (val === 'kerr' || val === 'quasar') {
                this.groupSpin.style.display = 'block';
                if (this.spin === 0.0) {
                    this.spin = 0.85;
                    this.sliderSpin.value = 0.85;
                    this.valSpin.textContent = "0.85";
                }
            } else {
                this.groupSpin.style.display = 'none';
                this.spin = 0.0;
            }
            this.updateHUD();
        });

        this.sliderSpin.addEventListener("input", (e) => {
            this.spin = parseFloat(e.target.value);
            this.valSpin.textContent = this.spin.toFixed(2);
            this.updateHUD();
        });
    }

    updateHUD() {
        // RS = 2GM/c^2. Solar mass RS is ~2.953 km
        const rg_km = this.mass * 1.476; // Gravitational radius GM/c^2
        const rs_km = rg_km * 2.0;       // Schwarzschild Event Horizon
        
        let rh_km = rs_km;            // Kerr Event Horizon r+ = rg + sqrt(rg^2 - a^2)
        if (this.bhType === 'kerr' || this.bhType === 'quasar') {
            // spin (a) is normalized as a fraction of rg (0.0 to 0.99)
            const spin_a = this.spin * rg_km;
            rh_km = rg_km + Math.sqrt(Math.max(0.001, rg_km * rg_km - spin_a * spin_a));
        }

        const rph_km = rg_km * (this.spin > 0 ? 2.0 : 3.0); // photon sphere approx
        const isco_km = rg_km * (this.spin > 0 ? 3.0 : 6.0); // stable orbit approx

        this.metricRs.textContent = rh_km.toFixed(1) + " km";
        this.metricRph.textContent = rph_km.toFixed(1) + " km";
        this.metricIsco.textContent = isco_km.toFixed(1) + " km";

        // Update overlay title
        const overlayTitle = document.querySelector("#tab-blackhole .overlay-info h3");
        if (overlayTitle) {
            if (this.bhType === 'schwar') {
                overlayTitle.textContent = "Singularidade de Schwarzschild";
            } else if (this.bhType === 'kerr') {
                overlayTitle.textContent = "Singularidade de Kerr";
            } else if (this.bhType === 'quasar') {
                overlayTitle.textContent = "Quasar Relativístico";
            }
        }
    }

    initThree() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        // Scene
        this.scene = new THREE.Scene();

        // 1. Rendering flat canvas camera
        this.renderCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // 2. Interactive VIRTUAL perspective camera (OrbitControls rotates this!)
        // Orbit and Zoom are driven by this camera and mapped into GLSL in real-time
        this.virtualCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
        
        // Setup initial position matching pitch
        this.syncVirtualCameraToSliders();

        // WebGL Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(1.0); // Shader performance lock for stable framerate
        this.container.appendChild(this.renderer.domElement);

        // OrbitControls connected to the virtual camera and canvas element
        this.controls = new THREE.OrbitControls(this.virtualCamera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 2.2; // Don't crash into the singularity
        this.controls.maxDistance = 8.5; // Zoom out limit
        this.controls.enablePan = false; // Keep centering Gargantua

        // Generate high resolution starry background
        const bgTexture = this.generateCosmicTexture();

        // Shader parameters Uniforms
        this.uniforms = {
            u_resolution: { value: new THREE.Vector2(width, height) },
            u_time: { value: 0.0 },
            u_rs: { value: 0.20 }, // Schwarzschild Radius
            u_accretion_rate: { value: 1.2 },
            u_doppler_enabled: { value: 1.0 },
            u_redshift_enabled: { value: 1.0 },
            u_lensing_enabled: { value: 1.0 },
            u_bg_texture: { value: bgTexture },
            u_spin: { value: 0.0 },
            u_bh_type: { value: 0.0 },
            
            // Câmera virtual parameters passed to GPU
            u_cam_pos: { value: new THREE.Vector3() },
            u_cam_dir: { value: new THREE.Vector3() },
            u_cam_up: { value: new THREE.Vector3() },
            u_cam_right: { value: new THREE.Vector3() },
            u_fov_scale: { value: 1.0 }
        };

        const vertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            uniform vec2 u_resolution;
            uniform float u_time;
            uniform float u_rs;
            uniform float u_accretion_rate;
            uniform float u_doppler_enabled;
            uniform float u_redshift_enabled;
            uniform float u_lensing_enabled;
            uniform sampler2D u_bg_texture;
            uniform float u_spin;
            uniform float u_bh_type;
            
            // Virtual Camera projection vectors
            uniform vec3 u_cam_pos;
            uniform vec3 u_cam_dir;
            uniform vec3 u_cam_up;
            uniform vec3 u_cam_right;
            uniform float u_fov_scale;
            
            varying vec2 vUv;

            // 3D Procedural Noise for dynamic dust and gas accretion accretion
            float hash(vec3 p) {
                p = fract(p * 0.3183099 + vec3(0.1));
                p *= 17.0;
                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
            }

            float noise(vec3 x) {
                vec3 i = floor(x);
                vec3 f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                return mix(
                    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z
                );
            }

            // Fractal Brownian Motion (FBM) with 4 octaves for fine organic dust lanes
            float fbm(vec3 p) {
                float v = 0.0;
                float a = 0.5;
                vec3 shift = vec3(100.0);
                for (int i = 0; i < 4; ++i) {
                    v += a * noise(p);
                    p = p * 2.2 + shift;
                    a *= 0.5;
                }
                return v;
            }

            void main() {
                // Screen coordinate normalize
                vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

                // 1. Ray setup: Cast ray using virtual camera vectors (perspective projection)
                vec3 ro = u_cam_pos;
                vec3 rd = normalize(u_cam_dir + uv.x * u_cam_right * u_fov_scale + uv.y * u_cam_up * u_fov_scale);

                // Runge-Kutta numerical step integration
                float dt = 0.035;
                vec3 ray_pos = ro;
                vec3 ray_dir = rd;
                
                vec3 color = vec3(0.0);
                float accumulated_disk_alpha = 0.0;
                
                bool hit_horizon = false;

                // General Relativity Raymarching Loop (Gargantua space deformation)
                const int MAX_STEPS = 180;
                for (int i = 0; i < MAX_STEPS; i++) {
                    float r2 = dot(ray_pos, ray_pos);
                    float r = sqrt(r2);

                    // A. Kerr/Schwarzschild horizon collapse boundary check
                    float horizon_r = u_rs;
                    if (u_bh_type > 0.5) {
                        float rg = u_rs * 0.5;
                        float spin_a = u_spin * rg;
                        horizon_r = rg + sqrt(max(0.001, rg * rg - spin_a * spin_a));
                    }
                    if (r < horizon_r) {
                        hit_horizon = true;
                        break;
                    }

                    // B. Boundary escape to background stars
                    if (r > 15.0) {
                        break;
                    }

                    // C. Light path bending acceleration (Relativity geodesics integration step)
                    if (u_lensing_enabled > 0.5) {
                        // Deflection acceleration force: a = 1.5 * Rs * L^2 / r^5
                        float deflection = (3.0 * u_rs) / (r2 * r);
                        vec3 angular_momentum = cross(ray_pos, ray_dir);
                        vec3 deflection_force = cross(angular_momentum, ray_pos) * deflection * dt;
                        
                        // Kerr frame-dragging deflection (Lense-Thirring drag)
                        vec3 frame_dragging = vec3(0.0);
                        if (u_bh_type > 0.5) {
                            vec3 spin_axis = vec3(0.0, 0.0, 1.0);
                            frame_dragging = cross(spin_axis, ray_pos) * (2.0 * u_spin * u_rs / (r2 * r2)) * dt;
                        }
                        
                        ray_dir += deflection_force + frame_dragging;
                        ray_dir = normalize(ray_dir);
                    }

                    // D. Accretion Disk plane crossing check (z = 0 equatorial plane)
                    float z_prev = ray_pos.z;
                    ray_pos += ray_dir * dt;
                    float z_curr = ray_pos.z;

                    // Did ray cross z=0 equatorial disk plane?
                    if ((z_prev > 0.0 && z_curr < 0.0) || (z_prev < 0.0 && z_curr > 0.0)) {
                        // Interpolate precise plane cross point
                        float t_plane = -z_prev / (z_curr - z_prev);
                        vec3 hit_pos = ray_pos - ray_dir * (1.0 - t_plane) * dt;
                        float dist = length(hit_pos.xy);

                        // Accretion disk scale bounds: ISCO (3.0 * Rs) to Outer (10.0 * Rs)
                        float r_isco = 3.0 * u_rs;
                        if (u_bh_type > 0.5) {
                            // As spin increases, ISCO shrinks inwards to the Kerr limit
                            r_isco = u_rs * (3.0 - 2.3 * u_spin);
                        }
                        float r_outer = 9.5 * u_rs;

                        if (dist > r_isco && dist < r_outer) {
                            float angle = atan(hit_pos.y, hit_pos.x);
                            
                            // Keplerian orbital speed (w = sqrt(G*M/r^3))
                            float w = 2.8 / (dist * sqrt(dist));
                            
                            // Keplerian differential shear: inner orbits rotate faster
                            // For Kerr, let's include spin frame dragging contribution in shear speed
                            float spin_contrib = (u_bh_type > 0.5) ? (u_spin * 2.0 / pow(dist, 2.0)) : 0.0;
                            float angle_sheared = angle - u_time * (1.6 / pow(dist, 1.5) + spin_contrib);
                            
                            // Evaluate FBM noise in shearing coordinates for beautiful spiraling dust filaments
                            float noise_val = fbm(vec3(hit_pos.xy * 6.5, angle_sheared * 4.8));
                            
                            // Thermal profile density curve (sharp inner cut at ISCO, smooth outer decay)
                            float density = smoothstep(r_isco, r_isco + 0.18, dist) * (1.0 - smoothstep(r_isco + 0.18, r_outer, dist));
                            density = pow(density, 1.25);

                            // Fade brightness near horizon boundary to show Schwarzschild silhouette clearly
                            density *= smoothstep(r_isco * 0.95, r_isco * 1.05, dist);

                            float brightness = (0.2 + 0.8 * noise_val) * density * u_accretion_rate;
                            
                            // Base color mapping (extremely hot near inner edge)
                            vec3 disk_base_color = vec3(1.0, 0.45, 0.08); // Deep hot orange
                            if (dist < r_isco * 1.6) {
                                disk_base_color = mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.94, 0.82), (r_isco * 1.6 - dist) / (r_isco * 0.6));
                            }

                            // Relativistic Doppler Beaming
                            float doppler_factor = 1.0;
                            if (u_doppler_enabled > 0.5) {
                                // Relativistic velocity increases near the event horizon v = sqrt(GM/r)
                                float v_orb = 0.58 * sqrt(u_rs / dist);
                                vec3 disk_velocity = normalize(vec3(-hit_pos.y, hit_pos.x, 0.0)) * v_orb;
                                float cos_theta = dot(disk_velocity, ray_dir);
                                float gamma = 1.0 / sqrt(1.0 - dot(disk_velocity, disk_velocity));
                                doppler_factor = 1.0 / (gamma * (1.0 - cos_theta));
                                doppler_factor = pow(doppler_factor, 3.0); // D^3 intensity boost
                                
                                // Relativistic color shifting (blue-shift left, red-shift right)
                                disk_base_color = mix(vec3(0.35, 0.01, 0.0), disk_base_color, smoothstep(0.4, 0.9, doppler_factor));
                                disk_base_color = mix(disk_base_color, vec3(0.7, 0.92, 1.0), smoothstep(1.0, 2.3, doppler_factor));
                            }

                            // Gravitational Redshift: redshift = sqrt(1 - Rs/r)
                            float redshift_factor = 1.0;
                            if (u_redshift_enabled > 0.5) {
                                redshift_factor = sqrt(1.0 - u_rs / dist);
                                disk_base_color = mix(vec3(0.35, 0.005, 0.0), disk_base_color, redshift_factor); // deep gravitational redshift
                            }

                            // Accumulate volumetric alpha blending
                            float opacity = brightness * 0.65 * (1.0 - accumulated_disk_alpha);
                            color += disk_base_color * brightness * doppler_factor * redshift_factor * opacity * 2.5;
                            accumulated_disk_alpha += opacity;

                            if (accumulated_disk_alpha >= 0.98) {
                                break;
                            }
                        }
                    }
                }

                // 2. Draw black Schwarzschild shadow or Einstein warped background stars
                if (hit_horizon) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                } else {
                    // Map background coordinate on starfield texture
                    vec2 star_uv = vec2(
                        0.5 + atan(ray_dir.z, ray_dir.x) / (2.0 * 3.14159265),
                        0.5 + asin(ray_dir.y) / 3.14159265
                    );
                    vec3 stars = texture2D(u_bg_texture, star_uv).rgb;
                    vec3 final_color = color + stars * (1.0 - accumulated_disk_alpha);
                    gl_FragColor = vec4(final_color, 1.0);
                }
            }
        `;

        // Create the shader material
        this.shaderMat = new THREE.ShaderMaterial({
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            uniforms: this.uniforms,
            depthWrite: false,
            depthTest: false
        });

        // 2D full screen orthographic plane to projection space
        const planeGeo = new THREE.PlaneGeometry(2, 2);
        const planeMesh = new THREE.Mesh(planeGeo, this.shaderMat);
        this.scene.add(planeMesh);

        window.addEventListener("resize", () => this.resize());
    }

    syncVirtualCameraToSliders() {
        // Position camera spherically based on pitch and distance
        const r = 4.5;
        const pitchRad = (this.pitchAngle / 180) * Math.PI;
        
        // Position on circle in Y-Z plane
        this.virtualCamera.position.set(0.0, -r * Math.cos(pitchRad), r * Math.sin(pitchRad));
        this.virtualCamera.lookAt(0, 0, 0);
    }

    syncSlidersToVirtualCamera() {
        // Read camera position and deduce physical pitch angle
        const pos = this.virtualCamera.position;
        const r_flat = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
        
        // Calculate pitch angle relative to equatorial plane
        const pitchRad = Math.atan2(pos.z, r_flat);
        let pitchDeg = (pitchRad * 180) / Math.PI;
        pitchDeg = Math.max(0, Math.min(pitchDeg, 80)); // boundaries
        
        this.pitchAngle = pitchDeg;
        this.valPitch.textContent = Math.round(this.pitchAngle);
        this.sliderPitch.value = Math.round(this.pitchAngle);
    }

    // Telescope-grade spherical 2:1 high resolution seamless starfield
    generateCosmicTexture() {
        const width = 2048;
        const height = 1024;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        // Pitch black cosmos background
        ctx.fillStyle = "#010104";
        ctx.fillRect(0, 0, width, height);

        // Seamless cosmic clouds nebulae
        // 1. Central violet-purple nebulae lane
        const grad1 = ctx.createRadialGradient(width/2, height/2, 50, width/2, height/2, width * 0.45);
        grad1.addColorStop(0, "rgba(135, 30, 200, 0.24)");
        grad1.addColorStop(0.35, "rgba(55, 18, 110, 0.11)");
        grad1.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad1;
        ctx.fillRect(0, 0, width, height);

        // 2. Off-center glowing teal cosmic lane
        const grad2 = ctx.createRadialGradient(width * 0.28, height * 0.42, 30, width * 0.28, height * 0.42, width * 0.38);
        grad2.addColorStop(0, "rgba(0, 185, 215, 0.16)");
        grad2.addColorStop(0.48, "rgba(0, 72, 140, 0.05)");
        grad2.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad2;
        ctx.fillRect(0, 0, width, height);

        // 3. Winding magenta-orange dust clouds
        const grad3 = ctx.createLinearGradient(0, 0, width, height);
        grad3.addColorStop(0.12, "rgba(0,0,0,0)");
        grad3.addColorStop(0.48, "rgba(225, 52, 105, 0.07)");
        grad3.addColorStop(0.55, "rgba(245, 115, 28, 0.04)");
        grad3.addColorStop(0.88, "rgba(0,0,0,0)");
        ctx.fillStyle = grad3;
        ctx.fillRect(0, 0, width, height);

        // Add 4200 multi-scale stars (telescope lens halos)
        for (let i = 0; i < 4200; i++) {
            const x = Math.random() * width;
            const y = Math.random() * height;
            
            const rand = Math.random();
            // 85% are pinpoint stars, 15% are bright stars with halo glows
            if (rand < 0.85) {
                const r = 0.25 + Math.random() * 0.65;
                const alpha = 0.3 + Math.random() * 0.7;
                
                // Color hued spectrum
                const cType = Math.random();
                if (cType < 0.28) {
                    ctx.fillStyle = `rgba(168, 222, 255, ${alpha})`; // hot blue-white
                } else if (cType < 0.46) {
                    ctx.fillStyle = `rgba(255, 202, 148, ${alpha})`; // warm orange
                } else {
                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`; // pure white
                }
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Bright star with soft telescope halo glow (radial gradient)
                const r = 0.9 + Math.random() * 1.5;
                const alpha = 0.65 + Math.random() * 0.35;
                
                const starGrad = ctx.createRadialGradient(x, y, 0.1, x, y, r * 4.2);
                
                const cType = Math.random();
                let col = "255, 255, 255";
                if (cType < 0.28) col = "168, 222, 255";
                else if (cType < 0.46) col = "255, 202, 148";
                
                starGrad.addColorStop(0, `rgba(${col}, ${alpha})`);
                starGrad.addColorStop(0.2, `rgba(${col}, ${alpha * 0.4})`);
                starGrad.addColorStop(1, "rgba(0,0,0,0)");
                
                ctx.fillStyle = starGrad;
                ctx.beginPath();
                ctx.arc(x, y, r * 4.2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        return texture;
    }

    resize() {
        if (!this.container) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width === 0 || height === 0) return; // Safeguard
        
        this.renderer.setSize(width, height);
        this.uniforms.u_resolution.value.set(width, height);
        
        this.virtualCamera.aspect = width / height;
        this.virtualCamera.updateProjectionMatrix();
    }

    pause() {
        this.isActive = false;
    }

    resume() {
        this.isActive = true;
        setTimeout(() => {
            this.resize();
        }, 50);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (!this.isActive || window.AstrophysicsLab.activeTab !== 'blackhole') return;

        // 1. Update controls damping and sync camera variables to uniforms
        this.controls.update();

        // If the user is rotating using OrbitControls, sync the sliders value
        if (this.controls.state === -1) {
            // Idle state, synced from controls rotation
            this.syncSlidersToVirtualCamera();
        }

        // Compute camera direction, up, and right vectors from matrices for ray projection
        const camPos = this.virtualCamera.position;
        
        const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.virtualCamera.quaternion).normalize();
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.virtualCamera.quaternion).normalize();
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.virtualCamera.quaternion).normalize();

        // Calculate perspective scale factor based on field of view (FOV) scale
        // fovScale = tan(fov / 2)
        const fovScale = Math.tan(THREE.MathUtils.degToRad(this.virtualCamera.fov) / 2.0);

        // 2. Smoothly update uniforms
        this.uniforms.u_time.value += 0.015;
        
        // Mass 10 solar => Rs ~ 0.18 shader coordinates
        const rsShaderScale = 0.018 * this.mass;
        this.uniforms.u_rs.value = rsShaderScale;

        this.uniforms.u_accretion_rate.value = this.accretionRate;
        this.uniforms.u_doppler_enabled.value = this.dopplerEffect ? 1.0 : 0.0;
        this.uniforms.u_redshift_enabled.value = this.redshiftEffect ? 1.0 : 0.0;
        this.uniforms.u_lensing_enabled.value = this.gravLensing ? 1.0 : 0.0;

        // Sync spin and bhType uniforms
        let typeCode = 0.0; // Schwarzschild
        if (this.bhType === 'kerr') typeCode = 1.0;
        else if (this.bhType === 'quasar') typeCode = 2.0;
        this.uniforms.u_bh_type.value = typeCode;
        this.uniforms.u_spin.value = this.spin;

        // Projection vectors passed to GPU
        this.uniforms.u_cam_pos.value.copy(camPos);
        this.uniforms.u_cam_dir.value.copy(camDir);
        this.uniforms.u_cam_up.value.copy(camUp);
        this.uniforms.u_cam_right.value.copy(camRight);
        this.uniforms.u_fov_scale.value = fovScale;

        // Render orthographic shader projection
        this.renderer.render(this.scene, this.renderCamera);
    }
}

// Instantiate
new BlackHoleSimulation();
