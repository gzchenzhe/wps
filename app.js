"use strict";

const form = document.getElementById("reportForm");
const canvas = document.getElementById("reportCanvas");
const ctx = canvas.getContext("2d");
const previewImage = document.getElementById("previewImage");
const downloadLink = document.getElementById("downloadLink");
const saveState = document.getElementById("saveState");
const topDownloadButton = document.getElementById("topDownloadButton");
const pasteCustomerInfoButton = document.getElementById("pasteCustomerInfoButton");
const pasteCustomerSheet = document.getElementById("pasteCustomerSheet");
const closePasteCustomerSheetButton = document.getElementById("closePasteCustomerSheetButton");
const pastedCustomerInfo = document.getElementById("pastedCustomerInfo");
const parsePastedCustomerInfoButton = document.getElementById("parsePastedCustomerInfoButton");
const pastedCustomerResult = document.getElementById("pastedCustomerResult");
const cancelPastedCustomerInfoButton = document.getElementById("cancelPastedCustomerInfoButton");
const applyPastedCustomerInfoButton = document.getElementById("applyPastedCustomerInfoButton");
const idCardOcrButton = document.getElementById("idCardOcrButton");
const idCardImageInput = document.getElementById("idCardImageInput");
const signaturePad = document.getElementById("managerSignaturePad");
const signatureCtx = signaturePad.getContext("2d");
const signatureState = document.getElementById("signatureState");
const saveSignatureButton = document.getElementById("saveSignatureButton");
const clearSignatureButton = document.getElementById("clearSignatureButton");
const signatureToggleButton = document.getElementById("signatureToggleButton");
const signatureBox = document.querySelector(".signature-box");
const employmentOptions = Array.from(form.querySelectorAll("[data-employment-option]"));
const dateInputs = Array.from(form.querySelectorAll(".date-picker"));
const pages = Array.from(document.querySelectorAll(".form-page"));
const navButtons = Array.from(document.querySelectorAll(".nav-button"));
const storageKey = "high-risk-dd-pwa-v2";
const signatureStorageKey = "high-risk-dd-manager-signature-v1";
const ocrAccessKeyStorageKey = "high-risk-dd-ocr-access-key-v1";
const ocrEndpoint = "https://1434068878-d6t6nrdesd.ap-guangzhou.tencentscf.com/id-card-ocr";

const paper = {
  width: 794,
  height: 1123,
  scale: 2
};

const textFont = '"SimSun", "Songti SC", "STSong", serif';
const uiFont = '"Microsoft YaHei", "PingFang SC", sans-serif';
const handFont = '"STXingkai", "华文行楷", "Xingkai SC", "Kaiti SC", "KaiTi", cursive';

const fieldNames = [
  "branch", "city", "team", "customerName", "gender", "idNumber", "workUnitSelected",
  "selfCompanySelected",
  "employmentAddress", "homeAddress", "buyCity", "phone", "submitDate", "source",
  "carModel", "loanPercent", "loanAmount", "incomeSource", "incomeRange",
  "otherNotes", "fraudWarn", "addressOk", "payMethod",
  "payerRelation", "visitDate"
];

let renderTimer = null;
let lastBlob = null;
let hasSavedManagerSignature = false;
let hasSignatureDraft = false;
let signatureLocked = false;
let signatureCollapsed = false;
let isDrawingSignature = false;
let lastSignaturePoint = null;
let lastPointerEventAt = 0;
let parsedCustomerInfo = null;

function todayValue() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getField(name) {
  return form.elements[name];
}

function getData() {
  const data = {};
  for (const name of fieldNames) {
    const el = getField(name);
    if (!el) continue;
    data[name] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  return data;
}

function setData(data) {
  for (const name of fieldNames) {
    const el = getField(name);
    if (!el || data[name] === undefined) continue;
    if (el.type === "checkbox") {
      el.checked = Boolean(data[name]);
    } else {
      el.value = data[name];
    }
  }
}

function ensureDefaults() {
  if (!getField("branch").value) getField("branch").value = "广州";
  if (!getField("city").value) getField("city").value = "广州";
  if (!getField("team").value) getField("team").value = "海珠团队";
  if (!getField("buyCity").value) getField("buyCity").value = "广州";
  if (!getField("source").value) getField("source").value = "销售推荐";
  if (!getField("submitDate").value) getField("submitDate").value = todayValue();
  if (!getField("visitDate").value) getField("visitDate").value = todayValue();
  if (!getField("incomeRange").value) getField("incomeRange").value = "12-15万";
  if (!getField("incomeSource").value) getField("incomeSource").value = "工资收入";
  if (!getField("payMethod").value) getField("payMethod").value = "本人转账支付";
  if (!getField("workUnitSelected").checked && !getField("selfCompanySelected").checked) {
    getField("workUnitSelected").checked = true;
  }
}

function saveData() {
  localStorage.setItem(storageKey, JSON.stringify(getData()));
  saveState.textContent = "已保存";
}

function loadData() {
  const raw = localStorage.getItem(storageKey);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      if (saved.workUnitSelected === undefined && saved.selfCompanySelected === undefined) {
        const selectedType = saved.employmentType || (saved.selfCompany ? "selfCompany" : "workUnit");
        saved.workUnitSelected = selectedType !== "selfCompany";
        saved.selfCompanySelected = selectedType === "selfCompany";
      }
      if (saved.employmentAddress === undefined) {
        saved.employmentAddress = saved.selfCompany || saved.workUnit || "";
      }
      setData(saved);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }
  ensureDefaults();
  syncDateDisplays();
}

function fileSafeName(name) {
  const base = (name || "高风险客户").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "");
  return `${base || "高风险客户"}-尽调表.png`;
}

function formatDate(value) {
  if (!value) return "年月日";
  const parts = value.split("-");
  if (parts.length !== 3) return value;
  return `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`;
}

function syncDateDisplay(input) {
  const display = document.getElementById(input.dataset.dateDisplay);
  if (display) display.value = input.value ? formatDate(input.value) : "";
}

function syncDateDisplays() {
  for (const input of dateInputs) syncDateDisplay(input);
}

function formatLoanAmount(percent, amount) {
  const cleanPercent = String(percent || "").replace(/%/g, "").trim();
  const cleanAmount = String(amount || "").replace(/万/g, "").trim();
  const percentText = cleanPercent ? `${cleanPercent}%` : "%";
  const amountText = cleanAmount ? `${cleanAmount}万` : "万";
  return `${percentText}  ${amountText}`;
}

function optionMark(active, text) {
  return `${active ? "☑" : "□"} ${text}`;
}

function setFont(size, weight = "400", family = textFont) {
  ctx.font = `${weight} ${size}px ${family}`;
}

function drawLine(x1, y1, x2, y2, width = 1) {
  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawText(text, x, y, options = {}) {
  setFont(options.size || 14, options.weight || "400", options.family || textFont);
  ctx.fillStyle = options.color || "#111";
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "middle";
  ctx.fillText(String(text || ""), x, y);
}

function wrapText(text, maxWidth, size = 14, family = textFont) {
  setFont(size, "400", family);
  const input = String(text || "");
  const hardLines = input.split(/\n/);
  const lines = [];
  for (const hardLine of hardLines) {
    let line = "";
    for (const char of Array.from(hardLine)) {
      const trial = line + char;
      if (!line || ctx.measureText(trial).width <= maxWidth) {
        line = trial;
      } else {
        lines.push(line);
        line = char;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

function drawWrapped(text, x, y, maxWidth, lineHeight, options = {}) {
  const size = options.size || 14;
  const lines = wrapText(text, maxWidth, size, options.family || textFont);
  const maxLines = options.maxLines || lines.length;
  setFont(size, options.weight || "400", options.family || textFont);
  ctx.fillStyle = options.color || "#111";
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < Math.min(lines.length, maxLines); i += 1) {
    let line = lines[i];
    if (i === maxLines - 1 && lines.length > maxLines) line = line.slice(0, -1) + "…";
    ctx.fillText(line, x, y + i * lineHeight);
  }
  return Math.min(lines.length, maxLines) * lineHeight;
}

function measureCellText(text, w, options = {}) {
  const size = options.size || 15;
  const maxLines = options.maxLines || Infinity;
  const lineHeight = options.lineHeight || 20;
  const lines = wrapText(text, w - 12, size);
  const count = Math.min(lines.length, maxLines);
  return {
    lines,
    count,
    lineHeight,
    height: Math.max(1, count) * lineHeight + 14
  };
}

function cellText(text, x, y, w, h, options = {}) {
  const size = options.size || 15;
  const align = options.align || "center";
  const measured = measureCellText(text, w, options);
  const lines = measured.lines;
  const count = measured.count;
  setFont(size, options.weight || "400", options.family || textFont);
  ctx.fillStyle = "#111";
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const lineHeight = measured.lineHeight;
  const startY = y + h / 2 - ((count - 1) * lineHeight) / 2;
  const textX = align === "left" ? x + 8 : x + w / 2;
  for (let i = 0; i < count; i += 1) {
    ctx.fillText(lines[i], textX, startY + i * lineHeight);
  }
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function jitter(seed, index, range) {
  const mixed = hashString(`${seed}:${index}`) % 1000;
  return ((mixed / 999) * 2 - 1) * range;
}

function drawHandSignature(name, x, y, width, height) {
  const chars = Array.from(String(name || "").trim());
  if (!chars.length) return;

  const baseSize = chars.length <= 2 ? 61 : chars.length === 3 ? 52 : 44;
  const usable = width - 8;
  const gap = chars.length === 1 ? 0 : Math.min(baseSize * 0.92, usable / (chars.length - 0.2));
  const total = chars.length === 1 ? baseSize : gap * (chars.length - 1) + baseSize * 0.72;
  const start = x + (width - total) / 2 + baseSize * 0.24;
  const baseline = y + height * 0.66;

  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = "#111";
  ctx.font = `400 ${baseSize}px ${handFont}`;

  chars.forEach((char, index) => {
    const dx = start + index * gap + jitter(name, index, 4);
    const dy = baseline + jitter(name, index + 9, 6);
    const rotate = jitter(name, index + 17, 0.09);
    const scaleX = 1 + jitter(name, index + 31, 0.08);
    const scaleY = 1 + jitter(name, index + 43, 0.06);
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(rotate);
    ctx.scale(scaleX, scaleY);
    ctx.globalAlpha = 0.96;
    ctx.fillText(char, 0, 0);
    ctx.globalAlpha = 0.18;
    ctx.fillText(char, 1.3, -1.1);
    ctx.restore();
  });

  ctx.restore();
}

function setupSignatureCanvas() {
  signatureCtx.lineCap = "round";
  signatureCtx.lineJoin = "round";
  signatureCtx.strokeStyle = "#111";
  signatureCtx.lineWidth = 6;
}

function clearSignatureCanvas() {
  signatureCtx.clearRect(0, 0, signaturePad.width, signaturePad.height);
}

function signaturePoint(event) {
  const source = event.touches?.[0] || event.changedTouches?.[0] || event;
  const rect = signaturePad.getBoundingClientRect();
  return {
    x: (source.clientX - rect.left) * (signaturePad.width / rect.width),
    y: (source.clientY - rect.top) * (signaturePad.height / rect.height)
  };
}

function drawSignatureLine(from, to) {
  signatureCtx.beginPath();
  signatureCtx.moveTo(from.x, from.y);
  signatureCtx.lineTo(to.x, to.y);
  signatureCtx.stroke();
}

function updateSignatureUi() {
  if (signatureLocked) {
    signatureState.textContent = "已保存，已锁定";
  } else if (hasSignatureDraft) {
    signatureState.textContent = "未保存，请点保存签名";
  } else {
    signatureState.textContent = "未保存手写签字";
  }

  signaturePad.classList.toggle("is-locked", signatureLocked);
  signaturePad.setAttribute("aria-disabled", signatureLocked ? "true" : "false");
  saveSignatureButton.disabled = signatureLocked || !hasSignatureDraft;
}

function setSignatureCollapsed(collapsed) {
  signatureCollapsed = collapsed;
  signatureBox.classList.toggle("is-collapsed", signatureCollapsed);
  signatureToggleButton.textContent = signatureCollapsed ? "展开" : "收起";
  signatureToggleButton.setAttribute("aria-expanded", String(!signatureCollapsed));
}

function saveManagerSignature() {
  if (!hasSignatureDraft) return;
  localStorage.setItem(signatureStorageKey, signaturePad.toDataURL("image/png"));
  hasSavedManagerSignature = true;
  hasSignatureDraft = false;
  signatureLocked = true;
  updateSignatureUi();
  drawReport();
}

function loadManagerSignature() {
  const saved = localStorage.getItem(signatureStorageKey);
  if (!saved) {
    hasSavedManagerSignature = false;
    hasSignatureDraft = false;
    signatureLocked = false;
    updateSignatureUi();
    return;
  }

  const image = new Image();
  image.onload = () => {
    clearSignatureCanvas();
    signatureCtx.drawImage(image, 0, 0, signaturePad.width, signaturePad.height);
    hasSavedManagerSignature = true;
    hasSignatureDraft = false;
    signatureLocked = true;
    updateSignatureUi();
    drawReport();
  };
  image.onerror = () => {
    localStorage.removeItem(signatureStorageKey);
    hasSavedManagerSignature = false;
    hasSignatureDraft = false;
    signatureLocked = false;
    updateSignatureUi();
  };
  image.src = saved;
}

function drawManagerSignatureFromPad(x, y, width, height) {
  if (!hasSavedManagerSignature && !hasSignatureDraft) return false;

  ctx.save();
  ctx.drawImage(signaturePad, x, y, width, height);
  ctx.restore();
  return true;
}

function beginSignature(event) {
  event.preventDefault();
  if (signatureLocked) return;
  document.body.classList.add("signing-active");
  isDrawingSignature = true;
  hasSignatureDraft = true;
  lastSignaturePoint = signaturePoint(event);
  signatureCtx.beginPath();
  signatureCtx.arc(lastSignaturePoint.x, lastSignaturePoint.y, 1.4, 0, Math.PI * 2);
  signatureCtx.fillStyle = "#111";
  signatureCtx.fill();
  updateSignatureUi();
}

function moveSignature(event) {
  if (!isDrawingSignature || !lastSignaturePoint) return;
  event.preventDefault();
  const next = signaturePoint(event);
  drawSignatureLine(lastSignaturePoint, next);
  lastSignaturePoint = next;
}

function finishSignature(event) {
  if (!isDrawingSignature) return;
  event?.preventDefault();
  isDrawingSignature = false;
  lastSignaturePoint = null;
  document.body.classList.remove("signing-active");
  updateSignatureUi();
  drawReport();
}

function drawTable(d) {
  const x0 = 77;
  const y0 = 200;
  const xs = [77, 265, 398, 588, 718];
  const baseRowHeights = [50, 36, 31, 31, 31, 30];

  const rows = [
    ["客户 姓名", d.customerName, "客户身份证号码", d.idNumber],
    ["客户 性别", d.gender, "客户工作单位", d.workUnitSelected ? d.employmentAddress : ""],
    ["客户居住地址", d.homeAddress, "自雇公司（如有）", d.selfCompanySelected ? d.employmentAddress : ""],
    ["客户购车城市", d.buyCity, "客户电话", d.phone],
    ["进件时间", formatDate(d.submitDate), "获客来源", d.source],
    ["客户意向品牌及车型", d.carModel, "拟贷款成数及贷款金额", formatLoanAmount(d.loanPercent, d.loanAmount)]
  ];

  const rowHeights = rows.map((row, rowIndex) => {
    let rowHeight = baseRowHeights[rowIndex];
    for (let colIndex = 0; colIndex < 4; colIndex += 1) {
      const cellW = xs[colIndex + 1] - xs[colIndex];
      const isIdValue = rowIndex === 0 && colIndex === 3;
      const measured = measureCellText(row[colIndex], cellW, {
        size: isIdValue ? 14 : 15,
        lineHeight: isIdValue ? 17 : 20
      });
      rowHeight = Math.max(rowHeight, measured.height);
    }
    return rowHeight;
  });

  const ys = [y0];
  for (const rowHeight of rowHeights) {
    ys.push(ys[ys.length - 1] + rowHeight);
  }

  const detailTop = ys[ys.length - 1];
  const tableBottom = Math.max(959, detailTop + 520);

  drawLine(x0, y0, 718, y0);
  drawLine(x0, tableBottom, 718, tableBottom);
  drawLine(x0, y0, x0, tableBottom);
  drawLine(718, y0, 718, tableBottom);
  for (let i = 1; i < ys.length; i += 1) drawLine(x0, ys[i], 718, ys[i]);
  for (let i = 1; i < xs.length - 1; i += 1) drawLine(xs[i], y0, xs[i], detailTop);

  for (let r = 0; r < rows.length; r += 1) {
    const rowY = ys[r];
    const rowH = rowHeights[r];
    for (let c = 0; c < 4; c += 1) {
      const cellX = xs[c];
      const cellW = xs[c + 1] - xs[c];
      const isValue = c === 1 || c === 3;
      const isIdValue = r === 0 && c === 3;
      cellText(rows[r][c], cellX, rowY, cellW, rowH, {
        align: isValue ? "left" : "center",
        size: isIdValue ? 14 : 15,
        lineHeight: isIdValue ? 17 : 20,
        maxLines: Infinity
      });
    }
  }

  const lineX = 84;
  const lineW = 624;
  let y = detailTop + 10;
  const income = [
    optionMark(d.incomeSource === "工资收入", "工资收入"),
    optionMark(d.incomeSource === "经营收入", "经营收入"),
    optionMark(d.incomeSource === "租金收入", "租金收入"),
    optionMark(d.incomeSource === "其他资产性收入", "其他资产性收入")
  ].join("/");
  const pay = [
    optionMark(d.payMethod === "本人现金支付", "本人现金支付"),
    optionMark(d.payMethod === "本人转账支付", "本人转账支付"),
    optionMark(d.payMethod === "他人代付", "他人代付")
  ].join("/");
  const relation = [
    optionMark(d.payerRelation === "直系亲属", "直系亲属"),
    optionMark(d.payerRelation === "朋友", "朋友"),
    optionMark(d.payerRelation === "其他", "其他：")
  ].join("/");

  const items = [
    `1、是否对客户进行骗贷提醒 （${optionMark(d.fraudWarn, "是")}、${optionMark(!d.fraudWarn, "否")}）`,
    `2、已核实客户工作地址、居住地址无异常（${optionMark(d.addressOk, "是")}、${optionMark(!d.addressOk, "否")}）`,
    `3.①客户主要收入来源（${income}）；②客户年收入情况：${d.incomeRange || ""}`,
    `4、首付款支付方式：（${pay}；如为他人代付，请补充主贷人与代付人的关系：${relation}______）`,
    `5、其他情况说明（客户购车用途、异地购车原因等）`
  ];

  for (const item of items) {
    const used = drawWrapped(item, lineX, y, lineW, 25, { size: 14.5, maxLines: item.startsWith("3.") || item.startsWith("4") ? 2 : 1 });
    y += Math.max(38, used + 20);
  }

  if (d.otherNotes) {
    drawWrapped(d.otherNotes, lineX + 24, y - 8, lineW - 24, 24, { size: 14.5, maxLines: 3 });
  }

  const managerSignY = tableBottom - 179;
  const supervisorSignY = tableBottom - 105;
  drawText("客户经理签字：", 414, managerSignY + 52, { size: 15 });
  drawManagerSignatureFromPad(525, managerSignY, 168, 92);
  drawText("主管签字：", 447, supervisorSignY + 44, { size: 15 });
  drawText(`亲见日期：${formatDate(d.visitDate)}`, 454, tableBottom - 10, { size: 15 });
}

function drawReport() {
  const d = getData();
  canvas.width = paper.width * paper.scale;
  canvas.height = paper.height * paper.scale;
  ctx.setTransform(paper.scale, 0, 0, paper.scale, 0, 0);
  ctx.clearRect(0, 0, paper.width, paper.height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, paper.width, paper.height);

  drawLine(72, 76, 722, 76);
  drawText("高风险客户尽职调查表 2023 版", paper.width / 2, 162, {
    size: 18,
    weight: "700",
    align: "center"
  });

  drawText(`所属分中心：${d.branch || ""}`, 73, 190, { size: 14 });
  drawText(`所属城市：${d.city || ""}`, 267, 190, { size: 14 });
  drawText(`所属团队：${d.team || ""}`, 465, 190, { size: 14 });

  drawTable(d);
  updateImage(d);
}

function updateImage(d) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    if (lastBlob) URL.revokeObjectURL(lastBlob.url);
    const url = URL.createObjectURL(blob);
    lastBlob = { blob, url };
    previewImage.src = url;
    downloadLink.href = url;
    downloadLink.download = fileSafeName(d.customerName);
    saveState.textContent = "已生成";
  }, "image/png");
}

function scheduleRender() {
  saveState.textContent = "编辑中";
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    saveData();
    drawReport();
  }, 160);
}

function clearCustomerData() {
  form.reset();
  setData({
    branch: "广州",
    city: "广州",
    team: "海珠团队",
    buyCity: "广州",
    submitDate: todayValue(),
    source: "销售推荐",
    incomeSource: "工资收入",
    incomeRange: "12-15万",
    fraudWarn: true,
    addressOk: true,
    payMethod: "本人转账支付",
    workUnitSelected: true,
    selfCompanySelected: false,
    visitDate: todayValue()
  });
  syncDateDisplays();
  saveData();
  drawReport();
}

function canvasToBlob() {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

async function getCurrentImageFile() {
  const blob = await canvasToBlob();
  if (!blob) return null;
  return new File([blob], fileSafeName(getData().customerName), { type: "image/png" });
}

function triggerDownload(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

async function saveImageToDevice() {
  const file = await getCurrentImageFile();
  if (!file) return;

  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({
        files: [file],
        title: "高风险客户尽职调查表"
      });
      return;
    } catch (error) {
      if (error?.name !== "AbortError") triggerDownload(file);
      saveState.textContent = "已生成";
      return;
    }
  }

  triggerDownload(file);
}

function requestOcrAccessKey() {
  const savedKey = localStorage.getItem(ocrAccessKeyStorageKey);
  if (savedKey) return savedKey;

  const input = window.prompt("请输入身份证识别密码");
  if (!input || !input.trim()) return null;

  const key = input.trim();
  localStorage.setItem(ocrAccessKeyStorageKey, key);
  return key;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("IMAGE_LOAD_FAILED"));
    };
    image.src = url;
  });
}

function canvasToJpegBlob(canvasElement, quality) {
  return new Promise((resolve) => canvasElement.toBlob(resolve, "image/jpeg", quality));
}

function readBlobAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
    reader.readAsDataURL(blob);
  });
}

async function prepareIdCardImage(file) {
  const image = await loadImageFromFile(file);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, 1600 / longestSide);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const workCanvas = document.createElement("canvas");
  const workCtx = workCanvas.getContext("2d");

  workCanvas.width = width;
  workCanvas.height = height;
  workCtx.fillStyle = "#fff";
  workCtx.fillRect(0, 0, width, height);
  workCtx.drawImage(image, 0, 0, width, height);

  let quality = 0.9;
  let blob = await canvasToJpegBlob(workCanvas, quality);
  while (blob && blob.size > 2.5 * 1024 * 1024 && quality > 0.55) {
    quality -= 0.1;
    blob = await canvasToJpegBlob(workCanvas, quality);
  }

  if (!blob || blob.size > 2.5 * 1024 * 1024) {
    throw new Error("IMAGE_TOO_LARGE");
  }

  return readBlobAsBase64(blob);
}

function setOcrBusy(isBusy, message) {
  idCardOcrButton.disabled = isBusy;
  saveState.textContent = message;
}

function applyIdCardResult(data) {
  getField("customerName").value = data.name || "";
  getField("idNumber").value = data.idNumber || "";
  getField("gender").value = data.sex === "男" || data.sex === "女" ? data.sex : "";
  scheduleRender();
}

async function recognizeIdCard(file) {
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    window.alert("请选择身份证图片。");
    return;
  }

  const accessKey = requestOcrAccessKey();
  if (!accessKey) return;

  try {
    setOcrBusy(true, "正在识别身份证");
    const imageBase64 = await prepareIdCardImage(file);
    const response = await fetch(ocrEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OCR-Access-Key": accessKey
      },
      body: JSON.stringify({ imageBase64 })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.ok) {
      if (response.status === 401) {
        localStorage.removeItem(ocrAccessKeyStorageKey);
        throw new Error("ACCESS_KEY_INVALID");
      }
      const requestError = new Error(payload.message || "OCR_REQUEST_FAILED");
      requestError.code = payload.code || "OCR_REQUEST_FAILED";
      throw requestError;
    }

    const data = payload.data || {};
    if (!data.name || !data.idNumber) {
      throw new Error("OCR_EMPTY_RESULT");
    }

    const confirmed = window.confirm(
      `请确认识别结果：\n姓名：${data.name}\n身份证号：${data.idNumber}\n性别：${data.sex || "未识别"}`
    );

    if (confirmed) {
      applyIdCardResult(data);
      if (data.warnings?.length) {
        window.alert(`已填入客户信息。\n图片提示：${data.warnings.join("、")}`);
      }
    }

    saveState.textContent = confirmed ? "已填入" : "已取消填入";
  } catch (error) {
    const code = error.code || error.message;
    const message = {
      ACCESS_KEY_INVALID: "识别密码不正确，请重新输入。",
      IMAGE_TOO_LARGE: "图片过大，请靠近身份证重新拍摄。",
      IMAGE_LOAD_FAILED: "无法读取这张图片，请重新选择。",
      IMAGE_READ_FAILED: "图片处理失败，请重新选择。",
      OCR_EMPTY_RESULT: "未识别出完整的姓名和身份证号，请让身份证文字横向、清晰完整地重新拍摄。"
    }[code] || (
      /UnauthorizedOperation|AuthFailure|InvalidCredential/i.test(code)
        ? "云函数尚未获得 OCR 调用权限，请稍后重试。"
        : /ImageBlur|ImageNoText|ImageSize|FailedOperation/i.test(code)
          ? "图片无法识别。请让身份证上的文字横向、完整且清晰后重新拍摄。"
          : `身份证识别失败（${code}）。请查看云函数日志。`
    );
    window.alert(message);
    saveState.textContent = "识别失败";
  } finally {
    idCardImageInput.value = "";
    idCardOcrButton.disabled = false;
  }
}

function parseCustomerInfoText(text) {
  const data = { name: "", phone: "", company: "", address: "" };

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([^：:]+?)\s*[：:]\s*(.*?)\s*$/);
    if (!match) continue;

    const label = match[1].replace(/\s/g, "");
    const value = match[2].trim();
    if (!value) continue;

    if (/^(申请人姓名|客户姓名|本人姓名)$/.test(label)) {
      data.name = value;
    } else if (/^(本人电话|客户电话|手机号码|联系电话)$/.test(label)) {
      data.phone = value.replace(/\s/g, "");
    } else if (/^(本人目前工作单位名字|目前工作单位名字|工作单位名字|工作单位|单位名称|公司名称)$/.test(label)) {
      data.company = value;
    } else if (/^(目前居住地址|客户居住地址|居住地址|现住址)$/.test(label)) {
      data.address = value;
    }
  }

  return data;
}

function closePasteCustomerSheet() {
  pasteCustomerSheet.hidden = true;
}

function showPastedCustomerResult(data) {
  document.getElementById("pastedResultName").textContent = data.name || "未识别";
  document.getElementById("pastedResultPhone").textContent = data.phone || "未识别";
  document.getElementById("pastedResultCompany").textContent = data.company || "未识别";
  document.getElementById("pastedResultAddress").textContent = data.address || "未识别";
  pastedCustomerResult.hidden = false;
}

function applyParsedCustomerInfo() {
  if (!parsedCustomerInfo) return;

  if (parsedCustomerInfo.name) getField("customerName").value = parsedCustomerInfo.name;
  if (parsedCustomerInfo.phone) getField("phone").value = parsedCustomerInfo.phone;
  if (parsedCustomerInfo.company) {
    getField("employmentAddress").value = parsedCustomerInfo.company;
    getField("workUnitSelected").checked = true;
    getField("selfCompanySelected").checked = false;
  }
  if (parsedCustomerInfo.address) getField("homeAddress").value = parsedCustomerInfo.address;

  closePasteCustomerSheet();
  pastedCustomerInfo.value = "";
  parsedCustomerInfo = null;
  pastedCustomerResult.hidden = true;
  scheduleRender();
}

function showPage(pageName) {
  for (const page of pages) {
    page.classList.toggle("active", page.dataset.page === pageName);
  }

  for (const button of navButtons) {
    const active = button.dataset.targetPage === pageName;
    button.classList.toggle("active", active);
    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }

  window.scrollTo(0, 0);
  if (pageName === "done") drawReport();
}

document.getElementById("clearButton").addEventListener("click", clearCustomerData);
topDownloadButton.addEventListener("click", saveImageToDevice);
pasteCustomerInfoButton.addEventListener("click", () => {
  pastedCustomerInfo.value = "";
  parsedCustomerInfo = null;
  pastedCustomerResult.hidden = true;
  pasteCustomerSheet.hidden = false;
  setTimeout(() => pastedCustomerInfo.focus(), 80);
});
closePasteCustomerSheetButton.addEventListener("click", closePasteCustomerSheet);
cancelPastedCustomerInfoButton.addEventListener("click", closePasteCustomerSheet);
pasteCustomerSheet.addEventListener("click", (event) => {
  if (event.target === pasteCustomerSheet) closePasteCustomerSheet();
});
parsePastedCustomerInfoButton.addEventListener("click", () => {
  parsedCustomerInfo = parseCustomerInfoText(pastedCustomerInfo.value);
  showPastedCustomerResult(parsedCustomerInfo);
});
applyPastedCustomerInfoButton.addEventListener("click", applyParsedCustomerInfo);
idCardOcrButton.addEventListener("click", () => idCardImageInput.click());
idCardImageInput.addEventListener("change", () => recognizeIdCard(idCardImageInput.files?.[0]));
downloadLink.addEventListener("click", (event) => {
  event.preventDefault();
  saveImageToDevice();
});
for (const button of navButtons) {
  button.addEventListener("click", () => showPage(button.dataset.targetPage));
}

for (const option of employmentOptions) {
  option.addEventListener("change", () => {
    if (!option.checked) {
      option.checked = true;
      return;
    }
    for (const otherOption of employmentOptions) {
      if (otherOption !== option) otherOption.checked = false;
    }
  });
}

for (const input of dateInputs) {
  input.addEventListener("input", () => syncDateDisplay(input));
  input.addEventListener("change", () => syncDateDisplay(input));
}

form.addEventListener("input", scheduleRender);
form.addEventListener("change", scheduleRender);

signaturePad.addEventListener("dragstart", (event) => event.preventDefault());
signaturePad.addEventListener("selectstart", (event) => event.preventDefault());
signaturePad.addEventListener("contextmenu", (event) => event.preventDefault());

signaturePad.addEventListener("pointerdown", (event) => {
  lastPointerEventAt = Date.now();
  signaturePad.setPointerCapture?.(event.pointerId);
  beginSignature(event);
});

signaturePad.addEventListener("pointermove", (event) => {
  lastPointerEventAt = Date.now();
  moveSignature(event);
});

signaturePad.addEventListener("pointerup", finishSignature);
signaturePad.addEventListener("pointercancel", finishSignature);
signaturePad.addEventListener("pointerleave", finishSignature);

signaturePad.addEventListener("mousedown", (event) => {
  if (Date.now() - lastPointerEventAt < 800) return;
  beginSignature(event);
});

window.addEventListener("mousemove", (event) => {
  if (Date.now() - lastPointerEventAt < 800) return;
  moveSignature(event);
});

window.addEventListener("mouseup", (event) => {
  if (Date.now() - lastPointerEventAt < 800) return;
  finishSignature(event);
});

signaturePad.addEventListener("touchstart", (event) => {
  if (Date.now() - lastPointerEventAt < 800) return;
  beginSignature(event);
}, { passive: false });

signaturePad.addEventListener("touchmove", (event) => {
  if (Date.now() - lastPointerEventAt < 800) return;
  moveSignature(event);
}, { passive: false });

signaturePad.addEventListener("touchend", (event) => {
  if (Date.now() - lastPointerEventAt < 800) return;
  finishSignature(event);
}, { passive: false });

saveSignatureButton.addEventListener("click", saveManagerSignature);
signatureToggleButton.addEventListener("click", () => {
  setSignatureCollapsed(!signatureCollapsed);
});

clearSignatureButton.addEventListener("click", () => {
  if (!window.confirm("确定清除已保存的手写签名吗？清除后需要重新手写并保存。")) return;
  clearSignatureCanvas();
  localStorage.removeItem(signatureStorageKey);
  hasSavedManagerSignature = false;
  hasSignatureDraft = false;
  signatureLocked = false;
  updateSignatureUi();
  drawReport();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

setupSignatureCanvas();
updateSignatureUi();
setSignatureCollapsed(true);
loadData();
loadManagerSignature();
saveData();
drawReport();
