const COLS = 7;
const ROWS = 8;

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const INITIAL_OBJECTS = [
  {
    id: "tree",
    name: "木",
    x: 1,
    y: 5,
    answer: "かさ",
    letters: ["き"],
    clue: "雨の日、あたまの上で\nひらくものは？",
    shape: "tree-shape",
  },
  {
    id: "stone",
    name: "石",
    x: 5,
    y: 5,
    answer: "かき",
    letters: ["い", "し"],
    clue: "秋にみのる、オレンジ色の\nあまいくだものは？",
    shape: "stone-shape",
  },
  {
    id: "key",
    name: "鍵",
    x: 5,
    y: 2,
    answer: "いし",
    letters: ["ぎ"],
    clue: "川原にもある、かたくて\n小さなものは？",
    shape: "key-shape",
  },
  {
    id: "door",
    name: "扉",
    x: 3,
    y: 0,
    answer: "かぎ",
    letters: [],
    clue: "この扉をひらくために\n必要なものは？",
    shape: "door-shape",
    isGoal: true,
  },
];

// 外周に加え、この3マスだけを障害物にして押し出しの「壁で止まる」を試せるようにする。
const WALLS = new Set(["2,3", "3,3", "4,3"]);

const board = document.querySelector("#board");
const inventoryElement = document.querySelector("#inventory");
const messageElement = document.querySelector("#message");
const puzzleModal = document.querySelector("#puzzle-modal");
const puzzleCard = document.querySelector(".puzzle-card");
const puzzleTitle = document.querySelector("#puzzle-title");
const puzzleClue = document.querySelector("#puzzle-clue");
const puzzleIcon = document.querySelector("#puzzle-icon");
const answerSlots = document.querySelector("#answer-slots");
const puzzleInventory = document.querySelector("#puzzle-inventory");
const puzzleFeedback = document.querySelector("#puzzle-feedback");
const clearScreen = document.querySelector("#clear-screen");
const clearLetters = document.querySelector("#clear-letters");

let state;
let puzzleObjectId = null;
let currentAnswer = [];
let isAnimating = false;

function createInitialState() {
  return {
    player: { x: 3, y: 6, facing: "up" },
    inventory: ["か", "さ"],
    objects: INITIAL_OBJECTS.map((object) => ({ ...object, solved: false, cut: false })),
    drops: [],
    cleared: false,
  };
}

function positionStyle(x, y) {
  return `left: ${(x / COLS) * 100}%; top: ${(y / ROWS) * 100}%;`;
}

function createBoardTiles() {
  board.replaceChildren();
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const tile = document.createElement("div");
      tile.className = `tile${WALLS.has(`${x},${y}`) ? " wall" : ""}`;
      tile.setAttribute("role", "gridcell");
      board.append(tile);
    }
  }
}

function render() {
  board.querySelectorAll(".object, .hero, .letter-drop").forEach((element) => element.remove());

  const target = findAdjacentObject();
  state.objects.filter((object) => !object.cut).forEach((object) => {
    const element = document.createElement("div");
    const isAdjacent = target?.id === object.id;
    element.className = [
      "object",
      object.solved ? "cuttable" : "",
      isAdjacent ? "adjacent" : "",
    ].filter(Boolean).join(" ");
    element.style.cssText = positionStyle(object.x, object.y);
    element.dataset.objectId = object.id;
    element.setAttribute("aria-label", `${object.name}${object.solved ? "、切断可能" : ""}`);
    element.innerHTML = `<div class="object-visual ${object.shape}"></div>`;
    board.append(element);
  });

  state.drops.forEach((drop) => {
    const element = document.createElement("div");
    element.className = "letter-drop";
    element.style.cssText = positionStyle(drop.x, drop.y);
    element.setAttribute("aria-label", `文字ブロック ${drop.letters.join("、")}`);
    drop.letters.forEach((letter) => {
      const chip = document.createElement("span");
      chip.className = "stage-letter";
      chip.textContent = letter;
      element.append(chip);
    });
    board.append(element);
  });

  const hero = document.createElement("div");
  hero.className = `hero facing-${state.player.facing}`;
  hero.style.cssText = positionStyle(state.player.x, state.player.y);
  hero.setAttribute("aria-label", "勇者");
  hero.innerHTML = '<div class="hero-sprite"></div>';
  board.append(hero);

  renderInventory();
  updateContextMessage(target);
}

function renderInventory(newLetters = []) {
  inventoryElement.replaceChildren();
  state.inventory.forEach((letter, index) => {
    const chip = document.createElement("span");
    chip.className = `letter-chip${index >= state.inventory.length - newLetters.length ? " new-letter" : ""}`;
    chip.textContent = letter;
    inventoryElement.append(chip);
  });
}

function updateContextMessage(target = findAdjacentObject()) {
  if (state.cleared) return;
  if (!target) {
    setMessage("十字キーで、オブジェクトのとなりへ");
    return;
  }
  if (target.solved) {
    setMessage(`${target.name}は切れる！ Bでもじにしよう`);
  } else {
    setMessage(`${target.name}のとなり。Bでナゾを調べる`);
  }
}

function setMessage(text) {
  messageElement.textContent = text;
}

function isModalOpen() {
  return puzzleModal.classList.contains("open") || clearScreen.classList.contains("open");
}

function isBlocked(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
  if (WALLS.has(`${x},${y}`)) return true;
  return state.objects.some((object) => !object.cut && object.x === x && object.y === y);
}

function movePlayer(direction) {
  if (isModalOpen() || isAnimating || state.cleared) return;
  const vector = DIRECTIONS[direction];
  state.player.facing = direction;
  const nextX = state.player.x + vector.x;
  const nextY = state.player.y + vector.y;

  if (isBlocked(nextX, nextY)) {
    render();
    bumpHero();
    return;
  }

  state.player.x = nextX;
  state.player.y = nextY;
  render();
}

function bumpHero() {
  const hero = board.querySelector(".hero");
  if (!hero) return;
  hero.classList.add("bump");
  window.setTimeout(() => hero.classList.remove("bump"), 180);
}

function getAdjacentObjects() {
  return state.objects.filter((object) => {
    if (object.cut) return false;
    const distance = Math.abs(object.x - state.player.x) + Math.abs(object.y - state.player.y);
    return distance === 1;
  });
}

function findAdjacentObject() {
  const adjacent = getAdjacentObjects();
  if (adjacent.length <= 1) return adjacent[0] ?? null;

  const facing = DIRECTIONS[state.player.facing];
  return adjacent.find((object) => (
    object.x === state.player.x + facing.x && object.y === state.player.y + facing.y
  )) ?? adjacent[0];
}

function pressB() {
  flashButton(document.querySelector("#button-b"));

  if (clearScreen.classList.contains("open")) return;
  if (puzzleModal.classList.contains("open")) {
    submitAnswer();
    return;
  }
  if (isAnimating || state.cleared) return;

  const target = findAdjacentObject();
  if (!target) {
    setMessage("ここには調べられるものがない");
    bumpHero();
    return;
  }

  if (target.solved && !target.isGoal) {
    cutObject(target);
    return;
  }

  openPuzzle(target);
}

function openPuzzle(object) {
  puzzleObjectId = object.id;
  currentAnswer = [];
  puzzleCard.classList.remove("wrong");
  puzzleTitle.textContent = `${object.name}のナゾ`;
  puzzleClue.innerHTML = object.clue.replace("\n", "<br>");
  puzzleIcon.className = `puzzle-icon object-visual ${object.shape}`;
  puzzleFeedback.textContent = "";
  renderPuzzleInput(object);
  puzzleModal.classList.add("open");
  puzzleModal.setAttribute("aria-hidden", "false");
}

function closePuzzle() {
  puzzleModal.classList.remove("open");
  puzzleModal.setAttribute("aria-hidden", "true");
  puzzleObjectId = null;
  currentAnswer = [];
}

function renderPuzzleInput(object) {
  answerSlots.replaceChildren();
  for (let index = 0; index < object.answer.length; index += 1) {
    const slot = document.createElement("span");
    const letter = currentAnswer[index] ?? "";
    slot.className = `answer-slot${letter ? " filled" : ""}`;
    slot.textContent = letter;
    answerSlots.append(slot);
  }

  puzzleInventory.replaceChildren();
  state.inventory.forEach((letter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "puzzle-letter";
    button.textContent = letter;
    button.setAttribute("aria-label", `${letter}を回答に追加`);
    button.addEventListener("click", () => addAnswerLetter(letter));
    puzzleInventory.append(button);
  });
}

function addAnswerLetter(letter) {
  const object = state.objects.find((item) => item.id === puzzleObjectId);
  if (!object || currentAnswer.length >= object.answer.length) return;
  currentAnswer.push(letter);
  puzzleFeedback.textContent = "";
  renderPuzzleInput(object);
}

function deleteAnswerLetter() {
  const object = state.objects.find((item) => item.id === puzzleObjectId);
  if (!object || currentAnswer.length === 0) return;
  currentAnswer.pop();
  puzzleFeedback.textContent = "";
  renderPuzzleInput(object);
}

function submitAnswer() {
  const object = state.objects.find((item) => item.id === puzzleObjectId);
  if (!object) return;

  if (currentAnswer.join("") !== object.answer) {
    puzzleFeedback.textContent = currentAnswer.length < object.answer.length
      ? "まだ文字が足りないみたい"
      : "ちがうことばみたい…";
    puzzleCard.classList.remove("wrong");
    void puzzleCard.offsetWidth;
    puzzleCard.classList.add("wrong");
    return;
  }

  if (object.isGoal) {
    closePuzzle();
    state.cleared = true;
    window.setTimeout(showClear, 250);
    return;
  }

  object.solved = true;
  closePuzzle();
  render();
  setMessage(`正解！ ${object.name}が切れるようになった`);
}

async function cutObject(object) {
  isAnimating = true;
  addSlashEffect(object.x, object.y);
  setMessage(`${object.name}を切った！`);
  await delay(260);

  object.cut = true;
  state.drops.push({ x: object.x, y: object.y, letters: [...object.letters] });
  const newLetters = object.letters.filter((letter) => !state.inventory.includes(letter));
  state.inventory.push(...newLetters);
  render();
  renderInventory(newLetters);

  await pushPlayerFrom(object.x, object.y, object.letters.length);
  isAnimating = false;
  render();
  setMessage(`${object.letters.join("・")} を手に入れた！`);
}

function addSlashEffect(x, y) {
  const slash = document.createElement("div");
  slash.className = "slash-effect";
  slash.style.cssText = positionStyle(x, y);
  board.append(slash);
  window.setTimeout(() => slash.remove(), 380);
}

async function pushPlayerFrom(sourceX, sourceY, amount) {
  let dx = state.player.x - sourceX;
  let dy = state.player.y - sourceY;

  // 通常は隣接位置から切る。将来同じマスに出た場合は向いている逆側へ押す。
  if (dx === 0 && dy === 0) {
    const facing = DIRECTIONS[state.player.facing];
    dx = -facing.x;
    dy = -facing.y;
  } else {
    dx = Math.sign(dx);
    dy = Math.sign(dy);
  }

  for (let count = 0; count < amount; count += 1) {
    const nextX = state.player.x + dx;
    const nextY = state.player.y + dy;
    if (isBlocked(nextX, nextY)) {
      bumpHero();
      setMessage("文字に押された！ 壁でストップ");
      await delay(220);
      break;
    }
    state.player.x = nextX;
    state.player.y = nextY;
    render();
    setMessage(`文字に押された！ ${count + 1}マス`);
    await delay(240);
  }
}

function showClear() {
  clearLetters.replaceChildren();
  state.inventory.forEach((letter, index) => {
    const chip = document.createElement("span");
    chip.className = "letter-chip new-letter";
    chip.style.animationDelay = `${index * 60}ms`;
    chip.textContent = letter;
    clearLetters.append(chip);
  });
  clearScreen.classList.add("open");
  clearScreen.setAttribute("aria-hidden", "false");
}

function restartGame() {
  state = createInitialState();
  puzzleObjectId = null;
  currentAnswer = [];
  isAnimating = false;
  clearScreen.classList.remove("open");
  clearScreen.setAttribute("aria-hidden", "true");
  createBoardTiles();
  render();
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function flashButton(button) {
  if (!button) return;
  button.classList.add("is-pressed");
  window.setTimeout(() => button.classList.remove("is-pressed"), 120);
}

document.querySelectorAll("[data-direction]").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    flashButton(button);
    movePlayer(button.dataset.direction);
  });
});

document.querySelector("#button-b").addEventListener("click", pressB);
document.querySelector("#button-a").addEventListener("click", () => {
  flashButton(document.querySelector("#button-a"));
  if (!isModalOpen()) setMessage("Aボタンは まだ使わない");
});
document.querySelector("#close-puzzle").addEventListener("click", closePuzzle);
document.querySelector("#delete-letter").addEventListener("click", deleteAnswerLetter);
document.querySelector("#submit-answer").addEventListener("click", submitAnswer);
document.querySelector("#restart-button").addEventListener("click", restartGame);

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  const keyMap = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };
  if (keyMap[event.key]) {
    event.preventDefault();
    const direction = keyMap[event.key];
    flashButton(document.querySelector(`[data-direction="${direction}"]`));
    movePlayer(direction);
    return;
  }
  if (event.key.toLowerCase() === "b" || event.key === "Enter") {
    event.preventDefault();
    pressB();
  }
  if (event.key === "Backspace" && puzzleModal.classList.contains("open")) {
    event.preventDefault();
    deleteAnswerLetter();
  }
  if (event.key === "Escape" && puzzleModal.classList.contains("open")) {
    closePuzzle();
  }
});

restartGame();
