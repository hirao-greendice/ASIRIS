export class BackgroundMusic {
  private readonly audio: HTMLAudioElement;
  private isPlaying = false;
  private isStarting = false;
  private isListeningForInteraction = false;

  constructor(source: string, volume: number) {
    this.audio = new Audio(source);
    this.audio.loop = true;
    this.audio.preload = "auto";
    this.audio.volume = Math.min(1, Math.max(0, volume));
  }

  start(): void {
    this.listenForInteraction();
    this.tryPlay();
  }

  destroy(): void {
    this.stopListeningForInteraction();
    this.audio.pause();
  }

  private tryPlay = (): void => {
    if (this.isPlaying || this.isStarting) return;

    this.isStarting = true;
    void this.audio.play()
      .then(() => {
        this.isPlaying = true;
        this.isStarting = false;
        this.stopListeningForInteraction();
      })
      .catch(() => {
        this.isStarting = false;
      });
  };

  private listenForInteraction(): void {
    if (this.isListeningForInteraction) return;

    this.isListeningForInteraction = true;
    window.addEventListener("pointerdown", this.tryPlay, { capture: true });
    window.addEventListener("keydown", this.tryPlay, { capture: true });
  }

  private stopListeningForInteraction(): void {
    if (!this.isListeningForInteraction) return;

    this.isListeningForInteraction = false;
    window.removeEventListener("pointerdown", this.tryPlay, { capture: true });
    window.removeEventListener("keydown", this.tryPlay, { capture: true });
  }
}
