// ASTROPHYSICS LAB - STELLAR SIMULATION (js/stellar.js)
// Física Estelar Avançada: Estrutura Interna 3D (Corte Transversal), Fusão de Prótons (p-p) e Elementos (CNO) no Núcleo, Correntes Convectivas Toroidais e Remanescentes Interativos (Anã Branca/Neutron/Buraco Negro).
// Física Estelar Avançada: Estrutura Interna 3D (Corte Transversal), Fusão de Prótons (p-p) e Elementos (CNO) no Núcleo e Correntes Convectivas Toroidais.
// Física Estelar Avançada: Fusão Termonuclear p-p e CNO, Diagrama H-R interativo e Evolução de Gigantes Vermelhas, Anãs Brancas e Supernovas de Colapso de Núcleo.

class StellarSimulation {
    constructor() {
        this.container = document.getElementById("stellar-canvas-container");
        this.isActive = false; // Starts inactive until tab switch
        
        // Physical parameters (Sun = 1)
        this.mass = 1.0;        // Solar masses (M_sun)
        this.temp = 5778;       // Effective temperature (K)
        this.lum = 1.0;         // Luminosity (L_sun)
        this.radius = 1.0;      // Radius (R_sun)
        
        // Core nuclear states
        this.tc = 15.6e6;       // Central temperature (K)
        this.rhoCentral = 150;  // Central density (g/cm^3)
        this.ppFraction = 1.0;
        this.cnoFraction = 0.0;
        this.lifetime = 10.0;   // In billion years
        
        // Evolutionary states: 'main_sequence', 'giant', 'nebula', 'white_dwarf', 'supernova', 'remanent'
        this.state = 'main_sequence';
        this.deathSequenceActive = false;
        this.deathTimer = 0;
        
        // Register in global scope
        window.AstrophysicsLab.simulations['stellar'] = this;
        
        this.selectedExotic = 'custom';
        
        // Initializations
        this.initUI();
        this.initThree();
        this.initHRDiagram();
        this.updateStellarPhysics();
        
        // Start Render Loop
        this.animate();
    }

    initUI() {
        this.sliderMass = document.getElementById("slider-s-mass");
        this.sliderTemp = document.getElementById("slider-s-temp");
        this.numMass = document.getElementById("num-s-mass");
        this.numTemp = document.getElementById("num-s-temp");
        this.valLum = document.getElementById("val-s-lum");
        
        this.valPP = document.getElementById("val-s-pp");
        this.valCNO = document.getElementById("val-s-cno");
        this.barPP = document.getElementById("bar-s-pp");
        this.barCNO = document.getElementById("bar-s-cno");
        
        this.metricRadius = document.getElementById("metric-s-r");
        this.metricTc = document.getElementById("metric-s-tc");
        this.metricPres = document.getElementById("metric-s-pres");
        this.metricTime = document.getElementById("metric-s-time");
        this.metricClass = document.getElementById("metric-s-class");
        
        this.btnEvolve = document.getElementById("btn-s-evolve");
        this.btnReset = document.getElementById("btn-s-reset");
        this.toggleInternal = document.getElementById("toggle-s-internal");
        this.inputSearch = document.getElementById("input-s-search");
        this.searchSuggestions = document.getElementById("search-suggestions");
        this.btnCustomStar = document.getElementById("btn-custom-star");
        this.starsDatabase = [];
        this.fetchStarsDatabase();
        // Alert Modal Elements
        this.alertModal = document.getElementById("stellar-alert");
        this.alertTitle = document.getElementById("alert-title");
        this.alertDesc = document.getElementById("alert-desc");
        this.btnAlertClose = document.getElementById("btn-alert-close");

        // Sync helper to update physical model properties
        const updateModelFromInputs = () => {
            this.lum = Math.pow(this.mass, 3.5);
            this.valLum.textContent = window.formatScientific(this.lum);
            this.updateStellarPhysics();
        };

        // Bidirectional Mass Input Listeners
        this.sliderMass.addEventListener("input", (e) => {
            if (this.deathSequenceActive) return;
            this.mass = parseFloat(e.target.value);
            this.numMass.value = this.mass.toFixed(1);
            
            // Adjust Temperature along the main sequence correlation
            this.temp = Math.round(5778 * Math.pow(this.mass, 0.50));
            this.temp = Math.max(2000, Math.min(this.temp, 40000));
            this.sliderTemp.value = this.temp;
            this.numTemp.value = this.temp;
            
            updateModelFromInputs();
        });

        this.numMass.addEventListener("change", (e) => {
            if (this.deathSequenceActive) return;
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 1.0;
            this.mass = Math.max(0.1, Math.min(val, 25.0));
            this.numMass.value = this.mass.toFixed(1);
            this.sliderMass.value = this.mass;

            this.temp = Math.round(5778 * Math.pow(this.mass, 0.50));
            this.temp = Math.max(2000, Math.min(this.temp, 40000));
            this.sliderTemp.value = this.temp;
            this.numTemp.value = this.temp;

            updateModelFromInputs();
        });

        // Bidirectional Temp Input Listeners
        this.sliderTemp.addEventListener("input", (e) => {
            if (this.deathSequenceActive) return;
            this.temp = parseInt(e.target.value);
            this.numTemp.value = this.temp;
            
            // Adjust Mass along Main Sequence correlation (approx logarithmic shift)
            const tRatio = this.temp / 5778;
            this.mass = Math.pow(tRatio, 1.8);
            this.mass = Math.max(0.1, Math.min(this.mass, 25.0));
            this.sliderMass.value = this.mass.toFixed(1);
            this.numMass.value = this.mass.toFixed(1);
            
            updateModelFromInputs();
        });

        this.numTemp.addEventListener("change", (e) => {
            if (this.deathSequenceActive) return;
            let val = parseInt(e.target.value);
            if (isNaN(val)) val = 5778;
            this.temp = Math.max(2000, Math.min(val, 40000));
            this.numTemp.value = this.temp;
            this.sliderTemp.value = this.temp;

            const tRatio = this.temp / 5778;
            this.mass = Math.pow(tRatio, 1.8);
            this.mass = Math.max(0.1, Math.min(this.mass, 25.0));
            this.sliderMass.value = this.mass.toFixed(1);
            this.numMass.value = this.mass.toFixed(1);

            updateModelFromInputs();
        });

        // Core visual toggler
        this.toggleInternal.addEventListener("change", (e) => {
            this.showInternal = e.target.checked;
            this.internalLayersGroup.visible = this.showInternal;
            if (this.showInternal) {
                // Ativa lâmina de corte matemática via shader uniform
                this.starMat.uniforms.u_clip.value = 1.0;
                this.starMat.side = THREE.DoubleSide; // Show inner hollow
                this.starMat.transparent = false; // keep solid
                this.coronaMesh.visible = false;
            } else {
                // Remove clipping
                this.starMat.uniforms.u_clip.value = 0.0;
                this.starMat.side = THREE.FrontSide;
                this.starMat.transparent = false;
                this.starMat.opacity = 1.0;
                this.coronaMesh.visible = true;
                this.coronaMat.transparent = true;
                this.coronaMat.opacity = 0.35;
            }
        });

        this.btnEvolve.style.display = 'none'; // Hidden until Supernova module
        this.btnReset.style.display = 'none';

        // Close the notification overlay without resetting automatically
        this.btnAlertClose.addEventListener("click", () => {
            this.alertModal.classList.remove("active");
            // The simulation remains showing the remanent in 3D!
            // The user can rotate/zoom and clicks the Reset button manually to restart
        });

        // Custom Star Button
        this.btnCustomStar.addEventListener("click", () => {
            this.selectedExotic = 'custom';
            this.sliderMass.disabled = false;
            this.sliderTemp.disabled = false;
            this.numMass.disabled = false;
            this.numTemp.disabled = false;
            this.btnEvolve.style.display = 'none';
            this.inputSearch.value = "";
            this.searchSuggestions.style.display = 'none';
            
            this.mass = parseFloat(this.sliderMass.value);
            this.temp = parseFloat(this.sliderTemp.value);
            this.updateStellarPhysics();
            this.createMagneticLoops();
            this.updateExoticVisuals('custom');
        });

        // Search Input Listeners
        this.inputSearch.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (query.length < 1) {
                this.searchSuggestions.style.display = 'none';
                return;
            }
            
            const results = this.starsDatabase.filter(star => 
                star.name.toLowerCase().includes(query) || 
                (star.tags && star.tags.some(tag => tag.toLowerCase().includes(query)))
            ).slice(0, 50); // LIMIT TO 50 RESULTS FOR PERFORMANCE
            
            this.searchSuggestions.innerHTML = '';
            if (results.length > 0) {
                this.searchSuggestions.style.display = 'block';
                results.forEach(star => {
                    const div = document.createElement("div");
                    div.style.padding = "8px 12px";
                    div.style.cursor = "pointer";
                    div.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
                    div.style.fontSize = "0.8rem";
                    
                    const typeDisplay = star.type ? star.type : `${star.temp}K • ${star.mass} M☉`;
                    div.innerHTML = `<strong style="color:var(--accent-cyan);">${star.name}</strong><br><span style="color:var(--text-secondary); font-size:0.7rem;">${typeDisplay}</span>`;
                    
                    // Hover effect
                    div.addEventListener("mouseenter", () => div.style.background = "rgba(0, 245, 212, 0.15)");
                    div.addEventListener("mouseleave", () => div.style.background = "transparent");
                    
                    div.addEventListener("click", () => {
                        this.selectStarFromDB(star);
                        this.searchSuggestions.style.display = 'none';
                    });
                    this.searchSuggestions.appendChild(div);
                });
            } else {
                this.searchSuggestions.style.display = 'block';
                this.searchSuggestions.innerHTML = '<div style="padding:8px 12px; font-size:0.8rem; color:var(--text-secondary);">Nenhuma estrela encontrada.</div>';
            }
        });
        
        // Hide suggestions when clicking outside
        document.addEventListener("click", (e) => {
            if (e.target !== this.inputSearch && e.target !== this.searchSuggestions) {
                this.searchSuggestions.style.display = 'none';
            }
        });
    }

    async fetchStarsDatabase() {
        try {
            const response = await fetch('data/stars.json');
            this.starsDatabase = await response.json();
        } catch (error) {
            console.error("Erro ao carregar o banco de dados estelar:", error);
        }
    }

    selectStarFromDB(star) {
        this.inputSearch.value = star.name;
        this.selectedExotic = star.id;
        
        this.metricClass.textContent = "Carregando dados astronômicos...";
        this.metricClass.style.color = "var(--accent-yellow)";
        
        setTimeout(() => {
            this.mass = star.mass;
            this.temp = star.temp;
            
            this.sliderMass.value = this.mass;
            this.numMass.value = this.mass;
            this.sliderTemp.value = this.temp;
            this.numTemp.value = this.temp;

            this.sliderMass.disabled = true;
            this.sliderTemp.disabled = true;
            this.numMass.disabled = true;
            this.numTemp.disabled = true;

            // Update radius/lum for massive giants to override standard formula
            if (star.radius > 0) {
                this.radius = star.radius;
                // Luminosity approx from radius and temp
                const tempRatio = this.temp / 5778;
                this.lum = (this.radius * this.radius) * Math.pow(tempRatio, 4);
            } else {
                this.lum = Math.pow(this.mass, 3.5);
            }

            this.updateStellarPhysics();
            this.createMagneticLoops();
            this.updateExoticVisuals(star.id);
            
            this.metricClass.textContent = star.type;
            this.metricClass.style.color = "var(--accent-cyan)";
        }, 400);
    }

    initThree() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
        this.camera.position.set(0, 0, 5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.localClippingEnabled = true;
        this.container.appendChild(this.renderer.domElement);

        this.clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 1.0;
        this.controls.maxDistance = 12;

        // Space Dust Background
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.08);
        this.scene.add(ambientLight);

        // Core star point light
        this.starLight = new THREE.PointLight(0xffffff, 2.0, 50);
        this.scene.add(this.starLight);

        // ==========================================
        // EXTERIOR SHELL & CORONA
        // ==========================================
        
        // Star 3D Geometry (highly detailed)
        this.starGeo = new THREE.SphereGeometry(1.0, 64, 64);
        
        // Custom Shader Material for realistic bubbling plasma surface and HDR Bloom
        this.starMat = new THREE.ShaderMaterial({
            uniforms: {
                u_time: { value: 0.0 },
                u_color: { value: new THREE.Color(0xffd700) },
                u_opacity: { value: 1.0 },
                u_clip: { value: 0.0 }
            },
            transparent: false,
            side: THREE.FrontSide,
            opacity: 1.0,
            vertexShader: `
                uniform float u_time;
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying float vNoise;
                
                // Fast 3D Noise for Vertex Displacement
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
                float snoise(vec3 v) { 
                    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
                    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
                    vec3 i  = floor(v + dot(v, C.yyy) );
                    vec3 x0 = v - i + dot(i, C.xxx) ;
                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min( g.xyz, l.zxy );
                    vec3 i2 = max( g.xyz, l.zxy );
                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;
                    i = mod289(i); 
                    vec4 p = permute( permute( permute( 
                               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                             + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
                    float n_ = 0.142857142857;
                    vec3  ns = n_ * D.wyz - D.xzx;
                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_ );
                    vec4 x = x_ *ns.x + ns.yyyy;
                    vec4 y = y_ *ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);
                    vec4 b0 = vec4( x.xy, y.xy );
                    vec4 b1 = vec4( x.zw, y.zw );
                    vec4 s0 = floor(b0)*2.0 + 1.0;
                    vec4 s1 = floor(b1)*2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));
                    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
                    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
                    vec3 p0 = vec3(a0.xy,h.x);
                    vec3 p1 = vec3(a0.zw,h.y);
                    vec3 p2 = vec3(a1.xy,h.z);
                    vec3 p3 = vec3(a1.zw,h.w);
                    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
                    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
                }

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    
                    // Vertex Displacement using 3D Noise for convective granulation
                    float noiseVal = snoise(position * 3.5 + u_time * 0.15) * 0.03;
                    noiseVal += snoise(position * 8.0 - u_time * 0.25) * 0.01;
                    
                    vNoise = noiseVal;
                    
                    vec3 displacedPos = position + normal * noiseVal;
                    vPosition = displacedPos;
                    
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPos, 1.0);
                }
            `,
            fragmentShader: `
                uniform float u_time;
                uniform vec3 u_color;
                uniform float u_opacity;
                uniform float u_clip;
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying float vNoise;

                // FBM for detailed surface plasma
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
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }
                float fbm(vec3 p) {
                    float v = 0.0;
                    float a = 0.5;
                    vec3 shift = vec3(100.0);
                    for (int i = 0; i < 4; ++i) { // 4 octaves for rich detail
                        v += a * noise(p);
                        p = p * 2.0 + shift;
                        a *= 0.5;
                    }
                    return v;
                }

                void main() {
                    if (u_clip > 0.5 && vPosition.x > 0.0) {
                        discard; // Cross-section active
                    }
                    
                    vec3 coord = vPosition * 5.0;
                    coord.y -= u_time * 0.4;
                    coord.z += sin(u_time * 0.2) * 0.2;
                    
                    float n = fbm(coord);
                    vec3 baseColor = u_color;
                    
                    vec3 hotColor = mix(baseColor, vec3(1.0, 1.0, 1.0), 0.85);
                    vec3 coolColor = mix(baseColor, vec3(0.05, 0.0, 0.0), 0.8);
                    
                    if (u_color.b > 0.8 && u_color.r < 0.4) {
                        coolColor = mix(baseColor, vec3(0.0, 0.02, 0.2), 0.8);
                        hotColor = mix(baseColor, vec3(0.9, 0.95, 1.0), 0.85);
                    }
                    
                    n = smoothstep(0.3, 0.8, n + vNoise * 2.0);
                    vec3 surfaceColor = mix(coolColor, hotColor, n);
                    
                    // Intense HDR Fresnel (Bloom Core)
                    float ndotv = dot(normalize(vNormal), vec3(0.0, 0.0, 1.0));
                    float fresnel = pow(1.0 - max(0.0, ndotv), 2.5); // Sharper, more intense edge
                    
                    // Additive incandescent bloom
                    vec3 finalColor = surfaceColor * 1.5 + baseColor * fresnel * 4.0 + vec3(fresnel * 0.5);
                    
                    // ACES Film Tone Mapping for Photorealism
                    finalColor = (finalColor * (2.51 * finalColor + 0.03)) / (finalColor * (2.43 * finalColor + 0.59) + 0.14);
                    
                    gl_FragColor = vec4(finalColor, u_opacity);
                }
            `
        });
        
        // Intercept color updates dynamically to work with uniforms
        this.starMat.color = {
            setHex: (hex) => {
                this.starMat.uniforms.u_color.value.setHex(hex);
            }
        };

        this.starMesh = new THREE.Mesh(this.starGeo, this.starMat);
        this.scene.add(this.starMesh);

        // Corona / Soft Outer Aura (Volumetric Raymarching)
        this.coronaGeo = new THREE.SphereGeometry(3.0, 32, 32); // Large bounding box for dust
        this.coronaMat = new THREE.ShaderMaterial({
            uniforms: {
                u_time: { value: 0.0 },
                u_color: { value: new THREE.Color(0xffffff) },
                u_isWolfRayet: { value: 0.0 },
                u_coreRadius: { value: 1.0 },
                u_coronaRadius: { value: 3.0 }
            },
            vertexShader: `
                varying vec3 vWorldPos;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform float u_time;
                uniform vec3 u_color;
                uniform float u_isWolfRayet;
                uniform float u_coreRadius;
                uniform float u_coronaRadius;
                varying vec3 vWorldPos;
                
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
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }
                float fbm(vec3 p) {
                    float v = 0.0;
                    float a = 0.5;
                    vec3 shift = vec3(100.0);
                    for (int i = 0; i < 4; ++i) {
                        v += a * noise(p);
                        p = p * 2.0 + shift;
                        a *= 0.5;
                    }
                    return v;
                }

                void main() {
                    vec3 ro = cameraPosition;
                    vec3 rd = normalize(vWorldPos - ro);
                    
                    // Sphere intersection with dynamic corona radius
                    float b = dot(ro, rd);
                    float c = dot(ro, ro) - (u_coronaRadius * u_coronaRadius);
                    float disc = b*b - c;
                    
                    if (disc < 0.0) discard;
                    
                    float tNear = max(0.0, -b - sqrt(disc));
                    float tFar = -b + sqrt(disc);
                    
                    int STEPS = 45;
                    float tStep = (tFar - tNear) / float(STEPS);
                    float t = tNear;
                    
                    vec3 col = vec3(0.0);
                    float transmit = 1.0;
                    
                    for(int i=0; i<45; i++) {
                        vec3 p = ro + rd * t;
                        float r = length(p);
                        
                        // Dynamic Core blockage
                        if (r < u_coreRadius * 0.95) { // Slightly inside surface to prevent artifacts
                            transmit = 0.0;
                            break;
                        }
                        
                        // Corona logic
                        float density = 0.0;
                        vec3 emitCol = vec3(0.0);
                        
                        // Normalize local R based on core
                        float normR = r / u_coreRadius; 
                        
                        if (u_isWolfRayet > 0.5) {
                            float wave = sin(normR * 10.0 - u_time * 3.0) * 0.5 + 0.5;
                            vec3 pNoise = (p / u_coreRadius) * 2.5 - vec3(u_time * 0.2);
                            float n = fbm(pNoise);
                            
                            float dustDensity = smoothstep(0.4, 0.8, n * wave) * exp(-(normR-1.0)*1.5) * 6.0;
                            
                            density = dustDensity;
                            emitCol = mix(vec3(0.8, 0.2, 0.1), u_color, smoothstep(0.0, 1.0, density)) * (1.0 / (normR*normR));
                        } else {
                            float n = fbm((p / u_coreRadius) * 4.0 - vec3(0.0, u_time*0.5, 0.0));
                            float coronaDensity = exp(-(normR - 1.0) * 5.0) * (n * 0.6 + 0.4);
                            density = coronaDensity * 0.9;
                            emitCol = u_color * 1.8;
                        }
                        
                        if (density > 0.01) {
                            // Scale step contribution so small stars don't get over-dense
                            float stepFactor = tStep / u_coreRadius; 
                            col += emitCol * density * transmit * stepFactor * 2.0;
                            transmit *= exp(-density * stepFactor * 3.0);
                        }
                        
                        if (transmit < 0.01) break;
                        t += tStep;
                    }
                    
                    // ACES Tone Mapping for volumetric glow to match star body
                    col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
                    
                    gl_FragColor = vec4(col, 1.0 - transmit);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide
        });
        
        // Setup intercept for corona colors
        this.coronaMat.color = {
            setHex: (hex) => {
                this.coronaMat.uniforms.u_color.value.setHex(hex);
            }
        };

        this.coronaMesh = new THREE.Mesh(this.coronaGeo, this.coronaMat);
        this.scene.add(this.coronaMesh);

        // Magnetic Loops Group (Bezier Curves)
        this.magneticLoopsGroup = new THREE.Group();
        this.scene.add(this.magneticLoopsGroup);
        this.magneticLoops = [];

        // Exotic Effects Group (Wolf-Rayet polar jets & winds)
        this.exoticEffectsGroup = new THREE.Group();
        this.scene.add(this.exoticEffectsGroup);

        // ==========================================
        // INTERNAL LAYERS & PARTICLES (CROSS SECTION)
        // ==========================================
        this.internalLayersGroup = new THREE.Group();
        this.internalLayersGroup.visible = false; // Hidden by default
        this.scene.add(this.internalLayersGroup);

        // 1. Core Sphere (Nuclear Center)
        const coreGeo = new THREE.SphereGeometry(0.24, 32, 32);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending
        });
        this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
        this.internalLayersGroup.add(this.coreMesh);

        // 2. Radiative Zone Shell (Volumetric Glow)
        const radGeo = new THREE.SphereGeometry(0.65, 64, 64);
        const radMat = new THREE.MeshBasicMaterial({
            color: 0xff4400,
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.radiativeMesh = new THREE.Mesh(radGeo, radMat);
        this.internalLayersGroup.add(this.radiativeMesh);

        // 3. Fusion Collision Particles (in Core)
        this.fusionCount = 150;
        this.fusionGeo = new THREE.BufferGeometry();
        this.fusionPositions = new Float32Array(this.fusionCount * 3);
        this.fusionColors = new Float32Array(this.fusionCount * 3);
        this.fusionVelocities = [];

        for (let i = 0; i < this.fusionCount; i++) {
            // Distribute randomly inside a sphere of radius 0.22
            const r = Math.random() * 0.22;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            
            const x = Math.sin(phi) * Math.cos(theta) * r;
            const y = Math.sin(phi) * Math.sin(theta) * r;
            const z = Math.cos(phi) * r;
            
            this.fusionPositions[i*3] = x;
            this.fusionPositions[i*3+1] = y;
            this.fusionPositions[i*3+2] = z;

            // Direct speeds towards the center for collision animation
            const speed = 0.002 + Math.random() * 0.003;
            this.fusionVelocities.push(new THREE.Vector3(-x, -y, -z).normalize().multiplyScalar(speed));
            
            // Set initial colors: half red, half yellow
            if (i % 2 === 0) {
                this.fusionColors[i*3] = 1.0;   // R
                this.fusionColors[i*3+1] = 0.1; // G
                this.fusionColors[i*3+2] = 0.1; // B
            } else {
                this.fusionColors[i*3] = 1.0;   // R
                this.fusionColors[i*3+1] = 0.9; // G
                this.fusionColors[i*3+2] = 0.0; // B
            }
        }

        this.fusionGeo.setAttribute('position', new THREE.BufferAttribute(this.fusionPositions, 3));
        this.fusionGeo.setAttribute('color', new THREE.BufferAttribute(this.fusionColors, 3));
        this.fusionMat = new THREE.PointsMaterial({
            size: 0.04,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });
        this.fusionParticles = new THREE.Points(this.fusionGeo, this.fusionMat);
        this.internalLayersGroup.add(this.fusionParticles);

        // 4. Convective Cells Currents Particles
        this.convectionCount = 300;
        this.convectionGeo = new THREE.BufferGeometry();
        this.convectionPositions = new Float32Array(this.convectionCount * 3);
        this.convectionStates = []; // Track position, theta angle, and toroidal phase

        for (let i = 0; i < this.convectionCount; i++) {
            // Distribute in a thick shell between 0.65 (radiative) and 1.0 (surface)
            const theta = Math.random() * Math.PI * 2;
            const yAngle = (Math.random() - 0.5) * Math.PI; // latitude
            const phase = Math.random() * Math.PI * 2; // convection cycle phase
            
            // toroidal scale radius
            const r = 0.65 + (0.35 * (Math.sin(phase) + 1.0) / 2.0);
            const x = Math.cos(yAngle) * Math.cos(theta) * r;
            const y = Math.sin(yAngle) * r;
            const z = Math.cos(yAngle) * Math.sin(theta) * r;

            this.convectionPositions[i*3] = x;
            this.convectionPositions[i*3+1] = y;
            this.convectionPositions[i*3+2] = z;

            this.convectionStates.push({
                theta: theta,
                yAngle: yAngle,
                phase: phase,
                speed: 0.02 + Math.random() * 0.03
            });
        }

        this.convectionGeo.setAttribute('position', new THREE.BufferAttribute(this.convectionPositions, 3));
        
        // Create a circular gradient texture for soft glowing particles
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.2, 'rgba(255,200,0,1)');
        grad.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0,0,32,32);
        const tex = new THREE.CanvasTexture(canvas);
        
        this.convectionMat = new THREE.PointsMaterial({
            color: 0xffa500,
            size: 0.08,
            map: tex,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.convectionParticles = new THREE.Points(this.convectionGeo, this.convectionMat);
        this.internalLayersGroup.add(this.convectionParticles);

        // ==========================================
        // EJECTED PARTICLES (SUPERNOVA)
        // ==========================================
        this.particleCount = 2000;
        this.particleGeo = new THREE.BufferGeometry();
        this.particlePositions = new Float32Array(this.particleCount * 3);
        this.particleVelocities = [];
        this.particleColors = new Float32Array(this.particleCount * 3);

        for (let i = 0; i < this.particleCount; i++) {
            // Distribute spherical shell
            this.particlePositions[i*3] = 0;
            this.particlePositions[i*3+1] = 0;
            this.particlePositions[i*3+2] = 0;
            
            // Random expanding velocities
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const speed = 0.2 + Math.random() * 2.8; // higher velocity bounds
            
            this.particleVelocities.push(new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.sin(phi) * Math.sin(theta) * speed,
                Math.cos(phi) * speed
            ));
        }

        this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
        
        this.particleMat = new THREE.PointsMaterial({
            color: 0xffaa00,
            size: 0.05,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending
        });

        this.particles = new THREE.Points(this.particleGeo, this.particleMat);
        this.scene.add(this.particles);

        window.addEventListener("resize", () => this.resize());
    }

    // 2D Hertzsprung-Russell Diagram Interactive Render
    initHRDiagram() {
        this.hrCanvas = document.getElementById("hr-canvas");
        this.hrCtx = this.hrCanvas.getContext("2d");
        
        // Standard setup sizes
        this.hrCanvas.width = 300;
        this.hrCanvas.height = 220;

        // Click and drag handling on HR Diagram
        const handleHRClick = (e) => {
            const rect = this.hrCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const xPct = x / rect.width;
            const yPct = y / rect.height;
            
            if (xPct > 0.6 && yPct < 0.35) {
                // Supergiant Region
                this.temp = 3500 + Math.random() * 2000;
                this.mass = 20.0 + Math.random() * 5.0; 
                this.lum = Math.pow(this.mass, 3.5) * 50.0;
            } else if (xPct < 0.4 && yPct > 0.7) {
                // White Dwarf Region
                this.temp = 10000 + Math.random() * 15000;
                this.mass = 0.6 + Math.random() * 0.6;
                this.lum = 0.001;
            } else {
                // Main Sequence mapping
                const logTempMin = Math.log10(2000);
                const logTempMax = Math.log10(40000);
                const logTemp = logTempMax - xPct * (logTempMax - logTempMin);
                this.temp = Math.round(Math.pow(10, logTemp));
                this.temp = Math.max(2000, Math.min(this.temp, 40000));
                
                const tRatio = this.temp / 5778;
                this.mass = Math.pow(tRatio, 1.8);
                this.mass = Math.max(0.1, Math.min(this.mass, 25));
                this.lum = Math.pow(this.mass, 3.5);
            }
            
            this.sliderTemp.value = this.temp;
            this.numTemp.value = this.temp;
            this.sliderMass.value = this.mass.toFixed(1);
            this.numMass.value = this.mass.toFixed(1);

            this.updateStellarPhysics();
        };

        this.hrCanvas.addEventListener("mousedown", (e) => {
            handleHRClick(e);
            const moveHandler = (moveEvent) => handleHRClick(moveEvent);
            window.addEventListener("mousemove", moveHandler);
            window.addEventListener("mouseup", () => {
                window.removeEventListener("mousemove", moveHandler);
            }, { once: true });
        });
    }

    drawHRDiagram() {
        const ctx = this.hrCtx;
        const w = this.hrCanvas.width;
        const h = this.hrCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // 1. Draw Grid Lines
        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.lineWidth = 1;
        for (let i = 1; i < 5; i++) {
            const x = (i / 5) * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();

            const y = (i / 5) * h;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // 2. Draw Main Sequence Corridor Gradient
        const msGrad = ctx.createLinearGradient(0, 0, w, h);
        msGrad.addColorStop(0, "rgba(0, 210, 255, 0.25)");   // Hot Blue
        msGrad.addColorStop(0.5, "rgba(255, 215, 0, 0.2)"); // Solar Yellow
        msGrad.addColorStop(1, "rgba(255, 42, 109, 0.25)");   // Cool Red

        ctx.strokeStyle = msGrad;
        ctx.lineWidth = 18;
        ctx.lineCap = "round";
        ctx.beginPath();
        // A curve in 'S' shape representing the Main Sequence corridor
        ctx.moveTo(25, 25);
        ctx.quadraticCurveTo(w * 0.4, h * 0.5, w - 25, h - 25);
        ctx.stroke();

        // Draw Supergiants / Red Giants Branch (Top Right)
        const giantGrad = ctx.createLinearGradient(w/2, 0, w, 0);
        giantGrad.addColorStop(0, "rgba(255, 180, 0, 0.15)");
        giantGrad.addColorStop(1, "rgba(255, 60, 0, 0.25)");
        ctx.fillStyle = giantGrad;
        ctx.beginPath();
        ctx.ellipse(w * 0.75, h * 0.2, w * 0.2, h * 0.15, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.font = "8px Orbitron";
        ctx.fillText("Supergigantes", w * 0.68, h * 0.2);

        // Draw White Dwarfs Branch (Bottom Left)
        const wdGrad = ctx.createLinearGradient(0, h, w/2, h);
        wdGrad.addColorStop(0, "rgba(200, 240, 255, 0.3)");
        wdGrad.addColorStop(1, "rgba(255, 255, 255, 0.1)");
        ctx.fillStyle = wdGrad;
        ctx.beginPath();
        ctx.ellipse(w * 0.25, h * 0.85, w * 0.15, h * 0.1, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.fillText("Anãs Brancas", w * 0.15, h * 0.86);

        // 3. Labels
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "8px Orbitron";
        ctx.fillText("40,000K", 5, h - 6);
        ctx.fillText("O", 30, h - 6);
        ctx.fillText("B", 70, h - 6);
        ctx.fillText("A", 115, h - 6);
        ctx.fillText("F", 150, h - 6);
        ctx.fillText("G", 185, h - 6);
        ctx.fillText("K", 225, h - 6);
        ctx.fillText("M", 260, h - 6);
        ctx.fillText("2,000K", w - 40, h - 6);

        ctx.save();
        ctx.translate(10, 45);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("LUMINOSIDADE (L/Lsun)", 0, 0);
        ctx.restore();

        // 4. Draw Current Star Indicator Marker
        // Temperature logarithmic coordinate
        const logTempMin = Math.log10(2000);
        const logTempMax = Math.log10(40000);
        const logCurrent = Math.log10(this.temp);
        const xPct = (logTempMax - logCurrent) / (logTempMax - logTempMin);
        const markerX = xPct * (w - 50) + 25;

        // Luminosity logarithmic coordinate (L = M^3.5)
        const logLumMin = Math.log10(Math.pow(0.1, 3.5));
        const logLumMax = Math.log10(Math.pow(25.0, 3.5));
        const logCurrentLum = Math.log10(this.lum);
        const yPct = (logLumMax - logCurrentLum) / (logLumMax - logLumMin);
        const markerY = yPct * (h - 60) + 30;

        // Draw crosshair or target circle with glow
        ctx.shadowBlur = 8;
        ctx.shadowColor = this.getStarHexColor();
        ctx.fillStyle = this.getStarHexColor();
        ctx.beginPath();
        ctx.arc(markerX, markerY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    updateStellarPhysics() {
        if (this.deathSequenceActive) return;

        // 1. Stefan-Boltzmann Law for Radius
        // L = 4*pi * R^2 * sigma * T^4
        // Normalized with solar values: R/R_sun = sqrt( L/L_sun ) / ( T / T_sun )^2
        const tempRatio = this.temp / 5778;
        this.radius = Math.sqrt(this.lum) / (tempRatio * tempRatio);

        // 2. Central Core Conditions Estimation
        // Central Temp: Tc ~ M/R * Tc_sun
        this.tc = 15.6e6 * (this.mass / this.radius);
        
        // Central Density: rho_c ~ M/R^3 * rho_sun
        this.rhoCentral = 150 * (this.mass / Math.pow(this.radius, 3));

        // 3. Nuclear Reaction Rates (p-p Chain vs CNO Cycle)
        // Energy production scaling:
        // epsilon_pp ~ Tc^4
        // epsilon_cno ~ Tc^17
        const t6 = this.tc / 1e6; // Temperature in millions of Kelvin
        const e_pp = Math.pow(t6, 4);
        // CNO starts fusing around 14MK and completely dominates past 17MK
        const e_cno = 1e-11 * Math.pow(t6, 17); // Exponentially massive sensitivity

        const totalEnergy = e_pp + e_cno;
        this.ppFraction = e_pp / totalEnergy;
        this.cnoFraction = e_cno / totalEnergy;

        // 4. Main Sequence Lifetime Estimate
        // lifetime = 10 billion years * (M / L) = 10 * M^-2.5
        this.lifetime = 10.0 * Math.pow(this.mass, -2.5);

        // Update Three.js meshes properties
        const visualScale = Math.max(0.2, Math.min(this.radius * 0.7, 2.0)); // scale boundaries
        this.starMesh.scale.setScalar(visualScale);
        this.coronaMesh.scale.setScalar(visualScale * 1.05);

        // Change colors according to spectral temp
        const hexColor = this.getStarHexColor();
        this.starMat.color.setHex(hexColor);
        this.coronaMat.color.setHex(hexColor);
        this.starLight.color.setHex(hexColor);

        // Update spectral classification label for custom star
        if (this.selectedExotic === 'custom') {
            let mkType = "Anã da Sequência Principal";
            if (this.radius > 3.0) mkType = "Gigante Estelar";
            if (this.radius > 12.0) mkType = "Supergigante Estelar";
            
            let mkClass = "G";
            if (this.temp < 3700) mkClass = "Classe M";
            else if (this.temp < 5200) mkClass = "Classe K";
            else if (this.temp < 6000) mkClass = "Classe G";
            else if (this.temp < 7500) mkClass = "Classe F";
            else if (this.temp < 10000) mkClass = "Classe A";
            else if (this.temp < 30000) mkClass = "Classe B";
            else mkClass = "Classe O";
            
            this.metricClass.textContent = `${mkType} (${mkClass})`;
            this.metricClass.style.color = "var(--accent-cyan)";
        }

        // Recreate magnetic loops to fit new radius
        if (this.createMagneticLoops) {
            this.createMagneticLoops();
        }

        // Update UI
        this.valLum.textContent = window.formatScientific(this.lum);
        this.metricRadius.textContent = this.radius.toFixed(2) + " R⊙";
        this.metricTc.textContent = (this.tc / 1e6).toFixed(1) + " Milhões K";
        
        // Atualiza monitor de Fusão Nuclear (DOM)
        const ppPct = Math.round(this.ppFraction * 100);
        const cnoPct = Math.round(this.cnoFraction * 100);
        this.valPP.textContent = ppPct + "%";
        this.barPP.style.width = ppPct + "%";
        this.valCNO.textContent = cnoPct + "%";
        this.barCNO.style.width = cnoPct + "%";
        
        // Estimate central core pressure (hydrostatic equilibrium approximation)
        const centralPressure = this.mass * this.mass / Math.pow(this.radius, 4);
        this.metricPres.textContent = centralPressure.toFixed(2) + " P⊙";

        if (this.lifetime < 0.001) {
            this.metricTime.textContent = (this.lifetime * 1e3).toFixed(1) + " Milhões anos";
        } else {
            this.metricTime.textContent = this.lifetime.toFixed(2) + " Bilhões anos";
        }

        this.barPP.style.width = (this.ppFraction * 100) + "%";
        this.barCNO.style.width = (this.cnoFraction * 100) + "%";
    }

    createMagneticLoops() {
        if (!this.magneticLoopsGroup) return;
        
        // Clear old loops
        while (this.magneticLoopsGroup.children.length > 0) {
            this.magneticLoopsGroup.remove(this.magneticLoopsGroup.children[0]);
        }
        this.magneticLoops = [];

        if (this.state === 'white_dwarf' || this.state === 'remanent' || this.state === 'nebula' || this.state === 'collapsing' || this.state === 'explosion') return;

        const loopCount = 6;
        const starRadius = Math.max(0.2, Math.min(this.radius * 0.7, 2.0));

        for (let i = 0; i < loopCount; i++) {
            // Pick a random surface point P1
            const theta1 = Math.random() * Math.PI * 2;
            const phi1 = Math.acos((Math.random() * 2) - 1);
            const p1 = new THREE.Vector3(
                Math.sin(phi1) * Math.cos(theta1),
                Math.sin(phi1) * Math.sin(theta1),
                Math.cos(phi1)
            ).multiplyScalar(starRadius);

            // Pick a second point P2 close to P1
            const theta2 = theta1 + (Math.random() - 0.5) * 0.6;
            const phi2 = phi1 + (Math.random() - 0.5) * 0.6;
            const p2 = new THREE.Vector3(
                Math.sin(phi2) * Math.cos(theta2),
                Math.sin(phi2) * Math.sin(theta2),
                Math.cos(phi2)
            ).multiplyScalar(starRadius);

            // Midpoint and radial normal
            const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
            const normal = mid.clone().normalize();
            
            // Extrude control point radially to create arch height
            const loopHeight = starRadius * (0.12 + Math.random() * 0.18);
            const cp = mid.clone().add(normal.multiplyScalar(loopHeight));

            // Create Bezier curve
            const curve = new THREE.QuadraticBezierCurve3(p1, cp, p2);
            const points = curve.getPoints(24);
            const curveGeo = new THREE.BufferGeometry().setFromPoints(points);

            // Glowing line material
            const lineMat = new THREE.LineBasicMaterial({
                color: this.getStarHexColor(),
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending
            });

            const line = new THREE.Line(curveGeo, lineMat);
            this.magneticLoopsGroup.add(line);

            // Add an animated flare particle along the arch
            const flareGeo = new THREE.SphereGeometry(starRadius * 0.02, 8, 8);
            const flareMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.85,
                blending: THREE.AdditiveBlending
            });
            const flare = new THREE.Mesh(flareGeo, flareMat);
            this.magneticLoopsGroup.add(flare);

            this.magneticLoops.push({
                line: line,
                flare: flare,
                curve: curve,
                progress: Math.random(),
                speed: 0.006 + Math.random() * 0.012,
                p1: p1,
                p2: p2,
                cp: cp
            });
        }
    }

    updateExoticVisuals(val) {
        if (!this.exoticEffectsGroup) return;
        
        // Restore defaults
        if (this.starMat) {
            this.starMat.transparent = false;
            this.starMat.opacity = 1.0;
        }
        if (this.coronaMesh) {
            this.coronaMesh.visible = true;
        }
        
        // Clear old ones
        while (this.exoticEffectsGroup.children.length > 0) {
            this.exoticEffectsGroup.remove(this.exoticEffectsGroup.children[0]);
        }
        
        this.windPoints = null;

        if (val === 'wolf_rayet') {
            const starRadius = Math.max(0.2, Math.min(this.radius * 0.7, 2.0));
            
            // Polar Jet Up
            const jetGeoUp = new THREE.CylinderGeometry(0.01, starRadius * 0.25, starRadius * 5.0, 16, 1, true);
            jetGeoUp.translate(0, starRadius * 2.5, 0);
            const jetMat = new THREE.MeshBasicMaterial({
                color: 0x00f5d4,
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide
            });
            const jetUp = new THREE.Mesh(jetGeoUp, jetMat);
            this.exoticEffectsGroup.add(jetUp);

            // Polar Jet Down
            const jetGeoDown = new THREE.CylinderGeometry(0.01, starRadius * 0.25, starRadius * 5.0, 16, 1, true);
            jetGeoDown.translate(0, starRadius * 2.5, 0);
            const jetDown = new THREE.Mesh(jetGeoDown, jetMat);
            jetDown.rotation.x = Math.PI;
            this.exoticEffectsGroup.add(jetDown);

            // Outward wind particles - Powered by Castor, Abbott & Klein (CAK) Line-Driven Wind Theory
            // v(r) = v_inf * (1.0 - R_star / r)^beta
            this.windCount = 4500;
            this.windGeo = new THREE.BufferGeometry();
            this.windPositions = new Float32Array(this.windCount * 3);
            this.windSpeeds = new Float32Array(this.windCount);
            this.windDirections = new Float32Array(this.windCount * 3);
            this.windRadii = new Float32Array(this.windCount); // track current distance from star center
            
            // Make core violently exposed
            this.starMat.transparent = true;
            this.starMat.opacity = 0.95;
            this.starMat.color.setHex(0x1a00ff); // intense violet-blue core
            this.coronaMesh.visible = false; // Hide fluffy outer corona
            
            for (let i = 0; i < this.windCount; i++) {
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos((Math.random() * 2) - 1);
                
                // Helical spiral MHD factor combined with CAK radial direction
                const dir = new THREE.Vector3(
                    Math.sin(phi) * Math.cos(theta),
                    Math.sin(phi) * Math.sin(theta),
                    Math.cos(phi)
                ).normalize();
                
                this.windDirections[i*3] = dir.x;
                this.windDirections[i*3+1] = dir.y;
                this.windDirections[i*3+2] = dir.z;
                
                // Start at a random radius between surface and outer wind boundary
                const r = starRadius * (1.0 + Math.random() * 2.2);
                this.windRadii[i] = r;
                
                this.windPositions[i*3] = dir.x * r;
                this.windPositions[i*3+1] = dir.y * r;
                this.windPositions[i*3+2] = dir.z * r;
                
                // Initial wind speed (hyper fast for exposed core)
                this.windSpeeds[i] = 0.045 + Math.random() * 0.04;
            }
            
            this.windGeo.setAttribute('position', new THREE.BufferAttribute(this.windPositions, 3));
            const windMat = new THREE.PointsMaterial({
                color: 0x00f5d4,
                size: 0.045,
                transparent: true,
                opacity: 0.85,
                blending: THREE.AdditiveBlending
            });
            this.windPoints = new THREE.Points(this.windGeo, windMat);
            this.exoticEffectsGroup.add(this.windPoints);
        }
    }

    getStarHexColor() {
        if (this.temp < 3700) return 0xff4500;      // Class M: Red
        if (this.temp < 5200) return 0xffa500;      // Class K: Orange
        if (this.temp < 6000) return 0xffd700;      // Class G: Yellow (Sun)
        if (this.temp < 7500) return 0xfff4ea;      // Class F: Warm White
        if (this.temp < 10000) return 0xf0f8ff;     // Class A: Blue-White
        if (this.temp < 30000) return 0x00d2ff;     // Class B: Cyan
        return 0x1e90ff;                            // Class O: Deep Blue
    }

    // Stellar evolution (Death sequences moved to separate module)

    resize() {
        if (!this.container) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width === 0 || height === 0) return; // Safeguard
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
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

        if (!this.isActive || window.AstrophysicsLab.activeTab !== 'stellar') return;

        this.controls.update();

        // Update Shader time uniform
        if (this.starMat.uniforms && this.starMat.uniforms.u_time) {
            this.starMat.uniforms.u_time.value += 0.012;
            this.starMat.uniforms.u_opacity.value = this.starMat.opacity;
        }
        
        // Update Corona volumetric uniforms
        if (this.coronaMat && this.coronaMat.uniforms && this.coronaMat.uniforms.u_time) {
            this.coronaMat.uniforms.u_time.value += 0.012;
            this.coronaMat.uniforms.u_isWolfRayet.value = (this.selectedExotic === 'wolf_rayet') ? 1.0 : 0.0;
        }

        // Rotate the star for realistic convection feeling
        if (this.state !== 'nebula' && this.state !== 'remanent') {
            this.starMesh.rotation.y += 0.006;
            this.starMesh.rotation.x += 0.002;
        }

        // 0. ANIMATE CORE FUSION AND CONVECTION PARTICLES
        if (this.showInternal && this.state === 'main_sequence') {
            this.animateInternalLayers();
        }

        // Update magnetic loops and flares
        if (this.state !== 'white_dwarf' && this.state !== 'remanent' && this.state !== 'nebula') {
            if (this.magneticLoops && this.magneticLoops.length > 0) {
                this.magneticLoopsGroup.visible = true;
                this.magneticLoops.forEach(loop => {
                    loop.progress += loop.speed;
                    if (loop.progress > 1.0) loop.progress = 0.0;
                    const pos = loop.curve.getPointAt(loop.progress);
                    loop.flare.position.copy(pos);
                });
                this.magneticLoopsGroup.rotation.y += 0.006;
                this.magneticLoopsGroup.rotation.x += 0.002;
            }
        } else {
            if (this.magneticLoopsGroup) {
                this.magneticLoopsGroup.visible = false;
            }
        }

        // Animate wind particles if Wolf-Rayet is active - Powered by Castor, Abbott & Klein (CAK) Theory
        if (this.selectedExotic === 'wolf_rayet' && this.windPoints) {
            const starRadius = Math.max(0.2, Math.min(this.radius * 0.7, 2.0));
            const posAttr = this.windPoints.geometry.attributes.position;
            const pos = posAttr.array;
            
            const v_inf = 0.055; // Terminal velocity constant in simulation space
            const beta = 0.8;    // CAK line acceleration factor
            
            for (let i = 0; i < this.windCount; i++) {
                const dx = this.windDirections[i*3];
                const dy = this.windDirections[i*3+1];
                const dz = this.windDirections[i*3+2];
                
                // CAK Velocity equation: v(r) = v_inf * (1.0 - R_star / r)^beta
                let curR = this.windRadii[i];
                let v_cak = v_inf * Math.pow(1.0 - (starRadius / Math.max(starRadius + 0.01, curR)), beta);
                v_cak = Math.max(0.005, v_cak); // clamp speed floor
                
                // Update position
                pos[i*3] += dx * v_cak;
                pos[i*3+1] += dy * v_cak;
                pos[i*3+2] += dz * v_cak;
                
                // Add winding helical rotation from magnetic twisting (MHD spiral)
                const rotSpeed = 0.02 / (curR / starRadius);
                const xOld = pos[i*3];
                const zOld = pos[i*3+2];
                pos[i*3] = xOld * Math.cos(rotSpeed) - zOld * Math.sin(rotSpeed);
                pos[i*3+2] = xOld * Math.sin(rotSpeed) + zOld * Math.cos(rotSpeed);
                
                // Accumulate distance
                this.windRadii[i] += v_cak;
                
                // Escape boundaries reset
                if (this.windRadii[i] > starRadius * 3.2) {
                    this.windRadii[i] = starRadius * (1.0 + Math.random() * 0.1);
                    pos[i*3] = dx * this.windRadii[i];
                    pos[i*3+1] = dy * this.windRadii[i];
                    pos[i*3+2] = dz * this.windRadii[i];
                }
            }
            posAttr.needsUpdate = true;
        }

        // Draw the HR Diagram at 30 FPS or when active
        this.drawHRDiagram();

        // Gentle pulse on main sequence
        if (this.state === 'main_sequence') {
            const scalePulse = 1.0 + Math.sin(performance.now() * 0.002) * 0.015;
            this.coronaMesh.scale.copy(this.starMesh.scale).multiplyScalar(1.05 * scalePulse);
        }
        
        // Sync dynamic scales to shaders for Raymarching precision
        if (this.coronaMat && this.coronaMat.uniforms && this.coronaMat.uniforms.u_coreRadius) {
            this.coronaMat.uniforms.u_coreRadius.value = this.starMesh.scale.x;
            this.coronaMat.uniforms.u_coronaRadius.value = 3.0 * this.coronaMesh.scale.x;
        }

        this.renderer.render(this.scene, this.camera);
    }

    animateInternalLayers() {
        const fract = (val) => val - Math.floor(val);
        // 1. Fusion Particles inside Core
        const fusionPos = this.fusionParticles.geometry.attributes.position.array;
        const fusionColors = this.fusionParticles.geometry.attributes.color.array;
        const scaleFactor = Math.max(0.2, Math.min(this.radius * 0.7, 2.0));

        for (let i = 0; i < this.fusionCount; i++) {
            const vel = this.fusionVelocities[i];
            
            // Move particles in local coordinates
            fusionPos[i*3] += vel.x * (this.cnoFraction > 0.5 ? 2.2 : 1.0);
            fusionPos[i*3+1] += vel.y * (this.cnoFraction > 0.5 ? 2.2 : 1.0);
            fusionPos[i*3+2] += vel.z * (this.cnoFraction > 0.5 ? 2.2 : 1.0);

            const dx = fusionPos[i*3];
            const dy = fusionPos[i*3+1];
            const dz = fusionPos[i*3+2];
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

            // Reached core center, trigger fusion!
            if (dist < 0.02 * scaleFactor) {
                // Reset to core border (r = 0.24 * scaleFactor)
                const r = 0.24 * scaleFactor;
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos((Math.random() * 2) - 1);
                
                fusionPos[i*3] = Math.sin(phi) * Math.cos(theta) * r;
                fusionPos[i*3+1] = Math.sin(phi) * Math.sin(theta) * r;
                fusionPos[i*3+2] = Math.cos(phi) * r;

                this.fusionVelocities[i].set(
                    -fusionPos[i*3],
                    -fusionPos[i*3+1],
                    -fusionPos[i*3+2]
                ).normalize().multiplyScalar(0.002 + Math.random() * 0.003);

                // Dynamically update colors based on p-p vs CNO Cycle
                if (this.cnoFraction > 0.5) {
                    // CNO Cycle: Carbon, Nitrogen, Oxygen and Hydrogen in flashy neon blues/purples
                    const cnoPalette = [
                        [0.0, 0.95, 1.0], // Blue-Cyan (Hydrogen)
                        [0.6, 0.1, 1.0], // Neon Purple (Carbon)
                        [1.0, 0.0, 0.8], // Magenta (Nitrogen)
                        [0.0, 1.0, 0.5]  // Emerald (Oxygen)
                    ];
                    const selectedColor = cnoPalette[Math.floor(Math.random() * cnoPalette.length)];
                    fusionColors[i*3] = selectedColor[0];
                    fusionColors[i*3+1] = selectedColor[1];
                    fusionColors[i*3+2] = selectedColor[2];
                } else {
                    // p-p Chain: Proton collisions (Red to Solar Yellow)
                    fusionColors[i*3] = 1.0;
                    fusionColors[i*3+1] = 0.4 + Math.random() * 0.5;
                    fusionColors[i*3+2] = 0.0;
                }
            }
        }
        this.fusionParticles.geometry.attributes.position.needsUpdate = true;
        this.fusionParticles.geometry.attributes.color.needsUpdate = true;

        // 2. Convection Toroidal Cells Currents (TZO Magnetospheric Dipole funnel override)
        const convPos = this.convectionParticles.geometry.attributes.position.array;
        
        // Thorne-Zytkow Object (TZO) Dipole Field Funneling Equations:
        // Envelope plasma is sucked along magnetic dipole field lines B(r) = (mu/r^3) * [3*n*(m.n) - m]
        const isTZO = (this.selectedExotic === 'tzo');
        const magneticAxis = new THREE.Vector3(0, 1, 0); // aligned with rot poles
        
        for (let i = 0; i < this.convectionCount; i++) {
            const state = this.convectionStates[i];
            
            if (isTZO) {
                // Advance convective fall cycle
                state.phase += state.speed * 0.65;
                state.theta += 0.015; // wrap around poles rapidly
                
                // Spherical collapse coordinates
                const r_outer = 1.0 * scaleFactor;
                const r_ns = 0.08 * scaleFactor; // Neutron star radius limit
                
                // Gravity sucks envelope plasma from outer shell to inner NS boundary
                const radialPos = r_outer - (r_outer - r_ns) * (fract(state.phase / (Math.PI * 2.0)));
                
                // Funnel along magnetic field line coordinates. Dipole equation:
                // sin^2(lat) / r = constant => lat = asin(sqrt(r / r_max))
                const maxR = r_outer;
                const lat = Math.asin(Math.sqrt(radialPos / maxR));
                
                // Alternating poles routing (funnel into north pole vs south pole)
                const hemisphere = (i % 2 === 0) ? 1.0 : -1.0;
                
                // Coordinates mapping Lorentz dipole helical spiral
                const x = Math.cos(lat * hemisphere) * Math.cos(state.theta) * radialPos;
                const y = Math.sin(lat * hemisphere) * radialPos;
                const z = Math.cos(lat * hemisphere) * Math.sin(state.theta) * radialPos;
                
                convPos[i*3] = x;
                convPos[i*3+1] = y;
                convPos[i*3+2] = z;
            } else {
                // Bénard Convective Toroidal scaling cell math
                state.phase += state.speed;
                state.theta += 0.003; // rotate around polar axis

                const r_inner = 0.65 * scaleFactor;
                const r_outer = 1.0 * scaleFactor;
                const radialSpan = r_outer - r_inner;
                
                // Radius goes in loop from inner to outer boundary
                const r = r_inner + (radialSpan * (Math.sin(state.phase) + 1.0) / 2.0);
                
                const x = Math.cos(state.yAngle) * Math.cos(state.theta) * r;
                const y = Math.sin(state.yAngle) * r;
                const z = Math.cos(state.yAngle) * Math.sin(state.theta) * r;

                convPos[i*3] = x;
                convPos[i*3+1] = y;
                convPos[i*3+2] = z;
            }
        }
        this.convectionParticles.geometry.attributes.position.needsUpdate = true;

        // Pulsate the core sphere for realism (neutron core override for TZO)
        if (this.selectedExotic === 'tzo') {
            this.coreMesh.material.color.setHex(0x00ffff);
            if (this.coreMesh.material.emissive !== undefined) {
                this.coreMesh.material.emissive.setHex(0x00ffff);
                this.coreMesh.material.emissiveIntensity = 2.5;
            }
            // Pulsate extremely fast to represent a high-rotation degenerate neutron core
            const tzoScale = scaleFactor * 0.12 * (1.0 + Math.sin(performance.now() * 0.12) * 0.15);
            this.coreMesh.scale.setScalar(tzoScale);
        } else {
            if (this.coreMesh.material.color) {
                this.coreMesh.material.color.setHex(0xffffff);
            }
            if (this.coreMesh.material.emissive !== undefined) {
                this.coreMesh.material.emissive.setHex(0x000000);
            }
            const coreScale = scaleFactor * (1.0 + Math.sin(performance.now() * 0.015) * 0.04);
            this.coreMesh.scale.setScalar(coreScale);
        }
        
        const radScale = scaleFactor;
        this.radiativeMesh.scale.setScalar(radScale);
    }

}

// Instantiate
new StellarSimulation();
