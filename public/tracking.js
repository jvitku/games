// Define global OpenCV callback FIRST, before anything else
function onOpenCvReady() {
    console.log('OpenCV.js is ready');
    if (typeof tracker !== 'undefined' && tracker && typeof tracker.onOpenCVReady === 'function') {
        tracker.onOpenCVReady();
    } else {
        console.log('Tracker not ready yet, will be called later when tracker initializes');
    }
}
window.onOpenCvReady = onOpenCvReady;

class OpenCVBallTracker {
    constructor() {
        console.log('=== INITIALIZING OpenCVBallTracker ===');
        
        // Check browser environment
        console.log('Current URL:', window.location.href);
        console.log('Is HTTPS:', window.location.protocol === 'https:');
        console.log('Is localhost:', window.location.hostname === 'localhost');
        console.log('Navigator userAgent:', navigator.userAgent);
        console.log('Navigator mediaDevices available:', !!navigator.mediaDevices);
        
        this.video = document.getElementById('webcam');
        this.trackingCanvas = document.getElementById('trackingCanvas');
        this.trackingCtx = this.trackingCanvas.getContext('2d');
        this.socket = io();
        
        console.log('Video element:', this.video);
        console.log('Canvas element:', this.trackingCanvas);
        console.log('Canvas context:', this.trackingCtx);
        console.log('Socket:', this.socket);
        
        this.trackingQuality = 0;
        this.isTracking = false;
        this.isOpenCVReady = false;
        this.isCalibrated = false;
        this.calibrationMode = false;
        this.boundingBoxMode = false;
        this.boundingBox = { startX: 0, startY: 0, endX: 0, endY: 0, isDrawing: false };
        
        // High resolution for better tracking
        this.width = 640;
        this.height = 480;
        
        // Ball tracking configuration
        this.ballPosition = { x: 0.5, y: 0.5 };
        this.lastValidPosition = { x: 0.5, y: 0.5 };
        this.positionHistory = [];
        this.maxHistorySize = 5;
        this.jumpThreshold = 0.12; // Stricter jump detection
        
        // Enhanced color calibration for arbitrary object tracking
        this.targetColor = null;
        this.colorTolerance = { h: 30, s: 100, v: 100 }; // Much more flexible for various objects
        this.minContourArea = 100; // Much lower minimum for any size objects
        this.maxContourArea = 25000; // Higher maximum for larger objects
        this.adaptiveThresholds = true; // Enable adaptive color matching
        
        // OpenCV matrices
        this.src = null;
        this.hsv = null;
        this.mask = null;
        this.contours = null;
        this.hierarchy = null;
        
        console.log('About to call initWebcam()');
        this.initWebcam().catch(error => {
            console.error('initWebcam failed:', error);
        });
    }
    
    async initWebcam() {
        try {
            console.log('=== INITIALIZING WEBCAM ===');
            
            // Check if getUserMedia is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('getUserMedia not supported in this browser');
            }
            
            console.log('getUserMedia available, requesting user media...');
            console.log('navigator.mediaDevices:', navigator.mediaDevices);
            
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280, min: 640 },
                    height: { ideal: 720, min: 480 },
                    facingMode: 'user',
                    frameRate: { ideal: 30 }
                }
            });
            
            console.log('Got media stream:', stream);
            this.video.srcObject = stream;
            
            console.log('Starting video playback...');
            await this.video.play();
            
            this.video.addEventListener('loadeddata', () => {
                console.log('Video loaded, dimensions:', this.video.videoWidth, 'x', this.video.videoHeight);
                console.log('Video readyState:', this.video.readyState);
                document.getElementById('status').textContent = 'Webcam ready, waiting for OpenCV...';
                this.startTracking();
            });
            
            this.video.addEventListener('canplay', () => {
                console.log('Video can start playing');
            });
            
            this.video.addEventListener('playing', () => {
                console.log('Video is now playing');
            });
            
        } catch (error) {
            console.error('Error accessing webcam:', error);
            document.getElementById('status').textContent = 'Failed to access webcam: ' + error.message;
        }
    }
    
    onOpenCVReady() {
        this.isOpenCVReady = true;
        this.initializeOpenCVMatrices();
        document.getElementById('status').textContent = 'OpenCV ready! Click Calibrate to start ball tracking.';
    }
    
    initializeOpenCVMatrices() {
        try {
            // Initialize OpenCV matrices for processing
            this.src = new cv.Mat(this.height, this.width, cv.CV_8UC4);
            this.hsv = new cv.Mat(this.height, this.width, cv.CV_8UC3);
            this.mask = new cv.Mat(this.height, this.width, cv.CV_8UC1);
            this.contours = new cv.MatVector();
            this.hierarchy = new cv.Mat();
        } catch (error) {
            console.error('Error initializing OpenCV matrices:', error);
        }
    }
    
    startTracking() {
        console.log('=== STARTING TRACKING LOOP ===');
        this.isTracking = true;
        this.trackingLoop();
    }
    
    trackingLoop() {
        if (!this.isTracking) return;
        
        // Debug: Log every 60 frames (about once per second at 60fps)
        if (!this.frameCount) this.frameCount = 0;
        this.frameCount++;
        if (this.frameCount % 60 === 0) {
            console.log('Tracking loop running, frame:', this.frameCount, 'video ready:', this.video.readyState);
        }
        
        try {
            // Always draw video frame first
            if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
                this.trackingCtx.save();
                this.trackingCtx.scale(-1, 1);
                this.trackingCtx.drawImage(this.video, -this.width, 0, this.width, this.height);
                this.trackingCtx.restore();
            } else {
                // Debug info when video not ready
                console.log('Video not ready, readyState:', this.video.readyState);
                // Fill with grey background to show canvas is working
                this.trackingCtx.fillStyle = '#333333';
                this.trackingCtx.fillRect(0, 0, this.width, this.height);
                
                // Show status text
                this.trackingCtx.fillStyle = '#FFFFFF';
                this.trackingCtx.font = 'bold 24px Arial';
                this.trackingCtx.textAlign = 'center';
                this.trackingCtx.fillText('Loading camera...', this.width/2, this.height/2);
                this.trackingCtx.textAlign = 'left';
            }
            
            // Perform object tracking if calibrated
            if (this.isCalibrated && this.targetColor) {
                console.log('Tracking calibrated object:', this.targetColor);
                if (this.isOpenCVReady && typeof cv !== 'undefined') {
                    this.performBallTracking();
                } else {
                    // Simple fallback color tracking without OpenCV
                    this.performSimpleColorTracking();
                }
            } else if (this.isCalibrated) {
                console.log('Calibrated but no target color set');
            }
            
            // Draw calibration overlay if in calibration mode
            if (this.calibrationMode) {
                this.drawCalibrationOverlay();
                if (this.boundingBoxMode) {
                    this.drawBoundingBox();
                }
            }
            
            // Update UI
            this.updateUI();
            
        } catch (error) {
            console.error('Tracking loop error:', error);
        }
        
        requestAnimationFrame(() => this.trackingLoop());
    }
    
    performBallTracking() {
        try {
            // Get image data from canvas (after video is drawn)
            const imageData = this.trackingCtx.getImageData(0, 0, this.width, this.height);
            
            // Convert to OpenCV mat
            this.src.data.set(imageData.data);
            
            // Convert RGBA to HSV
            let rgb = new cv.Mat();
            cv.cvtColor(this.src, rgb, cv.COLOR_RGBA2RGB);
            cv.cvtColor(rgb, this.hsv, cv.COLOR_RGB2HSV);
            
            // Create more generous scalar values for color range
            const lowerBound = new cv.Scalar(
                Math.max(0, this.targetColor.h - this.colorTolerance.h * 1.2),
                Math.max(0, this.targetColor.s - this.colorTolerance.s * 1.2),
                Math.max(0, this.targetColor.v - this.colorTolerance.v * 1.2)
            );
            
            const upperBound = new cv.Scalar(
                Math.min(179, this.targetColor.h + this.colorTolerance.h * 1.2),
                Math.min(255, this.targetColor.s + this.colorTolerance.s * 1.2),
                Math.min(255, this.targetColor.v + this.colorTolerance.v * 1.2)
            );
            
            console.log('OpenCV color bounds:', {
                lower: [lowerBound.val[0], lowerBound.val[1], lowerBound.val[2]], 
                upper: [upperBound.val[0], upperBound.val[1], upperBound.val[2]],
                target: [this.targetColor.h, this.targetColor.s, this.targetColor.v]
            });
            
            // Create mask for target color
            cv.inRange(this.hsv, lowerBound, upperBound, this.mask);
            
            // Less aggressive morphological operations to preserve more details
            const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
            cv.morphologyEx(this.mask, this.mask, cv.MORPH_CLOSE, kernel);
            
            // Apply Gaussian blur to make detection more forgiving
            cv.GaussianBlur(this.mask, this.mask, new cv.Size(3, 3), 0);
            
            // Find contours
            cv.findContours(this.mask, this.contours, this.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            
            // Find the best contour (prefer size similar to calibrated object)
            let bestContour = null;
            let maxScore = 0;
            let bestCenter = null;
            
            for (let i = 0; i < this.contours.size(); i++) {
                const contour = this.contours.get(i);
                const area = cv.contourArea(contour);
                
                if (area > this.minContourArea && area < this.maxContourArea) {
                    // Score based on area size and similarity to expected size
                    let score = area;
                    
                    // Bonus for similarity to expected size from calibration
                    if (this.expectedSize && this.expectedSize.area) {
                        const sizeRatio = Math.min(area / this.expectedSize.area, this.expectedSize.area / area);
                        score *= (0.5 + sizeRatio * 0.5); // Bonus for size similarity
                    }
                    
                    if (score > maxScore) {
                        maxScore = score;
                        bestContour = contour;
                    }
                }
            }
            
            if (bestContour && maxScore > 0) {
                // Get moments to find centroid
                const moments = cv.moments(bestContour);
                if (moments.m00 > 0) {
                    const centerX = moments.m10 / moments.m00;
                    const centerY = moments.m01 / moments.m00;
                    bestCenter = {x: centerX, y: centerY};
                    
                    const position = {
                        x: centerX / this.width, // Don't mirror - video is already mirrored
                        y: centerY / this.height
                    };
                    
                    this.applyPositionWithSmoothing(position);
                    const currentArea = cv.contourArea(bestContour);
                    this.trackingQuality = Math.min(95, (currentArea / 50) * 10);
                    
                    // Draw tracking visualization 
                    this.drawObjectTracking(centerX, centerY, currentArea);
                }
            } else {
                // More gradual quality degradation
                this.trackingQuality = Math.max(0, this.trackingQuality - 2);
                console.log('No contours found. Tracking quality:', this.trackingQuality);
            }
            
            // Cleanup temporary matrices
            rgb.delete();
            kernel.delete();
            
        } catch (error) {
            console.error('Ball tracking error:', error);
            this.trackingQuality = Math.max(0, this.trackingQuality - 10);
        }
    }
    
    performSimpleColorTracking() {
        try {
            const imageData = this.trackingCtx.getImageData(0, 0, this.width, this.height);
            const data = imageData.data;
            
            // Convert target HSV back to RGB for comparison
            const targetRGB = this.hsvToRgb(this.targetColor.h * 2, this.targetColor.s / 255, this.targetColor.v / 255);
            
            let clusters = [];
            const step = 6; // Smaller step for better detection
            const tolerance = 80; // Much more tolerant for better detection
            const minClusterSize = 8; // Even lower requirement for easier detection
            
            console.log('Target RGB for tracking:', targetRGB);
            console.log('Using tolerances - RGB:', tolerance, 'HSV:', this.colorTolerance);
            
            // Find all matching pixels
            for (let y = 0; y < this.height; y += step) {
                for (let x = 0; x < this.width; x += step) {
                    const index = (y * this.width + x) * 4;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];
                    
                    // Try both RGB and HSV matching for better results
                    const colorDist = Math.sqrt(
                        Math.pow(r - targetRGB.r, 2) + 
                        Math.pow(g - targetRGB.g, 2) + 
                        Math.pow(b - targetRGB.b, 2)
                    );
                    
                    // Also check HSV distance
                    const pixelHSV = this.rgbToHsv(r, g, b);
                    const hsvMatch = (
                        Math.abs(pixelHSV.h - this.targetColor.h) <= this.colorTolerance.h &&
                        Math.abs(pixelHSV.s - this.targetColor.s) <= this.colorTolerance.s &&
                        Math.abs(pixelHSV.v - this.targetColor.v) <= this.colorTolerance.v
                    );
                    
                    if (colorDist < tolerance || hsvMatch) {
                        // Count nearby matching pixels in circular area
                        let nearbyMatches = 0;
                        const searchRadius = 20;
                        
                        for (let dy = -searchRadius; dy <= searchRadius; dy += step) {
                            for (let dx = -searchRadius; dx <= searchRadius; dx += step) {
                                // Check if pixel is within circular radius
                                if (dx*dx + dy*dy <= searchRadius*searchRadius) {
                                    const nx = x + dx;
                                    const ny = y + dy;
                                    if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
                                        const nindex = (ny * this.width + nx) * 4;
                                        const nr = data[nindex];
                                        const ng = data[nindex + 1];
                                        const nb = data[nindex + 2];
                                        
                                        const nColorDist = Math.sqrt(
                                            Math.pow(nr - targetRGB.r, 2) + 
                                            Math.pow(ng - targetRGB.g, 2) + 
                                            Math.pow(nb - targetRGB.b, 2)
                                        );
                                        
                                        const nPixelHSV = this.rgbToHsv(nr, ng, nb);
                                        const nHsvMatch = (
                                            Math.abs(nPixelHSV.h - this.targetColor.h) <= this.colorTolerance.h &&
                                            Math.abs(nPixelHSV.s - this.targetColor.s) <= this.colorTolerance.s &&
                                            Math.abs(nPixelHSV.v - this.targetColor.v) <= this.colorTolerance.v
                                        );
                                        
                                        if (nColorDist < tolerance || nHsvMatch) nearbyMatches++;
                                    }
                                }
                            }
                        }
                        
                        if (nearbyMatches >= minClusterSize) {
                            clusters.push({
                                x: x,
                                y: y,
                                density: nearbyMatches,
                                score: (tolerance - colorDist) / tolerance
                            });
                        }
                    }
                }
            }
            
            // Find the best cluster, prioritizing proximity to last known position
            if (clusters.length > 0) {
                let bestCluster;
                
                if (this.trackingQuality > 0) {
                    // If we have a previous position, prefer nearby clusters
                    const lastX = this.lastValidPosition.x * this.width;
                    const lastY = this.lastValidPosition.y * this.height;
                    
                    bestCluster = clusters.reduce((prev, current) => {
                        const prevDist = Math.sqrt(Math.pow(prev.x - lastX, 2) + Math.pow(prev.y - lastY, 2));
                        const currDist = Math.sqrt(Math.pow(current.x - lastX, 2) + Math.pow(current.y - lastY, 2));
                        
                        // Combine density score with proximity score (closer is better)
                        const prevScore = prev.density - (prevDist * 0.1);
                        const currScore = current.density - (currDist * 0.1);
                        
                        return currScore > prevScore ? current : prev;
                    });
                    
                    // Reject if the best cluster is too far from last position
                    const distToLast = Math.sqrt(
                        Math.pow(bestCluster.x - lastX, 2) + Math.pow(bestCluster.y - lastY, 2)
                    );
                    
                    if (distToLast > 100) { // Max pixel distance for continuity
                        console.log('Best cluster too far from last position, rejecting');
                        this.trackingQuality = Math.max(0, this.trackingQuality - 15);
                        return;
                    }
                } else {
                    // No previous position, just use highest density
                    bestCluster = clusters.reduce((prev, current) => 
                        (current.density > prev.density) ? current : prev
                    );
                }
                
                console.log('Best cluster found:', bestCluster);
                
                const position = {
                    x: bestCluster.x / this.width, // Don't mirror - video is already mirrored
                    y: bestCluster.y / this.height
                };
                
                this.applyPositionWithSmoothing(position);
                this.trackingQuality = Math.min(95, (bestCluster.density / minClusterSize) * 30);
                
                // Draw tracking visualization 
                this.drawObjectTracking(bestCluster.x, bestCluster.y, bestCluster.density * 15);
            } else {
                this.trackingQuality = Math.max(0, this.trackingQuality - 8);
                console.log('No valid clusters found');
            }
            
        } catch (error) {
            console.error('Simple color tracking error:', error);
            this.trackingQuality = Math.max(0, this.trackingQuality - 10);
        }
    }
    
    hsvToRgb(h, s, v) {
        const c = v * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = v - c;
        
        let r, g, b;
        if (h >= 0 && h < 60) {
            r = c; g = x; b = 0;
        } else if (h >= 60 && h < 120) {
            r = x; g = c; b = 0;
        } else if (h >= 120 && h < 180) {
            r = 0; g = c; b = x;
        } else if (h >= 180 && h < 240) {
            r = 0; g = x; b = c;
        } else if (h >= 240 && h < 300) {
            r = x; g = 0; b = c;
        } else {
            r = c; g = 0; b = x;
        }
        
        return {
            r: Math.round((r + m) * 255),
            g: Math.round((g + m) * 255),
            b: Math.round((b + m) * 255)
        };
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
            const weight = Math.pow(1.8, index);
            totalX += pos.x * weight;
            totalY += pos.y * weight;
            totalWeight += weight;
        });
        
        this.ballPosition.x = totalX / totalWeight;
        this.ballPosition.y = totalY / totalWeight;
        this.lastValidPosition = { ...this.ballPosition };
    }
    
    drawObjectTracking(x, y, area) {
        try {
            // Make tracking marker much more visible and adaptive
            const size = Math.max(25, Math.min(100, Math.sqrt(area) / 2));
            
            // Dynamic color based on tracking quality
            const qualityColor = this.trackingQuality > 70 ? '#00FF00' : 
                                this.trackingQuality > 40 ? '#FFFF00' : '#FF8800';
            
            // Draw adaptive tracking circle
            this.trackingCtx.strokeStyle = qualityColor;
            this.trackingCtx.lineWidth = 5;
            this.trackingCtx.beginPath();
            this.trackingCtx.arc(x, y, size, 0, 2 * Math.PI);
            this.trackingCtx.stroke();
            
            // Draw center dot
            this.trackingCtx.fillStyle = qualityColor;
            this.trackingCtx.beginPath();
            this.trackingCtx.arc(x, y, 6, 0, 2 * Math.PI);
            this.trackingCtx.fill();
            
            // Draw crosshair
            this.trackingCtx.strokeStyle = '#FF00FF';
            this.trackingCtx.lineWidth = 3;
            this.trackingCtx.beginPath();
            this.trackingCtx.moveTo(x - size*0.6, y);
            this.trackingCtx.lineTo(x + size*0.6, y);
            this.trackingCtx.moveTo(x, y - size*0.6);
            this.trackingCtx.lineTo(x, y + size*0.6);
            this.trackingCtx.stroke();
            
            // Show tracking info with quality indicator
            this.trackingCtx.fillStyle = '#FFFFFF';
            this.trackingCtx.font = 'bold 16px Arial';
            this.trackingCtx.strokeStyle = '#000000';
            this.trackingCtx.lineWidth = 4;
            const infoText = `OBJECT: ${Math.round(area)}px (${this.trackingQuality.toFixed(0)}%)`;
            this.trackingCtx.strokeText(infoText, x + 50, y - 35);
            this.trackingCtx.fillText(infoText, x + 50, y - 35);
            
            // Show position coordinates
            const posText = `X:${(x/this.width*100).toFixed(0)}% Y:${(y/this.height*100).toFixed(0)}%`;
            this.trackingCtx.strokeText(posText, x + 50, y - 15);
            this.trackingCtx.fillText(posText, x + 50, y - 15);
            
        } catch (error) {
            console.error('Object tracking draw error:', error);
        }
    }
    
    drawCalibrationOverlay() {
        try {
            // Semi-transparent overlay
            this.trackingCtx.fillStyle = 'rgba(255, 255, 0, 0.1)';
            this.trackingCtx.fillRect(0, 0, this.width, this.height);
            
            // Pulsing border
            const time = Date.now() * 0.005;
            const intensity = (Math.sin(time) + 1) * 0.5;
            this.trackingCtx.strokeStyle = `rgba(255, 255, 0, ${0.3 + intensity * 0.4})`;
            this.trackingCtx.lineWidth = 8;
            this.trackingCtx.strokeRect(4, 4, this.width - 8, this.height - 8);
            
            // Calibration text
            this.trackingCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            this.trackingCtx.fillRect(this.width/2 - 150, 20, 300, 60);
            this.trackingCtx.fillStyle = '#FFFF00';
            this.trackingCtx.font = 'bold 18px Arial';
            this.trackingCtx.textAlign = 'center';
            this.trackingCtx.fillText('CALIBRATION MODE', this.width/2, 45);
            this.trackingCtx.font = '14px Arial';
            this.trackingCtx.fillText('Click and drag to select object', this.width/2, 65);
            this.trackingCtx.textAlign = 'left';
        } catch (error) {
            console.error('Calibration overlay draw error:', error);
        }
    }
    
    updateUI() {
        try {
            if (this.trackingQuality > 30) {
                this.socket.emit('ball-position', this.ballPosition);
            }
            
            document.getElementById('ballPos').textContent = 
                `X: ${(this.ballPosition.x * 100).toFixed(1)}%, Y: ${(this.ballPosition.y * 100).toFixed(1)}%`;
            document.getElementById('trackingQuality').textContent = `${this.trackingQuality.toFixed(0)}%`;
        } catch (error) {
            console.error('UI update error:', error);
        }
    }
    
    calibrate() {
        this.positionHistory = [];
        this.ballPosition = { x: 0.5, y: 0.5 };
        this.lastValidPosition = { x: 0.5, y: 0.5 };
        
        this.calibrationMode = true;
        this.boundingBoxMode = true;
        this.boundingBox = { startX: 0, startY: 0, endX: 0, endY: 0, isDrawing: false };
        document.getElementById('status').textContent = 
            'BOUNDING BOX MODE: Click and drag to select the object to track';
    }
    
    calibrateFromBoundingBox() {
        console.log('=== BOUNDING BOX CALIBRATION ===');
        const bbox = this.boundingBox;
        console.log('Bounding box:', bbox);
        
        try {
            // Calculate bounding box dimensions
            const left = Math.min(bbox.startX, bbox.endX);
            const right = Math.max(bbox.startX, bbox.endX);
            const top = Math.min(bbox.startY, bbox.endY);
            const bottom = Math.max(bbox.startY, bbox.endY);
            const width = right - left;
            const height = bottom - top;
            
            if (width < 10 || height < 10) {
                throw new Error('Bounding box too small - drag a larger area');
            }
            
            console.log('Sampling area:', { left, top, width, height });
            
            // Sample pixels within the bounding box
            const imageData = this.trackingCtx.getImageData(left, top, width, height);
            const data = imageData.data;
            const samples = [];
            
            // Sample every few pixels for performance
            const step = Math.max(2, Math.floor(Math.min(width, height) / 20));
            
            for (let y = 0; y < height; y += step) {
                for (let x = 0; x < width; x += step) {
                    const index = (y * width + x) * 4;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];
                    const a = data[index + 3];
                    
                    if (a > 0) { // Valid non-transparent pixel
                        samples.push({ r, g, b });
                    }
                }
            }
            
            if (samples.length === 0) {
                throw new Error('No valid pixels found in bounding box');
            }
            
            console.log(`Found ${samples.length} pixel samples in bounding box`);
            
            // Calculate average color from samples
            let avgR = 0, avgG = 0, avgB = 0;
            samples.forEach(sample => {
                avgR += sample.r;
                avgG += sample.g;
                avgB += sample.b;
            });
            avgR = Math.round(avgR / samples.length);
            avgG = Math.round(avgG / samples.length);
            avgB = Math.round(avgB / samples.length);
            
            console.log('Average color from bounding box:', { r: avgR, g: avgG, b: avgB });
            
            // Convert to HSV
            const hsv = this.rgbToHsv(avgR, avgG, avgB);
            console.log('Converted to HSV:', hsv);
            
            // Analyze color variance for adaptive tolerances
            let rVariance = 0, gVariance = 0, bVariance = 0;
            samples.forEach(sample => {
                rVariance += Math.pow(sample.r - avgR, 2);
                gVariance += Math.pow(sample.g - avgG, 2);
                bVariance += Math.pow(sample.b - avgB, 2);
            });
            const variance = Math.sqrt((rVariance + gVariance + bVariance) / (samples.length * 3));
            
            // Adaptive tolerances based on color variance within the bounding box
            const baseHueTolerance = 25;
            const baseSatTolerance = 100;
            const baseValTolerance = 100;
            
            // Higher variance = more tolerance needed
            const adaptiveFactor = Math.min(2.5, Math.max(1.0, variance / 30));
            
            this.colorTolerance = {
                h: Math.round(baseHueTolerance * adaptiveFactor),
                s: Math.round(baseSatTolerance * adaptiveFactor),
                v: Math.round(baseValTolerance * adaptiveFactor)
            };
            
            // Store the bounding box area for size-based filtering
            this.expectedSize = { width, height, area: width * height };
            
            console.log('Adaptive tolerances:', this.colorTolerance);
            console.log('Expected object size:', this.expectedSize);
            
            this.targetColor = hsv;
            this.isCalibrated = true;
            this.positionHistory = [];
            this.trackingQuality = 0;
            
            document.getElementById('status').textContent = 
                `CALIBRATED! Object selected (${width}x${height}px) RGB(${avgR},${avgG},${avgB}) - Move object to test`;
            
            console.log('=== BOUNDING BOX CALIBRATION SUCCESS ===');
            
        } catch (error) {
            console.error('=== CALIBRATION FAILED ===');
            console.error('Error:', error);
            document.getElementById('status').textContent = 'Calibration failed! ' + error.message;
        }
    }
    
    drawBoundingBox() {
        if (!this.boundingBox.isDrawing && this.boundingBox.startX === this.boundingBox.endX) return;
        
        const left = Math.min(this.boundingBox.startX, this.boundingBox.endX);
        const right = Math.max(this.boundingBox.startX, this.boundingBox.endX);
        const top = Math.min(this.boundingBox.startY, this.boundingBox.endY);
        const bottom = Math.max(this.boundingBox.startY, this.boundingBox.endY);
        const width = right - left;
        const height = bottom - top;
        
        // Draw bounding box
        this.trackingCtx.strokeStyle = '#00FF00';
        this.trackingCtx.lineWidth = 3;
        this.trackingCtx.setLineDash([5, 5]);
        this.trackingCtx.strokeRect(left, top, width, height);
        
        // Draw corner handles
        const handleSize = 8;
        this.trackingCtx.fillStyle = '#00FF00';
        this.trackingCtx.setLineDash([]);
        this.trackingCtx.fillRect(left - handleSize/2, top - handleSize/2, handleSize, handleSize);
        this.trackingCtx.fillRect(right - handleSize/2, top - handleSize/2, handleSize, handleSize);
        this.trackingCtx.fillRect(left - handleSize/2, bottom - handleSize/2, handleSize, handleSize);
        this.trackingCtx.fillRect(right - handleSize/2, bottom - handleSize/2, handleSize, handleSize);
        
        // Show dimensions
        if (width > 20 && height > 20) {
            this.trackingCtx.fillStyle = '#FFFFFF';
            this.trackingCtx.font = 'bold 14px Arial';
            this.trackingCtx.strokeStyle = '#000000';
            this.trackingCtx.lineWidth = 3;
            const text = `${width}x${height}px`;
            this.trackingCtx.strokeText(text, left + 5, top - 10);
            this.trackingCtx.fillText(text, left + 5, top - 10);
        }
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
        
        return { h: h / 2, s: s * 255, v: v * 255 }; // OpenCV HSV ranges
    }
    
    cleanup() {
        try {
            if (this.src) this.src.delete();
            if (this.hsv) this.hsv.delete();
            if (this.mask) this.mask.delete();
            if (this.contours) this.contours.delete();
            if (this.hierarchy) this.hierarchy.delete();
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }
}

let tracker;

// Global function already defined at the top of the file

window.addEventListener('load', () => {
    console.log('=== PAGE LOADED - INITIALIZING TRACKER ===');
    
    // Test if canvas is accessible
    const canvas = document.getElementById('trackingCanvas');
    const ctx = canvas.getContext('2d');
    console.log('Canvas element:', canvas);
    console.log('Canvas context:', ctx);
    console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
    
    // Draw a simple test pattern to verify canvas is working
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#00FF00';
    ctx.fillRect(100, 0, 100, 100);
    ctx.fillStyle = '#0000FF';
    ctx.fillRect(0, 100, 100, 100);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '20px Arial';
    ctx.fillText('CANVAS TEST', 10, 250);
    
    console.log('Drew test pattern - should be visible if canvas works');
    
    tracker = new OpenCVBallTracker();
    
    document.getElementById('calibrateBtn').addEventListener('click', () => {
        console.log('=== CALIBRATE BUTTON CLICKED ===');
        if (tracker && typeof tracker.calibrate === 'function') {
            tracker.calibrate();
            console.log('Calibration mode should now be:', tracker.calibrationMode);
        } else {
            console.error('Calibrate method not found on tracker');
        }
    });
    
    document.getElementById('initCameraBtn').addEventListener('click', () => {
        console.log('=== MANUAL CAMERA INIT BUTTON CLICKED ===');
        if (tracker) {
            console.log('Manually triggering camera initialization...');
            tracker.initWebcam().catch(error => {
                console.error('Manual camera init failed:', error);
                alert('Camera initialization failed: ' + error.message);
            });
        } else {
            console.error('Tracker not initialized');
        }
    });
    
    // Use the canvas variable already declared above
    
    // Mouse down - start bounding box
    canvas.addEventListener('mousedown', (e) => {
        if (!tracker.calibrationMode || !tracker.boundingBoxMode) return;
        
        const rect = e.target.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (640 / rect.width);
        const y = (e.clientY - rect.top) * (480 / rect.height);
        
        console.log('=== MOUSE DOWN - START BOUNDING BOX ===');
        tracker.boundingBox = {
            startX: x,
            startY: y,
            endX: x,
            endY: y,
            isDrawing: true
        };
    });
    
    // Mouse move - update bounding box
    canvas.addEventListener('mousemove', (e) => {
        if (!tracker.calibrationMode || !tracker.boundingBoxMode || !tracker.boundingBox.isDrawing) return;
        
        const rect = e.target.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (640 / rect.width);
        const y = (e.clientY - rect.top) * (480 / rect.height);
        
        tracker.boundingBox.endX = x;
        tracker.boundingBox.endY = y;
    });
    
    // Mouse up - finish bounding box and calibrate
    canvas.addEventListener('mouseup', (e) => {
        if (!tracker.calibrationMode || !tracker.boundingBoxMode || !tracker.boundingBox.isDrawing) return;
        
        const rect = e.target.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (640 / rect.width);
        const y = (e.clientY - rect.top) * (480 / rect.height);
        
        tracker.boundingBox.endX = x;
        tracker.boundingBox.endY = y;
        tracker.boundingBox.isDrawing = false;
        
        console.log('=== MOUSE UP - FINISH BOUNDING BOX ===');
        console.log('Final bounding box:', tracker.boundingBox);
        
        if (typeof tracker.calibrateFromBoundingBox === 'function') {
            tracker.calibrateFromBoundingBox();
            tracker.calibrationMode = false;
            tracker.boundingBoxMode = false;
            console.log('Calibration completed');
        } else {
            console.error('calibrateFromBoundingBox method not found');
        }
    });
    
    // Prevent context menu on right click
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (tracker) {
        tracker.cleanup();
    }
});