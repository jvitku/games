class OpenCVBallTracker {
    constructor() {
        this.video = document.getElementById('webcam');
        this.trackingCanvas = document.getElementById('trackingCanvas');
        this.trackingCtx = this.trackingCanvas.getContext('2d');
        this.socket = io();
        
        this.trackingQuality = 0;
        this.isTracking = false;
        this.isOpenCVReady = false;
        this.isCalibrated = false;
        this.calibrationMode = false;
        
        // High resolution for better tracking
        this.width = 640;
        this.height = 480;
        
        // Ball tracking configuration
        this.ballPosition = { x: 0.5, y: 0.5 };
        this.lastValidPosition = { x: 0.5, y: 0.5 };
        this.positionHistory = [];
        this.maxHistorySize = 5;
        this.jumpThreshold = 0.12; // Stricter jump detection
        
        // Color calibration for ball tracking
        this.targetColor = null;
        this.colorTolerance = { h: 15, s: 60, v: 60 }; // More selective
        this.minContourArea = 500; // Higher minimum area to avoid noise
        this.maxContourArea = 8000; // Reasonable maximum area
        
        // OpenCV matrices
        this.src = null;
        this.hsv = null;
        this.mask = null;
        this.contours = null;
        this.hierarchy = null;
        
        this.initWebcam();
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
                document.getElementById('status').textContent = 'Webcam ready, waiting for OpenCV...';
                this.startTracking();
            });
        } catch (error) {
            console.error('Error accessing webcam:', error);
            document.getElementById('status').textContent = 'Failed to access webcam';
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
        this.isTracking = true;
        this.trackingLoop();
    }
    
    trackingLoop() {
        if (!this.isTracking) return;
        
        try {
            // Always draw video frame first
            if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
                this.trackingCtx.save();
                this.trackingCtx.scale(-1, 1);
                this.trackingCtx.drawImage(this.video, -this.width, 0, this.width, this.height);
                this.trackingCtx.restore();
                
                // Perform ball tracking if calibrated
                if (this.isCalibrated && this.targetColor) {
                    if (this.isOpenCVReady && typeof cv !== 'undefined') {
                        this.performBallTracking();
                    } else {
                        // Simple fallback color tracking without OpenCV
                        this.performSimpleColorTracking();
                    }
                }
            }
            
            // Draw calibration overlay if in calibration mode
            if (this.calibrationMode) {
                this.drawCalibrationOverlay();
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
            
            // Create scalar values for color range
            const lowerBound = new cv.Scalar(
                Math.max(0, this.targetColor.h - this.colorTolerance.h),
                Math.max(0, this.targetColor.s - this.colorTolerance.s),
                Math.max(0, this.targetColor.v - this.colorTolerance.v)
            );
            
            const upperBound = new cv.Scalar(
                Math.min(179, this.targetColor.h + this.colorTolerance.h),
                Math.min(255, this.targetColor.s + this.colorTolerance.s),
                Math.min(255, this.targetColor.v + this.colorTolerance.v)
            );
            
            // Create mask for target color
            cv.inRange(this.hsv, lowerBound, upperBound, this.mask);
            
            // Morphological operations to clean up the mask
            const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9));
            cv.morphologyEx(this.mask, this.mask, cv.MORPH_OPEN, kernel);
            cv.morphologyEx(this.mask, this.mask, cv.MORPH_CLOSE, kernel);
            
            // Find contours
            cv.findContours(this.mask, this.contours, this.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            
            // Find the best contour (largest within size constraints)
            let bestContour = null;
            let maxArea = 0;
            let bestCenter = null;
            
            for (let i = 0; i < this.contours.size(); i++) {
                const contour = this.contours.get(i);
                const area = cv.contourArea(contour);
                
                if (area > this.minContourArea && area < this.maxContourArea && area > maxArea) {
                    maxArea = area;
                    bestContour = contour;
                }
            }
            
            if (bestContour && maxArea > 0) {
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
                    this.trackingQuality = Math.min(95, (maxArea / 50) * 10);
                    
                    // Draw tracking visualization 
                    this.drawBallTracking(centerX, centerY, maxArea);
                }
            } else {
                this.trackingQuality = Math.max(0, this.trackingQuality - 5);
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
            const step = 8; // Larger step for performance during debugging
            const tolerance = 50; // More tolerant for initial testing
            const minClusterSize = 15; // Lower requirement for easier detection
            
            console.log('Target RGB for tracking:', targetRGB);
            
            // Find all matching pixels
            for (let y = 0; y < this.height; y += step) {
                for (let x = 0; x < this.width; x += step) {
                    const index = (y * this.width + x) * 4;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];
                    
                    // Calculate Euclidean color distance (more accurate than Manhattan)
                    const colorDist = Math.sqrt(
                        Math.pow(r - targetRGB.r, 2) + 
                        Math.pow(g - targetRGB.g, 2) + 
                        Math.pow(b - targetRGB.b, 2)
                    );
                    
                    if (colorDist < tolerance) {
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
                                        if (nColorDist < tolerance) nearbyMatches++;
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
                this.drawBallTracking(bestCluster.x, bestCluster.y, bestCluster.density * 15);
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
    
    drawBallTracking(x, y, area) {
        try {
            // Make tracking marker much more visible
            const size = Math.max(30, Math.min(80, Math.sqrt(area) / 3));
            
            // Draw thick bright circle
            this.trackingCtx.strokeStyle = '#00FF00';
            this.trackingCtx.lineWidth = 4;
            this.trackingCtx.beginPath();
            this.trackingCtx.arc(x, y, size, 0, 2 * Math.PI);
            this.trackingCtx.stroke();
            
            // Draw center dot
            this.trackingCtx.fillStyle = '#00FF00';
            this.trackingCtx.beginPath();
            this.trackingCtx.arc(x, y, 5, 0, 2 * Math.PI);
            this.trackingCtx.fill();
            
            // Draw crosshair
            this.trackingCtx.strokeStyle = '#FFFF00';
            this.trackingCtx.lineWidth = 2;
            this.trackingCtx.beginPath();
            this.trackingCtx.moveTo(x - size/2, y);
            this.trackingCtx.lineTo(x + size/2, y);
            this.trackingCtx.moveTo(x, y - size/2);
            this.trackingCtx.lineTo(x, y + size/2);
            this.trackingCtx.stroke();
            
            // Show area and position info
            this.trackingCtx.fillStyle = '#FFFFFF';
            this.trackingCtx.font = 'bold 14px Arial';
            this.trackingCtx.strokeStyle = '#000000';
            this.trackingCtx.lineWidth = 3;
            this.trackingCtx.strokeText(`TRACKING: ${Math.round(area)}px`, x + 40, y - 30);
            this.trackingCtx.fillText(`TRACKING: ${Math.round(area)}px`, x + 40, y - 30);
        } catch (error) {
            console.error('Ball tracking draw error:', error);
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
            this.trackingCtx.fillText('Click on the ball to calibrate', this.width/2, 65);
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
        document.getElementById('status').textContent = 
            'CALIBRATION MODE: Click on the ball in the video to start tracking';
    }
    
    calibrateBallColor(x, y) {
        console.log('=== CALIBRATION DEBUG ===');
        console.log('Click coordinates:', x, y);
        console.log('Canvas dimensions:', this.width, this.height);
        console.log('Calibration mode:', this.calibrationMode);
        
        try {
            // Use coordinates directly since video is already mirrored
            console.log('Using X coordinate directly:', x);
            
            // Simple single pixel sample first for debugging
            const singlePixelData = this.trackingCtx.getImageData(x, y, 1, 1);
            const singlePixel = singlePixelData.data;
            console.log('Single pixel at click:', {
                r: singlePixel[0],
                g: singlePixel[1], 
                b: singlePixel[2],
                a: singlePixel[3]
            });
            
            // If single pixel is valid, use it for calibration
            if (singlePixel[0] !== undefined) {
                const r = singlePixel[0];
                const g = singlePixel[1];
                const b = singlePixel[2];
                
                // Convert to HSV
                const hsv = this.rgbToHsv(r, g, b);
                console.log('Converted to HSV:', hsv);
                
                this.targetColor = hsv;
                this.isCalibrated = true;
                this.positionHistory = [];
                this.trackingQuality = 0;
                
                document.getElementById('status').textContent = 
                    `CALIBRATED! RGB(${r},${g},${b}) HSV(${Math.round(hsv.h)},${Math.round(hsv.s)},${Math.round(hsv.v)}) - Move ball to test`;
                
                console.log('=== CALIBRATION SUCCESS ===');
                console.log('Target color set to:', this.targetColor);
                
                // Test the tracking immediately
                setTimeout(() => {
                    console.log('Testing tracking with calibrated color...');
                }, 1000);
                
            } else {
                throw new Error('Could not read pixel data at clicked position');
            }
            
        } catch (error) {
            console.error('=== CALIBRATION FAILED ===');
            console.error('Error:', error);
            document.getElementById('status').textContent = 'Calibration failed! Check console for details.';
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

// Global function for OpenCV ready callback
function onOpenCvReady() {
    console.log('OpenCV.js is ready');
    if (tracker) {
        tracker.onOpenCVReady();
    }
}

window.addEventListener('load', () => {
    tracker = new OpenCVBallTracker();
    
    document.getElementById('calibrateBtn').addEventListener('click', () => {
        console.log('=== CALIBRATE BUTTON CLICKED ===');
        tracker.calibrate();
        console.log('Calibration mode should now be:', tracker.calibrationMode);
    });
    
    document.getElementById('trackingCanvas').addEventListener('click', (e) => {
        console.log('=== CANVAS CLICK DETECTED ===');
        const rect = e.target.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (640 / rect.width);
        const y = (e.clientY - rect.top) * (480 / rect.height);
        
        console.log('Raw click coords:', e.clientX, e.clientY);
        console.log('Rect bounds:', rect);
        console.log('Calculated coords:', x, y);
        console.log('Calibration mode active:', tracker.calibrationMode);
        
        if (tracker.calibrationMode) {
            console.log('Calling calibrateBallColor...');
            tracker.calibrateBallColor(x, y);
            tracker.calibrationMode = false;
            console.log('Calibration mode turned off');
        } else {
            console.log('Click ignored - not in calibration mode');
        }
    });
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (tracker) {
        tracker.cleanup();
    }
});