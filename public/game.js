class HockeyIceAdventure {
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
        this.gameSpeed = 1; // Default game speed multiplier
        
        // Three.js setup
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        
        // Game objects
        this.player = null;
        this.snowmen = [];
        this.pucks = [];
        this.powerUps = [];
        this.iceParticles = [];
        
        // Player control
        this.objectPosition = { x: 0.5, y: 0.5 };
        this.targetPosition = new THREE.Vector3(0, 0, 8); // Initialize as Vector3 matching player start position
        
        // Animation mixers
        this.mixers = [];
        
        this.init3DScene();
        this.createIceRink();
        this.createHockeyPlayer();
        this.createSnowmenEnemies();
        this.initEventListeners();
        this.animate();
    }
    
    init3DScene() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // Sky blue
        
        // Camera (overhead view like hockey) - higher for bigger field
        this.camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000);
        this.camera.position.set(0, 35, 20);
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
        const ambientLight = new THREE.AmbientLight(0x404040, 0.8);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        directionalLight.position.set(0, 30, 10);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.left = -30;
        directionalLight.shadow.camera.right = 30;
        directionalLight.shadow.camera.top = 30;
        directionalLight.shadow.camera.bottom = -30;
        this.scene.add(directionalLight);
        
        // Ice rink lighting
        const rinkLight1 = new THREE.PointLight(0xffffff, 0.5, 50);
        rinkLight1.position.set(-15, 20, 0);
        this.scene.add(rinkLight1);
        
        const rinkLight2 = new THREE.PointLight(0xffffff, 0.5, 50);
        rinkLight2.position.set(15, 20, 0);
        this.scene.add(rinkLight2);
    }
    
    createIceRink() {
        // Ice surface (bigger)
        const iceGeometry = new THREE.PlaneGeometry(45, 30);
        const iceMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xe6f3ff,
            transparent: true,
            opacity: 0.9
        });
        const ice = new THREE.Mesh(iceGeometry, iceMaterial);
        ice.rotation.x = -Math.PI / 2;
        ice.receiveShadow = true;
        this.scene.add(ice);
        
        // Rink boards (walls) - bigger
        const boardHeight = 2;
        const boardMaterial = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
        
        // Side boards (longer)
        const sideGeometry = new THREE.BoxGeometry(0.5, boardHeight, 30);
        const leftBoard = new THREE.Mesh(sideGeometry, boardMaterial);
        leftBoard.position.set(-22.5, boardHeight/2, 0);
        leftBoard.castShadow = true;
        this.scene.add(leftBoard);
        
        const rightBoard = new THREE.Mesh(sideGeometry, boardMaterial);
        rightBoard.position.set(22.5, boardHeight/2, 0);
        rightBoard.castShadow = true;
        this.scene.add(rightBoard);
        
        // End boards (wider)
        const endGeometry = new THREE.BoxGeometry(45, boardHeight, 0.5);
        const topBoard = new THREE.Mesh(endGeometry, boardMaterial);
        topBoard.position.set(0, boardHeight/2, -15);
        topBoard.castShadow = true;
        this.scene.add(topBoard);
        
        const bottomBoard = new THREE.Mesh(endGeometry, boardMaterial);
        bottomBoard.position.set(0, boardHeight/2, 15);
        bottomBoard.castShadow = true;
        this.scene.add(bottomBoard);
        
        // Hockey lines on ice
        this.createHockeyLines();
        
        // Add some snow effects around the rink
        this.createSnowEffects();
    }
    
    createHockeyLines() {
        const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        
        // Center line (wider for bigger rink)
        const centerLineGeometry = new THREE.PlaneGeometry(45, 0.2);
        const centerLine = new THREE.Mesh(centerLineGeometry, lineMaterial);
        centerLine.rotation.x = -Math.PI / 2;
        centerLine.position.y = 0.01;
        this.scene.add(centerLine);
        
        // Goal lines (wider)
        const goalLineGeometry = new THREE.PlaneGeometry(30, 0.2);
        const goalLine1 = new THREE.Mesh(goalLineGeometry, lineMaterial);
        goalLine1.rotation.x = -Math.PI / 2;
        goalLine1.position.set(0, 0.01, -10);
        this.scene.add(goalLine1);
        
        const goalLine2 = new THREE.Mesh(goalLineGeometry, lineMaterial);
        goalLine2.rotation.x = -Math.PI / 2;
        goalLine2.position.set(0, 0.01, 10);
        this.scene.add(goalLine2);
        
        // Center circle (bigger)
        const centerCircle = new THREE.RingGeometry(4, 4.3, 0, Math.PI * 2);
        const centerCircleMesh = new THREE.Mesh(centerCircle, lineMaterial);
        centerCircleMesh.rotation.x = -Math.PI / 2;
        centerCircleMesh.position.y = 0.02;
        this.scene.add(centerCircleMesh);
    }
    
    createSnowEffects() {
        // Floating snow particles
        const snowGeometry = new THREE.BufferGeometry();
        const snowPositions = [];
        const snowVelocities = [];
        
        for (let i = 0; i < 200; i++) {
            snowPositions.push(
                (Math.random() - 0.5) * 40,
                Math.random() * 20 + 5,
                (Math.random() - 0.5) * 30
            );
            snowVelocities.push(
                (Math.random() - 0.5) * 0.02,
                -Math.random() * 0.05 - 0.01,
                (Math.random() - 0.5) * 0.02
            );
        }
        
        snowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(snowPositions, 3));
        
        const snowMaterial = new THREE.PointsMaterial({ 
            color: 0xffffff,
            size: 0.1,
            transparent: true,
            opacity: 0.8
        });
        
        this.snowParticles = new THREE.Points(snowGeometry, snowMaterial);
        this.snowVelocities = snowVelocities;
        this.scene.add(this.snowParticles);
    }
    
    createHockeyPlayer() {
        const group = new THREE.Group();
        
        // Make player MUCH bigger (2.5x scale)
        const scale = 2.5;
        
        // Player body (cylinder for torso)
        const bodyGeometry = new THREE.CylinderGeometry(0.4 * scale, 0.3 * scale, 1.2 * scale, 8);
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x0066cc }); // Blue jersey
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.8 * scale;
        body.castShadow = true;
        group.add(body);
        
        // Head (sphere)
        const headGeometry = new THREE.SphereGeometry(0.3 * scale, 16, 16);
        const headMaterial = new THREE.MeshLambertMaterial({ color: 0xffdbac }); // Skin color
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 1.7 * scale;
        head.castShadow = true;
        group.add(head);
        
        // Hockey helmet
        const helmetGeometry = new THREE.SphereGeometry(0.32 * scale, 16, 16);
        const helmetMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 }); // Red helmet
        const helmet = new THREE.Mesh(helmetGeometry, helmetMaterial);
        helmet.position.y = 1.7 * scale;
        helmet.castShadow = true;
        group.add(helmet);
        
        // Hockey stick (bigger and more prominent)
        const stickGeometry = new THREE.CylinderGeometry(0.05 * scale, 0.05 * scale, 3 * scale, 8);
        const stickMaterial = new THREE.MeshLambertMaterial({ color: 0x8b4513 }); // Brown wood
        const stick = new THREE.Mesh(stickGeometry, stickMaterial);
        stick.position.set(0.8 * scale, 1.2 * scale, 0);
        stick.rotation.z = Math.PI / 4;
        stick.castShadow = true;
        group.add(stick);
        
        // Stick blade (bigger)
        const bladeGeometry = new THREE.BoxGeometry(0.1 * scale, 0.5 * scale, 1.2 * scale);
        const bladeMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 }); // Black blade
        const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
        blade.position.set(1.6 * scale, 0.2 * scale, 0);
        blade.castShadow = true;
        group.add(blade);
        
        // Legs (cylinders)
        const legGeometry = new THREE.CylinderGeometry(0.15 * scale, 0.15 * scale, 0.8 * scale, 8);
        const legMaterial = new THREE.MeshLambertMaterial({ color: 0x0066cc });
        
        const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
        leftLeg.position.set(-0.2 * scale, 0.4 * scale, 0);
        leftLeg.castShadow = true;
        group.add(leftLeg);
        
        const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
        rightLeg.position.set(0.2 * scale, 0.4 * scale, 0);
        rightLeg.castShadow = true;
        group.add(rightLeg);
        
        // Skates (bigger)
        const skateGeometry = new THREE.BoxGeometry(0.3 * scale, 0.15 * scale, 0.8 * scale);
        const skateMaterial = new THREE.MeshLambertMaterial({ color: 0x000000 });
        
        const leftSkate = new THREE.Mesh(skateGeometry, skateMaterial);
        leftSkate.position.set(-0.2 * scale, 0.075 * scale, 0.1 * scale);
        leftSkate.castShadow = true;
        group.add(leftSkate);
        
        const rightSkate = new THREE.Mesh(skateGeometry, skateMaterial);
        rightSkate.position.set(0.2 * scale, 0.075 * scale, 0.1 * scale);
        rightSkate.castShadow = true;
        group.add(rightSkate);
        
        // Position player
        group.position.set(0, 0, 8); // Start near one end
        this.scene.add(group);
        this.player = group;
        
        // Store parts for animation
        this.playerParts = {
            body, head, helmet, stick, blade, leftLeg, rightLeg
        };
    }
    
    createSnowmenEnemies() {
        for (let i = 0; i < 6; i++) {
            this.createSnowman();
        }
    }
    
    createSnowman() {
        const group = new THREE.Group();
        
        // Make snowmen MUCH bigger (2x scale)
        const scale = 2;
        
        // Bottom snowball (largest)
        const bottomGeometry = new THREE.SphereGeometry(0.6 * scale, 16, 16);
        const snowMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const bottom = new THREE.Mesh(bottomGeometry, snowMaterial);
        bottom.position.y = 0.6 * scale;
        bottom.castShadow = true;
        group.add(bottom);
        
        // Middle snowball
        const middleGeometry = new THREE.SphereGeometry(0.45 * scale, 16, 16);
        const middle = new THREE.Mesh(middleGeometry, snowMaterial);
        middle.position.y = 1.35 * scale;
        middle.castShadow = true;
        group.add(middle);
        
        // Head snowball
        const headGeometry = new THREE.SphereGeometry(0.3 * scale, 16, 16);
        const head = new THREE.Mesh(headGeometry, snowMaterial);
        head.position.y = 1.95 * scale;
        head.castShadow = true;
        group.add(head);
        
        // Carrot nose (bigger)
        const noseGeometry = new THREE.ConeGeometry(0.1 * scale, 0.5 * scale, 8);
        const noseMaterial = new THREE.MeshLambertMaterial({ color: 0xff8c00 });
        const nose = new THREE.Mesh(noseGeometry, noseMaterial);
        nose.position.set(0, 1.95 * scale, 0.3 * scale);
        nose.rotation.x = Math.PI / 2;
        nose.castShadow = true;
        group.add(nose);
        
        // Eyes (coal) - bigger
        const eyeGeometry = new THREE.SphereGeometry(0.08 * scale, 8, 8);
        const eyeMaterial = new THREE.MeshLambertMaterial({ color: 0x000000 });
        
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-0.15 * scale, 2.05 * scale, 0.25 * scale);
        group.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(0.15 * scale, 2.05 * scale, 0.25 * scale);
        group.add(rightEye);
        
        // Hat (bigger)
        const hatGeometry = new THREE.CylinderGeometry(0.3 * scale, 0.35 * scale, 0.4 * scale, 8);
        const hatMaterial = new THREE.MeshLambertMaterial({ color: 0x000000 });
        const hat = new THREE.Mesh(hatGeometry, hatMaterial);
        hat.position.y = 2.4 * scale;
        hat.castShadow = true;
        group.add(hat);
        
        // Stick arms (bigger)
        const armGeometry = new THREE.CylinderGeometry(0.04 * scale, 0.04 * scale, 1.2 * scale, 8);
        const armMaterial = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
        
        const leftArm = new THREE.Mesh(armGeometry, armMaterial);
        leftArm.position.set(-0.8 * scale, 1.35 * scale, 0);
        leftArm.rotation.z = Math.PI / 4;
        leftArm.castShadow = true;
        group.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeometry, armMaterial);
        rightArm.position.set(0.8 * scale, 1.35 * scale, 0);
        rightArm.rotation.z = -Math.PI / 4;
        rightArm.castShadow = true;
        group.add(rightArm);
        
        // Random position at top of field for straight-line movement
        group.position.set(
            (Math.random() - 0.5) * 36, // Spread across field width
            0,
            -20 - Math.random() * 5 // Start above the field
        );
        
        // Add movement properties for straight-line movement
        group.userData = {
            speed: Math.random() * 2 + 1, // Slightly faster
            wobble: Math.random() * 2,
            originalY: group.position.y,
            direction: new THREE.Vector3(0, 0, 1), // Move straight down
            startZ: group.position.z
        };
        
        this.scene.add(group);
        this.snowmen.push(group);
    }
    
    createPowerUps() {
        // Create hockey pucks as collectibles
        for (let i = 0; i < 5; i++) {
            const puckGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16);
            const puckMaterial = new THREE.MeshLambertMaterial({ 
                color: 0x000000,
                emissive: 0x333333,
                emissiveIntensity: 0.2
            });
            
            const puck = new THREE.Mesh(puckGeometry, puckMaterial);
            puck.position.set(
                (Math.random() - 0.5) * 20,
                0.1,
                (Math.random() - 0.5) * 15
            );
            puck.castShadow = true;
            
            puck.userData = {
                rotationSpeed: Math.random() * 0.05 + 0.02,
                floatSpeed: Math.random() * 2 + 1,
                originalY: puck.position.y
            };
            
            this.scene.add(puck);
            this.pucks.push(puck);
        }
    }
    
    initEventListeners() {
        const startBtn = document.getElementById('startBtn');
        const resetBtn = document.getElementById('resetBtn');
        
        console.log('Setting up event listeners. Start button:', startBtn, 'Reset button:', resetBtn);
        
        startBtn.addEventListener('click', () => {
            console.log('Start button clicked!');
            this.startGame();
        });
        
        resetBtn.addEventListener('click', () => {
            console.log('Reset button clicked!');
            this.resetGame();
        });
        
        // Speed slider control
        const speedSlider = document.getElementById('speedSlider');
        const speedValue = document.getElementById('speedValue');
        
        speedSlider.addEventListener('input', (e) => {
            this.gameSpeed = parseFloat(e.target.value);
            speedValue.textContent = this.gameSpeed.toFixed(1) + 'x';
        });
        
        this.socket.on('object-position', (data) => {
            console.log('Game received object position:', data, 'Game state:', this.gameState);
            this.objectPosition = data;
            // Always update player position, regardless of game state
            console.log('Updating player position');
            this.updatePlayerFromObject(data);
        });
    }
    
    updatePlayerFromObject(objectPos) {
        console.log('updatePlayerFromObject called with:', objectPos, 'Player exists:', !!this.player);
        if (!this.player) {
            console.log('Player object not found!');
            return;
        }
        
        // Map object position to ice rink (natural control) - bigger field
        // Fix mirroring: invert X coordinate since tracking shows mirrored view
        this.targetPosition.x = (0.5 - objectPos.x) * 36; // Inverted: when you move right, player moves right
        this.targetPosition.y = 0;
        this.targetPosition.z = (objectPos.y - 0.5) * 24; // -12 to +12 (bigger height, not inverted)
        
        // Keep player on ice rink (bigger bounds)
        this.targetPosition.x = Math.max(-18, Math.min(18, this.targetPosition.x));
        this.targetPosition.z = Math.max(-12, Math.min(12, this.targetPosition.z));
        
        console.log('Updated target position:', this.targetPosition, 'from object pos:', objectPos);
        console.log('Current player position:', this.player.position);
    }
    
    updatePlayerMovement(delta, time) {
        // Smooth player movement (works in any game state)
        if (this.player) {
            const oldPos = { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z };
            this.player.position.lerp(this.targetPosition, 0.15);
            const newPos = { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z };
            
            // Log movement every 60 frames to avoid spam
            if (this.frameCount && this.frameCount % 60 === 0) {
                console.log('Player movement - Target:', this.targetPosition, 'Old pos:', oldPos, 'New pos:', newPos);
            }
            
            // Player skating animation (slight wobble)
            this.player.rotation.y = Math.sin(time * 5) * 0.1;
            
            // Create ice skating trail effect
            this.createSkatingTrail();
        }
    }
    
    startGame() {
        console.log('startGame() called - changing state from', this.gameState, 'to playing');
        this.gameState = 'playing';
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.timeLeft = 120;
        this.createPowerUps();
        this.startTimer();
        document.getElementById('status').textContent = 'Hockey Time! Avoid the snowmen and collect pucks!';
        console.log('Game state is now:', this.gameState);
    }
    
    resetGame() {
        this.gameState = 'menu';
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.timeLeft = 120;
        if (this.gameTimer) clearInterval(this.gameTimer);
        
        // Clear pucks
        this.pucks.forEach(puck => this.scene.remove(puck));
        this.pucks = [];
        
        this.updateScore();
        document.getElementById('status').textContent = 'Game Reset - Ready for Hockey!';
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
        document.getElementById('status').textContent = `Game Over! Final Score: ${this.score} pucks!`;
    }
    
    updateScore() {
        document.getElementById('playerScore').textContent = this.score;
        document.getElementById('aiScore').textContent = `Lives: ${this.lives} | Time: ${this.timeLeft}s`;
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const delta = this.clock.getDelta();
        const time = this.clock.getElapsedTime();
        
        this.updateSnow();
        
        // Always update player movement
        this.updatePlayerMovement(delta, time);
        
        if (this.gameState === 'playing') {
            this.updateGame(delta, time);
        }
        
        this.updateAnimations(delta, time);
        this.renderer.render(this.scene, this.camera);
    }
    
    updateSnow() {
        if (!this.snowParticles) return;
        
        const positions = this.snowParticles.geometry.attributes.position.array;
        
        for (let i = 0; i < positions.length; i += 3) {
            positions[i] += this.snowVelocities[i];     // x
            positions[i + 1] += this.snowVelocities[i + 1]; // y
            positions[i + 2] += this.snowVelocities[i + 2]; // z
            
            // Reset snow that falls below ground
            if (positions[i + 1] < 0) {
                positions[i + 1] = 25;
            }
        }
        
        this.snowParticles.geometry.attributes.position.needsUpdate = true;
    }
    
    updateGame(delta, time) {
        // Add frame counter for debugging
        if (!this.frameCount) this.frameCount = 0;
        this.frameCount++;
        // Always update player movement, even when game is not playing
        this.updatePlayerMovement(delta, time);
        
        // Update snowmen enemies - straight line movement
        this.snowmen.forEach(snowman => {
            // Move in straight line from top to bottom (increased speed with game speed)
            snowman.position.z += snowman.userData.speed * delta * this.gameSpeed;
            
            // Wobble animation
            snowman.position.y = snowman.userData.originalY + 
                Math.sin(time * snowman.userData.wobble) * 0.1;
            snowman.rotation.y += delta * 2;
            
            // Reset when snowman goes past bottom of field
            if (snowman.position.z > 25) {
                snowman.position.set(
                    (Math.random() - 0.5) * 36, // Spread across field width
                    0,
                    -20 - Math.random() * 5 // Start above the field
                );
                snowman.userData.startZ = snowman.position.z;
            }
            
            // Check collision with player (bigger collision due to bigger models)
            if (this.player && snowman.position.distanceTo(this.player.position) < 3) {
                this.lives--;
                this.createCollisionEffect(this.player.position);
                
                // Reset snowman after collision
                snowman.position.set(
                    (Math.random() - 0.5) * 36,
                    0,
                    -20 - Math.random() * 5
                );
                snowman.userData.startZ = snowman.position.z;
                
                if (this.lives <= 0) {
                    this.endGame();
                }
            }
        });
        
        // Update pucks
        this.pucks.forEach((puck, index) => {
            puck.rotation.y += puck.userData.rotationSpeed;
            puck.position.y = puck.userData.originalY + 
                Math.sin(time * puck.userData.floatSpeed) * 0.3;
            
            // Check collision with player
            if (this.player && puck.position.distanceTo(this.player.position) < 1) {
                this.score += 100;
                this.createPuckCollectEffect(puck.position);
                this.scene.remove(puck);
                this.pucks.splice(index, 1);
                
                // Create new puck
                setTimeout(() => {
                    if (this.gameState === 'playing') {
                        this.createNewPuck();
                    }
                }, 3000);
            }
        });
        
        this.updateScore();
    }
    
    createSkatingTrail() {
        // Create ice particles behind skates
        if (Math.random() < 0.3 && this.player) {
            const trail = new THREE.Mesh(
                new THREE.SphereGeometry(0.05, 4, 4),
                new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
            );
            trail.position.copy(this.player.position);
            trail.position.y = 0.05;
            trail.position.x += (Math.random() - 0.5) * 0.5;
            trail.position.z += (Math.random() - 0.5) * 0.5;
            
            this.scene.add(trail);
            
            // Remove after animation
            setTimeout(() => {
                this.scene.remove(trail);
            }, 1000);
        }
    }
    
    createNewPuck() {
        const puckGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16);
        const puckMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x000000,
            emissive: 0x333333,
            emissiveIntensity: 0.2
        });
        
        const puck = new THREE.Mesh(puckGeometry, puckMaterial);
        puck.position.set(
            (Math.random() - 0.5) * 20,
            0.1,
            (Math.random() - 0.5) * 15
        );
        puck.castShadow = true;
        
        puck.userData = {
            rotationSpeed: Math.random() * 0.05 + 0.02,
            floatSpeed: Math.random() * 2 + 1,
            originalY: puck.position.y
        };
        
        this.scene.add(puck);
        this.pucks.push(puck);
    }
    
    createCollisionEffect(position) {
        // Ice explosion effect
        for (let i = 0; i < 15; i++) {
            const particle = new THREE.Mesh(
                new THREE.SphereGeometry(0.05, 4, 4),
                new THREE.MeshBasicMaterial({ color: 0xffffff })
            );
            particle.position.copy(position);
            particle.position.x += (Math.random() - 0.5) * 2;
            particle.position.y += Math.random();
            particle.position.z += (Math.random() - 0.5) * 2;
            
            this.scene.add(particle);
            
            setTimeout(() => {
                this.scene.remove(particle);
            }, 800);
        }
    }
    
    createPuckCollectEffect(position) {
        // Golden sparkle effect
        for (let i = 0; i < 10; i++) {
            const sparkle = new THREE.Mesh(
                new THREE.SphereGeometry(0.03, 4, 4),
                new THREE.MeshBasicMaterial({ color: 0xffd700 })
            );
            sparkle.position.copy(position);
            sparkle.position.x += (Math.random() - 0.5);
            sparkle.position.y += Math.random() * 2;
            sparkle.position.z += (Math.random() - 0.5);
            
            this.scene.add(sparkle);
            
            setTimeout(() => {
                this.scene.remove(sparkle);
            }, 600);
        }
    }
    
    updateAnimations(delta, time) {
        // Player animation
        if (this.playerParts) {
            // Stick handling animation
            this.playerParts.stick.rotation.z = Math.PI / 6 + Math.sin(time * 3) * 0.2;
        }
        
        // Update mixers
        this.mixers.forEach(mixer => mixer.update(delta));
    }
}

window.addEventListener('load', () => {
    new HockeyIceAdventure();
});