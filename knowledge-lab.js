"use strict";

const STORAGE_KEY = "millishira-knowledge-lab-v2";
const LEGACY_STORAGE_KEY = "millishira-knowledge-lab-v1";
const REGION_KEYS = ["both", "leftOnly", "rightOnly", "neither"];
const REGION_LABELS = {
  both: "A AND B",
  leftOnly: "A AND NOT B",
  rightOnly: "NOT A AND B",
  neither: "NOT A AND NOT B",
};
const MAX_ENUM_ATTRIBUTES = 16;
const MAX_EQUIVALENCE_ATTRIBUTES = 12;

const elements = {
  saveStatus: document.querySelector("#save-status"),
  exportButton: document.querySelector("#export-button"),
  importButton: document.querySelector("#import-button"),
  importInput: document.querySelector("#import-input"),
  restoreSampleButton: document.querySelector("#restore-sample-button"),
  clearAllButton: document.querySelector("#clear-all-button"),
  knowledgeCount: document.querySelector("#knowledge-count"),
  search: document.querySelector("#knowledge-search"),
  showAddAttribute: document.querySelector("#show-add-attribute"),
  attributeForm: document.querySelector("#attribute-form"),
  attributeName: document.querySelector("#attribute-name"),
  attributeList: document.querySelector("#attribute-list"),
  conceptList: document.querySelector("#concept-list"),
  attributeCount: document.querySelector("#attribute-count"),
  conceptCount: document.querySelector("#concept-count"),
  editorMode: document.querySelector("#editor-mode"),
  newConceptButton: document.querySelector("#new-concept-button"),
  conceptForm: document.querySelector("#concept-form"),
  sampleNotice: document.querySelector("#sample-notice"),
  startEmptyButton: document.querySelector("#start-empty-button"),
  inlineAttributeName: document.querySelector("#inline-attribute-name"),
  inlineAddAttribute: document.querySelector("#inline-add-attribute"),
  inlineAttributeList: document.querySelector("#inline-attribute-list"),
  inlineAttributeFeedback: document.querySelector("#inline-attribute-feedback"),
  conceptName: document.querySelector("#concept-name"),
  leftSource: document.querySelector("#left-source"),
  rightSource: document.querySelector("#right-source"),
  vennSvg: document.querySelector("#venn-svg"),
  vennLabelA: document.querySelector("#venn-label-a"),
  vennLabelB: document.querySelector("#venn-label-b"),
  conditionJapanese: document.querySelector("#condition-japanese"),
  conditionExpression: document.querySelector("#condition-expression"),
  validationMessages: document.querySelector("#validation-messages"),
  saveConceptButton: document.querySelector("#save-concept-button"),
  analysisTitle: document.querySelector("#analysis-title"),
  analysisSubtitle: document.querySelector("#analysis-subtitle"),
  analysisType: document.querySelector("#analysis-type"),
  analysisTabs: document.querySelector("#analysis-tabs"),
  analysisContent: document.querySelector("#analysis-content"),
  toast: document.querySelector("#toast"),
};

function sampleData() {
  return {
    version: 1,
    attributes: [
      { id: "attr-red", name: "赤い", type: "attribute" },
      { id: "attr-round", name: "丸い", type: "attribute" },
      { id: "attr-hard", name: "固い", type: "attribute" },
      { id: "attr-wings", name: "羽がある", type: "attribute" },
    ],
    concepts: [
      {
        id: "concept-apple",
        name: "リンゴ",
        type: "concept",
        left: "attr-red",
        right: "attr-round",
        regions: { both: true, leftOnly: false, rightOnly: false, neither: false },
      },
      {
        id: "concept-turtle",
        name: "カメ",
        type: "concept",
        left: "concept-apple",
        right: "attr-hard",
        regions: { both: true, leftOnly: false, rightOnly: false, neither: false },
      },
      {
        id: "concept-chick",
        name: "ひよこ",
        type: "concept",
        left: "concept-apple",
        right: "attr-wings",
        regions: { both: false, leftOnly: false, rightOnly: true, neither: false },
      },
    ],
  };
}

function emptyData() {
  return { version: 1, attributes: [], concepts: [] };
}

function isOriginalSampleData(data) {
  const expectedIds = new Set([
    "attr-red", "attr-round", "attr-hard", "attr-wings",
    "concept-apple", "concept-turtle", "concept-chick",
  ]);
  const nodes = allNodes(data);
  return nodes.length === expectedIds.size && nodes.every((node) => expectedIds.has(node.id));
}

const state = {
  data: loadInitialData(),
  selectedId: null,
  editingId: null,
  activeTab: "summary",
  regions: { both: true, leftOnly: false, rightOnly: false, neither: false },
  formTouched: false,
  showAllPatterns: false,
  testValues: {},
  toastTimer: 0,
};

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizedName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ja");
}

function allNodes(data = state.data) {
  return [...data.attributes, ...data.concepts];
}

function nodeById(id, data = state.data) {
  return allNodes(data).find((node) => node.id === id) ?? null;
}

function conceptById(id, data = state.data) {
  return data.concepts.find((concept) => concept.id === id) ?? null;
}

function regionMask(regions) {
  return (regions.both ? 1 : 0)
    | (regions.leftOnly ? 2 : 0)
    | (regions.rightOnly ? 4 : 0)
    | (regions.neither ? 8 : 0);
}

function regionKeyForValues(left, right) {
  if (left && right) return "both";
  if (left) return "leftOnly";
  if (right) return "rightOnly";
  return "neither";
}

function evaluateNode(id, assignment, data = state.data, visiting = new Set()) {
  const node = nodeById(id, data);
  if (!node) throw new Error(`参照先 ${id} が見つかりません。`);
  if (node.type === "attribute") return Boolean(assignment[id]);
  if (visiting.has(id)) throw new Error("循環参照を評価できません。");

  visiting.add(id);
  const left = evaluateNode(node.left, assignment, data, visiting);
  const right = evaluateNode(node.right, assignment, data, visiting);
  visiting.delete(id);
  return Boolean(node.regions[regionKeyForValues(left, right)]);
}

function collectBaseIds(id, data = state.data, result = new Set(), visiting = new Set()) {
  const node = nodeById(id, data);
  if (!node) return result;
  if (node.type === "attribute") {
    result.add(node.id);
    return result;
  }
  if (visiting.has(id)) throw new Error("循環参照があります。");
  visiting.add(id);
  collectBaseIds(node.left, data, result, visiting);
  collectBaseIds(node.right, data, result, visiting);
  visiting.delete(id);
  return result;
}

function astVariable(name) {
  return { type: "var", name };
}

function astNot(value) {
  return { type: "not", value };
}

function astBinary(type, left, right) {
  return { type, left, right };
}

function astForMask(mask, left, right) {
  const notLeft = () => astNot(left);
  const notRight = () => astNot(right);
  const and = (a, b) => astBinary("and", a, b);
  const or = (a, b) => astBinary("or", a, b);

  switch (mask) {
    case 0: return { type: "const", value: false };
    case 1: return and(left, right);
    case 2: return and(left, notRight());
    case 3: return left;
    case 4: return and(notLeft(), right);
    case 5: return right;
    case 6: return astBinary("xor", left, right);
    case 7: return or(left, right);
    case 8: return and(notLeft(), notRight());
    case 9: return astNot(astBinary("xor", left, right));
    case 10: return notRight();
    case 11: return or(left, notRight());
    case 12: return notLeft();
    case 13: return or(notLeft(), right);
    case 14: return astNot(and(left, right));
    case 15: return { type: "const", value: true };
    default: return { type: "const", value: false };
  }
}

function buildAst(id, data = state.data, expand = true, visiting = new Set()) {
  const node = nodeById(id, data);
  if (!node) return astVariable("不明な参照");
  if (node.type === "attribute" || !expand) return astVariable(node.name);
  if (visiting.has(id)) return astVariable(`循環:${node.name}`);

  visiting.add(id);
  const left = buildAst(node.left, data, true, visiting);
  const right = buildAst(node.right, data, true, visiting);
  visiting.delete(id);
  return astForMask(regionMask(node.regions), left, right);
}

function astPrecedence(ast) {
  return { or: 1, xor: 2, and: 3, not: 4, var: 5, const: 5 }[ast.type] ?? 0;
}

function formatAst(ast, parentPrecedence = 0) {
  const precedence = astPrecedence(ast);
  let text;
  if (ast.type === "var") text = ast.name;
  else if (ast.type === "const") text = ast.value ? "常に成立" : "成立しない";
  else if (ast.type === "not") {
    const child = formatAst(ast.value);
    text = astPrecedence(ast.value) < precedence ? `NOT(${child})` : `NOT ${child}`;
  } else {
    const operator = { and: "AND", or: "OR", xor: "XOR" }[ast.type];
    text = `${formatAst(ast.left, precedence)} ${operator} ${formatAst(ast.right, precedence)}`;
  }
  return precedence < parentPrecedence ? `(${text})` : text;
}

function formatAstJapanese(ast) {
  if (ast.type === "var") return `「${ast.name}」に当てはまる`;
  if (ast.type === "const") return ast.value ? "必ず成立する" : "成立しない";
  if (ast.type === "not") {
    if (ast.value.type === "var") return `「${ast.value.name}」に当てはまらない`;
    return `（${formatAstJapanese(ast.value)}）ではない`;
  }
  const left = formatAstJapanese(ast.left);
  const right = formatAstJapanese(ast.right);
  if (ast.type === "and") return `${left}、かつ、${right}`;
  if (ast.type === "or") return `${left}、または、${right}`;
  if (ast.type === "xor") return `${left}か${right}の、どちらか一方だけ`;
  return "条件を確認できません";
}

function logicStructureHtml(ast) {
  if (ast.type === "var") {
    return `<div class="logic-block logic-block--attribute"><span>基本属性</span><strong>${escapeHtml(ast.name)}</strong></div>`;
  }
  if (ast.type === "const") {
    return `<div class="logic-block logic-block--constant"><span>結果</span><strong>${ast.value ? "必ず成立" : "成立しない"}</strong></div>`;
  }

  const copy = {
    not: ["NOT", "下の条件に当てはまらない"],
    and: ["AND", "下の条件を両方とも満たす"],
    or: ["OR", "下の条件を1つ以上満たす"],
    xor: ["どちらか一方", "下の片方だけを満たす"],
  }[ast.type];
  const children = ast.type === "not" ? [ast.value] : [ast.left, ast.right];
  return `
    <div class="logic-block logic-block--operator" data-operator="${ast.type}">
      <div class="logic-block__operator"><b>${copy[0]}</b><span>${copy[1]}</span></div>
      <div class="logic-block__children">
        ${children.map((child) => logicStructureHtml(child)).join("")}
      </div>
    </div>`;
}

function directExpression(concept, data = state.data) {
  const left = nodeById(concept.left, data)?.name ?? "A未選択";
  const right = nodeById(concept.right, data)?.name ?? "B未選択";
  return formatAst(astForMask(regionMask(concept.regions), astVariable(left), astVariable(right)));
}

function japaneseForMask(mask, left, right) {
  const table = {
    0: "どの条件でも成立しない",
    1: `${left}であり、${right}でもあるもの`,
    2: `${left}であり、${right}ではないもの`,
    3: `${left}であるもの`,
    4: `${left}ではなく、${right}であるもの`,
    5: `${right}であるもの`,
    6: `${left}と${right}の、どちらか一方だけに当てはまるもの`,
    7: `${left}または${right}の、少なくとも一方に当てはまるもの`,
    8: `${left}でも${right}でもないもの`,
    9: `${left}と${right}の、両方またはどちらでもないもの`,
    10: `${right}ではないもの`,
    11: `${left}である、または${right}ではないもの`,
    12: `${left}ではないもの`,
    13: `${left}ではない、または${right}であるもの`,
    14: `${left}と${right}の両方に当てはまるもの以外`,
    15: "どんなものにも常に成立する",
  };
  return table[mask] ?? "条件を確認できません";
}

function findCycle(data) {
  const visited = new Set();
  const active = new Set();
  const path = [];

  function visit(id) {
    const node = nodeById(id, data);
    if (!node || node.type === "attribute") return null;
    if (active.has(id)) {
      const start = path.indexOf(id);
      return [...path.slice(start), id];
    }
    if (visited.has(id)) return null;
    visited.add(id);
    active.add(id);
    path.push(id);
    for (const reference of [node.left, node.right]) {
      const cycle = visit(reference);
      if (cycle) return cycle;
    }
    path.pop();
    active.delete(id);
    return null;
  }

  for (const concept of data.concepts) {
    const cycle = visit(concept.id);
    if (cycle) return cycle;
  }
  return null;
}

function assignmentFromMask(ids, mask) {
  const assignment = {};
  ids.forEach((id, index) => {
    assignment[id] = Boolean(mask & (1 << index));
  });
  return assignment;
}

function semanticEquivalent(firstId, secondId, data = state.data) {
  const baseIds = [...new Set([
    ...collectBaseIds(firstId, data),
    ...collectBaseIds(secondId, data),
  ])];
  if (baseIds.length > MAX_EQUIVALENCE_ATTRIBUTES) return null;
  const count = 2 ** baseIds.length;
  for (let mask = 0; mask < count; mask += 1) {
    const assignment = assignmentFromMask(baseIds, mask);
    if (evaluateNode(firstId, assignment, data) !== evaluateNode(secondId, assignment, data)) return false;
  }
  return true;
}

function analyzePatterns(id, data = state.data) {
  const relevantIds = [...collectBaseIds(id, data)];
  if (relevantIds.length > MAX_ENUM_ATTRIBUTES) {
    return { tooManyAttributes: true, relevantIds, essentialIds: [], patterns: [], total: null };
  }

  const outputCount = 2 ** relevantIds.length;
  const outputs = Array.from({ length: outputCount }, (_, mask) => (
    evaluateNode(id, assignmentFromMask(relevantIds, mask), data)
  ));

  const essentialIds = relevantIds.filter((attributeId, index) => {
    const bit = 1 << index;
    for (let mask = 0; mask < outputCount; mask += 1) {
      if ((mask & bit) === 0 && outputs[mask] !== outputs[mask | bit]) return true;
    }
    return false;
  });

  const patterns = [];
  const essentialCount = 2 ** essentialIds.length;
  for (let mask = 0; mask < essentialCount; mask += 1) {
    const assignment = assignmentFromMask(essentialIds, mask);
    if (evaluateNode(id, assignment, data)) patterns.push(assignment);
  }

  return {
    tooManyAttributes: false,
    relevantIds,
    essentialIds,
    patterns,
    total: patterns.length,
  };
}

function patternGroups(pattern, ids) {
  return ids.reduce((groups, id) => {
    const group = pattern[id] == null ? "any" : pattern[id] ? "positive" : "negative";
    groups[group].push(nodeById(id)?.name ?? id);
    return groups;
  }, { positive: [], negative: [], any: [] });
}

function patternOverviewHtml(analysis) {
  if (analysis.tooManyAttributes) {
    return `<div class="plain-logic-note">関係する基本属性が${analysis.relevantIds.length}件あるため、具体例の全展開は停止しています。分解図で条件を確認してください。</div>`;
  }
  if (analysis.total === 0) return '<div class="validation-message">! 成立する組み合わせがありません。</div>';
  const ids = analysis.essentialIds;
  const alwaysPositive = ids.filter((id) => analysis.patterns.every((pattern) => pattern[id] === true));
  const alwaysNegative = ids.filter((id) => analysis.patterns.every((pattern) => pattern[id] === false));
  const previewPatterns = analysis.patterns.slice(0, 4);
  return `
    <div class="plain-pattern-overview">
      <div class="shared-conditions">
        <strong>どのケースでも共通する条件</strong>
        <div class="shared-condition-rows">
          <div><span>必ず当てはまる</span><p>${alwaysPositive.length ? alwaysPositive.map((id) => `<b>${escapeHtml(nodeById(id)?.name ?? id)}</b>`).join("") : "なし"}</p></div>
          <div><span>必ず当てはまらない</span><p>${alwaysNegative.length ? alwaysNegative.map((id) => `<b>${escapeHtml(nodeById(id)?.name ?? id)}</b>`).join("") : "なし"}</p></div>
        </div>
      </div>
      <div class="scenario-heading">
        <strong>成立する具体的なケース</strong>
        <span>全部で${analysis.total}通り。各ケースは重なりません。</span>
      </div>
      <div class="exact-pattern-list exact-pattern-list--preview">
        ${previewPatterns.map((pattern, index) => exactPatternHtml(pattern, ids, index)).join("")}
      </div>
      ${analysis.total > previewPatterns.length ? `<p class="scenario-more">残り${analysis.total - previewPatterns.length}通りは「成立パターン」で確認できます。</p>` : ""}
    </div>`;
}

function normalizeImportedData(raw) {
  if (!raw || typeof raw !== "object") throw new Error("JSONの形式が正しくありません。");
  const attributes = Array.isArray(raw.attributes) ? raw.attributes.map((entry) => ({
    id: String(entry.id || makeId("attr")),
    name: String(entry.name || "").trim(),
    type: "attribute",
  })) : [];
  const concepts = Array.isArray(raw.concepts) ? raw.concepts.map((entry) => ({
    id: String(entry.id || makeId("concept")),
    name: String(entry.name || "").trim(),
    type: "concept",
    left: String(entry.left || ""),
    right: String(entry.right || ""),
    regions: Object.fromEntries(REGION_KEYS.map((key) => [key, Boolean(entry.regions?.[key])])),
  })) : [];

  if (attributes.some((entry) => !entry.name) || concepts.some((entry) => !entry.name)) {
    throw new Error("名前が空の知識があります。");
  }
  const nodes = [...attributes, ...concepts];
  const ids = new Set();
  const names = new Set();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error(`ID「${node.id}」が重複しています。`);
    if (names.has(normalizedName(node.name))) throw new Error(`名前「${node.name}」が重複しています。`);
    ids.add(node.id);
    names.add(normalizedName(node.name));
  }

  const idByName = new Map(nodes.map((node) => [normalizedName(node.name), node.id]));
  for (const concept of concepts) {
    if (!ids.has(concept.left)) concept.left = idByName.get(normalizedName(concept.left)) ?? concept.left;
    if (!ids.has(concept.right)) concept.right = idByName.get(normalizedName(concept.right)) ?? concept.right;
    if (!ids.has(concept.left) || !ids.has(concept.right)) {
      throw new Error(`「${concept.name}」の参照先が見つかりません。`);
    }
    if (regionMask(concept.regions) === 0) throw new Error(`「${concept.name}」の選択領域が空です。`);
  }

  const data = { version: 1, attributes, concepts };
  const cycle = findCycle(data);
  if (cycle) throw new Error("循環参照があります。読み込みを中止しました。");
  return data;
}

function loadInitialData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeImportedData(JSON.parse(saved));

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const legacyData = normalizeImportedData(JSON.parse(legacy));
      return isOriginalSampleData(legacyData) ? emptyData() : legacyData;
    }
    return emptyData();
  } catch (error) {
    console.warn("保存データを読み込めなかったため、空の状態で開始します。", error);
    return emptyData();
  }
}

function persistData() {
  elements.saveStatus.classList.add("is-saving");
  elements.saveStatus.lastChild.textContent = "保存中…";
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch (error) {
    console.warn("localStorageへ保存できませんでした。", error);
  }
  window.setTimeout(() => {
    elements.saveStatus.classList.remove("is-saving");
    elements.saveStatus.lastChild.textContent = "自動保存";
  }, 280);
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

function renderKnowledgeLists() {
  const query = normalizedName(elements.search.value);
  const filteredAttributes = state.data.attributes.filter((node) => normalizedName(node.name).includes(query));
  const filteredConcepts = state.data.concepts.filter((node) => normalizedName(node.name).includes(query));

  elements.knowledgeCount.textContent = String(allNodes().length);
  elements.attributeCount.textContent = String(state.data.attributes.length);
  elements.conceptCount.textContent = String(state.data.concepts.length);
  elements.attributeList.innerHTML = filteredAttributes.length
    ? filteredAttributes.map(knowledgeItemHtml).join("")
    : '<div class="list-empty">基本属性がありません</div>';
  elements.conceptList.innerHTML = filteredConcepts.length
    ? filteredConcepts.map(knowledgeItemHtml).join("")
    : '<div class="list-empty">作成した概念がありません</div>';
  elements.inlineAttributeList.innerHTML = state.data.attributes.length
    ? state.data.attributes.map((node) => `<span>${escapeHtml(node.name)}</span>`).join("")
    : '<em>基本属性はまだありません</em>';
  elements.sampleNotice.hidden = !["attr-red", "attr-round", "concept-apple"]
    .every((id) => Boolean(nodeById(id)));
}

function knowledgeItemHtml(node) {
  const selected = node.id === state.selectedId ? " is-selected" : "";
  const icon = node.type === "attribute" ? "Aa" : "◇";
  const meta = node.type === "attribute" ? "BASIC ATTRIBUTE" : directExpression(node);
  const editTitle = node.type === "concept" ? "編集" : "名前変更";
  return `
    <article class="knowledge-item${selected}" data-id="${escapeHtml(node.id)}" data-type="${node.type}">
      <span class="knowledge-item__icon" aria-hidden="true">${icon}</span>
      <button class="knowledge-item__main" type="button" data-action="select" title="${escapeHtml(node.name)}">
        <span class="knowledge-item__name">${escapeHtml(node.name)}</span>
        <span class="knowledge-item__meta">${escapeHtml(meta)}</span>
      </button>
      <span class="knowledge-item__actions">
        <button class="mini-button" type="button" data-action="edit" title="${editTitle}" aria-label="${escapeHtml(node.name)}を${editTitle}">✎</button>
        <button class="mini-button mini-button--delete" type="button" data-action="delete" title="削除" aria-label="${escapeHtml(node.name)}を削除">×</button>
      </span>
    </article>`;
}

function populateSourceSelects(preferredLeft, preferredRight) {
  // 編集中の知識自身は、その知識を作る材料にはできません。
  // 候補から外して、自己参照を選ぶ事故を入力時点で防ぎます。
  const nodes = allNodes().filter((node) => node.id !== state.editingId);
  const options = [
    '<option value="">選択してください</option>',
    '<optgroup label="基本属性">',
    ...state.data.attributes.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.name)}</option>`),
    "</optgroup>",
    '<optgroup label="作成した概念">',
    ...state.data.concepts
      .filter((node) => node.id !== state.editingId)
      .map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.name)}</option>`),
    "</optgroup>",
  ].join("");

  elements.leftSource.innerHTML = options;
  elements.rightSource.innerHTML = options;
  elements.leftSource.value = nodes.some((node) => node.id === preferredLeft) ? preferredLeft : "";
  elements.rightSource.value = nodes.some((node) => node.id === preferredRight) ? preferredRight : "";
}

function resetEditor() {
  const nodes = allNodes();
  state.editingId = null;
  state.formTouched = false;
  state.regions = { both: true, leftOnly: false, rightOnly: false, neither: false };
  elements.conceptName.value = "";
  populateSourceSelects(nodes[0]?.id ?? "", nodes[1]?.id ?? nodes[0]?.id ?? "");
  elements.editorMode.textContent = "新規作成";
  elements.saveConceptButton.textContent = "この内容で覚えさせる";
  updateEditorPreview();
}

function editConcept(id) {
  const concept = conceptById(id);
  if (!concept) return;
  state.editingId = id;
  state.formTouched = false;
  state.regions = { ...concept.regions };
  elements.conceptName.value = concept.name;
  populateSourceSelects(concept.left, concept.right);
  elements.editorMode.textContent = "編集中";
  elements.saveConceptButton.textContent = "変更を保存";
  updateEditorPreview();
  elements.conceptName.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function makeDraftData() {
  const id = state.editingId || "__draft-concept__";
  const draft = {
    id,
    name: elements.conceptName.value.trim() || "新しい言葉",
    type: "concept",
    left: elements.leftSource.value,
    right: elements.rightSource.value,
    regions: { ...state.regions },
  };
  const data = {
    version: 1,
    attributes: state.data.attributes.map((node) => ({ ...node })),
    concepts: state.data.concepts
      .filter((node) => node.id !== id)
      .map((node) => ({ ...node, regions: { ...node.regions } })),
  };
  data.concepts.push(draft);
  return { data, draft };
}

function validateDraft() {
  const messages = [];
  const name = elements.conceptName.value.trim();
  const left = elements.leftSource.value;
  const right = elements.rightSource.value;
  const mask = regionMask(state.regions);
  const draftId = state.editingId || "__draft-concept__";

  if (!name) messages.push({ type: "error", text: "新しい言葉の名前を入力してください。" });
  const duplicateName = allNodes().find((node) => node.id !== state.editingId && normalizedName(node.name) === normalizedName(name));
  if (name && duplicateName) messages.push({
    type: "error",
    text: `「${duplicateName.name}」はすでに登録されています。左の一覧から編集するか、「空にして最初から作る」を使用してください。`,
  });
  if (!left || !right) messages.push({ type: "error", text: "AとBを両方選択してください。" });
  if (mask === 0) messages.push({ type: "error", text: "ベン図の領域を1つ以上選択してください。" });
  if (left === draftId || right === draftId) messages.push({ type: "error", text: "自分自身を材料にはできません。" });

  if (left && right && mask !== 0) {
    const { data, draft } = makeDraftData();
    const cycle = findCycle(data);
    if (cycle) {
      const names = cycle.map((id) => nodeById(id, data)?.name ?? id).join(" → ");
      messages.push({ type: "error", text: `循環参照が発生します：${names}` });
    } else {
      try {
        const patternAnalysis = analyzePatterns(draft.id, data);
        if (!patternAnalysis.tooManyAttributes && patternAnalysis.total === 0) {
          messages.push({ type: "error", text: "この条件はどんな属性の組み合わせでも成立しません。" });
        }

        for (const other of allNodes(data)) {
          if (other.id === draft.id) continue;
          const equivalent = semanticEquivalent(draft.id, other.id, data);
          if (equivalent === true) {
            messages.push({ type: "warning", text: `この条件は「${other.name}」と同じ意味です。` });
            break;
          }
        }
      } catch (error) {
        messages.push({ type: "error", text: error.message });
      }
    }
  }
  return messages;
}

function renderValidation(force = false) {
  const messages = validateDraft();
  const visible = force || state.formTouched ? messages : messages.filter((message) => message.type === "warning");
  elements.validationMessages.innerHTML = visible.map((message) => `
    <div class="validation-message${message.type === "warning" ? " validation-message--warning" : ""}">
      <span aria-hidden="true">${message.type === "warning" ? "△" : "!"}</span>
      <span>${escapeHtml(message.text)}</span>
    </div>`).join("");
  return messages;
}

function updateEditorPreview() {
  const leftName = nodeById(elements.leftSource.value)?.name ?? "A";
  const rightName = nodeById(elements.rightSource.value)?.name ?? "B";
  const mask = regionMask(state.regions);

  document.querySelectorAll("[data-region]").forEach((region) => {
    const selected = Boolean(state.regions[region.dataset.region]);
    region.classList.toggle("is-selected", selected);
    region.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-region-button]").forEach((button) => {
    const selected = Boolean(state.regions[button.dataset.regionButton]);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  elements.vennLabelA.textContent = `A · ${leftName}`;
  elements.vennLabelB.textContent = `B · ${rightName}`;
  elements.conditionJapanese.textContent = mask === 0
    ? "領域を1つ以上選択してください"
    : japaneseForMask(mask, leftName, rightName);
  elements.conditionExpression.textContent = mask === 0
    ? "—"
    : formatAst(astForMask(mask, astVariable(leftName), astVariable(rightName)));
  renderValidation(false);
}

function toggleRegion(key) {
  if (!REGION_KEYS.includes(key)) return;
  state.formTouched = true;
  state.regions[key] = !state.regions[key];
  updateEditorPreview();
}

function selectKnowledge(id) {
  if (!nodeById(id)) return;
  state.selectedId = id;
  state.showAllPatterns = false;
  renderKnowledgeLists();
  renderAnalysis();
}

function addAttribute(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    showToast("基本属性名を入力してください。");
    return false;
  }
  if (allNodes().some((node) => normalizedName(node.name) === normalizedName(trimmed))) {
    showToast(`「${trimmed}」はすでに登録されています。`);
    return false;
  }
  const attribute = { id: makeId("attr"), name: trimmed, type: "attribute" };
  state.data.attributes.push(attribute);
  state.testValues[attribute.id] = null;
  state.selectedId = attribute.id;
  persistData();
  renderAll({ preserveEditor: true });
  showToast(`基本属性「${trimmed}」を追加しました。`);
  return true;
}

function setInlineFeedback(message, isError = false) {
  elements.inlineAttributeFeedback.textContent = message;
  elements.inlineAttributeFeedback.classList.toggle("is-error", isError);
}

function setAttributeAsSource(attributeId) {
  if (!elements.leftSource.value) {
    elements.leftSource.value = attributeId;
    updateEditorPreview();
    return "A";
  }
  if (!elements.rightSource.value || elements.leftSource.value === elements.rightSource.value) {
    elements.rightSource.value = attributeId;
    updateEditorPreview();
    return "B";
  }
  return null;
}

function addInlineAttribute() {
  const name = elements.inlineAttributeName.value.trim();
  if (!name) {
    setInlineFeedback("基本属性名を入力してください。", true);
    elements.inlineAttributeName.focus();
    return;
  }

  const duplicate = allNodes().find((node) => normalizedName(node.name) === normalizedName(name));
  if (duplicate) {
    if (duplicate.type === "attribute") {
      const slot = setAttributeAsSource(duplicate.id);
      setInlineFeedback(`「${duplicate.name}」は登録済みです。${slot ? `${slot}にセットしました。` : "下のA/Bから選択できます。"}`);
    } else {
      setInlineFeedback(`「${duplicate.name}」は作成済みの概念です。基本属性としては追加できません。`, true);
    }
    elements.inlineAttributeName.select();
    return;
  }

  if (!addAttribute(name)) return;
  const attribute = state.data.attributes.find((node) => normalizedName(node.name) === normalizedName(name));
  const slot = attribute ? setAttributeAsSource(attribute.id) : null;
  setInlineFeedback(`「${name}」を追加しました。${slot ? `${slot}に自動セットしました。` : "A/Bから選択できます。"}`);
  elements.inlineAttributeName.value = "";
  elements.inlineAttributeName.focus();
}

function startEmptyWorkspace() {
  state.data = emptyData();
  state.selectedId = null;
  state.testValues = {};
  resetEditor();
  persistData();
  renderAll({ preserveEditor: true });
  setInlineFeedback("空の状態にしました。まず「赤い」などの基本属性を追加してください。");
  elements.inlineAttributeName.focus();
  showToast("空のワークスペースを開始しました。サンプルは上部から復元できます。");
}

function renameKnowledge(id) {
  const node = nodeById(id);
  if (!node) return;
  const value = window.prompt("新しい名前を入力してください。", node.name);
  if (value === null) return;
  const name = value.trim();
  if (!name) return showToast("名前は空にできません。");
  if (allNodes().some((other) => other.id !== id && normalizedName(other.name) === normalizedName(name))) {
    return showToast(`「${name}」はすでに登録されています。`);
  }
  node.name = name;
  persistData();
  if (state.editingId === id) elements.conceptName.value = name;
  renderAll({ preserveEditor: true });
  showToast("名前を変更しました。");
}

function collectDependentIds(id) {
  const result = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const concept of state.data.concepts) {
      if (!result.has(concept.id) && (
        concept.left === id || concept.right === id
        || result.has(concept.left) || result.has(concept.right)
      )) {
        result.add(concept.id);
        changed = true;
      }
    }
  }
  return result;
}

function deleteKnowledge(id) {
  const node = nodeById(id);
  if (!node) return;
  const dependents = collectDependentIds(id);
  const dependentNames = [...dependents].map((entryId) => nodeById(entryId)?.name).filter(Boolean);
  const detail = dependentNames.length
    ? `\n\nこの知識を使う概念も削除されます：\n${dependentNames.join("、")}`
    : "";
  if (!window.confirm(`「${node.name}」を削除しますか？${detail}`)) return;

  const deleteIds = new Set([id, ...dependents]);
  state.data.attributes = state.data.attributes.filter((entry) => !deleteIds.has(entry.id));
  state.data.concepts = state.data.concepts.filter((entry) => !deleteIds.has(entry.id));
  if (deleteIds.has(state.selectedId)) state.selectedId = allNodes()[0]?.id ?? null;
  if (deleteIds.has(state.editingId)) resetEditor();
  deleteIds.forEach((entryId) => delete state.testValues[entryId]);
  persistData();
  renderAll({ preserveEditor: true });
  showToast(`${deleteIds.size}件の知識を削除しました。`);
}

function saveConcept(event) {
  event.preventDefault();
  state.formTouched = true;
  const messages = renderValidation(true);
  if (messages.some((message) => message.type === "error")) return;

  const concept = {
    id: state.editingId || makeId("concept"),
    name: elements.conceptName.value.trim(),
    type: "concept",
    left: elements.leftSource.value,
    right: elements.rightSource.value,
    regions: { ...state.regions },
  };
  const existingIndex = state.data.concepts.findIndex((entry) => entry.id === concept.id);
  if (existingIndex >= 0) state.data.concepts[existingIndex] = concept;
  else state.data.concepts.push(concept);

  state.selectedId = concept.id;
  state.activeTab = "summary";
  persistData();

  // 保存した知識を、続けて次の知識のA/Bとして使えるようにします。
  // 再編集したい場合は左の一覧にある鉛筆ボタンから入り直します。
  resetEditor();
  renderAll({ preserveEditor: true });
  elements.conceptName.focus();
  showToast(`「${concept.name}」を保存しました。続けて次の知識を作れます。`);
}

function selectedRegionLabels(regions) {
  return REGION_KEYS.filter((key) => regions[key]).map((key) => REGION_LABELS[key]);
}

function findEquivalentNodes(id) {
  const equivalents = [];
  for (const node of allNodes()) {
    if (node.id === id) continue;
    try {
      if (semanticEquivalent(id, node.id) === true) equivalents.push(node);
    } catch {
      // Invalid imported references are already rejected on import.
    }
  }
  return equivalents;
}

function renderAnalysis() {
  const node = nodeById(state.selectedId);
  elements.analysisTabs.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.tab === state.activeTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (!node) {
    elements.analysisTitle.textContent = "知識解析";
    elements.analysisSubtitle.textContent = "知識を選択してください";
    elements.analysisType.hidden = true;
    elements.analysisContent.innerHTML = `
      <div class="empty-state">
        <span aria-hidden="true">◇</span>
        <h3>解析する知識を選択</h3>
        <p>左の一覧から単語を選ぶと、定義や成立パターンを確認できます。</p>
      </div>`;
    return;
  }

  elements.analysisTitle.textContent = node.name;
  elements.analysisSubtitle.textContent = node.type === "attribute"
    ? "これ以上分解されない基本属性"
    : directExpression(node);
  elements.analysisType.hidden = false;
  elements.analysisType.dataset.type = node.type;
  elements.analysisType.textContent = node.type === "attribute" ? "基本属性" : "作成した概念";

  const renderers = {
    summary: renderSummaryTab,
    patterns: renderPatternsTab,
    tree: renderTreeTab,
    venn: renderVennTab,
    test: renderTestTab,
    map: renderMapTab,
  };
  elements.analysisContent.innerHTML = renderers[state.activeTab]?.(node) ?? renderSummaryTab(node);
  if (state.activeTab === "map") drawKnowledgeMap();
}

function renderSummaryTab(node) {
  if (node.type === "attribute") {
    const usedBy = state.data.concepts.filter((concept) => concept.left === node.id || concept.right === node.id);
    return `
      <section class="inspector-section">
        <h3>現在の定義</h3>
        <div class="formula-card formula-card--expanded"><code>${escapeHtml(node.name)}</code></div>
      </section>
      <section class="inspector-section">
        <h3>分類</h3>
        <div class="definition-card">基本属性はこれ以上展開されません。条件テストでは独立した真偽値として扱われます。</div>
      </section>
      <section class="inspector-section">
        <h3>この属性を使用する知識</h3>
        ${usedBy.length ? `<div class="region-chip-list">${usedBy.map((item) => `<button class="region-chip" data-select-id="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>`).join("")}</div>` : '<div class="definition-card">まだ他の知識から使用されていません。</div>'}
      </section>`;
  }

  const left = nodeById(node.left);
  const right = nodeById(node.right);
  const directAst = astForMask(
    regionMask(node.regions),
    astVariable(left?.name ?? "参照なし"),
    astVariable(right?.name ?? "参照なし"),
  );
  const expandedAst = buildAst(node.id);
  const expanded = formatAst(expandedAst);
  const equivalents = findEquivalentNodes(node.id);
  let patternAnalysis = null;
  try {
    patternAnalysis = analyzePatterns(node.id);
  } catch {
    // 壊れた読み込みデータは他の検証表示に任せます。
  }
  return `
    <section class="inspector-section inspector-section--overview">
      <h3>意味を日本語で</h3>
      <div class="plain-meaning-card">
        <span>${escapeHtml(node.name)}とは</span>
        <p>${escapeHtml(formatAstJapanese(directAst))}もの</p>
      </div>
      <div class="complexity-strip">
        <div><strong>${knowledgeDepth(node.id)}</strong><span>組み立て段階</span></div>
        <div><strong>${patternAnalysis?.relevantIds.length ?? "—"}</strong><span>関係する基本属性</span></div>
        <div><strong>${patternAnalysis?.tooManyAttributes ? `${MAX_ENUM_ATTRIBUTES}+` : patternAnalysis?.total ?? "—"}</strong><span>成立パターン</span></div>
      </div>
    </section>
    <section class="inspector-section">
      <h3>基本属性まで開いた判定の流れ</h3>
      <p class="section-help">上から下へ読みます。ANDは両方、ORはどちらか、NOTは当てはまらないという意味です。</p>
      <div class="logic-structure">${logicStructureHtml(expandedAst)}</div>
      <details class="formula-details">
        <summary>論理式でも確認する</summary>
        <div class="formula-card formula-card--expanded"><code>${escapeHtml(node.name)} = ${escapeHtml(expanded)}</code></div>
      </details>
    </section>
    <section class="inspector-section">
      <h3>具体例で確認</h3>
      ${patternAnalysis ? patternOverviewHtml(patternAnalysis) : ""}
      ${patternAnalysis && !patternAnalysis.tooManyAttributes ? `<button class="pattern-detail-button" type="button" data-tab-target="patterns">${patternAnalysis.total}通りの組み合わせを詳しく見る →</button>` : ""}
    </section>
    <section class="inspector-section">
      <h3>この知識の作り方</h3>
      <div class="definition-card">
        <dl class="definition-grid">
          <dt>A</dt><dd>${escapeHtml(left?.name ?? "参照なし")}</dd>
          <dt>B</dt><dd>${escapeHtml(right?.name ?? "参照なし")}</dd>
        </dl>
        <div class="region-chip-list">
          ${selectedRegionLabels(node.regions).map((label) => `<span class="region-chip">${escapeHtml(label)}</span>`).join("")}
        </div>
      </div>
    </section>
    ${equivalents.length ? `
      <section class="inspector-section">
        <h3>意味の重複</h3>
        <div class="validation-message validation-message--warning">△ この条件は「${escapeHtml(equivalents.map((item) => item.name).join("、"))}」と同じ意味です。</div>
      </section>` : ""}`;
}

function symbolForState(value) {
  if (value === true) return '<span class="state-symbol state-symbol--true" title="必須">○</span>';
  if (value === false) return '<span class="state-symbol state-symbol--false" title="否定">×</span>';
  return '<span class="state-symbol state-symbol--any" title="どちらでもよい">－</span>';
}

function exactPatternHtml(pattern, ids, index) {
  const groups = patternGroups(pattern, ids);
  return `
    <article class="exact-pattern-card">
      <span class="exact-pattern-card__number">${index + 1}</span>
      <div>
        <strong>ケース ${index + 1}</strong>
        ${ids.length ? `
          <dl class="scenario-conditions">
            <dt>当てはまる</dt><dd>${groups.positive.length ? groups.positive.map((name) => `<span>${escapeHtml(name)}</span>`).join("") : "なし"}</dd>
            <dt>当てはまらない</dt><dd>${groups.negative.length ? groups.negative.map((name) => `<span>${escapeHtml(name)}</span>`).join("") : "なし"}</dd>
          </dl>` : '<span class="logic-always">基本属性に関係なく成立します</span>'}
      </div>
    </article>`;
}

function renderPatternsTab(node) {
  let analysis;
  try {
    analysis = analyzePatterns(node.id);
  } catch (error) {
    return `<div class="validation-message">! ${escapeHtml(error.message)}</div>`;
  }

  if (analysis.tooManyAttributes) {
    return `<div class="validation-message validation-message--warning">△ 関係する基本属性が${analysis.relevantIds.length}件あります。安全のため、${MAX_ENUM_ATTRIBUTES}件を超える全パターン計算は停止しました。</div>`;
  }

  const attributes = analysis.essentialIds.map((id) => nodeById(id)).filter(Boolean);
  const visiblePatterns = state.showAllPatterns ? analysis.patterns : analysis.patterns.slice(0, 20);
  const rows = visiblePatterns.map((pattern, index) => `
    <tr>
      <td>${index + 1}</td>
      ${attributes.map((attribute) => `<td>${symbolForState(analysis.essentialIds.includes(attribute.id) ? pattern[attribute.id] : null)}</td>`).join("")}
    </tr>`).join("");

  return `
    <div class="pattern-intro">
      <span class="pattern-total"><strong>${analysis.total}</strong>通り</span>
      <div><strong>この知識が成立する、重なりのない全ケース</strong><p>それぞれの基本属性が「当てはまる／当てはまらない」をそのまま表示します。</p></div>
    </div>
    <div class="pattern-section-heading">
      <div><strong>具体的なケース</strong><span>どれか1ケースと一致すると、この知識が成立します。</span></div>
      ${analysis.total > 20 ? `<button class="secondary-button" type="button" data-action="toggle-patterns">${state.showAllPatterns ? "20件に戻す" : "すべて表示"}</button>` : ""}
    </div>
    ${analysis.total === 0 ? '<div class="validation-message">! 成立するパターンがありません。</div>' : `
      <div class="exact-pattern-list">
        ${visiblePatterns.map((pattern, index) => exactPatternHtml(pattern, analysis.essentialIds, index)).join("")}
      </div>
      <details class="pattern-matrix">
        <summary>表形式でも確認する</summary>
        <div class="pattern-table-wrap">
          <table class="pattern-table">
            <thead><tr><th>#</th>${attributes.map((attribute) => `<th>${escapeHtml(attribute.name)}</th>`).join("")}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>`}`;
}

function operandPolarity(concept, side) {
  const selected = REGION_KEYS.filter((key) => concept.regions[key]);
  if (!selected.length) return null;
  const values = {
    both: { left: true, right: true },
    leftOnly: { left: true, right: false },
    rightOnly: { left: false, right: true },
    neither: { left: false, right: false },
  };
  const sideValues = new Set(selected.map((key) => values[key][side]));
  return sideValues.size === 1 ? [...sideValues][0] : null;
}

function treeNodeHtml(id, prefix = "", negative = false, path = new Set()) {
  const node = nodeById(id);
  if (!node) return '<li><span class="tree-node tree-node--negative">参照なし</span></li>';
  const cycle = path.has(id);
  const classes = ["tree-node", node.type === "attribute" ? "tree-node--attribute" : "", negative ? "tree-node--negative" : ""].filter(Boolean).join(" ");
  const label = `${prefix}${negative ? "NOT " : ""}${node.name}`;
  if (node.type === "attribute" || cycle) {
    return `<li><span class="${classes}">${escapeHtml(label)}${cycle ? "（循環）" : ""}</span></li>`;
  }

  const nextPath = new Set(path);
  nextPath.add(id);
  const leftNegative = operandPolarity(node, "left") === false;
  const rightNegative = operandPolarity(node, "right") === false;
  return `
    <li>
      <span class="${classes}">${escapeHtml(label)} <small>${escapeHtml(directExpression(node))}</small></span>
      <ul>
        ${treeNodeHtml(node.left, "A: ", leftNegative, nextPath)}
        ${treeNodeHtml(node.right, "B: ", rightNegative, nextPath)}
      </ul>
    </li>`;
}

function renderTreeTab(node) {
  if (node.type === "attribute") {
    return `
      <section class="inspector-section">
        <h3>判定の流れ</h3>
        <div class="logic-structure">${logicStructureHtml(buildAst(node.id))}</div>
      </section>`;
  }
  return `
    <section class="inspector-section">
      <h3>判定の流れ</h3>
      <p class="section-help">演算の箱を上から下へたどると、最終的にどの基本属性を調べるかが分かります。</p>
      <div class="logic-structure">${logicStructureHtml(buildAst(node.id))}</div>
    </section>
    <section class="inspector-section">
      <h3>どの知識から作られたか</h3>
      <ul class="knowledge-tree">${treeNodeHtml(node.id)}</ul>
    </section>
    <section class="inspector-section">
      <h3>展開後の論理式</h3>
      <div class="formula-card formula-card--expanded"><code>${escapeHtml(formatAst(buildAst(node.id)))}</code></div>
    </section>`;
}

function miniVennSvg(concept) {
  const selected = concept.regions;
  const outside = selected.neither ? "#6d51a0" : "#171c25";
  const left = selected.leftOnly ? "#3c78b9" : "transparent";
  const right = selected.rightOnly ? "#a66f36" : "transparent";
  const both = selected.both ? "#bc496b" : "#11151d";
  return `
    <svg viewBox="0 0 360 230" role="img" aria-label="保存されたベン図">
      <rect x="8" y="8" width="344" height="214" rx="10" fill="${outside}"></rect>
      <circle cx="140" cy="118" r="79" fill="${left}" stroke="#8792a4" stroke-width="2"></circle>
      <circle cx="220" cy="118" r="79" fill="${right}" stroke="#8792a4" stroke-width="2"></circle>
      <path d="M180 50a79 79 0 0 1 0 136a79 79 0 0 1 0-136Z" fill="${both}" stroke="#8792a4" stroke-width="1.5"></path>
      ${selected.neither ? '<text x="25" y="35" fill="#fff" font-size="18" font-weight="900">✓</text>' : ""}
      ${selected.leftOnly ? '<text x="110" y="125" fill="#fff" font-size="18" font-weight="900">✓</text>' : ""}
      ${selected.rightOnly ? '<text x="238" y="125" fill="#fff" font-size="18" font-weight="900">✓</text>' : ""}
      ${selected.both ? '<text x="172" y="125" fill="#fff" font-size="18" font-weight="900">✓</text>' : ""}
      <text x="117" y="28" fill="#b9c2cf" font-size="12" font-weight="800">A</text>
      <text x="235" y="28" fill="#b9c2cf" font-size="12" font-weight="800">B</text>
    </svg>`;
}

function renderVennTab(node) {
  if (node.type === "attribute") {
    return '<div class="empty-state"><span>○</span><h3>ベン図履歴はありません</h3><p>基本属性は他の知識から作られていません。</p></div>';
  }
  const left = nodeById(node.left)?.name ?? "参照なし";
  const right = nodeById(node.right)?.name ?? "参照なし";
  return `
    <div class="mini-venn">
      ${miniVennSvg(node)}
      <div class="mini-venn-labels"><span>A：${escapeHtml(left)}</span><span>B：${escapeHtml(right)}</span></div>
    </div>
    <section class="inspector-section">
      <h3>選択した領域</h3>
      <div class="region-chip-list">${selectedRegionLabels(node.regions).map((label) => `<span class="region-chip">${escapeHtml(label)}</span>`).join("")}</div>
    </section>`;
}

function triStateResult(id) {
  const relevant = [...collectBaseIds(id)];
  const unknownIds = relevant.filter((attributeId) => state.testValues[attributeId] == null);
  if (unknownIds.length > MAX_ENUM_ATTRIBUTES) return "unknown";
  let sawTrue = false;
  let sawFalse = false;
  const combinations = 2 ** unknownIds.length;

  for (let mask = 0; mask < combinations; mask += 1) {
    const assignment = {};
    for (const attribute of state.data.attributes) {
      const fixed = state.testValues[attribute.id];
      assignment[attribute.id] = fixed == null ? false : fixed;
    }
    unknownIds.forEach((attributeId, index) => {
      assignment[attributeId] = Boolean(mask & (1 << index));
    });
    if (evaluateNode(id, assignment)) sawTrue = true;
    else sawFalse = true;
    if (sawTrue && sawFalse) return "unknown";
  }
  return sawTrue ? "true" : "false";
}

function resultBadge(result) {
  const labels = { true: "○ 成立", false: "× 不成立", unknown: "－ 未確定" };
  return `<span class="result-badge result-badge--${result}">${labels[result]}</span>`;
}

function renderTestTab(node) {
  const controls = state.data.attributes.map((attribute) => {
    const value = state.testValues[attribute.id] ?? null;
    return `
      <div class="test-attribute">
        <span title="${escapeHtml(attribute.name)}">${escapeHtml(attribute.name)}</span>
        <button class="test-state-button${value === true ? " is-active" : ""}" type="button" data-test-id="${escapeHtml(attribute.id)}" data-state="true" aria-label="${escapeHtml(attribute.name)}を必須にする">○</button>
        <button class="test-state-button${value === false ? " is-active" : ""}" type="button" data-test-id="${escapeHtml(attribute.id)}" data-state="false" aria-label="${escapeHtml(attribute.name)}を否定にする">×</button>
        <button class="test-state-button${value == null ? " is-active" : ""}" type="button" data-test-id="${escapeHtml(attribute.id)}" data-state="any" aria-label="${escapeHtml(attribute.name)}を未指定にする">－</button>
      </div>`;
  }).join("");
  const selectedResult = triStateResult(node.id);
  const conceptResults = state.data.concepts.map((concept) => `
    <div class="concept-result-row">
      <span>${escapeHtml(concept.name)}</span>
      ${resultBadge(triStateResult(concept.id))}
    </div>`).join("");

  return `
    <section class="inspector-section">
      <h3>基本属性の状態</h3>
      <div class="test-controls">${controls || '<div class="list-empty">基本属性を追加してください</div>'}</div>
    </section>
    <div class="test-result-card">
      <div class="test-result-main"><strong>${escapeHtml(node.name)}</strong>${resultBadge(selectedResult)}</div>
      <p>「－」を含む場合、すべての補完結果が同じときだけ成立／不成立を確定します。</p>
      <div class="concept-result-list">${conceptResults}</div>
    </div>`;
}

function knowledgeDepth(id, memo = new Map(), visiting = new Set()) {
  if (memo.has(id)) return memo.get(id);
  const node = nodeById(id);
  if (!node || node.type === "attribute") return 0;
  if (visiting.has(id)) return 0;
  visiting.add(id);
  const depth = 1 + Math.max(
    knowledgeDepth(node.left, memo, visiting),
    knowledgeDepth(node.right, memo, visiting),
  );
  visiting.delete(id);
  memo.set(id, depth);
  return depth;
}

function renderMapTab(node) {
  return `
    <div class="relation-guide">
      <strong>「${escapeHtml(node.name)}」を中心にした関係</strong>
      <div class="relation-directions">
        <span>← 左側：この知識を作る材料</span>
        <span>右側：この知識を材料に使う知識 →</span>
      </div>
      <p>線の「A」「B」は、どちらの材料として使っているかを示します。知識をクリックすると、それを中心に表示し直します。</p>
    </div>
    <div class="relation-legend">
      <span><i data-side="A"></i>Aの材料</span>
      <span><i data-side="B"></i>Bの材料</span>
      <span><i data-side="NOT"></i>NOTとして使用</span>
    </div>
    <div class="map-scroll"><svg id="knowledge-map-svg" class="knowledge-map-svg" aria-label="選択した知識を中心にした関係図"></svg></div>`;
}

function collectRelationLevels(rootId) {
  const ancestors = new Map([[rootId, 0]]);
  const ancestorQueue = [rootId];
  while (ancestorQueue.length) {
    const id = ancestorQueue.shift();
    const node = conceptById(id);
    if (!node) continue;
    const nextLevel = ancestors.get(id) + 1;
    for (const sourceId of [node.left, node.right]) {
      if (ancestors.has(sourceId) && ancestors.get(sourceId) <= nextLevel) continue;
      ancestors.set(sourceId, nextLevel);
      ancestorQueue.push(sourceId);
    }
  }

  const consumersBySource = new Map();
  for (const concept of state.data.concepts) {
    for (const sourceId of new Set([concept.left, concept.right])) {
      if (!consumersBySource.has(sourceId)) consumersBySource.set(sourceId, []);
      consumersBySource.get(sourceId).push(concept.id);
    }
  }
  const descendants = new Map([[rootId, 0]]);
  const descendantQueue = [rootId];
  while (descendantQueue.length) {
    const id = descendantQueue.shift();
    const nextLevel = descendants.get(id) + 1;
    for (const consumerId of consumersBySource.get(id) ?? []) {
      if (descendants.has(consumerId) && descendants.get(consumerId) <= nextLevel) continue;
      descendants.set(consumerId, nextLevel);
      descendantQueue.push(consumerId);
    }
  }
  return { ancestors, descendants };
}

function relationEdgeInfo(concept, side) {
  const polarity = operandPolarity(concept, side === "A" ? "left" : "right");
  return {
    side,
    polarity,
    label: polarity === false ? `${side}・NOT` : polarity === true ? `${side}・必要` : `${side}・条件` ,
  };
}

function drawKnowledgeMap() {
  const svg = document.querySelector("#knowledge-map-svg");
  if (!svg) return;
  const root = nodeById(state.selectedId);
  if (!root) {
    svg.setAttribute("viewBox", "0 0 720 300");
    svg.innerHTML = '<text x="360" y="150" fill="#69758a" text-anchor="middle">中心にする知識を選択してください</text>';
    return;
  }

  const { ancestors, descendants } = collectRelationLevels(root.id);
  const groups = new Map();
  for (const [id, level] of ancestors) {
    if (id === root.id) continue;
    const column = -level;
    if (!groups.has(column)) groups.set(column, []);
    groups.get(column).push(nodeById(id));
  }
  groups.set(0, [root]);
  for (const [id, level] of descendants) {
    if (id === root.id) continue;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(nodeById(id));
  }
  for (const group of groups.values()) {
    group.sort((first, second) => first.name.localeCompare(second.name, "ja"));
  }

  const columns = [...groups.keys()].sort((first, second) => first - second);
  const minColumn = Math.min(...columns);
  const maxColumn = Math.max(...columns);
  const maxRows = Math.max(...[...groups.values()].map((group) => group.length));
  const nodeWidth = 170;
  const nodeHeight = 52;
  const columnGap = 245;
  const contentWidth = (maxColumn - minColumn) * columnGap + nodeWidth;
  const width = Math.max(720, contentWidth + 120);
  const height = Math.max(350, 110 + maxRows * 78);
  const leftOffset = (width - contentWidth) / 2;
  const positions = new Map();
  for (const [column, group] of groups) {
    const availableHeight = height - 100;
    group.forEach((node, index) => {
      const x = leftOffset + (column - minColumn) * columnGap;
      const y = 62 + ((index + 1) * availableHeight) / (group.length + 1) - nodeHeight / 2;
      positions.set(node.id, { x, y });
    });
  }

  const visibleIds = new Set(positions.keys());
  const edgeEntries = state.data.concepts.flatMap((concept) => [
    { concept, sourceId: concept.left, side: "A" },
    { concept, sourceId: concept.right, side: "B" },
  ])
    .filter(({ concept, sourceId }) => visibleIds.has(concept.id) && visibleIds.has(sourceId));
  const edges = edgeEntries.map(({ concept, sourceId, side }) => {
    const source = positions.get(sourceId);
    const target = positions.get(concept.id);
    const info = relationEdgeInfo(concept, side);
    const startX = source.x + nodeWidth;
    const startY = source.y + nodeHeight / 2;
    const endX = target.x;
    const endY = target.y + nodeHeight / 2;
    const middle = (startX + endX) / 2;
    const labelY = (startY + endY) / 2 - 7;
    const edgeClass = `map-edge map-edge--${info.side.toLowerCase()}${info.polarity === false ? " map-edge--negative" : ""}`;
    return `
      <path class="${edgeClass}" marker-end="url(#map-arrow-${info.polarity === false ? "negative" : info.side.toLowerCase()})" d="M${startX} ${startY} C${middle} ${startY},${middle} ${endY},${endX} ${endY}"></path>
      <g class="map-edge-label"><rect x="${middle - 27}" y="${labelY - 10}" width="54" height="18" rx="9"></rect><text x="${middle}" y="${labelY + 2}">${info.label}</text></g>`;
  }).join("");

  const columnBands = columns.map((column) => {
    const x = leftOffset + (column - minColumn) * columnGap;
    const title = column < 0
      ? `材料 ${Math.abs(column)}段目`
      : column === 0
        ? "選択中の知識"
        : column === 1
          ? "この知識を使う"
          : `使用先 ${column}段目`;
    return `<g class="map-column"><rect x="${x - 18}" y="18" width="${nodeWidth + 36}" height="${height - 34}" rx="12"></rect><text x="${x + nodeWidth / 2}" y="42">${title}</text></g>`;
  }).join("");

  const nodeMarkup = [...visibleIds].map((id) => {
    const node = nodeById(id);
    const position = positions.get(node.id);
    const selected = node.id === root.id ? " is-selected is-focus" : "";
    const name = node.name.length > 16 ? `${node.name.slice(0, 15)}…` : node.name;
    const meta = node.type === "attribute" ? "基本属性" : node.id === root.id ? "いま見ている知識" : directExpression(node);
    const shortMeta = meta.length > 24 ? `${meta.slice(0, 23)}…` : meta;
    return `
      <g class="map-node${selected}" data-type="${node.type}" data-map-id="${escapeHtml(node.id)}" tabindex="0" role="button">
        <title>${escapeHtml(node.name)}${node.type === "concept" ? `：${escapeHtml(directExpression(node))}` : ""}</title>
        <rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="7"></rect>
        <text class="map-node__name" x="${position.x + nodeWidth / 2}" y="${position.y + 21}">${escapeHtml(name)}</text>
        <text class="map-node__meta" x="${position.x + nodeWidth / 2}" y="${position.y + 39}">${escapeHtml(shortMeta)}</text>
      </g>`;
  }).join("");

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.innerHTML = `
    <defs>
      <marker id="map-arrow-a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#63a6f5"></path></marker>
      <marker id="map-arrow-b" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#e7a35b"></path></marker>
      <marker id="map-arrow-negative" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#f16f72"></path></marker>
    </defs>
    ${columnBands}${edges}${nodeMarkup}`;
}

function renderAll({ preserveEditor = false } = {}) {
  if (state.selectedId && !nodeById(state.selectedId)) state.selectedId = allNodes()[0]?.id ?? null;
  const currentLeft = elements.leftSource.value;
  const currentRight = elements.rightSource.value;
  renderKnowledgeLists();
  if (preserveEditor) {
    populateSourceSelects(currentLeft, currentRight);
    updateEditorPreview();
  }
  renderAnalysis();
}

function exportJson() {
  const payload = {
    version: 1,
    tool: "Knowledge Lab",
    exportedAt: new Date().toISOString(),
    attributes: state.data.attributes,
    concepts: state.data.concepts,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `knowledge-lab-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("JSONを書き出しました。");
}

async function importJson(file) {
  try {
    const text = await file.text();
    const data = normalizeImportedData(JSON.parse(text));
    state.data = data;
    state.selectedId = allNodes()[0]?.id ?? null;
    state.testValues = {};
    resetEditor();
    persistData();
    renderAll({ preserveEditor: true });
    showToast(`${allNodes().length}件の知識を読み込みました。`);
  } catch (error) {
    showToast(`読み込み失敗：${error.message}`);
  } finally {
    elements.importInput.value = "";
  }
}

function restoreSample() {
  if (!window.confirm("現在の内容をサンプルデータで置き換えますか？")) return;
  state.data = sampleData();
  state.selectedId = "concept-chick";
  state.testValues = {};
  resetEditor();
  persistData();
  renderAll({ preserveEditor: true });
  showToast("サンプルデータを復元しました。");
}

function clearAll() {
  if (!window.confirm("すべての基本属性と概念を削除しますか？")) return;
  state.data = emptyData();
  state.selectedId = null;
  state.testValues = {};
  resetEditor();
  persistData();
  renderAll({ preserveEditor: true });
  showToast("すべての知識を削除しました。");
}

elements.search.addEventListener("input", renderKnowledgeLists);
elements.showAddAttribute.addEventListener("click", () => {
  elements.attributeForm.hidden = false;
  elements.showAddAttribute.hidden = true;
  elements.attributeName.focus();
});
elements.attributeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (addAttribute(elements.attributeName.value)) {
    elements.attributeName.value = "";
    elements.attributeForm.hidden = true;
    elements.showAddAttribute.hidden = false;
  }
});
elements.attributeForm.querySelector('[data-action="cancel-attribute"]').addEventListener("click", () => {
  elements.attributeName.value = "";
  elements.attributeForm.hidden = true;
  elements.showAddAttribute.hidden = false;
});

document.querySelector(".knowledge-panel").addEventListener("click", (event) => {
  const item = event.target.closest(".knowledge-item");
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!item || !action) return;
  const { id } = item.dataset;
  if (action === "select") selectKnowledge(id);
  else if (action === "edit") {
    const node = nodeById(id);
    if (node?.type === "concept") editConcept(id);
    else renameKnowledge(id);
  } else if (action === "delete") deleteKnowledge(id);
});

elements.newConceptButton.addEventListener("click", resetEditor);
elements.startEmptyButton.addEventListener("click", startEmptyWorkspace);
elements.inlineAddAttribute.addEventListener("click", addInlineAttribute);
elements.inlineAttributeName.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  elements.inlineAddAttribute.click();
});
elements.conceptForm.addEventListener("submit", saveConcept);
elements.conceptName.addEventListener("input", () => {
  state.formTouched = true;
  renderValidation(false);
});
[elements.leftSource, elements.rightSource].forEach((select) => {
  select.addEventListener("change", () => {
    state.formTouched = true;
    updateEditorPreview();
  });
});

document.querySelectorAll("[data-region], [data-region-button]").forEach((control) => {
  control.addEventListener("click", () => toggleRegion(control.dataset.region || control.dataset.regionButton));
  control.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && control.hasAttribute("data-region")) {
      event.preventDefault();
      toggleRegion(control.dataset.region);
    }
  });
});

elements.analysisTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  state.activeTab = button.dataset.tab;
  renderAnalysis();
});

elements.analysisContent.addEventListener("click", (event) => {
  const tabTarget = event.target.closest("[data-tab-target]");
  if (tabTarget) {
    state.activeTab = tabTarget.dataset.tabTarget;
    return renderAnalysis();
  }

  const selectButton = event.target.closest("[data-select-id]");
  if (selectButton) return selectKnowledge(selectButton.dataset.selectId);

  const mapNode = event.target.closest("[data-map-id]");
  if (mapNode) return selectKnowledge(mapNode.dataset.mapId);

  const testButton = event.target.closest("[data-test-id]");
  if (testButton) {
    const raw = testButton.dataset.state;
    state.testValues[testButton.dataset.testId] = raw === "any" ? null : raw === "true";
    return renderAnalysis();
  }

  if (event.target.closest('[data-action="toggle-patterns"]')) {
    state.showAllPatterns = !state.showAllPatterns;
    renderAnalysis();
  }
});

elements.analysisContent.addEventListener("keydown", (event) => {
  const mapNode = event.target.closest("[data-map-id]");
  if (mapNode && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    selectKnowledge(mapNode.dataset.mapId);
  }
});

elements.exportButton.addEventListener("click", exportJson);
elements.importButton.addEventListener("click", () => elements.importInput.click());
elements.importInput.addEventListener("change", () => {
  const [file] = elements.importInput.files;
  if (file) importJson(file);
});
elements.restoreSampleButton.addEventListener("click", restoreSample);
elements.clearAllButton.addEventListener("click", clearAll);

state.selectedId = nodeById("concept-chick") ? "concept-chick" : allNodes()[0]?.id ?? null;
for (const attribute of state.data.attributes) state.testValues[attribute.id] = null;
resetEditor();
renderAll({ preserveEditor: true });
