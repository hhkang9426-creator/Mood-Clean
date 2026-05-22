/* ===== Mood Clean — app.js ===== */

// ====== State ======
const STORAGE_KEY = 'mood_clean_anthropic_key';
const STORAGE_MODEL = 'mood_clean_anthropic_model';
const STORAGE_HISTORY = 'mood_clean_history';
const STORAGE_USAGE = 'mood_clean_token_usage';
const MAX_HISTORY = 20;
let currentDetailId = null;

// Approximate per-1M-token pricing (USD). Used for rough cost estimation.
const MODEL_PRICING = {
  'claude-opus-4-7':   { in: 5.00, out: 25.00 },
  'claude-opus-4-6':   { in: 5.00, out: 25.00 },
  'claude-sonnet-4-6': { in: 3.00, out: 15.00 },
  'claude-haiku-4-5':  { in: 1.00, out:  5.00 },
};

const questions = [
  { q: "오늘 기분은 어떠신가요?", opts: ["매우 좋음","좋음","보통","나쁨","매우 나쁨"] },
  { q: "현재 에너지 레벨은?", opts: ["넘침","활발","보통","피곤","지침"] },
  { q: "오늘의 스트레스 정도는?", opts: ["거의 없음","조금","보통","많음","매우 많음"] },
  { q: "잠은 잘 주무셨나요?", opts: ["푹 잤음","잘 잤음","보통","뒤척임","잘 못 잠"] },
];
const answers = [null, null, null, null];

let currentLevel = 3;
const levelData = {
  1: { name: "매우 좋음", msg: "컨디션이 최고예요! 평소 미루던 깊은 정리(서랍, 옷장)에 도전해 보세요." },
  2: { name: "좋음", msg: "기분이 좋은 날이에요. 책상과 책장 정리 등 가벼운 정리부터 시작해요." },
  3: { name: "보통", msg: "무리하지 말고 침대 정리, 쓰레기 버리기처럼 작은 것부터 해봐요." },
  4: { name: "조금 지침", msg: "오늘은 한 가지만! 눈에 띄는 옷 한 벌, 컵 하나만 정리해도 충분해요." },
  5: { name: "많이 지침", msg: "괜찮아요. 침대 위 물건만 옆으로 옮겨 보세요. 그것만으로도 잘했어요." },
};

let beforeUrl = null, afterUrl = null;
let beforeBase64 = null, beforeMediaType = null;
let afterBase64 = null, afterMediaType = null;
let checklist = [];

// ====== Quiz ======
function renderQuiz(){
  const wrap = document.getElementById('quiz-questions');
  wrap.innerHTML = questions.map((q, i) => `
    <div class="question-card">
      <h3>${i+1}. ${q.q}</h3>
      <div class="options">
        ${q.opts.map((opt, j) => `<div class="option" data-q="${i}" data-v="${j+1}" onclick="selectOpt(this)">${opt}</div>`).join('')}
      </div>
    </div>
  `).join('');
}
function selectOpt(el){
  const q = +el.dataset.q;
  const v = +el.dataset.v;
  answers[q] = v;
  document.querySelectorAll(`.option[data-q="${q}"]`).forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

// ====== Page nav ======
function goPage(name){
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  window.scrollTo(0, 0);
}

// ====== Drawer ======
function toggleDrawer(){
  document.getElementById('drawer').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open');
}

// ====== Token Usage ======
function getUsage(){
  try {
    const raw = localStorage.getItem(STORAGE_USAGE);
    if(raw) return JSON.parse(raw);
  } catch(_){}
  return { input: 0, output: 0, cost: 0, requests: 0 };
}
function setUsage(u){
  try { localStorage.setItem(STORAGE_USAGE, JSON.stringify(u)); } catch(_){}
}
function addTokenUsage(model, inTok, outTok){
  const u = getUsage();
  const p = MODEL_PRICING[model] || MODEL_PRICING['claude-sonnet-4-6'];
  const cost = (inTok / 1000000) * p.in + (outTok / 1000000) * p.out;
  u.input += inTok;
  u.output += outTok;
  u.cost += cost;
  u.requests += 1;
  setUsage(u);
  // Refresh modal if open
  if(document.getElementById('apiModal').classList.contains('open')){
    renderUsage();
  }
}
function resetUsage(){
  if(!confirm('누적된 토큰 사용량을 초기화할까요?')) return;
  setUsage({ input: 0, output: 0, cost: 0, requests: 0 });
  renderUsage();
}
function renderUsage(){
  const u = getUsage();
  const total = u.input + u.output;
  document.getElementById('usageTotal').textContent = total.toLocaleString();
  document.getElementById('usageIn').textContent = u.input.toLocaleString();
  document.getElementById('usageOut').textContent = u.output.toLocaleString();
  document.getElementById('usageCost').textContent = u.cost.toFixed(4);
  document.getElementById('usageRequests').textContent = `요청 ${u.requests}회`;
  // Threshold for visualization: 0 ~ 200K tokens
  const pct = Math.min(100, (total / 200000) * 100);
  const fill = document.getElementById('usageBarFill');
  const lvl = document.getElementById('usageLevel');
  fill.style.width = pct + '%';
  let cls, label;
  if(total < 50000){ cls = 'low'; label = '낮음'; }
  else if(total < 150000){ cls = 'mid'; label = '보통'; }
  else { cls = 'high'; label = '높음'; }
  fill.className = 'usage-bar-fill ' + cls;
  lvl.className = 'usage-level ' + cls;
  lvl.textContent = label;
}

// ====== API Modal ======
function openApiModal(){
  const key = localStorage.getItem(STORAGE_KEY) || '';
  const model = localStorage.getItem(STORAGE_MODEL) || 'claude-sonnet-4-6';
  document.getElementById('apiKeyInput').value = key;
  document.getElementById('modelSelect').value = model;
  const status = document.getElementById('apiStatus');
  if(key){
    status.className = 'api-status connected';
    status.textContent = '✓ API 연결됨';
  } else {
    status.className = 'api-status disconnected';
    status.textContent = '연결되지 않음';
  }
  renderUsage();
  document.getElementById('apiModal').classList.add('open');
}
function closeApiModal(){
  document.getElementById('apiModal').classList.remove('open');
}
function saveApiKey(){
  const key = document.getElementById('apiKeyInput').value.trim();
  const model = document.getElementById('modelSelect').value;
  if(!key){ alert('API 키를 입력해주세요.'); return; }
  if(!key.startsWith('sk-ant-')){
    if(!confirm('일반적인 Anthropic 키 형식이 아닙니다. 그대로 저장할까요?')) return;
  }
  localStorage.setItem(STORAGE_KEY, key);
  localStorage.setItem(STORAGE_MODEL, model);
  updateApiButton();
  closeApiModal();
}
function clearApiKey(){
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_MODEL);
  document.getElementById('apiKeyInput').value = '';
  updateApiButton();
  openApiModal();
}
function updateApiButton(){
  const btn = document.getElementById('apiBtn');
  if(localStorage.getItem(STORAGE_KEY)){
    btn.classList.add('connected');
    btn.textContent = '✓ 연결됨';
  } else {
    btn.classList.remove('connected');
    btn.textContent = 'API 연결';
  }
}

// ====== Level ======
function calcLevel(){
  if(answers.includes(null)){ alert('모든 질문에 답해주세요!'); return; }
  const sum = answers.reduce((a,b)=>a+b,0);
  const lvl = Math.min(5, Math.max(1, Math.round(sum / 4)));
  currentLevel = lvl;
  document.getElementById('levelNum').textContent = lvl;
  document.getElementById('levelName').textContent = levelData[lvl].name;
  document.getElementById('levelMsg').textContent = levelData[lvl].msg;
  const bars = document.getElementById('levelBars');
  bars.innerHTML = '';
  for(let i=1;i<=5;i++){
    const b = document.createElement('div');
    b.className = 'level-bar' + (i <= lvl ? ' active' : '');
    bars.appendChild(b);
  }
  goPage('result');
}

// ====== File handling ======
function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = result.indexOf(',');
      resolve(result.substring(comma + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleUpload(e, idx){
  const file = e.target.files[0];
  if(!file) return;
  const url = URL.createObjectURL(file);
  let mediaType = file.type;
  if(!['image/jpeg','image/png','image/gif','image/webp'].includes(mediaType)){
    mediaType = 'image/jpeg';
  }
  const base64 = await fileToBase64(file);
  if(idx === 1){
    beforeUrl = url; beforeBase64 = base64; beforeMediaType = mediaType;
    const area = document.getElementById('uploadArea1');
    area.classList.add('has-image');
    area.innerHTML = `<img src="${url}" alt="before"/>`;
    document.getElementById('analyzeBtn').disabled = false;
  } else {
    afterUrl = url; afterBase64 = base64; afterMediaType = mediaType;
    const area = document.getElementById('uploadArea2');
    area.classList.add('has-image');
    area.innerHTML = `<img src="${url}" alt="after"/>`;
    document.getElementById('compareBtn').disabled = false;
  }
}

// ====== Anthropic API ======
async function callClaude(messages, systemPrompt, maxTokens = 2048){
  const apiKey = localStorage.getItem(STORAGE_KEY);
  const model = localStorage.getItem(STORAGE_MODEL) || 'claude-sonnet-4-6';
  if(!apiKey) throw new Error('API_KEY_MISSING');

  const body = {
    model,
    max_tokens: maxTokens,
    messages,
  };
  if(systemPrompt) body.system = systemPrompt;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if(!res.ok){
    const errText = await res.text();
    let errMsg = errText;
    try { errMsg = JSON.parse(errText).error?.message || errText; } catch(_){}
    throw new Error(`API_ERROR_${res.status}: ${errMsg}`);
  }

  const data = await res.json();
  // Track token usage
  try {
    const u = data.usage || {};
    const inTok = u.input_tokens || 0;
    const outTok = u.output_tokens || 0;
    const modelUsed = data.model || model;
    addTokenUsage(modelUsed, inTok, outTok);
  } catch(_){}
  const textBlock = (data.content || []).find(b => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

function extractJSON(text){
  // Strip markdown fences if present and parse JSON
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if(firstBrace >= 0 && lastBrace > firstBrace){
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

// ====== Analyze (before) ======
async function startAnalyze(){
  const apiKey = localStorage.getItem(STORAGE_KEY);
  if(!apiKey){
    const err = document.getElementById('uploadError');
    err.innerHTML = `<div class="error-banner">먼저 우측 상단 'API 연결' 버튼으로 Anthropic API 키를 등록해주세요.</div>`;
    return;
  }
  document.getElementById('uploadError').innerHTML = '';

  goPage('analyzing');
  document.getElementById('analyzingTitle').textContent = 'AI가 방을 분석 중이에요';
  document.getElementById('analyzingDesc').textContent = 'Claude AI가 사진을 살펴보고 있어요...';

  const sortInstruction = currentLevel >= 4
    ? "사용자 컨디션이 지친 편이므로 청소 난이도가 낮은 가벼운 항목부터 우선 배치하세요. 부담 없이 시작할 수 있는 쉬운 일부터 점차 어려운 일 순서로 정렬해주세요."
    : "사용자 컨디션이 괜찮은 편이므로 가장 시급하게 정리가 필요한 항목(쓰레기, 빨래, 위생 관련)을 우선 배치하세요. 우선순위가 높은 항목부터 차례대로 정렬해주세요.";

  const systemPrompt = `당신은 친절한 방 정리 코치입니다. 사용자의 방 사진을 보고 현재 상태를 진단하고, 사용자의 컨디션 레벨에 맞는 맞춤형 체크리스트를 만들어줍니다. 응답은 반드시 한국어로 작성하고, 지정된 JSON 형식으로만 답하세요. 다른 텍스트나 설명은 포함하지 마세요.`;

  const userPrompt = `사용자의 오늘 컨디션 레벨: ${currentLevel}/5 (1=매우 좋음, 5=많이 지침)

이 방 사진을 분석하고 다음 JSON 형식으로 응답해주세요:

{
  "diagnosis": "방 상태에 대한 친근하고 구체적인 진단 (2-3문장, 한국어)",
  "checklist": [
    {"text": "구체적인 정리 항목 (한국어)", "priority": "low|mid|high", "urgency": 1-5}
  ]
}

규칙:
- ${sortInstruction}
- 체크리스트는 5~6개 항목으로 만드세요.
- priority는 "low"(쉬움/낮음), "mid"(중간), "high"(우선/높음) 중 하나.
- urgency는 1(낮음)~5(높음)의 정수.
- 사진에서 실제로 보이는 구체적인 항목을 우선하세요 (예: "책상 위 컵 치우기", "바닥의 옷 빨래통에 넣기").
- 따뜻하고 친근한 어조로 작성하세요.

JSON만 응답하세요.`;

  try {
    const responseText = await callClaude([{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: beforeMediaType, data: beforeBase64 }},
        { type: 'text', text: userPrompt }
      ]
    }], systemPrompt, 2048);

    const parsed = extractJSON(responseText);
    const diagnosis = parsed.diagnosis || '방을 분석했어요.';
    let items = Array.isArray(parsed.checklist) ? parsed.checklist : [];

    // Sort based on level
    // Level 4~5: 청소 난이도가 낮은 순 (urgency 낮은 순 = 쉬운 항목 먼저)
    // Level 1~3: 청소 우선순위대로 (urgency 높은 순 = 시급한 항목 먼저)
    if(currentLevel >= 4){
      items.sort((a,b) => (a.urgency||3) - (b.urgency||3));
    } else {
      items.sort((a,b) => (b.urgency||3) - (a.urgency||3));
    }

    checklist = items.slice(0, 6).map(it => ({
      text: it.text || '정리하기',
      priority: ['low','mid','high'].includes(it.priority) ? it.priority : 'mid',
      urgency: it.urgency || 3,
      done: false,
    }));

    document.getElementById('diagLevel').textContent = currentLevel;
    document.getElementById('diagText').textContent = diagnosis;
    document.getElementById('progressTotal').textContent = checklist.length;

    renderChecklist();
    goPage('checklist');
  } catch(err) {
    handleApiError(err, 'upload');
  }
}

// ====== Compare (before/after) ======
async function startCompare(){
  const apiKey = localStorage.getItem(STORAGE_KEY);
  if(!apiKey){
    alert('API 키가 등록되어 있지 않습니다.');
    return;
  }
  goPage('analyzing2');

  const systemPrompt = '당신은 친절하지만 솔직한 방 정리 코치입니다. 정리 전후의 방 사진을 객관적으로 비교하고, 같은 공간인지/충분히 정리되었는지 판단합니다. 응답은 반드시 한국어로 작성하고, 지정된 JSON 형식으로만 답하세요.';

  const userPrompt = `첫 번째 사진은 정리 전(BEFORE), 두 번째 사진은 정리 후(AFTER) 모습입니다.

두 사진을 객관적으로 비교하여 다음 JSON 형식으로만 응답해주세요:

{
  "status": "success" | "insufficient" | "different_space",
  "message": "한국어 분석문 (2-3문장, 끝에 어울리는 이모지 1개)"
}

판단 규칙:
- "different_space": 두 사진이 명백히 다른 공간/방으로 보일 때 (가구 배치, 벽, 창문, 바닥재 등이 완전히 다른 경우)
- "insufficient": 같은 공간이지만 변화가 거의 없거나 정리가 매우 부족한 경우 (어지러진 물건이 그대로 있거나 거의 그대로일 때)
- "success": 같은 공간에서 의미 있는 정리가 이루어진 경우 (작은 변화라도 노력의 흔적이 보이면 success)

message 작성:
- success: 어떤 부분이 좋아졌는지 구체적으로 칭찬하고 따뜻한 격려를 포함
- insufficient: 변화가 부족하다는 점을 부드럽게 알려주고, 어떤 부분을 더 정리하면 좋을지 구체적으로 제안
- different_space: 정리 전 사진과 다른 공간으로 보인다고 알려주고, 같은 공간 사진을 다시 올려달라고 안내

JSON만 응답하세요. 마크다운이나 다른 텍스트는 포함하지 마세요.`;

  try {
    const responseText = await callClaude([{
      role: 'user',
      content: [
        { type: 'text', text: 'BEFORE 사진:' },
        { type: 'image', source: { type: 'base64', media_type: beforeMediaType, data: beforeBase64 }},
        { type: 'text', text: 'AFTER 사진:' },
        { type: 'image', source: { type: 'base64', media_type: afterMediaType, data: afterBase64 }},
        { type: 'text', text: userPrompt }
      ]
    }], systemPrompt, 1024);

    let status = 'success';
    let message = '';
    try {
      const parsed = extractJSON(responseText);
      if(['success','insufficient','different_space'].includes(parsed.status)) status = parsed.status;
      message = parsed.message || responseText.trim();
    } catch(_){
      message = responseText.trim();
    }
    if(!message) message = '정리하느라 수고하셨어요!';

    document.getElementById('beforeImg').innerHTML = beforeUrl ? `<img src="${beforeUrl}"/>` : '사진';
    document.getElementById('afterImg').innerHTML = afterUrl ? `<img src="${afterUrl}"/>` : '사진';
    document.getElementById('compareText').textContent = message;

    applyCompareStatus(status);

    // Persist record only on success
    if(status === 'success'){
      saveHistoryRecord(message);
    }
    goPage('compare');
  } catch(err) {
    handleApiError(err, 'after-upload');
  }
}

function applyCompareStatus(status){
  const celeb = document.getElementById('compareCelebration');
  const emoji = document.getElementById('celebEmoji');
  const title = document.getElementById('celebTitle');
  const msg = document.getElementById('celebMsg');
  const successActions = document.getElementById('compareSuccessActions');
  const retryActions = document.getElementById('compareRetryActions');

  if(status === 'success'){
    celeb.classList.remove('retry');
    emoji.textContent = '🎉';
    title.textContent = '퀘스트 완료!';
    msg.innerHTML = '정말 멋져요!<br/>오늘의 작은 정리가 마음을 한결 가볍게 만들었어요.';
    successActions.style.display = '';
    retryActions.style.display = 'none';
  } else if(status === 'insufficient'){
    celeb.classList.add('retry');
    emoji.textContent = '💪';
    title.textContent = '조금만 더!';
    msg.innerHTML = '아직 정리할 부분이 남아있어요.<br/>다시 한번 도전해볼까요?';
    successActions.style.display = 'none';
    retryActions.style.display = '';
  } else {
    // different_space
    celeb.classList.add('retry');
    emoji.textContent = '📷';
    title.textContent = '같은 공간 사진이 필요해요';
    msg.innerHTML = '처음 올린 사진과 다른 공간으로 보여요.<br/>정리한 같은 공간을 다시 찍어 올려주세요.';
    successActions.style.display = 'none';
    retryActions.style.display = '';
  }
}

function retryClean(){
  // Clear after photo so user can upload again, return to checklist
  afterUrl = null; afterBase64 = null; afterMediaType = null;
  const u2 = document.getElementById('uploadArea2');
  u2.classList.remove('has-image');
  u2.innerHTML = `<div class="upload-icon">✨</div><div class="upload-text"><strong>After 사진 업로드</strong>정리된 방을 보여주세요</div>`;
  const fi2 = document.getElementById('fileInput2');
  if(fi2) fi2.value = '';
  document.getElementById('compareBtn').disabled = true;
  goPage('checklist');
}

function handleApiError(err, returnPage){
  console.error(err);
  let msg = '분석 중 오류가 발생했어요.';
  const errStr = err.message || String(err);
  if(errStr.includes('API_KEY_MISSING')){
    msg = 'API 키가 등록되어 있지 않습니다.';
  } else if(errStr.includes('401')){
    msg = 'API 키가 올바르지 않습니다. 다시 확인해주세요.';
  } else if(errStr.includes('429')){
    msg = '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
  } else if(errStr.includes('400')){
    msg = '요청 형식이 잘못되었어요. 다른 사진으로 시도해보세요.';
  } else if(errStr.includes('Failed to fetch') || errStr.includes('NetworkError')){
    msg = '네트워크 연결을 확인해주세요.';
  } else {
    msg = '오류: ' + errStr.substring(0, 200);
  }
  goPage(returnPage);
  setTimeout(() => alert(msg), 100);
}

// ====== Checklist ======
function renderChecklist(){
  const wrap = document.getElementById('checklistItems');
  wrap.innerHTML = checklist.map((c, i) => `
    <div class="checklist-item ${c.done ? 'checked' : ''}" onclick="toggleCheck(${i})">
      <div class="checkbox"></div>
      <div class="item-content">
        <div class="item-text">${escapeHtml(c.text)}</div>
        <span class="item-priority ${c.priority}">${c.priority === 'high' ? '우선' : c.priority === 'mid' ? '중간' : '쉬움'}</span>
      </div>
    </div>
  `).join('');
  updateProgress();
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toggleCheck(i){
  checklist[i].done = !checklist[i].done;
  renderChecklist();
}
function updateProgress(){
  const done = checklist.filter(c => c.done).length;
  const total = checklist.length;
  const pct = total ? (done / total) * 100 : 0;
  document.getElementById('progressNum').textContent = done;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('afterBtn').disabled = pct < 50;
}

// ====== History ======
function getHistory(){
  try {
    const raw = localStorage.getItem(STORAGE_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch(_){ return []; }
}
function setHistory(list){
  try {
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(list));
  } catch(err) {
    // Quota exceeded — drop oldest entries until it fits
    while(list.length > 1){
      list.shift();
      try { localStorage.setItem(STORAGE_HISTORY, JSON.stringify(list)); return; }
      catch(_){}
    }
    console.error('history save failed', err);
  }
}
function saveHistoryRecord(compareText){
  const list = getHistory();
  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,7),
    date: Date.now(),
    level: currentLevel,
    levelName: levelData[currentLevel] ? levelData[currentLevel].name : '',
    diagnosis: document.getElementById('diagText').textContent || '',
    compareText: compareText || '',
    checklist: checklist.map(c => ({ text: c.text, priority: c.priority, done: !!c.done })),
    // Store compressed dataURLs for thumbnails (resize to ~480px width)
    beforeImg: null,
    afterImg: null,
  };
  Promise.all([
    compressDataUrl(beforeUrl, 480),
    compressDataUrl(afterUrl, 480),
  ]).then(([b, a]) => {
    record.beforeImg = b;
    record.afterImg = a;
    list.push(record);
    while(list.length > MAX_HISTORY) list.shift();
    setHistory(list);
  }).catch(err => {
    console.warn('image compress failed', err);
    list.push(record);
    while(list.length > MAX_HISTORY) list.shift();
    setHistory(list);
  });
}
function compressDataUrl(objectUrl, maxW){
  return new Promise((resolve, reject) => {
    if(!objectUrl) return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      } catch(e){ reject(e); }
    };
    img.onerror = reject;
    img.src = objectUrl;
  });
}
function formatDate(ts){
  const d = new Date(ts);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function openHistory(){
  goPage('history');
  renderHistory();
}
function renderHistory(){
  const wrap = document.getElementById('historyContent');
  const apiKey = localStorage.getItem(STORAGE_KEY);
  if(!apiKey){
    wrap.innerHTML = `
      <div class="history-locked">
        <div class="emoji">🔒</div>
        <h3>API 연결 후 이용할 수 있어요</h3>
        <p>그동안 분석하고 정리한 기록은<br/>API 키를 등록한 사용자만 볼 수 있어요.</p>
        <button class="btn-primary" onclick="openApiModal()">API 연결하기</button>
      </div>`;
    return;
  }
  const list = getHistory();
  // 20-day stamp chart always shown when connected
  const stampHtml = renderStampSection(list.length);
  let bodyHtml;
  if(list.length === 0){
    bodyHtml = `
      <div class="history-empty">
        <div class="emoji">🌱</div>
        <p>아직 저장된 기록이 없어요.<br/>오늘의 첫 정리를 시작해보세요!</p>
      </div>`;
  } else {
    const reversed = list.slice().reverse();
    bodyHtml = reversed.map(rec => {
      const done = (rec.checklist || []).filter(c => c.done).length;
      const total = (rec.checklist || []).length;
      const lvName = rec.levelName || (levelData[rec.level] ? levelData[rec.level].name : '');
      return `
        <div class="history-card" onclick="openHistoryDetail('${rec.id}')">
          <div class="history-card-head">
            <span class="history-date">${formatDate(rec.date)}</span>
            <span class="history-level">LV ${rec.level} · ${escapeHtml(lvName)}</span>
          </div>
          <div class="history-thumbs">
            <div class="history-thumb">${rec.beforeImg ? `<img src="${rec.beforeImg}"/>` : ''}</div>
            <div class="history-thumb">${rec.afterImg ? `<img src="${rec.afterImg}"/>` : ''}</div>
          </div>
          <div class="history-text">${escapeHtml(rec.compareText || rec.diagnosis || '')}</div>
          <div class="history-stats">
            <span>완료 <strong>${done}/${total}</strong></span>
            <span>진단 <strong>${rec.diagnosis ? '있음' : '없음'}</strong></span>
          </div>
        </div>`;
    }).join('');
  }
  wrap.innerHTML = stampHtml + bodyHtml;
}

// ====== 20-day Stamp chart ======
function renderStampSection(count){
  const filledCount = Math.min(count, 20);
  let stamps = '';
  for(let i = 1; i <= 20; i++){
    if(i <= filledCount){
      stamps += `<div class="stamp filled" onclick="openTrend()" title="${i}번째 정리 완료">✓</div>`;
    } else if(i === filledCount + 1){
      stamps += `<div class="stamp next" onclick="openTrend()" title="다음 정리"><span class="stamp-num">${i}</span></div>`;
    } else {
      stamps += `<div class="stamp" onclick="openTrend()" title="미완료"><span class="stamp-num">${i}</span></div>`;
    }
  }
  return `
    <div class="stamp-section">
      <div class="stamp-head">
        <h3>🏆 20일 정리 스탬프</h3>
        <span class="stamp-count">${filledCount} / 20</span>
      </div>
      <p class="stamp-hint">정리를 완료할 때마다 스탬프가 하나씩 채워져요.<br/>스탬프를 누르면 레벨 추이 차트를 볼 수 있어요.</p>
      <div class="stamp-grid">${stamps}</div>
    </div>`;
}

// ====== Level trend chart ======
function openTrend(){
  goPage('trend');
  renderTrend();
}
function renderTrend(){
  const wrap = document.getElementById('trendContent');
  const list = getHistory();
  if(list.length === 0){
    wrap.innerHTML = `
      <div class="history-empty">
        <div class="emoji">📈</div>
        <p>아직 추이 데이터가 없어요.<br/>정리를 완료하면 기분·완성도 변화가 쌓여요!</p>
      </div>`;
    return;
  }
  // Build data points (oldest -> newest)
  const points = list.map((rec, i) => {
    const cl = rec.checklist || [];
    const done = cl.filter(c => c.done).length;
    const total = cl.length || 1;
    return {
      idx: i + 1,
      completeness: Math.round(done / total * 100), // 행동에 따른 완성도
      mood: (6 - rec.level) * 20,                    // 기분 점수 (level1=100, level5=20)
      level: rec.level,
    };
  });
  wrap.innerHTML =
    buildTrendStats(points) +
    `<div class="trend-chart-wrap">
       ${buildTrendSvg(points)}
       <div class="trend-legend">
         <span><span class="trend-dot" style="background:#9b6dd1"></span>기분 점수</span>
         <span><span class="trend-dot" style="background:#4caf85"></span>정리 완성도</span>
       </div>
     </div>` +
    buildTrendSummary(points);
}
function buildTrendStats(points){
  const n = points.length;
  const avgComp = Math.round(points.reduce((s,p)=>s+p.completeness,0)/n);
  const avgMood = Math.round(points.reduce((s,p)=>s+p.mood,0)/n);
  const best = Math.max.apply(null, points.map(p=>p.completeness));
  return `
    <div class="trend-stats">
      <div class="trend-stat"><div class="v">${n}</div><div class="l">정리 횟수</div></div>
      <div class="trend-stat"><div class="v">${avgComp}%</div><div class="l">평균 완성도</div></div>
      <div class="trend-stat"><div class="v">${best}%</div><div class="l">최고 완성도</div></div>
    </div>`;
}
function buildTrendSvg(points){
  const W = 320, H = 210, padL = 30, padR = 14, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = points.length;
  const x = i => n === 1 ? padL + plotW/2 : padL + plotW * (i / (n - 1));
  const y = v => padT + plotH * (1 - v / 100);

  // gridlines + y labels
  let grid = '';
  [0,25,50,75,100].forEach(v => {
    const yy = y(v);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${padL+plotW}" y2="${yy.toFixed(1)}" stroke="#eee" stroke-width="1"/>`;
    grid += `<text x="${padL-6}" y="${(yy+3).toFixed(1)}" font-size="8" fill="#bbb" text-anchor="end">${v}</text>`;
  });

  // polylines
  const moodPts = points.map((p,i) => `${x(i).toFixed(1)},${y(p.mood).toFixed(1)}`).join(' ');
  const compPts = points.map((p,i) => `${x(i).toFixed(1)},${y(p.completeness).toFixed(1)}`).join(' ');
  let lines = '';
  if(n > 1){
    lines += `<polyline points="${moodPts}" fill="none" stroke="#9b6dd1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    lines += `<polyline points="${compPts}" fill="none" stroke="#4caf85" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  // dots + x labels
  let dots = '', xlabels = '';
  const step = Math.max(1, Math.ceil(n / 8));
  points.forEach((p,i) => {
    dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.mood).toFixed(1)}" r="3.4" fill="#9b6dd1"/>`;
    dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.completeness).toFixed(1)}" r="3.4" fill="#4caf85"/>`;
    if(n <= 10 || i === 0 || i === n-1 || i % step === 0){
      xlabels += `<text x="${x(i).toFixed(1)}" y="${H-padB+14}" font-size="8" fill="#bbb" text-anchor="middle">${p.idx}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="trend-svg" preserveAspectRatio="xMidYMid meet">
    ${grid}${lines}${dots}${xlabels}
    <text x="${padL+plotW/2}" y="${H-4}" font-size="8" fill="#aaa" text-anchor="middle">정리 횟수 (회)</text>
  </svg>`;
}
function buildTrendSummary(points){
  const n = points.length;
  const first = points[0], last = points[n-1];
  const avgComp = Math.round(points.reduce((s,p)=>s+p.completeness,0)/n);
  const compDelta = last.completeness - first.completeness;

  // overall trend message
  let trendMsg;
  if(n === 1){
    trendMsg = '첫 번째 기록이에요. 다음 정리부터 기분과 완성도의 추이를 비교할 수 있어요. 🌱';
  } else if(compDelta > 5){
    trendMsg = `처음(${first.completeness}%)보다 최근 완성도가 ${compDelta}%p 높아졌어요. 꾸준함이 빛나고 있어요! 🌟`;
  } else if(compDelta < -5){
    trendMsg = `최근 완성도가 처음보다 ${Math.abs(compDelta)}%p 낮아졌어요. 기분이 지칠 땐 쉬운 항목부터 천천히 해봐요. 🍃`;
  } else {
    trendMsg = `완성도가 평균 ${avgComp}% 안팎으로 안정적으로 유지되고 있어요. 좋은 흐름이에요! 👍`;
  }

  // mood vs behavior insight
  const goodMood = points.filter(p => p.mood >= 60);
  const lowMood  = points.filter(p => p.mood < 60);
  let insight;
  if(goodMood.length && lowMood.length){
    const g = Math.round(goodMood.reduce((s,p)=>s+p.completeness,0)/goodMood.length);
    const l = Math.round(lowMood.reduce((s,p)=>s+p.completeness,0)/lowMood.length);
    if(g > l + 5){
      insight = `기분이 좋은 날엔 평균 ${g}%, 지친 날엔 ${l}%를 정리했어요. 기분이 행동(완성도)에 뚜렷한 영향을 주고 있어요.`;
    } else if(l > g + 5){
      insight = `지친 날에도 평균 ${l}%로, 기분 좋은 날(${g}%)만큼 잘 해내고 있어요. 기분에 흔들리지 않는 멋진 습관이에요!`;
    } else {
      insight = `기분이 좋든 지치든 평균 ${avgComp}% 안팎으로 꾸준히 정리하고 있어요. 안정적인 루틴이 자리 잡았어요.`;
    }
  } else if(goodMood.length){
    insight = `기록이 대부분 기분이 좋은 날이에요. 평균 완성도는 ${avgComp}%로 좋은 출발이에요.`;
  } else {
    insight = `지친 컨디션에서도 평균 ${avgComp}%를 정리했어요. 작은 실천이 모이고 있어요.`;
  }

  return `
    <div class="trend-summary">
      <h4>기분과 행동, 완성도 분석</h4>
      <p>${trendMsg}</p>
      <p>${insight}</p>
    </div>`;
}

// ====== History detail ======
function openHistoryDetail(id){
  const rec = getHistory().find(r => r.id === id);
  if(!rec) return;
  currentDetailId = id;
  document.getElementById('detailDate').textContent = formatDate(rec.date);
  document.getElementById('detailLevel').textContent = rec.level;
  document.getElementById('detailLevelName').textContent = rec.levelName || (levelData[rec.level] ? levelData[rec.level].name : '');
  document.getElementById('detailBefore').innerHTML = rec.beforeImg ? `<img src="${rec.beforeImg}"/>` : '<div style="padding:24px;color:#aaa;font-size:12px;text-align:center">사진 없음</div>';
  document.getElementById('detailAfter').innerHTML = rec.afterImg ? `<img src="${rec.afterImg}"/>` : '<div style="padding:24px;color:#aaa;font-size:12px;text-align:center">사진 없음</div>';
  document.getElementById('detailDiag').textContent = rec.diagnosis || '-';
  document.getElementById('detailCompare').textContent = rec.compareText || '-';
  const cl = rec.checklist || [];
  const done = cl.filter(c => c.done).length;
  const total = cl.length;
  document.getElementById('detailDone').textContent = done;
  document.getElementById('detailTotal').textContent = total;
  document.getElementById('detailProgress').style.width = (total ? (done/total)*100 : 0) + '%';
  document.getElementById('detailChecklist').innerHTML = cl.map(c => `
    <div class="checklist-item ${c.done ? 'checked' : ''}" style="cursor:default;">
      <div class="checkbox"></div>
      <div class="item-content">
        <div class="item-text">${escapeHtml(c.text)}</div>
        <span class="item-priority ${c.priority}">${c.priority === 'high' ? '우선' : c.priority === 'mid' ? '중간' : '쉬움'}</span>
      </div>
    </div>
  `).join('') || '<p style="text-align:center;color:#aaa;font-size:13px;padding:20px">체크리스트가 없어요.</p>';
  goPage('history-detail');
}
function deleteCurrentDetail(){
  if(!currentDetailId) return;
  if(!confirm('이 기록을 삭제할까요?')) return;
  const list = getHistory().filter(r => r.id !== currentDetailId);
  setHistory(list);
  currentDetailId = null;
  openHistory();
}

// ====== Reset ======
function resetAll(){
  answers.fill(null);
  beforeUrl = null; afterUrl = null;
  beforeBase64 = null; afterBase64 = null;
  document.querySelectorAll('.option.selected').forEach(o => o.classList.remove('selected'));
  const u1 = document.getElementById('uploadArea1');
  u1.classList.remove('has-image');
  u1.innerHTML = `<div class="upload-icon">📷</div><div class="upload-text"><strong>사진 업로드</strong>클릭하여 사진을 선택하세요</div>`;
  const u2 = document.getElementById('uploadArea2');
  u2.classList.remove('has-image');
  u2.innerHTML = `<div class="upload-icon">✨</div><div class="upload-text"><strong>After 사진 업로드</strong>정리된 방을 보여주세요</div>`;
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('compareBtn').disabled = true;
  document.getElementById('uploadError').innerHTML = '';
  goPage('main');
}

// ====== Init ======
renderQuiz();
updateApiButton();
