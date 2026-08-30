const canvas = document.getElementById('gameCanvas');
const gl = canvas.getContext('webgl');

if (!gl) {
    alert('WebGL не поддерживается вашим браузером!');
}

// Автоматический ресайз под размеры окна
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Игровые параметры ---
const WORLD_SIZE = 3000;    // Размер игровой арены
const SEGMENT_RADIUS = 16;  // Радиус сегмента змейки
const FOOD_RADIUS = 12;     // Радиус еды
const SPEED = 200;          // Скорость движения пикс/сек
const SEGMENT_SPACING = 18; // Расстояние между узлами в хвосте

// Позиция игрока (в координатах мира)
let snakeX = 0;
let snakeY = 0;
let snakeAngle = 0;         // Направление движения в радианах
let targetAngle = 0;
const ROTATION_SPEED = 5.0; // Скорость поворота (рад/сек)

// История позиций для плавной анимации хвоста
let trail = []; 
let snakeLength = 5;        // Начальная длина змейки
let score = 0;

// Позиция еды
let food = { x: 100, y: 100 };

// Состояние ввода
const keys = { 
    w: false, a: false, s: false, d: false, 
    ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false 
};

// Камера
let cameraX = 0;
let cameraY = 0;

// --- Шейдеры WebGL ---
const vsSource = `
    attribute vec2 a_position;
    uniform vec2 u_translation;
    uniform vec2 u_camera;
    uniform vec2 u_resolution;
    varying vec2 v_localCoord;
    void main() {
        v_localCoord = a_position;
        vec2 worldPos = a_position + u_translation;
        vec2 viewPos = worldPos - u_camera;
        vec2 zeroToOne = viewPos / u_resolution;
        gl_Position = vec4(zeroToOne, 0.0, 1.0);
    }
`;

const fsSource = `
    precision mediump float;
    varying vec2 v_localCoord;
    uniform float u_radius;
    uniform vec4 u_colorStart;
    uniform vec4 u_colorEnd;
    uniform int u_type; // 0 - еда, 1 - голова, 2 - хвост

    void main() {
        float dist = length(v_localCoord);
        if (dist > u_radius) {
            discard;
        }
        float t = dist / u_radius;

        if (u_type == 0) {
            gl_FragColor = mix(u_colorStart, u_colorEnd, t);
        } else if (u_type == 1) {
            gl_FragColor = mix(u_colorStart, u_colorEnd, t * 0.7);
        } else {
            vec4 edgeColor = mix(u_colorStart, u_colorEnd, t);
            gl_FragColor = mix(edgeColor, vec4(1.0, 1.0, 1.0, 0.4), (1.0 - t) * 0.3);
        }
    }
`;

function initShaderProgram(gl, vs, fs) {
    const createShader = (type, source) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, createShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    return program;
}

const program = initShaderProgram(gl, vsSource, fsSource);
gl.useProgram(program);

// Локации переменных шейдеров
const posAttr = gl.getAttribLocation(program, "a_position");
const transUnif = gl.getUniformLocation(program, "u_translation");
const camUnif = gl.getUniformLocation(program, "u_camera");
const resUnif = gl.getUniformLocation(program, "u_resolution");
const radUnif = gl.getUniformLocation(program, "u_radius");
const colorStartUnif = gl.getUniformLocation(program, "u_colorStart");
const colorEndUnif = gl.getUniformLocation(program, "u_colorEnd");
const typeUnif = gl.getUniformLocation(program, "u_type");

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

const maxR = 32;
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -maxR, -maxR,  maxR, -maxR, -maxR,  maxR,
    -maxR,  maxR,  maxR, -maxR,  maxR,  maxR,
]), gl.STATIC_DRAW);

gl.enableVertexAttribArray(posAttr);
gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

// --- Обработка ввода ---
window.addEventListener('keydown', e => { 
    if(e.key in keys || e.key.toLowerCase() in keys) {
        keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true; 
    }
});
window.addEventListener('keyup', e => { 
    if(e.key in keys || e.key.toLowerCase() in keys) {
        keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; 
    }
});

function handleInput(dt) {
    let dx = 0;
    let dy = 0;

    if (keys.w || keys.ArrowUp) dy -= 1;
    if (keys.s || keys.ArrowDown) dy += 1;
    if (keys.a || keys.ArrowLeft) dx -= 1;
    if (keys.d || keys.ArrowRight) dx += 1;

    if (dx !== 0 || dy !== 0) {
        targetAngle = Math.atan2(dy, dx);
        let diff = targetAngle - snakeAngle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        snakeAngle += Math.min(Math.max(diff, -ROTATION_SPEED * dt), ROTATION_SPEED * dt);
    }
}

function spawnFood() {
    const range = WORLD_SIZE - 200;
    food.x = (Math.random() - 0.5) * range;
    food.y = (Math.random() - 0.5) * range;
}

// --- Игровой цикл и Физика ---
let lastTime = 0;

function update(currentTime) {
    if (!lastTime) lastTime = currentTime;
    let dt = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    if (dt > 0.1) dt = 0.1; 

    handleInput(dt);

    snakeX += Math.cos(snakeAngle) * SPEED * dt;
    snakeY += Math.sin(snakeAngle) * SPEED * dt;

    // Границы мира
    const halfWorld = WORLD_SIZE / 2;
    if (snakeX < -halfWorld) snakeX = -halfWorld;
    if (snakeX > halfWorld) snakeX = halfWorld;
    if (snakeY < -halfWorld) snakeY = -halfWorld;
    if (snakeY > halfWorld) snakeY = halfWorld;

    trail.unshift({ x: snakeX, y: snakeY });

    const maxHistory = snakeLength * SEGMENT_SPACING + 10;
    if (trail.length > maxHistory) {
        trail.length = maxHistory;
    }

    // Проверка поедания еды
    let distToFood = Math.hypot(snakeX - food.x, snakeY - food.y);
    if (distToFood < SEGMENT_RADIUS + FOOD_RADIUS) {
        score++;
        snakeLength += 2;
        document.getElementById('score').innerText = `Счёт: ${score}`;
        spawnFood();
    }

    // Столкновение с хвостом
    const selfCollisionStartIdx = SEGMENT_SPACING * 3;
    for (let i = 1; i < snakeLength; i++) {
        let tIdx = i * SEGMENT_SPACING;
        if (tIdx < trail.length && tIdx > selfCollisionStartIdx) {
            let seg = trail[tIdx];
            let distToSeg = Math.hypot(snakeX - seg.x, snakeY - seg.y);
            if (distToSeg < SEGMENT_RADIUS * 0.8) {
                score = 0;
                snakeLength = 5;
                document.getElementById('score').innerText = `Счёт: ${score}`;
                trail = [];
                snakeX = 0;
                snakeY = 0;
                break;
            }
        }
    }

    // Следование камеры
    cameraX += (snakeX - cameraX) * 0.1;
    cameraY += (snakeY - cameraY) * 0.1;
}

function drawCircle(worldX, worldY, radius, colorStart, colorEnd, type) {
    gl.uniform2f(transUnif, worldX, worldY);
    gl.uniform1f(radUnif, radius);
    gl.uniform4fv(colorStartUnif, colorStart);
    gl.uniform4fv(colorEndUnif, colorEnd);
    gl.uniform1i(typeUnif, type);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function render() {
    gl.clearColor(0.04, 0.06, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform2f(resUnif, canvas.width / 2, canvas.height / 2);
    gl.uniform2f(camUnif, cameraX, cameraY);

    // Отрисовка еды
    const pulse = 1.0 + Math.sin(performance.now() * 0.01) * 0.1;
    drawCircle(food.x, food.y, FOOD_RADIUS * pulse, [1.0, 0.3, 0.3, 1.0], [0.5, 0.0, 0.0, 1.0], 0);

    // Отрисовка хвоста
    for (let i = snakeLength - 1; i > 0; i--) {
        let trailIdx = i * SEGMENT_SPACING;
        if (trailIdx >= trail.length) trailIdx = trail.length - 1;
        
        if (trail[trailIdx]) {
            const pos = trail[trailIdx];
            const ratio = i / snakeLength;
            const r = (1 - ratio) * 0.0 + ratio * 0.1;
            const g = (1 - ratio) * 1.0 + ratio * 0.3;
            const b = (1 - ratio) * 0.7 + ratio * 1.0;
            const currentRadius = SEGMENT_RADIUS * ((1 - ratio) * 1.0 + ratio * 0.6);

            drawCircle(pos.x, pos.y, currentRadius, [r, g, b, 1.0], [r*0.2, g*0.2, b*0.5, 1.0], 2);
        }
    }

    // Отрисовка головы
    drawCircle(snakeX, snakeY, SEGMENT_RADIUS, [0.2, 1.0, 0.6, 1.0], [0.0, 0.5, 0.3, 1.0], 1);
}

function gameLoop(currentTime) {
    update(currentTime);
    render();
    requestAnimationFrame(gameLoop);
}

spawnFood();
requestAnimationFrame(gameLoop);
