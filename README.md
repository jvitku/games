# Webcam Hockey Game

A real-time hockey game controlled by webcam ball tracking. Move a colored ball in front of your webcam to control your hockey player!

## Features

- Real-time ball tracking using computer vision (OpenCV.js)
- Smooth player movement based on ball position
- AI opponent with realistic behavior
- Score tracking and game state management
- Responsive web interface
- Socket.io for real-time communication

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and go to `http://localhost:3000`

## How to Play

1. **Allow webcam access** when prompted
2. **Calibrate the ball tracking**:
   - Click the "Calibrate" button
   - Click on your colored ball in the webcam feed to set the target color
3. **Start the game** by clicking "Start Game"
4. **Control your player** by moving the ball up and down in front of the webcam
5. **Score goals** by getting the puck past the AI opponent

## Tips

- Use a brightly colored ball (red, blue, or yellow work well)
- Ensure good lighting for better tracking
- Keep the ball in the webcam frame
- The tracking works best with solid-colored balls against contrasting backgrounds

## Controls

- **Start Game**: Begin playing
- **Calibrate**: Set up ball color tracking (click on the ball in the video)
- **Reset**: Restart the game with score 0-0

## Technical Details

- **Frontend**: HTML5 Canvas, JavaScript, CSS
- **Backend**: Node.js, Express, Socket.io
- **Computer Vision**: OpenCV.js for advanced tracking, fallback to simple color detection
- **Real-time Communication**: WebSocket for ball position updates

Enjoy playing hockey with your webcam!