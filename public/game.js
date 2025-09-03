class ArcadeGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.socket = io();
        
        this.gameState = 'menu';
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.timeLeft = 120; // 2 minutes per game
        this.gameTimer = null;
        
        // Player ship controlled by ball position
        this.player = {
            x: this.canvas.width / 2,
            y: this.canvas.height - 60,
            width: 40,
            height: 30,
            speed: 8,
            targetX: this.canvas.width / 2,
            targetY: this.canvas.height - 60,
            shootCooldown: 0
        };
        
        // Projectiles
        this.bullets = [];
        this.enemyBullets = [];
        
        // Enemies
        this.enemies = [];
        this.enemySpawnTimer = 0;
        this.enemySpawnRate = 60; // frames between spawns
        
        // Power-ups
        this.powerUps = [];
        this.powerUpTimer = 0;
        
        // Particles for effects
        this.particles = [];
        
        // Ball tracking
        this.ballPosition = { x: 0.5, y: 0.5 };
        this.isCalibrated = false;
        this.lastBallPos = { x: 0.5, y: 0.5 };
        this.shootDetected = false;
        
        this.initEventListeners();
        this.gameLoop();
    }
    
    initEventListeners() {
        document.getElementById('startBtn').addEventListener('click', () => this.startGame());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetGame());
        document.getElementById('calibrateBtn').addEventListener('click', () => this.calibrate());
        
        this.socket.on('ball-position', (data) => {
            this.ballPosition = data;
            if (this.isCalibrated && this.gameState === 'playing') {
                this.updatePlayerFromBall(data);
                this.detectShoot(data);
            }
        });
    }
    
    startGame() {
        this.gameState = 'playing';
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.timeLeft = 120;
        this.bullets = [];
        this.enemyBullets = [];
        this.enemies = [];
        this.powerUps = [];
        this.particles = [];
        this.startTimer();
        document.getElementById('status').textContent = 'Destroy enemies! Move ball to control ship!';
    }
    
    resetGame() {
        this.gameState = 'menu';
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.timeLeft = 120;
        if (this.gameTimer) clearInterval(this.gameTimer);
        this.bullets = [];
        this.enemyBullets = [];
        this.enemies = [];
        this.powerUps = [];
        this.particles = [];
        this.updateScore();
        document.getElementById('status').textContent = 'Game Reset';
    }
    
    calibrate() {
        this.isCalibrated = true;
        document.getElementById('status').textContent = 'Calibrated! Move ball to control ship, quick movements to shoot!';
    }
    
    updatePlayerFromBall(ballPos) {
        // Map ball position to player position
        this.player.targetX = ballPos.x * (this.canvas.width - this.player.width);
        this.player.targetY = (1 - ballPos.y) * (this.canvas.height - this.player.height - 100) + this.canvas.height - 150;
        
        // Keep player in bounds
        this.player.targetX = Math.max(0, Math.min(this.canvas.width - this.player.width, this.player.targetX));
        this.player.targetY = Math.max(this.canvas.height / 2, Math.min(this.canvas.height - this.player.height, this.player.targetY));
    }
    
    detectShoot(ballPos) {
        // Detect rapid movement as shooting gesture
        const dx = Math.abs(ballPos.x - this.lastBallPos.x);
        const dy = Math.abs(ballPos.y - this.lastBallPos.y);
        const movement = Math.sqrt(dx * dx + dy * dy);
        
        if (movement > 0.1 && this.player.shootCooldown <= 0) { // Quick movement threshold
            this.shoot();
            this.player.shootCooldown = 15; // Prevent rapid fire
        }
        
        this.lastBallPos = { ...ballPos };
    }
    
    shoot() {
        this.bullets.push({
            x: this.player.x + this.player.width / 2 - 2,
            y: this.player.y,
            width: 4,
            height: 10,
            speed: 8,
            damage: 1
        });
    }
    
    spawnEnemy() {
        const types = ['basic', 'fast', 'strong'];
        const type = types[Math.floor(Math.random() * types.length)];
        
        let enemy = {
            x: Math.random() * (this.canvas.width - 40),
            y: -40,
            width: 30,
            height: 30,
            type: type,
            health: 1,
            shootTimer: 0,
            movePattern: Math.random()
        };
        
        switch(type) {
            case 'fast':
                enemy.speed = 3 + this.level * 0.5;
                enemy.color = '#FF6B6B';
                enemy.points = 20;
                break;
            case 'strong':
                enemy.health = 3;
                enemy.speed = 1 + this.level * 0.2;
                enemy.color = '#9B59B6';
                enemy.points = 50;
                enemy.width = 40;
                enemy.height = 40;
                break;
            default: // basic
                enemy.speed = 2 + this.level * 0.3;
                enemy.color = '#3498DB';
                enemy.points = 10;
        }
        
        this.enemies.push(enemy);
    }
    
    spawnPowerUp(x, y) {
        if (Math.random() < 0.3) { // 30% chance
            const types = ['rapidFire', 'shield', 'multiShot'];
            const type = types[Math.floor(Math.random() * types.length)];
            
            this.powerUps.push({
                x: x,
                y: y,
                width: 20,
                height: 20,
                type: type,
                speed: 2,
                color: type === 'rapidFire' ? '#F39C12' : 
                       type === 'shield' ? '#2ECC71' : '#E74C3C'
            });
        }
    }
    
    update() {
        if (this.gameState !== 'playing') return;
        
        // Update player position smoothly
        this.player.x += (this.player.targetX - this.player.x) * 0.15;
        this.player.y += (this.player.targetY - this.player.y) * 0.15;
        
        if (this.player.shootCooldown > 0) this.player.shootCooldown--;
        
        // Spawn enemies
        this.enemySpawnTimer++;
        if (this.enemySpawnTimer >= this.enemySpawnRate) {
            this.spawnEnemy();
            this.enemySpawnTimer = 0;
            this.enemySpawnRate = Math.max(20, 60 - this.level * 5); // Increase spawn rate
        }
        
        // Update bullets
        this.bullets = this.bullets.filter(bullet => {
            bullet.y -= bullet.speed;
            return bullet.y > -bullet.height;
        });
        
        // Update enemy bullets
        this.enemyBullets = this.enemyBullets.filter(bullet => {
            bullet.y += bullet.speed;
            return bullet.y < this.canvas.height + bullet.height;
        });
        
        // Update enemies
        this.enemies.forEach(enemy => {
            enemy.y += enemy.speed;
            
            // Enemy movement patterns
            if (enemy.movePattern < 0.33) {
                enemy.x += Math.sin(enemy.y * 0.01) * 2;
            } else if (enemy.movePattern < 0.66) {
                enemy.x += Math.cos(enemy.y * 0.02) * 1.5;
            }
            
            // Enemy shooting
            enemy.shootTimer++;
            if (enemy.shootTimer > 60 + Math.random() * 120) {
                this.enemyBullets.push({
                    x: enemy.x + enemy.width / 2 - 2,
                    y: enemy.y + enemy.height,
                    width: 4,
                    height: 8,
                    speed: 3 + this.level * 0.5
                });
                enemy.shootTimer = 0;
            }
        });
        
        // Remove enemies that went off screen
        this.enemies = this.enemies.filter(enemy => enemy.y < this.canvas.height + 50);
        
        // Update power-ups
        this.powerUps = this.powerUps.filter(powerUp => {
            powerUp.y += powerUp.speed;
            return powerUp.y < this.canvas.height + powerUp.height;
        });
        
        // Update particles
        this.particles = this.particles.filter(particle => {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life--;
            particle.alpha = particle.life / particle.maxLife;
            return particle.life > 0;
        });
        
        this.checkCollisions();
        this.updateScore();
    }
    
    checkCollisions() {
        // Bullet vs Enemy collisions
        this.bullets.forEach((bullet, bulletIndex) => {
            this.enemies.forEach((enemy, enemyIndex) => {
                if (this.isColliding(bullet, enemy)) {
                    // Create explosion particles
                    this.createExplosion(enemy.x + enemy.width/2, enemy.y + enemy.height/2, enemy.color);
                    
                    enemy.health -= bullet.damage;
                    this.bullets.splice(bulletIndex, 1);
                    
                    if (enemy.health <= 0) {
                        this.score += enemy.points;
                        this.spawnPowerUp(enemy.x, enemy.y);
                        this.enemies.splice(enemyIndex, 1);
                    }
                }
            });
        });
        
        // Player vs Enemy bullet collisions
        this.enemyBullets.forEach((bullet, bulletIndex) => {
            if (this.isColliding(bullet, this.player)) {
                this.lives--;
                this.enemyBullets.splice(bulletIndex, 1);
                this.createExplosion(this.player.x + this.player.width/2, this.player.y + this.player.height/2, '#FF0000');
                
                if (this.lives <= 0) {
                    this.endGame();
                }
            }
        });
        
        // Player vs Enemy collisions
        this.enemies.forEach((enemy, enemyIndex) => {
            if (this.isColliding(this.player, enemy)) {
                this.lives--;
                this.enemies.splice(enemyIndex, 1);
                this.createExplosion(enemy.x + enemy.width/2, enemy.y + enemy.height/2, enemy.color);
                
                if (this.lives <= 0) {
                    this.endGame();
                }
            }
        });
        
        // Player vs PowerUp collisions
        this.powerUps.forEach((powerUp, powerUpIndex) => {
            if (this.isColliding(this.player, powerUp)) {
                this.applyPowerUp(powerUp.type);
                this.powerUps.splice(powerUpIndex, 1);
            }
        });
    }
    
    isColliding(rect1, rect2) {
        return rect1.x < rect2.x + rect2.width &&
               rect1.x + rect1.width > rect2.x &&
               rect1.y < rect2.y + rect2.height &&
               rect1.y + rect1.height > rect2.y;
    }
    
    createExplosion(x, y, color) {
        for (let i = 0; i < 8; i++) {
            this.particles.push({
                x: x,
                y: y,
                vx: (Math.random() - 0.5) * 8,
                vy: (Math.random() - 0.5) * 8,
                life: 20,
                maxLife: 20,
                color: color,
                alpha: 1,
                size: Math.random() * 4 + 2
            });
        }
    }
    
    applyPowerUp(type) {
        // Power-up effects would be implemented here
        this.score += 100; // Bonus points for collecting power-ups
    }
    
    startTimer() {
        this.gameTimer = setInterval(() => {
            this.timeLeft--;
            if (this.timeLeft <= 0) {
                this.endGame();
            }
            
            // Level progression
            if (this.timeLeft % 30 === 0) {
                this.level++;
            }
        }, 1000);
    }
    
    endGame() {
        this.gameState = 'gameOver';
        clearInterval(this.gameTimer);
        document.getElementById('status').textContent = `Game Over! Final Score: ${this.score}`;
    }
    
    updateScore() {
        document.getElementById('playerScore').textContent = this.score;
        document.getElementById('aiScore').textContent = `Lives: ${this.lives} | Level: ${this.level}`;
    }
    
    render() {
        // Space background
        this.ctx.fillStyle = '#0a0a2e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Stars background
        this.drawStars();
        
        // Draw player
        this.drawPlayer();
        
        // Draw bullets
        this.ctx.fillStyle = '#FFD700';
        this.bullets.forEach(bullet => {
            this.ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
        });
        
        // Draw enemy bullets
        this.ctx.fillStyle = '#FF0000';
        this.enemyBullets.forEach(bullet => {
            this.ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
        });
        
        // Draw enemies
        this.enemies.forEach(enemy => this.drawEnemy(enemy));
        
        // Draw power-ups
        this.powerUps.forEach(powerUp => this.drawPowerUp(powerUp));
        
        // Draw particles
        this.particles.forEach(particle => this.drawParticle(particle));
        
        // Draw UI
        this.drawUI();
    }
    
    drawStars() {
        this.ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 50; i++) {
            const x = (i * 137.5) % this.canvas.width;
            const y = (i * 217.3) % this.canvas.height;
            const size = Math.random() * 2;
            this.ctx.fillRect(x, y, size, size);
        }
    }
    
    drawPlayer() {
        this.ctx.fillStyle = '#00FF00';
        this.ctx.fillRect(this.player.x, this.player.y, this.player.width, this.player.height);
        
        // Player ship details
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(this.player.x + 18, this.player.y - 5, 4, 8);
    }
    
    drawEnemy(enemy) {
        this.ctx.fillStyle = enemy.color;
        this.ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
        
        // Enemy details
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(enemy.x + 2, enemy.y + 2, enemy.width - 4, enemy.height - 4);
        this.ctx.fillStyle = enemy.color;
        this.ctx.fillRect(enemy.x + 6, enemy.y + 6, enemy.width - 12, enemy.height - 12);
    }
    
    drawPowerUp(powerUp) {
        this.ctx.fillStyle = powerUp.color;
        this.ctx.fillRect(powerUp.x, powerUp.y, powerUp.width, powerUp.height);
        
        // Power-up glow effect
        this.ctx.strokeStyle = powerUp.color;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(powerUp.x - 2, powerUp.y - 2, powerUp.width + 4, powerUp.height + 4);
    }
    
    drawParticle(particle) {
        this.ctx.globalAlpha = particle.alpha;
        this.ctx.fillStyle = particle.color;
        this.ctx.fillRect(particle.x - particle.size/2, particle.y - particle.size/2, particle.size, particle.size);
        this.ctx.globalAlpha = 1;
    }
    
    drawUI() {
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '16px Arial';
        this.ctx.fillText(`Time: ${this.timeLeft}s`, 10, 25);
    }
    
    gameLoop() {
        this.update();
        this.render();
        requestAnimationFrame(() => this.gameLoop());
    }
}

window.addEventListener('load', () => {
    new ArcadeGame();
});