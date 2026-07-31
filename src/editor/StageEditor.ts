import type {
  GridPoint,
  GridRect,
  RoomDefinition,
  StageDefinition,
  TileKind,
} from "../game/core/stageTypes";
import {
  createEditableStage,
  loadStageDraft,
  parseStageDraft,
  saveStageDraft,
  serializeStageDraft,
  validateStageDraft,
  type EditableStage,
} from "./stageDraft";

type EditorTool =
  | TileKind
  | "select"
  | "player"
  | "puzzle"
  | "trigger"
  | "view";

const TOOL_HELP: Record<EditorTool, string> = {
  select: "マスを押して、その位置を担当する部屋を選択します。",
  floor: "クリックまたはドラッグしたマスを床にします。",
  wall: "クリックまたはドラッグしたマスへ壁を配置します。",
  grass: "クリックまたはドラッグしたマスを草地にします。",
  player: "床を押して、勇者の開始位置を移動します。",
  puzzle: "選択中の部屋のパズル基準位置を移動します。",
  trigger: "ドラッグ範囲に勇者が入ると、選択中のカメラへ切り替わります。",
  view: "ドラッグ範囲の外側を半マスずつ含む正方形をゲーム画面へ表示します。",
};

const TILE_COLORS: Record<TileKind, string> = {
  floor: "#b79bb9",
  grass: "#7f8d6d",
  wall: "#383635",
};

export class StageEditor {
  private stage: EditableStage;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly scrollArea: HTMLElement;
  private readonly roomSelect: HTMLSelectElement;
  private readonly fileInput: HTMLInputElement;
  private readonly validationOutput: HTMLElement;
  private readonly statusOutput: HTMLElement;
  private readonly coordinateOutput: HTMLElement;
  private readonly toolHelp: HTMLElement;
  private readonly abortController = new AbortController();
  private selectedTool: EditorTool = "wall";
  private selectedRoomId = "";
  private tileSize = 16;
  private pointerIsDown = false;
  private lastPaintTile: GridPoint | null = null;
  private dragStart: GridPoint | null = null;
  private dragCurrent: GridPoint | null = null;
  private saveTimer: number | null = null;
  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];

  constructor(
    private readonly root: HTMLElement,
    sourceStage: StageDefinition,
  ) {
    const loadedDraft = tryLoadDraft();
    this.stage = loadedDraft ?? createEditableStage(sourceStage);
    this.selectedRoomId = this.stage.rooms[0]?.id ?? "";

    this.root.innerHTML = createEditorMarkup();
    this.root.hidden = false;
    this.canvas = this.requireElement("#stage-editor-canvas");
    this.scrollArea = this.requireElement("[data-editor-scroll]");
    this.roomSelect = this.requireElement("[data-room-select]");
    this.fileInput = this.requireElement("[data-file-input]");
    this.validationOutput = this.requireElement("[data-validation]");
    this.statusOutput = this.requireElement("[data-status]");
    this.coordinateOutput = this.requireElement("[data-coordinate]");
    this.toolHelp = this.requireElement("[data-tool-help]");

    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("Stage editor Canvas 2D context is not available.");
    }
    this.context = context;

    this.bindEvents();
    this.refreshAll();
    this.setSelectedTool(this.selectedTool);
    this.setStatus(
      loadedDraft
        ? "保存済みの下書きを読み込みました。"
        : "現在のステージから下書きを作成しました。",
    );

    requestAnimationFrame(() => this.centerOnPoint(this.stage.playerStart));
  }

  destroy(): void {
    this.abortController.abort();
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
  }

  private bindEvents(): void {
    const signal = this.abortController.signal;

    this.root.addEventListener("click", this.handleClick, { signal });
    this.root.addEventListener("change", this.handleChange, { signal });
    this.canvas.addEventListener("pointerdown", this.handlePointerDown, {
      signal,
    });
    this.canvas.addEventListener("pointermove", this.handlePointerMove, {
      signal,
    });
    this.canvas.addEventListener("pointerup", this.handlePointerUp, {
      signal,
    });
    this.canvas.addEventListener("pointercancel", this.handlePointerCancel, {
      signal,
    });
    this.canvas.addEventListener(
      "contextmenu",
      (event) => event.preventDefault(),
      { signal },
    );
    window.addEventListener("keydown", this.handleKeyboardShortcut, {
      signal,
    });
  }

  private handleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const toolButton = target.closest<HTMLButtonElement>("[data-tool]");
    if (toolButton) {
      this.setSelectedTool(toolButton.dataset.tool as EditorTool);
      return;
    }

    const actionButton =
      target.closest<HTMLButtonElement>("[data-action]");
    if (!actionButton) return;

    switch (actionButton.dataset.action) {
      case "save":
        this.saveNow(false);
        break;
      case "validate":
        this.showValidation();
        break;
      case "playtest":
        this.startPlaytest();
        break;
      case "export":
        this.exportJson();
        break;
      case "import":
        this.fileInput.click();
        break;
      case "add-room":
        this.addRoom();
        break;
      case "delete-room":
        this.deleteSelectedRoom();
        break;
      case "undo":
        this.undo();
        break;
      case "redo":
        this.redo();
        break;
    }
  };

  private handleChange = (event: Event): void => {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLSelectElement)
    ) {
      return;
    }

    if (target === this.roomSelect) {
      this.selectedRoomId = target.value;
      this.refreshRoomPanel();
      this.draw();
      return;
    }

    if (target.matches("[data-zoom]")) {
      this.changeZoom(Number(target.value));
      return;
    }

    if (target === this.fileInput) {
      void this.importJson(target.files?.[0]);
      return;
    }

    const field = target.dataset.field;
    if (!field) return;

    this.updateRoomField(field, target.value);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;

    const tile = this.getPointerTile(event);
    if (!tile) return;

    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.pointerIsDown = true;
    this.lastPaintTile = tile;

    if (isPaintTool(this.selectedTool)) {
      this.checkpoint();
      this.paintTile(tile, this.selectedTool);
      this.afterMutation(false);
      return;
    }

    if (this.selectedTool === "player") {
      this.placePlayer(tile);
      return;
    }

    if (this.selectedTool === "puzzle") {
      this.placePuzzle(tile);
      return;
    }

    if (this.selectedTool === "select") {
      this.selectRoomAt(tile);
      return;
    }

    this.dragStart = tile;
    this.dragCurrent = tile;
    this.draw();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const tile = this.getPointerTile(event);
    this.coordinateOutput.textContent = tile
      ? `X ${tile.x} / Y ${tile.y}`
      : "X — / Y —";

    if (!this.pointerIsDown || !tile) return;

    if (isPaintTool(this.selectedTool)) {
      if (this.lastPaintTile) {
        forEachLineTile(this.lastPaintTile, tile, (lineTile) => {
          this.paintTile(lineTile, this.selectedTool as TileKind);
        });
      }
      this.lastPaintTile = tile;
      this.afterMutation(false);
      return;
    }

    if (this.selectedTool === "trigger" || this.selectedTool === "view") {
      this.dragCurrent = tile;
      this.draw();
    }
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.pointerIsDown) return;

    const tile = this.getPointerTile(event) ?? this.dragCurrent;
    if (
      tile &&
      this.dragStart &&
      (this.selectedTool === "trigger" || this.selectedTool === "view")
    ) {
      this.commitCameraDrag(this.dragStart, tile, this.selectedTool);
    }

    this.resetPointerState();
  };

  private handlePointerCancel = (): void => {
    this.resetPointerState();
    this.draw();
  };

  private handleKeyboardShortcut = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (isTextEditingTarget(event.target)) return;

    if (event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    } else if (
      event.key.toLowerCase() === "y" ||
      (event.key.toLowerCase() === "z" && event.shiftKey)
    ) {
      event.preventDefault();
      this.redo();
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      this.saveNow(false);
    }
  };

  private setSelectedTool(tool: EditorTool): void {
    this.selectedTool = tool;
    this.root.querySelectorAll<HTMLElement>("[data-tool]").forEach((button) => {
      button.dataset.selected = String(button.dataset.tool === tool);
    });
    this.toolHelp.textContent = TOOL_HELP[tool];
  }

  private paintTile(point: GridPoint, tile: TileKind): void {
    if (!isPointInside(this.stage, point)) return;
    this.stage.tiles[point.y][point.x] = tile;
  }

  private placePlayer(point: GridPoint): void {
    if (this.stage.tiles[point.y][point.x] === "wall") {
      this.setStatus("勇者は床または草地へ配置してください。", "error");
      return;
    }

    this.checkpoint();
    this.stage.playerStart = { ...point };
    this.afterMutation(true);
  }

  private placePuzzle(point: GridPoint): void {
    const room = this.selectedRoom;
    if (!room) return;
    if (this.stage.tiles[point.y][point.x] === "wall") {
      this.setStatus("パズル位置は床または草地へ配置してください。", "error");
      return;
    }

    this.checkpoint();
    room.puzzleAnchor = { ...point };
    this.afterMutation(true);
  }

  private selectRoomAt(point: GridPoint): void {
    const room = this.stage.rooms.find((candidate) =>
      containsPoint(candidate.trigger, point),
    );
    if (!room) {
      this.setStatus("このマスを担当するカメラ範囲がありません。", "error");
      return;
    }

    this.selectedRoomId = room.id;
    this.refreshRoomPanel();
    this.draw();
    this.setStatus(`${room.name}を選択しました。`);
  }

  private commitCameraDrag(
    start: GridPoint,
    end: GridPoint,
    tool: "trigger" | "view",
  ): void {
    const room = this.selectedRoom;
    if (!room) return;

    this.checkpoint();
    const rect =
      tool === "view"
        ? createPaddedSquareCameraRect(
            start,
            end,
            this.stage.width,
            this.stage.height,
          )
        : createRect(start, end);

    if (tool === "trigger") {
      room.trigger = rect;
      room.bounds = { ...rect };
    } else {
      room.view = rect;
    }
    this.afterMutation(true);
  }

  private updateRoomField(field: string, rawValue: string): void {
    const room = this.selectedRoom;
    if (!room) return;

    if (field === "name") {
      const value = rawValue.trim();
      if (!value) {
        this.refreshRoomPanel();
        return;
      }
      this.checkpoint();
      room.name = value;
      this.afterMutation(true);
      return;
    }

    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue)) {
      this.refreshRoomPanel();
      return;
    }
    const numericValue = isFractionalCameraField(field)
      ? snapToHalfTile(parsedValue)
      : Math.round(parsedValue);

    this.checkpoint();
    switch (field) {
      case "trigger-x":
        room.trigger.x = numericValue;
        normalizeRect(room.trigger, this.stage.width, this.stage.height);
        room.bounds = { ...room.trigger };
        break;
      case "trigger-y":
        room.trigger.y = numericValue;
        normalizeRect(room.trigger, this.stage.width, this.stage.height);
        room.bounds = { ...room.trigger };
        break;
      case "trigger-width":
        room.trigger.width = numericValue;
        normalizeRect(room.trigger, this.stage.width, this.stage.height);
        room.bounds = { ...room.trigger };
        break;
      case "trigger-height":
        room.trigger.height = numericValue;
        normalizeRect(room.trigger, this.stage.width, this.stage.height);
        room.bounds = { ...room.trigger };
        break;
      case "view-x":
        room.view.x = numericValue;
        normalizeRect(room.view, this.stage.width, this.stage.height);
        makeRectSquare(room.view, this.stage.width, this.stage.height);
        break;
      case "view-y":
        room.view.y = numericValue;
        normalizeRect(room.view, this.stage.width, this.stage.height);
        makeRectSquare(room.view, this.stage.width, this.stage.height);
        break;
      case "view-size":
        room.view.width = numericValue;
        room.view.height = numericValue;
        makeRectSquare(room.view, this.stage.width, this.stage.height);
        break;
      case "transition":
        room.transitionMs = clamp(numericValue, 0, 5000);
        break;
      case "puzzle-x":
        room.puzzleAnchor.x = clamp(
          numericValue,
          0,
          this.stage.width - 1,
        );
        break;
      case "puzzle-y":
        room.puzzleAnchor.y = clamp(
          numericValue,
          0,
          this.stage.height - 1,
        );
        break;
      default:
        this.undoStack.pop();
        return;
    }

    this.afterMutation(true);
  }

  private addRoom(): void {
    this.checkpoint();
    const id = createUniqueRoomId(this.stage.rooms);
    const size = Math.min(9, this.stage.width, this.stage.height);
    const x = clamp(
      this.stage.playerStart.x - Math.floor(size / 2),
      0,
      this.stage.width - size,
    );
    const y = clamp(
      this.stage.playerStart.y - Math.floor(size / 2),
      0,
      this.stage.height - size,
    );
    const rect = { x, y, width: size, height: size };
    const room: RoomDefinition = {
      id,
      name: `新しい部屋 ${this.stage.rooms.length + 1}`,
      bounds: { ...rect },
      trigger: { ...rect },
      view: createPaddedCameraView(
        rect,
        this.stage.width,
        this.stage.height,
      ),
      transitionMs: 260,
      puzzleAnchor: { ...this.stage.playerStart },
    };

    this.stage.rooms.push(room);
    this.selectedRoomId = id;
    this.afterMutation(true);
  }

  private deleteSelectedRoom(): void {
    const room = this.selectedRoom;
    if (!room || this.stage.rooms.length <= 1) {
      this.setStatus("最後のカメラ範囲は削除できません。", "error");
      return;
    }
    if (!window.confirm(`「${room.name}」を削除しますか？`)) return;

    this.checkpoint();
    const roomIndex = this.stage.rooms.indexOf(room);
    this.stage.rooms.splice(roomIndex, 1);
    this.selectedRoomId =
      this.stage.rooms[Math.min(roomIndex, this.stage.rooms.length - 1)].id;
    this.afterMutation(true);
  }

  private changeZoom(nextTileSize: number): void {
    if (![8, 12, 16, 24].includes(nextTileSize)) return;

    const centerX =
      (this.scrollArea.scrollLeft + this.scrollArea.clientWidth / 2) /
      this.tileSize;
    const centerY =
      (this.scrollArea.scrollTop + this.scrollArea.clientHeight / 2) /
      this.tileSize;
    this.tileSize = nextTileSize;
    this.resizeCanvas();
    this.scrollArea.scrollLeft =
      centerX * this.tileSize - this.scrollArea.clientWidth / 2;
    this.scrollArea.scrollTop =
      centerY * this.tileSize - this.scrollArea.clientHeight / 2;
  }

  private checkpoint(): void {
    this.undoStack.push(JSON.stringify(this.stage));
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack.length = 0;
    this.updateHistoryButtons();
  }

  private undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;

    this.redoStack.push(JSON.stringify(this.stage));
    this.replaceStage(parseStageDraft(snapshot));
    this.scheduleSave();
    this.setStatus("変更を1つ戻しました。");
  }

  private redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return;

    this.undoStack.push(JSON.stringify(this.stage));
    this.replaceStage(parseStageDraft(snapshot));
    this.scheduleSave();
    this.setStatus("変更を1つ進めました。");
  }

  private afterMutation(refreshPanel: boolean): void {
    if (refreshPanel) this.refreshRoomPanel();
    this.draw();
    this.scheduleSave();
    this.updateHistoryButtons();
    this.setStatus("編集中…");
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.saveNow(true);
    }, 500);
  }

  private saveNow(isAutomatic: boolean): void {
    try {
      saveStageDraft(this.stage);
      this.setStatus(
        isAutomatic
          ? "下書きを自動保存しました。"
          : "下書きを保存しました。",
      );
    } catch {
      this.setStatus(
        "下書きを保存できませんでした。JSONを書き出してください。",
        "error",
      );
    }
  }

  private showValidation(): string[] {
    const errors = validateStageDraft(this.stage);
    this.validationOutput.replaceChildren();

    if (errors.length === 0) {
      this.validationOutput.textContent =
        "問題は見つかりませんでした。プレイテストできます。";
      this.validationOutput.dataset.tone = "success";
      this.setStatus("ステージ検証に成功しました。");
      return errors;
    }

    const list = document.createElement("ul");
    errors.slice(0, 6).forEach((error) => {
      const item = document.createElement("li");
      item.textContent = error;
      list.append(item);
    });
    if (errors.length > 6) {
      const item = document.createElement("li");
      item.textContent = `ほか${errors.length - 6}件`;
      list.append(item);
    }
    this.validationOutput.append(list);
    this.validationOutput.dataset.tone = "error";
    this.setStatus("修正が必要な箇所があります。", "error");
    return errors;
  }

  private startPlaytest(): void {
    if (this.showValidation().length > 0) return;

    this.saveNow(false);
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("playtest", "1");
    window.location.assign(url);
  }

  private exportJson(): void {
    const blob = new Blob([serializeStageDraft(this.stage)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${this.stage.id || "mirishira-stage"}.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.setStatus("ステージJSONを書き出しました。");
  }

  private async importJson(file: File | undefined): Promise<void> {
    this.fileInput.value = "";
    if (!file) return;

    try {
      const importedStage = parseStageDraft(await file.text());
      this.checkpoint();
      this.replaceStage(importedStage);
      this.saveNow(false);
      this.showValidation();
    } catch (error) {
      this.setStatus(
        error instanceof Error
          ? error.message
          : "ステージJSONを読み込めませんでした。",
        "error",
      );
    }
  }

  private replaceStage(nextStage: EditableStage): void {
    this.stage = nextStage;
    if (!this.stage.rooms.some((room) => room.id === this.selectedRoomId)) {
      this.selectedRoomId = this.stage.rooms[0]?.id ?? "";
    }
    this.refreshAll();
  }

  private refreshAll(): void {
    this.resizeCanvas();
    this.refreshRoomPanel();
    this.updateHistoryButtons();
    this.draw();
  }

  private refreshRoomPanel(): void {
    this.roomSelect.replaceChildren();
    this.stage.rooms.forEach((room) => {
      const option = document.createElement("option");
      option.value = room.id;
      option.textContent = room.name;
      this.roomSelect.append(option);
    });
    this.roomSelect.value = this.selectedRoomId;

    const room = this.selectedRoom;
    this.root
      .querySelectorAll<HTMLInputElement>("[data-field]")
      .forEach((input) => {
        if (!room) {
          input.disabled = true;
          return;
        }
        input.disabled = false;
        input.value = getRoomFieldValue(room, input.dataset.field ?? "");
      });

    const roomMeta = this.root.querySelector<HTMLElement>("[data-room-meta]");
    if (roomMeta && room) {
      roomMeta.textContent =
        `切替 ${room.trigger.width}×${room.trigger.height} / ` +
        `表示 ${room.view.width}×${room.view.height}`;
    }
  }

  private resizeCanvas(): void {
    this.canvas.width = this.stage.width * this.tileSize;
    this.canvas.height = this.stage.height * this.tileSize;
    this.canvas.style.width = `${this.canvas.width}px`;
    this.canvas.style.height = `${this.canvas.height}px`;
    this.draw();
  }

  private draw(): void {
    const { context, tileSize } = this;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let y = 0; y < this.stage.height; y += 1) {
      for (let x = 0; x < this.stage.width; x += 1) {
        const tile = this.stage.tiles[y][x];
        context.fillStyle =
          tile === "floor" && (x + y) % 2 === 0
            ? "#bba0bd"
            : TILE_COLORS[tile];
        context.fillRect(
          x * tileSize,
          y * tileSize,
          tileSize,
          tileSize,
        );
      }
    }

    context.strokeStyle = "rgba(24, 22, 21, 0.2)";
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= this.stage.width; x += 1) {
      const pixelX = x * tileSize + 0.5;
      context.moveTo(pixelX, 0);
      context.lineTo(pixelX, this.canvas.height);
    }
    for (let y = 0; y <= this.stage.height; y += 1) {
      const pixelY = y * tileSize + 0.5;
      context.moveTo(0, pixelY);
      context.lineTo(this.canvas.width, pixelY);
    }
    context.stroke();

    this.drawCameraOverlays();
    this.drawPuzzleAnchors();
    this.drawPlayerStart();
    this.drawDragPreview();
  }

  private drawCameraOverlays(): void {
    const room = this.selectedRoom;

    this.context.save();
    this.context.lineWidth = 1;
    this.context.strokeStyle = "rgba(235, 231, 221, 0.22)";
    this.stage.rooms.forEach((candidate) => {
      this.strokeRect(candidate.trigger);
    });

    if (room) {
      this.context.fillStyle = "rgba(92, 190, 203, 0.12)";
      this.fillRect(room.trigger);
      this.context.strokeStyle = "#62c2cf";
      this.context.lineWidth = 3;
      this.strokeRect(room.trigger);

      this.context.fillStyle = "rgba(221, 174, 92, 0.08)";
      this.fillRect(room.view);
      this.context.strokeStyle = "#d9ab5b";
      this.context.setLineDash([8, 5]);
      this.strokeRect(room.view);
    }
    this.context.restore();
  }

  private drawPuzzleAnchors(): void {
    const radius = Math.max(3, this.tileSize * 0.3);

    this.stage.rooms.forEach((room) => {
      const x = (room.puzzleAnchor.x + 0.5) * this.tileSize;
      const y = (room.puzzleAnchor.y + 0.5) * this.tileSize;
      this.context.save();
      this.context.translate(x, y);
      this.context.rotate(Math.PI / 4);
      this.context.fillStyle =
        room.id === this.selectedRoomId ? "#f0c66c" : "#e7decd";
      this.context.fillRect(-radius, -radius, radius * 2, radius * 2);
      this.context.restore();
    });
  }

  private drawPlayerStart(): void {
    const x = (this.stage.playerStart.x + 0.5) * this.tileSize;
    const y = (this.stage.playerStart.y + 0.5) * this.tileSize;
    const radius = Math.max(4, this.tileSize * 0.36);

    this.context.beginPath();
    this.context.arc(x, y, radius, 0, Math.PI * 2);
    this.context.fillStyle = "#f7f3eb";
    this.context.fill();
    this.context.strokeStyle = "#171513";
    this.context.lineWidth = 2;
    this.context.stroke();
  }

  private drawDragPreview(): void {
    if (!this.dragStart || !this.dragCurrent) return;
    if (this.selectedTool !== "trigger" && this.selectedTool !== "view") {
      return;
    }

    const rect =
      this.selectedTool === "view"
        ? createPaddedSquareCameraRect(
            this.dragStart,
            this.dragCurrent,
            this.stage.width,
            this.stage.height,
          )
        : createRect(this.dragStart, this.dragCurrent);

    this.context.save();
    this.context.strokeStyle =
      this.selectedTool === "view" ? "#ffd07a" : "#75e2ee";
    this.context.lineWidth = 4;
    this.context.setLineDash([7, 4]);
    this.strokeRect(rect);
    this.context.restore();
  }

  private fillRect(rect: GridRect): void {
    this.context.fillRect(
      rect.x * this.tileSize,
      rect.y * this.tileSize,
      rect.width * this.tileSize,
      rect.height * this.tileSize,
    );
  }

  private strokeRect(rect: GridRect): void {
    this.context.strokeRect(
      rect.x * this.tileSize + 1.5,
      rect.y * this.tileSize + 1.5,
      rect.width * this.tileSize - 3,
      rect.height * this.tileSize - 3,
    );
  }

  private getPointerTile(event: PointerEvent): GridPoint | null {
    const rect = this.canvas.getBoundingClientRect();
    const pixelX =
      (event.clientX - rect.left) * (this.canvas.width / rect.width);
    const pixelY =
      (event.clientY - rect.top) * (this.canvas.height / rect.height);
    const point = {
      x: Math.floor(pixelX / this.tileSize),
      y: Math.floor(pixelY / this.tileSize),
    };
    return isPointInside(this.stage, point) ? point : null;
  }

  private resetPointerState(): void {
    this.pointerIsDown = false;
    this.lastPaintTile = null;
    this.dragStart = null;
    this.dragCurrent = null;
    this.draw();
  }

  private centerOnPoint(point: GridPoint): void {
    this.scrollArea.scrollLeft =
      (point.x + 0.5) * this.tileSize - this.scrollArea.clientWidth / 2;
    this.scrollArea.scrollTop =
      (point.y + 0.5) * this.tileSize - this.scrollArea.clientHeight / 2;
  }

  private updateHistoryButtons(): void {
    const undoButton =
      this.root.querySelector<HTMLButtonElement>('[data-action="undo"]');
    const redoButton =
      this.root.querySelector<HTMLButtonElement>('[data-action="redo"]');
    if (undoButton) undoButton.disabled = this.undoStack.length === 0;
    if (redoButton) redoButton.disabled = this.redoStack.length === 0;
  }

  private setStatus(
    message: string,
    tone: "normal" | "error" = "normal",
  ): void {
    this.statusOutput.textContent = message;
    this.statusOutput.dataset.tone = tone;
  }

  private get selectedRoom(): RoomDefinition | undefined {
    return this.stage.rooms.find((room) => room.id === this.selectedRoomId);
  }

  private requireElement<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Editor element not found: ${selector}`);
    return element;
  }
}

function createEditorMarkup(): string {
  return `
    <main class="editor-shell">
      <header class="editor-header">
        <div>
          <p class="editor-kicker">STAGE EDITOR</p>
          <h1>ミリしらソード</h1>
        </div>
        <div class="editor-header-actions">
          <button type="button" data-action="undo">戻す</button>
          <button type="button" data-action="redo">進める</button>
          <button type="button" data-action="save">下書き保存</button>
          <button type="button" data-action="validate">検証</button>
          <button type="button" class="editor-primary-action" data-action="playtest">プレイテスト</button>
          <a href="./">ゲームへ</a>
        </div>
      </header>

      <div class="editor-workspace">
        <aside class="editor-panel editor-tools">
          <h2>マスと配置</h2>
          <div class="editor-tool-grid">
            <button type="button" data-tool="select">部屋選択</button>
            <button type="button" data-tool="wall">壁</button>
            <button type="button" data-tool="floor">床</button>
            <button type="button" data-tool="grass">草地</button>
            <button type="button" data-tool="player">勇者</button>
            <button type="button" data-tool="puzzle">パズル位置</button>
            <button type="button" data-tool="trigger">切替範囲</button>
            <button type="button" data-tool="view">表示範囲</button>
          </div>
          <p class="editor-help" data-tool-help></p>

          <h2>ファイル</h2>
          <div class="editor-file-actions">
            <button type="button" data-action="export">JSON書き出し</button>
            <button type="button" data-action="import">JSON読み込み</button>
          </div>
          <input type="file" accept=".json,application/json" data-file-input hidden />
          <div class="editor-validation" data-validation>
            検証すると、カメラが割り当てられていない床などを確認できます。
          </div>
        </aside>

        <section class="editor-map-column" aria-label="ステージマップ">
          <div class="editor-map-toolbar">
            <label>
              表示倍率
              <select data-zoom>
                <option value="8">8 px</option>
                <option value="12">12 px</option>
                <option value="16" selected>16 px</option>
                <option value="24">24 px</option>
              </select>
            </label>
            <span data-coordinate>X — / Y —</span>
            <span class="editor-status" data-status></span>
          </div>
          <div class="editor-canvas-scroll" data-editor-scroll>
            <canvas id="stage-editor-canvas" aria-label="編集マップ"></canvas>
          </div>
        </section>

        <aside class="editor-panel editor-camera-panel">
          <div class="editor-panel-heading">
            <h2>部屋とカメラ</h2>
            <div>
              <button type="button" data-action="add-room">追加</button>
              <button type="button" data-action="delete-room">削除</button>
            </div>
          </div>

          <label class="editor-wide-field">
            選択中の部屋
            <select data-room-select></select>
          </label>
          <label class="editor-wide-field">
            表示名
            <input type="text" data-field="name" />
          </label>
          <p class="editor-room-meta" data-room-meta></p>

          <fieldset>
            <legend>勇者がこの範囲にいるとき</legend>
            <div class="editor-field-grid">
              <label>X<input type="number" data-field="trigger-x" /></label>
              <label>Y<input type="number" data-field="trigger-y" /></label>
              <label>幅<input type="number" min="1" data-field="trigger-width" /></label>
              <label>高さ<input type="number" min="1" data-field="trigger-height" /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>ゲーム画面へ表示する範囲</legend>
            <div class="editor-field-grid">
              <label>X<input type="number" step="0.5" data-field="view-x" /></label>
              <label>Y<input type="number" step="0.5" data-field="view-y" /></label>
              <label>一辺<input type="number" min="1" step="0.5" data-field="view-size" /></label>
              <label>切替ms<input type="number" min="0" data-field="transition" /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>パズル基準位置</legend>
            <div class="editor-field-grid">
              <label>X<input type="number" data-field="puzzle-x" /></label>
              <label>Y<input type="number" data-field="puzzle-y" /></label>
            </div>
          </fieldset>

          <p class="editor-camera-legend">
            <span><i class="trigger-color"></i>切替範囲</span>
            <span><i class="view-color"></i>表示範囲</span>
            <span><i class="puzzle-color"></i>パズル位置</span>
          </p>
        </aside>
      </div>
    </main>
  `;
}

function getRoomFieldValue(room: RoomDefinition, field: string): string {
  const values: Record<string, string | number> = {
    name: room.name,
    "trigger-x": room.trigger.x,
    "trigger-y": room.trigger.y,
    "trigger-width": room.trigger.width,
    "trigger-height": room.trigger.height,
    "view-x": room.view.x,
    "view-y": room.view.y,
    "view-size": room.view.width,
    transition: room.transitionMs,
    "puzzle-x": room.puzzleAnchor.x,
    "puzzle-y": room.puzzleAnchor.y,
  };
  return String(values[field] ?? "");
}

function tryLoadDraft(): EditableStage | null {
  try {
    return loadStageDraft();
  } catch {
    return null;
  }
}

function isPaintTool(tool: EditorTool): tool is TileKind {
  return tool === "floor" || tool === "grass" || tool === "wall";
}

function isPointInside(stage: EditableStage, point: GridPoint): boolean {
  return (
    point.x >= 0 &&
    point.x < stage.width &&
    point.y >= 0 &&
    point.y < stage.height
  );
}

function containsPoint(rect: GridRect, point: GridPoint): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

function createRect(start: GridPoint, end: GridPoint): GridRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x) + 1,
    height: Math.abs(end.y - start.y) + 1,
  };
}

function createSquareRect(
  start: GridPoint,
  end: GridPoint,
  stageWidth: number,
  stageHeight: number,
): GridRect {
  const maximumSize = Math.min(stageWidth, stageHeight);
  const size = Math.min(
    Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) + 1,
    maximumSize,
  );
  const rawX = end.x >= start.x ? start.x : start.x - size + 1;
  const rawY = end.y >= start.y ? start.y : start.y - size + 1;
  return {
    x: clamp(rawX, 0, stageWidth - size),
    y: clamp(rawY, 0, stageHeight - size),
    width: size,
    height: size,
  };
}

function createPaddedSquareCameraRect(
  start: GridPoint,
  end: GridPoint,
  stageWidth: number,
  stageHeight: number,
): GridRect {
  return createPaddedCameraView(
    createSquareRect(start, end, stageWidth, stageHeight),
    stageWidth,
    stageHeight,
  );
}

function createPaddedCameraView(
  rect: GridRect,
  stageWidth: number,
  stageHeight: number,
): GridRect {
  const margin = 0.5;
  const size = Math.min(
    Math.max(rect.width, rect.height) + margin * 2,
    stageWidth,
    stageHeight,
  );
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  return {
    x: clamp(centerX - size / 2, 0, stageWidth - size),
    y: clamp(centerY - size / 2, 0, stageHeight - size),
    width: size,
    height: size,
  };
}

function normalizeRect(
  rect: GridRect,
  stageWidth: number,
  stageHeight: number,
): void {
  rect.x = clamp(rect.x, 0, stageWidth - 1);
  rect.y = clamp(rect.y, 0, stageHeight - 1);
  rect.width = clamp(rect.width, 1, stageWidth - rect.x);
  rect.height = clamp(rect.height, 1, stageHeight - rect.y);
}

function makeRectSquare(
  rect: GridRect,
  stageWidth: number,
  stageHeight: number,
): void {
  const size = clamp(
    rect.width,
    1,
    Math.min(stageWidth, stageHeight),
  );
  rect.width = size;
  rect.height = size;
  rect.x = clamp(rect.x, 0, stageWidth - size);
  rect.y = clamp(rect.y, 0, stageHeight - size);
}

function isFractionalCameraField(field: string): boolean {
  return field === "view-x" || field === "view-y" || field === "view-size";
}

function snapToHalfTile(value: number): number {
  return Math.round(value * 2) / 2;
}

function createUniqueRoomId(rooms: readonly RoomDefinition[]): string {
  const existingIds = new Set(rooms.map((room) => room.id));
  let index = 1;
  while (existingIds.has(`room-custom-${String(index).padStart(2, "0")}`)) {
    index += 1;
  }
  return `room-custom-${String(index).padStart(2, "0")}`;
}

function forEachLineTile(
  start: GridPoint,
  end: GridPoint,
  visit: (point: GridPoint) => void,
): void {
  let x = start.x;
  let y = start.y;
  const deltaX = Math.abs(end.x - start.x);
  const deltaY = -Math.abs(end.y - start.y);
  const stepX = start.x < end.x ? 1 : -1;
  const stepY = start.y < end.y ? 1 : -1;
  let error = deltaX + deltaY;

  while (true) {
    visit({ x, y });
    if (x === end.x && y === end.y) break;
    const doubledError = error * 2;
    if (doubledError >= deltaY) {
      error += deltaY;
      x += stepX;
    }
    if (doubledError <= deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
