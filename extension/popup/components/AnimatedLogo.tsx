import { useEffect, useRef } from 'react';
import irisLogoNoEye from '../assets/iris-logo-no-eye.svg';

/**
 * AnimatedLogo - Iris flower logo with animated cursor-following eye
 * 
 * Features:
 * - Smooth velocity-based physics for natural eye movement
 * - Global cursor tracking (eye follows cursor anywhere on screen)
 * - Dead zone in center for natural resting state
 * - Constrained movement to stay within flower opening
 * - GPU-accelerated transforms for 60fps performance
 */

const CONFIG = {
  CENTER: 48,              // Center of 96x96 container
  EYE_RADIUS: 10,          // Eye pupil radius (20px diameter)
  MAX_DISTANCE_X: 30,      // Max horizontal distance (wide range to eye corners)
  MAX_DISTANCE_Y: 14,      // Max vertical distance (almond shape is narrower)
  SMOOTHING: 0.002,        // Acceleration rate (extremely low = ultra-smooth, calm)
  DAMPING: 0.94,           // Velocity damping (maximum friction = silky smooth stops)
  MIN_DISTANCE: 10,        // Dead zone radius (larger = ignores small movements)
  SCALE_FACTOR: 0.055,     // Cursor distance to eye movement ratio (subtle response)
};

export function AnimatedLogo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const eyeRef = useRef<HTMLDivElement>(null);
  const currentPosRef = useRef({ x: CONFIG.CENTER, y: CONFIG.CENTER });
  const targetPosRef = useRef({ x: CONFIG.CENTER, y: CONFIG.CENTER });
  const velocityRef = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const container = containerRef.current;
    const eye = eyeRef.current;
    if (!container || !eye) return;

    // Animation loop with smooth physics (like real eye movement)
    const animate = () => {
      const current = currentPosRef.current;
      const target = targetPosRef.current;
      const velocity = velocityRef.current;

      // Calculate distance to target
      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Apply velocity-based physics (acceleration + friction)
      if (dist > 0.01) {
        // Gentle acceleration toward target
        velocity.x += dx * CONFIG.SMOOTHING;
        velocity.y += dy * CONFIG.SMOOTHING;

        // Apply strong damping (friction) for smooth, non-overshooting movement
        velocity.x *= CONFIG.DAMPING;
        velocity.y *= CONFIG.DAMPING;

        // Update position
        current.x += velocity.x;
        current.y += velocity.y;
      } else {
        // Gradually reduce velocity to zero when very close to target
        velocity.x *= 0.9;
        velocity.y *= 0.9;
      }

      // Update eye position directly via transform (GPU accelerated)
      eye.style.transform = `translate(${current.x - CONFIG.EYE_RADIUS}px, ${current.y - CONFIG.EYE_RADIUS}px)`;

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    // Start animation loop
    animationFrameRef.current = requestAnimationFrame(animate);

    // Mouse move handler - smooth, continuous tracking
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const centerX = rect.left + CONFIG.CENTER;
      const centerY = rect.top + CONFIG.CENTER;

      // Calculate direction from logo center to cursor
      const deltaX = e.clientX - centerX;
      const deltaY = e.clientY - centerY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // Dead zone: only move if cursor is far enough from logo center
      if (distance > CONFIG.MIN_DISTANCE) {
        // Normalize direction
        const dirX = deltaX / distance;
        const dirY = deltaY / distance;

        // Proportional movement with elliptical constraint (almond-shaped boundary)
        const scaledX = dirX * distance * CONFIG.SCALE_FACTOR;
        const scaledY = dirY * distance * CONFIG.SCALE_FACTOR;
        
        // Apply elliptical boundary constraint (wider horizontally, narrower vertically)
        const constrainedX = Math.max(-CONFIG.MAX_DISTANCE_X, Math.min(CONFIG.MAX_DISTANCE_X, scaledX));
        const constrainedY = Math.max(-CONFIG.MAX_DISTANCE_Y, Math.min(CONFIG.MAX_DISTANCE_Y, scaledY));
        
        targetPosRef.current = {
          x: CONFIG.CENTER + constrainedX,
          y: CONFIG.CENTER + constrainedY,
        };
      } else {
        // Cursor near logo center - eye returns to center
        targetPosRef.current = { x: CONFIG.CENTER, y: CONFIG.CENTER };
      }
    };

    // Attach to document for global cursor tracking
    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div ref={containerRef} className="w-24 h-24 relative">
      {/* Flower background */}
      <img
        src={irisLogoNoEye}
        alt="Iris Logo"
        className="w-full h-full absolute inset-0"
        draggable={false}
      />
      
      {/* Animated eye */}
      <div
        ref={eyeRef}
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 20,
          height: 20,
          backgroundColor: '#FFC413',
          left: 0,
          top: 0,
          willChange: 'transform',
        }}
      />
    </div>
  );
}
