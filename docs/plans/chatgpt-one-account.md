# ChatGPT 한 계정으로 보이기 계획

상태: **설계**(2026-11-09). 7절의 질문에 답을 받은 뒤 결정 [0117](../tracking/decisions/0117-chatgpt-one-account.md)을 확정하고 구현한다. 구현은 OpenAI의 사용량 통합이 시행되는 12월에 맞춘다.

## 1. 무엇을 하려는가

ChatGPT 요금제로 AI를 쓰는 길은 둘이다. 앱이 직접 로그인하는 ChatGPT 직접 연결(결정 0081)과, PC에 설치된 Codex 프로그램이다. 지금은 두 길이 서로 다른 AI처럼 보인다. 설정에 카드가 따로 있고, "사용할 AI"와 모델 선택기에도 따로 나오며, 한쪽이 막히면 다른 쪽으로 계속하라는 단추가 나온다.

OpenAI는 12월부터 Plus·Pro·Business 요금제에서 ChatGPT와 Codex가 사용량 하나를 함께 쓰게 한다고 알렸다(OpenAI 도움말 "Understanding ChatGPT and Codex usage limits"). 사용량은 토큰으로 세고, Instant 대화는 빠진다. 같은 계정이면 두 길은 한 사용량에서 빠지는 것이다.

그래서 화면에서는 ChatGPT를 AI 하나로 보이고, 어느 길로 갈지는 앱이 정한다. 사용자가 고르는 것은 지금처럼 "어떤 AI"까지다.

## 2. 지금

- 구독 제공자는 셋이다(`AI_SUBSCRIPTION_PROVIDERS`: `claude-code`, `chatgpt`, `codex`). `auto`의 순서도 이 차례다.
- 설정 → AI에 카드가 셋이다. "사용할 AI" 목록과 모델 선택기에도 ChatGPT와 Codex가 따로 있다.
- 막힌 실행의 "…로 계속"(`aiContinueOption`)은 막힌 제공자를 뺀 `ready`인 구독을 차례대로 찾는다. Claude가 없으면 ChatGPT가 막혔을 때 Codex를, Codex가 막혔을 때 ChatGPT를 권한다.
- ChatGPT 직접 연결의 한도 오류(`subscription_sharing_usage_limit_exceeded`)는 사용자가 이 앱에만 정해 둔 한도일 수도 있다(OpenAI "Errors and recovery"). 이때 Codex를 권하면 사용자가 정한 한도를 돌아가게 된다.
- 사용량 줄(5시간·7일)은 Codex만 보인다. 직접 연결에는 사용량을 알려 주는 API가 없다.
- 에이전트 모드와 터미널 명령어·MCP는 Codex만 쓴다. 직접 연결은 이 둘에 열지 않았다(결정 0081).

## 3. 바꾸는 것

### 화면

- 설정 → AI의 구독 카드는 Claude와 ChatGPT 둘이다. ChatGPT 카드 안에 두 길이 한 줄씩 있다.
  - "앱에서 바로 연결": 지금의 ChatGPT 카드 내용(로그인, 연결 끊기, 다른 계정, 사용량 관리, 이 앱에서 쓰지 않기).
  - "Codex 프로그램": 지금의 Codex 카드 내용(설치·업데이트·로그인·종량 허용·이 앱에서 쓰지 않기). 줄 머리에 "에이전트 모드와 터미널 명령어는 이 길을 씁니다"를 적는다.
  - 둘 다 연결돼 있으면 카드 위에 "앱 안의 AI 창은 앱에서 바로 연결을 씁니다"를 보인다.
- "사용할 AI"와 모델 선택기의 구독 항목은 Claude와 ChatGPT 둘이다. 모델 목록은 지금 쓰일 길의 목록이다.
- 연결 도우미는 지금 그대로다. ChatGPT 답이 직접 연결로 펼쳐지고, Codex는 그 안의 링크다.
- Codex 안내(`AiCodexNotice`)는 지금처럼 Codex 길이 쓰일 때만 보인다.

### 어느 길로 갈지

`selectAiProvider` 한 곳에서 정한다. 보낼 때 정하고, 실행 중에는 바꾸지 않는다.

- ChatGPT가 골라졌거나(`provider: 'chatgpt'`) `auto`가 ChatGPT 차례에 왔을 때:
  1. 직접 연결이 `ready`이고 이 앱에서 끄지 않았으면 직접 연결.
  2. 아니면 Codex가 `ready`(구독 로그인)이고 끄지 않았으면 Codex.
  3. 아니면 연결 안내. Codex가 종량 로그인이면 지금처럼 사용자가 허용하고 Codex를 직접 골라야 쓰인다. 이 대체로는 종량 로그인에 가지 않는다.
- 이미 `provider: 'codex'`로 저장된 설정은 "ChatGPT를 Codex 길로 고정"으로 읽는다. 저장된 값은 바꾸지 않는다.
- 문서 작업(번역 등)은 시작 전에 정한 길을 끝날 때까지 쓴다(지금 규칙과 같다).

### 막혔을 때

- "…로 계속"의 후보에서 같은 집안을 뺀다. ChatGPT 직접 연결이 막히면 Codex를, Codex가 막히면 직접 연결을 권하지 않는다. Claude만 후보다.
- 직접 연결이 한도로 막혀도 상태는 `ready`이므로, 다음 요청은 다시 직접 연결로 간다. 한도를 피해 Codex로 저절로 가지 않는다.

### 사용량 줄

- Codex 길이 쓰일 때는 지금처럼 Codex의 5시간·7일 값을 보인다.
- 직접 연결이 쓰일 때 Codex의 값을 같이 보일지는 12월에 실제 계정으로 확인한 뒤 정한다(7절 질문 3).

## 4. 바꾸지 않는 것

- 제공자 식별자 `chatgpt`·`codex`, 설정 파일의 값(`providers.chatgpt`, `providers.codex`, `subscriptionOff`), 터미널 명령어의 `--provider codex`. 밖에서 기대고 있는 약속이다(`docs/contracts.md`).
- 로그인 방식. 직접 연결은 OpenAI가 오픈소스 앱에 연 공식 길(결정 0081)만 쓰고, ChatGPT의 비공개 주소는 쓰지 않는다. Codex는 사용자가 설치한 프로그램을 지금처럼 실행한다. 다른 프로그램의 로그인을 빌리지 않는다.
- 에이전트 모드와 터미널 명령어·MCP는 Codex만 쓴다.
- 모델 선택값은 길마다 따로 둔다(`providers.chatgpt.model`, `providers.codex.model`). 두 길의 모델 목록이 다를 수 있기 때문이다.

## 5. 고칠 곳

- `packages/ai-provider`: `selectAiProvider`의 ChatGPT 차례(3절 규칙), 두 길을 묶는 순수 함수(이름 예: `chatGptRouteOf`), 시험.
- `packages/ui`: `aiContinueOption`의 같은 집안 빼기, `aiProviderPickerGroups`의 구독 묶음, `aiSelectionChoices`, `aiSubscriptionCardView`에 두 길을 담는 카드, 문구 21개 언어, 시험.
- `apps/shell`: `SettingsAiSection.tsx`의 카드 배치, 홈 AI 질문의 선택 표시.
- 문서: `docs/business-rules.md`의 "제공자 선택", "실행 중 막혔을 때", "사용량 표시", 결정 0117, `packages/ui/AGENTS.md`, 도움말 구독 주제 21개 언어, 사이트 `/connect#chatgpt` 절.

## 6. 시험

- 길 고르기: 직접만·Codex만·둘 다·둘 다 꺼 둠·Codex 종량·Codex `checking` 중 직접 `ready`·저장된 `codex` 고정.
- "…로 계속": 직접 연결이 막혔을 때 Codex가 후보가 아니고 Claude만 후보인지, 그 반대도.
- 모델 선택기: ChatGPT 묶음 하나, 쓰일 길의 목록, 고른 모델이 그 길의 설정에 저장되는지.
- 예전 설정 파일(`provider: 'codex'`, `providers` 표 없음)을 그대로 읽는지.
- 실제 계정 확인(12월, 주인): 두 길을 같은 계정으로 연결해 짧은 요청 몇 번. Codex 사용량 값이 직접 연결 사용분을 반영하는지 본다. `docs/operations.md`의 "실제 구독으로 확인하기"를 따른다.

## 7. 정할 것

1. **계정이 다를 때.** 직접 연결과 Codex가 서로 다른 ChatGPT 계정으로 로그인돼 있을 수 있다. 3절의 대체(직접 연결이 없으면 Codex)를 계정이 같을 때만 할지, 계정과 상관없이 할지. 두 상태에는 이미 계정 주소가 있어(`status.account`) 메모리에서 견줄 수 있다. 저장하지는 않는다. 권장: 계정과 상관없이 하되, 계정이 다르면 카드에 "두 길의 계정이 다릅니다"를 보인다.
2. **"Codex로 고정"을 고르는 자리.** 예전에 저장된 `codex` 고정만 읽을지, 새로 고정하는 자리를 ChatGPT 카드 안에 둘지. 권장: 카드 안 Codex 줄에 "앱 안의 AI 창도 이 길로" 스위치를 둔다. 기본은 꺼짐.
3. **사용량 줄.** 12월 확인 뒤, 같은 계정이면 직접 연결을 쓸 때도 Codex의 5시간·7일 값을 "ChatGPT 사용량"으로 보일지.
4. **크레딧.** 한도가 찬 뒤 사용자가 ChatGPT에서 산 크레딧이 이 앱의 요청에도 쓰이는지 OpenAI 문서에 없다. 쓰인다면 앱에서 고르지 않은 요금 경로가 될 수 있으므로(절대 규칙 2) 12월에 확인하고, 그 결과에 따라 안내를 더할지 정한다.

## 8. 순서

1. 지금: ChatGPT 한도 문구를 "이 앱이 쓸 수 있는 사용량"으로 고친다(`fix/chatgpt-app-limit-wording`, 이 계획과 따로 낸다).
2. 7절의 답을 받고 결정 0117을 확정한다.
3. 12월 시행 직후: 실제 계정으로 6절의 확인을 하고 3절을 구현한다.
4. 다음 버전 소식과 사이트 `/connect#chatgpt` 절에 바뀐 점을 적는다.
