import { useEffect, useRef } from 'react';

interface StarParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
  color: string;
  isCrossStar: boolean;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

const STAR_COLORS = [
  '255, 255, 255',
  '191, 219, 254', // sky-blue
  '147, 197, 253', // cobalt-light
  '153, 246, 228', // teal-light
  '224, 231, 255', // indigo-tint
];

export function FlyingStarsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let animationFrameId = 0;
    let lastTime = performance.now();
    let nextShootTimer = 0.25;

    const stars: StarParticle[] = [];
    const shootingStars: ShootingStar[] = [];

    const createStar = (w: number, h: number, randomPos = true): StarParticle => {
      const depth = 0.35 + Math.random() * 0.95;
      return {
        x: randomPos ? Math.random() * w : w + Math.random() * 40,
        y: randomPos ? Math.random() * h : Math.random() * h,
        vx: -(18 + depth * 36),
        vy: -(8 + depth * 18),
        radius: 1.0 + depth * 1.9,
        alpha: 0.45 + depth * 0.45,
        twinkleSpeed: 1.4 + Math.random() * 2.4,
        twinklePhase: Math.random() * Math.PI * 2,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        isCrossStar: Math.random() < 0.28,
      };
    };

    const spawnShootingStar = (w: number, h: number, immediateStart = false) => {
      const speed = 380 + Math.random() * 240;
      const angle = (145 + Math.random() * 14) * (Math.PI / 180); // diagonal down-left
      const startX = immediateStart
        ? w * (0.45 + Math.random() * 0.45)
        : w * (0.35 + Math.random() * 0.72);
      const startY = immediateStart
        ? h * (0.08 + Math.random() * 0.45)
        : -20 + Math.random() * (h * 0.62);

      shootingStars.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        length: 85 + Math.random() * 85,
        life: 0,
        maxLife: 0.9 + Math.random() * 0.55,
        color: STAR_COLORS[Math.floor(Math.random() * 4)],
        width: 1.6 + Math.random() * 1.1,
      });
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (stars.length === 0) {
        const count = 78;
        for (let i = 0; i < count; i++) {
          stars.push(createStar(width, height, true));
        }
        // Spawn 2 initial shooting stars immediately so motion is unmistakable on view
        spawnShootingStar(width, height, true);
        spawnShootingStar(width, height, true);
      }
    };

    const drawCrossStar = (
      x: number,
      y: number,
      r: number,
      rgb: string,
      opacity: number
    ) => {
      const arm = r * 2.8;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = `rgba(${rgb}, ${opacity})`;
      ctx.beginPath();
      ctx.moveTo(0, -arm);
      ctx.quadraticCurveTo(0, 0, arm, 0);
      ctx.quadraticCurveTo(0, 0, 0, arm);
      ctx.quadraticCurveTo(0, 0, -arm, 0);
      ctx.quadraticCurveTo(0, 0, 0, -arm);
      ctx.closePath();
      ctx.fill();

      // Soft glow center
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, opacity + 0.15)})`;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const renderFrame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (width > 0 && height > 0) {
        ctx.clearRect(0, 0, width, height);

        // Update & render flying star particles
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          if (!reducedMotion) {
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            s.twinklePhase += s.twinkleSpeed * dt;

            if (s.x < -20) s.x = width + 15;
            if (s.y < -20) s.y = height + 15;
          }

          const twinkle = 0.65 + 0.35 * Math.sin(s.twinklePhase);
          const currentAlpha = Math.max(0.2, Math.min(0.98, s.alpha * twinkle));

          // Halo glow
          const glow = ctx.createRadialGradient(
            s.x,
            s.y,
            0,
            s.x,
            s.y,
            s.radius * 3.4
          );
          glow.addColorStop(0, `rgba(${s.color}, ${currentAlpha * 0.55})`);
          glow.addColorStop(1, `rgba(${s.color}, 0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius * 3.4, 0, Math.PI * 2);
          ctx.fill();

          if (s.isCrossStar) {
            drawCrossStar(s.x, s.y, s.radius, s.color, currentAlpha);
          } else {
            ctx.fillStyle = `rgba(${s.color}, ${currentAlpha})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Spawn & render shooting stars
        if (!reducedMotion) {
          nextShootTimer -= dt;
          if (nextShootTimer <= 0) {
            spawnShootingStar(width, height, false);
            nextShootTimer = 0.9 + Math.random() * 1.1;
          }

          for (let i = shootingStars.length - 1; i >= 0; i--) {
            const st = shootingStars[i];
            st.life += dt;
            if (st.life >= st.maxLife) {
              shootingStars.splice(i, 1);
              continue;
            }

            st.x += st.vx * dt;
            st.y += st.vy * dt;

            const progress = st.life / st.maxLife;
            const fade =
              progress < 0.15
                ? progress / 0.15
                : progress > 0.7
                  ? (1 - progress) / 0.3
                  : 1;

            const mag = Math.hypot(st.vx, st.vy) || 1;
            const tailX = st.x - (st.vx / mag) * st.length;
            const tailY = st.y - (st.vy / mag) * st.length;

            const grad = ctx.createLinearGradient(st.x, st.y, tailX, tailY);
            grad.addColorStop(0, `rgba(255, 255, 255, ${0.95 * fade})`);
            grad.addColorStop(0.28, `rgba(${st.color}, ${0.75 * fade})`);
            grad.addColorStop(1, `rgba(${st.color}, 0)`);

            ctx.strokeStyle = grad;
            ctx.lineWidth = st.width;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(st.x, st.y);
            ctx.lineTo(tailX, tailY);
            ctx.stroke();

            // Bright star head flare
            const headGlow = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, 8);
            headGlow.addColorStop(0, `rgba(255, 255, 255, ${0.95 * fade})`);
            headGlow.addColorStop(0.45, `rgba(${st.color}, ${0.45 * fade})`);
            headGlow.addColorStop(1, `rgba(${st.color}, 0)`);
            ctx.fillStyle = headGlow;
            ctx.beginPath();
            ctx.arc(st.x, st.y, 8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      if (!reducedMotion) {
        animationFrameId = window.requestAnimationFrame(renderFrame);
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }

    if (reducedMotion) {
      renderFrame(performance.now());
    } else {
      animationFrameId = window.requestAnimationFrame(renderFrame);
    }

    return () => {
      observer.disconnect();
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
    />
  );
}
