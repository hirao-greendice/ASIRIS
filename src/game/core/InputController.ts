export type GameControl =
  | "up"
  | "down"
  | "left"
  | "right"
  | "primary"
  | "reset";

export type DirectionControl = Extract<
  GameControl,
  "up" | "down" | "left" | "right"
>;

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
  ["KeyR", "reset"],
  ["Enter", "reset"],
]);

export class InputController {
  private readonly keyboard = new Map<string, GameControl>();
  private readonly pointers = new Map<number, GameControl>();
  private readonly pendingPresses: GameControl[] = [];
  private readonly directionPriority: DirectionControl[] = [];
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
      [...this.keyboard.values()].some((pressed) => pressed === control) ||
      [...this.pointers.values()].some((pressed) => pressed === control)
    );
  }

  /**
   * The most recently pressed direction wins. Releasing it reveals the next
   * still-held direction, matching common keyboard movement behavior.
   */
  getPreferredDirection(): DirectionControl | undefined {
    for (
      let index = this.directionPriority.length - 1;
      index >= 0;
      index -= 1
    ) {
      const direction = this.directionPriority[index];
      if (this.isPressed(direction)) return direction;
      this.directionPriority.splice(index, 1);
    }
    return undefined;
  }

  /**
   * Returns one physical key/button press at a time. Directional hold-repeat
   * is timed by the game so releasing never leaves buffered repeat steps.
   */
  consumeNextPress(): GameControl | undefined {
    return this.pendingPresses.shift();
  }

  clearPendingPresses(): void {
    this.pendingPresses.length = 0;
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
    if (event.repeat || this.keyboard.has(event.code)) return;

    this.keyboard.set(event.code, control);
    this.registerPress(control);
    document.body.dataset.input = "keyboard";
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    const control = CONTROLLED_KEYS.get(event.code);
    if (!control) return;

    event.preventDefault();
    this.keyboard.delete(event.code);
    this.removeInactiveDirection(control);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    const button = event.currentTarget as HTMLButtonElement;
    const control = button.dataset.control as GameControl | undefined;
    if (!control) return;

    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, control);
    this.registerPress(control);
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
    } else {
      this.pointers.delete(event.pointerId);
    }

    if (previousControl) this.removeInactiveDirection(previousControl);
    if (nextControl) this.registerPress(nextControl);
    this.syncPointerButtonStates();
  };

  private handlePointerEnd = (event: PointerEvent): void => {
    const previousControl = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (previousControl) this.removeInactiveDirection(previousControl);
    this.syncPointerButtonStates();
  };

  private reset = (): void => {
    this.keyboard.clear();
    this.pointers.clear();
    this.pendingPresses.length = 0;
    this.directionPriority.length = 0;
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

  private registerPress(control: GameControl): void {
    if (isDirectionControl(control)) {
      const pendingDirectionIndex = this.pendingPresses.findIndex(
        isDirectionControl,
      );
      if (pendingDirectionIndex >= 0) {
        this.pendingPresses.splice(pendingDirectionIndex, 1);
      }

      const priorityIndex = this.directionPriority.indexOf(control);
      if (priorityIndex >= 0) {
        this.directionPriority.splice(priorityIndex, 1);
      }
      this.directionPriority.push(control);
    }

    this.pendingPresses.push(control);
  }

  private removeInactiveDirection(control: GameControl): void {
    if (!isDirectionControl(control) || this.isPressed(control)) return;

    const priorityIndex = this.directionPriority.indexOf(control);
    if (priorityIndex >= 0) {
      this.directionPriority.splice(priorityIndex, 1);
    }
  }

  private preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}

function isDirectionControl(
  control: GameControl,
): control is DirectionControl {
  return (
    control === "up" ||
    control === "down" ||
    control === "left" ||
    control === "right"
  );
}
