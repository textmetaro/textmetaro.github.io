효과음 파일. index.html 의 CONFIG.sounds 에서 세부 설정.

[발송/수신]
  send.mp3      문자 발송음   (현재: 2.0초 지점부터, 최대 1.6초 재생)
  receive.mp3   답장 수신음   (현재: 1.0초 지점부터, 최대 1.6초 재생)
  - 시작 지점/길이는 CONFIG.sounds 의 offset(초)/maxDur(초)로 조절.

[타이핑 — TickTock(github.com/0xJacky/TickTock) 방식: 키 종류별 3소리]
  현재는 파일 없이 "키 종류별로 다른 합성 클릭"이 납니다.
  실제 iOS 사운드를 쓰려면 아래 3개 파일을 넣고
  index.html 의 CONFIG.sounds.keyboard 값을 경로 문자열로 바꾸세요:
    key_press_click.*      일반 글자 키
    key_press_delete.*     백스페이스
    key_press_modifier.*   space / return / shift
  예)
    keyboard: {
      click:    "sounds/key_press_click",
      delete:   "sounds/key_press_delete",
      modifier: "sounds/key_press_modifier"
    }
  (TickTock 저장소 UISounds/TickTock/*.caf 가 그 3개 원본이지만 애플 iOS 순정음이라
   공개 배포 시 저작권 주의. .caf 는 웹 호환 위해 mp3/m4a 등으로 변환해서 넣으세요.)

- 확장자는 mp3 / m4a / wav / ogg 아무거나 (먼저 로드되는 걸 씀).
- type 키음은 30~60ms로 아주 짧게 잘라야 빠른 타이핑에서 자연스러움.
