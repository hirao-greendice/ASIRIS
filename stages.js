"use strict";

// fetch()を使わず、index.htmlを直接開いた場合にも読めるステージ定義です。
// tiles: 0=床、1=模様付き床、2=壁
globalThis.STAGES = [
  {
    id: "stage01",
    name: "テストステージ",
    width: 12,
    height: 12,
    tiles: [
      [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2],
      [2, 0, 2, 2, 2, 0, 0, 2, 2, 2, 0, 2],
      [2, 0, 0, 1, 2, 0, 0, 2, 0, 0, 0, 2],
      [2, 2, 2, 0, 2, 0, 0, 0, 1, 2, 0, 2],
      [2, 0, 0, 0, 0, 0, 2, 2, 0, 2, 0, 2],
      [2, 0, 2, 2, 2, 0, 0, 1, 0, 2, 0, 2],
      [2, 0, 0, 0, 2, 0, 2, 2, 0, 0, 0, 2],
      [2, 2, 2, 0, 2, 0, 0, 0, 2, 2, 0, 2],
      [2, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 2],
      [2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 2],
      [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    ],
    objects: [
      { type: "player", x: 1, y: 1, properties: {} },
      { type: "sword", x: 2, y: 1, properties: {} },
      { type: "slime", x: 6, y: 3, properties: {} },
      { type: "apple", x: 3, y: 5, properties: {} },
      { type: "key", x: 7, y: 9, properties: {} },
      { type: "doorClosed", x: 10, y: 5, properties: {} },
      { type: "goal", x: 10, y: 10, properties: {} },
    ],
  },
];
