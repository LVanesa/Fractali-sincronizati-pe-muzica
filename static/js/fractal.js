// var globale pt starea vizualizatorului
let visualizerActive = false;
let visualizerCleanup = null;

// init vizualizator
window.initVisualizer = function () {
    if (visualizerActive) {
        return;
    }

    visualizerActive = true;
    const audioEl = document.getElementById('audio');
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const src = audioCtx.createMediaElementSource(audioEl);
    src.connect(analyser);
    analyser.connect(audioCtx.destination);

    if (!window.WebGLRenderingContext) {
        alert("WebGL nu este suportat de browserul tău.");
        return;
    }

    // scene + camera
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 1);
    document.body.appendChild(renderer.domElement);

    // uniforms (+ boom detection)
    const uniforms = {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector3(window.innerWidth, window.innerHeight, 1) },
        bassLevel: { value: 0 },
        trebleLevel: { value: 0 },
        lfo: { value: 0 },
        zoom: { value: 1.0 },
        iBoom: { value: 0 },
        speed: { value: 1.0 }, 
        pulse: { value: 1.0 }, 
        rotation: { value: 0.0 } 
    };

    // shaders 
    const vertexShader = `
        void main() { 
            gl_Position = vec4(position, 1.0); 
        }
    `;

    const fragmentShader = `
        precision highp float;
        uniform float iTime, bassLevel, trebleLevel, lfo, zoom, iBoom, speed, pulse, rotation;
        uniform vec3 iResolution;

        float mandelbulbDE(vec3 pos) {
            vec3 z = pos, c = pos;
            float dr = 1.0, r = 0.0;
            float bassImpact = pow(bassLevel, 0.3) * 4.0;
            float power = 8.0 + bassImpact + iBoom * 5.0 + sin(iTime * 0.2 + lfo) * 2.0 + trebleLevel * 1.5;
            for (int i = 0; i < 12; i++) {
                r = length(z);
                if (r > 4.0) break;
                float th = acos(z.z / r), ph = atan(z.y, z.x);
                float zr = pow(r, power - 1.0);
                dr = pow(r, power - 1.0) * power * dr + 1.0;
                float nt = th * power, np = ph * power;
                z = zr * vec3(sin(nt) * cos(np), sin(nt) * sin(np), cos(nt)) + c;
            }
            return 0.5 * log(r) * r / dr;
        }

        float rayMarch(vec3 ro, vec3 rd) {
            float t = 0.0;
            for (int i = 0; i < 100; i++) {
                vec3 p = ro + rd * t;
                float d = mandelbulbDE(p);
                if (d < 0.001) break;
                t += d;
                if (t > 50.0) break;
            }
            return t;
        }

        void main() {
            vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
            vec3 ro = vec3(0.0, 0.0, 4.0 / zoom);
            vec3 rd = normalize(vec3(uv, -1.5));

            float ang = iTime * 0.15 + trebleLevel * 3.0 + iBoom * 2.0 + rotation;
            mat3 rotY = mat3(
                cos(ang), 0.0, sin(ang),
                0.0, 1.0, 0.0,
                -sin(ang), 0.0, cos(ang)
            );
            ro = rotY * ro;
            rd = rotY * rd;

            float t = rayMarch(ro, rd);
            if (t > 49.9) {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                return;
            }

            vec3 p = ro + rd * t;
            vec3 eps = vec3(0.001, 0, 0);
            vec3 nor = normalize(vec3(
                mandelbulbDE(p + eps.xyy) - mandelbulbDE(p - eps.xyy),
                mandelbulbDE(p + eps.yxy) - mandelbulbDE(p - eps.yxy),
                mandelbulbDE(p + eps.yyx) - mandelbulbDE(p - eps.yyx)
            ));

            vec3 light = normalize(vec3(1.0, 1.0, 1.0));
            float diff = clamp(dot(nor, light), 0.0, 1.0);

            vec3 col = vec3(
                0.5 + 0.5 * sin(iTime + p.x * 2.0 + iBoom * 3.0),
                0.5 + 0.5 * cos(iTime * 1.2 + p.y * 3.0 + bassLevel * 4.0),
                diff
            );
            col *= (diff * 1.3 + 0.2);
            col = pow(col, vec3(0.4545));
            gl_FragColor = vec4(col * pulse, 1.0);
        }
    `;

    // quad + material
    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms
    });

    const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        material
    );

    scene.add(quad);

    // audio smoothing + detectare boom + LFO + ajustari zoom
    const clock = new THREE.Clock();
    let animationId = null;
    let bass = 0, prevBass = 0, treble = 0;
    let smoothingBass = 0.04, smoothingTreble = 0.05;
    let lfoTime = 0, boomSmooth = 0;

    function animate() {
        analyser.getByteFrequencyData(dataArray);
        
        // calcul bas (0-10) si treble (11+)
        let sumBass = 0;
        for(let i = 0; i < 10; i++) sumBass += dataArray[i];
        let instantBass = (sumBass / 10) / 255;
        
        let sumTreble = 0;
        for(let i = 11; i < dataArray.length; i++) sumTreble += dataArray[i];
        let instantTreble = (sumTreble / (dataArray.length - 11)) / 255;

        // smooth pt valori
        bass = bass * (1 - smoothingBass) + instantBass * smoothingBass;
        treble = treble * (1 - smoothingTreble) + instantTreble * smoothingTreble;

        // detectam varfurile de boom
        let diff = bass - prevBass;
        prevBass = bass;
        let boomRaw = diff > 0.02 ? diff * 20.0 : 0.0;
        boomSmooth = boomSmooth * 0.85 + boomRaw * 0.15;

        // actualizam LFO
        lfoTime += clock.getDelta();

        // detectare beat drops pt ajustare rotatie
        if (boomSmooth > 0.5) {
            uniforms.rotation.value += 0.2; // se roteste la beat drop
        }

        // sa fie sensibil la quick bass changes
        let sensitivityFactor = Math.pow(bass, 2.0);
        let pulseFactor = 1.0 + boomSmooth * 0.2 * sensitivityFactor;
        uniforms.pulse.value = pulseFactor;

        // schimbare viteza dupa bass changes
        let speedFactor = 1.0 + Math.pow(bass, 0.5) * 0.5;
        uniforms.speed.value = speedFactor;

        uniforms.bassLevel.value = bass;
        uniforms.trebleLevel.value = treble;
        uniforms.lfo.value = Math.sin(lfoTime * 0.7);
        uniforms.zoom.value = 1.0 + Math.pow(bass, 0.3) * 1.0;
        uniforms.iBoom.value = boomSmooth;
        uniforms.iTime.value = clock.getElapsedTime() * speedFactor;

        // actualizam statistics
        if (window.updateVisualStats) {
            window.updateVisualStats(bass, treble, boomSmooth);
        }

        renderer.render(scene, camera);
        animationId = requestAnimationFrame(animate);
    }

    animate();

    // clean up
    window.stopVisualizer = function () {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        
        visualizerActive = false;
    };

    // resize handler
    const resizeHandler = () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        uniforms.iResolution.value.set(
            window.innerWidth,
            window.innerHeight,
            1
        );
    };

    window.addEventListener('resize', resizeHandler);

    // return cleanup function
    visualizerCleanup = function cleanup() {
        window.stopVisualizer();
        window.removeEventListener('resize', resizeHandler);
        if (renderer && renderer.domElement) {
            document.body.removeChild(renderer.domElement);
        }
        audioCtx.close();
        visualizerActive = false;
    };

    return visualizerCleanup;
};