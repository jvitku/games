class MediaPipeTracker {
    constructor() {
        this.video = document.getElementById('webcam');
        this.trackingCanvas = document.getElementById('trackingCanvas');
        this.trackingCtx = this.trackingCanvas.getContext('2d');
        this.socket = io();
        
        this.trackingQuality = 0;
        this.isTracking = false;
        this.isMediaPipeReady = false;
        
        // Tracking modes
        this.trackingMode = 'hands'; // 'hands' or 'objects'
        this.ballPosition = { x: 0.5, y: 0.5 };
        this.lastValidPosition = { x: 0.5, y: 0.5 };
        this.positionHistory = [];
        this.maxHistorySize = 3;
        this.smoothingFactor = 0.2;
        
        // Hand tracking
        this.hands = null;
        this.handResults = null;
        
        // Object detection
        this.objectron = null;
        this.objectResults = null;
        
        // Gesture detection
        this.lastHandState = null;
        this.gestureDetected = false;
        this.gestureThreshold = 0.15;
        
        this.initWebcam();
        this.setupMediaPipe();
    }
    
    async initWebcam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: 480,
                    height: 360,
                    facingMode: 'user'
                }
            });
            this.video.srcObject = stream;
            this.video.play();
            
            this.video.addEventListener('loadeddata', () => {
                document.getElementById('status').textContent = 'MediaPipe loading...';
                this.startTracking();
            });
        } catch (error) {
            console.error('Error accessing webcam:', error);
            document.getElementById('status').textContent = 'Failed to access webcam';
        }
    }
    
    setupMediaPipe() {
        // Setup Hand tracking
        if (typeof Hands !== 'undefined') {
            this.hands = new Hands({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
            });
            
            this.hands.setOptions({
                maxNumHands: 2,
                modelComplexity: 1,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            
            this.hands.onResults((results) => this.onHandResults(results));
        }
        
        // Setup Object detection (for balls/spherical objects)
        if (typeof Objectron !== 'undefined') {
            this.objectron = new Objectron({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/objectron/${file}`
            });
            
            this.objectron.setOptions({
                modelName: 'Cup', // Cup model works well for spherical objects
                maxNumObjects: 5,
            });
            
            this.objectron.onResults((results) => this.onObjectResults(results));
        }
        
        // Initialize camera
        if (typeof Camera !== 'undefined') {
            this.camera = new Camera(this.video, {
                onFrame: async () => {
                    if (this.isTracking && this.isMediaPipeReady) {
                        if (this.trackingMode === 'hands' && this.hands) {
                            await this.hands.send({ image: this.video });
                        } else if (this.trackingMode === 'objects' && this.objectron) {
                            await this.objectron.send({ image: this.video });
                        }
                    }
                },
                width: 480,
                height: 360
            });
        }
        
        setTimeout(() => {
            this.isMediaPipeReady = true;
            document.getElementById('status').textContent = 'MediaPipe ready! Show your hand or ball to control the game.';
        }, 2000);
    }
    
    onHandResults(results) {
        this.handResults = results;
        this.trackingCtx.clearRect(0, 0, 480, 360);
        this.trackingCtx.drawImage(results.image, 0, 0, 480, 360);
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const hand = results.multiHandLandmarks[0];
            
            // Use index finger tip (landmark 8) for position control\n            const indexTip = hand[8];\n            const thumbTip = hand[4];\n            const middleTip = hand[12];\n            \n            // Calculate palm center for more stable tracking\n            const palmCenter = {\n                x: (hand[0].x + hand[5].x + hand[17].x) / 3,\n                y: (hand[0].y + hand[5].y + hand[17].y) / 3\n            };\n            \n            this.ballPosition.x = palmCenter.x;\n            this.ballPosition.y = palmCenter.y;\n            this.trackingQuality = 95; // High quality for hand tracking\n            \n            // Draw hand landmarks\n            this.drawHandLandmarks(hand);\n            \n            // Detect shooting gesture (pinch)\n            this.detectShootingGesture(thumbTip, indexTip);\n            \n            // Draw tracking indicator\n            const centerX = palmCenter.x * 480;\n            const centerY = palmCenter.y * 360;\n            this.trackingCtx.strokeStyle = '#00FF00';\n            this.trackingCtx.lineWidth = 3;\n            this.trackingCtx.strokeRect(centerX - 25, centerY - 25, 50, 50);\n            this.trackingCtx.fillStyle = '#00FF00';\n            this.trackingCtx.fillRect(centerX - 3, centerY - 3, 6, 6);\n            \n        } else {\n            this.trackingQuality = 0;\n        }\n        \n        this.updatePosition();\n    }\n    \n    onObjectResults(results) {\n        this.objectResults = results;\n        this.trackingCtx.clearRect(0, 0, 480, 360);\n        this.trackingCtx.drawImage(results.image, 0, 0, 480, 360);\n        \n        if (results.detectedObjects && results.detectedObjects.length > 0) {\n            const object = results.detectedObjects[0];\n            \n            // Calculate center of detected object\n            let centerX = 0, centerY = 0;\n            object.landmarks2d.forEach(point => {\n                centerX += point.x;\n                centerY += point.y;\n            });\n            centerX /= object.landmarks2d.length;\n            centerY /= object.landmarks2d.length;\n            \n            this.ballPosition.x = centerX;\n            this.ballPosition.y = centerY;\n            this.trackingQuality = 80; // Good quality for object tracking\n            \n            // Draw object detection box\n            this.drawObjectDetection(object);\n            \n            // Draw tracking indicator\n            const pixelX = centerX * 480;\n            const pixelY = centerY * 360;\n            this.trackingCtx.strokeStyle = '#FF6B6B';\n            this.trackingCtx.lineWidth = 3;\n            this.trackingCtx.strokeRect(pixelX - 30, pixelY - 30, 60, 60);\n            this.trackingCtx.fillStyle = '#FF6B6B';\n            this.trackingCtx.fillRect(pixelX - 4, pixelY - 4, 8, 8);\n            \n        } else {\n            this.trackingQuality = 0;\n        }\n        \n        this.updatePosition();\n    }\n    \n    drawHandLandmarks(landmarks) {\n        this.trackingCtx.fillStyle = '#FF0000';\n        this.trackingCtx.strokeStyle = '#00FF00';\n        this.trackingCtx.lineWidth = 2;\n        \n        // Draw hand connections\n        const connections = [\n            [0, 1], [1, 2], [2, 3], [3, 4], // Thumb\n            [0, 5], [5, 6], [6, 7], [7, 8], // Index\n            [0, 17], [5, 9], [9, 10], [10, 11], [11, 12], // Middle\n            [9, 13], [13, 14], [14, 15], [15, 16], // Ring\n            [13, 17], [17, 18], [18, 19], [19, 20] // Pinky\n        ];\n        \n        // Draw connections\n        connections.forEach(connection => {\n            const start = landmarks[connection[0]];\n            const end = landmarks[connection[1]];\n            \n            this.trackingCtx.beginPath();\n            this.trackingCtx.moveTo(start.x * 480, start.y * 360);\n            this.trackingCtx.lineTo(end.x * 480, end.y * 360);\n            this.trackingCtx.stroke();\n        });\n        \n        // Draw landmarks\n        landmarks.forEach(landmark => {\n            this.trackingCtx.beginPath();\n            this.trackingCtx.arc(landmark.x * 480, landmark.y * 360, 3, 0, 2 * Math.PI);\n            this.trackingCtx.fill();\n        });\n    }\n    \n    drawObjectDetection(object) {\n        this.trackingCtx.strokeStyle = '#FFD700';\n        this.trackingCtx.lineWidth = 2;\n        \n        // Draw 3D bounding box\n        if (object.landmarks2d && object.landmarks2d.length > 0) {\n            this.trackingCtx.beginPath();\n            object.landmarks2d.forEach((point, index) => {\n                const x = point.x * 480;\n                const y = point.y * 360;\n                \n                if (index === 0) {\n                    this.trackingCtx.moveTo(x, y);\n                } else {\n                    this.trackingCtx.lineTo(x, y);\n                }\n                \n                // Draw corner points\n                this.trackingCtx.fillStyle = '#FFD700';\n                this.trackingCtx.fillRect(x - 2, y - 2, 4, 4);\n            });\n            this.trackingCtx.stroke();\n        }\n    }\n    \n    detectShootingGesture(thumb, index) {\n        const distance = Math.sqrt(\n            Math.pow(thumb.x - index.x, 2) + Math.pow(thumb.y - index.y, 2)\n        );\n        \n        const currentGesture = distance < this.gestureThreshold;\n        \n        // Detect gesture change (pinch to shoot)\n        if (currentGesture && !this.gestureDetected) {\n            this.socket.emit('shoot-gesture', { shoot: true });\n            this.gestureDetected = true;\n        } else if (!currentGesture && this.gestureDetected) {\n            this.gestureDetected = false;\n        }\n        \n        // Visual feedback for gesture\n        if (currentGesture) {\n            this.trackingCtx.strokeStyle = '#FF0000';\n            this.trackingCtx.lineWidth = 4;\n            this.trackingCtx.beginPath();\n            this.trackingCtx.arc(thumb.x * 480, thumb.y * 360, 15, 0, 2 * Math.PI);\n            this.trackingCtx.stroke();\n        }\n    }\n    \n    updatePosition() {\n        // Only update if we have good tracking quality\n        if (this.trackingQuality > 30) {\n            // Add to history for smoothing\n            this.positionHistory.push({ ...this.ballPosition });\n            if (this.positionHistory.length > this.maxHistorySize) {\n                this.positionHistory.shift();\n            }\n            \n            // Average recent positions for smoothing\n            if (this.positionHistory.length > 1) {\n                let avgX = 0, avgY = 0;\n                this.positionHistory.forEach(pos => {\n                    avgX += pos.x;\n                    avgY += pos.y;\n                });\n                avgX /= this.positionHistory.length;\n                avgY /= this.positionHistory.length;\n                \n                this.ballPosition.x = avgX;\n                this.ballPosition.y = avgY;\n            }\n            \n            this.lastValidPosition = { ...this.ballPosition };\n        } else {\n            // Use last valid position if tracking quality is poor\n            this.ballPosition = { ...this.lastValidPosition };\n        }\n        \n        // Update UI\n        document.getElementById('ballPos').textContent = \n            `X: ${(this.ballPosition.x * 100).toFixed(1)}%, Y: ${(this.ballPosition.y * 100).toFixed(1)}%`;\n        document.getElementById('trackingQuality').textContent = `${this.trackingQuality.toFixed(0)}%`;\n        \n        // Send to game\n        this.socket.emit('ball-position', this.ballPosition);\n    }\n    \n    startTracking() {\n        this.isTracking = true;\n        if (this.camera && this.isMediaPipeReady) {\n            this.camera.start();\n        }\n    }\n    \n    switchTrackingMode(mode) {\n        this.trackingMode = mode;\n        document.getElementById('status').textContent = \n            `Switched to ${mode === 'hands' ? 'hand' : 'object'} tracking mode`;\n    }\n    \n    calibrate() {\n        // For MediaPipe, calibration is automatic\n        document.getElementById('status').textContent = \n            'MediaPipe calibration complete! Move your hand or show a ball to control the game.';\n    }\n}\n\nlet tracker;\n\nwindow.addEventListener('load', () => {\n    tracker = new MediaPipeTracker();\n    \n    // Update button handlers\n    document.getElementById('calibrateBtn').addEventListener('click', () => {\n        tracker.calibrate();\n    });\n    \n    // Add mode switching buttons\n    const controlsDiv = document.querySelector('.controls');\n    const handModeBtn = document.createElement('button');\n    handModeBtn.textContent = 'Hand Mode';\n    handModeBtn.addEventListener('click', () => tracker.switchTrackingMode('hands'));\n    \n    const objectModeBtn = document.createElement('button');\n    objectModeBtn.textContent = 'Ball Mode';\n    objectModeBtn.addEventListener('click', () => tracker.switchTrackingMode('objects'));\n    \n    controlsDiv.appendChild(handModeBtn);\n    controlsDiv.appendChild(objectModeBtn);\n});