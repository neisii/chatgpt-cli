// chat-cli.js
import 'dotenv/config';
import readline from 'readline';
import { once } from 'events';
import OpenAI from 'openai';
import chalk from 'chalk';
import fs from 'fs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ==== 사용자 설정(환경변수/기본값) ====
let MODEL = process.env.MODEL || 'gpt-5';
const SYSTEM_PROMPT = 'You are a helpful assistant. Answer briefly unless asked for details.';

// ==== 상태 ====
const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
let transcript = [];

// ==== UI 헬퍼 ====
const you = chalk.bold.blue('You');
const ai = chalk.bold.green('AI');
const dim = chalk.dim;

// readline 인터페이스
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.bold.cyan('> ')
});

// ==== 명령어 도움말 ====
const helpText = `
${chalk.bold('명령어')}
  ${chalk.yellow('/help')}           도움말
  ${chalk.yellow('/clear')}          대화 컨텍스트 초기화
  ${chalk.yellow('/model <name>')}   모델 변경 (예: /model gpt-5)
  ${chalk.yellow('/sys <text>')}     system 프롬프트 변경
  ${chalk.yellow('/save [file]')}    대화 저장 (기본: chat-${Date.now()}.md)
  ${chalk.yellow('/exit')}           종료
`;

// ==== 유틸 ====
function printIntro() {
  console.log(chalk.bold(`\n✨ Minimal Chat CLI (streaming) — ${MODEL}\n`));
  console.log(helpText);
}

function saveTranscript(filename) {
  const file = filename || `chat-${Date.now()}.md`;
  const header = `# Chat Transcript (${new Date().toISOString()})\nModel: ${MODEL}\n\n`;
  const body = transcript.map(t => `**${t.role.toUpperCase()}**: ${t.content}`).join('\n\n');
  fs.writeFileSync(file, header + body);
  console.log(dim(`\nSaved to ${file}\n`));
}

function resetContext(newSystem) {
  messages.length = 0;
  messages.push({ role: 'system', content: newSystem ?? SYSTEM_PROMPT });
  transcript = [];
  console.log(dim('Context cleared.\n'));
}

async function streamChat(userInput) {
  // 입력 기록
  messages.push({ role: 'user', content: userInput });
  transcript.push({ role: 'user', content: userInput });

  process.stdout.write(`${ai}: `);
  let full = '';

  // 스트리밍 호출
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages,
    stream: true
  });

  for await (const part of stream) {
    const delta = part?.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      process.stdout.write(delta);
    }
  }

  // 줄바꿈 정리
  if (!full.endsWith('\n')) process.stdout.write('\n');

  // 상태 업데이트
  messages.push({ role: 'assistant', content: full });
  transcript.push({ role: 'assistant', content: full });
}

async function handleLine(line) {
  const text = line.trim();

  // 명령어 처리
  if (text.startsWith('/')) {
    const [cmd, ...rest] = text.split(' ');
    const arg = rest.join(' ').trim();

    switch (cmd) {
      case '/help':
        console.log(helpText);
        break;
      case '/clear':
        resetContext();
        break;
      case '/model':
        if (!arg) {
          console.log(dim(`현재 모델: ${MODEL}`));
        } else {
          MODEL = arg;
          console.log(dim(`모델 변경: ${MODEL}`));
        }
        break;
      case '/sys':
        if (!arg) {
          console.log(dim(`현재 system: "${messages[0].content}"`));
        } else {
          resetContext(arg);
          console.log(dim(`system 업데이트 완료.`));
        }
        break;
      case '/save':
        saveTranscript(arg || undefined);
        break;
      case '/exit':
        rl.close();
        return;
      default:
        console.log(dim('알 수 없는 명령어. /help 참고'));
    }
    return;
  }

  if (!text) return;

  // 일반 대화
  console.log(`${you}: ${text}`);
  try {
    await streamChat(text);
  } catch (err) {
    console.error(chalk.red(`\n[Error] ${err?.message || err}\n`));
  }
}

// ==== 메인 실행 ====
async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error(chalk.red('ERROR: OPENAI_API_KEY 가 .env 에 없습니다.'));
    process.exit(1);
  }

  printIntro();
  rl.prompt();

  rl.on('line', async (line) => {
    await handleLine(line);
    rl.prompt();
  });

  await once(rl, 'close');
  console.log(dim('\nBye!'));
}

main();

