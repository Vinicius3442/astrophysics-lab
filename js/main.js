// PHYSICS BOX - MAIN SHARED SYSTEM
document.addEventListener("DOMContentLoaded", () => {
    // Only init starfield on home page or if specifically requested
    if (document.getElementById("starfield-canvas")) {
        initStarfield();
    }
    
    if (document.getElementById("fps-counter")) {
        initFPSCounter();
    }
    
    
    // Home Page Search Logic
    const homeSearch = document.getElementById("neal-home-search");
    if (homeSearch) {
        homeSearch.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase();
            const cards = document.querySelectorAll(".neal-card");
            cards.forEach(card => {
                const title = card.querySelector("h2") ? card.querySelector("h2").textContent.toLowerCase() : "";
                // also check href for keywords
                const href = card.getAttribute("href") || "";
                if (title.includes(query) || href.includes(query)) {
                    card.style.display = "flex";
                } else {
                    card.style.display = "none";
                }
            });
        });
    }

    // Set global tab based on pathname for legacy compatibility in modules
    const path = window.location.pathname;
    if (path.includes("kepler")) window.AstrophysicsLab.activeTab = "kepler";
    else if (path.includes("stellar")) window.AstrophysicsLab.activeTab = "stellar";
    else if (path.includes("blackhole")) window.AstrophysicsLab.activeTab = "blackhole";
    else if (path.includes("pulsar")) window.AstrophysicsLab.activeTab = "pulsar";
    else if (path.includes("supernova")) window.AstrophysicsLab.activeTab = "supernova";
    else if (path.includes("galaxy")) window.AstrophysicsLab.activeTab = "galaxy";
    else window.AstrophysicsLab.activeTab = "lobby";
});

// Global State
window.AstrophysicsLab = {
    activeTab: 'lobby',
    simulations: {},
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
            'rgba(173, 216, 230, ',
            'rgba(255, 244, 234, ',
            'rgba(255, 224, 189, '
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    function animateStars() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        stars.forEach(star => {
            star.phase += star.twinkleSpeed;
            const alpha = 0.2 + (Math.sin(star.phase) + 1) * 0.4;
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

// 2. FPS Monitoring System
function initFPSCounter() {
    const counterEl = document.getElementById("fps-counter");
    if (!counterEl) return;
    
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
            
            if (fps >= 55) counterEl.style.color = 'var(--accent-cyan)';
            else if (fps >= 30) counterEl.style.color = 'var(--accent-yellow)';
            else counterEl.style.color = 'var(--accent-red)';
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
