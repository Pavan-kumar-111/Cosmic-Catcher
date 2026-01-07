/**
 * COSMIC CATCHER
 * Core Game Logic
 */

// --- CONFIGURATION ---
const CONFIG = {
    colors: {
        bg: '#050b14',
        player: '#00f3ff', // Cyan
        playerBody: '#1a2a40',
        playerAccent: '#00ccff',
        engine: '#ff9900',
        asteroid: '#5c5c5c', // Grey
        asteroidDetails: '#3b3b3b',
        safe: [
            { color: '#4CC9F0', score: 1, type: 'Planet', radius: 16 },     // Blue Planet (Generic/Ice)
            { color: '#1E88E5', score: 5, type: 'Earth', radius: 18 },      // Earth (New! Rare & High Score)
            { color: '#E0E1DD', score: 1, type: 'Moon', radius: 10 },       // Grey/White Moon
            { color: '#FFD166', score: 2, type: 'Star', radius: 9 },        // Yellow/Orange Star
            { color: '#7209B7', score: 3, type: 'Galaxy', radius: 14 }      // Purple Galaxy
        ]
    },
    player: {
        width: 60,
        height: 60,
        yOffset: 100, // Distance from bottom
        speedLerp: 0.15 // Smoothness factor
    },
    difficulty: {
        initialSpeed: 4,
        speedCap: 15,
        speedIncrement: 0.3,
        spawnRateInitial: 50,
        spawnRateMin: 15,
        asteroidChanceBase: 0.1,
        asteroidChanceMax: 0.5
    }
};

// --- GAME STATE ENUMS ---
const STATE = {
    IDLE: 'IDLE',
    PLAYING: 'PLAYING',
    GAMEOVER: 'GAMEOVER'
};

// --- OPTIMIZATION: OBJECT POOLING ---
const Pool = {
    objects: [],
    particles: [],

    // Pre-allocate pools
    init: function () {
        for (let i = 0; i < 50; i++) this.objects.push({ active: false });
        for (let i = 0; i < 100; i++) this.particles.push({ active: false });
    },

    get: function (type) {
        let pool = type === 'object' ? this.objects : this.particles;
        for (let i = 0; i < pool.length; i++) {
            if (!pool[i].active) {
                pool[i].active = true;
                return pool[i];
            }
        }
        // Expand if full (rare)
        let newItem = { active: true };
        pool.push(newItem);
        return newItem;
    },

    reset: function () {
        this.objects.forEach(o => o.active = false);
        this.particles.forEach(p => p.active = false);
    }
};

// --- AUDIO SYSTEM ---
const AudioSys = {
    ctx: null,
    masterGain: null,
    filter: null,

    init: function () {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.5;
            this.filter = this.ctx.createBiquadFilter();
            this.filter.type = 'lowpass';
            this.filter.frequency.value = 800;
            this.masterGain.connect(this.filter);
            this.filter.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    },

    playTone: function (freq, type, duration, vol = 0.1) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.value = freq;
        osc.type = type;
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },

    playStart: function () {
        this.playTone(440, 'sine', 0.6, 0.2);
        setTimeout(() => this.playTone(660, 'sine', 0.6, 0.2), 150);
    },
    playCollect: function () {
        const notes = [523.25, 587.33, 659.25, 783.99, 880.00];
        const note = notes[Math.floor(Math.random() * notes.length)];
        this.playTone(note, 'sine', 0.3, 0.1);
    },
    playGameOver: function () {
        this.playTone(150, 'triangle', 1.0, 0.3);
    },

    startMusic: function () {
        if (!soundEnabled || !this.ctx) return;
        this.stopMusic();
        this.ambientLoop();
    },

    stopMusic: function () {
        if (this.humTimer) clearTimeout(this.humTimer);
    },

    humTimer: null,
    ambientLoop: function () {
        if (!soundEnabled) return;
        if (Math.random() > 0.6) {
            const root = 130.81;
            const intervals = [1.0, 1.33, 1.5, 2.0];
            const mult = intervals[Math.floor(Math.random() * intervals.length)];
            this.playTone(root * mult, 'sine', 4.0, 0.05);
        }
        this.humTimer = setTimeout(() => this.ambientLoop(), 3000);
    }
};

// --- GLOBAL VARIABLES ---
let canvas, ctx;
let width, height;
let gameState = STATE.IDLE;
let score = 0;
let animationId;
let frames = 0;
let currentDifficulty = {
    speed: CONFIG.difficulty.initialSpeed,
    spawnRate: CONFIG.difficulty.spawnRateInitial,
    asteroidChance: CONFIG.difficulty.asteroidChanceBase
};

// Controls
let input = { x: 0 };
let keys = { left: false, right: false }; // Keyboard state
let soundEnabled = true;

// Player Entity
let player = {
    x: 0,
    y: 0,
    width: CONFIG.player.width,
    height: CONFIG.player.height,
    thrusterFrame: 0
};

// DOM Elements
const ui = {
    start: document.getElementById('screen-start'),
    gameOver: document.getElementById('screen-gameover'),
    score: document.getElementById('score-display'),
    finalScore: document.getElementById('final-score'),
    btnRestart: document.getElementById('btn-restart'),
    btnSound: document.getElementById('btn-sound'),
    btnVibe: document.getElementById('btn-vibe') // Kept for UI but logic simplified
};

// --- INITIALIZATION ---
function init() {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d', { alpha: false }); // Optimize: No alpha on canvas buffer

    Pool.init();
    resize();
    window.addEventListener('resize', resize);

    // Bind Inputs
    setupInputs();

    // Initial State
    gameState = STATE.IDLE;
    input.x = width / 2;
    player.x = width / 2;
    loop();
}

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    // Position player
    player.y = height - CONFIG.player.yOffset;
}

function setupInputs() {
    const handleStart = (e) => {
        // Audio Context cannot be started/resumed without user gesture
        // We do it here on the first interaction
        AudioSys.init();
        if (gameState !== STATE.PLAYING) {
            startGame();
        }
    };

    ui.start.addEventListener('click', handleStart);
    ui.btnRestart.addEventListener('click', handleStart);

    ui.btnSound.addEventListener('click', (e) => {
        e.stopPropagation();
        soundEnabled = !soundEnabled;
        ui.btnSound.textContent = soundEnabled ? '🔊' : '🔇';

        if (soundEnabled && gameState === STATE.PLAYING) {
            AudioSys.startMusic();
        } else {
            AudioSys.stopMusic();
        }
    });

    // Touch/Mouse Tracking
    const moveHandler = (x) => {
        if (gameState === STATE.PLAYING) {
            input.x = x;
        }
    };

    window.addEventListener('mousemove', e => moveHandler(e.clientX));
    window.addEventListener('touchmove', e => {
        e.preventDefault();
        moveHandler(e.touches[0].clientX);
    }, { passive: false });

    window.addEventListener('touchstart', e => {
        if (gameState === STATE.PLAYING) moveHandler(e.touches[0].clientX);
    }, { passive: true });

    // Keyboard Controls
    window.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    });

    window.addEventListener('keyup', e => {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
    });
}

// --- GAMEPLAY CONTROL ---
function startGame() {
    if (gameState === STATE.PLAYING) return;

    if (soundEnabled) AudioSys.playStart();

    gameState = STATE.PLAYING;
    score = 0;
    frames = 0;

    Pool.reset();

    currentDifficulty = {
        speed: CONFIG.difficulty.initialSpeed,
        spawnRate: CONFIG.difficulty.spawnRateInitial,
        asteroidChance: CONFIG.difficulty.asteroidChanceBase
    };

    player.x = width / 2;
    input.x = width / 2;

    updateUI();

    if (soundEnabled) AudioSys.startMusic();
}

function gameOver() {
    gameState = STATE.GAMEOVER;
    if (soundEnabled) AudioSys.playGameOver();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    AudioSys.stopMusic();
    updateUI();
}

function updateUI() {
    ui.score.innerText = score;
    ui.finalScore.innerText = score;

    if (gameState === STATE.IDLE) {
        ui.start.classList.remove('hidden');
        ui.gameOver.classList.add('hidden');
    } else if (gameState === STATE.PLAYING) {
        ui.start.classList.add('hidden');
        ui.gameOver.classList.add('hidden');
    } else if (gameState === STATE.GAMEOVER) {
        ui.gameOver.classList.remove('hidden');
    }
}

// --- MAIN LOOP ---
function loop() {
    // Clear
    ctx.fillStyle = CONFIG.colors.bg;
    ctx.fillRect(0, 0, width, height);

    if (gameState === STATE.PLAYING) {
        update();
    }

    // Draw everything (even in Game Over)
    draw();

    animationId = requestAnimationFrame(loop);
}

function update() {
    frames++;
    player.thrusterFrame += 0.5;

    // 1. Spawner
    if (frames % Math.floor(currentDifficulty.spawnRate) === 0) {
        spawnObject();
    }

    // 2. Player Movement
    // Handle Keyboard overrides
    if (keys.left) input.x -= 15;
    if (keys.right) input.x += 15;
    input.x = Math.max(player.width / 2, Math.min(width - player.width / 2, input.x));

    let targetX = input.x; // Already clamped
    player.x += (targetX - player.x) * CONFIG.player.speedLerp;

    // 3. Object Updates
    // Iterate main pool for active objects
    for (let i = 0; i < Pool.objects.length; i++) {
        let obj = Pool.objects[i];
        if (!obj.active) continue;

        obj.y += obj.speed;
        obj.angle = (obj.angle || 0) + (obj.rotationSpeed || 0);

        // Cleanup
        if (obj.y - obj.radius > height) {
            obj.active = false;
            continue;
        }

        // Collision: Circle vs Point(ish)
        // Check simply if distance < radius + player_hitbox_size
        let dx = Math.abs(obj.x - player.x);
        let dy = Math.abs(obj.y - (player.y + player.height / 2)); // Center of player

        // Horizontal hit logic (simple box approx)
        if (dx < (player.width / 2 + obj.radius) && dy < (player.height / 2 + obj.radius)) {
            handleCollision(obj);
            obj.active = false;
            createParticles(obj.x, obj.y, obj.color);
        }
    }

    // 4. Particles
    for (let i = 0; i < Pool.particles.length; i++) {
        let p = Pool.particles[i];
        if (!p.active) continue;

        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05;
        if (p.life <= 0) p.active = false;
    }
}

function spawnObject() {
    let obj = Pool.get('object');
    let isAsteroid = Math.random() < currentDifficulty.asteroidChance;

    obj.x = Math.random() * (width - 40) + 20;
    obj.y = -50;
    obj.speed = currentDifficulty.speed * (0.8 + Math.random() * 0.4);
    obj.isAsteroid = isAsteroid;
    obj.angle = Math.random() * Math.PI * 2;
    obj.rotationSpeed = (Math.random() - 0.5) * 0.1;

    if (isAsteroid) {
        obj.type = 'Asteroid';
        obj.color = CONFIG.colors.asteroid;
        obj.radius = 25;
        obj.score = 0;
    } else {
        const typeData = CONFIG.colors.safe[Math.floor(Math.random() * CONFIG.colors.safe.length)];
        obj.type = typeData.type;
        obj.color = typeData.color;
        obj.radius = typeData.radius;
        obj.score = typeData.score;

        // Faster spin for stars/galaxies
        if (obj.type === 'Star') obj.rotationSpeed *= 2;
    }
}

function handleCollision(obj) {
    if (obj.isAsteroid) {
        gameOver();
    } else {
        score += obj.score;
        increaseDifficulty();
        if (soundEnabled) AudioSys.playCollect();
        if (navigator.vibrate) navigator.vibrate(30);
        updateUI();
    }
}

function increaseDifficulty() {
    if (score % 5 === 0) {
        currentDifficulty.speed = Math.min(CONFIG.difficulty.speedCap, currentDifficulty.speed + CONFIG.difficulty.speedIncrement);
        currentDifficulty.spawnRate = Math.max(CONFIG.difficulty.spawnRateMin, currentDifficulty.spawnRate - 2);
        currentDifficulty.asteroidChance = Math.min(CONFIG.difficulty.asteroidChanceMax, currentDifficulty.asteroidChance + 0.02);
    }
}

function createParticles(x, y, color) {
    for (let i = 0; i < 8; i++) {
        let p = Pool.get('particle');
        p.x = x;
        p.y = y;
        p.vx = (Math.random() - 0.5) * 8;
        p.vy = (Math.random() - 0.5) * 8;
        p.life = 1.0;
        p.color = color;
    }
}

// --- RENDERING ---
function draw() {
    // 1. Draw Player (Detailed Spaceship)
    drawPlayer();

    // 2. Draw Objects
    drawObjects();

    // 3. Draw Particles
    drawParticles();

    // 4. Idle Screen Animation
    if (gameState === STATE.IDLE) drawIdleElements();
}

function drawPlayer() {
    const cx = player.x;
    const cy = player.y;
    const w = player.width;
    const h = player.height;

    ctx.save();
    ctx.translate(cx, cy);

    // Engine Flame (Animated)
    const flicker = Math.sin(player.thrusterFrame) * 5;
    ctx.fillStyle = CONFIG.colors.engine;
    ctx.beginPath();
    ctx.moveTo(-10, h);
    ctx.lineTo(10, h);
    ctx.lineTo(0, h + 20 + flicker);
    ctx.fill();

    // Wings (Main Body)
    ctx.fillStyle = CONFIG.colors.playerBody;
    ctx.beginPath();
    ctx.moveTo(0, 0); // Nose
    ctx.lineTo(w / 2, h); // Right Wing Tip
    ctx.lineTo(0, h - 10); // Center Engine Notch
    ctx.lineTo(-w / 2, h); // Left Wing Tip
    ctx.closePath();
    ctx.fill();

    // Cockpit / Detail
    ctx.fillStyle = CONFIG.colors.playerAccent;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(10, 40);
    ctx.lineTo(-10, 40);
    ctx.closePath();
    ctx.fill();

    // Side Accents
    ctx.strokeStyle = CONFIG.colors.player;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w / 4, k = 30);
    ctx.lineTo(-w / 2, h);
    ctx.moveTo(w / 4, 30);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    ctx.restore();
}

function drawObjects() {
    for (let i = 0; i < Pool.objects.length; i++) {
        let obj = Pool.objects[i];
        if (!obj.active) continue;

        ctx.save();
        ctx.translate(obj.x, obj.y);
        ctx.rotate(obj.angle || 0);
        // Note: Drawing is now relative to (0,0) after translate

        if (obj.isAsteroid) {
            // Asteroid
            ctx.shadowBlur = 0;
            ctx.fillStyle = obj.color;
            ctx.beginPath();
            ctx.arc(0, 0, obj.radius, 0, Math.PI * 2);
            ctx.fill();

            // Craters (Asteroid) - Static relative to asteroid body
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath();
            ctx.arc(-obj.radius * 0.3, -obj.radius * 0.3, obj.radius * 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(obj.radius * 0.4, obj.radius * 0.2, obj.radius * 0.2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Base Glow
            ctx.shadowBlur = 10;
            ctx.shadowColor = obj.color;

            if (obj.type === 'Planet') {
                // Planet Body (Gradient)
                // Use solid color for gradient base to avoid complex relative coords with gradient
                ctx.fillStyle = obj.color;
                ctx.beginPath();
                ctx.arc(0, 0, obj.radius, 0, Math.PI * 2);
                ctx.fill();

                // Shadow for 3D effect
                ctx.fillStyle = 'rgba(0,0,0,0.2)';
                ctx.beginPath();
                ctx.arc(0, 0, obj.radius, 0, Math.PI, false);
                ctx.fill();

                // Ring
                ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.ellipse(0, 0, obj.radius * 1.6, obj.radius * 0.5, -0.3, 0, Math.PI * 2);
                ctx.stroke();

            } else if (obj.type === 'Earth') {
                // Ocean
                ctx.fillStyle = obj.color; // Blue
                ctx.beginPath();
                ctx.arc(0, 0, obj.radius, 0, Math.PI * 2);
                ctx.fill();

                // Continents (Green blobs)
                ctx.fillStyle = '#43A047';
                ctx.save();
                ctx.beginPath();
                ctx.arc(0, 0, obj.radius, 0, Math.PI * 2);
                ctx.clip(); // Clip to sphere

                // Draw some random shapes for land
                ctx.beginPath(); ctx.arc(-5, -5, 8, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(8, 2, 6, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(2, 9, 5, 0, Math.PI * 2); ctx.fill();

                ctx.restore();

                // Atmosphere Glow
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, obj.radius + 1, 0, Math.PI * 2);
                ctx.stroke();

            } else if (obj.type === 'Moon') {
                // Moon Body
                ctx.fillStyle = obj.color;
                ctx.beginPath();
                ctx.arc(0, 0, obj.radius, 0, Math.PI * 2);
                ctx.fill();
                // Moon Craters
                ctx.fillStyle = 'rgba(0,0,0,0.15)';
                ctx.beginPath(); ctx.arc(-3, -3, 3, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(4, 2, 2, 0, Math.PI * 2); ctx.fill();

            } else if (obj.type === 'Star') {
                // Star Glow
                ctx.shadowBlur = 20;
                ctx.shadowColor = '#ffe600';

                // Star Body
                ctx.fillStyle = '#fffbe6';
                ctx.beginPath();
                ctx.arc(0, 0, obj.radius * 0.6, 0, Math.PI * 2);
                ctx.fill();

                // Spikes/Flare
                ctx.fillStyle = obj.color;
                ctx.beginPath();
                for (let k = 0; k < 4; k++) {
                    ctx.rotate(Math.PI / 2);
                    ctx.moveTo(0, -obj.radius * 0.5);
                    ctx.quadraticCurveTo(2, 0, 0, obj.radius * 1.8);
                    ctx.quadraticCurveTo(-2, 0, 0, -obj.radius * 0.5);
                }
                ctx.fill();

            } else if (obj.type === 'Galaxy') {
                // Spiral Core
                ctx.shadowBlur = 15;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();

                // Spiral Arms
                ctx.strokeStyle = obj.color;
                ctx.lineWidth = 2;
                ctx.shadowBlur = 5;

                // Extra rotation for galaxy life
                ctx.rotate(frames * 0.05);

                for (let k = 0; k < 2; k++) {
                    ctx.beginPath();
                    ctx.ellipse(0, 0, obj.radius, obj.radius * 0.4, k * Math.PI, 0, Math.PI * 1.25);
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
    }
}

function drawParticles() {
    for (let i = 0; i < Pool.particles.length; i++) {
        let p = Pool.particles[i];
        if (!p.active) continue;

        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.life * 4), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

function drawIdleElements() {
    ctx.fillStyle = '#ffffff';
    // Use the frames counter to create a simple starfield effect
    for (let i = 0; i < 30; i++) {
        let speed = (i % 5) + 1;
        let y = (frames * speed + i * 50) % height;
        let x = (i * 87) % width;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1.0;
}

// Boot
window.onload = init;
