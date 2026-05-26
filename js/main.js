// ASTROPHYSICS LAB - MAIN CONTROL SYSTEM
document.addEventListener("DOMContentLoaded", () => {
    initStarfield();
    initTabs();
    initFPSCounter();
});

// Global State
window.AstrophysicsLab = {
    activeTab: 'kepler',
    simulations: {}, // Will store references to active simulation instances
    isPaused: false
};

// 1. Dynamic Particle Starfield Background
function initStarfield() {
    const canvas = document.getElementById("starfield-canvas");
    const ctx = canvas.getContext("2d");
    
    let stars = [];
    const starCount = 150;
    
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        generateStars();
    }
    
    function generateStars() {
        stars = [];
        for (let i = 0; i < starCount; i++) {
            stars.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                radius: Math.random() * 1.5,
                color: getRandomStarColor(),
                twinkleSpeed: 0.005 + Math.random() * 0.015,
                phase: Math.random() * Math.PI * 2
            });
        }
    }
    
    function getRandomStarColor() {
        const colors = [
            'rgba(255, 255, 255, ',
            'rgba(173, 216, 230, ', // Light Blue
            'rgba(255, 244, 234, ', // Soft Warm White
            'rgba(255, 224, 189, '  // Soft Orange
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    function animateStars() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        stars.forEach(star => {
            star.phase += star.twinkleSpeed;
            const alpha = 0.2 + (Math.sin(star.phase) + 1) * 0.4; // Twinkling effect
            ctx.fillStyle = star.color + alpha + ')';
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctx.fill();
        });
        
        requestAnimationFrame(animateStars);
    }
    
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
    animateStars();
}

// 2. Tab Navigation & Simulation Toggling
function initTabs() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const simulationViews = document.querySelectorAll(".simulation-view");
    const lobbyCards = document.querySelectorAll(".lobby-card");
    
    function switchTab(targetTab) {
        // Update Active Buttons in Nav Header
        tabButtons.forEach(btn => {
            btn.classList.remove("active");
            if (btn.getAttribute("data-tab") === targetTab) {
                btn.classList.add("active");
            }
        });
        
        // Switch Views
        simulationViews.forEach(view => {
            view.classList.remove("active");
            if (view.id === `tab-${targetTab}`) {
                view.classList.add("active");
            }
        });
        
        // Update global state active tracker
        const oldTab = window.AstrophysicsLab.activeTab;
        window.AstrophysicsLab.activeTab = targetTab;
        
        // Notify respective simulation objects of the tab change
        Object.keys(window.AstrophysicsLab.simulations).forEach(key => {
            const sim = window.AstrophysicsLab.simulations[key];
            if (key === targetTab) {
                if (sim && typeof sim.resume === 'function') {
                    // Small delay to ensure the display transition is computed and width > 0
                    setTimeout(() => {
                        sim.resume();
                    }, 50);
                }
            } else {
                if (sim && typeof sim.pause === 'function') {
                    sim.pause();
                }
            }
        });
        
        // Auto resize triggers for Three.js renderers
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 150);
    }
    
    // Header Nav clicks
    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            const targetTab = button.getAttribute("data-tab");
            switchTab(targetTab);
        });
    });

    // Lobby Cards clicks
    lobbyCards.forEach(card => {
        card.addEventListener("click", () => {
            const targetTab = card.getAttribute("data-tab");
            switchTab(targetTab);
        });
    });
}

// 3. FPS Monitoring System
function initFPSCounter() {
    const counterEl = document.getElementById("fps-counter");
    let lastTime = performance.now();
    let frameCount = 0;
    
    function updateFPS() {
        const now = performance.now();
        frameCount++;
        
        if (now - lastTime >= 1000) {
            const fps = Math.round((frameCount * 1000) / (now - lastTime));
            counterEl.textContent = fps;
            frameCount = 0;
            lastTime = now;
            
            // Colorize based on performance
            if (fps >= 55) {
                counterEl.style.color = 'var(--accent-cyan)';
            } else if (fps >= 30) {
                counterEl.style.color = 'var(--accent-yellow)';
            } else {
                counterEl.style.color = 'var(--accent-red)';
            }
        }
        requestAnimationFrame(updateFPS);
    }
    updateFPS();
}

// Global utility for scientific formatting
window.formatScientific = function(value, decimals = 2) {
    if (value === 0) return "0";
    const absValue = Math.abs(value);
    if (absValue >= 1e6 || absValue < 1e-3) {
        return value.toExponential(decimals);
    }
    return value.toFixed(decimals);
};
