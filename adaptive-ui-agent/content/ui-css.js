/**
 * EqualiUI in-page UI styles.
 * 이 CSS 는 닫힌(closed) Shadow DOM 안에만 적용된다 → 방문한 사이트의 CSS 나 AI 가 만든 CSS 가
 * 검토 카드·승인 버튼을 건드릴 수 없고, 반대로 이 CSS 가 사이트를 건드리지도 않는다.
 * (JS 문자열로 두는 이유: 페이지 CSP 와 무관하게 동기적으로 Shadow DOM 에 넣기 위함)
 *
 * 디자인은 확장 페이지(ui-src/src/index.css)와 같은 토큰을 쓴다:
 *   - 구분용 선(--line)은 연하게, 누르는 대상의 테두리(--ctrl)는 배경 대비 3:1 이상
 *   - 누르는 대상 44px 이상, 본문 대비 7:1, 또렷한 포커스 링, 장식용 이모지 없음
 *   - 나타날 때 투명도 애니메이션을 쓰지 않는다 (애니메이션이 멈춘 환경에서 검토 카드가 안 보이는 일을 막기 위해)
 *   - 크기는 전부 em → 보기 설정(글자 크기)을 바꾸면 #equali-ui-layer 의 font-size 하나로 전체가 함께 커진다
 */
self.EQUALI_UI_CSS = String.raw`
#equali-ui-layer {
  --bg: #FFFFFF; --fg: #151412; --muted: #6B665D; --soft: #F7F5F0; --soft-2: #F0EDE6;
  --line: #E3DFD7; --ctrl: #8D877C; --accent: #C43C0A; --on-accent: #FFFFFF; --focus: #F5581F;
  --success: #0F6E48; --warning: #8A5600; --danger: #B52A1F; --shadow: 0 20px 50px rgba(21, 20, 18, 0.14), 0 0 0 1px rgba(21, 20, 18, 0.06);
  font-size: 15px; color: var(--fg);
}
#equali-ui-layer[data-theme="dark"] {
  --bg: #1F1F25; --fg: #F7F7FA; --muted: #B8B8C4; --soft: #18181C; --soft-2: #2A2A32;
  --line: #2E2E36; --ctrl: #8B8B99; --accent: #FF7A3D; --on-accent: #0B0B0D; --focus: #FFA376;
  --success: #31C48D; --warning: #F2B23C; --danger: #F0564F; --shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}
#equali-ui-layer[data-theme="contrast"] {
  --bg: #000000; --fg: #FFFFFF; --muted: #FFFFFF; --soft: #000000; --soft-2: #000000;
  --line: #FFFFFF; --ctrl: #FFFFFF; --accent: #FFE600; --on-accent: #000000; --focus: #00E5FF;
  --success: #00FF9C; --warning: #FFE600; --danger: #FF6B6B; --shadow: 0 0 0 2px #FFFFFF;
}
#equali-ui-layer[data-size="large"] { font-size: 17.5px; }
#equali-ui-layer[data-size="xlarge"] { font-size: 20px; }
#equali-ui-layer[data-spacing="on"] { letter-spacing: 0.05em; word-spacing: 0.12em; line-height: 1.8; }

/* ---------- 공통 조작 요소 ---------- */
button, input, textarea { font: inherit; letter-spacing: inherit; color: inherit; margin: 0; }
button { cursor: pointer; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
[hidden] { display: none !important; }

.eq-btn, .equali-rv-btn, .equali-btn-primary, .equali-btn-revert, .btn-rec-apply, .btn-rlhf-subtle, .equali-in-chip, .equali-rv-chip, .equali-toast-action {
  min-height: 44px; padding: 0.5em 1em; border-radius: 0.65em; border: 1px solid var(--ctrl);
  background: var(--bg); color: var(--fg); font-size: 0.95em; font-weight: 600; line-height: 1.3;
}
.eq-btn:hover:not(:disabled), .equali-rv-btn:hover:not(:disabled), .btn-rlhf-subtle:hover, .equali-in-chip:hover, .equali-rv-chip:hover, .equali-btn-revert:hover { background: var(--soft-2); }
.equali-btn-primary, .btn-rec-apply, .equali-rv-approve, #equali-inpage-send-btn {
  background: var(--accent); color: var(--on-accent); border-color: var(--accent); font-weight: 700;
}
.eq-ghost, .equali-close-btn, .equali-rec-close {
  min-height: 44px; min-width: 44px; border: 1px solid transparent; border-radius: 0.65em; background: transparent; color: var(--muted); font-size: 1.2em; line-height: 1;
}
.eq-ghost:hover, .equali-close-btn:hover, .equali-rec-close:hover { background: var(--soft-2); color: var(--fg); }

/* ---------- 읽기 가이드 선 ---------- */
#equali-reading-ruler {
  display: none; position: fixed; left: 0; width: 100vw; height: 2.6em; margin-top: -1.3em; pointer-events: none !important;
  background: rgba(250, 204, 21, 0.22); border-top: 2px solid rgba(180, 83, 9, 0.7); border-bottom: 2px solid rgba(180, 83, 9, 0.7); z-index: 2147483640;
}

/* ---------- 떠 있는 배지 ---------- */
.equali-floating-badge {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483645; display: flex; align-items: center; gap: 0.55em;
  min-height: 44px; padding: 0.45em 0.9em; border-radius: 999px; cursor: pointer; user-select: none;
  background: var(--bg); color: var(--fg); border: 1px solid var(--ctrl); box-shadow: var(--shadow); font-weight: 700; font-size: 0.95em;
}
.equali-floating-badge:hover { background: var(--soft-2); }
.equali-badge-icon { width: 0.6em; height: 0.6em; border-radius: 50%; background: var(--muted); flex: none; }
.equali-floating-badge[data-active="true"] .equali-badge-icon { background: var(--success); }
.equali-badge-pill { font-weight: 500; color: var(--muted); font-size: 0.9em; background: none !important; }

/* ---------- 요청 · 검토 창 ---------- */
.equali-modal-backdrop {
  position: fixed; inset: 0; display: none; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;
  background: rgba(15, 23, 42, 0.45); z-index: 2147483646;
}
.equali-modal-backdrop.equali-visible { display: flex; }
.equali-review-card {
  width: 100%; max-width: 34em; max-height: 86vh; display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 1em; box-shadow: var(--shadow);
}
.equali-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5em; padding: 0.8em 0.8em 0.8em 1.3em; border-bottom: 1px solid var(--line); }
.equali-header-title { display: flex; flex-direction: column; gap: 0.1em; min-width: 0; font-weight: 700; font-size: 1.1em; }
.equali-safety-tag { font-weight: 400; font-size: 0.78em; color: var(--muted); }
.equali-modal-body { padding: 1.3em; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 1.1em; }
.equali-modal-footer { display: flex; justify-content: space-between; gap: 0.6em; padding: 0.8em 1.3em; border-top: 1px solid var(--line); }

.equali-direct-input-box { display: flex; flex-direction: column; gap: 0.7em; }
.equali-direct-label { font-size: 1.35em; font-weight: 700; line-height: 1.35; }
.equali-direct-sub { color: var(--muted); font-size: 0.93em; }
.equali-direct-row {
  display: flex; align-items: center; gap: 0.4em; padding: 0.35em 0.35em 0.35em 1em; border: 1px solid var(--ctrl); border-radius: 0.9em; background: var(--bg);
}
.equali-direct-row:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
.equali-direct-row input { flex: 1; min-width: 0; min-height: 44px; border: none; outline: none; background: transparent; font-size: 1em; }
.equali-direct-row input::placeholder { color: var(--muted); opacity: 1; }
#equali-inpage-voice-btn { min-height: 44px; padding: 0 0.7em; border: 1px solid var(--ctrl); border-radius: 0.7em; background: var(--bg); white-space: nowrap; }
#equali-inpage-voice-btn[aria-pressed="true"] { background: var(--soft-2); border-color: var(--accent); }
#equali-inpage-send-btn { min-height: 44px; min-width: 4em; padding: 0 1em; border-radius: 0.7em; border: 1px solid var(--accent); }

.equali-inpage-chips { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 0.8em; overflow: hidden; }
.equali-inpage-chips .equali-in-chip {
  display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 3.4em; padding: 0.7em 1em;
  border: none; border-radius: 0; border-top: 1px solid var(--line); text-align: left; font-weight: 500; font-size: 1em;
}
.equali-inpage-chips .equali-in-chip:first-child { border-top: none; }
.equali-inpage-chips .equali-in-chip::after { content: "›"; color: var(--muted); font-size: 1.2em; }
.equali-inpage-chips .equali-in-chip:focus-visible { outline-offset: -3px; }
.equali-quick-row { display: flex; gap: 0.5em; flex-wrap: wrap; }
.equali-quick-row .equali-in-chip { flex: 1 1 6em; background: var(--soft-2); border-color: transparent; }

.equali-summary-box { padding: 0.9em 1em; border-radius: 0.8em; background: var(--soft); }
.equali-summary-title { font-weight: 700; margin-bottom: 0.2em; }
.equali-summary-desc { color: var(--muted); font-size: 0.93em; line-height: 1.55; }
.equali-summary-box input { min-height: 44px; padding: 0 0.8em; border: 1px solid var(--ctrl); border-radius: 0.6em; background: var(--bg); flex: 1; min-width: 0; }
.equali-code-label { font-size: 0.85em; font-weight: 600; color: var(--muted); margin-bottom: 0.3em; }
pre { margin: 0; padding: 0.8em; border-radius: 0.6em; background: var(--soft-2); color: var(--fg); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8em; max-height: 11em; overflow: auto; white-space: pre-wrap; word-break: break-word; }

/* ---------- 적용 전 검토 카드 ---------- */
.equali-rv-card { display: flex; flex-direction: column; gap: 0.9em; padding: 1.2em; border: 1px solid var(--line); border-radius: 0.95em; outline: none; line-height: 1.55; }
.equali-rv-head { display: flex; flex-direction: column; gap: 0.2em; }
.equali-rv-title { font-size: 0.85em; font-weight: 600; color: var(--muted); }
.equali-rv-risk { display: flex; align-items: center; gap: 0.5em; font-size: 0.88em; font-weight: 700; }
.equali-rv-risk::before { content: ""; width: 0.7em; height: 0.7em; border-radius: 50%; background: currentColor; flex: none; }
.equali-rv-risk-low { color: var(--success); } .equali-rv-risk-medium { color: var(--warning); } .equali-rv-risk-high { color: var(--danger); }
.equali-rv-goal { font-size: 1.2em; font-weight: 700; line-height: 1.35; }
.equali-rv-summary { color: var(--muted); font-size: 0.95em; }
.equali-rv-changes { margin: 0; padding-left: 1.2em; font-size: 0.95em; }
.equali-rv-findings-title { font-size: 0.85em; font-weight: 700; color: var(--muted); }
.equali-rv-findings { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.equali-rv-findings li { display: flex; gap: 0.8em; padding: 0.65em 0; font-size: 0.95em; border-top: 1px solid var(--line); }
.equali-rv-findings li:first-child { border-top: none; }
.equali-rv-findings li strong { flex: none; width: 3.2em; font-size: 0.9em; color: var(--muted); }
.equali-rv-findings li.equali-rv-f-high strong { color: var(--danger); }
.equali-rv-metrics li strong { width: auto; flex: 1; color: var(--fg); font-weight: 500; }
.equali-rv-metrics li span { font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
.equali-rv-select { display: flex; flex-direction: column; gap: 0.5em; padding: 0.9em; border-radius: 0.8em; background: var(--soft); }
.equali-rv-select .equali-rv-btn { align-self: flex-start; }
.equali-rv-note { font-size: 0.93em; color: var(--success); }
.equali-rv-empty { font-size: 0.95em; font-weight: 600; color: var(--danger); }
.equali-rv-check { display: flex; align-items: center; gap: 0.8em; min-height: 44px; font-size: 0.95em; font-weight: 500; cursor: pointer; }
.equali-rv-check input { width: 1.5em; height: 1.5em; flex: none; accent-color: var(--accent); }
.equali-rv-ack { font-weight: 700; }
.equali-rv-code summary { cursor: pointer; font-size: 0.88em; font-weight: 600; color: var(--muted); min-height: 2.4em; display: flex; align-items: center; }
.equali-rv-actions { display: flex; gap: 0.5em; flex-wrap: wrap; }
.equali-rv-actions .equali-rv-btn { flex: 1 1 7em; }
.equali-rv-btn[aria-pressed="true"] { background: var(--soft-2); border-color: var(--accent); color: var(--accent); }
.equali-rv-reject { color: var(--danger); }
.equali-rv-reject-box, .equali-rv-hesitate { display: flex; flex-direction: column; gap: 0.6em; padding: 0.9em; border-radius: 0.8em; background: var(--soft); }
.equali-rv-chips { display: flex; flex-wrap: wrap; gap: 0.4em; }
.equali-rv-chip { font-weight: 500; border-radius: 999px; }

/* 검토 중에는 제안을 페이지에 바로 입혀 보여 준다 → 창은 페이지를 가리지 않게 아래쪽 띠로 내려가고, 검토에 필요한 것만 남긴다 */
.equali-modal-backdrop.equali-previewing { background: transparent; align-items: flex-end; padding: 0 12px 12px; pointer-events: none !important; }
.equali-modal-backdrop.equali-previewing .equali-review-card { pointer-events: auto; max-width: 46em; max-height: 58vh; border: 2px solid var(--accent); }
.equali-modal-backdrop.equali-previewing .equali-modal-header,
.equali-modal-backdrop.equali-previewing .equali-modal-footer,
.equali-modal-backdrop.equali-previewing .equali-modal-body > *:not(#equali-review-panel) { display: none; }
.equali-modal-backdrop.equali-previewing .equali-modal-body { padding: 0; }
.equali-modal-backdrop.equali-previewing .equali-rv-card { border: none; border-radius: 0; padding: 1em 1.2em; gap: 0.7em; }
.equali-rv-live { display: flex; align-items: center; gap: 0.5em; font-size: 0.85em; color: var(--muted); }
.equali-rv-live::before { content: ""; width: 0.65em; height: 0.65em; border-radius: 50%; background: var(--accent); flex: none; }
.equali-rv-candidates { display: flex; gap: 0.3em; padding: 0.25em; border-radius: 0.7em; background: var(--soft-2); }
.equali-rv-cand { flex: 1; min-height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; border: none; border-radius: 0.5em; background: transparent; color: var(--muted); font: inherit; font-size: 0.9em; cursor: pointer; }
.equali-rv-cand[aria-pressed="true"] { background: var(--bg); color: var(--fg); font-weight: 700; box-shadow: 0 1px 2px rgba(21, 20, 18, 0.18); }
.equali-rv-cand small { font-size: 0.8em; font-weight: 400; color: var(--muted); }
.equali-rv-more { border-top: 1px solid var(--line); padding-top: 0.5em; }
.equali-rv-more > summary { min-height: 40px; display: flex; align-items: center; cursor: pointer; color: var(--muted); font-size: 0.9em; }
.equali-rv-more[open] > summary { margin-bottom: 0.5em; }
.equali-rv-more-body { display: flex; flex-direction: column; gap: 0.7em; }

/* ---------- 알림 ---------- */
.equali-toast {
  position: fixed; right: 20px; bottom: 84px; z-index: 2147483647; display: flex; align-items: center; gap: 0.7em; max-width: min(30em, calc(100vw - 40px));
  padding: 0.7em 1em; border-radius: 0.8em; background: var(--fg); color: var(--bg); font-size: 0.95em; line-height: 1.45; box-shadow: var(--shadow);
}
#equali-ui-layer[data-theme="contrast"] .equali-toast { background: #000000; color: #FFFFFF; border: 2px solid #FFFFFF; }
.equali-toast-action { flex: none; min-height: 36px; padding: 0.3em 0.8em; background: transparent; color: inherit; border-color: currentColor; }

/* ---------- 제안 · 대안 · 확인 배너 ---------- */
.equali-recommendation-toast {
  position: fixed; top: 20px; right: 20px; z-index: 2147483644; width: min(24em, calc(100vw - 40px)); display: flex; flex-direction: column; gap: 0.6em;
  padding: 1.1em; border-radius: 0.95em; background: var(--bg); color: var(--fg); border: 1px solid var(--line); box-shadow: var(--shadow); line-height: 1.5;
}
.equali-rec-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5em; font-size: 1.05em; font-weight: 700; }
.equali-rec-title .equali-rec-close { margin: -0.5em -0.5em 0 0; flex: none; }
.equali-rec-desc { color: var(--muted); font-size: 0.93em; }
.equali-rec-desc:empty { display: none; }
.equali-rec-reasons { margin: 0; padding: 0.6em 0.8em 0.6em 1.9em; border-radius: 0.6em; background: var(--soft); font-size: 0.9em; color: var(--fg); }
.equali-rec-actions { display: flex; flex-wrap: wrap; gap: 0.5em; align-items: center; }
.equali-rec-actions .btn-rec-apply { flex: 1 1 8em; }
.equali-rlhf-group { display: flex; gap: 0.5em; flex-wrap: wrap; }
.btn-rlhf-subtle { font-weight: 500; }
.equali-alt-actions { flex-direction: column; align-items: stretch; }
.equali-alt-actions > button { width: 100%; text-align: left; }
.equali-rec-snooze { align-self: flex-start; min-height: 2.2em; padding: 0; border: none; background: none; color: var(--muted); font-size: 0.85em; text-decoration: underline; }

/* ---------- 읽어주기 바 ---------- */
.equali-tts-player-bar {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 2147483643; display: flex; align-items: center; gap: 0.3em; max-width: calc(100vw - 24px);
  padding: 0.35em 0.4em 0.35em 1em; border-radius: 999px; background: var(--bg); color: var(--fg); border: 1px solid var(--line); box-shadow: var(--shadow);
}
.equali-tts-label { font-weight: 700; font-size: 0.95em; white-space: nowrap; }
.equali-tts-progress { color: var(--muted); font-size: 0.85em; margin: 0 0.5em 0 0.3em; white-space: nowrap; font-variant-numeric: tabular-nums; }
.equali-tts-player-bar button { min-width: 44px; min-height: 44px; padding: 0 0.6em; border: 1px solid transparent; border-radius: 999px; background: transparent; font-size: 0.95em; font-weight: 600; }
.equali-tts-player-bar button:hover { background: var(--soft-2); }
.equali-tts-player-bar .equali-tts-main { background: var(--accent); color: var(--on-accent); }
.equali-tts-player-bar .equali-tts-main:hover { background: var(--accent); }

/* ---------- 자막 바 ---------- */
.equali-captions-overlay {
  position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 2147483642; width: min(46em, calc(100vw - 40px)); text-align: center;
  padding: 0.7em 1.1em; border-radius: 0.8em; background: rgba(0, 0, 0, 0.88); color: #FFFFFF; border: 1px solid rgba(255, 255, 255, 0.35);
}
.equali-captions-label { font-size: 0.78em; font-weight: 600; color: #CBD5E1; margin-bottom: 0.2em; }
.equali-caption-sound[data-active="true"] { color: #FDE047; font-weight: 700; }
.equali-captions-text { font-size: 1.45em; font-weight: 600; line-height: 1.45; min-height: 1.45em; }

/* ---------- 요약 카드 ---------- */
.equali-summary-card-modern {
  position: fixed; right: 20px; top: 20px; z-index: 2147483641; width: min(26em, calc(100vw - 40px)); max-height: 70vh; overflow: auto;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 0.95em; box-shadow: var(--shadow);
}
.equali-summary-header-modern { display: flex; align-items: center; justify-content: space-between; padding: 0.5em 0.5em 0.5em 1.1em; font-weight: 700; border-bottom: 1px solid var(--line); }
.equali-summary-body-modern { padding: 1.1em; }
.equali-summary-text { margin: 0; font-size: 1.02em; line-height: 1.75; }
.equali-summary-meta { display: flex; justify-content: space-between; align-items: center; gap: 0.6em; margin-top: 0.9em; padding-top: 0.7em; border-top: 1px solid var(--line); font-size: 0.82em; color: var(--muted); }
.equali-summary-loading { display: flex; align-items: center; gap: 0.7em; color: var(--muted); }
.equali-summary-spinner { width: 1.1em; height: 1.1em; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; }
@media (prefers-reduced-motion: no-preference) {
  .equali-summary-spinner { animation: equali-spin 0.9s linear infinite; }
  @keyframes equali-spin { to { transform: rotate(360deg); } }
}

/* ---------- 재구성 화면 (rebuild / audio / visual) ---------- */
.equali-rb {
  position: fixed; inset: 0; z-index: 2147483630; overflow-y: auto; outline: none;
  background: var(--bg); color: var(--fg); font-size: 1.2em; line-height: 1.6; display: flex; flex-direction: column;
}
/* 시각 중심(청각장애) 화면도 다른 방식과 같이 전체 화면으로 띄운다 (옆 칸으로 띄우면 원래 페이지와 뒤섞여 한눈에 들어오지 않았다) */
.equali-rb[data-mode="visual"] { inset: 0; width: auto; max-width: none; border-left: none; box-shadow: none; }
.equali-rb-visual-context { margin: 0.8em 1.4em 0; padding: 1em; border: 2px solid var(--accent); border-radius: 0.8em; background: var(--soft); }
.equali-rb-visual-context h2 { margin: 0 0 0.5em; font-size: 1.1em; }
.equali-rb-visual-facts { display: flex; flex-wrap: wrap; gap: 0.5em; }
.equali-rb-visual-facts span { padding: 0.35em 0.65em; border: 1px solid var(--ctrl); border-radius: 0.5em; background: var(--bg); }
.equali-rb-visual-media { margin-top: 0.8em; padding-top: 0.7em; border-top: 1px solid var(--ctrl); }
.equali-rb-visual-media p { margin: 0.3em 0; }
.equali-rb-visual-caption { font-size: 1.1em; font-weight: 700; overflow-wrap: anywhere; }

.equali-rb-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.6em; padding: 0.9em 1.4em; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 1; }
.equali-rb-title { margin: 0; font-size: 1.5em; font-weight: 800; line-height: 1.25; }
.equali-rb-sub { margin: 0; font-size: 0.72em; color: var(--muted); }
.equali-rb-tools { display: flex; flex-wrap: wrap; gap: 0.4em; }
.equali-rb-tool { min-height: 44px; padding: 0.3em 0.9em; border-radius: 0.6em; border: 1px solid var(--ctrl); background: var(--bg); color: var(--fg); font-size: 0.78em; font-weight: 600; }
.equali-rb-tool:hover, .equali-rb-btn:hover { background: var(--soft-2); }
.equali-rb-tool[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.equali-rb-exit { border-color: var(--fg); }
.equali-rb-status { margin: 0; padding: 0 1.4em; min-height: 1.2em; font-size: 0.8em; color: var(--accent); }
.equali-rb-main { width: min(60em, 100%); margin: 0 auto; padding: 0.8em 1.4em 2em; flex: 1; display: flex; flex-direction: column; gap: 1.3em; box-sizing: border-box; }
.equali-rb-summary { margin: 0; font-size: 1.05em; }
.equali-rb-notice { margin: 0; padding: 0.8em 1em; border-radius: 0.7em; border: 2px solid var(--warning); font-size: 0.9em; }
.equali-rb-label { display: block; font-weight: 700; margin-bottom: 0.4em; }
.equali-rb-row { display: flex; gap: 0.6em; flex-wrap: wrap; }
.equali-rb-input { flex: 1 1 12em; min-height: 3.2em; padding: 0 1em; font-size: 1.05em; border: 2px solid var(--ctrl); border-radius: 0.8em; background: var(--bg); color: var(--fg); }
.equali-rb-input:focus { border-color: var(--accent); }
.equali-rb-btn { min-height: 3.2em; padding: 0.5em 1.3em; border-radius: 0.8em; border: 2px solid var(--ctrl); background: var(--bg); color: var(--fg); font-size: 1em; font-weight: 700; }
.equali-rb-primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.equali-rb-primary:hover { background: var(--accent); filter: brightness(1.1); }
.equali-rb-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 11em), 1fr)); gap: 0.7em; }
.equali-rb-action { display: flex; align-items: center; gap: 0.7em; min-height: 4.2em; text-align: left; font-size: 1.1em; }
.equali-rb-num { flex: none; width: 1.9em; height: 1.9em; border-radius: 50%; display: grid; place-items: center; background: var(--soft-2); color: var(--fg); font-size: 0.85em; font-weight: 800; border: 1px solid var(--ctrl); }
.equali-rb-primary .equali-rb-num { background: var(--on-accent); color: var(--accent); border-color: var(--on-accent); }
/* 말로 바꾼 배치: 버튼 묶음을 옆 칸으로 (좁은 화면에서는 다시 위로) */
.equali-rb-arrange { display: flex; flex-direction: column; gap: 0.4em; order: -1; padding: 0.9em; border: 2px solid var(--accent); border-radius: 0.8em; background: var(--soft); }
.equali-rb-main[data-actions-pos="right"], .equali-rb-main[data-actions-pos="left"] { display: grid; width: min(76em, 100%); column-gap: 1.6em; row-gap: 1.3em; align-content: start; }
.equali-rb-main[data-actions-pos="right"] { grid-template-columns: minmax(0, 1fr) minmax(13em, 20em); }
.equali-rb-main[data-actions-pos="left"] { grid-template-columns: minmax(13em, 20em) minmax(0, 1fr); }
.equali-rb-main[data-actions-pos="right"] > *, .equali-rb-main[data-actions-pos="left"] > * { grid-column: 1; min-width: 0; }
.equali-rb-main[data-actions-pos="left"] > * { grid-column: 2; }
.equali-rb-main[data-actions-pos="right"] > .equali-rb-actions { grid-column: 2; grid-row: 1 / span 12; align-self: start; grid-template-columns: 1fr; position: sticky; top: 0.5em; }
.equali-rb-main[data-actions-pos="left"] > .equali-rb-actions { grid-column: 1; grid-row: 1 / span 12; align-self: start; grid-template-columns: 1fr; position: sticky; top: 0.5em; }
@media (max-width: 720px) { .equali-rb-main[data-actions-pos] { display: flex; } }
.equali-rb-main[data-actions-cols="1"] .equali-rb-actions { grid-template-columns: 1fr; }
.equali-rb-main[data-actions-cols="2"] .equali-rb-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.equali-rb-main[data-actions-cols="3"] .equali-rb-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.equali-rb-main[data-actions-cols="4"] .equali-rb-actions { grid-template-columns: repeat(4, minmax(0, 1fr)); }
/* ---- 모드별 고유 기능 ---- */
.equali-rb-easy { display: flex; flex-direction: column; gap: 0.7em; padding: 1.1em 1.2em; border-radius: 1em; background: var(--soft); border: 1px solid var(--line); }
.equali-rb-easy-text { margin: 0; font-size: 1.15em; line-height: 1.9; }
.equali-rb-easy-loading, .equali-rb-easy-legend { margin: 0; font-size: 0.9em; color: var(--muted); }
.equali-rb-points ul { margin: 0.3em 0 0; padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.45em; line-height: 1.75; }
.equali-rb-points strong { margin-right: 0.3em; }
.equali-rb-underline { text-decoration: underline; text-decoration-color: var(--accent); text-decoration-thickness: 0.18em; text-underline-offset: 0.22em; font-weight: 600; }
.equali-rb-term { display: inline; padding: 0 0.1em; margin: 0; border: none; border-bottom: 0.14em dotted var(--fg); border-radius: 0; background: transparent; color: inherit; font: inherit; cursor: help; min-height: 0; }
.equali-rb-term:hover, .equali-rb-term:focus-visible { background: var(--soft-2); outline: 2px solid var(--focus); outline-offset: 1px; }
.equali-rb-dict { display: flex; flex-direction: column; gap: 0.5em; padding: 0.9em; border-radius: 0.8em; background: var(--bg); border: 1px solid var(--line); }
.equali-rb-dict-title { margin: 0; font-weight: 700; font-size: 0.95em; }
.equali-rb-dict-tabs { display: flex; flex-wrap: wrap; gap: 0.4em; }
.equali-rb-dict-tab { min-height: 44px; padding: 0 0.9em; border-radius: 999px; border: 1px solid var(--ctrl); background: var(--bg); color: var(--fg); font: inherit; font-size: 0.95em; cursor: pointer; }
.equali-rb-dict-tab[aria-selected="true"] { background: var(--fg); color: var(--bg); border-color: var(--fg); font-weight: 600; }
.equali-rb-dict-meaning { margin: 0; line-height: 1.7; }
.equali-rb-hinted { flex-wrap: wrap; row-gap: 0.1em; padding-top: 0.7em; padding-bottom: 0.7em; }
.equali-rb-hint { flex-basis: 100%; font-size: 0.78em; font-weight: 400; opacity: 0.85; text-align: left; }
.equali-rb-focus { display: flex; flex-direction: column; gap: 0.8em; }
.equali-rb-focus-text { margin: 0; font-size: 1.7em; line-height: 1.7; font-weight: 500; }
.equali-rb-chunks { display: flex; flex-direction: column; gap: 1.2em; }
.equali-rb-chunk { display: flex; flex-direction: column; gap: 0.55em; padding-bottom: 1em; border-bottom: 1px solid var(--line); }
.equali-rb-sentence { margin: 0; max-width: 34em; font-size: 1.1em; line-height: 2; letter-spacing: 0.04em; word-spacing: 0.14em; padding: 0.1em 0.4em; border-radius: 0.4em; }
.equali-rb-sentence.equali-rb-reading { background: var(--soft-2); outline: 2px solid var(--accent); }
.equali-rb-chunk .equali-rb-tool { align-self: flex-start; }
.equali-rb-outline { display: flex; flex-direction: column; gap: 0.7em; }
.equali-rb-heads { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35em; }
.equali-rb-main .equali-rb-btn:focus-visible { outline: 4px solid var(--focus); outline-offset: 3px; }
.equali-rb-viewbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6em; margin: 0; font-size: 0.9em; color: var(--muted); }
.equali-rb-steps { display: flex; flex-direction: column; gap: 0.7em; }
.equali-rb-step-q { margin: 0 0 0.2em; font-size: 1.4em; font-weight: 700; }
.equali-rb-step-choice { display: flex; flex-direction: row; align-items: center; justify-content: flex-start; gap: 0.8em; min-height: 64px; font-size: 1.1em; text-align: left; }
.equali-rb-step-note { margin-left: auto; font-size: 0.8em; font-weight: 400; color: var(--muted); }
.equali-rb-step-back { align-self: flex-start; }
/* 글로만 보기: 버튼의 상자·격자를 걷어 내고 글처럼 차례로 읽히게 한다 (누르는 영역 44px 은 유지) */
.equali-rb-main[data-view="text"] .equali-rb-actions { display: flex; flex-direction: column; gap: 0; }
.equali-rb-main[data-view="text"] .equali-rb-action { justify-content: flex-start; border: none; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; color: var(--fg); padding-left: 0; text-decoration: underline; text-underline-offset: 3px; font-weight: 500; }
.equali-rb-main[data-view="text"] .equali-rb-items { gap: 0; }
.equali-rb-main[data-view="text"] .equali-rb-item { border: none; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; padding-left: 0; padding-right: 0; }
.equali-rb-main[data-view="text"] .equali-rb-item-desc { font-size: 1em; line-height: 1.8; }
.equali-rb-h2-note { font-weight: 400; margin-left: 0.5em; }
.equali-rb-menus { display: flex; flex-direction: column; gap: 0.5em; }
.equali-rb-menu { border: 1px solid var(--line); border-radius: 0.8em; background: var(--bg); }
.equali-rb-menu-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6em; min-height: 48px; padding: 0 1em; font-weight: 600; cursor: pointer; border-radius: 0.8em; }
.equali-rb-menu-head:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.equali-rb-menu-count { font-weight: 400; font-size: 0.85em; color: var(--muted); }
.equali-rb-menu-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 10em), 1fr)); gap: 0.5em; padding: 0 0.8em 0.8em; }
.equali-rb-menu-item { justify-content: flex-start; text-align: left; font-weight: 500; }
.equali-rb-h2 { margin: 0 0 0.5em; font-size: 0.85em; font-weight: 700; color: var(--muted); }
.equali-rb-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6em; }
.equali-rb-item { display: flex; flex-direction: column; gap: 0.2em; width: 100%; text-align: left; padding: 0.9em 1.1em; border-radius: 0.8em; border: 1px solid var(--line); background: var(--soft); color: var(--fg); font: inherit; box-sizing: border-box; }
button.equali-rb-item { cursor: pointer; border-color: var(--ctrl); }
button.equali-rb-item:hover { background: var(--soft-2); }
.equali-rb-item-title { font-weight: 700; font-size: 1.05em; }
.equali-rb-item-desc { color: var(--muted); font-size: 0.9em; }
.equali-rb-pages { justify-content: space-between; }
.equali-rb-foot { margin: 0; font-size: 0.72em; color: var(--muted); }
.equali-rb-footer { display: flex; gap: 0.6em; flex-wrap: wrap; padding: 0.8em 1.4em; border-top: 1px solid var(--line); position: sticky; bottom: 0; background: var(--bg); }
.equali-rb-footer .equali-rb-btn { flex: 1 1 8em; min-height: 3em; font-size: 0.9em; }
.equali-rb-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.2em; font-size: 1.2em; text-align: center; padding: 2em; }
.equali-rb-loading .equali-summary-spinner { width: 2.4em; height: 2.4em; border-width: 4px; }
.equali-rb-propose { position: fixed; left: 50%; bottom: 5em; transform: translateX(-50%); z-index: 2147483000; width: min(34em, calc(100vw - 2em)); box-sizing: border-box; padding: 1.2em; display: flex; flex-direction: column; gap: 0.6em; border-radius: 1em; background: var(--bg); color: var(--fg); border: 2px solid var(--accent); box-shadow: var(--shadow); line-height: 1.5; }
.equali-rb-propose-title { margin: 0; font-size: 1.2em; font-weight: 700; }
.equali-rb-propose-desc { margin: 0; font-size: 0.92em; color: var(--muted); }
.equali-rb-propose-actions { display: flex; flex-wrap: wrap; gap: 0.5em; }
.equali-rb-propose-actions .equali-rb-btn { flex: 1 1 9em; }
.equali-rb-confirm { position: fixed; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center; padding: 1.2em; background: rgba(0, 0, 0, 0.6); }
.equali-rb-confirm-card { max-width: 26em; padding: 1.4em; border-radius: 1em; background: var(--bg); border: 3px solid var(--danger); display: flex; flex-direction: column; gap: 0.8em; }
.equali-rb-confirm-title { margin: 0; font-size: 1.2em; font-weight: 800; }
.equali-rb-confirm-card p { margin: 0; }
.equali-rb-confirm .equali-rb-btn { flex: 1; }
.equali-rb-feedback .equali-rb-confirm-card { width: min(100%, 32em); max-width: 32em; border-color: var(--accent); }
.equali-rb-feedback-actions { display: flex; flex-wrap: wrap; gap: 0.55em; }
.equali-rb-feedback-actions .equali-rb-btn { flex: 1 1 11em; }
/* 소리 중심 화면: 눈으로 보는 분(보호자·저시력)을 위해 지금 읽는 항목을 굵게 표시한다 */
.equali-rb[data-mode="audio"] .equali-rb-item:focus, .equali-rb[data-mode="audio"] .equali-rb-action:focus { outline: 5px solid var(--focus); outline-offset: 3px; }

/* ---------- 페르소나 고르기 ---------- */
.equali-persona { display: flex; flex-direction: column; gap: 0.6em; }
.equali-persona-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12em), 1fr)); gap: 0.5em; }
.equali-persona-opt { display: flex; flex-direction: column; gap: 0.15em; text-align: left; min-height: 44px; padding: 0.6em 0.8em; border-radius: 0.7em; border: 1px solid var(--ctrl); background: var(--bg); color: var(--fg); }
.equali-persona-opt[aria-pressed="true"] { border: 2px solid var(--accent); background: var(--soft-2); }
.equali-persona-opt strong { font-size: 0.95em; }
.equali-persona-opt span { font-size: 0.78em; color: var(--muted); line-height: 1.4; }

/* ---------- 캔버스 에디터 (사용자가 직접 쓰는 도구) ---------- */
.equali-visual-editor-panel {
  position: fixed; top: 20px; right: 20px; z-index: 2147483640; width: min(21em, calc(100vw - 40px)); display: flex; flex-direction: column; max-height: calc(100vh - 40px);
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 0.95em; box-shadow: var(--shadow); font-size: 0.93em;
}
.equali-ve-header { display: flex; align-items: center; justify-content: space-between; padding: 0.4em 0.4em 0.4em 1em; font-weight: 700; border-bottom: 1px solid var(--line); }
.equali-ve-header button { min-width: 44px; min-height: 44px; border: none; background: transparent; color: var(--muted); font-size: 1.2em; border-radius: 0.6em; }
.equali-ve-body { padding: 1em; overflow-y: auto; }
.equali-ve-footer { padding: 0.8em 1em; border-top: 1px solid var(--line); }
.equali-ve-empty { color: var(--muted); text-align: center; padding: 1.5em 0; }
.equali-ve-section { font-size: 0.85em; font-weight: 700; color: var(--muted); margin: 1.1em 0 0.5em; }
.equali-ve-section:first-child { margin-top: 0; }
.equali-ve-sel { font-size: 0.85em; color: var(--muted); margin-bottom: 0.8em; word-break: break-all; }
.equali-ve-row { display: flex; align-items: center; justify-content: space-between; gap: 0.6em; min-height: 2.6em; }
.equali-ve-row label { font-weight: 500; }
.equali-ve-row input[type="range"] { flex: 1; max-width: 8em; accent-color: var(--accent); }
.equali-ve-row input[type="color"] { width: 2.8em; height: 2em; padding: 0; border: 1px solid var(--ctrl); border-radius: 0.4em; background: var(--bg); }
.equali-ve-row input[type="checkbox"] { width: 1.4em; height: 1.4em; accent-color: var(--accent); }
.equali-ve-val { font-size: 0.85em; color: var(--muted); min-width: 2.6em; text-align: right; font-variant-numeric: tabular-nums; }
.equali-ve-field { width: 100%; box-sizing: border-box; min-height: 40px; padding: 0.4em 0.7em; border: 1px solid var(--ctrl); border-radius: 0.55em; background: var(--bg); margin: 0.2em 0 0.8em; }
.equali-ve-btns { display: flex; gap: 0.4em; flex-wrap: wrap; }
.equali-ve-btns button, .equali-ve-mini { flex: 1 1 5em; min-height: 40px; padding: 0.3em 0.6em; border: 1px solid var(--ctrl); border-radius: 0.55em; background: var(--bg); font-size: 0.92em; font-weight: 600; }
.equali-ve-mini { flex: none; min-height: 32px; font-size: 0.85em; }
.equali-ve-btns button:hover, .equali-ve-mini:hover { background: var(--soft-2); }
.equali-ve-danger { color: var(--danger); }
.equali-ve-status { font-size: 0.85em; color: var(--muted); margin-top: 0.4em; }
.equali-visual-editor-panel hr { border: none; border-top: 1px solid var(--line); margin: 1em 0; }
.equali-visual-editor-panel .equali-btn-primary { width: 100%; }

.equali-ve-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 2147483647; width: min(26em, 92vw); padding: 1em; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 0.95em; box-shadow: var(--shadow); }
.equali-ve-modal-head { display: flex; align-items: center; justify-content: space-between; font-weight: 700; margin-bottom: 0.6em; }
.equali-ve-modal-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5em; max-height: 16em; overflow-y: auto; margin-top: 0.7em; }
.equali-ve-modal-grid .equali-ve-note { grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 1em; font-size: 0.9em; }
.equali-ve-res-item { position: relative; height: 5.5em; border-radius: 0.5em; overflow: hidden; border: 1px solid var(--line); cursor: pointer; background: #000; padding: 0; }
.equali-ve-res-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.equali-ve-res-item span { position: absolute; left: 0; right: 0; bottom: 0; padding: 0.15em 0.4em; font-size: 0.72em; color: #FFF; background: rgba(0, 0, 0, 0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.equali-ve-preset-chip { min-height: 36px; padding: 0.2em 0.8em; border-radius: 999px; border: 1px solid var(--line); background: var(--soft-2); font-size: 0.88em; }
`;
