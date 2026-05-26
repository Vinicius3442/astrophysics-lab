// ASTROPHYSICS LAB - BLACK HOLE SCHWARZSCHILD SHADER ENGINE (js/blackhole.js)

class BlackHoleSimulation {
    constructor() {
        this.container = document.getElementById("blackhole-canvas-container");
        this.isActive = false;
        
        // Physics constants (normalized for GPU rendering where c = 1, G = 1)
        this.mass = 10.0;          // Solar masses (M_sun)
        this.accretionRate = 1.0;  // Disk brightness factor
        this.dopplerEffect = true; // Relativistic beaming toggle
        this.redshiftEffect = true;// Gravitational redshift toggle
        this.gravLensing = true;   // Deflection toggle
        this.pitchAngle = 15.0;     // Tilt of camera in degrees
        
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

        this.sliderPitch.addEventListener("input", (e) => {
            this.pitchAngle = parseFloat(e.target.value);
            this.valPitch.textContent = Math.round(this.pitchAngle);
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

        // WebGL2 support check
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(1.0); // Shader performance is fill-rate limited, lock to 1.0
        this.container.appendChild(this.renderer.domElement);

        // Generate procedural galaxy background texture on the fly
        const bgTexture = this.generateCosmicTexture();

        // Uniforms for passing parameters into GLSL Fragment Shader
        this.uniforms = {
            u_resolution: { value: new THREE.Vector2(width, height) },
            u_time: { value: 0.0 },
            u_rs: { value: 0.20 }, // Schwarzschild radius scaled for shader space
            u_pitch: { value: 0.25 }, // Tilt in radians
            u_accretion_rate: { value: 1.0 },
            u_doppler_enabled: { value: 1.0 },
            u_redshift_enabled: { value: 1.0 },
            u_lensing_enabled: { value: 1.0 },
            u_bg_texture: { value: bgTexture }
        };

        // Custom Raymarching Fragment Shader
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
            uniform float u_pitch;
            uniform float u_accretion_rate;
            uniform float u_doppler_enabled;
            uniform float u_redshift_enabled;
            uniform float u_lensing_enabled;
            uniform sampler2D u_bg_texture;
            
            varying vec2 vUv;

            // Simple 3D procedural noise for accretion disk dust texture
            float hash(vec3 p) {
                p = fract(p * 0.3183099 + vec3(0.1, 0.1, 0.1));
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

            // Ray-plane intersection for the Accretion Disk
            bool intersectDisk(vec3 ro, vec3 rd, out float t, out float distToCenter) {
                // Plane equation: z = 0
                if (abs(rd.z) < 1e-5) return false;
                t = -ro.z / rd.z;
                if (t < 0.0) return false;
                
                vec3 intersection = ro + rd * t;
                distToCenter = length(intersection.xy);
                return true;
            }

            void main() {
                // Normalize screen coordinates
                vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

                // Setup Camera position (observer at distance 4.5)
                float rCam = 4.5;
                vec3 ro = vec3(0.0, -rCam * cos(u_pitch), rCam * sin(u_pitch));
                
                // Rotated ray direction vector
                vec3 rd = normalize(vec3(uv.x, 1.0, uv.y));
                float cp = cos(u_pitch);
                float sp = sin(u_pitch);
                rd = vec3(rd.x, rd.y * cp - rd.z * sp, rd.y * sp + rd.z * cp);

                // Integrator Step setup
                float dt = 0.04;
                vec3 ray_pos = ro;
                vec3 ray_dir = rd;
                
                vec3 color = vec3(0.0);
                float accumulated_disk_alpha = 0.0;
                
                bool hit_horizon = false;
                bool hit_background = true;

                // Raymarching Geodesic Integrator (General Relativity Schwarzschild loop)
                const int MAX_STEPS = 160;
                for (int i = 0; i < MAX_STEPS; i++) {
                    float r2 = dot(ray_pos, ray_pos);
                    float r = sqrt(r2);

                    // 1. Schwarzschild Event Horizon boundary check
                    if (r < u_rs) {
                        hit_horizon = true;
                        hit_background = false;
                        break;
                    }

                    // 2. Escape to Infinity boundary check
                    if (r > 12.0) {
                        break;
                    }

                    // 3. Relativistic light deflection step (Einstein Null Geodesics integration)
                    if (u_lensing_enabled > 0.5) {
                        vec3 gravity_dir = -ray_pos / r;
                        // Light bending acceleration multiplier
                        float deflection = (3.0 * u_rs) / (r2 * r);
                        vec3 angular_momentum = cross(ray_pos, ray_dir);
                        ray_dir += cross(angular_momentum, ray_pos) * deflection * dt;
                        ray_dir = normalize(ray_dir);
                    }

                    // 4. Accretion Disk mapping intersection check (Thin equatorial disk)
                    float z_prev = ray_pos.z;
                    ray_pos += ray_dir * dt;
                    float z_curr = ray_pos.z;

                    // Did the ray cross the equatorial plane (z = 0)?
                    if ((z_prev > 0.0 && z_curr < 0.0) || (z_prev < 0.0 && z_curr > 0.0)) {
                        float t_plane = -z_prev / (z_curr - z_prev);
                        vec3 hit_pos = ray_pos - ray_dir * (1.0 - t_plane) * dt;
                        float dist = length(hit_pos.xy);

                        // Accretion disk domain: starts at ISCO (3 * Rs) and extends to 8.5 * Rs
                        float r_isco = 3.0 * u_rs;
                        float r_outer = 9.0 * u_rs;

                        if (dist > r_isco && dist < r_outer) {
                            // Compute localized gas color and noise structure
                            float angle = atan(hit_pos.y, hit_pos.x);
                            
                            // Gas rotation velocity (Keplerian w = sqrt(G*M/r^3))
                            float angular_velocity = 2.5 / (dist * sqrt(dist));
                            float noise_val = noise(vec3(hit_pos.xy * 8.0, u_time * 2.0 - angle * 4.0));
                            
                            // Thermal glow distribution profile
                            float density_profile = smoothstep(r_isco, r_isco + 0.15, dist) * (1.0 - smoothstep(r_isco + 0.15, r_outer, dist));
                            density_profile = pow(density_profile, 1.3);

                            float brightness = (0.2 + 0.8 * noise_val) * density_profile * u_accretion_rate;
                            
                            // Accretion temperature based color gradient (hot white core, orange middle, red boundaries)
                            vec3 disk_base_color = vec3(1.0, 0.45, 0.1); // Warm solar orange
                            if (dist < r_isco * 1.6) {
                                disk_base_color = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.9, 0.7), (r_isco * 1.6 - dist) / (r_isco * 0.6));
                            }
                            
                            // Relativistic Doppler Beaming factor calculation
                            // Disc rotates counter-clockwise. Velocity vector is perpendicular to hit_pos vector.
                            vec3 disk_velocity = normalize(vec3(-hit_pos.y, hit_pos.x, 0.0)) * 0.48; // speed fraction of c ~ 48%
                            float doppler_factor = 1.0;
                            if (u_doppler_enabled > 0.5) {
                                float cos_theta = dot(disk_velocity, ray_dir);
                                // Relativistic Doppler equation: D = 1 / ( gamma * (1 - beta*cos) )
                                float gamma = 1.0 / sqrt(1.0 - dot(disk_velocity, disk_velocity));
                                doppler_factor = 1.0 / (gamma * (1.0 - cos_theta));
                                doppler_factor = pow(doppler_factor, 3.0); // intensity boosts by D^3 due to frequency and beaming
                            }

                            // Gravitational Redshift factor: z_grav = sqrt(1 - Rs/r)
                            float redshift_factor = 1.0;
                            if (u_redshift_enabled > 0.5) {
                                redshift_factor = sqrt(1.0 - u_rs / dist);
                                disk_base_color = mix(vec3(0.5, 0.02, 0.0), disk_base_color, redshift_factor); // redshift shifts hues into dark blood red
                            }

                            // Composite pixel contribution
                            float opacity = brightness * 0.7 * (1.0 - accumulated_disk_alpha);
                            color += disk_base_color * brightness * doppler_factor * redshift_factor * opacity * 2.2;
                            accumulated_disk_alpha += opacity;

                            if (accumulated_disk_alpha >= 0.98) {
                                hit_background = false;
                                break;
                            }
                        }
                    }
                }

                // 5. Draw Background distortion or Event Horizon black shadow
                if (hit_horizon) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                } else {
                    // Gravitational Lensing coordinates map on sphere texture
                    vec2 star_uv = vec2(
                        0.5 + atan(ray_dir.z, ray_dir.x) / (2.0 * 3.1415926),
                        0.5 + asin(ray_dir.y) / 3.1415926
                    );
                    vec3 stars = texture2D(u_bg_texture, star_uv).rgb;
                    
                    // Mix distorted background stars with accumulated semi-opaque disk glow
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

        // 2D orthographic plane covering full screen viewport
        const planeGeo = new THREE.PlaneGeometry(2, 2);
        const planeMesh = new THREE.Mesh(planeGeo, this.shaderMat);
        this.scene.add(planeMesh);

        window.addEventListener("resize", () => this.resize());
    }

    // Programmatically render a high resolution night sky texture to bypass static file loadings
    generateCosmicTexture() {
        const size = 1024;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        // Pitch black deep space
        ctx.fillStyle = "#020206";
        ctx.fillRect(0, 0, size, size);

        // Milky Way dust lane background gradient
        const grad = ctx.createRadialGradient(size/2, size/2, 50, size/2, size/2, size * 0.45);
        grad.addColorStop(0, "rgba(80, 40, 120, 0.15)");
        grad.addColorStop(0.3, "rgba(40, 60, 140, 0.08)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        // Add 800 random pinpoint stars
        ctx.fillStyle = "#ffffff";
        for (let i = 0; i < 800; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 0.5 + Math.random() * 1.5;
            
            // Randomly hue-color some stars (hot blue vs cool orange)
            const hue = Math.random();
            if (hue < 0.2) {
                ctx.fillStyle = "rgba(173, 216, 230, " + (0.5 + Math.random() * 0.5) + ")"; // light blue
            } else if (hue < 0.35) {
                ctx.fillStyle = "rgba(255, 224, 189, " + (0.5 + Math.random() * 0.5) + ")"; // orange
            } else {
                ctx.fillStyle = "rgba(255, 255, 255, " + (0.6 + Math.random() * 0.4) + ")";
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
        
        this.renderer.setSize(width, height);
        this.uniforms.u_resolution.value.set(width, height);
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

        if (!this.isActive || window.AstrophysicsLab.activeTab !== 'blackhole') return;

        // 1. Smoothly update uniforms based on real calculations and slider configs
        this.uniforms.u_time.value += 0.015;
        
        // Schwarzschild radius mapping: Mass 10 => Rs = 0.18 unit in shader coordinates
        const rsShaderScale = 0.018 * this.mass;
        this.uniforms.u_rs.value = rsShaderScale;
        
        // Pitch in radians (0 to 80 degrees -> 0 to 1.4 rad)
        const pitchRad = (this.pitchAngle / 180) * Math.PI;
        this.uniforms.u_pitch.value = pitchRad;

        this.uniforms.u_accretion_rate.value = this.accretionRate;
        this.uniforms.u_doppler_enabled.value = this.dopplerEffect ? 1.0 : 0.0;
        this.uniforms.u_redshift_enabled.value = this.redshiftEffect ? 1.0 : 0.0;
        this.uniforms.u_lensing_enabled.value = this.gravLensing ? 1.0 : 0.0;

        // Render the GLSL Raymarching shader scene
        this.renderer.render(this.scene, this.camera);
    }
}

// Instantiate
new BlackHoleSimulation();
