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
    }

    updateHUD() {
        // RS = 2GM/c^2. Solar mass RS is ~2.95 km
        const rs_km = this.mass * 2.953;
        const rph_km = rs_km * 1.5;   // Photon sphere = 1.5 RS
        const isco_km = rs_km * 3.0;  // ISCO stable orbit = 3.0 RS

        this.metricRs.textContent = rs_km.toFixed(1) + " km";
        this.metricRph.textContent = rph_km.toFixed(1) + " km";
        this.metricIsco.textContent = isco_km.toFixed(1) + " km";
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

            void main() {
                // Screen coordinate normalize
                vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

                // 1. Ray setup: Cast ray using virtual camera vectors (perspective projection)
                // rd = normalize( cam_dir + x * cam_right * fov + y * cam_up * fov )
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

                    // A. Schwarzschild horizon collapse boundary check
                    if (r < u_rs) {
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
                        ray_dir += cross(angular_momentum, ray_pos) * deflection * dt;
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
                        float r_outer = 9.5 * u_rs;

                        if (dist > r_isco && dist < r_outer) {
                            float angle = atan(hit_pos.y, hit_pos.x);
                            
                            // Keplerian orbital speed (w = sqrt(G*M/r^3))
                            float w = 2.8 / (dist * sqrt(dist));
                            float noise_val = noise(vec3(hit_pos.xy * 7.5, u_time * 2.2 - angle * 4.5));
                            
                            // Thermal profile curve
                            float density = smoothstep(r_isco, r_isco + 0.18, dist) * (1.0 - smoothstep(r_isco + 0.18, r_outer, dist));
                            density = pow(density, 1.2);

                            float brightness = (0.22 + 0.78 * noise_val) * density * u_accretion_rate;
                            
                            // Color mapping (hottest at innermost orbits)
                            vec3 disk_base_color = vec3(1.0, 0.48, 0.12); // Hot orange
                            if (dist < r_isco * 1.5) {
                                disk_base_color = mix(vec3(1.0, 0.48, 0.12), vec3(1.0, 0.95, 0.8), (r_isco * 1.5 - dist) / (r_isco * 0.5));
                            }

                            // Relativistic Doppler Beaming
                            float doppler_factor = 1.0;
                            if (u_doppler_enabled > 0.5) {
                                // Disc orbits counter-clockwise. Velocity vector perpendicular to pos vector
                                vec3 disk_velocity = normalize(vec3(-hit_pos.y, hit_pos.x, 0.0)) * 0.46; // orbital velocity fraction of c
                                float cos_theta = dot(disk_velocity, ray_dir);
                                float gamma = 1.0 / sqrt(1.0 - dot(disk_velocity, disk_velocity));
                                doppler_factor = 1.0 / (gamma * (1.0 - cos_theta));
                                doppler_factor = pow(doppler_factor, 3.0); // Boosted by D^3
                            }

                            // Gravitational Redshift: redshift = sqrt(1 - Rs/r)
                            float redshift_factor = 1.0;
                            if (u_redshift_enabled > 0.5) {
                                redshift_factor = sqrt(1.0 - u_rs / dist);
                                disk_base_color = mix(vec3(0.4, 0.01, 0.0), disk_base_color, redshift_factor); // redshift Shifts colors to deep crimson
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

    // High resolution stars and nebula dust canvas texture generator
    generateCosmicTexture() {
        const size = 1024;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        // Pitch black cosmos background
        ctx.fillStyle = "#010103";
        ctx.fillRect(0, 0, size, size);

        // Overlapping rich space nebulas
        // 1. Central violet-purple core
        const grad1 = ctx.createRadialGradient(size/2, size/2, 50, size/2, size/2, size * 0.5);
        grad1.addColorStop(0, "rgba(120, 40, 180, 0.22)");
        grad1.addColorStop(0.4, "rgba(50, 25, 120, 0.12)");
        grad1.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad1;
        ctx.fillRect(0, 0, size, size);

        // 2. Secondary offset deep teal nebula lane
        const grad2 = ctx.createRadialGradient(size * 0.3, size * 0.4, 20, size * 0.3, size * 0.4, size * 0.4);
        grad2.addColorStop(0, "rgba(0, 180, 210, 0.14)");
        grad2.addColorStop(0.5, "rgba(0, 80, 150, 0.06)");
        grad2.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad2;
        ctx.fillRect(0, 0, size, size);

        // 3. Diagonal cosmic dust lane (magenta-orange clouds)
        const grad3 = ctx.createLinearGradient(0, 0, size, size);
        grad3.addColorStop(0.1, "rgba(0,0,0,0)");
        grad3.addColorStop(0.45, "rgba(220, 60, 110, 0.07)");
        grad3.addColorStop(0.55, "rgba(240, 120, 30, 0.05)");
        grad3.addColorStop(0.9, "rgba(0,0,0,0)");
        ctx.fillStyle = grad3;
        ctx.fillRect(0, 0, size, size);

        // Add 3800 pinpoint stars (highly dense deep space)
        for (let i = 0; i < 3800; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            // Diverse radii (mostly sub-pixel pinpoint stars, a few larger bright stars)
            const rand = Math.random();
            const r = rand < 0.85 ? 0.3 + Math.random() * 0.6 : 0.9 + Math.random() * 0.9;
            
            // Rich color spectrum distribution
            const cType = Math.random();
            const alpha = 0.3 + Math.random() * 0.7;
            if (cType < 0.25) {
                ctx.fillStyle = `rgba(165, 220, 255, ${alpha})`; // hot blue-white
            } else if (cType < 0.45) {
                ctx.fillStyle = `rgba(255, 200, 150, ${alpha})`; // warm solar orange
            } else if (cType < 0.55) {
                ctx.fillStyle = `rgba(255, 240, 190, ${alpha})`; // warm yellow-white
            } else {
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`; // pure white
            }

            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
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
