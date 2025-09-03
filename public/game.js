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
        this.ballPosition = { x: 0.5, y: 0.5 };
        this.targetPosition = { x: 0, y: 0, z: 0 };
        
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
        
        // Player body (cylinder for torso)
        const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.3, 1.2, 8);
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x0066cc }); // Blue jersey
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.8;
        body.castShadow = true;
        group.add(body);
        
        // Head (sphere)
        const headGeometry = new THREE.SphereGeometry(0.3, 16, 16);
        const headMaterial = new THREE.MeshLambertMaterial({ color: 0xffdbac }); // Skin color
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 1.7;
        head.castShadow = true;
        group.add(head);
        
        // Hockey helmet
        const helmetGeometry = new THREE.SphereGeometry(0.32, 16, 16);
        const helmetMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 }); // Red helmet
        const helmet = new THREE.Mesh(helmetGeometry, helmetMaterial);
        helmet.position.y = 1.7;
        helmet.castShadow = true;
        group.add(helmet);
        
        // Hockey stick
        const stickGeometry = new THREE.CylinderGeometry(0.02, 0.02, 2, 8);
        const stickMaterial = new THREE.MeshLambertMaterial({ color: 0x8b4513 }); // Brown wood
        const stick = new THREE.Mesh(stickGeometry, stickMaterial);
        stick.position.set(0.5, 0.8, 0);
        stick.rotation.z = Math.PI / 6;
        stick.castShadow = true;
        group.add(stick);
        
        // Stick blade
        const bladeGeometry = new THREE.BoxGeometry(0.05, 0.3, 0.8);
        const bladeMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 }); // Black blade
        const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
        blade.position.set(0.8, 0.1, 0);
        blade.castShadow = true;
        group.add(blade);
        
        // Legs (cylinders)
        const legGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.8, 8);
        const legMaterial = new THREE.MeshLambertMaterial({ color: 0x0066cc });
        
        const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
        leftLeg.position.set(-0.2, 0.4, 0);
        leftLeg.castShadow = true;
        group.add(leftLeg);
        
        const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
        rightLeg.position.set(0.2, 0.4, 0);
        rightLeg.castShadow = true;
        group.add(rightLeg);
        
        // Skates
        const skateGeometry = new THREE.BoxGeometry(0.2, 0.1, 0.6);
        const skateMaterial = new THREE.MeshLambertMaterial({ color: 0x000000 });
        
        const leftSkate = new THREE.Mesh(skateGeometry, skateMaterial);
        leftSkate.position.set(-0.2, 0.05, 0.1);
        leftSkate.castShadow = true;
        group.add(leftSkate);
        
        const rightSkate = new THREE.Mesh(skateGeometry, skateMaterial);
        rightSkate.position.set(0.2, 0.05, 0.1);
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
        
        // Bottom snowball (largest)
        const bottomGeometry = new THREE.SphereGeometry(0.6, 16, 16);
        const snowMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const bottom = new THREE.Mesh(bottomGeometry, snowMaterial);
        bottom.position.y = 0.6;
        bottom.castShadow = true;
        group.add(bottom);
        
        // Middle snowball
        const middleGeometry = new THREE.SphereGeometry(0.45, 16, 16);
        const middle = new THREE.Mesh(middleGeometry, snowMaterial);
        middle.position.y = 1.35;
        middle.castShadow = true;
        group.add(middle);
        
        // Head snowball
        const headGeometry = new THREE.SphereGeometry(0.3, 16, 16);
        const head = new THREE.Mesh(headGeometry, snowMaterial);
        head.position.y = 1.95;
        head.castShadow = true;
        group.add(head);
        
        // Carrot nose
        const noseGeometry = new THREE.ConeGeometry(0.05, 0.3, 8);
        const noseMaterial = new THREE.MeshLambertMaterial({ color: 0xff8c00 });
        const nose = new THREE.Mesh(noseGeometry, noseMaterial);
        nose.position.set(0, 1.95, 0.3);
        nose.rotation.x = Math.PI / 2;
        nose.castShadow = true;
        group.add(nose);
        
        // Eyes (coal)
        const eyeGeometry = new THREE.SphereGeometry(0.05, 8, 8);
        const eyeMaterial = new THREE.MeshLambertMaterial({ color: 0x000000 });
        
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-0.1, 2.05, 0.25);
        group.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(0.1, 2.05, 0.25);
        group.add(rightEye);
        
        // Hat
        const hatGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.4, 8);
        const hatMaterial = new THREE.MeshLambertMaterial({ color: 0x000000 });
        const hat = new THREE.Mesh(hatGeometry, hatMaterial);
        hat.position.y = 2.4;
        hat.castShadow = true;
        group.add(hat);
        
        // Stick arms
        const armGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8);
        const armMaterial = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
        
        const leftArm = new THREE.Mesh(armGeometry, armMaterial);
        leftArm.position.set(-0.5, 1.35, 0);
        leftArm.rotation.z = Math.PI / 4;
        leftArm.castShadow = true;
        group.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeometry, armMaterial);
        rightArm.position.set(0.5, 1.35, 0);
        rightArm.rotation.z = -Math.PI / 4;
        rightArm.castShadow = true;
        group.add(rightArm);
        
        // Random position
        group.position.set(
            (Math.random() - 0.5) * 25,
            0,
            -15 - Math.random() * 10
        );
        
        // Add movement properties
        group.userData = {
            speed: Math.random() * 1.5 + 0.5,
            wobble: Math.random() * 2,
            originalY: group.position.y
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
        
        // Map ball position to ice rink (natural control) - bigger field
        this.targetPosition.x = (ballPos.x - 0.5) * 36; // -18 to +18 (bigger width)
        this.targetPosition.y = 0;
        this.targetPosition.z = (ballPos.y - 0.5) * 24; // -12 to +12 (bigger height, not inverted)
        
        // Keep player on ice rink (bigger bounds)
        this.targetPosition.x = Math.max(-18, Math.min(18, this.targetPosition.x));
        this.targetPosition.z = Math.max(-12, Math.min(12, this.targetPosition.z));
    }
    
    startGame() {
        this.gameState = 'playing';
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.timeLeft = 120;
        this.createPowerUps();
        this.startTimer();
        document.getElementById('status').textContent = 'Hockey Time! Avoid the snowmen and collect pucks!';
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
        // Smooth player movement
        if (this.player) {
            this.player.position.lerp(this.targetPosition, 0.15);
            
            // Player skating animation (slight wobble)
            this.player.rotation.y = Math.sin(time * 5) * 0.1;
            
            // Create ice skating trail effect
            this.createSkatingTrail();
        }
        
        // Update snowmen enemies
        this.snowmen.forEach(snowman => {
            // Move toward player
            if (this.player) {
                const direction = new THREE.Vector3();
                direction.subVectors(this.player.position, snowman.position);
                direction.normalize();
                
                snowman.position.x += direction.x * snowman.userData.speed * delta;
                snowman.position.z += direction.z * snowman.userData.speed * delta;
                
                // Wobble animation
                snowman.position.y = snowman.userData.originalY + 
                    Math.sin(time * snowman.userData.wobble) * 0.1;
                snowman.rotation.y += delta * 2;
            }
            
            // Reset if too far
            const distanceFromCenter = snowman.position.length();
            if (distanceFromCenter > 30) {
                snowman.position.set(
                    (Math.random() - 0.5) * 25,
                    0,
                    -15 - Math.random() * 10
                );
            }
            
            // Check collision with player
            if (this.player && snowman.position.distanceTo(this.player.position) < 1.5) {
                this.lives--;
                this.createCollisionEffect(this.player.position);
                
                // Move snowman away
                snowman.position.set(
                    (Math.random() - 0.5) * 25,
                    0,
                    -15 - Math.random() * 10
                );
                
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