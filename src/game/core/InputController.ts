export type GameControl =
  | "up"
  | "down"
  | "left"
  | "right"
  | "primary"
  | "secondary";

const CONTROLLED_KEYS = new Map<string, GameControl>([
  ["ArrowUp", "up"],
  ["KeyW", "up"],
  ["ArrowDown", "down"],
  ["KeyS", "down"],
  ["ArrowLeft", "left"],
  ["KeyA", "left"],
  ["ArrowRight", "right"],
  ["KeyD", "right"],
  ["Space", "primary"],
  ["Enter", "secondary"],
]);

export class InputController {
  private readonly keyboard = new Set<GameControl>();
  private readonly pointers = new Map<number, GameControl>();
  private readonly buttons: HTMLButtonElement[];

  constructor(buttons: Iterable<HTMLButtonElement>) {
    this.buttons = [...buttons];
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.reset);

    this.buttons.forEach((button) => {
      button.addEventListener("pointerdown", this.handlePointerDown);
      button.addEventListener("pointerup", this.handlePointerEnd);
      button.addEventListener("pointercancel", this.handlePointerEnd);
      button.addEventListener("lostpointercapture", this.handlePointerEnd);
      button.addEventListener("contextmenu", this.preventContextMenu);
    });
  }

  isPressed(control: GameControl): boolean {
    return (
      this.keyboard.has(control) ||
      [...this.pointers.values()].some((pressed) => pressed === control)
    );
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.reset);

    this.buttons.forEach((button) => {
      button.removeEventListener("pointerdown", this.handlePointerDown);
      button.removeEventListener("pointerup", this.handlePointerEnd);
      button.removeEventListener("pointercancel", this.handlePointerEnd);
      button.removeEventListener("lostpointercapture", this.handlePointerEnd);
      button.removeEventListener("contextmenu", this.preventContextMenu);
    });
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const control = CONTROLLED_KEYS.get(event.code);
    if (!control) return;

    event.preventDefault();
    this.keyboard.add(control);
    document.body.dataset.input = "keyboard";
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    const control = CONTROLLED_KEYS.get(event.code);
    if (!control) return;

    event.preventDefault();
    this.keyboard.delete(control);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    const button = event.currentTarget as HTMLButtonElement;
    const control = button.dataset.control as GameControl | undefined;
    if (!control) return;

    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    button.dataset.pressed = "true";
    this.pointers.set(event.pointerId, control);
    document.body.dataset.input = "touch";
  };

  private handlePointerEnd = (event: PointerEvent): void => {
    const button = event.currentTarget as HTMLButtonElement;
    button.removeAttribute("data-pressed");
    this.pointers.delete(event.pointerId);
  };

  private reset = (): void => {
    this.keyboard.clear();
    this.pointers.clear();
    this.buttons.forEach((button) => button.removeAttribute("data-pressed"));
  };

  private preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}
