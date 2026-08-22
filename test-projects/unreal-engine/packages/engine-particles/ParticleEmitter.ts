import { Vector3, Color } from '../math/Vector';

export interface Particle {
  position: Vector3;
  velocity: Vector3;
  color: Color;
  size: number;
  lifetime: number;
  maxLifetime: number;
}

export class ParticleEmitter {
  position: Vector3 = new Vector3(0, 0, 0);
  emissionRate: number = 10; // Particles per second
  particleLifetime: number = 2.0; // Seconds
  particleSpeed: number = 1.0;
  particleSize: number = 0.1;
  particleColor: Color = new Color(1, 1, 1, 1);
  
  private particles: Particle[] = [];
  private lastEmissionTime: number = 0;
  
  constructor() {}
  
  update(deltaTime: number, currentTime: number) {
    // Update existing particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.position.add(particle.velocity.clone().multiplyScalar(deltaTime));
      particle.lifetime -= deltaTime;
      
      if (particle.lifetime <= 0) {
        this.particles.splice(i, 1);
      }
    }
    
    // Emit new particles based on emission rate
    const timeSinceLastEmission = currentTime - this.lastEmissionTime;
    const particlesToEmit = Math.floor(timeSinceLastEmission * this.emissionRate);
    
    if (particlesToEmit > 0) {
      for (let i = 0; i < particlesToEmit; i++) {
        this.emitParticle();
      }
      this.lastEmissionTime = currentTime;
    }
  }
  
  private emitParticle() {
    const particle: Particle = {
      position: this.position.clone(),
      velocity: this.getRandomVelocity(),
      color: this.particleColor.clone(),
      size: this.particleSize,
      lifetime: this.particleLifetime,
      maxLifetime: this.particleLifetime
    };
    
    this.particles.push(particle);
  }
  
  private getRandomVelocity(): Vector3 {
    // Generate random velocity in a spherical direction
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const speed = this.particleSpeed * (0.5 + Math.random() * 0.5); // 50% variation
    
    const x = speed * Math.sin(phi) * Math.cos(theta);
    const y = speed * Math.sin(phi) * Math.sin(theta);
    const z = speed * Math.cos(phi);
    
    return new Vector3(x, y, z);
  }
  
  getParticles(): Particle[] {
    return this.particles;
  }
}