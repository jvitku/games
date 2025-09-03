class KidsSpaceAdventure {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.socket = io();
        
        // Game state
        this.gameState = 'menu';
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.timeLeft = 120;
        this.gameTimer = null;
        
        // Three.js setup
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        
        // Game objects
        this.player = null;
        this.enemies = [];
        this.collectibles = [];
        this.particles = [];
        this.stars = [];
        
        // Player control
        this.ballPosition = { x: 0.5, y: 0.5 };
        this.targetPosition = { x: 0, y: 0, z: 0 };
        
        // Animation mixers
        this.mixers = [];
        
        this.init3DScene();
        this.createPlayer();
        this.createEnvironment();
        this.initEventListeners();
        this.animate();
    }
    
    init3DScene() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a2e);
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000);
        this.camera.position.set(0, 5, 10);
        this.camera.lookAt(0, 0, 0);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: true 
        });
        this.renderer.setSize(800, 600);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Lights
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 10, 5);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
        
        // Colorful point lights for ambiance
        const colors = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0xf0932b];
        for (let i = 0; i < colors.length; i++) {
            const light = new THREE.PointLight(colors[i], 0.5, 30);
            light.position.set(
                Math.sin(i * Math.PI * 2 / colors.length) * 15,
                5 + Math.sin(i) * 3,
                Math.cos(i * Math.PI * 2 / colors.length) * 15
            );
            this.scene.add(light);
        }
    }
    
    createPlayer() {
        // Create a cute spaceship/rocket for kids
        const group = new THREE.Group();
        
        // Main body (cone)
        const bodyGeometry = new THREE.ConeGeometry(1, 3, 8);
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x4ecdc4 });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 1.5;
        body.castShadow = true;
        group.add(body);
        
        // Nose cone
        const noseGeometry = new THREE.ConeGeometry(0.5, 1, 8);
        const noseMaterial = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
        const nose = new THREE.Mesh(noseGeometry, noseMaterial);
        nose.position.y = 3.5;
        nose.castShadow = true;
        group.add(nose);
        
        // Wings
        const wingGeometry = new THREE.BoxGeometry(0.3, 0.1, 2);
        const wingMaterial = new THREE.MeshLambertMaterial({ color: 0xf9ca24 });
        
        const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
        leftWing.position.set(-1.2, 0.5, 0);
        leftWing.castShadow = true;
        group.add(leftWing);
        
        const rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
        rightWing.position.set(1.2, 0.5, 0);
        rightWing.castShadow = true;
        group.add(rightWing);
        
        // Engine glow
        const engineGeometry = new THREE.CylinderGeometry(0.3, 0.5, 0.5, 8);
        const engineMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xff4757,
            emissive: 0xff4757,
            emissiveIntensity: 0.3
        });
        const engine = new THREE.Mesh(engineGeometry, engineMaterial);
        engine.position.y = -0.5;
        group.add(engine);
        
        // Cute eyes
        const eyeGeometry = new THREE.SphereGeometry(0.2, 16, 16);
        const eyeMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-0.3, 2.5, 0.8);
        group.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(0.3, 2.5, 0.8);
        group.add(rightEye);
        
        // Eye pupils
        const pupilGeometry = new THREE.SphereGeometry(0.1, 16, 16);
        const pupilMaterial = new THREE.MeshLambertMaterial({ color: 0x000000 });
        
        const leftPupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
        leftPupil.position.set(-0.3, 2.5, 0.9);
        group.add(leftPupil);
        
        const rightPupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
        rightPupil.position.set(0.3, 2.5, 0.9);
        group.add(rightPupil);
        
        // Position player
        group.position.set(0, 0, 0);
        this.scene.add(group);
        this.player = group;
        
        // Store references for animation
        this.playerParts = {
            body: body,
            nose: nose,
            leftWing: leftWing,
            rightWing: rightWing,
            engine: engine,
            leftEye: leftEye,
            rightEye: rightEye,
            leftPupil: leftPupil,
            rightPupil: rightPupil
        };
    }
    
    createEnvironment() {
        // Create animated starfield
        const starGeometry = new THREE.BufferGeometry();
        const starPositions = [];
        const starColors = [];
        
        for (let i = 0; i < 1000; i++) {
            starPositions.push(
                (Math.random() - 0.5) * 200,
                (Math.random() - 0.5) * 200,
                (Math.random() - 0.5) * 200
            );
            
            const color = new THREE.Color();
            color.setHSL(Math.random(), 0.5, 0.8);
            starColors.push(color.r, color.g, color.b);
        }
        
        starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
        starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
        
        const starMaterial = new THREE.PointsMaterial({ 
            size: 0.5, 
            vertexColors: true,
            transparent: true,
            opacity: 0.8
        });
        
        this.stars = new THREE.Points(starGeometry, starMaterial);
        this.scene.add(this.stars);
        
        // Create floating planets/collectibles
        this.createCollectibles();
        
        // Create some enemies
        this.createEnemies();
        
        // Create particle systems
        this.createParticleSystem();
    }
    
    createCollectibles() {
        const colors = [0xf9ca24, 0xf0932b, 0xeb4d4b, 0x6c5ce7, 0xa29bfe];
        
        for (let i = 0; i < 10; i++) {
            const geometry = new THREE.OctahedronGeometry(0.5, 1);
            const material = new THREE.MeshLambertMaterial({ 
                color: colors[Math.floor(Math.random() * colors.length)],
                emissive: colors[Math.floor(Math.random() * colors.length)],
                emissiveIntensity: 0.2
            });
            
            const collectible = new THREE.Mesh(geometry, material);
            collectible.position.set(
                (Math.random() - 0.5) * 30,
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 30
            );
            collectible.castShadow = true;
            
            // Add floating animation
            collectible.userData = {
                originalY: collectible.position.y,
                floatSpeed: Math.random() * 2 + 1
            };
            
            this.scene.add(collectible);
            this.collectibles.push(collectible);
        }
    }
    
    createEnemies() {
        for (let i = 0; i < 5; i++) {
            const group = new THREE.Group();
            
            // Enemy body (sphere)
            const bodyGeometry = new THREE.SphereGeometry(0.8, 16, 16);
            const bodyMaterial = new THREE.MeshLambertMaterial({ 
                color: 0xff4757,
                emissive: 0x330000,
                emissiveIntensity: 0.1
            });
            const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
            body.castShadow = true;
            group.add(body);
            
            // Enemy spikes
            for (let j = 0; j < 8; j++) {
                const spikeGeometry = new THREE.ConeGeometry(0.1, 0.5, 4);
                const spikeMaterial = new THREE.MeshLambertMaterial({ color: 0x2f1b14 });
                const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
                
                const angle = (j / 8) * Math.PI * 2;
                spike.position.set(
                    Math.sin(angle) * 0.8,
                    Math.cos(angle) * 0.3,
                    Math.cos(angle) * 0.8
                );
                spike.lookAt(
                    Math.sin(angle) * 2,
                    Math.cos(angle) * 0.6,
                    Math.cos(angle) * 2
                );
                group.add(spike);
            }
            
            group.position.set(
                (Math.random() - 0.5) * 40,
                (Math.random() - 0.5) * 20,
                -20 - Math.random() * 20
            );
            
            // Add movement pattern
            group.userData = {
                speed: Math.random() * 2 + 1,
                direction: Math.random() * Math.PI * 2,
                bobSpeed: Math.random() * 3 + 1
            };
            
            this.scene.add(group);
            this.enemies.push(group);
        }
    }
    
    createParticleSystem() {
        // Engine trail particles
        const trailGeometry = new THREE.BufferGeometry();
        const trailPositions = [];
        const trailColors = [];
        
        for (let i = 0; i < 100; i++) {
            trailPositions.push(0, 0, 0);
            trailColors.push(1, 0.5, 0);
        }
        
        trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(trailPositions, 3));
        trailGeometry.setAttribute('color', new THREE.Float32BufferAttribute(trailColors, 3));
        
        const trailMaterial = new THREE.PointsMaterial({
            size: 0.3,
            vertexColors: true,
            transparent: true,
            opacity: 0.8
        });
        
        this.engineTrail = new THREE.Points(trailGeometry, trailMaterial);
        this.scene.add(this.engineTrail);
    }
    
    initEventListeners() {
        document.getElementById('startBtn').addEventListener('click', () => this.startGame());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetGame());
        
        this.socket.on('ball-position', (data) => {
            this.ballPosition = data;
            if (this.gameState === 'playing') {
                this.updatePlayerFromBall(data);
            }
        });
    }
    
    updatePlayerFromBall(ballPos) {
        if (!this.player) return;
        
        // Map ball position to 3D space
        this.targetPosition.x = (ballPos.x - 0.5) * 20; // -10 to +10
        this.targetPosition.y = (ballPos.y - 0.5) * 15; // -7.5 to +7.5
        this.targetPosition.z = 0;
    }
    
    startGame() {
        this.gameState = 'playing';
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.timeLeft = 120;
        this.startTimer();
        document.getElementById('status').textContent = 'Space Adventure Started! Collect gems and avoid enemies!';
    }
    
    resetGame() {
        this.gameState = 'menu';
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.timeLeft = 120;
        if (this.gameTimer) clearInterval(this.gameTimer);
        this.updateScore();
        document.getElementById('status').textContent = 'Game Reset';
    }
    
    startTimer() {
        this.gameTimer = setInterval(() => {
            this.timeLeft--;
            if (this.timeLeft <= 0) {
                this.endGame();
            }
        }, 1000);
    }
    
    endGame() {
        this.gameState = 'gameOver';
        clearInterval(this.gameTimer);
        document.getElementById('status').textContent = `Space Adventure Complete! Final Score: ${this.score}`;
    }
    
    updateScore() {
        document.getElementById('playerScore').textContent = this.score;
        document.getElementById('aiScore').textContent = `Lives: ${this.lives} | Time: ${this.timeLeft}s`;
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const delta = this.clock.getDelta();
        const time = this.clock.getElapsedTime();
        
        if (this.gameState === 'playing') {
            this.updateGame(delta, time);
        }
        
        this.updateAnimations(delta, time);
        this.renderer.render(this.scene, this.camera);
    }
    
    updateGame(delta, time) {
        // Smooth player movement
        if (this.player) {
            this.player.position.lerp(this.targetPosition, 0.1);
            
            // Player rotation based on movement
            this.player.rotation.z = -this.targetPosition.x * 0.1;
            this.player.rotation.x = this.targetPosition.y * 0.05;
            
            // Bob up and down slightly
            this.player.position.y += Math.sin(time * 3) * 0.1;
        }
        
        // Update enemies
        this.enemies.forEach(enemy => {
            enemy.position.z += enemy.userData.speed * delta;
            enemy.position.x += Math.sin(time * enemy.userData.bobSpeed) * 0.1;
            enemy.position.y += Math.cos(time * enemy.userData.bobSpeed) * 0.05;
            enemy.rotation.y += delta;
            
            // Reset enemy position if it goes too far
            if (enemy.position.z > 20) {
                enemy.position.z = -40;
                enemy.position.x = (Math.random() - 0.5) * 40;
                enemy.position.y = (Math.random() - 0.5) * 20;
            }
            
            // Check collision with player
            if (this.player && enemy.position.distanceTo(this.player.position) < 2) {
                this.lives--;
                enemy.position.z = -40; // Reset enemy
                this.createExplosion(this.player.position);
                
                if (this.lives <= 0) {
                    this.endGame();
                }
            }
        });
        
        // Update collectibles
        this.collectibles.forEach((collectible, index) => {
            collectible.rotation.x += delta;
            collectible.rotation.y += delta * 1.5;
            
            // Floating animation
            collectible.position.y = collectible.userData.originalY + 
                Math.sin(time * collectible.userData.floatSpeed) * 2;
            
            // Check collision with player
            if (this.player && collectible.position.distanceTo(this.player.position) < 2) {
                this.score += 100;
                this.scene.remove(collectible);
                this.collectibles.splice(index, 1);
                this.createCollectEffect(collectible.position);
                
                // Create new collectible
                setTimeout(() => {
                    this.createCollectibles();
                }, 2000);
            }
        });
        
        // Update engine trail
        this.updateEngineTrail();
        
        this.updateScore();
    }
    
    updateAnimations(delta, time) {
        // Rotate stars
        if (this.stars) {
            this.stars.rotation.y += delta * 0.1;
        }
        
        // Animate player parts
        if (this.playerParts) {
            this.playerParts.engine.material.emissiveIntensity = 0.3 + Math.sin(time * 10) * 0.2;
            
            // Eye tracking (look at cursor/ball position)
            const targetLook = new THREE.Vector3(this.targetPosition.x * 0.1, 0, 1);
            this.playerParts.leftPupil.position.x = -0.3 + targetLook.x * 0.1;
            this.playerParts.rightPupil.position.x = 0.3 + targetLook.x * 0.1;
        }
        
        // Update mixers for animations
        this.mixers.forEach(mixer => mixer.update(delta));
    }
    
    updateEngineTrail() {
        if (!this.engineTrail || !this.player) return;
        
        const positions = this.engineTrail.geometry.attributes.position.array;
        const colors = this.engineTrail.geometry.attributes.color.array;
        
        // Shift existing particles back
        for (let i = positions.length - 3; i >= 3; i -= 3) {
            positions[i] = positions[i - 3];
            positions[i + 1] = positions[i - 2];
            positions[i + 2] = positions[i - 1];
            
            colors[i] = colors[i - 3] * 0.95;
            colors[i + 1] = colors[i - 2] * 0.95;
            colors[i + 2] = colors[i - 1] * 0.95;
        }
        
        // Add new particle at engine position
        positions[0] = this.player.position.x + (Math.random() - 0.5) * 0.5;
        positions[1] = this.player.position.y - 1;
        positions[2] = this.player.position.z + (Math.random() - 0.5) * 0.5;
        
        colors[0] = 1;
        colors[1] = 0.5 + Math.random() * 0.5;
        colors[2] = 0;
        
        this.engineTrail.geometry.attributes.position.needsUpdate = true;
        this.engineTrail.geometry.attributes.color.needsUpdate = true;
    }
    
    createExplosion(position) {
        const explosionGeometry = new THREE.BufferGeometry();
        const explosionPositions = [];
        const explosionColors = [];
        
        for (let i = 0; i < 50; i++) {
            explosionPositions.push(
                position.x + (Math.random() - 0.5) * 2,
                position.y + (Math.random() - 0.5) * 2,
                position.z + (Math.random() - 0.5) * 2
            );
            explosionColors.push(1, Math.random(), 0);
        }
        
        explosionGeometry.setAttribute('position', new THREE.Float32BufferAttribute(explosionPositions, 3));
        explosionGeometry.setAttribute('color', new THREE.Float32BufferAttribute(explosionColors, 3));
        
        const explosionMaterial = new THREE.PointsMaterial({
            size: 0.5,
            vertexColors: true,
            transparent: true
        });
        
        const explosion = new THREE.Points(explosionGeometry, explosionMaterial);
        this.scene.add(explosion);
        
        // Remove explosion after animation
        setTimeout(() => {
            this.scene.remove(explosion);
        }, 1000);
    }
    
    createCollectEffect(position) {
        const effectGeometry = new THREE.BufferGeometry();
        const effectPositions = [];
        const effectColors = [];
        
        for (let i = 0; i < 30; i++) {
            effectPositions.push(
                position.x + (Math.random() - 0.5),
                position.y + (Math.random() - 0.5),
                position.z + (Math.random() - 0.5)
            );
            effectColors.push(0, 1, Math.random());
        }
        
        effectGeometry.setAttribute('position', new THREE.Float32BufferAttribute(effectPositions, 3));
        effectGeometry.setAttribute('color', new THREE.Float32BufferAttribute(effectColors, 3));
        
        const effectMaterial = new THREE.PointsMaterial({
            size: 0.3,
            vertexColors: true,
            transparent: true
        });
        
        const effect = new THREE.Points(effectGeometry, effectMaterial);
        this.scene.add(effect);
        
        setTimeout(() => {
            this.scene.remove(effect);
        }, 800);
    }
}

window.addEventListener('load', () => {
    new KidsSpaceAdventure();
});