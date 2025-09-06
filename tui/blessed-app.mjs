// tui/blessed-app.mjs
// deps: blessed, dotenv, openai
import 'dotenv/config';
import blessed from 'blessed';
import OpenAI from 'openai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { streamChat as streamChatCore } from '../core/chat-core.mjs';

// ────────────────────────────────────────────────────────────
// 환경/초기값
// ────────────────────────────────────────────────────────────
const API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENAI_APIKEY;
if (!API_KEY) {
  console.error('ERROR: OPENAI_API_KEY 가 필요해 (.env 또는 run-cli.sh)');
  process.exit(1);
}
const MODEL = process.env.MODEL || 'gpt-4o-mini';
const client = new OpenAI({ apiKey: API_KEY });

// 대화 컨텍스트(메모리)
const messages = [];
let busy = false;
let INCLUDE_TIME = true;

// ────────────────────────────────────────────────────────────
// UI 구성 (StatusBar / Help / History / InputBox)
// ────────────────────────────────────────────────────────────
const screen = blessed.screen({
  smartCSR: true,
  fullUnicode: true,
  title: 'ChatGPT TUI (blessed)'
});

const status = blessed.box({
  parent: screen,
  top: 0, left: 0, width: '100%', height: 1,
  padding: { left: 1 },
  style: { fg: 'white', bg: 'blue' }
});

const help = blessed.box({
  parent: screen,
  top: 'center', left: 'center',
  width: '80%', height: '70%',
  border: 'line',
  label: ' Help ',
  padding: 1,
  scrollable: true,
  keys: true,
  mouse: true,
  tags: true,
  content:
`{bold}Keys{/}
 Enter       : 전송
 Ctrl+J      : 줄바꿈(멀티라인)
 Ctrl+U      : 입력 비우기
 PgUp/PgDn   : 히스토리 스크롤
 F1 / ? / Ctrl+/ : 도움말 토글
 Ctrl+K      : 키 디버그 토글 (우측 상단)
 Ctrl+O      : 마지막 AI 메시지 저장 (~/.gptcli/clip.txt)
 Ctrl+P      : 파일명 입력 후 저장
 Ctrl+T      : 시간 주입 On/Off
 q / Ctrl+C  : 종료

복사: 터미널 기본 선택(필요시 Shift+Drag)`
});
help.hide();

const historyBox = blessed.box({
  parent: screen,
  top: 1, left: 0,
  width: '100%-0', height: '100%-7',
  tags: true,
  border: 'line',
  label: ' History ',
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  mouse: true,
  vi: true,
  scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'white' } },
  padding: { left: 1, right: 1 }
});

// textarea 유지 (화살표 이동은 미지원; 편집은 줄 단위로)
// 자동 readInput 레이스 방지를 위해 inputOnFocus=false, 수동 시작
const inputBox = blessed.textarea({
  parent: screen,
  bottom: 0, left: 0,
  width: '100%', height: 6,
  border: 'line',
  label: ' Input (Enter=send, Ctrl+J=newline) ',
  inputOnFocus: false,
  keys: true,
  mouse: true,
  padding: { left: 1, right: 1 }
});

// 포커스/오프셋 초기화 + readInput 보장
function resetInputBox() {
  inputBox.setScroll?.(0);
  inputBox.scrollTo?.(0);
  inputBox.setScrollPerc?.(0);
  if (typeof inputBox.childBase === 'number') inputBox.childBase = 0;
  inputBox.focus();
  screen.program.showCursor();
  try { if (!inputBox._reading) inputBox.readInput(() => {}); } catch {}
}
function focusInput() {
  inputBox.focus();
  screen.program.showCursor();
  try { if (!inputBox._reading) inputBox.readInput(() => {}); } catch {}
}

function renderStatus() {
  status.setContent(` Model: ${MODEL} ${busy ? ' | 생각 중…' : ''}  |  Help: F1/?/C-/  |  Time:${INCLUDE_TIME ? 'ON' : 'OFF'}  |  q: Quit `);
  screen.render();
}

const history = []; // [{role:'you'|'ai', text}]
function colorRole(role) {
  return role === 'you' ? '{blue-fg}YOU:{/} ' : '{green-fg}AI:{/} ';
}
function renderHistory() {
  const lines = history.map(m => {
    const safe = (m.text || '').replace(/```/g, '\n```'); // 코드블록 가독성
    return `${colorRole(m.role)}${safe}`;
  }).join('\n\n');
  historyBox.setContent(lines || '메시지를 입력해봐 🙂');
  historyBox.setScrollPerc(100);
  screen.render();
}
function pushHistory(role, text) {
  history.push({ role, text });
  renderHistory();
}

// ────────────────────────────────────────────────────────────
/** 현재 로컬 시간을 system 힌트로 */
function currentTimeHint() {
  try {
    const d = new Date();
    const iso = d.toISOString();
    const human = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full', timeStyle: 'long'
    }).format(d);
    return `Current local time: ${human} (${iso})`;
  } catch {
    return `Current local time: ${new Date().toISOString()}`;
  }
}
// 시간 주입 토글 (Ctrl+T)
screen.key(['C-t'], () => {
  INCLUDE_TIME = !INCLUDE_TIME;
  renderStatus();
});

// ────────────────────────────────────────────────────────────
// 키 바인딩
// ────────────────────────────────────────────────────────────
screen.key(['C-c', 'q'], () => process.exit(0));

// 도움말 토글: F1, '?', Ctrl+/
function toggleHelp() {
  if (help.hidden) {
    help.show();
    help.setFront();
    help.focus();
  } else {
    help.hide();
    focusInput();
  }
  screen.render();
}
// 일반 키
screen.key(['f1'], () => toggleHelp());
inputBox.key(['f1'], () => toggleHelp());
// raw(Ctrl+/ → \x1f) 처리
screen.program.input.on('data', (buf) => {
  if (!buf) return;
  if (buf.includes(0x1f)) toggleHelp();
});

// 입력 편의
inputBox.key(['C-u'], () => { inputBox.setValue(''); screen.render(); });
inputBox.key(['C-j'], () => { // 줄바꿈(수동 스크롤 호출 금지)
  inputBox.setValue((inputBox.getValue() || '') + '\n');
  screen.render();
});

// Enter = 전송 (Paste-guard)
let enterTimer = null;
const PASTE_GUARD_MS = 60; // 40~80ms 권장
inputBox.key('enter', () => {
  if (busy) return;
  const before = inputBox.getValue() || '';
  if (enterTimer) clearTimeout(enterTimer);

  enterTimer = setTimeout(async () => {
    const now = inputBox.getValue() || '';
    const pastedMore =
      (now !== before) && (now.length > before.length) && now.includes('\n');

    if (pastedMore) {
      screen.render();
      return;
    }

    const text = before.trim();
    if (!text) return;

    // 전송: 입력 비움 + 오프셋 초기화 + 포커스 유지
    inputBox.setValue('');
    resetInputBox();
    screen.render();

    messages.push({ role: 'user', content: text });
    pushHistory('you', text);
    await streamAnswer();
  }, PASTE_GUARD_MS);
});

// ESC/TAB으로 언제든 입력창 포커스 복귀
screen.key(['escape','tab'], () => focusInput());

// ────────────────────────────────────────────────────────────
// 스트리밍
// ────────────────────────────────────────────────────────────
async function streamAnswer() {
  busy = true; renderStatus();
  // AI 자리 미리 확보
  pushHistory('ai', '');

  try {
    const payloadMessages = INCLUDE_TIME
      ? [...messages, { role: 'system', content: currentTimeHint() }]
      : messages;

    await streamChatCore({
      client,
      model: MODEL,
      messages: payloadMessages,
      onStart: () => {},
      onDelta: (delta) => {
        const last = history.length - 1;
        history[last].text = (history[last].text || '') + delta;
        renderHistory();
      },
      onDone: (full) => {
        messages.push({ role: 'assistant', content: full || '' });
      }
    });
  } catch (e) {
    const last = history.length - 1;
    history[last].text = `[Error] ${e?.message || e}`;
    renderHistory();
  } finally {
    busy = false; renderStatus();
    resetInputBox();
  }
}

// ────────────────────────────────────────────────────────────
// 키 디버그 (Ctrl+K): 우상단 오버레이 한 줄 로그
// ────────────────────────────────────────────────────────────
let keyDebugOn = false;
const keyDbg = blessed.box({
  parent: screen,
  top: 1, right: 0, width: '50%', height: 3,
  border: 'line',
  label: ' Key Debug ',
  padding: { left: 1, right: 1 },
  tags: true,
  hidden: true,
  wrap: false,
  scrollable: false
});
function setKeyDbgVisible(v) {
  // 현재 스크롤 상태 저장(퍼센트 우선, 라인수 백업)
  const wasAtBottom = historyBox.getScrollPerc() >= 99;
  const prevPerc = historyBox.getScrollPerc();
  const prevPos  = historyBox.getScroll();

  keyDbg.hidden = !v;
  screen.render(); // 레이아웃 먼저 반영

  // 이전 상태에 맞춰 복원
  if (wasAtBottom) {
    historyBox.setScrollPerc(100);
  } else {
    historyBox.setScrollPerc(prevPerc);
    // 퍼센트 복원이 부정확할 때 대비해 라인 오프셋도 재설정
    historyBox.setScroll(prevPos);
  }
  screen.render();
}
screen.key(['C-k'], () => { keyDebugOn = !keyDebugOn; setKeyDbgVisible(keyDebugOn); });
function dumpKey(ch, key) {
  if (!keyDebugOn) return;
  const name = key?.full || key?.name || '';
  const seq = key?.sequence ? ` seq=${JSON.stringify(key.sequence)}` : '';
  const mods = [
    key?.ctrl ? 'Ctrl' : null,
    key?.meta ? 'Meta' : null,
    key?.shift ? 'Shift' : null
  ].filter(Boolean).join('+');
  const w = keyDbg.width - 4;
  const line = `ch=${JSON.stringify(ch || '')} key=${name}${mods ? ' ('+mods+')' : ''}${seq}`;
  keyDbg.setContent(line.length > w ? line.slice(0, w) : line);
  screen.render();
}
screen.on('keypress', dumpKey); // raw는 위 Ctrl+/ 처리만 사용

// ────────────────────────────────────────────────────────────
/** 저장: Ctrl+O 기본, Ctrl+P 파일명 입력 */
// ────────────────────────────────────────────────────────────
const GPTHOME = path.join(os.homedir(), '.gptcli');
if (!fs.existsSync(GPTHOME)) fs.mkdirSync(GPTHOME, { recursive: true });
const DEFAULT_CLIP = path.join(GPTHOME, 'clip.txt');

function lastAssistantText() {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'ai' && history[i].text?.trim()) return history[i].text;
  }
  return '';
}
function writeClip(filePath, content) {
  try {
    fs.writeFileSync(filePath, content ?? '', 'utf8');
    status.setContent(` Model: ${MODEL} ${busy ? ' | 생각 중…' : ''}  |  Saved: ${filePath}  |  Help: F1/?/C-/  |  Time:${INCLUDE_TIME ? 'ON' : 'OFF'}  |  q: Quit `);
    screen.render();
    setTimeout(() => renderStatus(), 1500);
  } catch (e) {
    history.push({ role:'ai', text:`[Save Error] ${e?.message || e}` }); renderHistory();
  }
}

screen.key(['C-o'], () => {
  const txt = lastAssistantText();
  if (!txt) return;
  writeClip(DEFAULT_CLIP, txt);
});

const prompt = blessed.prompt({
  parent: screen, border: 'line', label: ' Save As ',
  width: '60%', height: 7, top: 'center', left: 'center',
  keys: true, tags: true, secret: false
});
screen.key(['C-p'], () => {
  const txt = lastAssistantText();
  if (!txt) return;
  prompt.input(`경로 입력 (기본: ${DEFAULT_CLIP})`, '', (err, value) => {
    if (err) return;
    const p = (value && value.trim()) ? value.trim() : DEFAULT_CLIP;
    writeClip(p, txt);
  });
});

// ────────────────────────────────────────────────────────────
// 시작
// ────────────────────────────────────────────────────────────
resetInputBox();
renderStatus();
renderHistory();

