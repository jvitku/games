class ImprovedMediaPipeTracker {
    constructor() {
        this.video = document.getElementById('webcam');
        this.trackingCanvas = document.getElementById('trackingCanvas');
        this.trackingCtx = this.trackingCanvas.getContext('2d');
        this.socket = io();
        
        this.trackingQuality = 0;
        this.isTracking = false;
        this.isMediaPipeReady = false;
        this.isCalibrated = false;
        
        // High resolution for better tracking
        this.width = 640;
        this.height = 480;
        
        // Ball tracking configuration
        this.ballPosition = { x: 0.5, y: 0.5 };
        this.lastValidPosition = { x: 0.5, y: 0.5 };
        this.positionHistory = [];
        this.maxHistorySize = 5;
        this.jumpThreshold = 0.15;
        this.minObjectSize = 300; // Minimum area for object detection
        
        // Color calibration for ball tracking
        this.targetColor = null;
        this.colorTolerance = 40;
        
        // MediaPipe instances
        this.hands = null;
        this.objectron = null;
        this.camera = null;
        
        // Tracking modes
        this.trackingMode = 'ball'; // 'hands' or 'ball'
        
        this.initWebcam();
        this.setupMediaPipe();
    }
    
    async initWebcam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280, min: 640 },
                    height: { ideal: 720, min: 480 },
                    facingMode: 'user',
                    frameRate: { ideal: 30 }
                }
            });
            this.video.srcObject = stream;
            this.video.play();
            
            this.video.addEventListener('loadeddata', () => {
                console.log('Video loaded, dimensions:', this.video.videoWidth, 'x', this.video.videoHeight);
                document.getElementById('status').textContent = 'High-res webcam ready, MediaPipe loading...';
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
                maxNumHands: 1,
                modelComplexity: 1,
                minDetectionConfidence: 0.8,
                minTrackingConfidence: 0.8
            });
            
            this.hands.onResults((results) => this.onHandResults(results));
        }
        
        // Setup Object detection for balls
        if (typeof Objectron !== 'undefined') {
            this.objectron = new Objectron({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/objectron/${file}`
            });
            
            this.objectron.setOptions({
                modelName: 'Cup',
                maxNumObjects: 1,
                minDetectionConfidence: 0.6
            });
            
            this.objectron.onResults((results) => this.onObjectResults(results));
        }
        
        setTimeout(() => {
            this.isMediaPipeReady = true;
            document.getElementById('status').textContent = 'MediaPipe ready! Choose tracking mode and calibrate.';
        }, 3000);
    }
    
    onHandResults(results) {
        // Clear and draw video (mirrored)
        this.trackingCtx.save();
        this.trackingCtx.scale(-1, 1);
        this.trackingCtx.drawImage(results.image, -this.width, 0, this.width, this.height);
        this.trackingCtx.restore();
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const hand = results.multiHandLandmarks[0];
            
            // Use index finger tip for precise control
            const indexTip = hand[8];
            
            // Mirror the X coordinate
            const position = {
                x: 1 - indexTip.x, // Mirror horizontally
                y: indexTip.y
            };
            
            this.applyPositionWithSmoothing(position);
            this.trackingQuality = 95;
            
            // Draw hand landmarks (mirrored)
            this.drawHandLandmarks(hand, true);
            
            // Draw tracking indicator
            this.drawTrackingIndicator(position, '#00FF00', 25);
            
        } else {
            this.trackingQuality = 0;
        }
        
        this.updateUI();
    }
    
    onObjectResults(results) {
        // Clear and draw video (mirrored)
        this.trackingCtx.save();
        this.trackingCtx.scale(-1, 1);
        this.trackingCtx.drawImage(results.image, -this.width, 0, this.width, this.height);
        this.trackingCtx.restore();
        
        if (results.detectedObjects && results.detectedObjects.length > 0) {
            const object = results.detectedObjects[0];
            
            // Calculate center of detected object
            let centerX = 0, centerY = 0;
            object.landmarks2d.forEach(point => {
                centerX += point.x;
                centerY += point.y;
            });
            
            const position = {
                x: 1 - (centerX / object.landmarks2d.length), // Mirror horizontally
                y: centerY / object.landmarks2d.length
            };
            
            this.applyPositionWithSmoothing(position);
            this.trackingQuality = 80;
            
            // Draw object detection (mirrored)
            this.drawObjectDetection(object, true);
            
            // Draw tracking indicator
            this.drawTrackingIndicator(position, '#FF6B6B', 30);
            
        } else {
            this.trackingQuality = 0;
            // Fallback to color-based tracking
            this.fallbackColorTracking();
        }
        
        this.updateUI();
    }
    
    fallbackColorTracking() {
        if (!this.isCalibrated || !this.targetColor) return;
        
        const imageData = this.trackingCtx.getImageData(0, 0, this.width, this.height);
        const data = imageData.data;
        
        let bestMatch = { x: this.width/2, y: this.height/2, score: -1, area: 0 };
        const step = 4;
        const regionSize = 8; // Size of region to analyze around each point
        
        for (let y = regionSize; y < this.height - regionSize; y += step) {
            for (let x = regionSize; x < this.width - regionSize; x += step) {
                const colorScore = this.getRegionColorScore(data, x, y, regionSize);
                const objectScore = this.getObjectScore(data, x, y, regionSize);
                const totalScore = colorScore * 0.7 + objectScore * 0.3;
                
                if (totalScore > bestMatch.score && totalScore > 0.5) {
                    const area = this.estimateObjectArea(data, x, y);
                    if (area > this.minObjectSize) {
                        bestMatch = { x, y, score: totalScore, area };
                    }
                }
            }
        }
        
        if (bestMatch.score > 0.5) {
            const position = {
                x: 1 - (bestMatch.x / this.width), // Mirror horizontally
                y: bestMatch.y / this.height
            };
            
            this.applyPositionWithSmoothing(position);
            this.trackingQuality = bestMatch.score * 80;
            
            // Draw tracking visualization
            this.drawBallTracking(bestMatch.x, bestMatch.y, bestMatch.area);
        } else {
            this.trackingQuality = Math.max(0, this.trackingQuality - 10);
        }
    }
    
    getRegionColorScore(data, centerX, centerY, regionSize) {
        if (!this.targetColor) return 0;
        
        let totalScore = 0;
        let pixelCount = 0;
        
        for (let dy = -regionSize; dy <= regionSize; dy += 2) {
            for (let dx = -regionSize; dx <= regionSize; dx += 2) {
                const x = centerX + dx;
                const y = centerY + dy;
                
                if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                    const index = (y * this.width + x) * 4;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];
                    
                    const hsv = this.rgbToHsv(r, g, b);
                    const colorScore = this.getColorScore(hsv);
                    
                    totalScore += colorScore;
                    pixelCount++;
                }
            }
        }
        
        return pixelCount > 0 ? totalScore / pixelCount : 0;
    }
    
    getObjectScore(data, centerX, centerY, regionSize) {
        // Check for round/circular patterns
        let edgeScore = 0;
        let consistencyScore = 0;
        let checkCount = 0;
        
        const centerIndex = (centerY * this.width + centerX) * 4;
        const centerR = data[centerIndex];
        const centerG = data[centerIndex + 1];
        const centerB = data[centerIndex + 2];
        
        // Check circular pattern
        for (let angle = 0; angle < 360; angle += 45) {
            const rad = (angle * Math.PI) / 180;
            const x = Math.round(centerX + Math.cos(rad) * regionSize);
            const y = Math.round(centerY + Math.sin(rad) * regionSize);
            
            if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                const index = (y * this.width + x) * 4;
                const r = data[index];
                const g = data[index + 1];
                const b = data[index + 2];
                
                // Color consistency with center
                const colorDiff = Math.abs(r - centerR) + Math.abs(g - centerG) + Math.abs(b - centerB);
                if (colorDiff < 80) consistencyScore++;
                
                checkCount++;
            }
        }
        
        return checkCount > 0 ? consistencyScore / checkCount : 0;
    }
    
    estimateObjectArea(data, centerX, centerY) {
        // Flood fill to estimate object size
        const visited = new Set();
        const toCheck = [{x: centerX, y: centerY}];
        const centerIndex = (centerY * this.width + centerX) * 4;
        const targetR = data[centerIndex];
        const targetG = data[centerIndex + 1];
        const targetB = data[centerIndex + 2];
        const tolerance = 60;
        let area = 0;
        const maxArea = 2000; // Prevent infinite loops
        
        while (toCheck.length > 0 && area < maxArea) {
            const {x, y} = toCheck.pop();
            const key = `${x},${y}`;
            
            if (visited.has(key) || x < 0 || x >= this.width || y < 0 || y >= this.height) {
                continue;
            }
            
            const index = (y * this.width + x) * 4;
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            
            const colorDiff = Math.abs(r - targetR) + Math.abs(g - targetG) + Math.abs(b - targetB);
            
            if (colorDiff < tolerance) {
                visited.add(key);
                area++;
                
                // Add neighbors (limited to prevent performance issues)
                if (area < maxArea) {
                    toCheck.push({x: x+2, y}, {x: x-2, y}, {x, y: y+2}, {x, y: y-2});
                }
            }
        }
        
        return area * 4; // Approximate actual area
    }
    
    applyPositionWithSmoothing(newPosition) {
        // Check for sudden jumps
        const distance = Math.sqrt(
            Math.pow(newPosition.x - this.lastValidPosition.x, 2) + 
            Math.pow(newPosition.y - this.lastValidPosition.y, 2)
        );
        
        // If jump is too large, apply gradually
        if (distance > this.jumpThreshold) {
            const factor = this.jumpThreshold / distance;
            newPosition.x = this.lastValidPosition.x + (newPosition.x - this.lastValidPosition.x) * factor;
            newPosition.y = this.lastValidPosition.y + (newPosition.y - this.lastValidPosition.y) * factor;
        }
        
        // Add to history for smoothing
        this.positionHistory.push({ ...newPosition });
        if (this.positionHistory.length > this.maxHistorySize) {
            this.positionHistory.shift();
        }
        
        // Calculate weighted average
        let totalX = 0, totalY = 0, totalWeight = 0;
        this.positionHistory.forEach((pos, index) => {
            const weight = Math.pow(1.8, index); // Strong weighting toward recent positions
            totalX += pos.x * weight;
            totalY += pos.y * weight;
            totalWeight += weight;
        });
        
        this.ballPosition.x = totalX / totalWeight;
        this.ballPosition.y = totalY / totalWeight;
        this.lastValidPosition = { ...this.ballPosition };
    }
    
    drawHandLandmarks(landmarks, mirrored = false) {
        this.trackingCtx.fillStyle = '#FF0000';
        this.trackingCtx.strokeStyle = '#00FF00';
        this.trackingCtx.lineWidth = 2;
        
        // Draw landmarks
        landmarks.forEach(landmark => {
            const x = mirrored ? (1 - landmark.x) * this.width : landmark.x * this.width;
            const y = landmark.y * this.height;
            
            this.trackingCtx.beginPath();
            this.trackingCtx.arc(x, y, 3, 0, 2 * Math.PI);
            this.trackingCtx.fill();
        });
        
        // Highlight index finger tip
        const indexTip = landmarks[8];
        const x = mirrored ? (1 - indexTip.x) * this.width : indexTip.x * this.width;
        const y = indexTip.y * this.height;
        
        this.trackingCtx.strokeStyle = '#FFFF00';
        this.trackingCtx.lineWidth = 4;
        this.trackingCtx.beginPath();
        this.trackingCtx.arc(x, y, 12, 0, 2 * Math.PI);
        this.trackingCtx.stroke();
    }
    
    drawObjectDetection(object, mirrored = false) {
        this.trackingCtx.strokeStyle = '#FFD700';
        this.trackingCtx.lineWidth = 2;
        
        if (object.landmarks2d && object.landmarks2d.length > 0) {
            this.trackingCtx.beginPath();
            object.landmarks2d.forEach((point, index) => {
                const x = mirrored ? (1 - point.x) * this.width : point.x * this.width;
                const y = point.y * this.height;
                
                if (index === 0) {
                    this.trackingCtx.moveTo(x, y);
                } else {
                    this.trackingCtx.lineTo(x, y);
                }
                
                // Draw corner points
                this.trackingCtx.fillStyle = '#FFD700';
                this.trackingCtx.fillRect(x - 3, y - 3, 6, 6);
            });
            this.trackingCtx.closePath();
            this.trackingCtx.stroke();
        }
    }
    
    drawTrackingIndicator(position, color, size) {
        const centerX = position.x * this.width;
        const centerY = position.y * this.height;
        
        this.trackingCtx.strokeStyle = color;
        this.trackingCtx.lineWidth = 3;
        this.trackingCtx.strokeRect(centerX - size, centerY - size, size * 2, size * 2);
        
        this.trackingCtx.fillStyle = color;
        this.trackingCtx.fillRect(centerX - 4, centerY - 4, 8, 8);
        
        // Draw crosshair
        this.trackingCtx.beginPath();
        this.trackingCtx.moveTo(centerX - size/2, centerY);
        this.trackingCtx.lineTo(centerX + size/2, centerY);
        this.trackingCtx.moveTo(centerX, centerY - size/2);
        this.trackingCtx.lineTo(centerX, centerY + size/2);
        this.trackingCtx.stroke();
    }
    
    drawBallTracking(x, y, area) {
        this.trackingCtx.strokeStyle = '#00FFFF';
        this.trackingCtx.lineWidth = 3;
        const size = Math.max(20, Math.min(50, Math.sqrt(area) / 5));
        this.trackingCtx.strokeRect(x - size, y - size, size * 2, size * 2);
        
        this.trackingCtx.fillStyle = '#00FFFF';
        this.trackingCtx.fillRect(x - 3, y - 3, 6, 6);
        
        // Show area
        this.trackingCtx.fillStyle = '#FFFFFF';
        this.trackingCtx.font = '12px Arial';
        this.trackingCtx.fillText(`${Math.round(area)}px`, x + 25, y - 25);
    }
    
    rgbToHsv(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const diff = max - min;
        
        let h = 0;
        if (diff !== 0) {
            if (max === r) h = ((g - b) / diff) % 6;
            else if (max === g) h = (b - r) / diff + 2;
            else h = (r - g) / diff + 4;
        }
        h = Math.round(h * 60);
        if (h < 0) h += 360;
        
        const s = max === 0 ? 0 : diff / max;
        const v = max;
        
        return { h: h / 2, s: s * 100, v: v * 100 };
    }
    
    getColorScore(hsv) {
        if (!this.targetColor) return 0;
        
        const hueDiff = Math.min(
            Math.abs(hsv.h - this.targetColor.h),
            360 - Math.abs(hsv.h - this.targetColor.h)
        );
        const satDiff = Math.abs(hsv.s - this.targetColor.s);
        const valDiff = Math.abs(hsv.v - this.targetColor.v);
        
        const hueScore = Math.max(0, 1 - hueDiff / this.colorTolerance);
        const satScore = Math.max(0, 1 - satDiff / 50);
        const valScore = Math.max(0, 1 - valDiff / 50);
        
        return (hueScore * 0.6 + satScore * 0.2 + valScore * 0.2);
    }
    
    startTracking() {
        this.isTracking = true;
        this.trackingLoop();
    }
    
    trackingLoop() {
        if (!this.isTracking) return;
        
        if (this.video.readyState === this.video.HAVE_ENOUGH_DATA && this.isMediaPipeReady) {
            try {
                if (this.trackingMode === 'hands' && this.hands) {
                    this.hands.send({ image: this.video });
                } else if (this.trackingMode === 'ball' && this.objectron) {
                    this.objectron.send({ image: this.video });
                }
            } catch (error) {
                console.error('MediaPipe error:', error);
                this.fallbackColorTracking();
            }
        } else {
            // Draw video while waiting for MediaPipe
            this.trackingCtx.save();
            this.trackingCtx.scale(-1, 1);
            this.trackingCtx.drawImage(this.video, -this.width, 0, this.width, this.height);
            this.trackingCtx.restore();
        }
        
        requestAnimationFrame(() => this.trackingLoop());
    }
    
    updateUI() {
        if (this.trackingQuality > 30) {
            this.socket.emit('ball-position', this.ballPosition);
        }
        
        document.getElementById('ballPos').textContent = 
            `X: ${(this.ballPosition.x * 100).toFixed(1)}%, Y: ${(this.ballPosition.y * 100).toFixed(1)}%`;
        document.getElementById('trackingQuality').textContent = `${this.trackingQuality.toFixed(0)}%`;
    }
    
    switchTrackingMode(mode) {
        this.trackingMode = mode;
        this.positionHistory = [];
        document.getElementById('status').textContent = 
            `Switched to ${mode === 'hands' ? 'hand' : 'ball'} tracking mode`;
    }
    
    calibrateBallColor(x, y) {
        // Adjust for mirrored display
        const actualX = this.width - x;
        const imageData = this.trackingCtx.getImageData(actualX, y, 1, 1);
        const data = imageData.data;
        const hsv = this.rgbToHsv(data[0], data[1], data[2]);
        
        this.targetColor = hsv;
        this.isCalibrated = true;
        this.positionHistory = [];
        
        document.getElementById('status').textContent = 
            `Ball calibrated! H:${Math.round(hsv.h)} S:${Math.round(hsv.s)} V:${Math.round(hsv.v)}`;
    }
    
    calibrate() {
        this.positionHistory = [];
        this.ballPosition = { x: 0.5, y: 0.5 };
        this.lastValidPosition = { x: 0.5, y: 0.5 };
        document.getElementById('status').textContent = 
            `Ready to calibrate! Click on object to track (${this.trackingMode} mode)`;
    }
}

let tracker;

window.addEventListener('load', () => {
    tracker = new ImprovedMediaPipeTracker();
    
    document.getElementById('calibrateBtn').addEventListener('click', () => {
        tracker.calibrate();
    });
    
    document.getElementById('trackingCanvas').addEventListener('click', (e) => {
        const rect = e.target.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (640 / rect.width);
        const y = (e.clientY - rect.top) * (480 / rect.height);
        
        if (tracker.trackingMode === 'ball') {
            tracker.calibrateBallColor(x, y);
        }
    });
    
    // Add mode switching buttons
    const controlsDiv = document.querySelector('.controls');
    const handModeBtn = document.createElement('button');
    handModeBtn.textContent = 'Hand Mode';
    handModeBtn.addEventListener('click', () => tracker.switchTrackingMode('hands'));
    
    const ballModeBtn = document.createElement('button');
    ballModeBtn.textContent = 'Ball Mode';
    ballModeBtn.addEventListener('click', () => tracker.switchTrackingMode('ball'));
    
    controlsDiv.appendChild(handModeBtn);
    controlsDiv.appendChild(ballModeBtn);
});