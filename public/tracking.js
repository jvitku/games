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

class GenericFeatureTracker {
    constructor() {
        console.log('=== INITIALIZING GenericFeatureTracker ===');
        
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
        
        // MediaPipe variables
        this.pose = null;
        this.camera = null;
        this.isMediaPipeReady = false;
        this.trackedFeatureIndex = null; // Which feature/landmark we're tracking
        this.calibratedRegion = null; // The region we calibrated on
        
        console.log('Video element:', this.video);
        console.log('Canvas element:', this.trackingCanvas);
        console.log('Canvas context:', this.trackingCtx);
        console.log('Socket:', this.socket);
        
        this.trackingQuality = 0;
        this.isTracking = false;
        this.isOpenCVReady = false;
        this.preferMediaPipe = true; // Prefer MediaPipe over OpenCV
        this.isCalibrated = false;
        this.calibrationMode = false;
        this.boundingBoxMode = false;
        this.boundingBox = { startX: 0, startY: 0, endX: 0, endY: 0, isDrawing: false };
        
        // Dynamic resolution based on video feed
        this.width = 640;
        this.height = 480;
        this.videoAspectRatio = 16/9; // Default aspect ratio
        
        // Object tracking configuration
        this.objectPosition = { x: 0.5, y: 0.5 };
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
        
        console.log('About to initialize MediaPipe and camera...');
        
        // Initialize MediaPipe first, then camera
        this.initMediaPipe();
        
        // Ensure DOM is fully loaded before trying to access camera
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                console.log('DOM loaded, now initializing camera...');
                this.initWebcam().catch(error => {
                    console.error('initWebcam failed:', error);
                    document.getElementById('status').textContent = 'Camera failed: ' + error.message;
                });
            });
        } else {
            console.log('DOM already loaded, initializing camera immediately...');
            this.initWebcam().catch(error => {
                console.error('initWebcam failed:', error);
                document.getElementById('status').textContent = 'Camera failed: ' + error.message;
            });
        }
    }
    
    async initWebcam() {
        try {
            console.log('=== INITIALIZING WEBCAM ===');
            document.getElementById('status').textContent = 'Requesting camera access...';
            
            // Check if getUserMedia is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('getUserMedia not supported in this browser. Please use Chrome, Firefox, or Safari.');
            }
            
            console.log('getUserMedia available, requesting user media...');
            console.log('navigator.mediaDevices:', navigator.mediaDevices);
            
            document.getElementById('status').textContent = 'Connecting to camera...';
            
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280, min: 640 },
                    height: { ideal: 720, min: 480 },
                    facingMode: 'user',
                    frameRate: { ideal: 30 }
                }
            });
            
            console.log('Got media stream:', stream);
            document.getElementById('status').textContent = 'Camera connected, starting video...';
            
            // Set up video element first before assigning stream
            this.video.muted = true;
            this.video.playsInline = true;
            this.video.autoplay = true;
            
            // Add event listeners before setting srcObject
            this.video.addEventListener('loadedmetadata', () => {
                console.log('Video metadata loaded, dimensions:', this.video.videoWidth, 'x', this.video.videoHeight);
                this.fixAspectRatio();
            });
            
            this.video.addEventListener('loadeddata', () => {
                console.log('Video data loaded, readyState:', this.video.readyState);
                document.getElementById('status').textContent = this.isOpenCVReady ? 
                    'Ready! Click Calibrate to select object to track.' : 
                    'Video ready, loading OpenCV...';
                this.startTracking();
            });
            
            this.video.addEventListener('canplay', () => {
                console.log('Video can start playing');
                document.getElementById('status').textContent = 'Video ready, preparing interface...';
            });
            
            this.video.addEventListener('playing', () => {
                console.log('Video is now playing');
                document.getElementById('status').textContent = this.isOpenCVReady ? 
                    'Ready! Click Calibrate to select object to track.' : 
                    'Video playing, loading OpenCV...';
            });
            
            this.video.addEventListener('error', (e) => {
                console.error('Video error:', e);
                document.getElementById('status').textContent = 'Video error: ' + e.message;
            });
            
            // Now assign the stream
            this.video.srcObject = stream;
            
            console.log('Stream assigned, attempting to play...');
            
            // Force play with better error handling
            try {
                await this.video.play();
                console.log('Video play() succeeded');
                
                // Force initial tracking start if events don't fire
                setTimeout(() => {
                    if (this.video.readyState >= 2) { // HAVE_CURRENT_DATA or better
                        console.log('Force-starting tracking after timeout');
                        this.fixAspectRatio();
                        this.startTracking();
                        document.getElementById('status').textContent = this.isOpenCVReady ? 
                            'Ready! Click Calibrate to select object to track.' : 
                            'Video ready, loading OpenCV...';
                    }
                }, 2000);
                
            } catch (playError) {
                console.error('Video play failed:', playError);
                document.getElementById('status').textContent = 'Failed to start video: ' + playError.message;
            }
            
        } catch (error) {
            console.error('Error accessing webcam:', error);
            const errorMsg = error.name === 'NotAllowedError' ? 
                'Camera access denied. Please allow camera access and refresh the page.' :
                error.name === 'NotFoundError' ?
                'No camera found. Please connect a camera and refresh the page.' :
                'Failed to access camera: ' + error.message;
            document.getElementById('status').textContent = errorMsg;
        }
    }
    
    initMediaPipe() {
        console.log('=== INITIALIZING MEDIAPIPE POSE ===');
        
        try {
            // Check if MediaPipe is available
            if (typeof window.Pose === 'undefined') {
                console.log('MediaPipe Pose not available, will use OpenCV fallback');
                this.preferMediaPipe = false;
                return;
            }
            
            // Initialize MediaPipe Pose for feature detection
            this.pose = new window.Pose({
                locateFile: (file) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
                }
            });
            
            this.pose.setOptions({
                modelComplexity: 1,
                smoothLandmarks: true,
                enableSegmentation: false,
                smoothSegmentation: false,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            
            this.pose.onResults((results) => {
                this.onMediaPipeResults(results);
            });
            
            this.isMediaPipeReady = true;
            console.log('MediaPipe Pose initialized successfully');
            
        } catch (error) {
            console.error('Failed to initialize MediaPipe:', error);
            this.preferMediaPipe = false;
        }
    }
    
    onMediaPipeResults(results) {
        if (results.poseLandmarks && results.poseLandmarks.length > 0) {
            // If we have a calibrated region, find the closest landmark to that region
            if (this.calibratedRegion && this.trackedFeatureIndex === null) {
                this.findClosestLandmarkToRegion(results.poseLandmarks);
            }
            
            // Track the selected landmark or use a default one
            let targetLandmark = null;
            if (this.trackedFeatureIndex !== null && this.trackedFeatureIndex < results.poseLandmarks.length) {
                targetLandmark = results.poseLandmarks[this.trackedFeatureIndex];
            } else if (results.poseLandmarks.length > 0) {
                // Default to nose (index 0) or wrist (index 15/16) if no specific feature selected
                targetLandmark = results.poseLandmarks[15] || results.poseLandmarks[16] || results.poseLandmarks[0];
            }
            
            if (targetLandmark) {
                const centerX = targetLandmark.x * this.width;
                const centerY = targetLandmark.y * this.height;
                
                const position = {
                    x: targetLandmark.x,
                    y: targetLandmark.y
                };
                
                this.applyPositionWithSmoothing(position);
                this.trackingQuality = Math.min(95, targetLandmark.visibility * 100);
                
                // Draw MediaPipe tracking visualization
                this.drawMediaPipeTracking(centerX, centerY, targetLandmark, this.trackedFeatureIndex);
            }
        } else {
            this.trackingQuality = Math.max(0, this.trackingQuality - 5);
        }
    }
    
    findClosestLandmarkToRegion(landmarks) {
        if (!this.calibratedRegion) return;
        
        const regionCenterX = (this.calibratedRegion.left + this.calibratedRegion.right) / 2 / this.width;
        const regionCenterY = (this.calibratedRegion.top + this.calibratedRegion.bottom) / 2 / this.height;
        
        let closestIndex = 0;
        let minDistance = Infinity;
        
        landmarks.forEach((landmark, index) => {
            const distance = Math.sqrt(
                Math.pow(landmark.x - regionCenterX, 2) + 
                Math.pow(landmark.y - regionCenterY, 2)
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = index;
            }
        });
        
        this.trackedFeatureIndex = closestIndex;
        console.log(`Selected landmark ${closestIndex} as closest to calibrated region`);
    }
    
    onOpenCVReady() {
        console.log('=== OPENCV READY ===');
        this.isOpenCVReady = true;
        this.initializeOpenCVMatrices();
        
        // Update status based on current state and preferred tracking method
        const trackingMethod = this.preferMediaPipe && this.isMediaPipeReady ? 'MediaPipe' : 'OpenCV';
        if (this.video && this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            document.getElementById('status').textContent = `Ready (${trackingMethod})! Click Calibrate to select object to track.`;
        } else {
            document.getElementById('status').textContent = `${trackingMethod} loaded, waiting for camera...`;
        }
    }
    
    fixAspectRatio() {
        console.log('=== FIXING ASPECT RATIO ===');
        console.log('Video dimensions:', this.video.videoWidth, 'x', this.video.videoHeight);
        
        if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
            this.videoAspectRatio = this.video.videoWidth / this.video.videoHeight;
            console.log('Video aspect ratio:', this.videoAspectRatio);
            
            // Update canvas dimensions to match video - use fixed size for now
            this.width = 640;
            this.height = Math.round(640 / this.videoAspectRatio);
            
            const canvasElement = this.trackingCanvas;
            canvasElement.width = this.width;
            canvasElement.height = this.height;
            canvasElement.style.width = this.width + 'px';
            canvasElement.style.height = this.height + 'px';
            
            console.log('Fixed canvas dimensions:', this.width + 'x' + this.height);
            
            // Reinitialize OpenCV matrices with new dimensions
            if (this.isOpenCVReady) {
                this.cleanup();
                this.initializeOpenCVMatrices();
            }
            
            // Clear the canvas to remove any test patterns
            this.trackingCtx.clearRect(0, 0, this.width, this.height);
            this.trackingCtx.fillStyle = '#1a1a1a';
            this.trackingCtx.fillRect(0, 0, this.width, this.height);
        } else {
            console.log('Video dimensions not available yet');
            // Use default dimensions
            this.width = 640;
            this.height = 480;
        }
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
        console.log('Video ready state:', this.video.readyState);
        console.log('Video dimensions:', this.video.videoWidth, 'x', this.video.videoHeight);
        this.isTracking = true;
        this.trackingLoop();
    }
    
    trackingLoop() {
        if (!this.isTracking) return;
        
        // Debug: Log first few frames and then every 60 frames
        if (!this.frameCount) this.frameCount = 0;
        this.frameCount++;
        if (this.frameCount <= 10 || this.frameCount % 60 === 0) {
            console.log('Tracking loop frame:', this.frameCount, 'video ready state:', this.video.readyState, 
                       'HAVE_ENOUGH_DATA:', this.video.HAVE_ENOUGH_DATA);
        }
        
        try {
            // Clear canvas first
            this.trackingCtx.clearRect(0, 0, this.width, this.height);
            
            // Always draw video frame first with proper aspect ratio
            if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
                this.trackingCtx.save();
                this.trackingCtx.scale(-1, 1);
                // Draw video maintaining its aspect ratio
                this.trackingCtx.drawImage(this.video, -this.width, 0, this.width, this.height);
                this.trackingCtx.restore();
            } else {
                // Fill with dark background to show canvas is working
                this.trackingCtx.fillStyle = '#1a1a1a';
                this.trackingCtx.fillRect(0, 0, this.width, this.height);
                
                // Show status text
                this.trackingCtx.fillStyle = '#FFFFFF';
                this.trackingCtx.font = 'bold 20px Arial';
                this.trackingCtx.textAlign = 'center';
                this.trackingCtx.fillText('Initializing camera...', this.width/2, this.height/2 - 10);
                this.trackingCtx.font = '16px Arial';
                this.trackingCtx.fillText('Please allow camera access', this.width/2, this.height/2 + 20);
                this.trackingCtx.textAlign = 'left';
            }
            
            // Only perform tracking if calibrated and not in calibration mode
            if (this.isCalibrated && !this.calibrationMode) {
                if (this.preferMediaPipe && this.isMediaPipeReady && this.camera) {
                    // MediaPipe handles tracking automatically via camera onFrame callback
                    // No need to manually send frames here - camera handles it
                } else if (this.targetColor) {
                    console.log('Tracking calibrated object with OpenCV:', this.targetColor);
                    if (this.isOpenCVReady && typeof cv !== 'undefined') {
                        this.performObjectTracking();
                    } else {
                        // Simple fallback color tracking without OpenCV
                        this.performSimpleColorTracking();
                    }
                }
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
    
    performObjectTracking() {
        try {
            // Get image data from canvas (after video is drawn)
            const imageData = this.trackingCtx.getImageData(0, 0, this.width, this.height);
            
            // Convert to OpenCV mat
            this.src.data.set(imageData.data);
            
            // Convert RGBA to HSV
            let rgb = new cv.Mat();
            cv.cvtColor(this.src, rgb, cv.COLOR_RGBA2RGB);
            cv.cvtColor(rgb, this.hsv, cv.COLOR_RGB2HSV);
            
            // Use exact tolerance values without multiplying
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
            
            // Find the best contour (prefer size and position similar to calibrated object)
            let bestContour = null;
            let maxScore = 0;
            let bestCenter = null;
            
            for (let i = 0; i < this.contours.size(); i++) {
                const contour = this.contours.get(i);
                const area = cv.contourArea(contour);
                
                if (area > this.minContourArea && area < this.maxContourArea) {
                    // Calculate contour center
                    const moments = cv.moments(contour);
                    if (moments.m00 > 0) {
                        const centerX = moments.m10 / moments.m00;
                        const centerY = moments.m01 / moments.m00;
                        
                        // Base score on area
                        let score = area;
                        
                        // Strong bonus for size similarity to expected size
                        if (this.expectedSize && this.expectedSize.area) {
                            const sizeRatio = Math.min(area / this.expectedSize.area, this.expectedSize.area / area);
                            score *= (0.2 + sizeRatio * 0.8); // Strong size preference
                        }
                        
                        // Bonus for proximity to last known position (continuity)
                        if (this.trackingQuality > 0 && this.lastValidPosition) {
                            const lastX = this.lastValidPosition.x * this.width;
                            const lastY = this.lastValidPosition.y * this.height;
                            const distance = Math.sqrt(Math.pow(centerX - lastX, 2) + Math.pow(centerY - lastY, 2));
                            const proximityBonus = Math.max(0, 1 - (distance / 200)); // Closer is better
                            score *= (0.7 + proximityBonus * 0.3);
                        }
                        
                        if (score > maxScore) {
                            maxScore = score;
                            bestContour = contour;
                        }
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
                    
                    // Draw tracking visualization with bounding box
                    this.drawObjectTracking(centerX, centerY, currentArea, bestContour);
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
            console.error('Object tracking error:', error);
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
            const step = 4; // Smaller step for better detection
            const tolerance = 50; // More precise tolerance
            const minClusterSize = 12; // Higher requirement for better accuracy
            
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
                
                // Draw tracking visualization with bounding box
                this.drawObjectTracking(bestCluster.x, bestCluster.y, bestCluster.density * 15, null);
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
        
        this.objectPosition.x = totalX / totalWeight;
        this.objectPosition.y = totalY / totalWeight;
        this.lastValidPosition = { ...this.objectPosition };
    }
    
    drawObjectTracking(x, y, area, contour = null) {
        try {
            // Fix mirrored position - since video is mirrored, we need to un-mirror the display
            const correctedX = this.width - x;
            
            // Make tracking marker much more visible and adaptive
            const size = Math.max(25, Math.min(100, Math.sqrt(area) / 2));
            
            // Dynamic color based on tracking quality
            const qualityColor = this.trackingQuality > 70 ? '#00FF00' : 
                                this.trackingQuality > 40 ? '#FFFF00' : '#FF8800';
            
            // Draw bounding box if contour is available (OpenCV tracking)
            if (contour && typeof cv !== 'undefined') {
                try {
                    const rect = cv.boundingRect(contour);
                    // Correct the bounding rectangle position
                    const correctedRectX = this.width - rect.x - rect.width;
                    
                    // Draw bounding rectangle
                    this.trackingCtx.strokeStyle = qualityColor;
                    this.trackingCtx.lineWidth = 3;
                    this.trackingCtx.strokeRect(correctedRectX, rect.y, rect.width, rect.height);
                    
                    // Draw corner markers
                    const cornerSize = 8;
                    this.trackingCtx.fillStyle = qualityColor;
                    this.trackingCtx.fillRect(correctedRectX - cornerSize/2, rect.y - cornerSize/2, cornerSize, cornerSize);
                    this.trackingCtx.fillRect(correctedRectX + rect.width - cornerSize/2, rect.y - cornerSize/2, cornerSize, cornerSize);
                    this.trackingCtx.fillRect(correctedRectX - cornerSize/2, rect.y + rect.height - cornerSize/2, cornerSize, cornerSize);
                    this.trackingCtx.fillRect(correctedRectX + rect.width - cornerSize/2, rect.y + rect.height - cornerSize/2, cornerSize, cornerSize);
                } catch (boundingError) {
                    console.error('Error drawing contour bounding box:', boundingError);
                }
            } else {
                // Draw estimated bounding box for simple tracking
                const estimatedSize = Math.sqrt(area);
                const boxX = correctedX - estimatedSize/2;
                const boxY = y - estimatedSize/2;
                
                this.trackingCtx.strokeStyle = qualityColor;
                this.trackingCtx.lineWidth = 3;
                this.trackingCtx.strokeRect(boxX, boxY, estimatedSize, estimatedSize);
                
                // Draw corner markers
                const cornerSize = 8;
                this.trackingCtx.fillStyle = qualityColor;
                this.trackingCtx.fillRect(boxX - cornerSize/2, boxY - cornerSize/2, cornerSize, cornerSize);
                this.trackingCtx.fillRect(boxX + estimatedSize - cornerSize/2, boxY - cornerSize/2, cornerSize, cornerSize);
                this.trackingCtx.fillRect(boxX - cornerSize/2, boxY + estimatedSize - cornerSize/2, cornerSize, cornerSize);
                this.trackingCtx.fillRect(boxX + estimatedSize - cornerSize/2, boxY + estimatedSize - cornerSize/2, cornerSize, cornerSize);
            }
            
            // Draw center dot only (no circular marker or crosshair)
            this.trackingCtx.fillStyle = qualityColor;
            this.trackingCtx.beginPath();
            this.trackingCtx.arc(correctedX, y, 8, 0, 2 * Math.PI);
            this.trackingCtx.fill();
            
            // Show tracking info with quality indicator
            this.trackingCtx.fillStyle = '#FFFFFF';
            this.trackingCtx.font = 'bold 16px Arial';
            this.trackingCtx.strokeStyle = '#000000';
            this.trackingCtx.lineWidth = 4;
            const infoText = `OBJECT: ${Math.round(area)}px (${this.trackingQuality.toFixed(0)}%)`;
            this.trackingCtx.strokeText(infoText, correctedX + 50, y - 35);
            this.trackingCtx.fillText(infoText, correctedX + 50, y - 35);
            
            // Show position coordinates (use corrected position for display)
            const posText = `X:${(correctedX/this.width*100).toFixed(0)}% Y:${(y/this.height*100).toFixed(0)}%`;
            this.trackingCtx.strokeText(posText, correctedX + 50, y - 15);
            this.trackingCtx.fillText(posText, correctedX + 50, y - 15);
            
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
            this.trackingCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            this.trackingCtx.fillRect(this.width/2 - 180, 20, 360, 80);
            this.trackingCtx.fillStyle = '#FFFF00';
            this.trackingCtx.font = 'bold 20px Arial';
            this.trackingCtx.textAlign = 'center';
            this.trackingCtx.fillText('CALIBRATION MODE', this.width/2, 45);
            this.trackingCtx.font = 'bold 16px Arial';
            this.trackingCtx.fillText('Click and drag to select object to track', this.width/2, 70);
            this.trackingCtx.font = '14px Arial';
            this.trackingCtx.fillText('Make sure object is clearly visible', this.width/2, 90);
            this.trackingCtx.textAlign = 'left';
        } catch (error) {
            console.error('Calibration overlay draw error:', error);
        }
    }
    
    updateUI() {
        try {
            if (this.trackingQuality > 30) {
                this.socket.emit('object-position', this.objectPosition);
            }
            
            document.getElementById('objectPos').textContent = 
                `X: ${(this.objectPosition.x * 100).toFixed(1)}%, Y: ${(this.objectPosition.y * 100).toFixed(1)}%`;
            document.getElementById('trackingQuality').textContent = `${this.trackingQuality.toFixed(0)}%`;
        } catch (error) {
            console.error('UI update error:', error);
        }
    }
    
    calibrate() {
        this.positionHistory = [];
        this.objectPosition = { x: 0.5, y: 0.5 };
        this.lastValidPosition = { x: 0.5, y: 0.5 };
        
        this.calibrationMode = true;
        this.boundingBoxMode = true;
        this.boundingBox = { startX: 0, startY: 0, endX: 0, endY: 0, isDrawing: false };
        
        // Reset tracking quality to show calibration is needed
        this.trackingQuality = 0;
        this.isCalibrated = false;
        this.targetColor = null;
        
        document.getElementById('status').textContent = 
            'CALIBRATION MODE: Click and drag to select the object to track';
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
            
            // More conservative tolerances for better accuracy
            const baseHueTolerance = 20;
            const baseSatTolerance = 60;
            const baseValTolerance = 60;
            
            // Moderate adaptive factor for better precision
            const adaptiveFactor = Math.min(2.0, Math.max(1.0, variance / 40));
            
            this.colorTolerance = {
                h: Math.round(baseHueTolerance * adaptiveFactor),
                s: Math.round(baseSatTolerance * adaptiveFactor),
                v: Math.round(baseValTolerance * adaptiveFactor)
            };
            
            // Store the bounding box area for size-based filtering and MediaPipe region
            this.expectedSize = { width, height, area: width * height };
            this.calibratedRegion = { left, top, right: left + width, bottom: top + height };
            this.trackedFeatureIndex = null; // Reset feature selection for MediaPipe
            
            console.log('Adaptive tolerances:', this.colorTolerance);
            console.log('Expected object size:', this.expectedSize);
            
            this.targetColor = hsv;
            this.isCalibrated = true;
            this.positionHistory = [];
            this.trackingQuality = 0;
            
            // Exit calibration mode and start tracking automatically
            this.calibrationMode = false;
            this.boundingBoxMode = false;
            
            // Initialize MediaPipe camera if preferred and available
            if (this.preferMediaPipe && this.isMediaPipeReady && !this.camera) {
                this.initMediaPipeCamera();
            }
            
            const trackingMethod = (this.preferMediaPipe && this.isMediaPipeReady) ? 'MediaPipe' : 'OpenCV';
            document.getElementById('status').textContent = 
                `TRACKING STARTED with ${trackingMethod}! Object selected (${width}x${height}px) - Move object to test tracking`;
            
            console.log('=== BOUNDING BOX CALIBRATION SUCCESS - TRACKING STARTED ===');
            
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
    
    initMediaPipeCamera() {
        console.log('=== INITIALIZING MEDIAPIPE CAMERA ===');
        
        try {
            if (typeof window.Camera === 'undefined') {
                console.error('MediaPipe Camera not available');
                return;
            }
            
            this.camera = new window.Camera(this.video, {
                onFrame: async () => {
                    try {
                        if (this.pose && this.isCalibrated && !this.calibrationMode) {
                            await this.pose.send({image: this.video});
                        }
                    } catch (error) {
                        console.error('MediaPipe send error:', error);
                    }
                },
                width: this.width,
                height: this.height
            });
            
            this.camera.start();
            console.log('MediaPipe camera started successfully');
            
        } catch (error) {
            console.error('Failed to initialize MediaPipe camera:', error);
            this.preferMediaPipe = false;
        }
    }
    
    drawMediaPipeTracking(centerX, centerY, landmark, landmarkIndex) {
        try {
            const confidence = landmark.visibility || this.trackingQuality / 100;
            const qualityColor = confidence > 0.7 ? '#00FF00' : 
                                confidence > 0.4 ? '#FFFF00' : '#FF8800';
            
            // Fix mirrored position - since video is mirrored, we need to un-mirror the display
            const correctedX = this.width - centerX;
            
            // Draw a fixed-size bounding box around the tracked feature
            const boxSize = 60; // Fixed size box
            const halfBox = boxSize / 2;
            
            // Draw bounding rectangle (using corrected position)
            this.trackingCtx.strokeStyle = qualityColor;
            this.trackingCtx.lineWidth = 3;
            this.trackingCtx.strokeRect(correctedX - halfBox, centerY - halfBox, boxSize, boxSize);
            
            // Draw corner markers
            const cornerSize = 8;
            this.trackingCtx.fillStyle = qualityColor;
            this.trackingCtx.fillRect(correctedX - halfBox - cornerSize/2, centerY - halfBox - cornerSize/2, cornerSize, cornerSize);
            this.trackingCtx.fillRect(correctedX + halfBox - cornerSize/2, centerY - halfBox - cornerSize/2, cornerSize, cornerSize);
            this.trackingCtx.fillRect(correctedX - halfBox - cornerSize/2, centerY + halfBox - cornerSize/2, cornerSize, cornerSize);
            this.trackingCtx.fillRect(correctedX + halfBox - cornerSize/2, centerY + halfBox - cornerSize/2, cornerSize, cornerSize);
            
            // Draw center dot
            this.trackingCtx.fillStyle = qualityColor;
            this.trackingCtx.beginPath();
            this.trackingCtx.arc(correctedX, centerY, 8, 0, 2 * Math.PI);
            this.trackingCtx.fill();
            
            // Show tracking info with confidence
            this.trackingCtx.fillStyle = '#FFFFFF';
            this.trackingCtx.font = 'bold 16px Arial';
            this.trackingCtx.strokeStyle = '#000000';
            this.trackingCtx.lineWidth = 4;
            const featureName = this.getLandmarkName(landmarkIndex);
            const infoText = `FEATURE (${featureName}): ${(confidence * 100).toFixed(0)}%`;
            this.trackingCtx.strokeText(infoText, correctedX + 50, centerY - 35);
            this.trackingCtx.fillText(infoText, correctedX + 50, centerY - 35);
            
            // Show position coordinates (use corrected position for display)
            const posText = `X:${(correctedX/this.width*100).toFixed(0)}% Y:${(centerY/this.height*100).toFixed(0)}%`;
            this.trackingCtx.strokeText(posText, correctedX + 50, centerY - 15);
            this.trackingCtx.fillText(posText, correctedX + 50, centerY - 15);
            
        } catch (error) {
            console.error('MediaPipe tracking draw error:', error);
        }
    }
    
    getLandmarkName(index) {
        const landmarkNames = {
            0: 'Nose', 11: 'Left Shoulder', 12: 'Right Shoulder',
            13: 'Left Elbow', 14: 'Right Elbow', 15: 'Left Wrist', 16: 'Right Wrist',
            23: 'Left Hip', 24: 'Right Hip', 25: 'Left Knee', 26: 'Right Knee',
            27: 'Left Ankle', 28: 'Right Ankle'
        };
        return landmarkNames[index] || `Point ${index}`;
    }
    
    cleanup() {
        try {
            // Cleanup OpenCV matrices
            if (this.src) this.src.delete();
            if (this.hsv) this.hsv.delete();
            if (this.mask) this.mask.delete();
            if (this.contours) this.contours.delete();
            if (this.hierarchy) this.hierarchy.delete();
            
            // Cleanup MediaPipe
            if (this.camera) {
                this.camera.stop();
                this.camera = null;
            }
            if (this.pose) {
                this.pose.close();
                this.pose = null;
            }
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
    
    // Clear any existing content and show loading state
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Starting up...', canvas.width/2, canvas.height/2);
    ctx.textAlign = 'left';
    
    console.log('Canvas initialized and ready for video');
    
    tracker = new GenericFeatureTracker();
    
    document.getElementById('calibrateBtn').addEventListener('click', () => {
        console.log('=== CALIBRATE BUTTON CLICKED ===');
        if (tracker && typeof tracker.calibrate === 'function') {
            tracker.calibrate();
            console.log('Calibration mode should now be:', tracker.calibrationMode);
        } else {
            console.error('Calibrate method not found on tracker');
        }
    });
    
    // Camera initialization is now automatic - no manual button needed
    
    // Use the canvas variable already declared above
    
    // Mouse down - start bounding box
    canvas.addEventListener('mousedown', (e) => {
        if (!tracker.calibrationMode || !tracker.boundingBoxMode) return;
        
        const rect = e.target.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (tracker.width / rect.width);
        const y = (e.clientY - rect.top) * (tracker.height / rect.height);
        
        console.log('=== MOUSE DOWN - START BOUNDING BOX ===');
        console.log('Mouse client coords:', e.clientX, e.clientY);
        console.log('Canvas rect:', rect.width, 'x', rect.height);
        console.log('Tracker dimensions:', tracker.width, 'x', tracker.height);
        console.log('Calculated canvas coords:', x, y);
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
        const x = (e.clientX - rect.left) * (tracker.width / rect.width);
        const y = (e.clientY - rect.top) * (tracker.height / rect.height);
        
        tracker.boundingBox.endX = x;
        tracker.boundingBox.endY = y;
    });
    
    // Mouse up - finish bounding box and calibrate
    canvas.addEventListener('mouseup', (e) => {
        if (!tracker.calibrationMode || !tracker.boundingBoxMode || !tracker.boundingBox.isDrawing) return;
        
        const rect = e.target.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (tracker.width / rect.width);
        const y = (e.clientY - rect.top) * (tracker.height / rect.height);
        
        tracker.boundingBox.endX = x;
        tracker.boundingBox.endY = y;
        tracker.boundingBox.isDrawing = false;
        
        console.log('=== MOUSE UP - FINISH BOUNDING BOX ===');
        console.log('Final mouse coords:', x, y);
        console.log('Final bounding box:', tracker.boundingBox);
        
        if (typeof tracker.calibrateFromBoundingBox === 'function') {
            tracker.calibrateFromBoundingBox();
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