type AudioContextConstructor = typeof AudioContext;

export class SoundEffects {
  private context: AudioContext | null = null;

  slash(): void {
    this.playTone(170, 0.045, 0.055, "sawtooth", 90);
  }

  lockLetter(): void {
    this.playTone(620, 0.11, 0.07, "sine", 180);
  }

  solve(): void {
    this.playSequence([
      [420, 0],
      [560, 0.08],
      [760, 0.17],
    ]);
  }

  door(): void {
    this.playTone(130, 0.18, 0.07, "triangle", -45);
  }

  reset(): void {
    this.playTone(240, 0.06, 0.045, "square", -70);
  }

  destroy(): void {
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }

  private playSequence(notes: readonly (readonly [number, number])[]): void {
    const context = this.getContext();
    if (!context) return;

    for (const [frequency, delay] of notes) {
      this.scheduleTone(context, frequency, delay, 0.11, 0.055, "sine", 80);
    }
  }

  private playTone(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    frequencyChange: number,
  ): void {
    const context = this.getContext();
    if (!context) return;
    this.scheduleTone(
      context,
      frequency,
      0,
      duration,
      volume,
      type,
      frequencyChange,
    );
  }

  private scheduleTone(
    context: AudioContext,
    frequency: number,
    delay: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    frequencyChange: number,
  ): void {
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.linearRampToValueAtTime(
      Math.max(40, frequency + frequencyChange),
      start + duration,
    );
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private getContext(): AudioContext | null {
    const AudioContextClass = (
      window.AudioContext ??
      (
        window as typeof window & {
          webkitAudioContext?: AudioContextConstructor;
        }
      ).webkitAudioContext
    );
    if (!AudioContextClass) return null;

    this.context ??= new AudioContextClass();
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    return this.context;
  }
}
