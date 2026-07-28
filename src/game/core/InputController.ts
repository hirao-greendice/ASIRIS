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
  private readonly pendingPresses: GameControl[] = [];
  private readonly buttons: HTMLButtonElement[];

  constructor(buttons: Iterable<HTMLButtonElement>) {
    this.buttons = [...buttons];
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.reset);

    this.buttons.forEach((button) => {
      button.addEventListener("pointerdown", this.handlePointerDown);
      button.addEventListener("pointermove", this.handlePointerMove);
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

  /**
   * Returns one physical key/button press at a time. Directional hold-repeat
   * is timed by the game so releasing never leaves buffered repeat steps.
   */
  consumeNextPress(): GameControl | undefined {
    return this.pendingPresses.shift();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.reset);

    this.buttons.forEach((button) => {
      button.removeEventListener("pointerdown", this.handlePointerDown);
      button.removeEventListener("pointermove", this.handlePointerMove);
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
    if (event.repeat) return;

    this.keyboard.add(control);
    this.pendingPresses.push(control);
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
    this.pointers.set(event.pointerId, control);
    this.pendingPresses.push(control);
    this.syncPointerButtonStates();
    document.body.dataset.input = "touch";
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const sourceButton = event.currentTarget as HTMLButtonElement;
    if (
      !sourceButton.classList.contains("direction") ||
      !sourceButton.hasPointerCapture(event.pointerId)
    ) {
      return;
    }

    event.preventDefault();
    const dPad = sourceButton.closest(".d-pad");
    const elementAtPointer = document.elementFromPoint(
      event.clientX,
      event.clientY,
    );
    const targetButton =
      elementAtPointer?.closest<HTMLButtonElement>(".direction[data-control]") ??
      null;
    const validTarget =
      targetButton?.closest(".d-pad") === dPad ? targetButton : null;
    const nextControl = validTarget?.dataset.control as GameControl | undefined;
    const previousControl = this.pointers.get(event.pointerId);

    if (nextControl === previousControl) return;

    if (nextControl) {
      this.pointers.set(event.pointerId, nextControl);
      this.pendingPresses.push(nextControl);
    } else {
      this.pointers.delete(event.pointerId);
    }

    this.syncPointerButtonStates();
  };

  private handlePointerEnd = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.syncPointerButtonStates();
  };

  private reset = (): void => {
    this.keyboard.clear();
    this.pointers.clear();
    this.pendingPresses.length = 0;
    this.buttons.forEach((button) => button.removeAttribute("data-pressed"));
  };

  private syncPointerButtonStates(): void {
    const activeControls = new Set(this.pointers.values());

    this.buttons.forEach((button) => {
      const control = button.dataset.control as GameControl | undefined;
      if (control && activeControls.has(control)) {
        button.dataset.pressed = "true";
      } else {
        button.removeAttribute("data-pressed");
      }
    });
  }

  private preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}
