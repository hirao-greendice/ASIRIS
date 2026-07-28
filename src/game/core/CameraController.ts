import {
  containsTile,
  type CameraArea,
  type GridPoint,
  type GridRect,
  type StageDefinition,
} from "./stageTypes";

export class CameraController {
  private readonly currentView: GridRect;
  private targetView: GridRect;
  private activeArea: CameraArea;

  constructor(
    private readonly stage: StageDefinition,
    playerPosition: GridPoint,
  ) {
    const initialArea = this.findArea(playerPosition);
    this.activeArea = initialArea;
    this.currentView = { ...initialArea.view };
    this.targetView = { ...initialArea.view };
  }

  get view(): Readonly<GridRect> {
    return this.currentView;
  }

  get areaId(): string {
    return this.activeArea.id;
  }

  update(playerPosition: GridPoint, deltaSeconds: number): void {
    const nextArea = this.findArea(playerPosition);
    if (nextArea.id !== this.activeArea.id) {
      this.activeArea = nextArea;
      this.targetView = { ...nextArea.view };
    }

    if (this.activeArea.transitionMs <= 0) {
      Object.assign(this.currentView, this.targetView);
      return;
    }

    const transitionSeconds = this.activeArea.transitionMs / 1000;
    const blend = 1 - Math.exp((-6 * deltaSeconds) / transitionSeconds);

    this.currentView.x = approach(
      this.currentView.x,
      this.targetView.x,
      blend,
    );
    this.currentView.y = approach(
      this.currentView.y,
      this.targetView.y,
      blend,
    );
    this.currentView.width = approach(
      this.currentView.width,
      this.targetView.width,
      blend,
    );
    this.currentView.height = approach(
      this.currentView.height,
      this.targetView.height,
      blend,
    );
  }

  private findArea(playerPosition: GridPoint): CameraArea {
    const area = this.stage.cameraAreas.find((candidate) =>
      containsTile(candidate.trigger, playerPosition),
    );

    if (!area) {
      throw new Error(
        `No camera area covers tile (${playerPosition.x}, ${playerPosition.y})`,
      );
    }

    return area;
  }
}

function approach(current: number, target: number, blend: number): number {
  const next = current + (target - current) * blend;
  return Math.abs(next - target) < 0.0001 ? target : next;
}
