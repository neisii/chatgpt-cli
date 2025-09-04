// chat-cli.js (ESM)
// deps: chalk@^5, dotenv@^17, openai@^5
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as readline from 'node:readline';
import OpenAI from 'openai';
import chalk from 'chalk';

// ────────────────────────────────────────────────────────────
// 경로/파일
// ────────────────────────────────────────────────────────────
const HOME = os.homedir();
const GPTHOME = path.join(HOME, '.gptcli');
const CONF = path.join(GPTHOME, 'config.json');
const PRESETS_FILE = path.join(GPTHOME, 'presets.json');
const SESSION = path.join(GPTHOME, 'session.json');

if (!fs.existsSync(GPTHOME)) fs.mkdirSync(GPTHOME, { recursive: true });

// 기본 프리셋(파일 없으면 최초 1회 생성)
const DEFAULT_PRESETS = {
  banmal: "너는 한국어로 친근한 반말체로 대답해. 불필요한 존댓말 쓰지 말고, 답변은 간결하게.",
  brief: "Answer concisely unless a deep dive is requested.",
  dev: "You are a senior software engineer. Provide runnable code where helpful."
};
if (!fs.existsSync(PRESETS_FILE)) {
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(DEFAULT_PRESETS, null, 2));
}

// config 기본값(파일 없으면 최초 1회 생성)
if (!fs.existsSync(CONF)) {
  fs.writeFileSync(CONF, JSON.stringify({
    model: process.env.MODEL || 'gpt-5',
    baseURL: '',
    system: 'You are a helpful assistant. Be concise unless asked.'
  }, null, 2));
}

// 세션 파일(없으면 생성)
if (!fs.existsSync(SESSION)) {
  fs.writeFileSync(SESSION, JSON.stringify({ messages: [] }, null, 2));
}

// 로드
const cfg = JSON.parse(fs.readFileSync(CONF, 'utf8'));
const presets = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
let stored = JSON.parse(fs.readFileSync(SESSION, 'utf8'));

// ────────────────────────────────────────────────────────────
const API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENAI_APIKEY;
if (!API_KEY) {
  console.error(chalk.red('ERROR: OPENAI_API_KEY 환경변수가 필요해 (.env 또는 run-cli.sh로 주입).'));
  process.exit(1);
}
const BASE_URL = (cfg.baseURL && cfg.baseURL.trim() !== '') ? cfg.baseURL : 'https://api.openai.com/v1';

let MODEL = cfg.model || process.env.MODEL || 'gpt-5';
let systemPrompt = cfg.system || 'You are a helpful assistant. Be concise unless asked.';

const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

// 대화 상태
let messages = Array.isArray(stored.messages) && stored.messages.length
  ? stored.messages
  : [{ role: 'system', content: systemPrompt }];

// ────────────────────────────────────────────────────────────
// UI/입력
// ────────────────────────────────────────────────────────────
const you = chalk.bold.blue('You');
const ai = chalk.bold.green('AI');
const dim = chalk.dim;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

let multilineMode = false;
let buffer = '';

function prompt() {
  rl.setPrompt(multilineMode ? chalk.cyan('… ') : chalk.bold.cyan('> '));
  rl.prompt(true);
}

function printIntro() {
  console.log(chalk.bold(`\n✨ Minimal Chat CLI (streaming) — ${MODEL}\n`));
  console.log(`명령어
  ${chalk.yellow('/help')}             도움말
  ${chalk.yellow('/clear')}            컨텍스트 초기화
  ${chalk.yellow('/model <name>')}     모델 변경 (예: /model gpt-5)
  ${chalk.yellow('/sys <text>')}       system 프롬프트 변경
  ${chalk.yellow('/preset <name>')}    프리셋 적용 (${Object.keys(presets).join(', ') || '없음'})
  ${chalk.yellow('/save [file]')}      대화 저장 (기본: chat-<timestamp>.md)
  ${chalk.yellow('/ml')}               멀티라인 입력 시작
  ${chalk.yellow('/end')}              멀티라인 제출
  ${chalk.yellow('/exit')}             종료

입력 팁:
  Shift 감지 없이도 안전하게 동작하도록 /ml → 여러 줄 → /end 로 제출해.
`);
}

function persistSession() {
  fs.writeFileSync(SESSION, JSON.stringify({ messages }, null, 2));
}

function saveTranscript(filename) {
  const file = filename || `chat-${Date.now()}.md`;
  const header = `# Chat Transcript (${new Date().toISOString()})\nModel: ${MODEL}\n\n`;
  const body = messages
    .filter(m => m.role !== 'system')
    .map(m => `**${m.role.toUpperCase()}**: ${m.content}`)
    .join('\n\n');
  fs.writeFileSync(file, header + body);
  console.log(dim(`\nSaved to ${file}\n`));
}

function resetContext(newSystem) {
  messages = [{ role: 'system', content: newSystem ?? systemPrompt }];
  systemPrompt = newSystem ?? systemPrompt;
  persistSession();
  console.log(dim('Context cleared.\n'));
}

function renderAssistantChunk(chunk) {
  // 코드블록 가독성: ``` 앞뒤에 줄바꿈
  process.stdout.write(chunk.replace(/```/g, '\n```'));
}

// ────────────────────────────────────────────────────────────
// 스트리밍
// ────────────────────────────────────────────────────────────
async function streamChat(userInput) {
  messages.push({ role: 'user', content: userInput });
  persistSession();

  process.stdout.write(`${ai}: `);

  let full = '';
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages,
    stream: true
  });

  for await (const part of stream) {
    const delta = part?.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      renderAssistantChunk(delta);
    }
  }
  if (!full.endsWith('\n')) process.stdout.write('\n');

  messages.push({ role: 'assistant', content: full });
  persistSession();
}

// ────────────────────────────────────────────────────────────
async function handleCommand(text) {
  const [cmd, ...rest] = text.split(' ');
  const arg = rest.join(' ').trim();

  switch (cmd) {
    case '/help':
      printIntro();
      return;
    case '/clear':
      resetContext();
      return;
    case '/model':
      if (!arg) console.log(dim(`현재 모델: ${MODEL}`));
      else { MODEL = arg; console.log(dim(`모델 변경: ${MODEL}`)); }
      return;
    case '/sys':
      if (!arg) console.log(dim(`현재 system: "${systemPrompt}"`));
      else { resetContext(arg); console.log(dim('system 업데이트 완료.')); }
      return;
    case '/preset':
      if (!arg || !presets[arg]) {
        console.log(dim(`사용법: /preset <name>  (가능: ${Object.keys(presets).join(', ') || '없음'})`));
      } else {
        resetContext(presets[arg]);
        console.log(dim(`preset "${arg}" 적용`));
      }
      return;
    case '/save':
      saveTranscript(arg || undefined);
      return;
    case '/ml':
      multilineMode = true;
      buffer = '';
      console.log('멀티라인 시작. 여러 줄 입력 후 /end 로 제출해.');
      return;
    case '/end':
      if (!multilineMode) {
        console.log('멀티라인 모드가 아님. /ml 로 시작해줘.');
        return;
      }
      multilineMode = false;
      if (!buffer.trim()) {
        console.log('빈 입력은 제출하지 않아.');
        return;
      }
      console.log(`${you}: ${buffer.trim()}`);
      try {
        await streamChat(buffer.trim());
      } catch (err) {
        console.error(chalk.red(`\n[Error] ${err?.message || err}\n`));
      }
      buffer = '';
      return;
    case '/exit':
      rl.close();
      return 'exit';
    default:
      console.log(dim('알 수 없는 명령어. /help 참고'));
  }
}

// 입력 루프
rl.on('line', async (line) => {
  if (multilineMode) {
    const raw = line;
    const t = raw.trim();

    // 멀티라인 종료/취소 커맨드 처리
    if (t === '/end') {
      multilineMode = false;
      const text = buffer.trim();
      buffer = '';
      if (!text) {
        console.log('빈 입력은 제출하지 않아.');
        rl.prompt();
        return;
      }
      console.log(`${you}: ${text}`);
      try {
        await streamChat(text);
      } catch (err) {
        console.error(chalk.red(`\n[Error] ${err?.message || err}\n`));
      }
      rl.prompt();
      return;
    }
    if (t === '/cancel') {
      multilineMode = false;
      buffer = '';
      console.log(chalk.dim('멀티라인 입력을 취소했어.'));
      rl.prompt();
      return;
    }

    // 일반 줄 누적
    buffer += (buffer ? '\n' : '') + raw;
    rl.prompt();
    return;
  }

  const text = line.trim();
  if (!text) return rl.prompt();

  if (text.startsWith('/')) {
    const res = await handleCommand(text);
    if (res === 'exit') return;
    return rl.prompt();
  }

  console.log(`${you}: ${text}`);
  try {
    await streamChat(text);
  } catch (err) {
    console.error(chalk.red(`\n[Error] ${err?.message || err}\n`));
  }
  rl.prompt();
});

rl.on('close', () => {
  console.log(dim('\nBye!'));
  process.exit(0);
});

// 시작
function main() {
  printIntro();
  prompt();
}
main();

