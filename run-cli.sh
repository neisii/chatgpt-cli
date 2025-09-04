#!/usr/bin/env bash
set -euo pipefail

# ── 설정 ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_ENTRY="${SCRIPT_DIR}/chat-cli.js"   # 엔트리 JS 경로 (변경 시 수정)
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gptcli"
CRED_FILE="${CONFIG_DIR}/credentials"   # OPENAI_API_KEY 보관 (chmod 600)
ENV_FILE="${SCRIPT_DIR}/.env"           # 프로젝트 로컬 .env (있으면 우선 사용)

MODEL_DEFAULT="gpt-5"                   # 기본 모델

# ── 옵션 파싱 (/ 모델도 간단히 바꿀 수 있게) ───────────────
MODEL="${MODEL_DEFAULT}"
while [[ "${1-}" =~ ^- ]]; do
  case "${1}" in
    -m|--model)
      MODEL="${2-}"; shift 2 ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [-m MODEL]
  -m, --model   모델 이름 (기본: ${MODEL_DEFAULT})
환경변수:
  OPENAI_API_KEY   없으면 처음 1회 입력 받아 ~/.config/gptcli/credentials 저장
  MODEL            스크립트 옵션으로도 지정 가능
EOF
      exit 0 ;;
    *)
      echo "알 수 없는 옵션: $1" >&2; exit 2 ;;
  esac
done

# ── 경로/파일 보장 ──────────────────────────────────────────
mkdir -p "${CONFIG_DIR}"
touch "${CRED_FILE}" || true
chmod 600 "${CRED_FILE}" || true

# ── 키 로딩 순서: .env > credentials 파일 > 프롬프트 ────────
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  # shellcheck disable=SC1090
  source "${CRED_FILE}" || true
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo -n "OPENAI_API_KEY 입력(화면에 안 보임): "
  # -s: silent, -r: raw, -p 프롬프트는 위에서 직접 처리했으니 불필요
  IFS= read -rs OPENAI_API_KEY
  echo
  if [[ -z "${OPENAI_API_KEY}" ]]; then
    echo "ERROR: 빈 키는 저장할 수 없어." >&2
    exit 1
  fi
  # credentials 저장
  printf 'OPENAI_API_KEY=%q\n' "${OPENAI_API_KEY}" > "${CRED_FILE}"
  chmod 600 "${CRED_FILE}"
  echo "키를 ${CRED_FILE} 에 저장했어(권한 600)."
fi

# ── 실행 ────────────────────────────────────────────────────
export OPENAI_API_KEY
export MODEL="${MODEL}"

# Node가 ESM이면 node로 실행, 패키지 스크립트를 쓰면 변경
exec node "${APP_ENTRY}"

