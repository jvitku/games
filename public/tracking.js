// Define global OpenCV callback FIRST, before anything else
function onOpenCvReady() {
    console.log('OpenCV.js loading callback triggered');
    console.log('cv object:', typeof cv !== 'undefined' ? 'available' : 'not available');
    console.log('cv.Mat:', typeof cv !== 'undefined' && cv.Mat ? 'available' : 'not available');
    console.log('tracker object:', typeof tracker !== 'undefined' ? 'available' : 'not available');
    
    // Wait for OpenCV to be fully initialized
    const checkAndInitialize = () => {
        if (typeof cv !== 'undefined' && cv.Mat && cv.Mat.zeros) {
            console.log('OpenCV fully loaded, setting ready flag');
            window.opencvReady = true;
            
            if (typeof tracker !== 'undefined' && tracker && typeof tracker.onOpenCVReady === 'function') {
                console.log('Calling tracker.onOpenCVReady()');
                tracker.onOpenCVReady();
            } else {
                console.log('Tracker not ready yet, will be called later when tracker initializes');
            }
        } else {
            console.log('OpenCV still loading, checking again in 50ms...');
            setTimeout(checkAndInitialize, 50);
        }
    };
    
    checkAndInitialize();
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
        
        // OpenCV tracking variables
        this.trackers = [];
        this.trackingAlgorithms = ['HybridTracker'];
        this.currentTrackerIndex = 0;
        this.trackingBox = null;
        this.trackingInitialized = false;
        this.trackingFailureCount = 0;
        this.maxTrackingFailures = 10;
        this.isTrackerReady = false;
        this.calibratedRegion = null; // The region we calibrated on
        this.srcMat = null;
        this.dstMat = null;
        this.customTracker = {}; // Storage for optical flow tracker state
        
        console.log('Video element:', this.video);
        console.log('Canvas element:', this.trackingCanvas);
        console.log('Canvas context:', this.trackingCtx);
        console.log('Socket:', this.socket);
        
        this.trackingQuality = 0;
        this.isTracking = false;
        this.isOpenCVReady = false;
        this.useOpenCVTracking = true; // Use OpenCV tracking by default
        this.isCalibrated = false;
        this.calibrationMode = false;
        this.boundingBoxMode = false;
        this.boundingBox = { startX: 0, startY: 0, endX: 0, endY: 0, isDrawing: false };
        
        // Performance optimization variables (legacy - kept for compatibility)
        this.lastDetectionTime = 0;
        this.detectionInterval = 100;
        
        // Dynamic resolution based on video feed
        this.width = 640;
        this.height = 480;
        this.videoAspectRatio = 16/9; // Default aspect ratio
        
        // Object tracking configuration
        this.objectPosition = { x: 0.5, y: 0.5 };
        this.lastValidPosition = { x: 0.5, y: 0.5 };
        this.positionHistory = [];
        this.maxHistorySize = 2; // Reduced from 5 to 2 for faster response
        this.jumpThreshold = 0.25; // Increased from 0.12 to allow faster movement
        
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
        
        console.log('About to initialize camera and object detector...');
        
        // Initialize camera first, then object detector in background
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                console.log('DOM loaded, now initializing camera...');
                this.initWebcam().catch(error => {
                    console.error('initWebcam failed:', error);
                    document.getElementById('status').textContent = 'Camera failed: ' + error.message;
                });
                // Initialize OpenCV tracker (will be ready when OpenCV loads)
                this.initOpenCVTracker();
                
                // Check if OpenCV is already loaded
                if ((typeof cv !== 'undefined' && cv.Mat && cv.Mat.zeros) || window.opencvReady) {
                    console.log('OpenCV already loaded, calling onOpenCVReady immediately');
                    this.onOpenCVReady();
                }
            });
        } else {
            console.log('DOM already loaded, initializing camera immediately...');
            this.initWebcam().catch(error => {
                console.error('initWebcam failed:', error);
                document.getElementById('status').textContent = 'Camera failed: ' + error.message;
            });
            // Initialize OpenCV tracker (will be ready when OpenCV loads)
            this.initOpenCVTracker();
            
            // Check if OpenCV is already loaded
            if ((typeof cv !== 'undefined' && cv.Mat && cv.Mat.zeros) || window.opencvReady) {
                console.log('OpenCV already loaded, calling onOpenCVReady immediately');
                this.onOpenCVReady();
            }
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
    
    initOpenCVTracker() {
        console.log('=== INITIALIZING OPENCV TRACKER ===');
        
        if (!this.isOpenCVReady) {
            console.log('OpenCV not ready yet, will initialize when available');
            return;
        }
        
        try {
            // Initialize tracking variables
            this.trackers = [];
            this.trackingAlgorithms = ['CSRT', 'KCF', 'MIL', 'MOSSE']; // Multiple algorithms for reliability
            this.currentTrackerIndex = 0;
            this.trackingBox = null;
            this.trackingInitialized = false;
            this.trackingFailureCount = 0;
            this.maxTrackingFailures = 10;
            
            // Create OpenCV matrices for processing
            this.srcMat = null;
            this.dstMat = null;
            
            console.log('OpenCV Tracker initialized successfully');
            this.isTrackerReady = true;
            
        } catch (error) {
            console.error('Failed to initialize OpenCV Tracker:', error);
            this.isTrackerReady = false;
        }
    }
    
    createRobustHybridTracker() {
        console.log('Creating robust hybrid tracker...');
        
        // Hybrid tracker combining multiple techniques for maximum robustness
        return {
            isCustomTracker: true,
            boundingBox: null,
            
            // Multi-modal tracking data
            opticalFlowPoints: null,
            templateImage: null,
            colorHistogram: null,
            prevGray: null,
            templateSize: { width: 0, height: 0 },
            
            // Tracking confidence weights
            confidenceWeights: {
                opticalFlow: 0.4,
                templateMatching: 0.3,
                colorTracking: 0.3
            },
            
            // Tracking results from each method
            results: {
                opticalFlow: null,
                templateMatching: null,
                colorTracking: null
            },
            
            init: function(frame, rect) {
                try {
                    console.log('Initializing robust hybrid tracker with rect:', rect);
                    this.boundingBox = {
                        x: rect.x, y: rect.y, 
                        width: rect.width, height: rect.height
                    };
                    
                    // 1. OPTICAL FLOW INITIALIZATION
                    const points = [];
                    const stepX = Math.max(4, Math.floor(rect.width / 12));
                    const stepY = Math.max(4, Math.floor(rect.height / 12));
                    
                    for (let y = rect.y + stepY; y < rect.y + rect.height - stepY; y += stepY) {
                        for (let x = rect.x + stepX; x < rect.x + rect.width - stepX; x += stepX) {
                            points.push([x, y]);
                        }
                    }
                    
                    this.opticalFlowPoints = cv.matFromArray(points.length, 1, cv.CV_32FC2, points.flat());
                    
                    // 2. TEMPLATE MATCHING INITIALIZATION
                    try {
                        const templateRect = new cv.Rect(rect.x, rect.y, rect.width, rect.height);
                        this.templateImage = frame.roi(templateRect).clone();
                        templateRect.delete();
                    } catch (error) {
                        // Fallback: manual ROI extraction
                        console.log('Using fallback ROI extraction for template');
                        this.templateImage = frame.roi(rect).clone();
                    }
                    this.templateSize = { width: rect.width, height: rect.height };
                    
                    // 3. COLOR HISTOGRAM INITIALIZATION
                    const roi = frame.roi(rect);
                    const hsvRoi = new cv.Mat();
                    cv.cvtColor(roi, hsvRoi, cv.COLOR_RGB2HSV);
                    
                    // Create histogram
                    const hist = new cv.Mat();
                    const histSize = [50, 60]; // H and S bins
                    const ranges = [0, 180, 0, 256]; // H: 0-180, S: 0-255
                    const channels = [0, 1]; // H and S channels
                    
                    // Create MatVector properly
                    const srcVec = new cv.MatVector();
                    srcVec.push_back(hsvRoi);
                    const mask = new cv.Mat();
                    
                    cv.calcHist(srcVec, channels, mask, hist, histSize, ranges);
                    cv.normalize(hist, hist, 0, 255, cv.NORM_MINMAX);
                    
                    // Clean up
                    srcVec.delete();
                    mask.delete();
                    
                    this.colorHistogram = hist;
                    
                    // 4. GRAYSCALE FRAME FOR OPTICAL FLOW
                    this.prevGray = cv.Mat.zeros(frame.rows, frame.cols, cv.CV_8UC1);
                    cv.cvtColor(frame, this.prevGray, cv.COLOR_RGB2GRAY);
                    
                    // Clean up temporary matrices
                    roi.delete();
                    hsvRoi.delete();
                    
                    console.log(`Hybrid tracker initialized: ${points.length} flow points, template ${rect.width}x${rect.height}, color histogram`);
                    return true;
                    
                } catch (error) {
                    console.error('Error initializing hybrid tracker:', error);
                    return false;
                }
            },
            
            update: function(frame, outputRect) {
                try {
                    // Reset results
                    this.results = {
                        opticalFlow: null,
                        templateMatching: null,
                        colorTracking: null
                    };
                    
                    const gray = cv.Mat.zeros(frame.rows, frame.cols, cv.CV_8UC1);
                    cv.cvtColor(frame, gray, cv.COLOR_RGB2GRAY);
                    
                    // Get reference to main tracker instance for method calls
                    const mainTracker = window.tracker || this;
                    
                    // 1. OPTICAL FLOW TRACKING
                    try {
                        this.results.opticalFlow = mainTracker.performOpticalFlowTracking(this, frame, gray);
                        console.log('Optical flow result:', !!this.results.opticalFlow);
                    } catch (error) {
                        console.error('Optical flow tracking failed:', error);
                        this.results.opticalFlow = null;
                    }
                    
                    // 2. TEMPLATE MATCHING
                    try {
                        this.results.templateMatching = mainTracker.performTemplateMatching(this, gray);
                        console.log('Template matching result:', !!this.results.templateMatching);
                    } catch (error) {
                        console.error('Template matching failed:', error);
                        this.results.templateMatching = null;
                    }
                    
                    // 3. COLOR-BASED TRACKING
                    try {
                        this.results.colorTracking = mainTracker.performColorTracking(this, frame);
                        console.log('Color tracking result:', !!this.results.colorTracking);
                    } catch (error) {
                        console.error('Color tracking failed:', error);
                        this.results.colorTracking = null;
                    }
                    
                    // 4. FUSION OF RESULTS
                    const fusedResult = mainTracker.fuseTrackingResults(this);
                    
                    if (!fusedResult) {
                        gray.delete();
                        return false;
                    }
                    
                    // Update output rect
                    outputRect.x = fusedResult.x;
                    outputRect.y = fusedResult.y;
                    outputRect.width = fusedResult.width;
                    outputRect.height = fusedResult.height;
                    
                    // Update tracker state for next frame
                    mainTracker.updateTrackerState(this, frame, gray, fusedResult);
                    
                    gray.delete();
                    return true;
                    
                } catch (error) {
                    console.error('Error in hybrid tracking:', error);
                    return false;
                }
            },
            
            
            delete: function() {
                try {
                    if (this.opticalFlowPoints) {
                        this.opticalFlowPoints.delete();
                        this.opticalFlowPoints = null;
                    }
                    if (this.templateImage) {
                        this.templateImage.delete();
                        this.templateImage = null;
                    }
                    if (this.colorHistogram) {
                        this.colorHistogram.delete();
                        this.colorHistogram = null;
                    }
                    if (this.prevGray) {
                        this.prevGray.delete();
                        this.prevGray = null;
                    }
                } catch (error) {
                    console.error('Error cleaning up hybrid tracker:', error);
                }
            }
        };
    }
    
    initializeTracking(boundingBox) {
        console.log('=== INITIALIZING OPENCV TRACKING ===');
        console.log('Bounding box:', boundingBox);
        
        if (!this.isOpenCVReady) {
            console.error('OpenCV not ready');
            console.error('Debug info:', {
                isOpenCVReady: this.isOpenCVReady,
                cvDefined: typeof cv !== 'undefined',
                cvMat: typeof cv !== 'undefined' && !!cv.Mat,
                onOpenCVReadyCalled: !!this.onOpenCVReadyCalled
            });
            return false;
        }
        
        if (!this.srcMat) {
            console.error('srcMat not initialized');
            return false;
        }
        
        if (typeof cv === 'undefined') {
            console.error('OpenCV cv object not available');
            return false;
        }
        
        try {
            // Clear any existing trackers
            console.log('Clearing existing trackers, count before:', this.trackers.length);
            this.clearTrackers();
            console.log('Trackers cleared, count after:', this.trackers.length);
            
            // Create the robust hybrid tracker
            console.log('Creating robust hybrid tracker...');
            const tracker = this.createRobustHybridTracker();
            if (!tracker) {
                console.error('Failed to create robust hybrid tracker');
                return false;
            }
            console.log('Hybrid tracker created successfully');
            
            // Create bounding box object for hybrid tracker
            const rect = {
                x: Math.round(boundingBox.x), 
                y: Math.round(boundingBox.y), 
                width: Math.round(boundingBox.width), 
                height: Math.round(boundingBox.height)
            };
            
            // Initialize tracker with current frame
            console.log('Updating OpenCV frame before tracker initialization...');
            const frameSuccess = this.updateOpenCVFrame();
            if (!frameSuccess) {
                console.error('Failed to capture video frame');
                tracker.delete();
                return false;
            }
            
            console.log('Initializing tracker with frame and bounding box...');
            const success = tracker.init(this.srcMat, rect);
            console.log('Tracker initialization result:', success);
            
            if (success) {
                console.log('Adding tracker to array, current count:', this.trackers.length);
                this.trackers.push({
                    tracker: tracker,
                    algorithm: 'HybridTracker',
                    rect: rect,
                    confidence: 1.0
                });
                console.log('Tracker added, new count:', this.trackers.length);
                
                this.trackingBox = boundingBox;
                this.trackingInitialized = true;
                this.trackingFailureCount = 0;
                this.trackingQuality = 100;
                
                console.log('=== TRACKING INITIALIZATION SUCCESS ===', {
                    trackingInitialized: this.trackingInitialized,
                    trackersCount: this.trackers.length,
                    trackingQuality: this.trackingQuality,
                    isCalibrated: this.isCalibrated,
                    boundingBox: this.trackingBox
                });
                
                return true;
            } else {
                console.error('Failed to initialize tracker');
                tracker.delete();
                return false;
            }
            
        } catch (error) {
            console.error('Error initializing tracking:', error);
            return false;
        }
    }
    
    performOpenCVTracking() {
        console.log('=== PERFORM OPENCV TRACKING ===', {
            trackingInitialized: this.trackingInitialized,
            isOpenCVReady: this.isOpenCVReady,
            trackersLength: this.trackers.length,
            trackingQuality: this.trackingQuality
        });
        
        if (!this.trackingInitialized || !this.isOpenCVReady || this.trackers.length === 0) {
            console.log('Tracking requirements not met, returning');
            return;
        }
        
        try {
            this.updateOpenCVFrame();
            
            let bestTracker = null;
            let bestRect = null;
            let bestConfidence = 0;
            
            // Update all active trackers
            for (let i = this.trackers.length - 1; i >= 0; i--) {
                const trackerObj = this.trackers[i];
                const rect = { x: 0, y: 0, width: 0, height: 0 };
                
                try {
                    const success = trackerObj.tracker.update(this.srcMat, rect);
                    
                    if (success) {
                        // Calculate confidence based on tracking quality heuristics
                        const confidence = this.calculateTrackingConfidence(rect, trackerObj.rect);
                        trackerObj.confidence = confidence;
                        trackerObj.rect = rect;
                        
                        if (confidence > bestConfidence) {
                            bestConfidence = confidence;
                            bestTracker = trackerObj;
                            bestRect = rect;
                        }
                    } else {
                        // Remove failed tracker
                        console.log(`Tracker ${trackerObj.algorithm} failed, removing`);
                        trackerObj.tracker.delete();
                        this.trackers.splice(i, 1);
                    }
                } catch (error) {
                    console.error(`Error updating tracker ${trackerObj.algorithm}:`, error);
                    trackerObj.tracker.delete();
                    this.trackers.splice(i, 1);
                }
            }
            
            if (bestTracker && bestRect) {
                // Update tracking position
                const centerX = bestRect.x + bestRect.width / 2;
                const centerY = bestRect.y + bestRect.height / 2;
                
                const position = {
                    x: centerX / this.width,
                    y: centerY / this.height
                };
                
                console.log('OpenCV Tracking Position:', {
                    rect: bestRect,
                    center: { x: centerX, y: centerY },
                    normalized: position,
                    algorithm: bestTracker.algorithm
                });
                
                this.applyPositionWithSmoothing(position);
                this.trackingQuality = Math.round(bestConfidence * 100);
                
                // Update tracking box
                this.trackingBox = {
                    x: bestRect.x,
                    y: bestRect.y,
                    width: bestRect.width,
                    height: bestRect.height
                };
                
                // Draw tracking visualization
                this.drawOpenCVTracking(bestRect, bestTracker);
                
                this.trackingFailureCount = 0;
            } else {
                // No successful tracking
                this.trackingFailureCount++;
                this.trackingQuality = Math.max(0, this.trackingQuality - 10);
                
                console.log(`Tracking failure count: ${this.trackingFailureCount}/${this.maxTrackingFailures}`);
                
                if (this.trackingFailureCount >= this.maxTrackingFailures) {
                    console.log('Maximum tracking failures reached, need re-calibration');
                    this.resetTracking();
                }
            }
            
        } catch (error) {
            console.error('Error in OpenCV tracking:', error);
            this.trackingFailureCount++;
        }
    }
    
    calculateTrackingConfidence(currentRect, previousRect) {
        try {
            // Simple heuristics for tracking confidence
            // Based on size change and movement distance
            
            const sizeRatio = (currentRect.width * currentRect.height) / (previousRect.width * previousRect.height);
            const sizeChange = Math.abs(1 - sizeRatio);
            
            const dx = Math.abs(currentRect.x - previousRect.x);
            const dy = Math.abs(currentRect.y - previousRect.y);
            const movement = Math.sqrt(dx * dx + dy * dy);
            
            // Confidence decreases with large size changes and excessive movement
            let confidence = 1.0;
            confidence -= Math.min(0.3, sizeChange); // Penalty for size change
            confidence -= Math.min(0.3, movement / 100); // Penalty for large movement
            
            // Ensure bounds are valid
            if (currentRect.x < 0 || currentRect.y < 0 || 
                currentRect.x + currentRect.width > this.width ||
                currentRect.y + currentRect.height > this.height) {
                confidence *= 0.5; // Penalty for going out of bounds
            }
            
            return Math.max(0, confidence);
        } catch (error) {
            console.error('Error calculating tracking confidence:', error);
            return 0.5;
        }
    }
    
    updateOpenCVFrame() {
        if (!this.isOpenCVReady || !this.srcMat || !this.video) return;
        
        try {
            // Check if video is ready
            if (this.video.readyState !== this.video.HAVE_ENOUGH_DATA) {
                console.log('Video not ready for frame capture');
                return false;
            }
            
            // Create a temporary canvas to capture video frame
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.width;
            tempCanvas.height = this.height;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Draw video frame to temporary canvas (mirrored to match tracking canvas)
            tempCtx.save();
            tempCtx.scale(-1, 1);
            tempCtx.drawImage(this.video, -this.width, 0, this.width, this.height);
            tempCtx.restore();
            
            // Get image data and copy to OpenCV matrix
            const imageData = tempCtx.getImageData(0, 0, this.width, this.height);
            this.dstMat.data.set(imageData.data);
            
            // Convert from RGBA to RGB for OpenCV tracking
            cv.cvtColor(this.dstMat, this.srcMat, cv.COLOR_RGBA2RGB);
            
            return true;
            
        } catch (error) {
            console.error('Error updating OpenCV frame:', error);
            return false;
        }
    }
    
    clearTrackers() {
        try {
            console.log('=== CLEAR TRACKERS CALLED ===', {
                currentTrackers: this.trackers.length,
                stackTrace: new Error().stack.split('\n')[2] // Show where this was called from
            });
            
            this.trackers.forEach(trackerObj => {
                if (trackerObj.tracker) {
                    trackerObj.tracker.delete();
                }
                if (trackerObj.rect) {
                    trackerObj.rect.delete();
                }
            });
            this.trackers = [];
            
            console.log('Trackers cleared, new length:', this.trackers.length);
        } catch (error) {
            console.error('Error clearing trackers:', error);
        }
    }
    
    resetTracking() {
        console.log('=== RESETTING TRACKING ===', {
            stackTrace: new Error().stack.split('\n')[2] // Show where this was called from
        });
        
        this.clearTrackers();
        this.trackingInitialized = false;
        this.trackingBox = null;
        this.trackingFailureCount = 0;
        this.trackingQuality = 0;
        this.isCalibrated = false;
        this.calibratedRegion = null;
        
        // Update UI
        document.getElementById('status').textContent = 'Tracking lost. Please recalibrate.';
        document.getElementById('trackingQuality').textContent = '0%';
    }
    
    drawOpenCVTracking(rect, trackerObj) {
        try {
            this.trackingCtx.strokeStyle = '#00ff00';
            this.trackingCtx.lineWidth = 3;
            this.trackingCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
            
            // Draw center point
            const centerX = rect.x + rect.width / 2;
            const centerY = rect.y + rect.height / 2;
            this.trackingCtx.fillStyle = '#00ff00';
            this.trackingCtx.beginPath();
            this.trackingCtx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
            this.trackingCtx.fill();
            
            // Draw tracker info
            this.trackingCtx.fillStyle = '#00ff00';
            this.trackingCtx.font = '14px Arial';
            
            // Show active tracking methods if available
            let trackerInfo = `${trackerObj.algorithm} (${Math.round(trackerObj.confidence * 100)}%)`;
            if (this.customTracker && this.customTracker.results) {
                const activeTrackers = [];
                if (this.customTracker.results.opticalFlow) activeTrackers.push('OF');
                if (this.customTracker.results.templateMatching) activeTrackers.push('TM');
                if (this.customTracker.results.colorTracking) activeTrackers.push('CT');
                if (activeTrackers.length > 0) {
                    trackerInfo += ` [${activeTrackers.join('+')}]`;
                }
            }
            
            this.trackingCtx.fillText(trackerInfo, rect.x, rect.y - 5);
            
        } catch (error) {
            console.error('Error drawing OpenCV tracking:', error);
        }
    }
    
    // OPTICAL FLOW TRACKING METHOD
    performOpticalFlowTracking(trackerObject, frame, gray) {
        try {
            const tracker = trackerObject || this.customTracker;
            if (!tracker.opticalFlowPoints || !tracker.prevGray) {
                return null;
            }
            
            const nextPts = cv.Mat.zeros(tracker.opticalFlowPoints.rows, 
                                       tracker.opticalFlowPoints.cols, cv.CV_32FC2);
            const status = cv.Mat.zeros(tracker.opticalFlowPoints.rows, 1, cv.CV_8UC1);
            const err = cv.Mat.zeros(tracker.opticalFlowPoints.rows, 1, cv.CV_32FC1);
            
            cv.calcOpticalFlowPyrLK(
                tracker.prevGray, gray,
                tracker.opticalFlowPoints, nextPts,
                status, err
            );
            
            const goodPts = [];
            const statusData = status.data;
            
            for (let i = 0; i < nextPts.rows; i++) {
                if (statusData[i] === 1) {
                    const x = nextPts.floatAt(i, 0);
                    const y = nextPts.floatAt(i, 1);
                    const error = err.floatAt(i, 0);
                    
                    // Filter by tracking error
                    if (error < 30) {
                        goodPts.push([x, y]);
                    }
                }
            }
            
            nextPts.delete();
            status.delete();
            err.delete();
            
            if (goodPts.length < 4) return null;
            
            // Calculate center of mass
            const centerX = goodPts.reduce((sum, p) => sum + p[0], 0) / goodPts.length;
            const centerY = goodPts.reduce((sum, p) => sum + p[1], 0) / goodPts.length;
            
            const confidence = Math.min(1.0, goodPts.length / (tracker.opticalFlowPoints.rows * 0.7));
            
            return {
                x: centerX - tracker.boundingBox.width / 2,
                y: centerY - tracker.boundingBox.height / 2,
                width: tracker.boundingBox.width,
                height: tracker.boundingBox.height,
                confidence: confidence,
                goodPoints: goodPts
            };
            
        } catch (error) {
            console.error('Error in optical flow tracking:', error);
            return null;
        }
    }
    
    // TEMPLATE MATCHING METHOD
    performTemplateMatching(trackerObject, gray) {
        try {
            const tracker = trackerObject || this.customTracker;
            if (!tracker.templateImage) return null;
            
            // Convert template to grayscale if needed
            const grayTemplate = new cv.Mat();
            if (tracker.templateImage.channels() === 3) {
                cv.cvtColor(tracker.templateImage, grayTemplate, cv.COLOR_RGB2GRAY);
            } else {
                grayTemplate = tracker.templateImage.clone();
            }
            
            const result = new cv.Mat();
            cv.matchTemplate(gray, grayTemplate, result, cv.TM_CCOEFF_NORMED);
            
            const minMaxLoc = cv.minMaxLoc(result);
            const maxLoc = minMaxLoc.maxLoc;
            const confidence = minMaxLoc.maxVal;
            
            result.delete();
            grayTemplate.delete();
            
            if (confidence < 0.5) return null;
            
            return {
                x: maxLoc.x,
                y: maxLoc.y,
                width: tracker.templateSize.width,
                height: tracker.templateSize.height,
                confidence: confidence
            };
            
        } catch (error) {
            console.error('Error in template matching:', error);
            return null;
        }
    }
    
    // COLOR-BASED TRACKING METHOD
    performColorTracking(trackerObject, frame) {
        try {
            const tracker = trackerObject || this.customTracker;
            if (!tracker.colorHistogram) return null;
            
            const hsv = new cv.Mat();
            cv.cvtColor(frame, hsv, cv.COLOR_RGB2HSV);
            
            const backproj = new cv.Mat();
            const channels = [0, 1]; // H and S channels
            const ranges = [0, 180, 0, 256];
            const scale = 1;
            
            const hsvVec = new cv.MatVector();
            hsvVec.push_back(hsv);
            
            cv.calcBackProject(hsvVec, channels, 
                             tracker.colorHistogram, backproj, ranges, scale);
            
            hsvVec.delete();
            
            // Use morphological operations to clean up the backprojection
            const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
            cv.morphologyEx(backproj, backproj, cv.MORPH_CLOSE, kernel);
            cv.morphologyEx(backproj, backproj, cv.MORPH_OPEN, kernel);
            
            // Find contours
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(backproj, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            
            if (contours.size() === 0) {
                hsv.delete();
                backproj.delete();
                kernel.delete();
                contours.delete();
                hierarchy.delete();
                return null;
            }
            
            // Find largest contour
            let maxArea = 0;
            let maxContour = null;
            for (let i = 0; i < contours.size(); i++) {
                const area = cv.contourArea(contours.get(i));
                if (area > maxArea) {
                    maxArea = area;
                    maxContour = contours.get(i);
                }
            }
            
            if (!maxContour || maxArea < 100) {
                hsv.delete();
                backproj.delete();
                kernel.delete();
                contours.delete();
                hierarchy.delete();
                return null;
            }
            
            const boundRect = cv.boundingRect(maxContour);
            const expectedArea = tracker.boundingBox.width * tracker.boundingBox.height;
            const confidence = Math.min(1.0, maxArea / expectedArea);
            
            // Clean up
            hsv.delete();
            backproj.delete();
            kernel.delete();
            contours.delete();
            hierarchy.delete();
            
            return {
                x: boundRect.x,
                y: boundRect.y,
                width: boundRect.width,
                height: boundRect.height,
                confidence: confidence
            };
            
        } catch (error) {
            console.error('Error in color tracking:', error);
            return null;
        }
    }
    
    // FUSION OF TRACKING RESULTS
    fuseTrackingResults(trackerObject) {
        // Use passed tracker object or fall back to class property
        const tracker = trackerObject || this.customTracker;
        
        // Ensure results object exists
        if (!tracker.results) {
            console.error('Results object not found in tracker', tracker);
            return null;
        }
        
        // Ensure weights object exists
        if (!tracker.confidenceWeights) {
            console.error('Confidence weights not found in tracker', tracker);
            return null;
        }
        
        const results = tracker.results;
        const weights = tracker.confidenceWeights;
        
        console.log('Fusion Debug:', {
            opticalFlow: !!results.opticalFlow,
            templateMatching: !!results.templateMatching,
            colorTracking: !!results.colorTracking,
            ofConf: results.opticalFlow?.confidence,
            tmConf: results.templateMatching?.confidence,
            ctConf: results.colorTracking?.confidence
        });
        
        // Filter valid results
        const validResults = [];
        if (results.opticalFlow) validResults.push({...results.opticalFlow, type: 'opticalFlow'});
        if (results.templateMatching) validResults.push({...results.templateMatching, type: 'templateMatching'});
        if (results.colorTracking) validResults.push({...results.colorTracking, type: 'colorTracking'});
        
        console.log('Valid tracking results:', validResults.length);
        if (validResults.length === 0) return null;
        
        // Weighted average of positions
        let totalWeight = 0;
        let weightedX = 0, weightedY = 0, weightedW = 0, weightedH = 0;
        
        validResults.forEach(result => {
            const weight = weights[result.type] * result.confidence;
            totalWeight += weight;
            weightedX += result.x * weight;
            weightedY += result.y * weight;
            weightedW += result.width * weight;
            weightedH += result.height * weight;
        });
        
        if (totalWeight === 0) return null;
        
        return {
            x: Math.max(0, Math.round(weightedX / totalWeight)),
            y: Math.max(0, Math.round(weightedY / totalWeight)),
            width: Math.round(weightedW / totalWeight),
            height: Math.round(weightedH / totalWeight),
            confidence: totalWeight / validResults.length,
            activeTrackers: validResults.map(r => r.type)
        };
    }
    
    // UPDATE TRACKER STATE
    updateTrackerState(trackerObject, frame, gray, result) {
        try {
            // Use passed tracker object or fall back to class property
            const tracker = trackerObject || this.customTracker;
            
            // Update optical flow points if available
            if (tracker.results.opticalFlow && tracker.results.opticalFlow.goodPoints) {
                tracker.opticalFlowPoints.delete();
                tracker.opticalFlowPoints = cv.matFromArray(
                    tracker.results.opticalFlow.goodPoints.length, 1, cv.CV_32FC2,
                    tracker.results.opticalFlow.goodPoints.flat()
                );
            }
            
            // Update template if template matching confidence is high
            if (tracker.results.templateMatching && 
                tracker.results.templateMatching.confidence > 0.8) {
                const rectObj = { x: result.x, y: result.y, width: result.width, height: result.height };
                if (rectObj.x >= 0 && rectObj.y >= 0 && 
                    rectObj.x + rectObj.width <= frame.cols &&
                    rectObj.y + rectObj.height <= frame.rows) {
                    tracker.templateImage.delete();
                    tracker.templateImage = frame.roi(rectObj).clone();
                }
            }
            
            // Update previous frame for optical flow
            tracker.prevGray.delete();
            tracker.prevGray = gray.clone();
            
            // Update bounding box
            tracker.boundingBox = {
                x: result.x, y: result.y,
                width: result.width, height: result.height
            };
            
        } catch (error) {
            console.error('Error updating tracker state:', error);
        }
    }
    
    onOpenCVReady() {
        console.log('=== OPENCV READY ===');
        
        // Check if OpenCV is actually fully loaded
        if (typeof cv === 'undefined' || !cv.Mat || !cv.Mat.zeros) {
            console.log('OpenCV not fully loaded yet, waiting...');
            // Try again after a short delay
            setTimeout(() => {
                this.onOpenCVReady();
            }, 100);
            return;
        }
        
        this.isOpenCVReady = true;
        this.onOpenCVReadyCalled = true;
        this.initializeOpenCVMatrices();
        
        // Now initialize the OpenCV tracker since OpenCV is ready
        this.initOpenCVTracker();
        
        // Update status based on current state
        if (this.video && this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            document.getElementById('status').textContent = 'Ready (OpenCV)! Click Calibrate to select bounding box to track.';
        } else {
            document.getElementById('status').textContent = 'OpenCV loaded, waiting for camera...';
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
            console.log('Initializing OpenCV matrices with dimensions:', this.width, 'x', this.height);
            console.log('Available OpenCV objects:', {
                Mat: !!cv.Mat,
                'Mat.zeros': !!(cv.Mat && cv.Mat.zeros),
                MatVector: !!cv.MatVector,
                CV_8UC3: !!cv.CV_8UC3,
                CV_8UC4: !!cv.CV_8UC4,
                calcOpticalFlowPyrLK: !!cv.calcOpticalFlowPyrLK
            });
            
            // Initialize OpenCV matrices for tracking using correct OpenCV.js API
            this.srcMat = cv.Mat.zeros(this.height, this.width, cv.CV_8UC3);
            this.dstMat = cv.Mat.zeros(this.height, this.width, cv.CV_8UC4); // RGBA for image capture
            
            // Legacy matrices for color tracking fallback
            this.src = cv.Mat.zeros(this.height, this.width, cv.CV_8UC4);
            this.hsv = cv.Mat.zeros(this.height, this.width, cv.CV_8UC3);
            this.mask = cv.Mat.zeros(this.height, this.width, cv.CV_8UC1);
            this.contours = new cv.MatVector();
            this.hierarchy = cv.Mat.zeros(4, 1, cv.CV_32SC4);
            
            console.log('OpenCV matrices initialized successfully');
            
        } catch (error) {
            console.error('Error initializing OpenCV matrices:', error);
            console.error('OpenCV object structure:', Object.keys(cv).slice(0, 20));
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
            
            // Throttled object detection to prevent UI blocking
            const currentTime = Date.now();
            const shouldRunDetection = currentTime - this.lastDetectionTime >= this.detectionInterval;
            
            // Only perform tracking if calibrated and not in calibration mode
            if (this.isCalibrated && !this.calibrationMode) {
                console.log('=== TRACKING FRAME ===', {
                    isCalibrated: this.isCalibrated,
                    calibrationMode: this.calibrationMode,
                    useOpenCVTracking: this.useOpenCVTracking,
                    trackingInitialized: this.trackingInitialized,
                    trackersCount: this.trackers.length
                });
                
                if (this.useOpenCVTracking && this.trackingInitialized) {
                    // Use OpenCV feature-based tracking
                    console.log('Calling performOpenCVTracking...');
                    this.performOpenCVTracking();
                } else if (this.targetColor) {
                    console.log('Fallback: Tracking calibrated object with color tracking:', this.targetColor);
                    if (this.isOpenCVReady && typeof cv !== 'undefined') {
                        this.performObjectTracking();
                    } else {
                        // Simple fallback color tracking without OpenCV
                        this.performSimpleColorTracking();
                    }
                } else {
                    console.log('No tracking method available:', {
                        useOpenCVTracking: this.useOpenCVTracking,
                        trackingInitialized: this.trackingInitialized,
                        targetColor: !!this.targetColor
                    });
                }
            } else {
                console.log('Not tracking:', {
                    isCalibrated: this.isCalibrated,
                    calibrationMode: this.calibrationMode
                });
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
            console.log('=== UPDATE UI ===', {
                objectPosition: this.objectPosition,
                trackingQuality: this.trackingQuality,
                willSend: this.trackingQuality > 1
            });
            
            if (this.trackingQuality > 1) { // Temporarily lowered to debug tracking
                console.log('Sending object position:', this.objectPosition, 'Quality:', this.trackingQuality);
                this.socket.emit('object-position', this.objectPosition);
            } else {
                console.log('Not sending - quality too low:', this.trackingQuality);
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
    
    async calibrateFromBoundingBox() {
        console.log('=== OPENCV BOUNDING BOX CALIBRATION ===');
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
            
            if (width < 20 || height < 20) {
                throw new Error('Bounding box too small - drag a larger area (minimum 20x20 pixels)');
            }
            
            console.log('Calibration area:', { left, top, width, height });
            
            // Store the calibrated region
            this.calibratedRegion = { left, top, right, bottom };
            
            // Initialize OpenCV tracking with the selected bounding box
            const trackingBoundingBox = {
                x: left,
                y: top,
                width: width,
                height: height
            };
            
            const success = this.initializeTracking(trackingBoundingBox);
            
            if (success) {
                this.isCalibrated = true;
                this.calibrationMode = false;
                this.boundingBoxMode = false;
                
                console.log('=== CALIBRATION SUCCESSFUL ===', {
                    isCalibrated: this.isCalibrated,
                    calibrationMode: this.calibrationMode,
                    boundingBoxMode: this.boundingBoxMode,
                    trackingInitialized: this.trackingInitialized,
                    useOpenCVTracking: this.useOpenCVTracking
                });
                
                document.getElementById('status').textContent = 'OpenCV tracking initialized! Object is being tracked.';
            } else {
                throw new Error('Failed to initialize OpenCV tracking');
            }
            
        } catch (error) {
            console.error('=== CALIBRATION FAILED ===');
            console.error('Error:', error);
            document.getElementById('status').textContent = 'Calibration failed! ' + error.message;
            
            // Reset calibration state on failure
            this.calibrationMode = false;
            this.boundingBoxMode = false;
            this.isCalibrated = false;
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
    
    // MediaPipe camera initialization no longer needed for object detection
    // Object detection runs directly on video frames
    
    // Old MediaPipe tracking methods removed - now using object detection
    
    cleanup() {
        try {
            // Cleanup OpenCV matrices
            if (this.src) this.src.delete();
            if (this.hsv) this.hsv.delete();
            if (this.mask) this.mask.delete();
            if (this.contours) this.contours.delete();
            if (this.hierarchy) this.hierarchy.delete();
            
            // Cleanup object detector
            if (this.objectDetector) {
                this.objectDetector.dispose();
                this.objectDetector = null;
            }
            
            // Cleanup TensorFlow
            if (typeof tf !== 'undefined') {
                tf.disposeVariables();
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
    window.tracker = tracker; // Set global reference for hybrid tracker methods
    
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