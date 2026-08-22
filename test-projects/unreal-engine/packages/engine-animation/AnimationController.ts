import { AnimationClip } from './AnimationClip';

export interface AnimationState {
  clip: AnimationClip;
  time: number;
  weight: number;
  speed: number;
}

export interface AnimationTransition {
  from: string;
  to: string;
  duration: number;
}

export class AnimationController {
  private states: Map<string, AnimationState> = new Map();
  private transitions: AnimationTransition[] = [];
  private currentState: string | null = null;
  private previousState: string | null = null;
  private transitionProgress: number = 0;

  constructor() {}

  addState(name: string, clip: AnimationClip, speed: number = 1.0): void {
    this.states.set(name, {
      clip,
      time: 0,
      weight: 0,
      speed
    });
  }

  addTransition(transition: AnimationTransition): void {
    this.transitions.push(transition);
  }

  play(stateName: string): void {
    if (!this.states.has(stateName)) {
      console.warn(`State ${stateName} does not exist`);
      return;
    }

    this.previousState = this.currentState;
    this.currentState = stateName;
    this.transitionProgress = 0;

    // Reset time when starting a new animation
    const state = this.states.get(stateName)!;
    state.time = 0;
  }

  update(deltaTime: number): void {
    if (!this.currentState) return;

    // Update current state time
    const currentState = this.states.get(this.currentState)!;
    currentState.time += deltaTime * currentState.speed;

    // Handle looping
    if (currentState.time > currentState.clip.duration) {
      currentState.time = currentState.time % currentState.clip.duration;
    }

    // Check for transitions
    const possibleTransitions = this.transitions.filter(t => t.from === this.previousState && t.to === this.currentState);
    if (possibleTransitions.length > 0 && this.transitionProgress < 1) {
      this.transitionProgress += deltaTime / possibleTransitions[0].duration;
      if (this.transitionProgress > 1) this.transitionProgress = 1;
    }
  }

  getCurrentState(): AnimationState | null {
    if (!this.currentState) return null;
    return this.states.get(this.currentState) || null;
  }

  getBlendedResult(): any {
    // Simplified blending - in a real system this would blend transforms
    if (!this.currentState) return null;

    const currentState = this.states.get(this.currentState)!;
    const previousState = this.previousState ? this.states.get(this.previousState) : null;

    if (previousState && this.transitionProgress < 1) {
      // Blend between previous and current state
      const blendedWeight = previousState.weight * (1 - this.transitionProgress) + 
                           currentState.weight * this.transitionProgress;
      return {
        clip: currentState.clip,
        time: currentState.time,
        weight: blendedWeight,
        speed: currentState.speed
      };
    }

    return {
      clip: currentState.clip,
      time: currentState.time,
      weight: currentState.weight,
      speed: currentState.speed
    };
  }
}
