class HockeyIceAdventure {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.socket = io();
        
        // Game state
        this.gameState = 'menu';
        this.score = 0;
        this.lives = 10;
        this.level = 1;
        this.timeLeft = 120;
        this.gameTimer = null;
        this.gameSpeed = 3; // Default game speed multiplier
        this.snowmanDensity = 0.5; // Default snowman density multiplier
        
        // Three.js setup
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        
        // Game objects
        this.player = null;
        this.snowmen = []; // Moving snowmen obstacles from top
        this.diamonds = []; // Collectible diamonds
        this.powerUps = [];
        this.iceParticles = [];
        this.gameOverText = null; // Game over text overlay
        
        // Player control
        this.objectPosition = { x: 0.5, y: 0.5 };
        this.targetPosition = new THREE.Vector3(0, 0, 20); // Initialize as Vector3 matching player start position
        
        // Animation mixers
        this.mixers = [];
        
        this.init3DScene();
        this.createRoad();
        this.createHockeyPlayer();
        this.createSnowmen(); // Create initial snowmen
        this.createDiamonds(); // Create initial diamonds
        this.createGameOverText(); // Create game over text overlay
        this.initEventListeners();
        this.animate();
    }
    
    init3DScene() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // Sky blue
        
        // Camera (overhead view) - adjusted for extended road
        this.camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000);
        this.camera.position.set(0, 50, 35); // Higher and further back for extended road
        this.camera.lookAt(0, 0, 20); // Look at center-bottom area where player starts
        
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
    
    createRoad() {
        // Road surface - extends all the way to the top
        const roadGeometry = new THREE.PlaneGeometry(60, 150); // Width 60, Length 150 (extends to top)
        const roadMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x2a2a2a, // Dark asphalt base
            emissive: 0x0a0a0a,
            emissiveIntensity: 0.05
        });
        const road = new THREE.Mesh(roadGeometry, roadMaterial);
        road.rotation.x = -Math.PI / 2;
        road.receiveShadow = true;
        this.scene.add(road);
        
        // Ice layer covering the road - winter atmosphere
        const iceGeometry = new THREE.PlaneGeometry(60, 150); // Same size as road
        const iceMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xe6f3ff, // Light blue ice color
            transparent: true,
            opacity: 0.7,
            emissive: 0x001122,
            emissiveIntensity: 0.1
        });
        const iceLayer = new THREE.Mesh(iceGeometry, iceMaterial);
        iceLayer.rotation.x = -Math.PI / 2;
        iceLayer.position.y = 0.005; // Slightly above the road
        iceLayer.receiveShadow = true;
        this.scene.add(iceLayer);
        
        // Road barriers/guardrails - only on the sides, taller for visibility
        const barrierHeight = 3;
        const barrierMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xcccccc, // Light gray barriers
            emissive: 0x222222,
            emissiveIntensity: 0.1
        });
        
        // Left side barrier (extends to full road length)
        const leftBarrierGeometry = new THREE.BoxGeometry(0.4, barrierHeight, 150);
        const leftBarrier = new THREE.Mesh(leftBarrierGeometry, barrierMaterial);
        leftBarrier.position.set(-30.2, barrierHeight/2, 0);
        leftBarrier.castShadow = true;
        this.scene.add(leftBarrier);
        
        // Right side barrier (extends to full road length)
        const rightBarrierGeometry = new THREE.BoxGeometry(0.4, barrierHeight, 150);
        const rightBarrier = new THREE.Mesh(rightBarrierGeometry, barrierMaterial);
        rightBarrier.position.set(30.2, barrierHeight/2, 0);
        rightBarrier.castShadow = true;
        this.scene.add(rightBarrier);
        
        // Road markings and details
        this.createRoadMarkings();
        
        // Add some environmental effects
        this.createRoadEnvironment();
    }
    
    createRoadMarkings() {
        const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff }); // White road markings
        
        // Center dashed line (extends to full road length, visible through ice)
        for (let z = -70; z <= 70; z += 5) {
            const dashGeometry = new THREE.PlaneGeometry(0.4, 4);
            const dash = new THREE.Mesh(dashGeometry, lineMaterial);
            dash.rotation.x = -Math.PI / 2;
            dash.position.set(0, 0.006, z); // Above ice layer to show through
            this.scene.add(dash);
        }
        
        // Lane markers (dashed yellow lines, dimmed to show through ice)
        const yellowLineMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xdddd00, // Slightly dimmed yellow to show through ice
            transparent: true,
            opacity: 0.9
        });
        
        // Left inner lane markers
        for (let z = -70; z <= 70; z += 4) {
            const leftMarker = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2.5), yellowLineMaterial);
            leftMarker.rotation.x = -Math.PI / 2;
            leftMarker.position.set(-15, 0.006, z); // Above ice layer
            this.scene.add(leftMarker);
        }
        
        // Right inner lane markers
        for (let z = -70; z <= 70; z += 4) {
            const rightMarker = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2.5), yellowLineMaterial);
            rightMarker.rotation.x = -Math.PI / 2;
            rightMarker.position.set(15, 0.006, z); // Above ice layer
            this.scene.add(rightMarker);
        }
        
        // Outer lane markers (for wider road)
        for (let z = -70; z <= 70; z += 6) {
            const leftOuter = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 2), yellowLineMaterial);
            leftOuter.rotation.x = -Math.PI / 2;
            leftOuter.position.set(-25, 0.006, z); // Above ice layer
            this.scene.add(leftOuter);
            
            const rightOuter = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 2), yellowLineMaterial);
            rightOuter.rotation.x = -Math.PI / 2;
            rightOuter.position.set(25, 0.006, z); // Above ice layer
            this.scene.add(rightOuter);
        }
    }
    
    createRoadEnvironment() {
        // Winter snow particles for icy road atmosphere
        const snowGeometry = new THREE.BufferGeometry();
        const snowPositions = [];
        const snowVelocities = [];
        
        for (let i = 0; i < 300; i++) { // More particles for winter effect
            snowPositions.push(
                (Math.random() - 0.5) * 70, // Spread across wider road
                Math.random() * 15 + 5,
                (Math.random() - 0.5) * 160 // Across full road length
            );
            snowVelocities.push(
                (Math.random() - 0.5) * 0.015,
                -Math.random() * 0.03 - 0.01, // Falling snow
                (Math.random() - 0.5) * 0.01
            );
        }
        
        snowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(snowPositions, 3));
        
        const snowMaterial = new THREE.PointsMaterial({ 
            color: 0xffffff, // White snow
            size: 0.08,
            transparent: true,
            opacity: 0.9
        });
        
        this.winterSnow = new THREE.Points(snowGeometry, snowMaterial);
        this.winterSnowVelocities = snowVelocities;
        this.scene.add(this.winterSnow);
        
        // Add ice crystals/sparkles on the road surface
        this.createIceCrystals();
    }
    
    createIceCrystals() {
        // Small ice crystals scattered on the road surface
        for (let i = 0; i < 50; i++) {
            const crystalGeometry = new THREE.OctahedronGeometry(0.05, 0);
            const crystalMaterial = new THREE.MeshLambertMaterial({ 
                color: 0xccffff,
                transparent: true,
                opacity: 0.6,
                emissive: 0x004488,
                emissiveIntensity: 0.1
            });
            
            const crystal = new THREE.Mesh(crystalGeometry, crystalMaterial);
            crystal.position.set(
                (Math.random() - 0.5) * 55, // Spread across road width
                0.007, // Just above ice layer
                (Math.random() - 0.5) * 140 // Across road length
            );
            crystal.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            
            this.scene.add(crystal);
        }
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
        
        // Hockey jersey (more realistic torso shape)
        const jerseyGeometry = new THREE.CylinderGeometry(0.45 * scale, 0.35 * scale, 1.3 * scale, 12);
        const jerseyMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x0044aa, // Professional blue
            emissive: 0x001122,
            emissiveIntensity: 0.1
        });
        const jersey = new THREE.Mesh(jerseyGeometry, jerseyMaterial);
        jersey.position.y = 0.85 * scale;
        jersey.castShadow = true;
        group.add(jersey);
        
        // Jersey stripes/details
        const stripeGeometry = new THREE.CylinderGeometry(0.46 * scale, 0.36 * scale, 0.15 * scale, 12);
        const stripeMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff }); // White stripe
        const stripe1 = new THREE.Mesh(stripeGeometry, stripeMaterial);
        stripe1.position.y = 1.0 * scale;
        stripe1.castShadow = true;
        group.add(stripe1);
        
        const stripe2 = new THREE.Mesh(stripeGeometry, stripeMaterial);
        stripe2.position.y = 0.7 * scale;
        stripe2.castShadow = true;
        group.add(stripe2);
        
        // Shoulder pads (protective gear)
        const shoulderPadGeometry = new THREE.BoxGeometry(0.8 * scale, 0.3 * scale, 0.4 * scale);
        const padMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x333333,
            emissive: 0x111111,
            emissiveIntensity: 0.05
        });
        const shoulderPads = new THREE.Mesh(shoulderPadGeometry, padMaterial);
        shoulderPads.position.y = 1.35 * scale;
        shoulderPads.castShadow = true;
        group.add(shoulderPads);
        
        // Head (sphere)
        const headGeometry = new THREE.SphereGeometry(0.28 * scale, 16, 16);
        const headMaterial = new THREE.MeshLambertMaterial({ color: 0xffdbac }); // Skin color
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 1.7 * scale;
        head.castShadow = true;
        group.add(head);
        
        // Professional hockey helmet with face cage
        const helmetGroup = new THREE.Group();
        
        // Main helmet shell
        const helmetGeometry = new THREE.SphereGeometry(0.34 * scale, 16, 16);
        const helmetMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xdd0000, // Bright red
            emissive: 0x330000,
            emissiveIntensity: 0.1
        });
        const helmet = new THREE.Mesh(helmetGeometry, helmetMaterial);
        helmet.scale.set(1, 0.8, 1.1); // Flatten slightly for realism
        helmetGroup.add(helmet);
        
        // Helmet visor/face shield
        const visorGeometry = new THREE.SphereGeometry(0.35 * scale, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
        const visorMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x000000,
            transparent: true,
            opacity: 0.3,
            emissive: 0x000044,
            emissiveIntensity: 0.05
        });
        const visor = new THREE.Mesh(visorGeometry, visorMaterial);
        visor.position.y = 0.05 * scale;
        visor.scale.set(1, 0.8, 1.1);
        helmetGroup.add(visor);
        
        // Face cage bars
        for (let i = 0; i < 6; i++) {
            const barGeometry = new THREE.CylinderGeometry(0.02 * scale, 0.02 * scale, 0.4 * scale, 8);
            const barMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 });
            const bar = new THREE.Mesh(barGeometry, barMaterial);
            bar.position.set(
                (i - 2.5) * 0.1 * scale,
                0.05 * scale,
                0.32 * scale
            );
            bar.rotation.x = -0.2;
            bar.castShadow = true;
            helmetGroup.add(bar);
        }
        
        helmetGroup.position.y = 1.7 * scale;
        helmetGroup.castShadow = true;
        group.add(helmetGroup);
        
        // Create realistic hockey stick
        const stickGroup = new THREE.Group();
        
        // Stick shaft - tapered from top to bottom, more realistic proportions
        const shaftTopGeometry = new THREE.CylinderGeometry(0.04 * scale, 0.06 * scale, 2.2 * scale, 12);
        const shaftMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x2d1810, // Dark wood color
            emissive: 0x0a0604,
            emissiveIntensity: 0.1
        });
        const shaftTop = new THREE.Mesh(shaftTopGeometry, shaftMaterial);
        shaftTop.position.set(0, 1.1 * scale, 0);
        shaftTop.castShadow = true;
        stickGroup.add(shaftTop);
        
        // Lower shaft section (thicker for strength)
        const shaftBottomGeometry = new THREE.CylinderGeometry(0.06 * scale, 0.08 * scale, 1.0 * scale, 12);
        const shaftBottom = new THREE.Mesh(shaftBottomGeometry, shaftMaterial);
        shaftBottom.position.set(0, -0.28 * scale, 0);
        shaftBottom.castShadow = true;
        stickGroup.add(shaftBottom);
        
        // Grip tape area (textured section)
        const gripGeometry = new THREE.CylinderGeometry(0.045 * scale, 0.045 * scale, 0.6 * scale, 16);
        const gripMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x000000 // Black grip tape
        });
        const grip = new THREE.Mesh(gripGeometry, gripMaterial);
        grip.position.set(0, 1.8 * scale, 0);
        grip.castShadow = true;
        stickGroup.add(grip);
        
        // Stick blade - more realistic curved hockey blade
        const bladeGeometry = new THREE.BoxGeometry(0.08 * scale, 0.3 * scale, 0.8 * scale);
        const bladeMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x1a1a1a, // Dark blade
            emissive: 0x050505,
            emissiveIntensity: 0.1
        });
        const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
        blade.position.set(0, -0.85 * scale, 0.15 * scale);
        blade.rotation.x = -0.2; // Slight curve for realistic blade angle
        blade.castShadow = true;
        stickGroup.add(blade);
        
        // Blade toe (rounded end)
        const toeGeometry = new THREE.SphereGeometry(0.06 * scale, 8, 8);
        const toe = new THREE.Mesh(toeGeometry, bladeMaterial);
        toe.position.set(0, -0.85 * scale, 0.55 * scale);
        toe.scale.set(1, 0.6, 0.8); // Flatten for blade shape
        toe.castShadow = true;
        stickGroup.add(toe);
        
        // Position the entire stick realistically
        stickGroup.position.set(0.4 * scale, 0.8 * scale, -0.1 * scale);
        stickGroup.rotation.z = Math.PI / 12; // More natural angle
        stickGroup.rotation.x = -Math.PI / 24; // Slight forward lean
        
        group.add(stickGroup);
        
        // Hockey pants/protective legs
        const pantsGeometry = new THREE.CylinderGeometry(0.22 * scale, 0.18 * scale, 0.6 * scale, 12);
        const pantsMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x0044aa, // Matching jersey color
            emissive: 0x001122,
            emissiveIntensity: 0.05
        });
        
        const leftPants = new THREE.Mesh(pantsGeometry, pantsMaterial);
        leftPants.position.set(-0.18 * scale, 0.5 * scale, 0);
        leftPants.castShadow = true;
        group.add(leftPants);
        
        const rightPants = new THREE.Mesh(pantsGeometry, pantsMaterial);
        rightPants.position.set(0.18 * scale, 0.5 * scale, 0);
        rightPants.castShadow = true;
        group.add(rightPants);
        
        // Shin pads/leg protection
        const shinPadGeometry = new THREE.CylinderGeometry(0.12 * scale, 0.14 * scale, 0.5 * scale, 8);
        const shinPadMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x222222,
            emissive: 0x111111,
            emissiveIntensity: 0.05
        });
        
        const leftShinPad = new THREE.Mesh(shinPadGeometry, shinPadMaterial);
        leftShinPad.position.set(-0.18 * scale, 0.15 * scale, 0.05 * scale);
        leftShinPad.castShadow = true;
        group.add(leftShinPad);
        
        const rightShinPad = new THREE.Mesh(shinPadGeometry, shinPadMaterial);
        rightShinPad.position.set(0.18 * scale, 0.15 * scale, 0.05 * scale);
        rightShinPad.castShadow = true;
        group.add(rightShinPad);
        
        // Professional hockey skates
        const skateBootGeometry = new THREE.BoxGeometry(0.25 * scale, 0.18 * scale, 0.7 * scale);
        const skateBootMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x1a1a1a, // Dark leather-like
            emissive: 0x050505,
            emissiveIntensity: 0.1
        });
        
        const leftSkateBoots = new THREE.Mesh(skateBootGeometry, skateBootMaterial);
        leftSkateBoots.position.set(-0.18 * scale, 0.09 * scale, 0.1 * scale);
        leftSkateBoots.castShadow = true;
        group.add(leftSkateBoots);
        
        const rightSkateBoots = new THREE.Mesh(skateBootGeometry, skateBootMaterial);
        rightSkateBoots.position.set(0.18 * scale, 0.09 * scale, 0.1 * scale);
        rightSkateBoots.castShadow = true;
        group.add(rightSkateBoots);
        
        // Ice skate blades
        const skateBladeGeometry = new THREE.BoxGeometry(0.02 * scale, 0.08 * scale, 0.8 * scale);
        const skateBladeMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xcccccc, // Metallic silver
            emissive: 0x222222,
            emissiveIntensity: 0.2
        });
        
        const leftSkateBlade = new THREE.Mesh(skateBladeGeometry, skateBladeMaterial);
        leftSkateBlade.position.set(-0.18 * scale, 0.01 * scale, 0.1 * scale);
        leftSkateBlade.castShadow = true;
        group.add(leftSkateBlade);
        
        const rightSkateBlade = new THREE.Mesh(skateBladeGeometry, skateBladeMaterial);
        rightSkateBlade.position.set(0.18 * scale, 0.01 * scale, 0.1 * scale);
        rightSkateBlade.castShadow = true;
        group.add(rightSkateBlade);
        
        // Position player in visible area
        group.position.set(0, 0, 20); // Start in center-bottom area, visible to camera
        this.scene.add(group);
        this.player = group;
        
        // Store parts for animation
        this.playerParts = {
            jersey, head, helmetGroup, stickGroup, leftPants, rightPants, leftShinPad, rightShinPad
        };
    }
    
    createSnowmen() {
        // Create initial set of moving snowmen
        for (let i = 0; i < 6; i++) {
            this.createSnowman();
        }
    }
    
    createSnowman() {
        const group = new THREE.Group();
        
        // Make snowmen much bigger (4x scale)
        const scale = 4;
        
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
        
        // Random position at top of extended icy road for straight-line movement
        group.position.set(
            (Math.random() - 0.5) * 50, // Spread across wider road
            0,
            -80 - Math.random() * 15 // Start well above the extended road
        );
        
        // Add movement properties for straight-line movement
        group.userData = {
            speed: Math.random() * 2 + 1, // Speed
            wobble: Math.random() * 2,
            originalY: group.position.y,
            direction: new THREE.Vector3(0, 0, 1), // Move straight down
            startZ: group.position.z
        };
        
        this.scene.add(group);
        this.snowmen.push(group);
    }
    
    createDiamonds() {
        // Create sparkling diamonds as collectibles
        for (let i = 0; i < 5; i++) {
            this.createDiamond();
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
        
        // Density slider control
        const densitySlider = document.getElementById('densitySlider');
        const densityValue = document.getElementById('densityValue');
        
        densitySlider.addEventListener('input', (e) => {
            this.snowmanDensity = parseFloat(e.target.value);
            densityValue.textContent = this.snowmanDensity.toFixed(1) + 'x';
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
        
        // Map object position to full icy road (natural control)
        // Fix mirroring: invert X coordinate since tracking shows mirrored view
        this.targetPosition.x = (0.5 - objectPos.x) * 50; // Wider road: -25 to +25
        this.targetPosition.y = 0;
        this.targetPosition.z = (objectPos.y - 0.5) * 120; // Extended road: -60 to +60
        
        // Keep player on extended icy road (new bounds)
        this.targetPosition.x = Math.max(-25, Math.min(25, this.targetPosition.x));
        this.targetPosition.z = Math.max(-60, Math.min(60, this.targetPosition.z));
        
        console.log('Updated target position:', this.targetPosition, 'from object pos:', objectPos);
        console.log('Current player position:', this.player.position);
    }
    
    updatePlayerMovement(delta, time) {
        // Very fast, responsive player movement (works in any game state)
        if (this.player) {
            const oldPos = { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z };
            
            // Much faster movement - almost instant response (was 0.15, now 0.8-1.0)
            this.player.position.lerp(this.targetPosition, 0.9);
            
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
        this.lives = 10;
        this.level = 1;
        this.timeLeft = 120;
        this.createDiamonds();
        this.startTimer();
        document.getElementById('status').textContent = 'Arcade Time! Avoid the snowmen and collect diamonds!';
        
        // Hide GAME OVER text when starting
        if (this.gameOverText) {
            this.gameOverText.visible = false;
        }
        
        console.log('Game state is now:', this.gameState);
    }
    
    resetGame() {
        this.gameState = 'menu';
        this.score = 0;
        this.lives = 10;
        this.level = 1;
        this.timeLeft = 120;
        if (this.gameTimer) clearInterval(this.gameTimer);
        
        // Clear diamonds and snowmen
        this.diamonds.forEach(diamond => this.scene.remove(diamond));
        this.diamonds = [];
        this.snowmen.forEach(snowman => this.scene.remove(snowman));
        this.snowmen = [];
        
        this.updateScore();
        document.getElementById('status').textContent = 'Game Reset - Ready for Hockey!';
        
        // Hide GAME OVER text when resetting
        if (this.gameOverText) {
            this.gameOverText.visible = false;
        }
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
        document.getElementById('status').textContent = `Game Over! Final Score: ${this.score} diamonds!`;
        
        // Show GAME OVER text overlay
        if (this.gameOverText) {
            this.gameOverText.visible = true;
        }
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
        this.updateDebris();
        this.updateWinterSnow();
        
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
    
    updateDebris() {
        if (!this.debrisParticles) return;
        
        const positions = this.debrisParticles.geometry.attributes.position.array;
        
        for (let i = 0; i < positions.length; i += 3) {
            positions[i] += this.debrisVelocities[i];     // x
            positions[i + 1] += this.debrisVelocities[i + 1]; // y
            positions[i + 2] += this.debrisVelocities[i + 2]; // z
            
            // Reset debris that falls below ground or goes out of bounds
            if (positions[i + 1] < 0) {
                positions[i + 1] = 10;
            }
        }
        
        this.debrisParticles.geometry.attributes.position.needsUpdate = true;
    }
    
    updateWinterSnow() {
        if (!this.winterSnow) return;
        
        const positions = this.winterSnow.geometry.attributes.position.array;
        
        for (let i = 0; i < positions.length; i += 3) {
            positions[i] += this.winterSnowVelocities[i];     // x
            positions[i + 1] += this.winterSnowVelocities[i + 1]; // y
            positions[i + 2] += this.winterSnowVelocities[i + 2]; // z
            
            // Reset snow that falls below ground or goes out of bounds
            if (positions[i + 1] < 0) {
                positions[i + 1] = 20; // Reset to top
                positions[i] = (Math.random() - 0.5) * 70; // New random X position
                positions[i + 2] = (Math.random() - 0.5) * 160; // New random Z position
            }
        }
        
        this.winterSnow.geometry.attributes.position.needsUpdate = true;
    }
    
    updateGame(delta, time) {
        // Add frame counter for debugging
        if (!this.frameCount) this.frameCount = 0;
        this.frameCount++;
        // Always update player movement, even when game is not playing
        this.updatePlayerMovement(delta, time);
        
        // Update moving snowmen - straight line movement from top to bottom
        this.snowmen.forEach((snowman, snowmanIndex) => {
            // Move snowman from top to bottom
            snowman.position.z += snowman.userData.speed * delta * this.gameSpeed;
            
            // Wobble animation
            snowman.position.y = snowman.userData.originalY + 
                Math.sin(time * snowman.userData.wobble) * 0.1;
            snowman.rotation.y += delta * 2;
            
            // Reset when snowman goes past bottom of extended icy road
            if (snowman.position.z > 75) {
                snowman.position.set(
                    (Math.random() - 0.5) * 50, // Spread across wider road
                    0,
                    -80 - Math.random() * 15 // Start well above the extended road
                );
                snowman.userData.startZ = snowman.position.z;
            }
            
            // Check collision with player (bigger collision distance for bigger snowmen)
            if (this.player && snowman.position.distanceTo(this.player.position) < 6) {
                this.lives--;
                this.createCollisionEffect(this.player.position);
                
                // Reset snowman after collision
                snowman.position.set(
                    (Math.random() - 0.5) * 50,
                    0,
                    -80 - Math.random() * 15
                );
                snowman.userData.startZ = snowman.position.z;
                
                if (this.lives <= 0) {
                    this.endGame();
                }
            }
        });
        
        // Update diamonds
        this.diamonds.forEach((diamond, index) => {
            // Rotate diamond for sparkle effect
            diamond.rotation.y += diamond.userData.rotationSpeed;
            diamond.rotation.x += diamond.userData.rotationSpeed * 0.5;
            
            // Floating animation
            diamond.position.y = diamond.userData.originalY + 
                Math.sin(time * diamond.userData.floatSpeed) * diamond.userData.bobHeight;
            
            // Check collision with player
            if (this.player && diamond.position.distanceTo(this.player.position) < 2) {
                this.score += 100;
                this.createDiamondCollectEffect(diamond.position);
                this.scene.remove(diamond);
                this.diamonds.splice(index, 1);
                
                // Create new diamond
                setTimeout(() => {
                    if (this.gameState === 'playing') {
                        this.createDiamond();
                    }
                }, 2000);
            }
        });
        
        // Occasionally spawn new snowmen for more challenge
        if (Math.random() < 0.005 * this.gameSpeed * this.snowmanDensity) { // 0.5% chance per frame, scaled by game speed and density
            this.createSnowman();
        }
        
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
    
    createDiamond() {
        const group = new THREE.Group();
        
        // Create diamond shape using octahedron
        const diamondGeometry = new THREE.OctahedronGeometry(0.5, 1);
        const diamondMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x00ffff, // Cyan color
            emissive: 0x004444,
            emissiveIntensity: 0.3,
            transparent: true,
            opacity: 0.9
        });
        
        const diamond = new THREE.Mesh(diamondGeometry, diamondMaterial);
        diamond.castShadow = true;
        group.add(diamond);
        
        // Add inner glow
        const glowGeometry = new THREE.OctahedronGeometry(0.6, 1);
        const glowMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            transparent: true,
            opacity: 0.2
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        group.add(glow);
        
        // Random position on the wider road
        group.position.set(
            (Math.random() - 0.5) * 45, // Spread across wider road
            1,
            (Math.random() - 0.5) * 70 // Spread across longer road
        );
        
        group.userData = {
            rotationSpeed: Math.random() * 0.1 + 0.05,
            floatSpeed: Math.random() * 3 + 2,
            originalY: group.position.y,
            bobHeight: 0.5
        };
        
        this.scene.add(group);
        this.diamonds.push(group);
    }
    
    createGameOverText() {
        // Create GAME OVER text using planes with red text
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 1024;
        canvas.height = 256;
        
        // Clear canvas with transparent background
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Set text properties
        context.font = 'Bold 100px Arial';
        context.fillStyle = '#FF0000';
        context.strokeStyle = '#FFFFFF';
        context.lineWidth = 4;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        
        // Draw text with outline
        context.strokeText('GAME OVER', canvas.width / 2, canvas.height / 2);
        context.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
        
        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        
        // Create material and geometry
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide
        });
        
        const geometry = new THREE.PlaneGeometry(20, 5);
        this.gameOverText = new THREE.Mesh(geometry, material);
        
        // Position text in front of camera
        this.gameOverText.position.set(0, 10, 0);
        this.gameOverText.lookAt(this.camera.position);
        this.gameOverText.visible = false; // Hidden by default
        
        this.scene.add(this.gameOverText);
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
    
    createDiamondCollectEffect(position) {
        // Sparkling diamond collection effect
        for (let i = 0; i < 15; i++) {
            const sparkle = new THREE.Mesh(
                new THREE.OctahedronGeometry(0.05, 0),
                new THREE.MeshBasicMaterial({ 
                    color: Math.random() > 0.5 ? 0x00ffff : 0xffffff,
                    transparent: true,
                    opacity: 0.8
                })
            );
            sparkle.position.copy(position);
            sparkle.position.x += (Math.random() - 0.5) * 2;
            sparkle.position.y += Math.random() * 3;
            sparkle.position.z += (Math.random() - 0.5) * 2;
            
            this.scene.add(sparkle);
            
            setTimeout(() => {
                this.scene.remove(sparkle);
            }, 800);
        }
    }
    
    updateAnimations(delta, time) {
        // Player animation
        if (this.playerParts) {
            // Stick handling animation - subtle movement for realism
            this.playerParts.stickGroup.rotation.z = Math.PI / 12 + Math.sin(time * 2) * 0.1;
            this.playerParts.stickGroup.rotation.x = -Math.PI / 24 + Math.sin(time * 1.5) * 0.05;
        }
        
        // Update mixers
        this.mixers.forEach(mixer => mixer.update(delta));
    }
}

window.addEventListener('load', () => {
    new HockeyIceAdventure();
});