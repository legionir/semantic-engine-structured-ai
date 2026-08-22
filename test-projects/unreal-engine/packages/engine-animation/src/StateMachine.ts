import { AnimationClip } from "./AnimationClip.js";

// ---------------------------------------------------------------------------
// Condition types
// ---------------------------------------------------------------------------

export type ConditionType = "greater" | "less" | "equal" | "not_equal" | "true" | "false";

export interface Condition {
  parameter: string;
  type: ConditionType;
  value?: number | boolean;
}

export interface Transition {
  /** Target state name. */
  to: string;
  /** Conditions that must ALL be true for this transition to fire. */
  conditions: Condition[];
  /** If true, the transition happens as soon as conditions are met. */
  immediate: boolean;
  /** Crossfade duration in seconds when transitioning. */
  crossfadeDuration: number;
}

export interface StateConfig {
  name: string;
  clipId: string;
  speed?: number;
  loop?: boolean;
  transitions?: Transition[];
}

// ---------------------------------------------------------------------------
// StateMachine
// ---------------------------------------------------------------------------

export class StateMachine {
  private readonly states = new Map<string, StateConfig>();
  private readonly parameters = new Map<string, number | boolean>();
  private currentStateName: string | null = null;
  private previousStateName: string | null = null;

  constructor(
    private readonly getClip: (clipId: string) => AnimationClip | undefined,
    states: StateConfig[] = [],
    initialState?: string,
  ) {
    for (const s of states) {
      this.addState(s);
    }
    if (initialState && this.states.has(initialState)) {
      this.currentStateName = initialState;
    } else if (states.length > 0) {
      this.currentStateName = states[0].name;
    }
  }

  // -----------------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------------

  addState(config: StateConfig): void {
    this.states.set(config.name, config);
  }

  removeState(name: string): void {
    this.states.delete(name);
    if (this.currentStateName === name) this.currentStateName = null;
  }

  getState(name: string): StateConfig | undefined {
    return this.states.get(name);
  }

  getStates(): StateConfig[] {
    return [...this.states.values()];
  }

  /** The name of the current state. */
  get currentState(): string | null {
    return this.currentStateName;
  }

  /** The name of the previous state (before the last transition). */
  get previousState(): string | null {
    return this.previousStateName;
  }

  /** Get the clip id associated with the current state. */
  get currentClipId(): string | null {
    if (!this.currentStateName) return null;
    return this.states.get(this.currentStateName)?.clipId ?? null;
  }

  /** Get the clip for the current state. */
  get currentClip(): AnimationClip | undefined {
    const id = this.currentClipId;
    return id ? this.getClip(id) : undefined;
  }

  // -----------------------------------------------------------------------
  // Parameters
  // -----------------------------------------------------------------------

  setParameter(name: string, value: number | boolean): void {
    this.parameters.set(name, value);
  }

  getParameter(name: string): number | boolean | undefined {
    return this.parameters.get(name);
  }

  getParameters(): Map<string, number | boolean> {
    return new Map(this.parameters);
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  /**
   * Evaluate transitions and return the new state name if a transition occurred.
   * @returns The new state name if a transition fired, or null.
   */
  update(_deltaTime: number): string | null {
    if (!this.currentStateName) return null;

    const state = this.states.get(this.currentStateName);
    if (!state || !state.transitions) return null;

    for (const trans of state.transitions) {
      if (this.evaluateConditions(trans.conditions)) {
        this.previousStateName = this.currentStateName;
        this.currentStateName = trans.to;
        return trans.to;
      }
    }

    return null;
  }

  /**
   * Force a transition to a specific state.
   */
  forceTransition(stateName: string): boolean {
    if (!this.states.has(stateName)) return false;
    this.previousStateName = this.currentStateName;
    this.currentStateName = stateName;
    return true;
  }

  /**
   * Get the crossfade duration for the transition that just fired.
   */
  getTransitionCrossfadeDuration(from: string, to: string): number {
    const state = this.states.get(from);
    if (!state?.transitions) return 0;
    for (const t of state.transitions) {
      if (t.to === to) return t.crossfadeDuration;
    }
    return 0;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private evaluateConditions(conditions: Condition[]): boolean {
    for (const cond of conditions) {
      const paramValue = this.parameters.get(cond.parameter);

      switch (cond.type) {
        case "true":
          if (paramValue !== true) return false;
          break;
        case "false":
          if (paramValue !== false) return false;
          break;
        case "greater": {
          const pv = paramValue as number;
          const cv = cond.value as number;
          if (pv === undefined || pv <= cv) return false;
          break;
        }
        case "less": {
          const pv = paramValue as number;
          const cv = cond.value as number;
          if (pv === undefined || pv >= cv) return false;
          break;
        }
        case "equal": {
          const cv = cond.value;
          if (paramValue !== cv) return false;
          break;
        }
        case "not_equal": {
          const cv = cond.value;
          if (paramValue === cv) return false;
          break;
        }
        default:
          return false;
      }
    }
    return true;
  }
}
